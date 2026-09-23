"""Expose a single admin view of every TINTA registration.

Artists can exist as accounts before they finish the separate verification
application. Customers do not have an application document at all. This
endpoint combines both sources so the admin can see every new registration
immediately and the artist application status when one exists.
"""

from fastapi import Depends


def install(module):
    app = module.app
    db = module.db
    require_admin = module.require_admin

    if any(getattr(r, "path", None) == "/api/admin/registrations" for r in app.routes):
        return

    async def admin_registrations(_=Depends(require_admin)):
        users = await db.users.find(
            {},
            {
                "_id": 0,
                "password_hash": 0,
                "email_verification_code": 0,
                "email_verification_expires_at": 0,
            },
        ).sort("created_at", -1).to_list(1000)

        applications = await db.artist_applications.find(
            {},
            {
                "_id": 0,
                "id": 1,
                "user_id": 1,
                "status": 1,
                "submitted_at": 1,
                "reviewed_at": 1,
                "artist_id": 1,
            },
        ).sort("submitted_at", -1).to_list(1000)

        latest_application = {}
        for application in applications:
            uid = str(application.get("user_id") or "")
            if uid and uid not in latest_application:
                latest_application[uid] = application

        artists = await db.artists.find(
            {},
            {"_id": 0, "id": 1, "artist_user_id": 1, "user_id": 1},
        ).to_list(1000)
        artist_by_user = {}
        for artist in artists:
            uid = str(artist.get("artist_user_id") or artist.get("user_id") or "")
            if uid:
                artist_by_user[uid] = artist.get("id")

        rows = []
        for user in users:
            uid = str(user.get("id") or "")
            role = str(user.get("role") or "").lower()
            if role not in {"artist", "customer"}:
                role = "artist" if user.get("artist_portal") else "customer"

            application = latest_application.get(uid) if role == "artist" else None
            if role == "artist":
                application_status = str((application or {}).get("status") or "account_created")
            else:
                application_status = "registered"

            rows.append(
                {
                    "id": uid,
                    "email": user.get("email", ""),
                    "name": user.get("name", ""),
                    "role": role,
                    "status": application_status,
                    "created_at": user.get("created_at", ""),
                    "email_verified": bool(user.get("email_verified", False)),
                    "artist_application_id": (application or {}).get("id"),
                    "artist_id": (application or {}).get("artist_id") or artist_by_user.get(uid),
                    "application_submitted_at": (application or {}).get("submitted_at"),
                    "application_reviewed_at": (application or {}).get("reviewed_at"),
                }
            )

        return rows

    app.add_api_route("/api/admin/registrations", admin_registrations, methods=["GET"])
