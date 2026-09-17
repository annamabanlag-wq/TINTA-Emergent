"""Final pre-launch safety guards for TINTA.

This patch is intentionally additive: it wraps the existing live endpoints instead
of rewriting the booking, GCash, artist-application, or authentication systems.
"""

from __future__ import annotations

from typing import Optional
from functools import wraps
from urllib.parse import unquote, urlparse

from fastapi import Depends, Header, HTTPException
from fastapi.dependencies.utils import get_dependant
from fastapi.routing import APIRoute, request_response


def _replace_route(route: APIRoute, endpoint) -> None:
    route.endpoint = endpoint
    route.dependant = get_dependant(path=route.path_format, call=endpoint)
    route.app = request_response(route.get_route_handler())


def _path_from_file_ref(value: object) -> str:
    if not isinstance(value, str):
        return ""
    raw = value.strip()
    if not raw:
        return ""
    try:
        parsed = urlparse(raw)
        path = parsed.path or raw
    except Exception:
        path = raw
    marker = "/api/files/"
    if marker in path:
        path = path.split(marker, 1)[1]
    return unquote(path.lstrip("/"))


def _safe_storage_path(path: str) -> str:
    clean = unquote((path or "").strip()).lstrip("/")
    parts = clean.split("/")
    if not clean or any(part in {"", ".", ".."} for part in parts):
        raise HTTPException(404, "Not found")
    return clean


def install(server):
    app = server.app
    db = server.db
    current_user = server.current_user
    now_iso = server.now_iso

    # 1) Never allow an inactive/disabled artist to be directly viewed or booked.
    for route in list(app.routes):
        if not isinstance(route, APIRoute):
            continue

        if route.path == "/api/artists/{artist_id}" and "GET" in route.methods:
            original = route.endpoint
            if getattr(original, "_tinta_launch_artist_detail_guard", False):
                continue

            @wraps(original)
            async def guarded_artist_detail(artist_id: str, _original=original):
                artist = await db.artists.find_one({"id": artist_id}, {"_id": 0})
                if not artist or artist.get("active") is False:
                    raise HTTPException(404, "Artist not found")
                return await _original(artist_id)

            guarded_artist_detail._tinta_launch_artist_detail_guard = True
            _replace_route(route, guarded_artist_detail)

        elif route.path == "/api/bookings" and "POST" in route.methods:
            original = route.endpoint
            if getattr(original, "_tinta_launch_booking_guard", False):
                continue

            @wraps(original)
            async def guarded_booking(body, user=Depends(current_user), _original=original):
                artist = await db.artists.find_one({"id": body.artist_id}, {"_id": 0})
                if not artist or artist.get("active") is False:
                    raise HTTPException(404, "Artist is not available for booking")
                if artist.get("artist_user_id") == user.get("id"):
                    raise HTTPException(400, "You cannot book your own artist profile")
                return await _original(body, user)

            guarded_booking._tinta_launch_booking_guard = True
            _replace_route(route, guarded_booking)

        elif route.path == "/api/files/{path:path}" and "GET" in route.methods:
            original = route.endpoint
            if getattr(original, "_tinta_launch_file_guard", False):
                continue

            @wraps(original)
            async def guarded_file(
                path: str,
                token: Optional[str] = None,
                authorization: Optional[str] = Header(None),
                _original=original,
            ):
                clean_path = _safe_storage_path(path)
                auth = authorization or (f"Bearer {token}" if token else None)
                if not auth or not auth.startswith("Bearer "):
                    raise HTTPException(401, "Not authenticated")

                # Reuse the already-hardened session verifier instead of decoding JWTs twice.
                user = await current_user(auth)

                meta = await db.uploads.find_one({"path": clean_path}, {"_id": 0})
                if not meta:
                    raise HTTPException(404, "Not found")

                # Owner and admin access are always allowed.
                if meta.get("owner_id") != user.get("id") and not user.get("is_admin"):
                    # Artist may view only the customer's reference image attached to
                    # one of that artist's bookings. Government IDs and GCash receipts
                    # remain owner/admin-only.
                    artist = await db.artists.find_one(
                        {"artist_user_id": user.get("id")}, {"_id": 0, "id": 1}
                    )
                    if not artist:
                        raise HTTPException(403, "You do not have access to this file")

                    bookings = await db.bookings.find(
                        {"artist_id": artist["id"]},
                        {"_id": 0, "reference_image": 1},
                    ).to_list(500)
                    reference_paths = {
                        _path_from_file_ref(b.get("reference_image"))
                        for b in bookings
                        if b.get("reference_image")
                    }
                    if clean_path not in reference_paths:
                        raise HTTPException(403, "You do not have access to this file")

                # Keep the original storage response behavior after authorization.
                return await _original(
                    clean_path,
                    token=token,
                    authorization=authorization,
                )

            guarded_file._tinta_launch_file_guard = True
            _replace_route(route, guarded_file)

        elif route.path == "/api/auth/me" and "DELETE" in route.methods:
            original = route.endpoint
            if getattr(original, "_tinta_launch_delete_guard", False):
                continue

            @wraps(original)
            async def guarded_delete(user=Depends(current_user), _original=original):
                uid = user["id"]

                # Revoke any remaining device sessions before account deletion.
                await db.auth_sessions.update_many(
                    {"user_id": uid},
                    {"$set": {
                        "revoked": True,
                        "revoked_at": now_iso(),
                        "revoked_reason": "account_deleted",
                    }},
                )

                # Remove sensitive Artist onboarding records.
                await db.artist_applications.delete_many({"user_id": uid})

                # Make any artist profile non-public and remove PII/portfolio material.
                await db.artists.update_many(
                    {"artist_user_id": uid},
                    {"$set": {
                        "active": False,
                        "name": "Deleted Artist",
                        "handle": f"deleted-{uid[:8]}",
                        "studio": "",
                        "address": "",
                        "styles": [],
                        "bio": "",
                        "bio_tl": "",
                        "avatar": "",
                        "hero": "",
                        "portfolio": [],
                        "phone": "",
                        "service_area": "",
                        "updated_at": now_iso(),
                    }},
                    upsert=False,
                )

                # Remove upload metadata so old Government ID/receipt/reference paths
                # can no longer be served through the API.
                await db.uploads.delete_many({"owner_id": uid})

                return await _original(user)

            guarded_delete._tinta_launch_delete_guard = True
            _replace_route(route, guarded_delete)

    # 2) GCash launch surface: require an actual TINTA upload for receipts in production.
    for route in list(app.routes):
        if not isinstance(route, APIRoute):
            continue
        if route.path == "/api/payments/gcash/submit" and "POST" in route.methods:
            original = route.endpoint
            if getattr(original, "_tinta_launch_gcash_guard", False):
                continue

            @wraps(original)
            async def guarded_gcash(body, user=Depends(current_user), _original=original):
                receipt = str(getattr(body, "receipt_url", None) or "").strip()
                reference = str(getattr(body, "reference_number", None) or "").strip()

                test_mode = (
                    __import__("os").environ.get("TEST_PAYMENT_MODE", "false")
                    .strip()
                    .lower() == "true"
                )
                if not test_mode:
                    if not receipt:
                        raise HTTPException(422, "Upload your GCash receipt before submitting")
                    clean_path = _path_from_file_ref(receipt)
                    if not clean_path or (clean_path == receipt and "/api/files/" not in receipt):
                        raise HTTPException(422, "GCash receipt must be uploaded through TINTA")
                    meta = await db.uploads.find_one(
                        {"path": clean_path}, {"_id": 0, "owner_id": 1, "content_type": 1}
                    )
                    if (
                        not meta
                        or meta.get("owner_id") != user.get("id")
                        or not str(meta.get("content_type") or "").startswith("image/")
                    ):
                        raise HTTPException(422, "GCash receipt upload is invalid or not owned by this account")

                if not reference:
                    raise HTTPException(422, "GCash reference number is required")

                return await _original(body, user)

            guarded_gcash._tinta_launch_gcash_guard = True
            _replace_route(route, guarded_gcash)

    # 3) New approved artists should start at 0 reviews / 0.0 rating, not a seeded 5-star.
    for route in list(app.routes):
        if not isinstance(route, APIRoute):
            continue
        if route.path == "/api/admin/artist-applications/{application_id}/review" and "POST" in route.methods:
            original = route.endpoint
            if getattr(original, "_tinta_launch_review_guard", False):
                continue

            @wraps(original)
            async def guarded_artist_review(application_id: str, body, admin=Depends(server.require_admin), _original=original):
                result = await _original(application_id, body, admin)
                if getattr(body, "approved", False):
                    application = await db.artist_applications.find_one(
                        {"id": application_id}, {"_id": 0, "user_id": 1}
                    )
                    if application and application.get("user_id"):
                        artist = await db.artists.find_one(
                            {"artist_user_id": application["user_id"]}, {"_id": 0, "id": 1}
                        )
                        if artist:
                            await db.artists.update_one(
                                {"id": artist["id"]},
                                {"$set": {"rating": 0.0, "reviews_count": 0, "updated_at": now_iso()}},
                            )
                return result

            guarded_artist_review._tinta_launch_review_guard = True
            _replace_route(route, guarded_artist_review)

    print(
        "TINTA launch hardening installed: inactive-artist guard, private file access, "
        "GCash receipt ownership, account-deletion cleanup, new-artist rating reset"
    )
