from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import uuid
from datetime import datetime, timezone


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

    async def bot_context(user, conversation_id: str) -> dict:
        """Build a small live context so the simulated assistant can answer personally."""
        me = await identity(user)
        context = {"name": me["name"], "role": me["role"], "booking": None, "artist_count": 0}
        if me["role"] == "customer":
            try:
                context["artist_count"] = await db.artists.count_documents({"active": {"$ne": False}})
                bookings = await db.bookings.find({"user_id": me["id"]}, {"_id": 0, "artist_name": 1, "date": 1, "time_slot": 1, "status": 1, "payment_status": 1}).sort([("date", 1), ("time_slot", 1)]).to_list(100)
                today = datetime.now(timezone.utc).date().isoformat()
                future = [b for b in bookings if b.get("date", "") >= today and b.get("status") != "cancelled"]
                if future:
                    context["booking"] = future[0]
            except Exception:
                pass
        return context

    async def bot_reply(text: str, user, conversation_id: str) -> str:
        """Friendly deterministic AI-style assistant; no external LLM or paid API required."""
        t = text.lower().strip()
        ctx = await bot_context(user, conversation_id)
        name = ctx["name"].split(" ")[0] if ctx["name"] else "there"

        greetings = ["hello", "hi", "hey", "kumusta", "good morning", "good afternoon", "good evening"]
        if any(t == g or t.startswith(g + " ") for g in greetings):
            return f"Hey {name}! 👋 Welcome to TINTA. I'm here with you. I can help with artists, bookings, GCash payments, or just answer questions. What are you planning for your tattoo?"
        if any(x in t for x in ["what can you do", "how can you help", "help me"]):
            return "Of course! 😊 I can help you find an artist, understand booking steps, explain the GCash payment process, check your upcoming booking, and point you to TINTA Admin when something needs a human review."
        if any(x in t for x in ["my booking", "my appointment", "my schedule", "what is my booking"]):
            b = ctx.get("booking")
            if not b:
                return "I don't see an upcoming booking on your account right now. If you'd like, we can start with choosing an artist and finding an available schedule."
            payment = b.get("payment_status", "unpaid")
            payment_text = "your GCash payment is marked paid" if payment == "paid" else "the booking deposit is not marked paid yet"
            return f"I found your next booking with {b.get('artist_name', 'your artist')} on {b.get('date', 'the scheduled date')} at {b.get('time_slot', 'the scheduled time')}. The booking is {b.get('status', 'pending')} and {payment_text}."
        if "book" in t or "appointment" in t or "schedule" in t:
            return "Absolutely 😊 The usual flow is: choose an artist → open their profile and work → choose an available date/time → describe your tattoo → confirm the booking → send the GCash deposit and submit the reference/receipt for admin verification."
        if "gcash" in t or "payment" in t or "deposit" in t:
            return "Yes 👍 TINTA currently uses GCash for payments. After your booking, send the required deposit through GCash, then submit your GCash reference number and receipt in TINTA. Admin verifies it before the payment is approved."
        if "artist" in t or "tattoo artist" in t:
            count = ctx.get("artist_count", 0)
            if count:
                return f"We currently have {count} active artist{'s' if count != 1 else ''} available in TINTA. 🎨 Open an artist profile to see their style and work, then message them directly if you want to discuss your design."
            return "I'd be happy to help you find an artist. Open the Artists section and look for the style that matches your idea, then you can view their work and message them."
        if any(x in t for x in ["cancel", "refund"]):
            return "I can explain the general process, but I don't want to guess about a specific refund. If this is about an existing booking, message TINTA Admin and include your booking details so the team can review it."
        if any(x in t for x in ["price", "cost", "how much", "rate"]):
            return "Tattoo pricing depends on the artist, design, size, placement, and session time. 🎨 Check the artist's profile for their rate, then message them with your design idea for a more specific discussion."
        if any(x in t for x in ["thank", "thanks", "salamat"]):
            return f"You're very welcome, {name}! 😊 I'm right here if you need anything else with TINTA."
        if any(x in t for x in ["good night", "goodnight"]):
            return "Good night! 🌙 Take care, and I'll be here whenever you're ready to continue your TINTA journey."
        if any(x in t for x in ["okay", "ok", "sige"]):
            return "Sounds good! 👍 Whenever you're ready, tell me what you'd like to do next and I'll guide you."
        return f"Got you, {name}. 😊 Tell me a little more about what you want to do and I'll help you with the next step. If it's about a specific booking or payment issue, I can also point you to the right TINTA person."

    async def send(body: ChatSendIn, user=Depends(current_user)):
        me = await identity(user)
        text = body.text.strip()
        if not text:
            raise HTTPException(422, "Message cannot be empty")
        if body.bot or body.recipient_id == "bot" or body.conversation_id == f"bot:{me['id']}":
            cid = f"bot:{me['id']}"
            msg = {"id": str(uuid.uuid4()), "conversation_id": cid, "sender_id": me["id"], "sender_role": me["role"], "sender_name": me["name"], "text": text, "created_at": now_iso()}
            await db.chat_messages.insert_one(msg)
            reply = {"id": str(uuid.uuid4()), "conversation_id": cid, "sender_id": "bot", "sender_role": "bot", "sender_name": "TINTA AI", "text": await bot_reply(text, user, cid), "created_at": now_iso()}
            await db.chat_messages.insert_one(reply)
            return {"message": msg, "reply": reply}
        if body.conversation_id:
            cid = body.conversation_id
            parts = cid.split(":")
            if len(parts) != 3 or not cid.startswith("dm:") or me["id"] not in parts[1:]:
                raise HTTPException(403, "Invalid conversation")
            other_id = parts[2] if parts[1] == me["id"] else parts[1]
            recipient = await db.users.find_one({"id": other_id}, {"_id": 0, "id": 1})
            if not recipient:
                raise HTTPException(404, "Recipient not found")
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
