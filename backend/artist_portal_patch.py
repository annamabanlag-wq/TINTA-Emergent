from fastapi import HTTPException, Depends, Response
from pydantic import BaseModel, Field
from typing import List, Optional


def install(server):
    app = server.app
    db = server.db
    current_user = server.current_user
    now_iso = server.now_iso
    get_object = server.get_object

    async def get_artist(user):
        artist = await db.artists.find_one({"artist_user_id": user["id"]}, {"_id": 0})
        if not artist or artist.get("active") is False:
            raise HTTPException(403, "Artist account is not active")
        return artist

    class AvailabilityIn(BaseModel):
        blocked_dates: List[str] = Field(default_factory=list, max_length=366)

    class ProfileIn(BaseModel):
        name: Optional[str] = Field(default=None, max_length=120)
        handle: Optional[str] = Field(default=None, max_length=80)
        city: Optional[str] = Field(default=None, max_length=120)
        studio: Optional[str] = Field(default=None, max_length=160)
        styles: Optional[List[str]] = Field(default=None, max_length=30)
        bio: Optional[str] = Field(default=None, max_length=2000)
        rate_per_hour: Optional[int] = Field(default=None, ge=0, le=1000000)
        phone: Optional[str] = Field(default=None, max_length=40)
        service_area: Optional[str] = Field(default=None, max_length=200)
        avatar: Optional[str] = Field(default=None, max_length=2000)
        hero: Optional[str] = Field(default=None, max_length=2000)
        portfolio: Optional[List[str]] = Field(default=None, max_length=30)

    async def artist_me(user=Depends(current_user)):
        artist = await get_artist(user)
        pending = await db.earnings_ledger.aggregate([
            {"$match": {"artist_id": artist["id"], "status": "pending_payout"}},
            {"$group": {"_id": None, "total": {"$sum": "$artist_earnings"}, "count": {"$sum": 1}}},
        ]).to_list(1)
        paid = await db.earnings_ledger.aggregate([
            {"$match": {"artist_id": artist["id"], "status": "paid_out"}},
            {"$group": {"_id": None, "total": {"$sum": "$artist_earnings"}, "count": {"$sum": 1}}},
        ]).to_list(1)
        return {
            "artist": artist,
            "pending_earnings": (pending[0]["total"] if pending else 0),
            "pending_count": (pending[0]["count"] if pending else 0),
            "paid_out": (paid[0]["total"] if paid else 0),
            "paid_count": (paid[0]["count"] if paid else 0),
        }

    async def artist_bookings(user=Depends(current_user)):
        artist = await get_artist(user)
        docs = await db.bookings.find({"artist_id": artist["id"]}, {"_id": 0}).sort([("date", 1), ("time_slot", 1)]).to_list(200)
        out = []
        for b in docs:
            customer = await db.users.find_one({"id": b.get("user_id")}, {"_id": 0, "name": 1, "email": 1})
            out.append({
                **b,
                "customer_name": (customer or {}).get("name", "Customer"),
                "customer_email": (customer or {}).get("email", ""),
            })
        return out

    async def artist_earnings(user=Depends(current_user)):
        artist = await get_artist(user)
        rows = await db.earnings_ledger.find({"artist_id": artist["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
        pending = sum(int(r.get("artist_earnings", r.get("amount", 0)) or 0) for r in rows if r.get("status") == "pending_payout")
        paid = sum(int(r.get("artist_earnings", r.get("amount", 0)) or 0) for r in rows if r.get("status") == "paid_out")
        refunded = sum(int(r.get("artist_earnings", r.get("amount", 0)) or 0) for r in rows if r.get("status") == "refunded")
        return {"pending_earnings": pending, "paid_out": paid, "refunded": refunded, "entries": rows}

    async def update_availability(body: AvailabilityIn, user=Depends(current_user)):
        artist = await get_artist(user)
        clean = sorted(set(d.strip() for d in body.blocked_dates if d and len(d.strip()) == 10))
        await db.artists.update_one({"id": artist["id"]}, {"$set": {"blocked_dates": clean, "updated_at": now_iso()}})
        return {"blocked_dates": clean}

    async def update_profile(body: ProfileIn, user=Depends(current_user)):
        artist = await get_artist(user)
        updates = body.model_dump(exclude_none=True) if hasattr(body, "model_dump") else body.dict(exclude_none=True)
        if "name" in updates:
            updates["name"] = updates["name"].strip()
        if "handle" in updates:
            updates["handle"] = updates["handle"].strip().lstrip("@").lower()
        for key in ("city", "studio", "bio", "phone", "service_area", "avatar", "hero"):
            if key in updates and isinstance(updates[key], str):
                updates[key] = updates[key].strip()
        if "styles" in updates:
            updates["styles"] = sorted(set(x.strip() for x in updates["styles"] if isinstance(x, str) and x.strip()))
        if "portfolio" in updates:
            updates["portfolio"] = [x.strip() for x in updates["portfolio"] if isinstance(x, str) and x.strip()]
        if not updates.get("name") or not updates.get("handle") or not updates.get("city") or not updates.get("studio"):
            raise HTTPException(400, "Name, handle, city, and studio are required")
        if "bio" in updates and len(updates["bio"]) < 10:
            raise HTTPException(400, "Bio must be at least 10 characters")
        if "handle" in updates:
            conflict = await db.artists.find_one({"handle": updates["handle"], "id": {"$ne": artist["id"]}}, {"_id": 0, "id": 1})
            if conflict:
                raise HTTPException(409, "That artist handle is already in use")
        updates["updated_at"] = now_iso()
        await db.artists.update_one({"id": artist["id"]}, {"$set": updates})
        return await db.artists.find_one({"id": artist["id"]}, {"_id": 0})

    async def public_artist_portfolio(path: str):
        if not path or path.startswith("/") or ".." in path:
            raise HTTPException(404, "Portfolio image not found")
        marker = f"/api/artist/portfolio/{path}"
        artist = await db.artists.find_one(
            {"active": {"$ne": False}, "portfolio": marker},
            {"_id": 0, "id": 1},
        )
        if not artist:
            raise HTTPException(404, "Portfolio image not found")
        try:
            data, content_type = get_object(path)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(404, "Portfolio image not found")
        return Response(
            content=data,
            media_type=content_type or "image/jpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    app.add_api_route("/api/artist/me", artist_me, methods=["GET"])
    app.add_api_route("/api/artist/bookings", artist_bookings, methods=["GET"])
    app.add_api_route("/api/artist/earnings", artist_earnings, methods=["GET"])
    app.add_api_route("/api/artist/availability", update_availability, methods=["PATCH"])
    app.add_api_route("/api/artist/profile", update_profile, methods=["PATCH"])
    app.add_api_route("/api/artist/portfolio/{path:path}", public_artist_portfolio, methods=["GET"])
