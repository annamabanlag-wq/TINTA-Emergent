"""Iteration 6 tests: payment_method (card/gcash/maya) on /api/payments/checkout-session,
mock-confirm flow, and regression on PHP rates."""
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
def auth_headers(s):
    r = s.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Content-Type": "application/json", "Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def artists(s):
    return s.get(f"{API}/artists").json()


def _new_booking(s, auth_headers, artist_id, slot="09:00"):
    # far-future date/time to avoid conflicts (unique slot each call)
    ts = f"{(int(time.time()*1000) % 100)+10:02d}:00"  # 10-99 will overflow; safer below
    payload = {
        "artist_id": artist_id,
        "date": f"2030-0{(uuid.uuid4().int % 9)+1}-15",
        "time_slot": slot,
        "description": "TEST_iteration6 booking",
        "estimated_hours": 2,
    }
    r = s.post(f"{API}/bookings", json=payload, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- PHP rates regression ----------
class TestPHPRegression:
    def test_artists_have_php_rates(self, artists):
        assert len(artists) >= 6
        for a in artists:
            assert a["rate_per_hour"] >= 10000, f"Artist {a['name']} rate {a['rate_per_hour']} is not PHP scale"


# ---------- Payment method ----------
class TestPaymentMethodCheckout:
    def _create(self, s, auth_headers, artists, method, slot):
        b = _new_booking(s, auth_headers, artists[0]["id"], slot=slot)
        r = s.post(
            f"{API}/payments/checkout-session",
            json={"booking_id": b["id"], "platform": "web", "payment_method": method},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["mock"] is True, "Stripe placeholder should force mock path"
        assert data["payment_method"] == method
        assert f"method={method}" in data["checkout_url"]
        assert data["session_id"].startswith("mock_")
        # Verify persistence on booking
        listing = s.get(f"{API}/bookings", headers=auth_headers).json()
        found = [x for x in listing if x["id"] == b["id"]][0]
        assert found.get("payment_method") == method
        assert found.get("checkout_session_id") == data["session_id"]
        return b, data

    def test_card(self, s, auth_headers, artists):
        self._create(s, auth_headers, artists, "card", "08:00")

    def test_gcash(self, s, auth_headers, artists):
        self._create(s, auth_headers, artists, "gcash", "08:30")

    def test_maya(self, s, auth_headers, artists):
        self._create(s, auth_headers, artists, "maya", "09:30")

    def test_unknown_method_rejected(self, s, auth_headers, artists):
        b = _new_booking(s, auth_headers, artists[0]["id"], slot="10:15")
        r = s.post(
            f"{API}/payments/checkout-session",
            json={"booking_id": b["id"], "payment_method": "paypal"},
            headers=auth_headers,
        )
        assert r.status_code == 400

    def test_mock_confirm_gcash(self, s, auth_headers, artists):
        b, data = self._create(s, auth_headers, artists, "gcash", "11:15")
        r = s.post(f"{API}/payments/mock-confirm", json={"session_id": data["session_id"]}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["paid"] is True
        # Verify persistence
        listing = s.get(f"{API}/bookings", headers=auth_headers).json()
        found = [x for x in listing if x["id"] == b["id"]][0]
        assert found["payment_status"] == "paid"
        assert found["payment_method"] == "gcash"

    def test_mock_confirm_maya(self, s, auth_headers, artists):
        b, data = self._create(s, auth_headers, artists, "maya", "12:15")
        r = s.post(f"{API}/payments/mock-confirm", json={"session_id": data["session_id"]}, headers=auth_headers)
        assert r.status_code == 200
        # Verify persistence
        listing = s.get(f"{API}/bookings", headers=auth_headers).json()
        found = [x for x in listing if x["id"] == b["id"]][0]
        assert found["payment_status"] == "paid"
        assert found["payment_method"] == "maya"

    def test_checkout_requires_auth(self, s):
        r = s.post(f"{API}/payments/checkout-session", json={"booking_id": "x", "payment_method": "card"})
        assert r.status_code == 401
