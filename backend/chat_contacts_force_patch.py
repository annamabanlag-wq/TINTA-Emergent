from fastapi import Depends


def install(server):
    app = server.app
    db = server.db
    current_user = server.current_user

    async def contacts(user=Depends(current_user)):
        me_id = user["id"]
        is_admin = bool(user.get("is_admin"))
        me_artist = await db.artists.find_one({"artist_user_id": me_id, "active": {"$ne": False}}, {"_id": 0, "id": 1})
        role = "admin" if is_admin else ("artist" if me_artist else "customer")
        out = [{"id": "bot", "name": "TINTA AI", "role": "bot", "avatar": "", "conversation_id": f"bot:{me_id}"}]

        if role != "admin":
            admins = await db.users.find({"is_admin": True}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
            for a in admins:
                aid = a.get("id")
                if aid and aid != me_id:
                    out.append({"id": aid, "name": a.get("name") or "TINTA Admin", "role": "admin", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me_id, aid]))}"})

        if role in ("customer", "admin"):
            artists = await db.artists.find(
                {"active": {"$ne": False}, "artist_user_id": {"$exists": True, "$ne": None}},
                {"_id": 0, "id": 1, "artist_user_id": 1, "name": 1, "avatar": 1},
            ).to_list(500)
            for a in artists:
                uid = a.get("artist_user_id")
                if not uid or uid == me_id:
                    continue
                owner = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1})
                if not owner:
                    continue
                out.append({"id": a["id"], "name": a.get("name") or "Artist", "role": "artist", "avatar": a.get("avatar") or "", "conversation_id": f"dm:{':'.join(sorted([me_id, uid]))}"})

        if role == "artist" and me_artist:
            customer_ids = await db.bookings.distinct("user_id", {"artist_id": me_artist["id"]})
            customers = await db.users.find({"id": {"$in": customer_ids}, "is_admin": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
            for c in customers:
                out.append({"id": c["id"], "name": c.get("name") or "Customer", "role": "customer", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me_id, c['id']]))}"})

        if role == "admin":
            customers = await db.users.find({"is_admin": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
            for c in customers:
                out.append({"id": c["id"], "name": c.get("name") or "Customer", "role": "customer", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me_id, c['id']]))}"})

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
