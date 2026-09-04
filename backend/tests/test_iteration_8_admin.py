"""Iteration 8 — Admin dashboard + business management backend tests.

Covers:
  * Admin authentication (is_admin flag on login)
  * RBAC gating (401/403/200) on /api/admin/*
  * Admin stats (users/artists/bookings/revenue/commission_pct=15)
  * Admin users list + toggle-admin
  * Admin artists list, create, patch (incl. blocked_dates), delete (soft)
  * Admin bookings filter + refund
  * Admin commissions per-artist breakdown
  * Admin payouts create + list + duplicate-empty 400
  * Artist availability includes day_blocked/blocked_dates
  * Customer regression: register -> book -> checkout -> mock-confirm
    -> creates earnings_ledger with 15% commission
  * Cancel booking >48h -> refunded + ledger refunded
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://tattoo-reserve-7.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@inked.dev"
ADMIN_PASSWORD = "admin123"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def sess():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(sess):
    r = sess.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["user"]["is_admin"] is True
    return data["access_token"]


@pytest.fixture(scope="session")
def customer(sess):
    # Fresh customer to isolate assertions
    email = f"TEST_admincust_{uuid.uuid4().hex[:8]}@ink.dev"
    r = sess.post(f"{API}/auth/register", json={"email": email, "password": "testpass123", "name": "TEST_Cust"})
    assert r.status_code == 200
    data = r.json()
    return {"token": data["access_token"], "id": data["user"]["id"], "email": email}


@pytest.fixture(scope="session")
def artists(sess):
    r = sess.get(f"{API}/artists")
    assert r.status_code == 200
    lst = r.json()
    assert len(lst) >= 3
    return lst


def auth_hdr(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ---------- Auth: admin flag ----------
class TestAuthAdminFlag:
    def test_admin_login_returns_is_admin_true(self, sess):
        r = sess.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        assert r.json()["user"]["is_admin"] is True

    def test_regular_user_has_is_admin_false(self, sess, customer):
        r = sess.post(f"{API}/auth/login", json={"email": customer["email"], "password": "testpass123"})
        assert r.status_code == 200
        assert r.json()["user"]["is_admin"] is False


# ---------- RBAC ----------
class TestAdminRBAC:
    def test_stats_no_token_returns_401(self, sess):
        r = sess.get(f"{API}/admin/stats")
        assert r.status_code == 401

    def test_stats_non_admin_returns_403(self, sess, customer):
        r = sess.get(f"{API}/admin/stats", headers=auth_hdr(customer["token"]))
        assert r.status_code == 403

    def test_stats_admin_returns_200(self, sess, admin_token):
        r = sess.get(f"{API}/admin/stats", headers=auth_hdr(admin_token))
        assert r.status_code == 200


# ---------- Admin stats ----------
class TestAdminStats:
    def test_stats_structure(self, sess, admin_token):
        r = sess.get(f"{API}/admin/stats", headers=auth_hdr(admin_token))
        assert r.status_code == 200
        d = r.json()
        assert "users" in d and isinstance(d["users"], int)
        assert "artists" in d and isinstance(d["artists"], int)
        for key in ("total", "paid", "refunded", "cancelled"):
            assert key in d["bookings"], f"missing bookings.{key}"
        for key in ("gross", "commission_earned", "artist_earnings", "pending_payouts"):
            assert key in d["revenue"], f"missing revenue.{key}"
        assert d["commission_pct"] == 15


# ---------- Admin users ----------
class TestAdminUsers:
    def test_list_users_has_bookings_count(self, sess, admin_token):
        r = sess.get(f"{API}/admin/users", headers=auth_hdr(admin_token))
        assert r.status_code == 200
        users = r.json()
        assert len(users) > 0
        for u in users:
            assert "bookings_count" in u
            assert "password_hash" not in u

    def test_toggle_admin_flips_flag(self, sess, admin_token, customer):
        # promote
        r = sess.post(f"{API}/admin/users/{customer['id']}/toggle-admin", headers=auth_hdr(admin_token))
        assert r.status_code == 200
        assert r.json()["is_admin"] is True
        # verify
        u = sess.get(f"{API}/admin/users", headers=auth_hdr(admin_token)).json()
        promoted = next(x for x in u if x["id"] == customer["id"])
        assert promoted["is_admin"] is True
        # demote
        r = sess.post(f"{API}/admin/users/{customer['id']}/toggle-admin", headers=auth_hdr(admin_token))
        assert r.status_code == 200
        assert r.json()["is_admin"] is False


# ---------- Admin artists CRUD ----------
class TestAdminArtistsCRUD:
    def test_list_artists_earnings(self, sess, admin_token):
        r = sess.get(f"{API}/admin/artists", headers=auth_hdr(admin_token))
        assert r.status_code == 200
        for a in r.json():
            for k in ("pending_earnings", "pending_count", "paid_out_total", "bookings_count"):
                assert k in a, f"missing {k}"

    def test_create_patch_delete_artist(self, sess, admin_token):
        payload = {
            "name": f"TEST_Artist_{uuid.uuid4().hex[:6]}",
            "handle": f"@test_{uuid.uuid4().hex[:6]}",
            "city": "Manila, PH",
            "studio": "TEST_Studio",
            "styles": ["Blackwork"],
            "bio": "TEST bio",
            "rate_per_hour": 9000,
            "avatar": "https://example.com/a.jpg",
            "hero": "https://example.com/h.jpg",
        }
        r = sess.post(f"{API}/admin/artists", json=payload, headers=auth_hdr(admin_token))
        assert r.status_code == 200, r.text
        art = r.json()
        aid = art["id"]
        assert art["name"] == payload["name"]

        # PATCH — update blocked_dates + bio
        patch = {"bio": "TEST bio updated", "blocked_dates": ["2027-12-25", "2027-12-31"]}
        r = sess.patch(f"{API}/admin/artists/{aid}", json=patch, headers=auth_hdr(admin_token))
        assert r.status_code == 200
        upd = r.json()
        assert upd["bio"] == "TEST bio updated"
        assert set(upd["blocked_dates"]) == {"2027-12-25", "2027-12-31"}

        # GET availability shows blocked_dates
        r = sess.get(f"{API}/artists/{aid}/availability", params={"date": "2027-12-25"})
        assert r.status_code == 200
        av = r.json()
        assert "booked_slots" in av and "day_blocked" in av and "blocked_dates" in av
        assert av["day_blocked"] is True

        # DELETE (no bookings) — hard delete
        r = sess.delete(f"{API}/admin/artists/{aid}", headers=auth_hdr(admin_token))
        assert r.status_code == 200
        assert r.json()["deleted"] is True


# ---------- Admin bookings & refund + full customer regression ----------
class TestBookingFlowAndAdmin:
    booking_id = None
    session_id = None
    artist_id = None

    def test_customer_create_booking(self, sess, customer, artists):
        art = artists[0]
        TestBookingFlowAndAdmin.artist_id = art["id"]
        payload = {
            "artist_id": art["id"],
            "date": "2027-06-15",
            "time_slot": "14:00",
            "description": "TEST_iter8 admin flow booking with description longer than 5 chars",
            "estimated_hours": 2,
        }
        r = sess.post(f"{API}/bookings", json=payload, headers=auth_hdr(customer["token"]))
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["payment_status"] == "unpaid"
        assert b["deposit"] == 2900
        TestBookingFlowAndAdmin.booking_id = b["id"]

    def test_checkout_session_mock(self, sess, customer):
        r = sess.post(
            f"{API}/payments/checkout-session",
            json={"booking_id": TestBookingFlowAndAdmin.booking_id, "platform": "web", "payment_method": "card"},
            headers=auth_hdr(customer["token"]),
        )
        assert r.status_code == 200
        d = r.json()
        assert d["mock"] is True
        assert d["checkout_url"].startswith("http")
        assert "/mock-checkout" in d["checkout_url"]
        TestBookingFlowAndAdmin.session_id = d["session_id"]

    def test_mock_confirm_creates_ledger_with_15_percent(self, sess, customer):
        r = sess.post(
            f"{API}/payments/mock-confirm",
            json={"session_id": TestBookingFlowAndAdmin.session_id},
            headers=auth_hdr(customer["token"]),
        )
        assert r.status_code == 200
        assert r.json()["paid"] is True

        # Verify booking now paid
        r = sess.get(f"{API}/bookings", headers=auth_hdr(customer["token"]))
        assert r.status_code == 200
        b = next(x for x in r.json() if x["id"] == TestBookingFlowAndAdmin.booking_id)
        assert b["payment_status"] == "paid"

        # Admin: check commissions include this artist
        r = sess.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        atok = r.json()["access_token"]
        cr = sess.get(f"{API}/admin/commissions", headers=auth_hdr(atok))
        assert cr.status_code == 200
        rows = cr.json()
        assert isinstance(rows, list) and len(rows) > 0
        for row in rows:
            for k in ("artist_id", "artist_name", "bookings", "gross", "commission", "artist_net"):
                assert k in row
            # 15% math: commission ~= 15% of gross
            expected = round(row["gross"] * 0.15)
            assert abs(row["commission"] - expected) <= 1, f"commission mismatch: {row}"
            assert row["artist_net"] == row["gross"] - row["commission"]

    def test_admin_bookings_filter_and_email_attached(self, sess, admin_token, customer):
        # all
        r = sess.get(f"{API}/admin/bookings", headers=auth_hdr(admin_token))
        assert r.status_code == 200
        all_b = r.json()
        found = next((x for x in all_b if x["id"] == TestBookingFlowAndAdmin.booking_id), None)
        assert found is not None
        assert found["user_email"] == customer["email"].lower()
        assert "user_name" in found

        # paid filter
        r = sess.get(f"{API}/admin/bookings", params={"payment_status": "paid"}, headers=auth_hdr(admin_token))
        assert r.status_code == 200
        assert all(x["payment_status"] == "paid" for x in r.json())

        # unpaid filter
        r = sess.get(f"{API}/admin/bookings", params={"payment_status": "unpaid"}, headers=auth_hdr(admin_token))
        assert r.status_code == 200
        assert all(x["payment_status"] == "unpaid" for x in r.json())

    def test_admin_payout_and_duplicate_400(self, sess, admin_token):
        # Payout for the artist we just paid
        r = sess.post(
            f"{API}/admin/payouts",
            json={"artist_id": TestBookingFlowAndAdmin.artist_id, "note": "TEST_iter8 payout"},
            headers=auth_hdr(admin_token),
        )
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["amount"] > 0
        assert p["count"] >= 1
        assert TestBookingFlowAndAdmin.booking_id in p["booking_ids"]

        # List payouts includes it
        r = sess.get(f"{API}/admin/payouts", headers=auth_hdr(admin_token))
        assert r.status_code == 200
        assert any(x["id"] == p["id"] for x in r.json())

        # Second call with no pending -> 400
        r = sess.post(
            f"{API}/admin/payouts",
            json={"artist_id": TestBookingFlowAndAdmin.artist_id, "note": "duplicate"},
            headers=auth_hdr(admin_token),
        )
        assert r.status_code == 400

    def test_admin_refund_paid_booking(self, sess, admin_token, customer, artists):
        # New booking + pay it, then refund via admin endpoint (test isolated)
        art = artists[1]
        r = sess.post(
            f"{API}/bookings",
            json={
                "artist_id": art["id"],
                "date": "2027-07-20",
                "time_slot": "15:00",
                "description": "TEST_iter8 refund path booking",
                "estimated_hours": 2,
            },
            headers=auth_hdr(customer["token"]),
        )
        assert r.status_code == 200
        bid = r.json()["id"]
        cs = sess.post(
            f"{API}/payments/checkout-session",
            json={"booking_id": bid, "platform": "web", "payment_method": "card"},
            headers=auth_hdr(customer["token"]),
        ).json()
        sess.post(f"{API}/payments/mock-confirm", json={"session_id": cs["session_id"]}, headers=auth_hdr(customer["token"]))

        r = sess.post(f"{API}/admin/bookings/{bid}/refund", headers=auth_hdr(admin_token))
        assert r.status_code == 200, r.text
        assert r.json()["refunded"] is True

        # Verify booking payment_status=refunded via admin list
        r = sess.get(f"{API}/admin/bookings", params={"payment_status": "refunded"}, headers=auth_hdr(admin_token))
        assert r.status_code == 200
        assert any(x["id"] == bid for x in r.json())

    def test_customer_cancel_far_future_refunded(self, sess, customer, artists):
        # Create + pay a far-future booking, then cancel (>48h) -> refunded + ledger refunded
        art = artists[2]
        r = sess.post(
            f"{API}/bookings",
            json={
                "artist_id": art["id"],
                "date": "2028-01-15",
                "time_slot": "12:00",
                "description": "TEST_iter8 self-cancel path",
                "estimated_hours": 2,
            },
            headers=auth_hdr(customer["token"]),
        )
        bid = r.json()["id"]
        cs = sess.post(
            f"{API}/payments/checkout-session",
            json={"booking_id": bid, "platform": "web", "payment_method": "card"},
            headers=auth_hdr(customer["token"]),
        ).json()
        sess.post(f"{API}/payments/mock-confirm", json={"session_id": cs["session_id"]}, headers=auth_hdr(customer["token"]))

        r = sess.post(f"{API}/bookings/{bid}/cancel", headers=auth_hdr(customer["token"]))
        assert r.status_code == 200
        b = r.json()
        assert b["status"] == "cancelled"
        assert b["payment_status"] == "refunded"
