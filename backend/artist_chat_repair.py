from datetime import datetime, timezone
import re
import uuid


def install(server):
    db = server.db
    hash_password = server.hash_password

    @server.app.on_event("startup")
    async def repair_artist_chat_links():
        repaired = 0
        created = 0
        unresolved = []
        total = 0

        async for artist in db.artists.find(
            {"active": {"$ne": False}},
            {"_id": 0, "id": 1, "name": 1, "handle": 1, "email": 1, "artist_user_id": 1, "user_id": 1},
        ):
            total += 1
            uid = artist.get("artist_user_id") or artist.get("user_id")

            if uid:
                owner = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1})
                if owner:
                    continue
                uid = None

            email = str(artist.get("email") or "").strip().lower()
            if email:
                owner = await db.users.find_one({"email": email}, {"_id": 0, "id": 1})
                uid = (owner or {}).get("id")

            name = str(artist.get("name") or "").strip()
            if not uid and name:
                owner = await db.users.find_one(
                    {"name": {"$regex": "^" + re.escape(name) + "$", "$options": "i"}, "is_admin": {"$ne": True}},
                    {"_id": 0, "id": 1},
                )
                uid = (owner or {}).get("id")

            handle = str(artist.get("handle") or "").strip().lstrip("@").lower()
            if not uid and handle:
                owner = await db.users.find_one(
                    {"$or": [{"handle": handle}, {"username": handle}], "is_admin": {"$ne": True}},
                    {"_id": 0, "id": 1},
                )
                uid = (owner or {}).get("id")

            if not uid:
                # Built-in TINTA seed artists were created before artist portal
                # identities existed. Create a real internal account for each one.
                safe_handle = re.sub(r"[^a-z0-9]+", ".", handle or name.lower()).strip(".") or "artist"
                portal_email = f"{safe_handle}@artists.tinta.app"
                owner = await db.users.find_one({"email": portal_email}, {"_id": 0, "id": 1})
                if owner:
                    uid = owner["id"]
                else:
                    uid = str(uuid.uuid4())
                    bootstrap_password = f"TINTA-Artist-{safe_handle}-2026!"
                    await db.users.insert_one({
                        "id": uid,
                        "email": portal_email,
                        "name": name or "Artist",
                        "password_hash": hash_password(bootstrap_password),
                        "is_admin": False,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "artist_portal": True,
                        "bootstrap_account": True,
                    })
                    created += 1

            await db.artists.update_one(
                {"id": artist["id"]},
                {"$set": {"artist_user_id": uid}},
            )
            repaired += 1

        print(f"TINTA artist chat repair: total={total} repaired={repaired} created={created} unresolved={len(unresolved)} names={unresolved[:20]}")
