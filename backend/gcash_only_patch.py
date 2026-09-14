"""Keep the production payment surface aligned with TINTA's manual GCash launch flow."""

from fastapi import HTTPException


def install(server_module):
    app = server_module.app
    for route in getattr(app, "routes", []):
        path = getattr(route, "path", "")
        if path not in {"/api/payments/checkout-session", "/api/payments/verify"}:
            continue
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None or getattr(endpoint, "_tinta_gcash_guarded", False):
            continue

        async def guarded_endpoint(*args, **kwargs):
            raise HTTPException(
                status_code=410,
                detail="Card payments are disabled. Please use manual GCash payment.",
            )

        guarded_endpoint._tinta_gcash_guarded = True
        route.endpoint = guarded_endpoint
        dependant = getattr(route, "dependant", None)
        if dependant is not None:
            dependant.call = guarded_endpoint
