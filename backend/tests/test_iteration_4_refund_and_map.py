"""Iteration 4 tests for: deposit-refund on cancel, no-refund within 48h,
unpaid cancel, and artist location backfill (address/lat/lon)."""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://tattoo-reserve-7.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@inked.dev"
DEMO_PASSWORD = "testpass123"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def auth_headers(s):
    # Ensure demo user exists (register once, ignore 409)
    s.post(f"{API}/auth/register", json={
        "email": DEMO_EMAIL, "password": DEMO_PASSWORD, "name": "Demo User"
    })
    r = s.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Content-Type": "application/json", "Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def artists(s):
    r = s.get(f"{API}/artists")
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 1
    return data


def _create_booking(s, headers, artist_id, date_str, time_slot="14:00", description="TEST_iter4"):
    payload = {
        "artist_id": artist_id, "date": date_str, "time_slot": time_slot,
        "description": description, "estimated_hours": 2,
    }
    r = s.post(f"{API}/bookings", json=payload, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _mock_pay(s, headers, booking_id):
    # Create checkout (mock) then mock-confirm
    r = s.post(f"{API}/payments/checkout-session",
               json={"booking_id": booking_id, "platform": "native"}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("mock") is True, "expected mock checkout (placeholder key)"
    sid = body["session_id"]
    r2 = s.post(f"{API}/payments/mock-confirm", json={"session_id": sid}, headers=headers)
    assert r2.status_code == 200, r2.text
    return sid


# ---------- Artist location backfill ----------
class TestArtistLocationBackfill:
    def test_all_seeded_artists_have_address_lat_lon(self, artists):
        for a in artists:
            assert "address" in a and "lat" in a and "lon" in a, f"missing loc keys on {a['name']}"

    def test_known_studio_coordinates(self, artists):
        # Backend hardcodes Black Iron Tattoo → 40.7181, -73.9598
        kai = next((a for a in artists if a["studio"] == "Black Iron Tattoo"), None)
        assert kai is not None, "Kai/Black Iron seed missing"
        assert abs(kai["lat"] - 40.7181) < 0.001
        assert abs(kai["lon"] - (-73.9598)) < 0.001
        assert "Bedford" in kai["address"]

    def test_all_artists_have_nonzero_coords(self, artists):
        # All 6 seeded studios have real coords in STUDIO_LOCATIONS
        for a in artists:
            assert a["lat"] != 0.0 and a["lon"] != 0.0, f"{a['name']} has zero coords"
            assert a["address"], f"{a['name']} has empty address"


# ---------- Cancel refund flows ----------
class TestCancelRefund:
    def test_refund_when_paid_and_more_than_48h_out(self, s, auth_headers, artists):
        # Book 5 days out
        far = (datetime.now(timezone.utc) + timedelta(days=5)).strftime("%Y-%m-%d")
        b = _create_booking(s, auth_headers, artists[0]["id"], far)
        _mock_pay(s, auth_headers, b["id"])
        # Verify paid
        listing = s.get(f"{API}/bookings", headers=auth_headers).json()
        paid = next(x for x in listing if x["id"] == b["id"])
        assert paid["payment_status"] == "paid"
        assert paid.get("payment_intent_id", "").startswith("pi_mock_")

        # Cancel → should refund
        r = s.post(f"{API}/bookings/{b['id']}/cancel", headers=auth_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "cancelled"
        assert body["payment_status"] == "refunded", body

        # Verify persistence
        listing2 = s.get(f"{API}/bookings", headers=auth_headers).json()
        after = next(x for x in listing2 if x["id"] == b["id"])
        assert after["status"] == "cancelled"
        assert after["payment_status"] == "refunded"

    def test_no_refund_when_paid_within_48h(self, s, auth_headers, artists):
        # Book tomorrow (~24h) → within 48h window
        soon = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
        b = _create_booking(s, auth_headers, artists[1]["id"], soon, time_slot="10:00")
        _mock_pay(s, auth_headers, b["id"])

        r = s.post(f"{API}/bookings/{b['id']}/cancel", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "cancelled"
        # Should NOT be refunded (within 48h)
        assert body["payment_status"] == "paid", body

    def test_cancel_unpaid_stays_unpaid(self, s, auth_headers, artists):
        far = (datetime.now(timezone.utc) + timedelta(days=10)).strftime("%Y-%m-%d")
        b = _create_booking(s, auth_headers, artists[2]["id"], far)
        # Don't pay
        r = s.post(f"{API}/bookings/{b['id']}/cancel", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "cancelled"
        assert body["payment_status"] == "unpaid", body


# ---------- Regression: core auth & artist detail ----------
class TestRegression:
    def test_login_and_me(self, s, auth_headers):
        r = s.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["email"] == DEMO_EMAIL

    def test_featured_returns_artist(self, s):
        r = s.get(f"{API}/featured")
        assert r.status_code == 200
        d = r.json()
        assert "artist" in d and "headline" in d
        assert d["artist"]["id"]

    def test_artist_detail_has_map_fields(self, s, artists):
        aid = artists[0]["id"]
        r = s.get(f"{API}/artists/{aid}")
        assert r.status_code == 200
        d = r.json()
        assert d["lat"] != 0.0 and d["lon"] != 0.0
        assert d["address"]
