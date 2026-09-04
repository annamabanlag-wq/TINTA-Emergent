from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, status
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ.get("JWT_SECRET", "inked-dev-secret-change-me")
JWT_ALG = "HS256"
JWT_MINUTES = 60 * 24 * 7  # 7 days

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
    deposit = 50  # flat deposit in USD
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
    await db.bookings.update_one({"id": booking_id}, {"$set": {"status": "cancelled"}})
    b["status"] = "cancelled"
    return b


# ---------- Reviews ----------
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


# ---------- Seed ----------
SEED_ARTISTS = [
    {
        "name": "Kai Nakamura",
        "handle": "@kai.ink",
        "city": "Brooklyn, NY",
        "studio": "Black Iron Tattoo",
        "styles": ["Japanese", "Traditional", "Neo-Traditional"],
        "bio": "Fifteen years perfecting the craft of Irezumi. Bold lines, saturated color, and stories carved into skin.",
        "rate_per_hour": 220,
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
        "rate_per_hour": 180,
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
        "rate_per_hour": 250,
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
        "rate_per_hour": 300,
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
        "rate_per_hour": 200,
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
        "rate_per_hour": 190,
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


@app.on_event("startup")
async def seed_data():
    count = await db.artists.count_documents({})
    if count == 0:
        docs = []
        for a in SEED_ARTISTS:
            docs.append({
                "id": str(uuid.uuid4()),
                "rating": round(4.5 + (0.5 * (hash(a["name"]) % 5) / 10), 1),
                "reviews_count": 20 + (hash(a["name"]) % 40),
                **a,
            })
        await db.artists.insert_many(docs)
        logger.info(f"Seeded {len(docs)} artists")


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
