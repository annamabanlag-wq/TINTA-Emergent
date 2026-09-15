from fastapi import Depends


def install(server):
    app = server.app
    db = server.db
    current_user = server.current_user

    async def resolve_artist_user_id(record):
        uid = record.get("artist_user_id") or record.get("user_id")
        if uid:
            return uid
        aid = record.get("id") or record.get("artist_id")
        if aid:
            approved = await db.artist_applications.find_one(
                {"artist_id": aid, "status": {"$regex": "^approved$", "$options": "i"}},
                {"_id": 0, "user_id": 1},
            )
            if approved and approved.get("user_id"):
                return approved["user_id"]
        email = str(record.get("email") or "").strip().lower()
        if email:
            owner = await db.users.find_one({"email": email, "is_admin": {"$ne": True}}, {"_id": 0, "id": 1})
            if owner:
                return owner.get("id")
        name = str(record.get("name") or "").strip()
        if name:
            owner = await db.users.find_one({"name": {"$regex": "^" + __import__("re").escape(name) + "$", "$options": "i"}, "is_admin": {"$ne": True}}, {"_id": 0, "id": 1})
            if owner:
                return owner.get("id")
        return None

    async def customer_contacts(user=Depends(current_user)):
        me_id = user["id"]
        out = [{"id": "bot", "name": "TINTA AI", "role": "bot", "avatar": "", "conversation_id": f"bot:{me_id}"}]

        admins = await db.users.find({"is_admin": True}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
        seen = set()
        for a in admins:
            aid = a.get("id")
            if aid and aid != me_id and aid not in seen:
                seen.add(aid)
                out.append({"id": aid, "name": a.get("name") or "TINTA Admin", "role": "admin", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me_id, aid]))}"})

        raw = await db.artists.find(
            {"active": {"$ne": False}},
            {"_id": 0, "id": 1, "artist_user_id": 1, "user_id": 1, "email": 1, "name": 1, "avatar": 1},
        ).to_list(500)
        approved = await db.artist_applications.find(
            {"status": {"$regex": "^approved$", "$options": "i"}},
            {"_id": 0, "artist_id": 1, "user_id": 1, "email": 1, "name": 1, "avatar": 1},
        ).to_list(500)

        records = [*raw, *approved]
        seen_users = set()
        for artist in records:
            uid = await resolve_artist_user_id(artist)
            if not uid or uid == me_id or uid in seen_users:
                continue
            seen_users.add(uid)
            public_id = artist.get("id") or artist.get("artist_id") or uid
            out.append({
                "id": public_id,
                "name": artist.get("name") or "Artist",
                "role": "artist",
                "avatar": artist.get("avatar") or "",
                "conversation_id": f"dm:{':'.join(sorted([me_id, uid]))}",
            })
        return out

    app.add_api_route("/api/chat/customer-contacts", customer_contacts, methods=["GET"])
