from fastapi import Depends


def install(server):
    app = server.app
    db = server.db
    current_user = server.current_user

    async def is_artist_user(user_id):
        if not user_id:
            return False
        owner = await db.users.find_one(
            {"id": user_id, "is_admin": {"$ne": True}},
            {"_id": 0, "id": 1, "artist_portal": 1, "role": 1},
        )
        if not owner:
            return False
        return bool(owner.get("artist_portal") or str(owner.get("role") or "").lower() == "artist")

    async def mark_artist_user(user_id):
        if not user_id:
            return False
        owner = await db.users.find_one({"id": user_id, "is_admin": {"$ne": True}}, {"_id": 0, "id": 1})
        if not owner:
            return False
        await db.users.update_one(
            {"id": user_id, "is_admin": {"$ne": True}},
            {"$set": {"artist_portal": True, "role": "artist"}},
        )
        return True

    async def resolve_artist_user_id(artist):
        candidates = [artist.get("artist_user_id"), artist.get("user_id")]
        email = str(artist.get("email") or "").strip().lower()
        if email:
            owner = await db.users.find_one({"email": email, "is_admin": {"$ne": True}}, {"_id": 0, "id": 1})
            if owner:
                candidates.append(owner.get("id"))
        name = str(artist.get("name") or "").strip()
        if name:
            owner = await db.users.find_one(
                {"name": {"$regex": "^" + __import__("re").escape(name) + "$", "$options": "i"}, "is_admin": {"$ne": True}},
                {"_id": 0, "id": 1},
            )
            if owner:
                candidates.append(owner.get("id"))
        artist_id = artist.get("id") or artist.get("artist_id")
        if artist_id:
            application = await db.artist_applications.find_one(
                {"artist_id": artist_id, "status": {"$regex": "^approved$", "$options": "i"}},
                {"_id": 0, "user_id": 1},
            )
            if application and application.get("user_id"):
                candidates.insert(0, application["user_id"])
        for uid in candidates:
            if await is_artist_user(uid):
                return uid
        for uid in candidates:
            if await mark_artist_user(uid):
                return uid
        return None

    async def contacts(user=Depends(current_user)):
        me_id = user["id"]
        is_admin = bool(user.get("is_admin"))
        me_artist = await db.artists.find_one({"artist_user_id": me_id, "active": {"$ne": False}}, {"_id": 0, "id": 1})
        me_is_artist = bool(me_artist) and await is_artist_user(me_id)
        role = "admin" if is_admin else ("artist" if me_is_artist else "customer")

        out = [{"id": "bot", "name": "TINTA AI", "role": "bot", "avatar": "", "conversation_id": f"bot:{me_id}"}]

        if role != "admin":
            admins = await db.users.find({"is_admin": True}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
            for a in admins:
                aid = a.get("id")
                if aid and aid != me_id:
                    out.append({"id": aid, "name": a.get("name") or "TINTA Admin", "role": "admin", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me_id, aid]))}"})

        if role in ("customer", "admin"):
            artists = await db.artists.find(
                {"active": {"$ne": False}},
                {"_id": 0, "id": 1, "artist_user_id": 1, "user_id": 1, "email": 1, "name": 1, "avatar": 1},
            ).to_list(500)
            approved = await db.artist_applications.find(
                {"status": {"$regex": "^approved$", "$options": "i"}},
                {"_id": 0, "artist_id": 1, "user_id": 1, "email": 1, "name": 1, "avatar": 1},
            ).to_list(500)
            records = []
            seen_users = set()
            seen_artist_ids = set()
            for source in [*artists, *approved]:
                uid = await resolve_artist_user_id(source)
                if not uid or uid == me_id or uid in seen_users:
                    continue
                aid = source.get("id") or source.get("artist_id") or uid
                if aid in seen_artist_ids:
                    continue
                seen_users.add(uid)
                seen_artist_ids.add(aid)
                records.append({"id": aid, "artist_user_id": uid, "name": source.get("name") or "Artist", "avatar": source.get("avatar") or ""})
            for a in records:
                out.append({"id": a["id"], "name": a["name"], "role": "artist", "avatar": a["avatar"], "conversation_id": f"dm:{':'.join(sorted([me_id, a['artist_user_id']]))}"})

        if role == "artist":
            customers = await db.users.find(
                {"is_admin": {"$ne": True}, "$or": [{"artist_portal": {"$ne": True}}, {"role": {"$nin": ["artist", "ARTIST"]}}]},
                {"_id": 0, "id": 1, "name": 1},
            ).to_list(500)
            for c in customers:
                cid = c.get("id")
                if cid and cid != me_id:
                    out.append({"id": cid, "name": c.get("name") or "Customer", "role": "customer", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me_id, cid]))}"})

        if role == "admin":
            customers = await db.users.find({"is_admin": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
            for c in customers:
                cid = c.get("id")
                if cid and cid != me_id:
                    out.append({"id": cid, "name": c.get("name") or "Customer", "role": "customer", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me_id, cid]))}"})

        deduped = []
        seen = set()
        for item in out:
            if item["conversation_id"] not in seen:
                seen.add(item["conversation_id"])
                deduped.append(item)
        print(f"TINTA FORCE CONTACTS: role={role} total={len(deduped)} artists={[x['name'] for x in deduped if x.get('role') == 'artist']}")
        return deduped

    app.routes[:] = [r for r in app.routes if not (getattr(r, "path", None) == "/api/chat/contacts" and "GET" in getattr(r, "methods", set()))]
    app.add_api_route("/api/chat/contacts", contacts, methods=["GET"])
