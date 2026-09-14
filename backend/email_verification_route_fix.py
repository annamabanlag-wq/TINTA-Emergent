"""Make startup-installed email verification wrappers execute in FastAPI."""

def install(server_module):
    app = server_module.app
    for route in getattr(app, "routes", []):
        endpoint = getattr(route, "endpoint", None)
        if getattr(endpoint, "_tinta_email_verification", False) or getattr(endpoint, "_tinta_email_login_verification", False):
            dependant = getattr(route, "dependant", None)
            if dependant is not None:
                dependant.call = endpoint
