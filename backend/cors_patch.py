"""Fix CORS for authenticated browser requests from the Render frontends."""


def install(module):
    app = getattr(module, "app", None)
    if app is None:
        return

    # The original server used allow_origins=["*"] together with
    # allow_credentials=True. Browsers reject authenticated requests in that
    # configuration, which surfaces to the Expo web client as "Failed to fetch".
    # Replace the CORS options before FastAPI builds its middleware stack.
    for middleware in getattr(app, "user_middleware", []):
        cls = getattr(middleware, "cls", None)
        if getattr(cls, "__name__", "") != "CORSMiddleware":
            continue
        kwargs = getattr(middleware, "kwargs", {})
        kwargs["allow_credentials"] = True
        kwargs["allow_origins"] = [
            "https://t-1.onrender.com",
            "https://tinta-artist.onrender.com",
            "https://tinta-admin.onrender.com",
        ]
        kwargs["allow_origin_regex"] = r"^https://[A-Za-z0-9-]+\.onrender\.com$"
        kwargs["allow_methods"] = ["*"]
        kwargs["allow_headers"] = ["*"]
        middleware.kwargs = kwargs
        return
