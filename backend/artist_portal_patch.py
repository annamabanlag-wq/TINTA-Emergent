from fastapi import HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional


def install(server):
    app = server.app
    db = server.db
    current_user = server.current_user
    now_iso = server.now_iso

    async def get_artist(user):
        artist = await db.artists.find_one({"artist_user_id": user["id"]}, {"_id": 0})
        if not artist or artist.get("active") is False:
            raise HTTPException(403, "Artist account is not active")
        return artist

    class AvailabilityIn(BaseModel):
        blocked_dates: List[str] = Field(default_factory=list, max_length=366)

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

    app.add_api_route("/api/artist/me", artist_me, methods=["GET"])
    app.add_api_route("/api/artist/bookings", artist_bookings, methods=["GET"])
    app.add_api_route("/api/artist/earnings", artist_earnings, methods=["GET"])
    app.add_api_route("/api/artist/availability", update_availability, methods=["PATCH"])
