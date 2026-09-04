"""Tests for new features (iteration 2):
- Featured (deal of the week)
- Favorites (toggle/ids/list)
- Upload (multipart image + file serve auth)
- Stripe checkout (mock path), mock-confirm, verify, cross-user 403/404
- Booking default payment_status=unpaid and reference_image field
"""
import io
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://tattoo-reserve-7.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@inked.dev"
DEMO_PASSWORD = "testpass123"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def demo_auth(s):
    r = s.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    uid = r.json()["user"]["id"]
    return {"token": tok, "user_id": uid, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def other_auth(s):
    email = f"TEST_other+{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}@ink.dev"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "Otto"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return {"token": tok, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def artists(s):
    r = s.get(f"{API}/artists")
    assert r.status_code == 200
    return r.json()


# 1x1 png bytes (transparent)
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xfa\xcf\x00\x00"
    b"\x00\x02\x00\x01\xe5\'\xdeI\x00\x00\x00\x00IEND\xaeB`\x82"
)


# ---------- Featured ----------
class TestFeatured:
    def test_featured_shape(self, s):
        r = s.get(f"{API}/featured")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("artist", "headline", "story", "deal_ends_at", "discount_pct"):
            assert k in d, f"missing {k}"
        assert d["headline"] == "ARTIST OF THE WEEK"
        assert isinstance(d["discount_pct"], int)
        assert "id" in d["artist"] and "name" in d["artist"]


# ---------- Favorites ----------
class TestFavorites:
    def test_toggle_on_off(self, s, demo_auth, artists):
        aid = artists[-1]["id"]
        # ensure clean: fetch ids and toggle off if present
        cur = s.get(f"{API}/favorites/ids", headers=demo_auth["headers"]).json()
        if aid in cur:
            s.post(f"{API}/favorites/toggle", json={"artist_id": aid}, headers=demo_auth["headers"])

        r1 = s.post(f"{API}/favorites/toggle", json={"artist_id": aid}, headers=demo_auth["headers"])
        assert r1.status_code == 200
        assert r1.json()["favorited"] is True

        ids = s.get(f"{API}/favorites/ids", headers=demo_auth["headers"]).json()
        assert aid in ids

        favs = s.get(f"{API}/favorites", headers=demo_auth["headers"]).json()
        assert any(a["id"] == aid for a in favs)

        # toggle off
        r2 = s.post(f"{API}/favorites/toggle", json={"artist_id": aid}, headers=demo_auth["headers"])
        assert r2.status_code == 200
        assert r2.json()["favorited"] is False

        ids2 = s.get(f"{API}/favorites/ids", headers=demo_auth["headers"]).json()
        assert aid not in ids2

    def test_favorites_require_auth(self, s):
        assert s.get(f"{API}/favorites/ids").status_code == 401
        assert s.get(f"{API}/favorites").status_code == 401
        assert s.post(f"{API}/favorites/toggle", json={"artist_id": "x"}).status_code == 401


# ---------- Upload + file serve ----------
class TestUpload:
    uploaded_path = None
    uploaded_url = None

    def test_upload_requires_auth(self, s):
        r = s.post(f"{API}/upload", files={"file": ("t.png", io.BytesIO(PNG_BYTES), "image/png")})
        assert r.status_code == 401

    def test_upload_rejects_non_image(self, s, demo_auth):
        r = s.post(
            f"{API}/upload",
            files={"file": ("t.txt", io.BytesIO(b"hello"), "text/plain")},
            headers=demo_auth["headers"],
        )
        assert r.status_code == 400

    def test_upload_image_ok(self, s, demo_auth):
        r = s.post(
            f"{API}/upload",
            files={"file": ("ref.png", io.BytesIO(PNG_BYTES), "image/png")},
            headers=demo_auth["headers"],
        )
        # Storage may be unavailable in this env; allow 503 as skip
        if r.status_code == 503:
            pytest.skip("Object storage unavailable in this environment")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("url", "path", "size"):
            assert k in d
        assert d["size"] == len(PNG_BYTES)
        TestUpload.uploaded_path = d["path"]
        TestUpload.uploaded_url = d["url"]

    def test_serve_file_requires_auth(self, s):
        if not TestUpload.uploaded_path:
            pytest.skip("No upload available")
        r = s.get(f"{API}/files/{TestUpload.uploaded_path}")
        assert r.status_code == 401

    def test_serve_file_with_bearer(self, s, demo_auth):
        if not TestUpload.uploaded_path:
            pytest.skip("No upload available")
        r = s.get(f"{API}/files/{TestUpload.uploaded_path}", headers=demo_auth["headers"])
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")

    def test_serve_file_with_token_query(self, s, demo_auth):
        if not TestUpload.uploaded_path:
            pytest.skip("No upload available")
        r = s.get(f"{API}/files/{TestUpload.uploaded_path}", params={"token": demo_auth["token"]})
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("image/")


# ---------- Bookings default payment_status + reference_image ----------
class TestBookingPayment:
    _booking_id = None
    _session_id = None

    def test_booking_default_unpaid_and_reference(self, s, demo_auth, artists):
        aid = artists[0]["id"]
        payload = {
            "artist_id": aid,
            "date": "2026-03-11",
            "time_slot": "15:00",
            "description": "TEST_new payment flow",
            "estimated_hours": 2,
            "reference_image": "https://example.com/ref.png",
        }
        r = s.post(f"{API}/bookings", json=payload, headers=demo_auth["headers"])
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["payment_status"] == "unpaid"
        assert b["reference_image"] == "https://example.com/ref.png"
        assert b["checkout_session_id"] in (None, "")
        TestBookingPayment._booking_id = b["id"]


# ---------- Stripe mock flow ----------
class TestStripeMock:
    def test_checkout_returns_mock_session(self, s, demo_auth):
        bid = TestBookingPayment._booking_id
        assert bid, "booking must exist"
        r = s.post(
            f"{API}/payments/checkout-session",
            json={"booking_id": bid, "platform": "web"},
            headers=demo_auth["headers"],
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("mock") is True
        assert d["session_id"].startswith("mock_")
        assert "checkout_url" in d and "mock-checkout" in d["checkout_url"]
        TestBookingPayment._session_id = d["session_id"]

        # Verify booking updated with checkout_session_id and still unpaid
        blist = s.get(f"{API}/bookings", headers=demo_auth["headers"]).json()
        b = next(x for x in blist if x["id"] == bid)
        assert b["checkout_session_id"] == d["session_id"]
        assert b["payment_status"] == "unpaid"

    def test_verify_before_confirm_returns_unpaid(self, s, demo_auth):
        sid = TestBookingPayment._session_id
        r = s.get(f"{API}/payments/verify/{sid}", headers=demo_auth["headers"])
        assert r.status_code == 200
        d = r.json()
        assert d["paid"] is False
        assert d["payment_status"] == "unpaid"
        assert d["mock"] is True

    def test_mock_confirm_marks_paid(self, s, demo_auth):
        sid = TestBookingPayment._session_id
        r = s.post(
            f"{API}/payments/mock-confirm",
            json={"session_id": sid},
            headers=demo_auth["headers"],
        )
        assert r.status_code == 200, r.text
        assert r.json()["paid"] is True

        # Confirm booking updated
        blist = s.get(f"{API}/bookings", headers=demo_auth["headers"]).json()
        b = next(x for x in blist if x["id"] == TestBookingPayment._booking_id)
        assert b["payment_status"] == "paid"
        assert b["payment_intent_id"] and b["payment_intent_id"].startswith("pi_mock_")

    def test_verify_after_confirm_returns_paid(self, s, demo_auth):
        sid = TestBookingPayment._session_id
        r = s.get(f"{API}/payments/verify/{sid}", headers=demo_auth["headers"])
        assert r.status_code == 200
        d = r.json()
        assert d["paid"] is True
        assert d["payment_status"] == "paid"
        assert d["mock"] is True

    def test_cross_user_cannot_verify(self, s, other_auth):
        sid = TestBookingPayment._session_id
        r = s.get(f"{API}/payments/verify/{sid}", headers=other_auth["headers"])
        # Should be 404 (mock path checks user_id filter) or 403
        assert r.status_code in (403, 404), f"expected 403/404 got {r.status_code}"

    def test_cannot_repay_paid_booking(self, s, demo_auth):
        bid = TestBookingPayment._booking_id
        r = s.post(
            f"{API}/payments/checkout-session",
            json={"booking_id": bid, "platform": "web"},
            headers=demo_auth["headers"],
        )
        assert r.status_code == 409, r.text
