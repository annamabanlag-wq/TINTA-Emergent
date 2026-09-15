from fastapi import Depends


def install(server):
    app = server.app
    db = server.db
    current_user = server.current_user

    async def is_artist_user(user_id):
        """Only treat a user as an artist when the linked account is explicitly an artist account."""
        if not user_id:
            return False
        owner = await db.users.find_one(
            {"id": user_id, "is_admin": {"$ne": True}},
            {"_id": 0, "id": 1, "artist_portal": 1, "role": 1},
        )
        if not owner:
            return False
        return bool(owner.get("artist_portal") or str(owner.get("role") or "").lower() == "artist")

    async def resolve_artist_user_id(artist):
        """Resolve an artist record to a real artist-portal user."""
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
        for uid in candidates:
            if await is_artist_user(uid):
                return uid
        return None

    async def contacts(user=Depends(current_user)):
        me_id = user["id"]
        is_admin = bool(user.get("is_admin"))

        # Do not infer an ordinary customer as an artist merely because an old
        # artist record happens to contain their user id. Artist portal accounts
        # are explicitly marked artist_portal/role=artist.
        me_artist = await db.artists.find_one(
            {"artist_user_id": me_id, "active": {"$ne": False}},
            {"_id": 0, "id": 1},
        )
        me_is_artist = bool(me_artist) and await is_artist_user(me_id)
        role = "admin" if is_admin else ("artist" if me_is_artist else "customer")

        out = [{
            "id": "bot",
            "name": "TINTA AI",
            "role": "bot",
            "avatar": "",
            "conversation_id": f"bot:{me_id}",
        }]

        if role != "admin":
            admins = await db.users.find(
                {"is_admin": True},
                {"_id": 0, "id": 1, "name": 1},
            ).to_list(50)
            for a in admins:
                aid = a.get("id")
                if aid and aid != me_id:
                    out.append({
                        "id": aid,
                        "name": a.get("name") or "TINTA Admin",
                        "role": "admin",
                        "avatar": "",
                        "conversation_id": f"dm:{':'.join(sorted([me_id, aid]))}",
                    })

        # Customers and admins must always see every real, active artist.
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
                records.append({
                    "id": aid,
                    "artist_user_id": uid,
                    "name": source.get("name") or "Artist",
                    "avatar": source.get("avatar") or "",
                })

            for a in records:
                out.append({
                    "id": a["id"],
                    "name": a["name"],
                    "role": "artist",
                    "avatar": a["avatar"],
                    "conversation_id": f"dm:{':'.join(sorted([me_id, a['artist_user_id']]))}",
                })

        # Artists can message customers directly, even before a booking exists.
        if role == "artist":
            customers = await db.users.find(
                {"is_admin": {"$ne": True}},
                {"_id": 0, "id": 1, "name": 1},
            ).to_list(500)
            for c in customers:
                cid = c.get("id")
                if not cid or cid == me_id:
                    continue
                out.append({
                    "id": cid,
                    "name": c.get("name") or "Customer",
                    "role": "customer",
                    "avatar": "",
                    "conversation_id": f"dm:{':'.join(sorted([me_id, cid]))}",
                })

        # Admins can message customers as well.
        if role == "admin":
            customers = await db.users.find(
                {"is_admin": {"$ne": True}},
                {"_id": 0, "id": 1, "name": 1},
            ).to_list(500)
            for c in customers:
                cid = c.get("id")
                if not cid or cid == me_id:
                    continue
                out.append({
                    "id": cid,
                    "name": c.get("name") or "Customer",
                    "role": "customer",
                    "avatar": "",
                    "conversation_id": f"dm:{':'.join(sorted([me_id, cid]))}",
                })

        deduped = []
        seen = set()
        for item in out:
            if item["conversation_id"] not in seen:
                seen.add(item["conversation_id"])
                deduped.append(item)
        print(
            f"TINTA FORCE CONTACTS: role={role} total={len(deduped)} "
            f"artists={[x['name'] for x in deduped if x.get('role') == 'artist']} "
            f"customers={[x['name'] for x in deduped if x.get('role') == 'customer']}"
        )
        return deduped

    app.routes[:] = [
        r for r in app.routes
        if not (getattr(r, "path", None) == "/api/chat/contacts" and "GET" in getattr(r, "methods", set()))
    ]
    app.add_api_route("/api/chat/contacts", contacts, methods=["GET"])
