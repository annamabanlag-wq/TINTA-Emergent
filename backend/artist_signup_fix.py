"""Ensure artist registration returns a usable session for the verification flow.

The public registration endpoint already accepts the artist role through the
artist-registration patch. This patch keeps the registration semantics intact
and only makes the artist result eligible for the existing artist verification
/application flow.
"""

from fastapi import Request
from fastapi.routing import APIRoute
from fastapi.dependencies.utils import get_dependant


def install(module):
    for route in list(module.app.routes):
        if not isinstance(route, APIRoute):
            continue
        if route.path != "/api/auth/register" or route.methods != {"POST"}:
            continue
        if getattr(route.endpoint, "_tinta_artist_signup_fix", False):
            return

        original_register = route.endpoint

        async def artist_signup_register(request: Request):
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
            result = await original_register(body)

            if role == "artist":
                await module.db.users.update_one(
                    {"id": result.user.id, "is_admin": {"$ne": True}},
                    {"$set": {"artist_portal": True, "role": "artist"}},
                )

                # Return the updated user metadata so the client can continue
                # the artist verification/application flow without treating the
                # account as a customer.
                try:
                    result.user.artist_portal = True
                    result.user.role = "artist"
                except Exception:
                    pass

            return result

        artist_signup_register._tinta_artist_signup_fix = True
        route.endpoint = artist_signup_register
        route.dependant = get_dependant(path=route.path_format, call=artist_signup_register)
        return
