"""Compatibility bridge for TINTA session hardening.

If an older auth route returns a valid JWT containing a session id but the
session document was not created, create the session lazily. This lets the
new per-device session policy coexist safely with older tokens/routes during
migration. Explicitly revoked sessions are never recreated.
"""

from datetime import datetime, timedelta, timezone
from fastapi import Request

COLLECTION = "auth_sessions"
IDLE_MINUTES = 30
ABSOLUTE_HOURS = 12


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat()


def install(module):
    db = module.db
    jwt = module.jwt
    secret = module.JWT_SECRET
    alg = module.JWT_ALG

    @module.app.middleware("http")
    async def auth_session_bridge(request: Request, call_next):
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            try:
                token = auth[7:]
                payload = jwt.decode(token, secret, algorithms=[alg])
                uid = payload.get("sub")
                sid = payload.get("sid")
                if uid and sid:
                    existing = await db[COLLECTION].find_one(
                        {"session_id": sid, "user_id": uid}, {"_id": 0, "revoked": 1}
                    )
                    if existing is None:
                        now = _now()
                        await db[COLLECTION].insert_one({
                            "session_id": sid,
                            "user_id": uid,
                            "created_at": _iso(now),
                            "last_seen": _iso(now),
                            "revoked": False,
                            "migration_created": True,
                        })
            except Exception:
                pass
        return await call_next(request)

    print("TINTA auth session bridge installed")
