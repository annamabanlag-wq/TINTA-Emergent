"""Zero-budget artist onboarding.

Artist accounts may register without mailbox verification while TINTA has no
verified sending domain. They are NOT public/approved artists: the artist
must complete the application and an admin must verify/approve it before the
artist record is published.

Customer registration keeps the existing real email-verification flow.
"""

from email_validator import EmailNotValidError, validate_email
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

            # Artist onboarding is admin-verified, not mailbox-verified, while
            # the platform has no verified outbound email domain. We still
            # require a syntactically valid, deliverable email domain so an
            # obviously fake/nonexistent email address cannot register.
            try:
                validated = validate_email(body.email, check_deliverability=True)
                email = validated.normalized
            except EmailNotValidError:
                raise module.HTTPException(422, "Please enter a real, reachable email address.")

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

            # Do not return the legacy PublicUser model here: it intentionally
            # contains no role fields, so FastAPI would strip the artist flags
            # and the Artist portal would misclassify a brand-new artist as a
            # customer. Keep the existing AuthOut shape and add the identity
            # flags required by the Artist portal.
            return {
                "access_token": token,
                "token_type": "bearer",
                "user": {
                    "id": uid,
                    "email": email,
                    "name": body.name.strip(),
                    "is_admin": False,
                    "role": "artist",
                    "artist_portal": True,
                    "artist_identity_verified": False,
                    "email_verified": False,
                },
            }

        artist_aware_register._tinta_artist_registration_role = True
        route.endpoint = artist_aware_register
        route.dependant = get_dependant(path=route.path_format, call=artist_aware_register)
        # APIRoute caches the ASGI handler during initialization. Rebuild it
        # after replacing the endpoint so the live Render process executes the
        # artist-aware handler rather than the older email-verification wrapper.
        # Disable the legacy AuthOut response model because it strips the
        # artist-specific identity fields from the registration response.
        route.response_model = None
        route.response_field = None
        route.secure_cloned_response_field = None
        route.app = request_response(route.get_route_handler())
        return
