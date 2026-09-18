"""Final mailbox-verification enforcement for all new TINTA accounts.

This is the single active email-verification layer. It runs last in the startup
chain after the artist-role and auth-session patches. Sending is HTTPS-first so
it works on Render free services where direct SMTP egress may be unavailable.
"""

import os
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import requests
from email_validator import EmailNotValidError, validate_email
from fastapi import HTTPException, Request
from fastapi.dependencies.utils import get_dependant
from fastapi.routing import APIRoute, request_response
from pydantic import BaseModel, Field

CODE_TTL_MINUTES = 15
RESEND_API_URL = "https://api.resend.com/emails"


class VerifyEmailIn(BaseModel):
    email: str
    code: str = Field(min_length=6, max_length=6)


class ResendVerificationIn(BaseModel):
    email: str


def _relay_configured() -> bool:
    return bool(os.getenv("TINTA_EMAIL_RELAY_URL") and os.getenv("TINTA_EMAIL_RELAY_TOKEN"))


def _gmail_configured() -> bool:
    return bool(os.getenv("GMAIL_SMTP_USER") and os.getenv("GMAIL_SMTP_APP_PASSWORD"))


def _resend_configured() -> bool:
    return bool(os.getenv("RESEND_API_KEY") and os.getenv("EMAIL_FROM"))


def _email_configured() -> bool:
    return _relay_configured() or _resend_configured() or _gmail_configured()


def _new_code():
    return f"{secrets.randbelow(1000000):06d}", datetime.now(timezone.utc) + timedelta(minutes=CODE_TTL_MINUTES)


def _send_code_relay(email: str, code: str) -> None:
    response = requests.post(
        os.environ["TINTA_EMAIL_RELAY_URL"].strip(),
        headers={
            "Content-Type": "application/json",
        },
        json={
            "token": os.environ["TINTA_EMAIL_RELAY_TOKEN"],
            "to": email,
            "code": code,
            "ttl_minutes": CODE_TTL_MINUTES,
        },
        timeout=20,
    )
    if not response.ok:
        raise RuntimeError(f"Email relay HTTP {response.status_code}: {response.text[:300]}")
    try:
        payload = response.json()
    except Exception:
        raise RuntimeError("Email relay returned a non-JSON response")
    if not payload.get("ok"):
        raise RuntimeError(f"Email relay rejected message: {payload.get('error', 'unknown error')}")


def _send_code_gmail(email: str, code: str) -> None:
    username = os.environ["GMAIL_SMTP_USER"].strip()
    app_password = os.environ["GMAIL_SMTP_APP_PASSWORD"].replace(" ", "").strip()
    sender = os.getenv("EMAIL_FROM", username).strip()

    message = EmailMessage()
    message["From"] = sender
    message["To"] = email
    message["Subject"] = "Verify your TINTA account"
    message.set_content(
        f"Your TINTA verification code is: {code}\n\n"
        f"This code expires in {CODE_TTL_MINUTES} minutes.\n"
        "If you did not create a TINTA account, you can ignore this email."
    )

    with smtplib.SMTP("smtp.gmail.com", 587, timeout=20) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(username, app_password)
        smtp.send_message(message)


def _send_code_resend(email: str, code: str) -> None:
    response = requests.post(
        RESEND_API_URL,
        headers={
            "Authorization": f"Bearer {os.environ['RESEND_API_KEY']}",
            "Content-Type": "application/json",
        },
        json={
            "from": os.environ["EMAIL_FROM"],
            "to": [email],
            "subject": "Verify your TINTA account",
            "text": (
                f"Your TINTA verification code is: {code}\n\n"
                f"This code expires in {CODE_TTL_MINUTES} minutes.\n"
                "If you did not create a TINTA account, you can ignore this email."
            ),
        },
        timeout=20,
    )
    if not response.ok:
        raise RuntimeError(f"Resend API {response.status_code}: {response.text[:300]}")


def _send_code(email: str, code: str) -> None:
    # Try every configured sender in order so one provider's restriction does
    # not make TINTA unusable when a working fallback is configured.
    configured = []
    if _relay_configured():
        configured.append(("relay", _send_code_relay))
    if _resend_configured():
        configured.append(("resend", _send_code_resend))
    if _gmail_configured():
        configured.append(("gmail", _send_code_gmail))
    if not configured:
        raise RuntimeError("No email sender is configured")

    errors = []
    for name, sender in configured:
        try:
            sender(email, code)
            return
        except Exception as exc:
            errors.append(f"{name}: {exc}")
            print(f"TINTA verification sender {name} failed: {type(exc).__name__}: {exc}")
    raise RuntimeError("All configured email senders failed: " + " | ".join(errors))


async def _revoke_created_session(module, token: str):
    if not token:
        return
    try:
        payload = module.jwt.decode(token, module.JWT_SECRET, algorithms=[module.JWT_ALG])
        sid = payload.get("sid")
        uid = payload.get("sub")
        if sid and uid:
            await module.db["auth_sessions"].update_one(
                {"session_id": sid, "user_id": uid},
                {"$set": {"revoked": True, "revoked_reason": "email_verification_send_failed"}},
            )
    except Exception:
        pass


def _result_user(result):
    user = result.get("user") if isinstance(result, dict) else getattr(result, "user", None)
    if user is None:
        raise RuntimeError("Registration returned no user")
    if isinstance(user, dict):
        return dict(user)
    if hasattr(user, "model_dump"):
        return user.model_dump()
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "is_admin": bool(getattr(user, "is_admin", False)),
    }


def _result_token(result):
    if isinstance(result, dict):
        return str(result.get("access_token") or "")
    return str(getattr(result, "access_token", "") or "")


def install(module):
    app = module.app
    db = module.db

    if not any(getattr(r, "path", None) == "/api/auth/verify-email" for r in app.routes):
        @app.post("/api/auth/verify-email")
        async def verify_email(body: VerifyEmailIn):
            email = body.email.strip().lower()
            user = await db.users.find_one({"email": email}, {"_id": 0})
            if not user or user.get("email_verified") is not False:
                if user and user.get("email_verified") is True:
                    return {"verified": True, "message": "Email already verified"}
                raise HTTPException(400, "Invalid verification code")
            code = str(user.get("email_verification_code") or "")
            expires = user.get("email_verification_expires_at")
            if not code or code != body.code.strip() or not expires:
                raise HTTPException(400, "Invalid or expired verification code")
            try:
                expiry = datetime.fromisoformat(expires)
                if expiry.tzinfo is None:
                    expiry = expiry.replace(tzinfo=timezone.utc)
            except Exception:
                raise HTTPException(400, "Invalid or expired verification code")
            if datetime.now(timezone.utc) >= expiry:
                raise HTTPException(400, "Invalid or expired verification code")
            await db.users.update_one(
                {"id": user["id"]},
                {"$set": {"email_verified": True}, "$unset": {"email_verification_code": "", "email_verification_expires_at": ""}},
            )
            return {"verified": True, "message": "Email verified. You can now sign in."}

    if not any(getattr(r, "path", None) == "/api/auth/resend-verification" for r in app.routes):
        @app.post("/api/auth/resend-verification")
        async def resend_verification(body: ResendVerificationIn):
            if not _email_configured():
                raise HTTPException(503, "Email verification is not configured yet.")
            try:
                validated = validate_email(body.email, check_deliverability=True)
                email = validated.normalized
            except EmailNotValidError:
                raise HTTPException(422, "Please enter a real, reachable email address.")
            user = await db.users.find_one({"email": email}, {"_id": 0})
            if not user:
                return {"sent": True, "message": "If the account exists, a verification email was sent."}
            if user.get("email_verified") is True:
                return {"sent": True, "message": "Email is already verified."}
            code, expires = _new_code()
            await db.users.update_one(
                {"id": user["id"]},
                {"$set": {"email_verification_code": code, "email_verification_expires_at": expires.isoformat(), "email_verified": False}},
            )
            try:
                _send_code(email, code)
            except Exception as exc:
                print(f"TINTA verification email send failed: {type(exc).__name__}: {exc}")
                raise HTTPException(503, "We could not send the verification email. Please try again.")
            return {"sent": True, "message": "A new verification code was sent."}

    for route in list(app.routes):
        if not isinstance(route, APIRoute) or route.path != "/api/auth/register" or route.methods != {"POST"}:
            continue
        original_register = route.endpoint
        if getattr(original_register, "_tinta_final_email_registration", False):
            break

        async def verified_register(request: Request):
            payload = await request.json()
            role = str(payload.get("role", "customer")).strip().lower()
            # Artist onboarding uses reachable-email validation plus government
            # ID/finished-work/admin verification; it does not depend on a
            # mailbox verification code.
            if role == "artist":
                return await original_register(request)
            if not _email_configured():
                raise HTTPException(503, "Email verification is not configured yet. Please try again shortly.")
            try:
                validated = validate_email(str(payload.get("email", "")), check_deliverability=True)
            except EmailNotValidError:
                raise HTTPException(422, "Please enter a real, reachable email address.")
            result = await original_register(request)
            token = _result_token(result)
            user = _result_user(result)
            uid = str(user.get("id") or "")
            email = str(user.get("email") or validated.normalized).strip().lower()
            if not uid:
                raise HTTPException(500, "Registration created an invalid account")

            current = await db.users.find_one(
                {"id": uid},
                {"_id": 0, "email_verification_code": 1, "email_verification_expires_at": 1, "email_verified": 1},
            )
            if current and current.get("email_verified") is False and current.get("email_verification_code") and current.get("email_verification_expires_at"):
                user["email"] = email
                user["email_verified"] = False
                return result

            code, expires = _new_code()
            await db.users.update_one(
                {"id": uid},
                {"$set": {
                    "email": email,
                    "email_verified": False,
                    "email_verification_code": code,
                    "email_verification_expires_at": expires.isoformat(),
                }},
            )
            try:
                _send_code(email, code)
            except Exception as exc:
                print(f"TINTA verification email send failed: {type(exc).__name__}: {exc}")
                await _revoke_created_session(module, token)
                await db.users.delete_one({"id": uid})
                raise HTTPException(503, "We could not send the verification email. Please try again.")
            user["email"] = email
            user["email_verified"] = False
            return {"access_token": "", "token_type": "bearer", "user": user}

        verified_register._tinta_final_email_registration = True
        route.endpoint = verified_register
        route.dependant = get_dependant(path=route.path_format, call=verified_register)
        route.response_model = None
        route.response_field = None
        route.secure_cloned_response_field = None
        route.app = request_response(route.get_route_handler())
        break

    for route in list(app.routes):
        if not isinstance(route, APIRoute) or route.path != "/api/auth/login" or route.methods != {"POST"}:
            continue
        original_login = route.endpoint
        if getattr(original_login, "_tinta_final_email_login", False):
            break

        async def verified_login(body: module.LoginIn):
            result = await original_login(body)
            user = await db.users.find_one({"id": _result_user(result).get("id")}, {"_id": 0})
            if user and user.get("email_verified") is False and user.get("role") != "artist":
                raise HTTPException(403, "Please verify your email before signing in.")
            return result

        verified_login._tinta_final_email_login = True
        route.endpoint = verified_login
        route.dependant = get_dependant(path=route.path_format, call=verified_login)
        route.app = request_response(route.get_route_handler())
        break

    print("TINTA final email ownership enforcement installed")
