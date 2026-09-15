"""Production hardening for TINTA's manual GCash payment flow.

The launch payment method is manual GCash: customers submit proof and an admin
approves/rejects it. This patch replaces the existing route handlers at startup
so the security rules are enforced server-side without changing the UI.

A temporary server-side TEST_PAYMENT_MODE may be enabled for development. Test
payments must use a TEST-GCASH- reference and are explicitly marked as test
payments so they cannot be confused with a real GCash transfer.
"""

from fastapi import HTTPException
import hashlib
import os
import uuid
from urllib.parse import urlparse, unquote


def _internal_upload_path(url: str) -> str | None:
    """Return the storage path for a TINTA /api/files URL, otherwise None."""
    try:
        parsed = urlparse(url)
        marker = "/api/files/"
        if marker not in parsed.path:
            return None
        path = unquote(parsed.path.split(marker, 1)[1]).lstrip("/")
        if not path or ".." in path:
            return None
        return path
    except Exception:
        return None


def install(server_module):
    app = server_module.app
    db = server_module.db
    now_iso = server_module.now_iso
    compute_split = server_module.compute_split
    current_user = server_module.current_user
    require_admin = server_module.require_admin
    get_object = server_module.get_object
    DEPOSIT_AMOUNT_MAJOR = server_module.DEPOSIT_AMOUNT_MAJOR
    test_payment_mode = os.getenv("TEST_PAYMENT_MODE", "false").strip().lower() == "true"

    async def receipt_hash(receipt_url: str | None) -> str | None:
        """Hash an uploaded TINTA receipt so the exact same image cannot be reused."""
        path = _internal_upload_path(receipt_url or "")
        if not path:
            return None
        try:
            data, _ = await __import__("starlette").concurrency.run_in_threadpool(get_object, path)
            return hashlib.sha256(data).hexdigest()
        except Exception:
            # Do not make an otherwise valid payment fail solely because an old/external
            # receipt cannot be downloaded. The URL and upload ownership checks still apply.
            return None

    async def secure_submit(body, user=__import__("fastapi").Depends(current_user)):
        reference = (body.reference_number or "").strip()
        if len(reference) < 3:
            raise HTTPException(422, "GCash reference number is required")

        is_test_payment = test_payment_mode and reference.upper().startswith("TEST-GCASH-")

        booking = await db.bookings.find_one(
            {"id": body.booking_id, "user_id": user["id"]}, {"_id": 0}
        )
        if not booking:
            raise HTTPException(404, "Booking not found")
        if booking.get("payment_status") == "paid":
            raise HTTPException(409, "Booking is already paid")
        if booking.get("gcash_review_status") == "pending":
            raise HTTPException(409, "GCash payment is already pending verification")

        duplicate = await db.bookings.find_one(
            {
                "gcash_reference_number": reference,
                "id": {"$ne": booking["id"]},
                "gcash_review_status": {"$in": ["pending", "approved"]},
            },
            {"_id": 0, "id": 1},
        )
        if duplicate:
            raise HTTPException(409, "This GCash reference has already been submitted")

        total = int(booking.get("deposit", 0)) + int(booking.get("service_fee", 0))
        if total <= 0:
            total = DEPOSIT_AMOUNT_MAJOR

        receipt_url = (body.receipt_url or "").strip() or None
        if is_test_payment and not receipt_url:
            receipt_url = "https://placehold.co/600x800/png?text=TINTA+TEST+GCASH"
        if receipt_url and not (receipt_url.startswith("https://") or receipt_url.startswith("http://")):
            raise HTTPException(422, "Invalid receipt URL")
        if receipt_url and len(receipt_url) > 2000:
            raise HTTPException(422, "Receipt URL is too long")

        # A receipt uploaded through TINTA belongs to the submitting user. This prevents
        # one customer from attaching another customer's protected receipt URL.
        receipt_path = _internal_upload_path(receipt_url or "")
        if receipt_path:
            upload_meta = await db.uploads.find_one(
                {"path": receipt_path}, {"_id": 0, "owner_id": 1, "content_type": 1}
            )
            if not upload_meta or upload_meta.get("owner_id") != user["id"]:
                raise HTTPException(403, "Receipt upload does not belong to this account")
            if not (upload_meta.get("content_type") or "").startswith("image/"):
                raise HTTPException(422, "GCash receipt must be an image")

        # Exact-image duplicate protection. This catches the common failure where a user
        # selects an old receipt again but enters a brand-new GCash reference.
        current_hash = await receipt_hash(receipt_url)
        if current_hash:
            hash_duplicate = await db.bookings.find_one(
                {
                    "gcash_receipt_hash": current_hash,
                    "id": {"$ne": booking["id"]},
                    "gcash_review_status": {"$in": ["pending", "approved"]},
                },
                {"_id": 0, "id": 1},
            )
            if hash_duplicate:
                raise HTTPException(409, "This GCash receipt image has already been submitted")

            # Backward-compatible check for receipts saved before hashes were introduced.
            # It hashes existing internal receipt files lazily, so the fix also catches old
            # receipts already stored in TINTA rather than only receipts uploaded after deploy.
            old_receipts = await db.bookings.find(
                {
                    "gcash_receipt_url": {"$type": "string"},
                    "id": {"$ne": booking["id"]},
                    "gcash_review_status": {"$in": ["pending", "approved"]},
                },
                {"_id": 0, "id": 1, "gcash_receipt_url": 1, "gcash_receipt_hash": 1},
            ).sort("created_at", -1).to_list(200)
            for old in old_receipts:
                if old.get("gcash_receipt_hash") == current_hash:
                    raise HTTPException(409, "This GCash receipt image has already been submitted")
                if old.get("gcash_receipt_hash"):
                    continue
                old_hash = await receipt_hash(old.get("gcash_receipt_url"))
                if old_hash and old_hash == current_hash:
                    raise HTTPException(409, "This GCash receipt image has already been submitted")
                if old_hash:
                    await db.bookings.update_one(
                        {"id": old["id"], "gcash_receipt_hash": {"$exists": False}},
                        {"$set": {"gcash_receipt_hash": old_hash}},
                    )

        result = await db.bookings.update_one(
            {
                "id": booking["id"],
                "user_id": user["id"],
                "payment_status": {"$ne": "paid"},
                "gcash_review_status": {"$ne": "pending"},
            },
            {"$set": {
                "payment_method": "gcash",
                "gcash_reference_number": reference,
                "gcash_receipt_url": receipt_url,
                "gcash_receipt_hash": current_hash,
                "gcash_review_status": "pending",
                "gcash_submitted_at": now_iso(),
                "gcash_admin_note": "TEST PAYMENT — NO REAL GCASH TRANSFER" if is_test_payment else None,
                "amount_submitted": total,
                "payment_status": "unpaid",
                "is_test_payment": is_test_payment,
            }},
        )
        if result.modified_count != 1:
            raise HTTPException(409, "GCash payment submission changed; please try again")

        return {
            "submitted": True,
            "status": "pending_verification",
            "booking_id": booking["id"],
            "amount": total,
            "test_payment": is_test_payment,
            "message": "TEST GCash payment submitted for verification" if is_test_payment else "GCash payment submitted for verification",
        }

    async def secure_review(booking_id: str, body, _=__import__("fastapi").Depends(require_admin)):
        booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking:
            raise HTTPException(404, "Booking not found")
        if booking.get("payment_method") != "gcash":
            raise HTTPException(400, "This booking is not a GCash payment")

        if booking.get("gcash_review_status") != "pending":
            if booking.get("payment_status") == "paid" and booking.get("gcash_review_status") == "approved":
                return {"reviewed": True, "approved": True, "booking_id": booking_id, "message": "Payment is already approved"}
            raise HTTPException(409, "There is no pending GCash payment to review")

        if not body.approved:
            result = await db.bookings.update_one(
                {
                    "id": booking_id,
                    "payment_status": "unpaid",
                    "gcash_review_status": "pending",
                },
                {"$set": {
                    "gcash_review_status": "rejected",
                    "gcash_admin_note": body.admin_note,
                    "gcash_reviewed_at": now_iso(),
                    "payment_status": "unpaid",
                }},
            )
            if result.modified_count != 1:
                raise HTTPException(409, "Payment review was already completed")
            return {"reviewed": True, "approved": False, "booking_id": booking_id, "message": "GCash payment rejected"}

        total = int(booking.get("deposit", 0)) + int(booking.get("service_fee", 0))
        if total <= 0:
            total = DEPOSIT_AMOUNT_MAJOR
        split = compute_split(total)
        payment_id = f"gcash_manual_{uuid.uuid4().hex}"
        reviewed_at = now_iso()

        result = await db.bookings.update_one(
            {
                "id": booking_id,
                "payment_status": "unpaid",
                "gcash_review_status": "pending",
                "payment_method": "gcash",
            },
            {"$set": {
                "payment_status": "paid",
                "payment_intent_id": payment_id,
                "paid_at": reviewed_at,
                "amount_paid": total,
                "commission_amount": split["commission"],
                "artist_earnings": split["artist_net"],
                "commission_pct": split["commission_pct"],
                "gcash_review_status": "approved",
                "gcash_admin_note": body.admin_note,
                "gcash_reviewed_at": reviewed_at,
            }},
        )
        if result.modified_count != 1:
            raise HTTPException(409, "Payment review was already completed")

        await db.earnings_ledger.update_one(
            {"booking_id": booking_id},
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "booking_id": booking_id,
                "artist_id": booking["artist_id"],
                "artist_name": booking["artist_name"],
                "user_id": booking["user_id"],
                "gross": total,
                "commission_pct": split["commission_pct"],
                "commission": split["commission"],
                "artist_net": split["artist_net"],
                "payment_intent_id": payment_id,
                "status": "pending_payout",
                "is_test_payment": bool(booking.get("is_test_payment")),
                "created_at": reviewed_at,
            }},
            upsert=True,
        )

        return {
            "reviewed": True,
            "approved": True,
            "booking_id": booking_id,
            "amount": total,
            "commission": split["commission"],
            "artist_net": split["artist_net"],
            "test_payment": bool(booking.get("is_test_payment")),
            "message": "TEST GCash payment approved" if booking.get("is_test_payment") else "GCash payment approved",
        }

    replacements = {
        "/api/payments/gcash/submit": secure_submit,
        "/api/admin/gcash-payments/{booking_id}/review": secure_review,
    }
    for route in getattr(app, "routes", []):
        endpoint = replacements.get(getattr(route, "path", ""))
        if endpoint is None:
            continue
        route.endpoint = endpoint
        dependant = getattr(route, "dependant", None)
        if dependant is not None:
            dependant.call = endpoint
