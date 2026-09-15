"""Guards the existing booking endpoint against invalid and overlapping bookings."""
from datetime import datetime, timezone
from functools import wraps
from fastapi import HTTPException


def _start(date, slot):
    try:
        return datetime.fromisoformat(f"{date}T{slot}:00+00:00")
    except Exception:
        return None


def _hours(value):
    try:
        return float(value)
    except Exception:
        return None


def install(module):
    router = getattr(module, "api_router", None)
    db = getattr(module, "db", None)
    if not router or db is None:
        return
    for route in router.routes:
        if getattr(route, "path", None) != "/bookings" or "POST" not in getattr(route, "methods", set()):
            continue
        original = getattr(route, "endpoint", None)
        if not original or getattr(original, "_tinta_booking_guard", False):
            return

        @wraps(original)
        async def guarded(body, user, _original=original):
            artist = await db.artists.find_one({"id": body.artist_id}, {"_id": 0})
            if not artist:
                raise HTTPException(404, "Artist not found")
            try:
                day = datetime.strptime(body.date, "%Y-%m-%d").date()
            except Exception:
                raise HTTPException(400, "Invalid booking date")
            if day < datetime.now(timezone.utc).date():
                raise HTTPException(400, "Booking date cannot be in the past")
            if body.date in (artist.get("blocked_dates") or []):
                raise HTTPException(409, "Artist is unavailable on this date")
            start = _start(body.date, body.time_slot)
            hours = _hours(body.estimated_hours)
            if start is None or hours is None or hours <= 0:
                raise HTTPException(400, "Invalid booking time or duration")
            existing = await db.bookings.find(
                {"artist_id": body.artist_id, "date": body.date, "status": {"$ne": "cancelled"}},
                {"_id": 0, "time_slot": 1, "estimated_hours": 1},
            ).to_list(200)
            end_ts = start.timestamp() + hours * 3600
            for item in existing:
                other = _start(body.date, item.get("time_slot", ""))
                other_hours = _hours(item.get("estimated_hours", 1)) or 1
                if other:
                    other_end = other.timestamp() + other_hours * 3600
                    if start.timestamp() < other_end and other.timestamp() < end_ts:
                        raise HTTPException(409, "That time overlaps an existing booking")
            return await _original(body, user)

        guarded._tinta_booking_guard = True
        route.endpoint = guarded
        try:
            route.dependant.call = guarded
        except Exception:
            pass
        return
