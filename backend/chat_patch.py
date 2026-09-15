from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import uuid


def install(server):
    app = server.app
    db = server.db
    current_user = server.current_user
    now_iso = server.now_iso

    class ChatSendIn(BaseModel):
        recipient_id: Optional[str] = None
        recipient_role: Optional[str] = None
        conversation_id: Optional[str] = None
        text: str = Field(min_length=1, max_length=1000)
        bot: bool = False

    def dm_id(a: str, b: str) -> str:
        return "dm:" + ":".join(sorted([a, b]))

    async def identity(user):
        if user.get("is_admin"):
            return {"id": user["id"], "name": user.get("name", "Admin"), "role": "admin", "avatar": ""}
        artist = await db.artists.find_one({"artist_user_id": user["id"], "active": {"$ne": False}}, {"_id": 0})
        if artist:
            return {"id": user["id"], "name": artist.get("name") or user.get("name", "Artist"), "role": "artist", "avatar": artist.get("avatar", "")}
        return {"id": user["id"], "name": user.get("name", "Customer"), "role": "customer", "avatar": ""}

    async def allowed_recipient(user, recipient_id: str, recipient_role: str):
        me = await identity(user)
        if recipient_id == me["id"]:
            raise HTTPException(400, "You cannot message yourself")
        if recipient_role == "artist":
            artist = await db.artists.find_one({"id": recipient_id, "active": {"$ne": False}}, {"_id": 0, "artist_user_id": 1, "id": 1, "name": 1, "avatar": 1})
            if not artist:
                raise HTTPException(404, "Artist not found")
            return {"id": artist["artist_user_id"], "public_id": artist["id"], "name": artist.get("name", "Artist"), "role": "artist", "avatar": artist.get("avatar", "")}
        target = await db.users.find_one({"id": recipient_id}, {"_id": 0, "id": 1, "name": 1, "is_admin": 1})
        if not target:
            raise HTTPException(404, "User not found")
        role = "admin" if target.get("is_admin") else "customer"
        if me["role"] == "customer" and role == "customer":
            raise HTTPException(403, "Customers can message artists or TINTA Admin")
        if me["role"] == "artist" and role == "artist":
            raise HTTPException(403, "Artists can message customers or TINTA Admin")
        return {"id": target["id"], "public_id": target["id"], "name": target.get("name", role.title()), "role": role, "avatar": ""}

    async def contacts(user=Depends(current_user)):
        me = await identity(user)
        out = [{"id": "bot", "name": "TINTA AI", "role": "bot", "avatar": "", "conversation_id": f"bot:{me['id']}"}]
        if me["role"] != "admin":
            admins = await db.users.find({"is_admin": True}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
            out += [{"id": a["id"], "name": a.get("name", "TINTA Admin"), "role": "admin", "avatar": "", "conversation_id": dm_id(me["id"], a["id"])} for a in admins]
        if me["role"] in ("customer", "admin"):
            artists = await db.artists.find({"active": {"$ne": False}}, {"_id": 0, "id": 1, "artist_user_id": 1, "name": 1, "avatar": 1}).to_list(200)
            out += [{"id": a["id"], "name": a.get("name", "Artist"), "role": "artist", "avatar": a.get("avatar", ""), "conversation_id": dm_id(me["id"], a["artist_user_id"])} for a in artists if a.get("artist_user_id")]
        if me["role"] == "artist":
            artist = await db.artists.find_one({"artist_user_id": me["id"]}, {"_id": 0, "id": 1})
            if artist:
                customer_ids = await db.bookings.distinct("user_id", {"artist_id": artist["id"]})
                customers = await db.users.find({"id": {"$in": customer_ids}, "is_admin": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
                out += [{"id": c["id"], "name": c.get("name", "Customer"), "role": "customer", "avatar": "", "conversation_id": dm_id(me["id"], c["id"])} for c in customers]
            admins = await db.users.find({"is_admin": True}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
            out += [{"id": a["id"], "name": a.get("name", "TINTA Admin"), "role": "admin", "avatar": "", "conversation_id": dm_id(me["id"], a["id"])} for a in admins]
        if me["role"] == "admin":
            customers = await db.users.find({"is_admin": {"$ne": True}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
            out += [{"id": c["id"], "name": c.get("name", "Customer"), "role": "customer", "avatar": "", "conversation_id": dm_id(me["id"], c["id"])} for c in customers]
        return out

    async def conversation(conversation_id: str, user=Depends(current_user)):
        me = await identity(user)
        if conversation_id == f"bot:{me['id']}":
            docs = await db.chat_messages.find({"conversation_id": conversation_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
            return {"id": conversation_id, "title": "TINTA AI", "role": "bot", "messages": docs}
        if not conversation_id.startswith("dm:"):
            raise HTTPException(400, "Invalid conversation")
        parts = conversation_id.split(":")
        if len(parts) != 3 or me["id"] not in parts[1:]:
            raise HTTPException(403, "You are not part of this conversation")
        other_id = parts[2] if parts[1] == me["id"] else parts[1]
        other = await db.users.find_one({"id": other_id}, {"_id": 0, "id": 1, "name": 1, "is_admin": 1})
        if not other:
            raise HTTPException(404, "Conversation participant not found")
        artist = await db.artists.find_one({"artist_user_id": other_id}, {"_id": 0, "id": 1, "name": 1, "avatar": 1})
        title = (artist or {}).get("name") or other.get("name", "User")
        role = "artist" if artist else ("admin" if other.get("is_admin") else "customer")
        docs = await db.chat_messages.find({"conversation_id": conversation_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
        return {"id": conversation_id, "title": title, "role": role, "messages": docs}

    def bot_reply(text: str) -> str:
        t = text.lower()
        if any(x in t for x in ["hello", "hi", "hey", "kumusta"]): return "Hey! 👋 Welcome to TINTA. I can help you with artists, bookings, payments, and general questions."
        if "book" in t or "appointment" in t: return "Absolutely. Pick an artist, choose an available date and time, then confirm your booking and GCash deposit."
        if "gcash" in t or "payment" in t: return "TINTA currently uses GCash for payments. After sending the deposit, submit your GCash reference and receipt for admin verification."
        if "artist" in t: return "You can browse artists by style, open their profile, view their work, and message them directly."
        if "cancel" in t or "refund" in t: return "I can explain the cancellation policy. For a specific booking or refund issue, message TINTA Admin so the team can review it."
        if "price" in t or "cost" in t: return "Tattoo pricing depends on the artist and session details. Open an artist profile to see their rate, then message them about your design."
        if "help" in t: return "Sure. Tell me what you need help with — booking, artists, GCash payment, your account, or messaging."
        return "I understand. Tell me a little more and I'll help you figure out the next step on TINTA."

    async def send(body: ChatSendIn, user=Depends(current_user)):
        me = await identity(user)
        text = body.text.strip()
        if not text:
            raise HTTPException(422, "Message cannot be empty")
        if body.bot or body.recipient_id == "bot" or body.conversation_id == f"bot:{me['id']}":
            cid = f"bot:{me['id']}"
            msg = {"id": str(uuid.uuid4()), "conversation_id": cid, "sender_id": me["id"], "sender_role": me["role"], "sender_name": me["name"], "text": text, "created_at": now_iso()}
            await db.chat_messages.insert_one(msg)
            reply = {"id": str(uuid.uuid4()), "conversation_id": cid, "sender_id": "bot", "sender_role": "bot", "sender_name": "TINTA AI", "text": bot_reply(text), "created_at": now_iso()}
            await db.chat_messages.insert_one(reply)
            return {"message": msg, "reply": reply}
        if body.conversation_id:
            cid = body.conversation_id
            parts = cid.split(":")
            if len(parts) != 3 or not cid.startswith("dm:") or me["id"] not in parts[1:]:
                raise HTTPException(403, "Invalid conversation")
            other_id = parts[2] if parts[1] == me["id"] else parts[1]
            recipient = await db.users.find_one({"id": other_id}, {"_id": 0, "id": 1})
            if not recipient: raise HTTPException(404, "Recipient not found")
        else:
            if not body.recipient_id or not body.recipient_role:
                raise HTTPException(422, "Recipient is required")
            recipient = await allowed_recipient(user, body.recipient_id, body.recipient_role)
            cid = dm_id(me["id"], recipient["id"])
        msg = {"id": str(uuid.uuid4()), "conversation_id": cid, "sender_id": me["id"], "sender_role": me["role"], "sender_name": me["name"], "text": text, "created_at": now_iso()}
        await db.chat_messages.insert_one(msg)
        return {"message": msg}

    app.add_api_route("/api/chat/contacts", contacts, methods=["GET"])
    app.add_api_route("/api/chat/conversations/{conversation_id:path}", conversation, methods=["GET"])
    app.add_api_route("/api/chat/send", send, methods=["POST"])
