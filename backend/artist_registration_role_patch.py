"""Zero-budget artist onboarding.

Artist accounts may register without mailbox verification while TINTA has no
verified sending domain. They are NOT public/approved artists: the artist
must complete the application and an admin must verify/approve it before the
artist record is published.

Customer registration keeps the existing real email-verification flow.
"""

from fastapi import Request
from fastapi.routing import APIRoute, request_response
from fastapi.dependencies.utils import get_dependant
import uuid


def install(module):
    for route in list(module.app.routes):
        if not isinstance(route, APIRoute):
            continue
        if route.path != "/api/auth/register" or route.methods != {"POST"}:
            continue
        if getattr(route.endpoint, "_tinta_artist_registration_role", False):
            return

        original_register = route.endpoint

        async def artist_aware_register(request: Request):
            try:
                payload = await request.json()
            except Exception:
                payload = {}

            role = str(payload.get("role", "customer")).strip().lower()
            if role not in {"customer", "artist"}:
                role = "customer"

            body = module.RegisterIn(
                email=payload.get("email", ""),
                password=payload.get("password", ""),
                name=payload.get("name", ""),
            )

            if role != "artist":
                return await original_register(body)

            # Artist onboarding is admin-verified, not email-verified, while
            # the platform has no verified outbound email domain. Reuse the
            # same validation and password hashing as the hardened auth flow.
            email = module._validate_email(body.email)
            existing = await module.db.users.find_one({"email": email})
            if existing:
                raise module.HTTPException(409, "Email already registered")

            uid = str(uuid.uuid4())
            doc = {
                "id": uid,
                "email": email,
                "name": body.name.strip(),
                "password_hash": module.hash_password(body.password),
                "is_admin": False,
                "role": "artist",
                "artist_portal": True,
                "artist_identity_verified": False,
                "email_verified": False,
                "created_at": module.now_iso(),
            }
            await module.db.users.insert_one(doc)

            # Create an independent server session exactly like normal login.
            from auth_session_patch import _new_session
            _sid, token = await _new_session(module, uid)
            public = module.PublicUser(id=uid, email=email, name=body.name.strip(), is_admin=False)
            return module.AuthOut(access_token=token, user=public)

        artist_aware_register._tinta_artist_registration_role = True
        route.endpoint = artist_aware_register
        route.dependant = get_dependant(path=route.path_format, call=artist_aware_register)
        # APIRoute caches the ASGI handler during initialization. Rebuild it
        # after replacing the endpoint so the live Render process executes the
        # artist-aware handler rather than the older email-verification wrapper.
        route.app = request_response(route.get_route_handler())
        return
