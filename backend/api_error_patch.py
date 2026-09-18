"""Normalize FastAPI validation errors to plain text for the TINTA web client."""

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def _format_validation_error(exc: RequestValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = [str(x) for x in err.get("loc", []) if x != "body"]
        msg = str(err.get("msg") or "Invalid value")
        parts.append(f"{'.'.join(loc)}: {msg}" if loc else msg)
    return "; ".join(parts) or "Invalid request"


def install(module):
    async def validation_error_handler(_request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={"detail": _format_validation_error(exc)},
        )

    module.app.add_exception_handler(RequestValidationError, validation_error_handler)
    print("TINTA validation error normalization installed")
