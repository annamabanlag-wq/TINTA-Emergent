"""Require mailbox verification for newly registered TINTA accounts."""
import os
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from fastapi import HTTPException
from pydantic import BaseModel, Field

CODE_TTL_MINUTES = 15
RESEND_SMTP_HOST = "smtp.resend.com"

class VerifyEmailIn(BaseModel):
    email: str
    code: str = Field(min_length=6, max_length=6)

class ResendVerificationIn(BaseModel):
    email: str

def _smtp_configured() -> bool:
    return bool(os.getenv("RESEND_API_KEY") and os.getenv("EMAIL_FROM"))

def _send_code(email: str, code: str) -> None:
    api_key = os.environ["RESEND_API_KEY"]
    sender = os.environ["EMAIL_FROM"]
    port = int(os.getenv("RESEND_SMTP_PORT", "465"))
    msg = EmailMessage()
    msg["Subject"] = "Verify your TINTA account"
    msg["From"] = sender
    msg["To"] = email
    msg.set_content(
        f"Your TINTA verification code is: {code}\n\n"
        f"This code expires in {CODE_TTL_MINUTES} minutes.\n"
        "If you did not create a TINTA account, you can ignore this email."
    )
    if port in (465, 2465):
        with smtplib.SMTP_SSL(RESEND_SMTP_HOST, port, context=ssl.create_default_context(), timeout=15) as smtp:
            smtp.login("resend", api_key)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(RESEND_SMTP_HOST, port, timeout=15) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login("resend", api_key)
            smtp.send_message(msg)

def _new_code():
    return f"{secrets.randbelow(1000000):06d}", datetime.now(timezone.utc) + timedelta(minutes=CODE_TTL_MINUTES)

def install(server_module):
    if not any(getattr(r, "path", None) == "/auth/verify-email" for r in server_module.api_router.routes):
        @server_module.api_router.post("/auth/verify-email")
        async def verify_email(body: VerifyEmailIn):
            email = body.email.strip().lower()
            user = await server_module.db.users.find_one({"email": email}, {"_id": 0})
            if not user:
                raise HTTPException(400, "Invalid verification code")
            if user.get("email_verified") is True:
                return {"verified": True, "message": "Email already verified"}
            stored_code = str(user.get("email_verification_code", ""))
            expires = user.get("email_verification_expires_at")
            if not stored_code or stored_code != body.code.strip() or not expires:
                raise HTTPException(400, "Invalid or expired verification code")
            try:
                expiry = datetime.fromisoformat(expires)
            except Exception:
                raise HTTPException(400, "Invalid or expired verification code")
            if datetime.now(timezone.utc) >= expiry:
                raise HTTPException(400, "Invalid or expired verification code")
            await server_module.db.users.update_one(
                {"id": user["id"]},
                {"$set": {"email_verified": True}, "$unset": {"email_verification_code": "", "email_verification_expires_at": ""}}
            )
            return {"verified": True, "message": "Email verified. You can now sign in."}

    if not any(getattr(r, "path", None) == "/auth/resend-verification" for r in server_module.api_router.routes):
        @server_module.api_router.post("/auth/resend-verification")
        async def resend_verification(body: ResendVerificationIn):
            if not _smtp_configured():
                raise HTTPException(503, "Email verification is not configured yet.")
            email = body.email.strip().lower()
            user = await server_module.db.users.find_one({"email": email}, {"_id": 0})
            if not user:
                return {"sent": True, "message": "If the account exists, a verification email was sent."}
            if user.get("email_verified") is True:
                return {"sent": True, "message": "Email is already verified."}
            code, expires = _new_code()
            await server_module.db.users.update_one({"id": user["id"]}, {"$set": {"email_verification_code": code, "email_verification_expires_at": expires.isoformat()}})
            try:
                _send_code(email, code)
            except Exception:
                raise HTTPException(503, "We could not send the verification email. Please try again.")
            return {"sent": True, "message": "A new verification code was sent."}

    for route in getattr(server_module.api_router, "routes", []):
        if getattr(route, "path", None) == "/auth/register" and getattr(route, "methods", set()) == {"POST"}:
            original_register = route.endpoint
            if getattr(original_register, "_tinta_email_verification", False):
                break
            async def verified_register(body):
                if not _smtp_configured():
                    raise HTTPException(503, "Email verification is not configured yet. Please try again shortly.")
                result = await original_register(body)
                code, expires = _new_code()
                await server_module.db.users.update_one({"id": result.user.id}, {"$set": {"email_verified": False, "email_verification_code": code, "email_verification_expires_at": expires.isoformat()}})
                try:
                    _send_code(result.user.email, code)
                except Exception:
                    await server_module.db.users.delete_one({"id": result.user.id})
                    raise HTTPException(503, "We could not send the verification email. Please try again.")
                return {"access_token": "", "token_type": "bearer", "user": result.user}
            verified_register._tinta_email_verification = True
            route.endpoint = verified_register
            break

    for route in getattr(server_module.api_router, "routes", []):
        if getattr(route, "path", None) == "/auth/login" and getattr(route, "methods", set()) == {"POST"}:
            original_login = route.endpoint
            if getattr(original_login, "_tinta_email_login_verification", False):
                return
            async def verified_login(body):
                result = await original_login(body)
                user = await server_module.db.users.find_one({"id": result.user.id}, {"_id": 0})
                if user and user.get("email_verified") is False:
                    raise HTTPException(403, "Please verify your email before signing in.")
                return result
            verified_login._tinta_email_login_verification = True
            route.endpoint = verified_login
            return
