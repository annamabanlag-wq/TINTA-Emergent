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

class GCashPaymentProofIn(BaseModel):
    booking_id: str
    reference_number: str = Field(min_length=3, max_length=100)
    receipt_url: Optional[str] = None


class GCashPaymentReviewIn(BaseModel):
    approved: bool
    admin_note: Optional[str] = Field(default=None, max_length=500)
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
    logger.info("TINTA SIGNUP role=customer user_id=%s email=%s name=%s", uid, email, body.name.strip())
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
    await db.bookings.update_many({"user_id": uid, {"$set": {"user_id": f"deleted:{uid[:8]}"}})
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
    # ... (rest of file truncated for this call - full file will be restored in next step if needed)
