"""Serve the exported Expo web app from the same Render image as the FastAPI backend.

The image build places frontend/dist at /app/frontend_dist. This patch runs after
server.py has been imported, so the existing API routes stay ahead of the SPA
fallback route.
"""
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import FileResponse


def install(module):
    app = module.app
    dist = Path(module.__file__).resolve().parent / "frontend_dist"
    index = dist / "index.html"

    if not index.is_file():
        print("TINTA frontend host patch: frontend_dist/index.html not found; API-only mode")
        return

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _tinta_frontend(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")

        candidate = (dist / full_path).resolve()
        try:
            candidate.relative_to(dist.resolve())
        except ValueError:
            raise HTTPException(status_code=404, detail="Not found")

        if candidate.is_file():
            return FileResponse(candidate)

        return FileResponse(index)

    print("TINTA frontend host patch installed: frontend served from the backend image")
