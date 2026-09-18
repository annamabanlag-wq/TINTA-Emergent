"""Normalize structured FastAPI errors so the existing TINTA web client displays readable messages."""
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def _plain_detail(detail):
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        parts = []
        for item in detail:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(str(item.get("msg") or item.get("message") or item.get("detail") or item))
            else:
                parts.append(str(item))
        return "; ".join(parts) or "Request failed"
    if isinstance(detail, dict):
        return str(detail.get("message") or detail.get("error") or detail.get("msg") or detail.get("detail") or detail)
    return str(detail) if detail is not None else "Request failed"


def _format_validation_error(exc: RequestValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = [str(x) for x in err.get("loc", []) if x != "body"]
        msg = str(err.get("msg") or "Invalid value")
        parts.append(f"{'.'.join(loc)}: {msg}" if loc else msg)
    return "; ".join(parts) or "Invalid request"


def install(module):
    async def validation_error_handler(_request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"detail": _format_validation_error(exc)})

    async def http_error_handler(_request, exc: HTTPException):
        headers = getattr(exc, "headers", None)
        return JSONResponse(status_code=exc.status_code, content={"detail": _plain_detail(exc.detail)}, headers=headers)

    module.app.add_exception_handler(RequestValidationError, validation_error_handler)
    module.app.add_exception_handler(HTTPException, http_error_handler)
    print("TINTA API error normalization installed")
