"""Extra signup validation without rewriting the existing auth implementation."""
from email_validator import EmailNotValidError, validate_email
from fastapi import HTTPException


def install(server_module):
    for route in getattr(server_module.api_router, "routes", []):
        if getattr(route, "path", None) == "/auth/register" and getattr(route, "methods", set()) == {"POST"}:
            original = route.endpoint
            if getattr(original, "_tinta_email_validation", False):
                return

            async def validated_register(body):
                try:
                    result = validate_email(body.email, check_deliverability=True)
                    body.email = result.normalized
                except EmailNotValidError:
                    raise HTTPException(422, "Please enter a real, reachable email address.")
                return await original(body)

            validated_register._tinta_email_validation = True
            route.endpoint = validated_register
            return
