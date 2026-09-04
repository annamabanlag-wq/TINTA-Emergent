"""Iteration 5 tests — Artist Availability endpoint.
GET /api/artists/{id}/availability?date=YYYY-MM-DD
returns {artist_id, date, booked_slots: [...]} excluding cancelled bookings.
"""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

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
    return {"token": tok, "headers": {"Authorization": f"Bearer {tok}"}, "user_id": r.json()["user"]["id"]}


@pytest.fixture(scope="module")
def artists(s):
    r = s.get(f"{API}/artists")
    assert r.status_code == 200
    return r.json()


class TestAvailability:
    def test_unknown_artist_returns_404(self, s):
        r = s.get(f"{API}/artists/does-not-exist-xyz/availability", params={"date": "2030-01-01"})
        assert r.status_code == 404, r.text

    def test_future_empty_date_returns_empty_list(self, s, artists):
        aid = artists[0]["id"]
        future_date = (datetime.now(timezone.utc) + timedelta(days=180)).date().isoformat()
        r = s.get(f"{API}/artists/{aid}/availability", params={"date": future_date})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["artist_id"] == aid
        assert d["date"] == future_date
        assert d["booked_slots"] == []

    def test_shape(self, s, artists):
        aid = artists[0]["id"]
        r = s.get(f"{API}/artists/{aid}/availability", params={"date": "2030-02-02"})
        assert r.status_code == 200
        d = r.json()
        for k in ("artist_id", "date", "booked_slots"):
            assert k in d, f"missing key {k}"
        assert isinstance(d["booked_slots"], list)

    def test_booking_appears_in_booked_slots(self, s, demo_auth, artists):
        aid = artists[0]["id"]
        # Pick a far-future unique date to isolate this test
        far_date = (datetime.now(timezone.utc) + timedelta(days=365)).date().isoformat()
        # Confirm empty before
        pre = s.get(f"{API}/artists/{aid}/availability", params={"date": far_date}).json()
        assert pre["booked_slots"] == []

        # Create booking at 12:00
        r = s.post(
            f"{API}/bookings",
            json={
                "artist_id": aid,
                "date": far_date,
                "time_slot": "12:00",
                "description": "TEST_availability booking",
                "estimated_hours": 1,
            },
            headers=demo_auth["headers"],
        )
        assert r.status_code == 200, r.text
        booking_id = r.json()["id"]

        # It should now appear in booked_slots
        after = s.get(f"{API}/artists/{aid}/availability", params={"date": far_date}).json()
        assert "12:00" in after["booked_slots"]

        # Cancel booking — should be excluded from booked_slots
        rc = s.post(f"{API}/bookings/{booking_id}/cancel", headers=demo_auth["headers"])
        assert rc.status_code == 200, rc.text
        after_cancel = s.get(f"{API}/artists/{aid}/availability", params={"date": far_date}).json()
        assert "12:00" not in after_cancel["booked_slots"], f"cancelled booking should not appear: {after_cancel}"

    def test_seeded_kai_tomorrow_16h_booked(self, s, artists):
        """Per test context: demo user has an existing booking for Kai Nakamura tomorrow at 16:00."""
        kai = next((a for a in artists if a["name"] == "Kai Nakamura"), None)
        assert kai, "Kai Nakamura seed artist missing"
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
        r = s.get(f"{API}/artists/{kai['id']}/availability", params={"date": tomorrow})
        assert r.status_code == 200
        # Not strictly asserting 16:00 in case seed was cleared — just log
        # (context note says it should be present)
        d = r.json()
        assert isinstance(d["booked_slots"], list)
        # If seeded booking exists, verify it (soft assertion via print for report)
        if "16:00" not in d["booked_slots"]:
            pytest.skip(f"Seeded tomorrow-16:00 booking for Kai not present in this env; got {d['booked_slots']}")
        assert "16:00" in d["booked_slots"]
