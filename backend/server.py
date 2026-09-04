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

JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is required — set it in the environment")
JWT_ALG = "HS256"
JWT_MINUTES = 60 * 24 * 7  # 7 days

# Stripe
stripe.api_key = os.environ.get("STRIPE_API_KEY", "")
CURRENCY = "php"
DEPOSIT_AMOUNT_MINOR = 290000  # ₱2,900 in centavos
DEPOSIT_AMOUNT_MAJOR = 2900     # ₱2,900

# Public URL used for callback/redirect URLs. Prefer APP_URL (Emergent deploy injects this at
# runtime) over any committed BACKEND_PUBLIC_URL so deploy env always wins.
PUBLIC_URL = (
    os.environ.get("APP_URL")
    or os.environ.get("BACKEND_PUBLIC_URL")
    or ""
).rstrip("/")
BACKEND_PUBLIC_URL = PUBLIC_URL  # kept for backwards compatibility with existing refs

# Business — INKED platform commission (%)
COMMISSION_PERCENT = int(os.environ.get("INKED_COMMISSION_PERCENT", "15"))

def compute_split(amount_php: int) -> dict:
    """Given a peso amount, return commission + artist_net in whole pesos (round half up)."""
    commission = round(amount_php * COMMISSION_PERCENT / 100)
    return {
        "gross": amount_php,
        "commission_pct": COMMISSION_PERCENT,
        "commission": commission,
        "artist_net": amount_php - commission,
    }

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
    is_admin: bool = False


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
    bio_tl: str = ""
    home_service_available: bool = False
    home_service_fee: int = 0
    rate_per_hour: int
    avatar: str
    hero: str
    portfolio: List[str]
    rating: float = 0.0
    reviews_count: int = 0
    active: bool = True
    blocked_dates: List[str] = []  # ISO dates artist is unavailable


class BookingIn(BaseModel):
    artist_id: str
    date: str  # ISO date "YYYY-MM-DD"
    time_slot: str  # "14:00"
    description: str
    reference_image: Optional[str] = None
    estimated_hours: int = 2
    home_service: bool = False
    service_address: Optional[str] = None


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
    home_service: bool = False
    service_address: Optional[str] = None
    service_fee: int = 0
    deposit: int
    status: str  # confirmed | completed | cancelled
    payment_status: str = "unpaid"  # unpaid | paid | refunded
    payment_method: Optional[str] = None
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
    return PublicUser(id=u["id"], email=u["email"], name=u["name"], is_admin=bool(u.get("is_admin", False)))


async def require_admin(user=Depends(current_user)):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    return user


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
        "is_admin": False,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    return AuthOut(access_token=make_token(uid), user=PublicUser(id=uid, email=email, name=body.name.strip(), is_admin=False))


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


@api_router.delete("/auth/me")
async def delete_me(user=Depends(current_user)):
    """Permanently delete the caller's account and personal data (Apple/Play compliance)."""
    uid = user["id"]
    # Cancel all upcoming bookings (soft-cancel; refund reversal not applied since account is going away)
    await db.bookings.update_many({"user_id": uid, "status": {"$ne": "cancelled"}}, {"$set": {"status": "cancelled"}})
    # Delete personal collections
    await db.favorites.delete_many({"user_id": uid})
    await db.messages.delete_many({"from_user_id": uid})
    await db.threads.delete_many({"user_id": uid})
    await db.reviews.delete_many({"user_id": uid})
    # Anonymize booking user_id references so admin history is preserved without PII
    await db.bookings.update_many({"user_id": uid}, {"$set": {"user_id": f"deleted:{uid[:8]}"}})
    # Finally remove the user account
    await db.users.delete_one({"id": uid})
    return {"deleted": True}


# ---------- Artists ----------
@api_router.get("/artists", response_model=List[Artist])
async def list_artists(style: Optional[str] = None, q: Optional[str] = None):
    query: dict = {"$or": [{"active": {"$ne": False}}, {"active": {"$exists": False}}]}
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
    home_service = bool(body.home_service and artist.get("home_service_available"))
    service_fee = artist.get("home_service_fee", 0) if home_service else 0
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
        "home_service": home_service,
        "service_address": (body.service_address or "").strip() if home_service else None,
        "service_fee": service_fee,
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


@api_router.get("/bookings/followups")
async def followups(user=Depends(current_user)):
    """Recent past bookings that need a review — capped at 3."""
    today = datetime.now(timezone.utc).date().isoformat()
    two_weeks_ago = (datetime.now(timezone.utc).date() - timedelta(days=14)).isoformat()
    docs = await db.bookings.find(
        {"user_id": user["id"], "status": {"$ne": "cancelled"}, "date": {"$gte": two_weeks_ago, "$lt": today}},
        {"_id": 0},
    ).sort("date", -1).to_list(20)
    my_reviews = await db.reviews.find({"user_id": user["id"]}, {"_id": 0, "artist_id": 1}).to_list(500)
    reviewed_artist_ids = {r["artist_id"] for r in my_reviews}
    out = []
    for b in docs:
        if b["artist_id"] in reviewed_artist_ids:
            continue
        out.append({
            "booking_id": b["id"],
            "artist_id": b["artist_id"],
            "artist_name": b["artist_name"],
            "artist_avatar": b["artist_avatar"],
            "date": b["date"],
        })
        if len(out) >= 3:
            break
    return out


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
        if pi_id.startswith("pi_mock_") or pi_id.startswith("pi_test_") or (b.get("checkout_session_id") or "").startswith("mock_"):
            # Mock/test refund
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
    if refunded:
        await db.earnings_ledger.update_one(
            {"booking_id": booking_id},
            {"$set": {"status": "refunded", "refunded_at": now_iso()}},
        )
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
    blocked_dates = artist.get("blocked_dates", []) or []
    day_blocked = date in blocked_dates
    return {
        "artist_id": artist_id,
        "date": date,
        "booked_slots": sorted({d["time_slot"] for d in docs}),
        "day_blocked": day_blocked,
        "blocked_dates": blocked_dates,
    }


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
    file_url = f"{PUBLIC_URL}/api/files/{stored_path}" if PUBLIC_URL else f"/api/files/{stored_path}"
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
    payment_method: str = "card"  # "card" | "gcash" | "maya"
    # Optional client-supplied return URL (native apps should pass their deep link, e.g.
    # `Linking.createURL('payment/return')` → `inked://payment/return`). Falls back to PUBLIC_URL.
    return_url: Optional[str] = None


STRIPE_METHOD_MAP = {
    "card": ["card"],
    "gcash": ["gcash"],
    # Maya not natively supported by Stripe — falls back to card + mock label
    "maya": ["card"],
}


def _return_url(client_return: Optional[str], fallback_base: str, query: str) -> str:
    """Build a Stripe return URL. Prefer a client-provided deep link/universal link;
    fall back to the deploy public URL. Ensures native apps can round-trip properly."""
    base = (client_return or "").strip() or (fallback_base.rstrip("/") + "/payment/return" if fallback_base else "/payment/return")
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{query}"


@api_router.post("/payments/checkout-session")
async def create_checkout_session(body: CheckoutIn, user=Depends(current_user)):
    booking = await db.bookings.find_one({"id": body.booking_id, "user_id": user["id"]}, {"_id": 0})
    if not booking:
        raise HTTPException(404, "Booking not found")
    if booking.get("payment_status") == "paid":
        raise HTTPException(409, "Booking is already paid")

    # If Stripe not configured with a real key, use a mock checkout page
    is_placeholder = (not stripe.api_key) or stripe.api_key in ("sk_test_emergent", "")
    frontend_base = PUBLIC_URL
    method = (body.payment_method or "card").lower()
    if method not in STRIPE_METHOD_MAP:
        raise HTTPException(400, "Unsupported payment method")

    if is_placeholder:
        mock_session_id = f"mock_{uuid.uuid4().hex}"
        await db.bookings.update_one(
            {"id": body.booking_id, "payment_status": {"$ne": "paid"}},
            {"$set": {"checkout_session_id": mock_session_id, "payment_status": "unpaid", "payment_method": method}},
        )
        checkout_url = f"{frontend_base}/mock-checkout?session_id={mock_session_id}&booking_id={body.booking_id}&amount={DEPOSIT_AMOUNT_MINOR}&method={method}"
        return {"checkout_url": checkout_url, "session_id": mock_session_id, "mock": True, "payment_method": method}

    success_url = _return_url(body.return_url, frontend_base, "session_id={CHECKOUT_SESSION_ID}")
    cancel_url = _return_url(body.return_url, frontend_base, "cancelled=1")
    try:
        session = await run_in_threadpool(lambda: stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=STRIPE_METHOD_MAP[method],
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
            metadata={"booking_id": body.booking_id, "user_id": user["id"], "payment_method": method},
            payment_intent_data={"metadata": {"booking_id": body.booking_id, "user_id": user["id"], "payment_method": method}},
        ))
    except stripe.error.StripeError as e:
        logger.exception("Stripe error: %s", e)
        raise HTTPException(502, "Unable to create payment session")

    await db.bookings.update_one(
        {"id": body.booking_id, "payment_status": {"$ne": "paid"}},
        {"$set": {"checkout_session_id": session.id, "payment_status": "unpaid", "payment_method": method}},
    )
    return {"checkout_url": session.url, "session_id": session.id, "mock": False, "payment_method": method}


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
    """Called by the mock checkout page to simulate a successful payment (test mode)."""
    booking = await db.bookings.find_one({"checkout_session_id": body.session_id, "user_id": user["id"]}, {"_id": 0})
    if not booking:
        raise HTTPException(404, "Session not found")
    if booking.get("payment_status") == "paid":
        return {"paid": True, "booking_id": booking["id"]}
    total = int(booking.get("deposit", 0)) + int(booking.get("service_fee", 0))
    split = compute_split(total)
    pi_id = f"pi_test_{uuid.uuid4().hex}"
    await db.bookings.update_one(
        {"id": booking["id"], "user_id": user["id"]},
        {"$set": {
            "payment_status": "paid",
            "payment_intent_id": pi_id,
            "paid_at": now_iso(),
            "amount_paid": total,
            "commission_amount": split["commission"],
            "artist_earnings": split["artist_net"],
            "commission_pct": split["commission_pct"],
        }},
    )
    # Create ledger entry (idempotent via booking_id key)
    await db.earnings_ledger.update_one(
        {"booking_id": booking["id"]},
        {"$setOnInsert": {
            "id": str(uuid.uuid4()),
            "booking_id": booking["id"],
            "artist_id": booking["artist_id"],
            "artist_name": booking["artist_name"],
            "user_id": booking["user_id"],
            "gross": total,
            "commission_pct": split["commission_pct"],
            "commission": split["commission"],
            "artist_net": split["artist_net"],
            "payment_intent_id": pi_id,
            "status": "pending_payout",  # pending_payout | paid_out | refunded
            "created_at": now_iso(),
        }},
        upsert=True,
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


# ---------- Admin Dashboard ----------
class AdminArtistIn(BaseModel):
    name: str
    handle: str
    city: str
    studio: str
    address: str = ""
    styles: List[str] = []
    bio: str = ""
    bio_tl: str = ""
    rate_per_hour: int = 10000
    avatar: str = ""
    hero: str = ""
    portfolio: List[str] = []
    home_service_available: bool = False
    home_service_fee: int = 0


class AdminArtistPatch(BaseModel):
    name: Optional[str] = None
    handle: Optional[str] = None
    city: Optional[str] = None
    studio: Optional[str] = None
    address: Optional[str] = None
    styles: Optional[List[str]] = None
    bio: Optional[str] = None
    bio_tl: Optional[str] = None
    rate_per_hour: Optional[int] = None
    avatar: Optional[str] = None
    hero: Optional[str] = None
    portfolio: Optional[List[str]] = None
    home_service_available: Optional[bool] = None
    home_service_fee: Optional[int] = None
    active: Optional[bool] = None
    blocked_dates: Optional[List[str]] = None


class PayoutIn(BaseModel):
    artist_id: str
    note: str = ""


@api_router.get("/admin/stats")
async def admin_stats(_=Depends(require_admin)):
    users_count = await db.users.count_documents({})
    artists_count = await db.artists.count_documents({})
    bookings_total = await db.bookings.count_documents({})
    bookings_paid = await db.bookings.count_documents({"payment_status": "paid"})
    bookings_refunded = await db.bookings.count_documents({"payment_status": "refunded"})
    bookings_cancelled = await db.bookings.count_documents({"status": "cancelled"})

    # Revenue aggregates
    pipeline = [
        {"$match": {"payment_status": "paid"}},
        {"$group": {
            "_id": None,
            "gross": {"$sum": {"$ifNull": ["$amount_paid", "$deposit"]}},
            "commission": {"$sum": {"$ifNull": ["$commission_amount", 0]}},
            "artist_earn": {"$sum": {"$ifNull": ["$artist_earnings", 0]}},
        }},
    ]
    agg = await db.bookings.aggregate(pipeline).to_list(1)
    gross = agg[0]["gross"] if agg else 0
    commission = agg[0]["commission"] if agg else 0
    artist_earn = agg[0]["artist_earn"] if agg else 0

    # Pending payouts (paid but not yet paid_out and not refunded)
    pending_pipeline = [
        {"$match": {"status": "pending_payout"}},
        {"$group": {"_id": None, "total": {"$sum": "$artist_net"}}},
    ]
    p_agg = await db.earnings_ledger.aggregate(pending_pipeline).to_list(1)
    pending_payouts = p_agg[0]["total"] if p_agg else 0

    return {
        "users": users_count,
        "artists": artists_count,
        "bookings": {
            "total": bookings_total,
            "paid": bookings_paid,
            "refunded": bookings_refunded,
            "cancelled": bookings_cancelled,
        },
        "revenue": {
            "gross": gross,
            "commission_earned": commission,
            "artist_earnings": artist_earn,
            "pending_payouts": pending_payouts,
        },
        "commission_pct": COMMISSION_PERCENT,
    }


@api_router.get("/admin/users")
async def admin_list_users(_=Depends(require_admin)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    # Batch bookings count in one aggregation
    counts_agg = await db.bookings.aggregate([
        {"$group": {"_id": "$user_id", "n": {"$sum": 1}}},
    ]).to_list(2000)
    cmap = {c["_id"]: c["n"] for c in counts_agg}
    for u in docs:
        u["bookings_count"] = cmap.get(u["id"], 0)
    return docs


@api_router.post("/admin/users/{user_id}/toggle-admin")
async def admin_toggle_admin(user_id: str, admin=Depends(require_admin)):
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(404, "User not found")
    new_val = not bool(u.get("is_admin", False))
    await db.users.update_one({"id": user_id}, {"$set": {"is_admin": new_val}})
    return {"user_id": user_id, "is_admin": new_val}


@api_router.get("/admin/artists")
async def admin_list_artists(_=Depends(require_admin)):
    docs = await db.artists.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    # Batch ledger + booking aggregates in three grouped queries
    pending_agg = await db.earnings_ledger.aggregate([
        {"$match": {"status": "pending_payout"}},
        {"$group": {"_id": "$artist_id", "total": {"$sum": "$artist_net"}, "count": {"$sum": 1}}},
    ]).to_list(2000)
    paid_agg = await db.earnings_ledger.aggregate([
        {"$match": {"status": "paid_out"}},
        {"$group": {"_id": "$artist_id", "total": {"$sum": "$artist_net"}}},
    ]).to_list(2000)
    bookings_agg = await db.bookings.aggregate([
        {"$group": {"_id": "$artist_id", "n": {"$sum": 1}}},
    ]).to_list(2000)
    pmap = {r["_id"]: r for r in pending_agg}
    pomap = {r["_id"]: r["total"] for r in paid_agg}
    bmap = {r["_id"]: r["n"] for r in bookings_agg}
    for a in docs:
        p = pmap.get(a["id"], {"total": 0, "count": 0})
        a["pending_earnings"] = p["total"]
        a["pending_count"] = p["count"]
        a["paid_out_total"] = pomap.get(a["id"], 0)
        a["bookings_count"] = bmap.get(a["id"], 0)
    return docs


@api_router.post("/admin/artists")
async def admin_create_artist(body: AdminArtistIn, _=Depends(require_admin)):
    aid = str(uuid.uuid4())
    doc = {
        "id": aid,
        "rating": 5.0,
        "reviews_count": 0,
        "lat": 0.0,
        "lon": 0.0,
        "active": True,
        "blocked_dates": [],
        **body.dict(),
    }
    await db.artists.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.patch("/admin/artists/{artist_id}")
async def admin_update_artist(artist_id: str, body: AdminArtistPatch, _=Depends(require_admin)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No changes")
    res = await db.artists.update_one({"id": artist_id}, {"$set": updates})
    if not res.matched_count:
        raise HTTPException(404, "Artist not found")
    doc = await db.artists.find_one({"id": artist_id}, {"_id": 0})
    return doc


@api_router.delete("/admin/artists/{artist_id}")
async def admin_delete_artist(artist_id: str, _=Depends(require_admin)):
    # Soft-delete via active=False; hard delete only if no bookings
    bcount = await db.bookings.count_documents({"artist_id": artist_id})
    if bcount:
        await db.artists.update_one({"id": artist_id}, {"$set": {"active": False}})
        return {"deleted": False, "deactivated": True}
    await db.artists.delete_one({"id": artist_id})
    return {"deleted": True}


@api_router.get("/admin/bookings")
async def admin_list_bookings(status: Optional[str] = None, payment_status: Optional[str] = None, _=Depends(require_admin)):
    q: dict = {}
    if status:
        q["status"] = status
    if payment_status:
        q["payment_status"] = payment_status
    docs = await db.bookings.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Attach user email
    user_ids = list({b["user_id"] for b in docs})
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "email": 1, "name": 1}).to_list(500)
    umap = {u["id"]: u for u in users}
    for b in docs:
        u = umap.get(b["user_id"], {})
        b["user_email"] = u.get("email", "—")
        b["user_name"] = u.get("name", "—")
    return docs


@api_router.post("/admin/bookings/{booking_id}/refund")
async def admin_refund_booking(booking_id: str, _=Depends(require_admin)):
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if b.get("payment_status") != "paid":
        raise HTTPException(409, "Booking is not paid")
    pi_id = b.get("payment_intent_id") or ""
    if pi_id.startswith("pi_mock_") or pi_id.startswith("pi_test_"):
        # Test-mode refund
        pass
    elif pi_id and stripe.api_key and stripe.api_key not in ("sk_test_emergent", ""):
        try:
            await run_in_threadpool(lambda: stripe.Refund.create(payment_intent=pi_id))
        except stripe.error.StripeError as e:
            logger.exception("Refund failed: %s", e)
            raise HTTPException(502, "Refund failed")
    await db.bookings.update_one({"id": booking_id}, {"$set": {
        "payment_status": "refunded",
        "status": "cancelled",
        "refunded_at": now_iso(),
    }})
    await db.earnings_ledger.update_one(
        {"booking_id": booking_id},
        {"$set": {"status": "refunded", "refunded_at": now_iso()}},
    )
    return {"refunded": True, "booking_id": booking_id}


@api_router.get("/admin/payments")
async def admin_payments(_=Depends(require_admin)):
    docs = await db.bookings.find(
        {"payment_status": {"$in": ["paid", "refunded"]}},
        {"_id": 0},
    ).sort("paid_at", -1).to_list(500)
    return docs


@api_router.get("/admin/commissions")
async def admin_commissions(_=Depends(require_admin)):
    # Group per artist
    pipeline = [
        {"$match": {"payment_status": "paid"}},
        {"$group": {
            "_id": "$artist_id",
            "artist_name": {"$first": "$artist_name"},
            "artist_avatar": {"$first": "$artist_avatar"},
            "bookings": {"$sum": 1},
            "gross": {"$sum": {"$ifNull": ["$amount_paid", "$deposit"]}},
            "commission": {"$sum": {"$ifNull": ["$commission_amount", 0]}},
            "artist_net": {"$sum": {"$ifNull": ["$artist_earnings", 0]}},
        }},
        {"$sort": {"gross": -1}},
    ]
    rows = await db.bookings.aggregate(pipeline).to_list(500)
    return [{"artist_id": r["_id"], **{k: v for k, v in r.items() if k != "_id"}} for r in rows]


@api_router.get("/admin/payouts")
async def admin_payouts(_=Depends(require_admin)):
    docs = await db.payouts.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.post("/admin/payouts")
async def admin_create_payout(body: PayoutIn, admin=Depends(require_admin)):
    # Aggregate all pending ledger entries for the artist
    entries = await db.earnings_ledger.find(
        {"artist_id": body.artist_id, "status": "pending_payout"}, {"_id": 0}
    ).to_list(500)
    if not entries:
        raise HTTPException(400, "No pending earnings for this artist")
    total = sum(e.get("artist_net", 0) for e in entries)
    artist = await db.artists.find_one({"id": body.artist_id}, {"_id": 0, "name": 1, "id": 1})
    if not artist:
        raise HTTPException(404, "Artist not found")
    pid = str(uuid.uuid4())
    payout = {
        "id": pid,
        "artist_id": body.artist_id,
        "artist_name": artist["name"],
        "amount": total,
        "count": len(entries),
        "note": body.note.strip(),
        "created_by": admin["id"],
        "created_by_name": admin["name"],
        "created_at": now_iso(),
        "status": "completed",
        "booking_ids": [e["booking_id"] for e in entries],
    }
    await db.payouts.insert_one(payout)
    # Mark ledger entries as paid_out
    await db.earnings_ledger.update_many(
        {"artist_id": body.artist_id, "status": "pending_payout"},
        {"$set": {"status": "paid_out", "payout_id": pid, "paid_out_at": now_iso()}},
    )
    payout.pop("_id", None)
    return payout


@api_router.get("/admin/artists/{artist_id}/earnings")
async def admin_artist_earnings(artist_id: str, _=Depends(require_admin)):
    entries = await db.earnings_ledger.find({"artist_id": artist_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return entries


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


SEED_ARTIST_EXTRAS = {
    "Kai Nakamura": {
        "bio_tl": "Labinlimang taong niperpekto ang sining ng Irezumi. Malalakas na linya, matinding kulay, at kwentong itinatak sa balat.",
        "home_service_available": True,
        "home_service_fee": 4000,
    },
    "Mara Voss": {
        "bio_tl": "Minimalist na single-needle na disenyo. Maliit, tumpak, at personal.",
        "home_service_available": False,
        "home_service_fee": 0,
    },
    "Diego Ruiz": {
        "bio_tl": "Matinding itim, malalim na anino, at hyperrealist na portrait. Dalhin sa akin ang pinakamadidilim mong ideya.",
        "home_service_available": True,
        "home_service_fee": 5500,
    },
    "Yuki Sato": {
        "bio_tl": "Photorealistic na portraiture. Tumpak sa bawat pore.",
        "home_service_available": False,
        "home_service_fee": 0,
    },
    "Ash Rowe": {
        "bio_tl": "Sagradong geometry na nakikipag-ugnay sa negative space. Symmetry ang aking relihiyon.",
        "home_service_available": True,
        "home_service_fee": 3500,
    },
    "Nova Blake": {
        "bio_tl": "American traditional na may modernong ikot. Malalakas na linya, walang pahiwatig.",
        "home_service_available": True,
        "home_service_fee": 4500,
    },
}


@app.on_event("startup")
async def seed_data():
    # Env-driven admin seeding (opt-in). Provide INKED_ADMIN_EMAIL + INKED_ADMIN_PASSWORD
    # in the deployment environment to auto-provision (or promote) an admin on startup.
    admin_email = (os.environ.get("INKED_ADMIN_EMAIL") or "").strip().lower()
    admin_password = os.environ.get("INKED_ADMIN_PASSWORD") or ""
    if admin_email and admin_password:
        existing_admin = await db.users.find_one({"email": admin_email})
        if not existing_admin:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": admin_email,
                "name": os.environ.get("INKED_ADMIN_NAME") or "INKED Admin",
                "password_hash": hash_password(admin_password),
                "is_admin": True,
                "created_at": now_iso(),
            })
            logger.info("Provisioned admin user from environment")
        else:
            # Ensure existing admin has is_admin flag set (idempotent)
            if not existing_admin.get("is_admin"):
                await db.users.update_one({"email": admin_email}, {"$set": {"is_admin": True}})

    # Backfill is_admin=False for existing users
    await db.users.update_many({"is_admin": {"$exists": False}}, {"$set": {"is_admin": False}})

    count = await db.artists.count_documents({})
    if count == 0:
        docs = []
        for a in SEED_ARTISTS:
            loc = STUDIO_LOCATIONS.get(a["studio"], {"address": "", "lat": 0.0, "lon": 0.0})
            extras = SEED_ARTIST_EXTRAS.get(a["name"], {"bio_tl": "", "home_service_available": False, "home_service_fee": 0})
            docs.append({
                "id": str(uuid.uuid4()),
                "rating": round(4.5 + (0.5 * (hash(a["name"]) % 5) / 10), 1),
                "reviews_count": 20 + (hash(a["name"]) % 40),
                "active": True,
                "blocked_dates": [],
                **a,
                **loc,
                **extras,
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
        # Backfill legacy deposits to new PHP deposit
        await db.bookings.update_many({"deposit": {"$lt": 100}}, {"$set": {"deposit": DEPOSIT_AMOUNT_MAJOR}})
        # Backfill bio_tl + home service extras
        async for artist in db.artists.find({"$or": [{"bio_tl": {"$exists": False}}, {"home_service_available": {"$exists": False}}]}, {"_id": 0, "id": 1, "name": 1}):
            ex = SEED_ARTIST_EXTRAS.get(artist.get("name", ""), {"bio_tl": "", "home_service_available": False, "home_service_fee": 0})
            await db.artists.update_one({"id": artist["id"]}, {"$set": ex})
        # Backfill active + blocked_dates
        await db.artists.update_many({"active": {"$exists": False}}, {"$set": {"active": True}})
        await db.artists.update_many({"blocked_dates": {"$exists": False}}, {"$set": {"blocked_dates": []}})

    # Backfill commission/earnings + ledger for existing paid bookings (idempotent)
    async for b in db.bookings.find({"payment_status": "paid", "commission_amount": {"$exists": False}}, {"_id": 0}):
        total = int(b.get("deposit", 0)) + int(b.get("service_fee", 0) or 0)
        split = compute_split(total)
        await db.bookings.update_one(
            {"id": b["id"]},
            {"$set": {
                "amount_paid": total,
                "commission_amount": split["commission"],
                "artist_earnings": split["artist_net"],
                "commission_pct": split["commission_pct"],
            }},
        )
        # Ledger status: refunded if booking cancelled+refunded, else pending_payout
        status = "refunded" if b.get("payment_status") == "refunded" else "pending_payout"
        await db.earnings_ledger.update_one(
            {"booking_id": b["id"]},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "booking_id": b["id"],
                "artist_id": b["artist_id"],
                "artist_name": b["artist_name"],
                "user_id": b["user_id"],
                "gross": total,
                "commission_pct": split["commission_pct"],
                "commission": split["commission"],
                "artist_net": split["artist_net"],
                "payment_intent_id": b.get("payment_intent_id"),
                "status": status,
                "created_at": b.get("paid_at") or b.get("created_at") or now_iso(),
            }},
            upsert=True,
        )


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
