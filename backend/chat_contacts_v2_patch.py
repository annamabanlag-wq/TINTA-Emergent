from fastapi import Depends
from typing import Optional
import re


def install(server):
    app = server.app
    db = server.db
    current_user = server.current_user

    async def resolve_artist(record):
        uid = record.get("artist_user_id") or record.get("user_id")
        aid = record.get("id") or record.get("artist_id")
        if not uid and aid:
            a = await db.artist_applications.find_one({"artist_id": aid, "status": {"$regex": "^approved$", "$options": "i"}}, {"_id": 0, "user_id": 1})
            uid = (a or {}).get("user_id")
        if not uid and record.get("email"):
            u = await db.users.find_one({"email": str(record["email"]).strip().lower(), "is_admin": {"$ne": True}}, {"_id": 0, "id": 1})
            uid = (u or {}).get("id")
        if not uid and record.get("name"):
            name = str(record["name"]).strip()
            u = await db.users.find_one({"name": {"$regex": "^" + re.escape(name) + "$", "$options": "i"}, "is_admin": {"$ne": True}}, {"_id": 0, "id": 1})
            uid = (u or {}).get("id")
        return uid

    async def all_artists():
        raw = await db.artists.find({"active": {"$ne": False}}, {"_id": 0, "id": 1, "artist_user_id": 1, "user_id": 1, "email": 1, "name": 1, "avatar": 1}).to_list(500)
        approved = await db.artist_applications.find({"status": {"$regex": "^approved$", "$options": "i"}}, {"_id": 0, "artist_id": 1, "user_id": 1, "email": 1, "name": 1, "avatar": 1}).to_list(500)
        out, seen = [], set()
        for a in [*raw, *approved]:
            uid = await resolve_artist(a)
            if not uid or uid in seen:
                continue
            seen.add(uid)
            out.append({"id": a.get("id") or a.get("artist_id") or uid, "user_id": uid, "name": a.get("name") or "Artist", "avatar": a.get("avatar") or ""})
        return out

    async def contacts(view: Optional[str] = None, user=Depends(current_user)):
        me_id = user["id"]
        actual_artist = await db.artists.find_one({"artist_user_id": me_id, "active": {"$ne": False}}, {"_id": 0, "id": 1})
        role = "admin" if user.get("is_admin") else ("artist" if actual_artist else "customer")
        if view and view.lower() in {"customer", "artist", "admin"}:
            role = view.lower()

        out = [{"id": "bot", "name": "TINTA AI", "role": "bot", "avatar": "", "conversation_id": f"bot:{me_id}"}]
        admins = await db.users.find({"is_admin": True}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
        if role != "admin":
            for a in admins:
                aid = a.get("id")
                if aid and aid != me_id:
                    out.append({"id": aid, "name": a.get("name") or "TINTA Admin", "role": "admin", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me_id, aid]))}"})

        if role in {"customer", "admin"}:
            for a in await all_artists():
                if a["user_id"] == me_id:
                    continue
                out.append({"id": a["id"], "name": a["name"], "role": "artist", "avatar": a["avatar"], "conversation_id": f"dm:{':'.join(sorted([me_id, a['user_id']]))}"})

        if role == "artist":
            artist = await db.artists.find_one({"artist_user_id": me_id}, {"_id": 0, "id": 1})
            customer_ids = await db.bookings.distinct("user_id", {"artist_id": artist["id"]}) if artist else []
            customers = await db.users.find({"id": {"$in": customer_ids}, "is_admin": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
            for c in customers:
                cid = c.get("id")
                if cid and cid != me_id:
                    out.append({"id": cid, "name": c.get("name") or "Customer", "role": "customer", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me_id, cid]))}"})
            for a in admins:
                aid = a.get("id")
                if aid and aid != me_id:
                    out.append({"id": aid, "name": a.get("name") or "TINTA Admin", "role": "admin", "avatar": "", "conversation_id": f"dm:{':'.join(sorted([me_id, aid]))}"})

        seen = set()
        deduped = []
        for item in out:
            if item["conversation_id"] not in seen:
                seen.add(item["conversation_id"])
                deduped.append(item)
        print(f"TINTA CONTACTS V2: view={view or '-'} role={role} total={len(deduped)} artists={[x['name'] for x in deduped if x.get('role')=='artist']} customers={[x['name'] for x in deduped if x.get('role')=='customer']}")
        return deduped

    app.routes[:] = [r for r in app.routes if not (getattr(r, "path", None) == "/api/chat/contacts" and "GET" in getattr(r, "methods", set()))]
    app.add_api_route("/api/chat/contacts", contacts, methods=["GET"])
