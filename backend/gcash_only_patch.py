"""Keep the production payment surface aligned with TINTA's manual GCash launch flow."""

from fastapi import HTTPException


def install(server_module):
    app = server_module.app
    router = getattr(server_module, "api_router", None)
    if router is None:
        return

    # Frontend launch flow uses only manual GCash. Keep legacy checkout endpoints
    # available in code for later card support, but reject them in production so
    # an accidental client cannot create a non-GCash payment during launch.
    for route in getattr(app, "routes", []):
        path = getattr(route, "path", "")
        if path in {"/api/payments/checkout-session", "/api/payments/verify"}:
            endpoint = getattr(route, "endpoint", None)
            if endpoint is None or getattr(endpoint, "_tinta_gcash_guarded", False):
                continue

            async def guarded_endpoint(*args, __original=endpoint, **kwargs):
                raise HTTPException(
                    status_code=410,
                    detail="Card payments are disabled. Please use manual GCash payment.",
                )

            guarded_endpoint._tinta_gcash_guarded = True
            route.endpoint = guarded_endpoint
            dependant = getattr(route, "dependant", None)
            if dependant is not None:
                dependant.call = guarded_endpoint
