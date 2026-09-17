from fastapi import HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid


def install(server):
    app = server.app
    db = server.db
    current_user = server.current_user
    require_admin = server.require_admin
    now_iso = server.now_iso

    class ArtistApplicationIn(BaseModel):
        name: str = Field(min_length=2, max_length=80)
        handle: str = Field(min_length=2, max_length=80)
        city: str = Field(min_length=2, max_length=100)
        studio: str = Field(min_length=2, max_length=120)
        address: str = ""
        styles: List[str] = Field(default_factory=list, max_length=20)
        bio: str = Field(min_length=10, max_length=1000)
        bio_tl: str = ""
        rate_per_hour: int = Field(ge=1, le=1000000)
        avatar: str = ""
        hero: str = ""
        portfolio: List[str] = Field(default_factory=list, max_length=30)
        government_id_path: str = Field(min_length=1, max_length=500)
        completed_work_paths: List[str] = Field(min_length=1, max_length=12)
        home_service_available: bool = False
        home_service_fee: int = Field(default=0, ge=0, le=1000000)
        phone: str = ""
        service_area: str = ""

    class ArtistApplicationReviewIn(BaseModel):
        approved: bool
        admin_note: Optional[str] = Field(default=None, max_length=500)

    async def _validate_evidence(application: dict):
        """Re-check evidence at review time so stale/tampered upload paths cannot be approved."""
        user_id = application.get("user_id")
        government_id = str(application.get("government_id_path") or "").strip()
        completed_work = [str(p).strip() for p in (application.get("completed_work_paths") or []) if str(p).strip()]
        if not government_id:
            raise HTTPException(422, "Government ID is required")
        if not completed_work:
            raise HTTPException(422, "At least one finished tattoo work photo is required")

        government_meta = await db.uploads.find_one(
            {"path": government_id}, {"_id": 0, "owner_id": 1, "content_type": 1}
        )
        if not government_meta or government_meta.get("owner_id") != user_id:
            raise HTTPException(403, "Government ID upload does not belong to the applicant")
        if not (government_meta.get("content_type") or "").startswith("image/"):
            raise HTTPException(422, "Government ID must be an image")

        for path in completed_work:
            meta = await db.uploads.find_one(
                {"path": path}, {"_id": 0, "owner_id": 1, "content_type": 1}
            )
            if not meta or meta.get("owner_id") != user_id:
                raise HTTPException(403, "Finished tattoo work upload does not belong to the applicant")
            if not (meta.get("content_type") or "").startswith("image/"):
                raise HTTPException(422, "Finished tattoo work must be an image")

        return government_id, completed_work

    async def apply(body: ArtistApplicationIn, user=__import__('fastapi').Depends(current_user)):
        existing = await db.artist_applications.find_one({"user_id": user["id"], "status": "pending"}, {"_id": 0})
        if existing:
            return existing
        approved = await db.artist_applications.find_one({"user_id": user["id"], "status": "approved"}, {"_id": 0})
        if approved:
            raise HTTPException(409, "Artist application already approved")

        # These are identity-verification documents, so only TINTA's own
        # authenticated upload paths are accepted. The upload endpoint records
        # the owner and content type; we verify both before saving the application.
        government_id, completed_work = await _validate_evidence({
            "user_id": user["id"],
            "government_id_path": body.government_id_path,
            "completed_work_paths": body.completed_work_paths,
        })

        app_id = str(uuid.uuid4())
        doc = body.model_dump() if hasattr(body, "model_dump") else body.dict()
        doc["government_id_path"] = government_id
        doc["completed_work_paths"] = completed_work
        doc.update({"id": app_id, "user_id": user["id"], "email": user["email"], "status": "pending", "admin_note": None, "submitted_at": now_iso(), "reviewed_at": None})
        await db.artist_applications.insert_one(doc)
        return doc

    async def my_application(user=__import__('fastapi').Depends(current_user)):
        doc = await db.artist_applications.find_one({"user_id": user["id"]}, {"_id": 0}, sort=[("submitted_at", -1)])
        return doc or {"status": "not_started"}

    async def admin_list(_=__import__('fastapi').Depends(require_admin)):
        return await db.artist_applications.find({}, {"_id": 0}).sort("submitted_at", -1).to_list(500)

    async def review(application_id: str, body: ArtistApplicationReviewIn, _=__import__('fastapi').Depends(require_admin)):
        application = await db.artist_applications.find_one({"id": application_id}, {"_id": 0})
        if not application:
            raise HTTPException(404, "Artist application not found")
        if application.get("status") == "approved" and body.approved:
            return {"reviewed": True, "approved": True, "artist_id": application.get("artist_id")}
        if not body.approved:
            await db.artist_applications.update_one({"id": application_id}, {"$set": {"status": "rejected", "admin_note": body.admin_note, "reviewed_at": now_iso()}})
            return {"reviewed": True, "approved": False, "application_id": application_id}

        # Never publish an artist if the required verification evidence is missing
        # or no longer belongs to the applicant at review time.
        government_id, completed_work = await _validate_evidence(application)

        artist_id = application.get("artist_id") or str(uuid.uuid4())
        artist = {
            "id": artist_id,
            "name": application["name"], "handle": application["handle"], "city": application["city"], "studio": application["studio"],
            "address": application.get("address", ""), "lat": 0.0, "lon": 0.0, "styles": application.get("styles", []),
            "bio": application.get("bio", ""), "bio_tl": application.get("bio_tl", ""),
            "home_service_available": bool(application.get("home_service_available", False)), "home_service_fee": int(application.get("home_service_fee", 0)),
            "rate_per_hour": int(application.get("rate_per_hour", 0)), "avatar": application.get("avatar", ""), "hero": application.get("hero", ""),
            "portfolio": application.get("portfolio", []) + completed_work, "rating": 5.0, "reviews_count": 0, "active": True, "blocked_dates": [],
            "artist_user_id": application["user_id"], "phone": application.get("phone", ""), "service_area": application.get("service_area", ""),
        }
        existing_artist = await db.artists.find_one({"artist_user_id": application["user_id"]}, {"_id": 0})
        if existing_artist:
            artist_id = existing_artist["id"]
            artist["id"] = artist_id
            await db.artists.update_one({"id": artist_id}, {"$set": artist})
        else:
            await db.artists.insert_one(artist)

        # Admin approval is the artist identity/publishing verification step.
        await db.users.update_one(
            {"id": application["user_id"], "is_admin": {"$ne": True}},
            {"$set": {"artist_portal": True, "role": "artist", "artist_identity_verified": True}},
        )
        await db.artist_applications.update_one({"id": application_id}, {"$set": {"status": "approved", "artist_id": artist_id, "admin_note": body.admin_note, "reviewed_at": now_iso()}})
        return {"reviewed": True, "approved": True, "application_id": application_id, "artist_id": artist_id}

    app.add_api_route("/api/artist-applications", apply, methods=["POST"])
    app.add_api_route("/api/artist-applications/me", my_application, methods=["GET"])
    app.add_api_route("/api/admin/artist-applications", admin_list, methods=["GET"])
    app.add_api_route("/api/admin/artist-applications/{application_id}/review", review, methods=["POST"])
