"""Expose artist identity fields from /auth/me.

The database already stores role/artist_portal for artist accounts, but the
legacy PublicUser Pydantic model strips those fields from /auth/me. The Artist
web client therefore receives a customer-shaped user and rejects the newly
created artist session. This patch keeps the existing UI and auth flow while
returning the role flags needed by the Artist portal.
"""

from fastapi import Depends
from fastapi.routing import APIRoute, request_response
from fastapi.dependencies.utils import get_dependant


def install(module):
    for route in list(module.app.routes):
        if not isinstance(route, APIRoute):
            continue
        if route.path != "/api/auth/me" or route.methods != {"GET"}:
            continue
        if getattr(route.endpoint, "_tinta_artist_identity_response", False):
            return

        async def artist_identity_me(user=Depends(module.current_user)):
            return {
                "id": user["id"],
                "email": user["email"],
                "name": user["name"],
                "is_admin": bool(user.get("is_admin", False)),
                "role": user.get("role", "customer"),
                "artist_portal": bool(user.get("artist_portal", False)),
                "artist_identity_verified": bool(user.get("artist_identity_verified", False)),
                "email_verified": bool(user.get("email_verified", False)),
            }

        artist_identity_me._tinta_artist_identity_response = True
        route.endpoint = artist_identity_me
        route.dependant = get_dependant(path=route.path_format, call=artist_identity_me)
        route.response_model = None
        route.response_field = None
        route.secure_cloned_response_field = None
        route.app = request_response(route.get_route_handler())
        return
