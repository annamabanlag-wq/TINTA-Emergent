"""Allow the public artist signup flow to create an artist-portal account.

Artist accounts are still NOT approved artists: the user must submit an artist
application and an admin must approve it before an artist record is created.
This patch only marks the account as eligible to use the Artist Portal so the
newly registered artist can sign in and submit that application.
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

            # Reuse the existing hardened registration endpoint for validation,
            # password hashing, and independent auth-session creation.
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

            return result

        artist_aware_register._tinta_artist_registration_role = True
        route.endpoint = artist_aware_register
        route.dependant = get_dependant(path=route.path_format, call=artist_aware_register)
        return
