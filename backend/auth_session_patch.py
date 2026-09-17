"""TINTA authentication hardening.

Adds server-enforced sessions so browser tokens cannot remain valid for the
full JWT lifetime and expires idle sessions. Each browser/device receives its
own independent session, so signing in on one device does not revoke another
active device session.
"""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Header, HTTPException
from fastapi.routing import APIRoute
from fastapi.dependencies.utils import get_dependant

IDLE_MINUTES = 30
ABSOLUTE_HOURS = 12
COLLECTION = "auth_sessions"


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat()


def _parse_iso(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _token(module, user_id, session_id):
    exp = _now() + timedelta(hours=ABSOLUTE_HOURS)
    return module.jwt.encode(
        {"sub": user_id, "sid": session_id, "exp": exp},
        module.JWT_SECRET,
        algorithm=module.JWT_ALG,
    )


async def _new_session(module, user_id):
    now = _now()
    sid = str(uuid.uuid4())

    # Every login gets an independent browser/device session.
    # Do NOT revoke existing sessions: an active laptop session must remain
    # valid when the same account signs in on another device.
    await module.db[COLLECTION].insert_one({
        "session_id": sid,
        "user_id": user_id,
        "created_at": _iso(now),
        "last_seen": _iso(now),
        "revoked": False,
    })
    return sid, _token(module, user_id, sid)


def _replace_dependant(route, endpoint):
    route.endpoint = endpoint
    route.dependant = get_dependant(path=route.path_format, call=endpoint)


def _replace_dependency_calls(deps, old, new):
    for dep in deps:
        if dep.call is old:
            dep.call = new
        _replace_dependency_calls(dep.dependencies, old, new)


def install(module):
    original_current_user = module.current_user

    async def secure_current_user(authorization: str | None = Header(None)):
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "Not authenticated")
        token = authorization[7:]
        try:
            payload = module.jwt.decode(token, module.JWT_SECRET, algorithms=[module.JWT_ALG])
            uid = payload["sub"]
            sid = payload.get("sid")
        except Exception:
            raise HTTPException(401, "Invalid or expired session")

        user = await module.db.users.find_one({"id": uid}, {"_id": 0})
        if not user:
            raise HTTPException(401, "User not found")

        # Backward-compatible migration for still-valid tokens created before
        # server-side sessions were introduced. The JWT's own exp remains the
        # hard outer boundary; this only creates the missing server session.
        if not sid:
            sid = "legacy-" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:48]
            now = _now()
            await module.db[COLLECTION].update_one(
                {"session_id": sid, "user_id": uid},
                {"$setOnInsert": {
                    "session_id": sid,
                    "user_id": uid,
                    "created_at": _iso(now),
                    "last_seen": _iso(now),
                    "revoked": False,
                    "migration_created": True,
                }},
                upsert=True,
            )

        session = await module.db[COLLECTION].find_one(
            {"session_id": sid, "user_id": uid}, {"_id": 0}
        )
        if not session or session.get("revoked"):
            raise HTTPException(401, "Your session has expired. Please log in again.")

        now = _now()
        last_seen = (
            _parse_iso(session.get("last_seen"))
            or _parse_iso(session.get("created_at"))
            or now
        )
        created = _parse_iso(session.get("created_at")) or now

        if now - last_seen > timedelta(minutes=IDLE_MINUTES):
            await module.db[COLLECTION].update_one(
                {"session_id": sid, "user_id": uid},
                {"$set": {
                    "revoked": True,
                    "revoked_at": _iso(now),
                    "revoked_reason": "idle_timeout",
                }},
            )
            raise HTTPException(401, "You were logged out after 30 minutes of inactivity.")

        if now - created > timedelta(hours=ABSOLUTE_HOURS):
            await module.db[COLLECTION].update_one(
                {"session_id": sid, "user_id": uid},
                {"$set": {
                    "revoked": True,
                    "revoked_at": _iso(now),
                    "revoked_reason": "absolute_timeout",
                }},
            )
            raise HTTPException(401, "Your session expired. Please log in again.")

        await module.db[COLLECTION].update_one(
            {"session_id": sid, "user_id": uid},
            {"$set": {"last_seen": _iso(now)}},
        )
        return user

    async def secure_login(body: module.LoginIn):
        email = module._validate_email(body.email)
        user = await module.db.users.find_one({"email": email})
        if not user or not module.verify_password(body.password, user["password_hash"]):
            raise HTTPException(401, "Incorrect email or password")
        _sid, token = await _new_session(module, user["id"])
        return module.AuthOut(access_token=token, user=module.public_user(user))

    async def secure_register(body: module.RegisterIn):
        email = module._validate_email(body.email)
        existing = await module.db.users.find_one({"email": email})
        if existing:
            raise HTTPException(409, "Email already registered")
        uid = str(uuid.uuid4())
        doc = {
            "id": uid,
            "email": email,
            "name": body.name.strip(),
            "password_hash": module.hash_password(body.password),
            "is_admin": False,
            "created_at": module.now_iso(),
        }
        await module.db.users.insert_one(doc)
        _sid, token = await _new_session(module, uid)
        return module.AuthOut(
            access_token=token,
            user=module.PublicUser(id=uid, email=email, name=body.name.strip(), is_admin=False),
        )

    async def logout(user=__import__("fastapi").Depends(secure_current_user)):
        return {"logged_out": True}

    async def logout_with_header(authorization: str | None = Header(None)):
        if not authorization or not authorization.startswith("Bearer "):
            return {"logged_out": True}
        try:
            payload = module.jwt.decode(
                authorization[7:], module.JWT_SECRET, algorithms=[module.JWT_ALG]
            )
            sid = payload.get("sid")
            if sid:
                await module.db[COLLECTION].update_one(
                    {"session_id": sid},
                    {"$set": {
                        "revoked": True,
                        "revoked_at": _iso(_now()),
                        "revoked_reason": "logout",
                    }},
                )
        except Exception:
            pass
        return {"logged_out": True}

    # Replace every Depends(current_user), including nested require_admin dependencies.
    for route in list(module.app.routes):
        if isinstance(route, APIRoute):
            _replace_dependency_calls(
                route.dependant.dependencies,
                original_current_user,
                secure_current_user,
            )

    # Replace the two auth endpoints with session-aware implementations.
    for route in module.app.routes:
        if isinstance(route, APIRoute) and route.path in {
            "/api/auth/login", "/api/auth/register"
        }:
            _replace_dependant(
                route,
                secure_login if route.path.endswith("/login") else secure_register,
            )

    module.current_user = secure_current_user
    module.app.add_api_route(
        "/api/auth/logout", logout_with_header, methods=["POST"], response_model=dict
    )

    # Any remaining token-generation callers receive a token tied to a session.
    module.make_token = lambda user_id, session_id=None: _token(
        module, user_id, session_id or str(uuid.uuid4())
    )

    print(
        "TINTA auth session hardening installed: 30m idle, 12h absolute, "
        "legacy tokens migrate to independent server sessions"
    )