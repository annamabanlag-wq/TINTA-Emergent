from fastapi import Depends


def install(server):
    app = server.app
    db = server.db
    current_user = server.current_user

    async def identity(user):
        if user.get("is_admin"):
            return {"id": user["id"], "role": "admin"}
        artist = await db.artists.find_one({"artist_user_id": user["id"], "active": {"$ne": False}}, {"_id": 0, "id": 1})
        return {"id": user["id"], "role": "artist" if artist else "customer"}

    async def contacts(user=Depends(current_user)):
        me = await identity(user)
        out = [{"id": "bot", "name": "TINTA AI", "role": "bot", "avatar": "", "conversation_id": f"bot:{me['id']}"}]

        admins = await db.users.find({"is_admin": True}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(50)
        seen = set()
        unique_admins = []
        for a in admins:
            key = (a.get("email") or a.get("id") or a.get("name") or "").strip().lower()
            if key and key not in seen:
                seen.add(key)
                unique_admins.append(a)
        if me["role"] != "admin":
            for a in unique_admins:
                out.append({"id": a["id"], "name": a.get("name", "TINTA Admin"), "role": "admin", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me['id'], a['id']]))}"})

        if me["role"] in ("customer", "admin"):
            artists = await db.artists.find({"active": {"$ne": False}}, {"_id": 0, "id": 1, "artist_user_id": 1, "name": 1, "avatar": 1}).to_list(500)
            approved = await db.artist_applications.find({"status": {"$regex": "^approved$", "$options": "i"}}, {"_id": 0, "artist_id": 1, "user_id": 1, "name": 1, "avatar": 1}).to_list(500)
            by_user = {a.get("artist_user_id"): a for a in artists if a.get("artist_user_id")}
            for a in approved:
                uid = a.get("user_id")
                if uid and uid not in by_user:
                    by_user[uid] = {"id": a.get("artist_id") or uid, "artist_user_id": uid, "name": a.get("name") or "Artist", "avatar": a.get("avatar", "")}
            seen_artist_users = set()
            for a in list(by_user.values()):
                uid = a.get("artist_user_id")
                if not uid or uid in seen_artist_users:
                    continue
                seen_artist_users.add(uid)
                out.append({"id": a.get("id", uid), "name": a.get("name", "Artist"), "role": "artist", "avatar": a.get("avatar", ""), "conversation_id": f"dm:{':'.join(sorted([me['id'], uid]))}"})

        if me["role"] == "artist":
            artist = await db.artists.find_one({"artist_user_id": me["id"]}, {"_id": 0, "id": 1})
            if artist:
                customer_ids = await db.bookings.distinct("user_id", {"artist_id": artist["id"]})
                customers = await db.users.find({"id": {"$in": customer_ids}, "is_admin": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
                for c in customers:
                    out.append({"id": c["id"], "name": c.get("name", "Customer"), "role": "customer", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me['id'], c['id']]))}"})
            for a in unique_admins:
                out.append({"id": a["id"], "name": a.get("name", "TINTA Admin"), "role": "admin", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me['id'], a['id']]))}"})

        if me["role"] == "admin":
            customers = await db.users.find({"is_admin": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
            for c in customers:
                out.append({"id": c["id"], "name": c.get("name", "Customer"), "role": "customer", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me['id'], c['id']]))}"})

        deduped = []
        seen_conversations = set()
        for item in out:
            if item["conversation_id"] not in seen_conversations:
                seen_conversations.add(item["conversation_id"])
                deduped.append(item)
        return deduped

    # Replace the original chat contacts route so the hardened recovery logic is used.
    app.routes[:] = [r for r in app.routes if not (getattr(r, "path", None) == "/api/chat/contacts" and "GET" in getattr(r, "methods", set()))]
    app.add_api_route("/api/chat/contacts", contacts, methods=["GET"])
