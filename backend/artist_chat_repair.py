from datetime import datetime, timezone


def install(server):
    app = server.app
    db = server.db

    @app.on_event("startup")
    async def repair_artist_chat_links():
        repaired = 0
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
                    {"name": {"$regex": "^" + __import__("re").escape(name) + "$", "$options": "i"}, "is_admin": {"$ne": True}},
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

            if uid:
                await db.artists.update_one({"id": artist["id"]}, {"$set": {"artist_user_id": uid}})
                repaired += 1
            else:
                unresolved.append(artist.get("name") or artist.get("id") or "unknown")

        print(f"TINTA artist chat repair: total={total} repaired={repaired} unresolved={len(unresolved)} names={unresolved[:20]}")
