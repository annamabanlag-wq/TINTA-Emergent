from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, status, UploadFile, File, Request, Response
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
import requests
import stripe

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ.get("JWT_SECRET", "inked-dev-secret-change-me")
JWT_ALG = "HS256"
JWT_MINUTES = 60 * 24 * 7  # 7 days

# Stripe
stripe.api_key = os.environ.get("STRIPE_API_KEY", "")
CURRENCY = "php"
DEPOSIT_AMOUNT_MINOR = 290000  # ₱2,900 in centavos
DEPOSIT_AMOUNT_MAJOR = 2900     # ₱2,900
BACKEND_PUBLIC_URL = os.environ.get("BACKEND_PUBLIC_URL", "")

# Emergent Object Storage
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "inked-tattoo"
storage_key: Optional[str] = None

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("inked")


# ---------- Models ----------
class RegisterIn(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=6, max_length=72)
    name: str = Field(min_length=1, max_length=60)


class LoginIn(BaseModel):
    email: str
    password: str


def _validate_email(e: str) -> str:
    e = e.strip().lower()
    if "@" not in e or "." not in e.split("@")[-1]:
        raise HTTPException(422, "Invalid email address")
    return e


class PublicUser(BaseModel):
    id: str
    email: str
    name: str


class AuthOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: PublicUser


class Artist(BaseModel):
    id: str
    name: str
    handle: str
    city: str
    studio: str
    address: str = ""
    lat: float = 0.0
    lon: float = 0.0
    styles: List[str]
    bio: str
    rate_per_hour: int
    avatar: str
    hero: str
    portfolio: List[str]
    rating: float = 0.0
    reviews_count: int = 0


class BookingIn(BaseModel):
    artist_id: str
    date: str  # ISO date "YYYY-MM-DD"
    time_slot: str  # "14:00"
    description: str
    reference_image: Optional[str] = None
    estimated_hours: int = 2


class Booking(BaseModel):
    id: str
    user_id: str
    artist_id: str
    artist_name: str
    artist_avatar: str
    date: str
    time_slot: str
    description: str
    reference_image: Optional[str] = None
    estimated_hours: int
    deposit: int
    status: str  # confirmed | completed | cancelled
    payment_status: str = "unpaid"  # unpaid | paid | refunded
    checkout_session_id: Optional[str] = None
    payment_intent_id: Optional[str] = None
    created_at: str


class ReviewIn(BaseModel):
    artist_id: str
    rating: int = Field(ge=1, le=5)
    comment: str


class Review(BaseModel):
    id: str
    artist_id: str
    user_id: str
    user_name: str
    rating: int
    comment: str
    created_at: str


class MessageIn(BaseModel):
    artist_id: str
    text: str


class Message(BaseModel):
    id: str
    thread_id: str
    from_user_id: str
    from_role: str  # "user" | "artist"
    text: str
    created_at: str


class Thread(BaseModel):
    id: str
    artist_id: str
    artist_name: str
    artist_avatar: str
    last_message: str
    last_at: str


# ---------- Helpers ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), h.encode())
    except Exception:
        return False


def make_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=JWT_MINUTES)
    return jwt.encode({"sub": user_id, "exp": exp}, JWT_SECRET, algorithm=JWT_ALG)


async def current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        uid = payload["sub"]
    except Exception:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": uid}, {"_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user


def public_user(u: dict) -> PublicUser:
    return PublicUser(id=u["id"], email=u["email"], name=u["name"])


# ---------- Auth ----------
@api_router.post("/auth/register", response_model=AuthOut)
async def register(body: RegisterIn):
    email = _validate_email(body.email)
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(409, "Email already registered")
    uid = str(uuid.uuid4())
    doc = {
        "id": uid,
        "email": email,
        "name": body.name.strip(),
        "password_hash": hash_password(body.password),
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    return AuthOut(access_token=make_token(uid), user=PublicUser(id=uid, email=email, name=body.name.strip()))


@api_router.post("/auth/login", response_model=AuthOut)
async def login(body: LoginIn):
    email = _validate_email(body.email)
    u = await db.users.find_one({"email": email})
    if not u or not verify_password(body.password, u["password_hash"]):
        raise HTTPException(401, "Incorrect email or password")
    return AuthOut(access_token=make_token(u["id"]), user=public_user(u))


@api_router.get("/auth/me", response_model=PublicUser)
async def me(user=Depends(current_user)):
    return public_user(user)


# ---------- Artists ----------
@api_router.get("/artists", response_model=List[Artist])
async def list_artists(style: Optional[str] = None, q: Optional[str] = None):
    query: dict = {}
    if style and style.lower() != "all":
        query["styles"] = {"$in": [style]}
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    docs = await db.artists.find(query, {"_id": 0}).to_list(200)
    return docs


@api_router.get("/artists/{artist_id}", response_model=Artist)
async def get_artist(artist_id: str):
    doc = await db.artists.find_one({"id": artist_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Artist not found")
    return doc


@api_router.get("/styles", response_model=List[str])
async def styles():
    return ["All", "Blackwork", "Fineline", "Traditional", "Realism", "Japanese", "Neo-Traditional", "Geometric"]


# ---------- Bookings ----------
@api_router.post("/bookings", response_model=Booking)
async def create_booking(body: BookingIn, user=Depends(current_user)):
    artist = await db.artists.find_one({"id": body.artist_id}, {"_id": 0})
    if not artist:
        raise HTTPException(404, "Artist not found")
    bid = str(uuid.uuid4())
    deposit = DEPOSIT_AMOUNT_MAJOR  # flat deposit in PHP
    booking = {
        "id": bid,
        "user_id": user["id"],
        "artist_id": artist["id"],
        "artist_name": artist["name"],
        "artist_avatar": artist["avatar"],
        "date": body.date,
        "time_slot": body.time_slot,
        "description": body.description,
        "reference_image": body.reference_image,
        "estimated_hours": body.estimated_hours,
        "deposit": deposit,
        "status": "confirmed",
        "payment_status": "unpaid",
        "checkout_session_id": None,
        "payment_intent_id": None,
        "created_at": now_iso(),
    }
    await db.bookings.insert_one(booking)
    return booking


@api_router.get("/bookings", response_model=List[Booking])
async def my_bookings(user=Depends(current_user)):
    docs = await db.bookings.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.post("/bookings/{booking_id}/cancel", response_model=Booking)
async def cancel_booking(booking_id: str, user=Depends(current_user)):
    b = await db.bookings.find_one({"id": booking_id, "user_id": user["id"]}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")

    updates: dict = {"status": "cancelled"}
    refunded = False
    refund_reason = None

    # Compute hours until session
    try:
        session_dt = datetime.fromisoformat(f"{b['date']}T{b['time_slot']}:00+00:00")
        hours_until = (session_dt - datetime.now(timezone.utc)).total_seconds() / 3600
    except Exception:
        hours_until = -1

    if b.get("payment_status") == "paid" and hours_until >= 48:
        # Attempt refund
        pi_id = b.get("payment_intent_id") or ""
        if pi_id.startswith("pi_mock_") or (b.get("checkout_session_id") or "").startswith("mock_"):
            # Mock refund
            updates["payment_status"] = "refunded"
            updates["refunded_at"] = now_iso()
            refunded = True
        elif pi_id and stripe.api_key and stripe.api_key not in ("sk_test_emergent", ""):
            try:
                await run_in_threadpool(lambda: stripe.Refund.create(payment_intent=pi_id))
                updates["payment_status"] = "refunded"
                updates["refunded_at"] = now_iso()
                refunded = True
            except stripe.error.StripeError as e:
                logger.exception("Refund failed: %s", e)
                refund_reason = "refund_failed"
    elif b.get("payment_status") == "paid":
        refund_reason = "within_48h"

    await db.bookings.update_one({"id": booking_id}, {"$set": updates})
    b.update(updates)
    b["_refunded"] = refunded  # not part of response model, ignored
    return b


# ---------- Reviews ----------
@api_router.get("/artists/{artist_id}/availability")
async def artist_availability(artist_id: str, date: str):
    """Return the list of time_slots already booked for this artist on given date (YYYY-MM-DD)."""
    artist = await db.artists.find_one({"id": artist_id}, {"_id": 0})
    if not artist:
        raise HTTPException(404, "Artist not found")
    docs = await db.bookings.find(
        {"artist_id": artist_id, "date": date, "status": {"$ne": "cancelled"}},
        {"_id": 0, "time_slot": 1},
    ).to_list(200)
    return {"artist_id": artist_id, "date": date, "booked_slots": sorted({d["time_slot"] for d in docs})}


@api_router.get("/artists/{artist_id}/reviews", response_model=List[Review])
async def artist_reviews(artist_id: str):
    docs = await db.reviews.find({"artist_id": artist_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return docs


@api_router.post("/reviews", response_model=Review)
async def create_review(body: ReviewIn, user=Depends(current_user)):
    artist = await db.artists.find_one({"id": body.artist_id}, {"_id": 0})
    if not artist:
        raise HTTPException(404, "Artist not found")
    rid = str(uuid.uuid4())
    r = {
        "id": rid,
        "artist_id": body.artist_id,
        "user_id": user["id"],
        "user_name": user["name"],
        "rating": body.rating,
        "comment": body.comment,
        "created_at": now_iso(),
    }
    await db.reviews.insert_one(r)
    # Update aggregate
    all_r = await db.reviews.find({"artist_id": body.artist_id}, {"_id": 0}).to_list(1000)
    avg = round(sum(x["rating"] for x in all_r) / len(all_r), 1) if all_r else 0.0
    await db.artists.update_one(
        {"id": body.artist_id}, {"$set": {"rating": avg, "reviews_count": len(all_r)}}
    )
    return r


# ---------- Messages ----------
def thread_id_for(user_id: str, artist_id: str) -> str:
    return f"{user_id}:{artist_id}"


@api_router.get("/threads", response_model=List[Thread])
async def list_threads(user=Depends(current_user)):
    threads = await db.threads.find({"user_id": user["id"]}, {"_id": 0}).sort("last_at", -1).to_list(200)
    return threads


@api_router.get("/threads/{artist_id}/messages", response_model=List[Message])
async def get_messages(artist_id: str, user=Depends(current_user)):
    tid = thread_id_for(user["id"], artist_id)
    docs = await db.messages.find({"thread_id": tid}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return docs


@api_router.post("/messages", response_model=Message)
async def send_message(body: MessageIn, user=Depends(current_user)):
    artist = await db.artists.find_one({"id": body.artist_id}, {"_id": 0})
    if not artist:
        raise HTTPException(404, "Artist not found")
    tid = thread_id_for(user["id"], body.artist_id)
    mid = str(uuid.uuid4())
    msg = {
        "id": mid,
        "thread_id": tid,
        "from_user_id": user["id"],
        "from_role": "user",
        "text": body.text,
        "created_at": now_iso(),
    }
    await db.messages.insert_one(msg)
    # Upsert thread
    await db.threads.update_one(
        {"id": tid},
        {
            "$set": {
                "id": tid,
                "user_id": user["id"],
                "artist_id": artist["id"],
                "artist_name": artist["name"],
                "artist_avatar": artist["avatar"],
                "last_message": body.text,
                "last_at": now_iso(),
            }
        },
        upsert=True,
    )
    # Simulate artist auto-reply after user's first message
    count = await db.messages.count_documents({"thread_id": tid})
    if count == 1:
        reply_id = str(uuid.uuid4())
        reply = {
            "id": reply_id,
            "thread_id": tid,
            "from_user_id": artist["id"],
            "from_role": "artist",
            "text": f"Hey! Thanks for reaching out. I usually respond within a day. Feel free to share references.",
            "created_at": now_iso(),
        }
        await db.messages.insert_one(reply)
        await db.threads.update_one(
            {"id": tid},
            {"$set": {"last_message": reply["text"], "last_at": reply["created_at"]}},
        )
    return msg


# ---------- Object Storage (Emergent) ----------
def init_storage() -> Optional[str]:
    global storage_key
    if storage_key:
        return storage_key
    if not EMERGENT_KEY:
        logger.warning("EMERGENT_LLM_KEY not set — uploads disabled")
        return None
    try:
        resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
        resp.raise_for_status()
        storage_key = resp.json()["storage_key"]
        logger.info("Object storage initialized")
        return storage_key
    except Exception as exc:
        logger.exception("Storage init failed: %s", exc)
        return None


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key:
        raise HTTPException(503, "Storage not available")
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503:
        # Stale storage key — refresh once
        globals()["storage_key"] = None
        key = init_storage()
        if not key:
            raise HTTPException(503, "Storage unavailable")
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    if resp.status_code == 402:
        raise HTTPException(402, "Storage credits exhausted")
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    if not key:
        raise HTTPException(503, "Storage not available")
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key},
        timeout=60,
    )
    if resp.status_code == 500:
        raise HTTPException(404, "File not found")
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


class UploadOut(BaseModel):
    url: str
    path: str
    size: int


@api_router.post("/upload", response_model=UploadOut)
async def upload_file(file: UploadFile = File(...), user=Depends(current_user)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image uploads are supported")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 10MB)")
    ext = (file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg").lower()
    ext = "".join(c for c in ext if c.isalnum())[:5] or "jpg"
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    result = await run_in_threadpool(put_object, path, data, file.content_type)
    stored_path = result.get("path", path)
    # Save metadata for ownership check
    await db.uploads.insert_one({
        "path": stored_path,
        "owner_id": user["id"],
        "content_type": file.content_type,
        "size": len(data),
        "created_at": now_iso(),
    })
    # Build API URL that clients use to fetch
    base = os.environ.get("BACKEND_PUBLIC_URL") or ""
    file_url = f"{base}/api/files/{stored_path}"
    return {"url": file_url, "path": stored_path, "size": len(data)}


@api_router.get("/files/{path:path}")
async def serve_file(path: str, token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    # Support either Bearer header or ?token= query param (for <img> web usage)
    auth = authorization or (f"Bearer {token}" if token else None)
    if not auth or not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(auth[7:], JWT_SECRET, algorithms=[JWT_ALG])
        uid = payload["sub"]
    except Exception:
        raise HTTPException(401, "Invalid token")
    meta = await db.uploads.find_one({"path": path}, {"_id": 0})
    if not meta:
        raise HTTPException(404, "Not found")
    # For MVP, any authenticated user can view a reference image (artists may need this too)
    data, content_type = await run_in_threadpool(get_object, path)
    return Response(content=data, media_type=content_type)


# ---------- Stripe ----------
class CheckoutIn(BaseModel):
    booking_id: str
    platform: str = "native"  # "native" | "web"


@api_router.post("/payments/checkout-session")
async def create_checkout_session(body: CheckoutIn, user=Depends(current_user)):
    booking = await db.bookings.find_one({"id": body.booking_id, "user_id": user["id"]}, {"_id": 0})
    if not booking:
        raise HTTPException(404, "Booking not found")
    if booking.get("payment_status") == "paid":
        raise HTTPException(409, "Booking is already paid")

    # If Stripe not configured with a real key, use a mock checkout page
    is_placeholder = (not stripe.api_key) or stripe.api_key in ("sk_test_emergent", "")
    frontend_base = os.environ.get("BACKEND_PUBLIC_URL") or "https://tattoo-reserve-7.preview.emergentagent.com"

    if is_placeholder:
        mock_session_id = f"mock_{uuid.uuid4().hex}"
        await db.bookings.update_one(
            {"id": body.booking_id, "payment_status": {"$ne": "paid"}},
            {"$set": {"checkout_session_id": mock_session_id, "payment_status": "unpaid"}},
        )
        # Point at our own mock checkout page hosted by the app
        checkout_url = f"{frontend_base}/mock-checkout?session_id={mock_session_id}&booking_id={body.booking_id}&amount={DEPOSIT_AMOUNT_MINOR}"
        return {"checkout_url": checkout_url, "session_id": mock_session_id, "mock": True}

    success_url = f"{frontend_base}/payment/return?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{frontend_base}/payment/return?cancelled=1"
    try:
        session = await run_in_threadpool(lambda: stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": CURRENCY,
                    "product_data": {"name": f"Tattoo deposit — {booking['artist_name']}"},
                    "unit_amount": DEPOSIT_AMOUNT_MINOR,
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"booking_id": body.booking_id, "user_id": user["id"]},
            payment_intent_data={"metadata": {"booking_id": body.booking_id, "user_id": user["id"]}},
        ))
    except stripe.error.StripeError as e:
        logger.exception("Stripe error: %s", e)
        raise HTTPException(502, "Unable to create payment session")

    await db.bookings.update_one(
        {"id": body.booking_id, "payment_status": {"$ne": "paid"}},
        {"$set": {"checkout_session_id": session.id, "payment_status": "unpaid"}},
    )
    return {"checkout_url": session.url, "session_id": session.id, "mock": False}


@api_router.get("/payments/verify/{session_id}")
async def verify_payment(session_id: str, user=Depends(current_user)):
    # Mock verification path — booking has been "paid" via our mock page
    if session_id.startswith("mock_"):
        booking = await db.bookings.find_one({"checkout_session_id": session_id, "user_id": user["id"]}, {"_id": 0})
        if not booking:
            raise HTTPException(404, "Session not found")
        if booking.get("payment_status") == "paid":
            return {"paid": True, "booking_id": booking["id"], "payment_status": "paid", "mock": True}
        return {"paid": False, "booking_id": booking["id"], "payment_status": "unpaid", "mock": True}

    if not stripe.api_key:
        raise HTTPException(503, "Stripe not configured")
    try:
        session = await run_in_threadpool(lambda: stripe.checkout.Session.retrieve(session_id))
    except stripe.error.StripeError:
        raise HTTPException(400, "Invalid session")
    metadata = session.get("metadata") or {}
    booking_id = metadata.get("booking_id")
    if not booking_id:
        raise HTTPException(400, "Missing booking reference")
    if metadata.get("user_id") != user["id"]:
        raise HTTPException(403, "Not your session")
    if session.get("mode") != "payment":
        raise HTTPException(400, "Wrong mode")
    if session.get("currency") != CURRENCY or session.get("amount_total") != DEPOSIT_AMOUNT_MINOR:
        raise HTTPException(400, "Amount mismatch")

    if session.get("payment_status") == "paid":
        payment_intent = session.get("payment_intent")
        await db.bookings.update_one(
            {"id": booking_id, "user_id": user["id"], "payment_status": {"$ne": "paid"}},
            {"$set": {
                "payment_status": "paid",
                "payment_intent_id": payment_intent,
                "paid_at": now_iso(),
            }},
        )
        return {"paid": True, "booking_id": booking_id, "payment_status": "paid"}
    return {"paid": False, "booking_id": booking_id, "payment_status": session.get("payment_status")}


class MockConfirmIn(BaseModel):
    session_id: str


@api_router.post("/payments/mock-confirm")
async def mock_confirm(body: MockConfirmIn, user=Depends(current_user)):
    """Called by the mock checkout page to simulate a successful payment."""
    booking = await db.bookings.find_one({"checkout_session_id": body.session_id, "user_id": user["id"]}, {"_id": 0})
    if not booking:
        raise HTTPException(404, "Session not found")
    await db.bookings.update_one(
        {"id": booking["id"], "user_id": user["id"]},
        {"$set": {
            "payment_status": "paid",
            "payment_intent_id": f"pi_mock_{uuid.uuid4().hex}",
            "paid_at": now_iso(),
        }},
    )
    return {"paid": True, "booking_id": booking["id"]}


# ---------- Favorites ----------
class FavoriteToggleIn(BaseModel):
    artist_id: str


@api_router.get("/favorites", response_model=List[Artist])
async def list_favorites(user=Depends(current_user)):
    favs = await db.favorites.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    ids = [f["artist_id"] for f in favs]
    if not ids:
        return []
    artists = await db.artists.find({"id": {"$in": ids}}, {"_id": 0}).to_list(500)
    return artists


@api_router.get("/favorites/ids", response_model=List[str])
async def favorite_ids(user=Depends(current_user)):
    favs = await db.favorites.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    return [f["artist_id"] for f in favs]


@api_router.post("/favorites/toggle")
async def toggle_favorite(body: FavoriteToggleIn, user=Depends(current_user)):
    existing = await db.favorites.find_one({"user_id": user["id"], "artist_id": body.artist_id})
    if existing:
        await db.favorites.delete_one({"user_id": user["id"], "artist_id": body.artist_id})
        return {"favorited": False, "artist_id": body.artist_id}
    await db.favorites.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "artist_id": body.artist_id,
        "created_at": now_iso(),
    })
    return {"favorited": True, "artist_id": body.artist_id}


# ---------- Featured (Deal of the Week) ----------
class FeaturedOut(BaseModel):
    artist: Artist
    headline: str
    story: str
    deal_ends_at: str
    discount_pct: int


@api_router.get("/featured", response_model=FeaturedOut)
async def featured():
    # Deterministic featured artist that rotates weekly
    week_index = datetime.now(timezone.utc).isocalendar().week
    artists = await db.artists.find({}, {"_id": 0}).sort("id", 1).to_list(200)
    if not artists:
        raise HTTPException(404, "No artists")
    picked = artists[week_index % len(artists)]
    stories = [
        "This week's spotlight. Known for pushing the limits of ink and skin — book now before the calendar closes.",
        "Featured artist of the week. Booking a session unlocks a bonus custom sketch for your idea.",
        "Hand-picked by our editors — a rare style, a bold voice. 15% off the deposit until Sunday.",
    ]
    # End of ISO week (Sunday 23:59 UTC)
    now = datetime.now(timezone.utc)
    days_until_sunday = 6 - now.weekday()
    if days_until_sunday < 0:
        days_until_sunday += 7
    end = now.replace(hour=23, minute=59, second=0, microsecond=0) + timedelta(days=days_until_sunday)
    return {
        "artist": picked,
        "headline": "ARTIST OF THE WEEK",
        "story": stories[week_index % len(stories)],
        "deal_ends_at": end.isoformat(),
        "discount_pct": 15,
    }


# ---------- Seed ----------
SEED_ARTISTS = [
    {
        "name": "Kai Nakamura",
        "handle": "@kai.ink",
        "city": "Brooklyn, NY",
        "studio": "Black Iron Tattoo",
        "styles": ["Japanese", "Traditional", "Neo-Traditional"],
        "bio": "Fifteen years perfecting the craft of Irezumi. Bold lines, saturated color, and stories carved into skin.",
        "rate_per_hour": 12500,
        "avatar": "https://images.unsplash.com/photo-1621787279722-c06fe6c18cf7?w=400&q=80",
        "hero": "https://images.unsplash.com/photo-1568515045052-f9a854d70bfd?w=1200&q=80",
        "portfolio": [
            "https://images.unsplash.com/photo-1611501275019-9b5cda994e8d?w=800&q=80",
            "https://images.unsplash.com/photo-1543059080-f9b1272213d5?w=800&q=80",
            "https://images.unsplash.com/photo-1552627019-947c3789ffb5?w=800&q=80",
            "https://images.unsplash.com/photo-1590246814883-57c511e76523?w=800&q=80",
        ],
    },
    {
        "name": "Mara Voss",
        "handle": "@voss.fineline",
        "city": "Berlin, DE",
        "studio": "Needle & Ink",
        "styles": ["Fineline", "Geometric"],
        "bio": "Minimalist single-needle work. Small, precise, and personal.",
        "rate_per_hour": 10000,
        "avatar": "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&q=80",
        "hero": "https://images.unsplash.com/photo-1547754145-ef9ff306e3f3?w=1200&q=80",
        "portfolio": [
            "https://images.unsplash.com/photo-1547754145-ef9ff306e3f3?w=800&q=80",
            "https://images.unsplash.com/photo-1590246815131-4e2a6b3ba1e0?w=800&q=80",
            "https://images.unsplash.com/photo-1571816119607-57e48af9c92c?w=800&q=80",
            "https://images.unsplash.com/photo-1568515387631-8b650bbcdb90?w=800&q=80",
        ],
    },
    {
        "name": "Diego Ruiz",
        "handle": "@ruiz.blackwork",
        "city": "Mexico City, MX",
        "studio": "Cuervo Tattoo",
        "styles": ["Blackwork", "Realism"],
        "bio": "Heavy black, deep shadows, and hyperrealist portraits. Bring me your darkest ideas.",
        "rate_per_hour": 14000,
        "avatar": "https://images.unsplash.com/photo-1607346256330-dee7af15f7c5?w=400&q=80",
        "hero": "https://images.unsplash.com/photo-1775135436883-56af5c10a476?w=1200&q=80",
        "portfolio": [
            "https://images.unsplash.com/photo-1775135436883-56af5c10a476?w=800&q=80",
            "https://images.unsplash.com/photo-1565053776166-95d4c7d5c9a0?w=800&q=80",
            "https://images.unsplash.com/photo-1611501275019-9b5cda994e8d?w=800&q=80",
            "https://images.unsplash.com/photo-1552627019-947c3789ffb5?w=800&q=80",
        ],
    },
    {
        "name": "Yuki Sato",
        "handle": "@yuki.realism",
        "city": "Tokyo, JP",
        "studio": "Shinjuku Ink Lab",
        "styles": ["Realism", "Japanese"],
        "bio": "Photorealistic portraiture. Precision in every pore.",
        "rate_per_hour": 17000,
        "avatar": "https://images.unsplash.com/photo-1600180758890-6b94519a8ba6?w=400&q=80",
        "hero": "https://images.unsplash.com/photo-1605647533135-51b5906087d0?w=1200&q=80",
        "portfolio": [
            "https://images.unsplash.com/photo-1605647533135-51b5906087d0?w=800&q=80",
            "https://images.unsplash.com/photo-1571816119607-57e48af9c92c?w=800&q=80",
            "https://images.unsplash.com/photo-1543059080-f9b1272213d5?w=800&q=80",
            "https://images.unsplash.com/photo-1590246814883-57c511e76523?w=800&q=80",
        ],
    },
    {
        "name": "Ash Rowe",
        "handle": "@ash.geo",
        "city": "London, UK",
        "studio": "Cold Steel Studio",
        "styles": ["Geometric", "Blackwork"],
        "bio": "Sacred geometry meets negative space. Symmetry is my religion.",
        "rate_per_hour": 11500,
        "avatar": "https://images.unsplash.com/photo-1531891437562-4301cf35b7e4?w=400&q=80",
        "hero": "https://images.unsplash.com/photo-1568515387631-8b650bbcdb90?w=1200&q=80",
        "portfolio": [
            "https://images.unsplash.com/photo-1568515387631-8b650bbcdb90?w=800&q=80",
            "https://images.unsplash.com/photo-1547754145-ef9ff306e3f3?w=800&q=80",
            "https://images.unsplash.com/photo-1590246815131-4e2a6b3ba1e0?w=800&q=80",
            "https://images.unsplash.com/photo-1565053776166-95d4c7d5c9a0?w=800&q=80",
        ],
    },
    {
        "name": "Nova Blake",
        "handle": "@nova.trad",
        "city": "Los Angeles, US",
        "studio": "Sailor's Rest",
        "styles": ["Traditional", "Neo-Traditional"],
        "bio": "American traditional with a modern twist. Bold lines, no apologies.",
        "rate_per_hour": 11000,
        "avatar": "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=400&q=80",
        "hero": "https://images.unsplash.com/photo-1552627019-947c3789ffb5?w=1200&q=80",
        "portfolio": [
            "https://images.unsplash.com/photo-1552627019-947c3789ffb5?w=800&q=80",
            "https://images.unsplash.com/photo-1611501275019-9b5cda994e8d?w=800&q=80",
            "https://images.unsplash.com/photo-1543059080-f9b1272213d5?w=800&q=80",
            "https://images.unsplash.com/photo-1590246814883-57c511e76523?w=800&q=80",
        ],
    },
]


STUDIO_LOCATIONS = {
    "Black Iron Tattoo": {"address": "246 Bedford Ave, Brooklyn, NY 11249", "lat": 40.7181, "lon": -73.9598},
    "Needle & Ink": {"address": "Torstraße 88, 10119 Berlin", "lat": 52.5297, "lon": 13.4033},
    "Cuervo Tattoo": {"address": "Av. Álvaro Obregón 100, Roma Norte, Mexico City", "lat": 19.4148, "lon": -99.1618},
    "Shinjuku Ink Lab": {"address": "3-15-1 Shinjuku, Shinjuku-ku, Tokyo 160-0022", "lat": 35.6919, "lon": 139.7038},
    "Cold Steel Studio": {"address": "42 Brick Lane, London E1 6RF", "lat": 51.5203, "lon": -0.0716},
    "Sailor's Rest": {"address": "1801 N Highland Ave, Los Angeles, CA 90028", "lat": 34.1017, "lon": -118.3388},
}


@app.on_event("startup")
async def seed_data():
    count = await db.artists.count_documents({})
    if count == 0:
        docs = []
        for a in SEED_ARTISTS:
            loc = STUDIO_LOCATIONS.get(a["studio"], {"address": "", "lat": 0.0, "lon": 0.0})
            docs.append({
                "id": str(uuid.uuid4()),
                "rating": round(4.5 + (0.5 * (hash(a["name"]) % 5) / 10), 1),
                "reviews_count": 20 + (hash(a["name"]) % 40),
                **a,
                **loc,
            })
        await db.artists.insert_many(docs)
        logger.info(f"Seeded {len(docs)} artists")
    else:
        # Backfill missing location fields for existing artists
        async for artist in db.artists.find({"$or": [{"lat": {"$exists": False}}, {"address": {"$exists": False}}]}, {"_id": 0, "id": 1, "studio": 1}):
            loc = STUDIO_LOCATIONS.get(artist.get("studio", ""), {"address": "", "lat": 0.0, "lon": 0.0})
            await db.artists.update_one({"id": artist["id"]}, {"$set": loc})
        # Backfill PHP rates — update any artist with a USD-era rate (< 1000) to the new PHP amount
        by_name = {a["name"]: a["rate_per_hour"] for a in SEED_ARTISTS}
        async for artist in db.artists.find({"rate_per_hour": {"$lt": 1000}}, {"_id": 0, "id": 1, "name": 1}):
            new_rate = by_name.get(artist.get("name", ""))
            if new_rate:
                await db.artists.update_one({"id": artist["id"]}, {"$set": {"rate_per_hour": new_rate}})
        # Backfill legacy $50 deposits to new PHP deposit
        await db.bookings.update_many({"deposit": {"$lt": 100}}, {"$set": {"deposit": DEPOSIT_AMOUNT_MAJOR}})


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
