"""Opt-in repair/seed for TINTA's temporary test accounts.

Credentials are supplied only through Render environment variables; no passwords are
stored in source control. The patch is inert unless TINTA_TEST_ARTIST_EMAIL and
TINTA_TEST_ARTIST_PASSWORD are configured.
"""
import os
import uuid


def install(server):
    db = server.db
    hash_password = server.hash_password
    now_iso = server.now_iso

    artist_email = (os.environ.get("TINTA_TEST_ARTIST_EMAIL") or "").strip().lower()
    artist_password = os.environ.get("TINTA_TEST_ARTIST_PASSWORD") or ""
    customer_email = (os.environ.get("TINTA_TEST_CUSTOMER_EMAIL") or "").strip().lower()
    customer_password = os.environ.get("TINTA_TEST_CUSTOMER_PASSWORD") or ""

    if not artist_email or not artist_password:
        return

    async def repair():
        # Repair the temporary artist login without storing its password in source.
        artist_user = await db.users.find_one({"email": artist_email})
        if not artist_user:
            artist_user = {
                "id": str(uuid.uuid4()),
                "email": artist_email,
                "name": "TINTA Test Artist",
                "password_hash": hash_password(artist_password),
                "is_admin": False,
                "artist_portal": True,
                "role": "artist",
                "created_at": now_iso(),
            }
            await db.users.insert_one(artist_user)
        else:
            await db.users.update_one(
                {"id": artist_user["id"]},
                {"$set": {
                    "password_hash": hash_password(artist_password),
                    "is_admin": False,
                    "artist_portal": True,
                    "role": "artist",
                }},
            )

        artist = await db.artists.find_one({"artist_user_id": artist_user["id"]})
        if not artist:
            artist = {
                "id": str(uuid.uuid4()),
                "name": artist_user.get("name") or "TINTA Test Artist",
                "handle": "tinta-test-artist",
                "city": "Quezon City",
                "studio": "TINTA Test Studio",
                "address": "",
                "lat": 0.0,
                "lon": 0.0,
                "styles": ["Blackwork"],
                "bio": "TINTA temporary test artist account.",
                "bio_tl": "",
                "home_service_available": False,
                "home_service_fee": 0,
                "rate_per_hour": 1000,
                "avatar": "",
                "hero": "",
                "portfolio": [],
                "rating": 5.0,
                "reviews_count": 0,
                "active": True,
                "blocked_dates": [],
                "artist_user_id": artist_user["id"],
                "phone": "",
                "service_area": "",
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
            await db.artists.insert_one(artist)
        else:
            await db.artists.update_one(
                {"id": artist["id"]},
                {"$set": {"active": True, "updated_at": now_iso()}},
            )

    async def repair_customer():
        if not customer_email or not customer_password:
            return
        user = await db.users.find_one({"email": customer_email})
        if not user:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "email": customer_email,
                "name": "TINTA Test Customer",
                "password_hash": hash_password(customer_password),
                "is_admin": False,
                "created_at": now_iso(),
            })
        else:
            await db.users.update_one(
                {"id": user["id"]},
                {"$set": {
                    "password_hash": hash_password(customer_password),
                    "is_admin": False,
                }, "$unset": {"artist_portal": "", "role": ""}},
            )

    # FastAPI startup can await this patch's coroutine through the server startup hook.
    original_seed = getattr(server, "seed_data", None)
    if original_seed and not getattr(original_seed, "_tinta_test_accounts_wrapped", False):
        async def wrapped_seed_data(*args, **kwargs):
            result = await original_seed(*args, **kwargs)
            await repair()
            await repair_customer()
            return result
        wrapped_seed_data._tinta_test_accounts_wrapped = True
        server.seed_data = wrapped_seed_data
    else:
        # If startup has already been registered, schedule through the existing event loop.
        import asyncio
        loop = asyncio.get_event_loop()
        loop.create_task(repair())
        loop.create_task(repair_customer())
