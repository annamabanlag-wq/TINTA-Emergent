"""Iteration 7 backend tests:
- /api/artists returns home_service_available, home_service_fee, bio_tl for all 6 seeded artists (backfilled)
- /api/bookings accepts home_service:true + service_address; sets service_fee = artist.home_service_fee; ignores when artist has home_service_available=false
- /api/bookings/followups returns past bookings (<=14 days, not cancelled) without a review; capped at 3; excluding reviewed
- Regression: existing artists still have PHP rate and address/lat/lon
"""
import os
import time
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone

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
    return {"token": r.json()["access_token"], "user_id": r.json()["user"]["id"],
            "headers": {"Authorization": f"Bearer {r.json()['access_token']}"}}


@pytest.fixture(scope="module")
def fresh_auth(s):
    """Fresh user with no bookings/reviews so we can test followup capping cleanly."""
    email = f"TEST_iter7+{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}@ink.dev"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "Iter7"})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    return {"token": tok, "headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def artists(s):
    r = s.get(f"{API}/artists")
    assert r.status_code == 200
    return r.json()


# ---------- Artist backfill ----------
class TestArtistBackfill:
    def test_six_seeded(self, artists):
        assert len(artists) == 6, f"expected 6 artists got {len(artists)}"

    def test_home_service_and_bio_tl_present(self, artists):
        for a in artists:
            assert "home_service_available" in a, f"{a['name']} missing home_service_available"
            assert "home_service_fee" in a, f"{a['name']} missing home_service_fee"
            assert "bio_tl" in a, f"{a['name']} missing bio_tl"
            assert isinstance(a["home_service_available"], bool)
            assert isinstance(a["home_service_fee"], int)
            assert isinstance(a["bio_tl"], str)
            # bio_tl should be non-empty (backfilled)
            assert len(a["bio_tl"]) > 0, f"{a['name']} bio_tl empty"

    def test_home_service_expected_configuration(self, artists):
        by_name = {a["name"]: a for a in artists}
        assert by_name["Kai Nakamura"]["home_service_available"] is True
        assert by_name["Kai Nakamura"]["home_service_fee"] == 4000
        assert by_name["Diego Ruiz"]["home_service_available"] is True
        assert by_name["Diego Ruiz"]["home_service_fee"] == 5500
        assert by_name["Ash Rowe"]["home_service_available"] is True
        assert by_name["Ash Rowe"]["home_service_fee"] == 3500
        assert by_name["Nova Blake"]["home_service_available"] is True
        assert by_name["Nova Blake"]["home_service_fee"] == 4500
        assert by_name["Mara Voss"]["home_service_available"] is False
        assert by_name["Mara Voss"]["home_service_fee"] == 0
        assert by_name["Yuki Sato"]["home_service_available"] is False

    def test_regression_php_rate_and_address(self, artists):
        for a in artists:
            assert a["rate_per_hour"] >= 10000, f"{a['name']} rate not PHP: {a['rate_per_hour']}"
            assert a.get("address"), f"{a['name']} missing address"
            assert a.get("lat", 0) != 0.0, f"{a['name']} missing lat"
            assert a.get("lon", 0) != 0.0, f"{a['name']} missing lon"


# ---------- Booking with home_service ----------
class TestBookingHomeService:
    def test_home_service_available_artist_sets_fee(self, s, demo_auth, artists):
        kai = next(a for a in artists if a["name"] == "Kai Nakamura")
        payload = {
            "artist_id": kai["id"],
            "date": "2027-01-15",
            "time_slot": "10:00",
            "description": "TEST_home service kai",
            "estimated_hours": 2,
            "home_service": True,
            "service_address": "123 Test Ave, Manila, PH",
        }
        r = s.post(f"{API}/bookings", json=payload, headers=demo_auth["headers"])
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["home_service"] is True
        assert b["service_fee"] == 4000, f"expected 4000 got {b['service_fee']}"
        assert b["service_address"] == "123 Test Ave, Manila, PH"

    def test_home_service_unavailable_artist_ignored(self, s, demo_auth, artists):
        mara = next(a for a in artists if a["name"] == "Mara Voss")
        payload = {
            "artist_id": mara["id"],
            "date": "2027-01-16",
            "time_slot": "10:00",
            "description": "TEST_home service mara (should be ignored)",
            "estimated_hours": 2,
            "home_service": True,
            "service_address": "should not be saved",
        }
        r = s.post(f"{API}/bookings", json=payload, headers=demo_auth["headers"])
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["home_service"] is False
        assert b["service_fee"] == 0
        assert b["service_address"] is None

    def test_at_studio_default(self, s, demo_auth, artists):
        aid = artists[0]["id"]
        payload = {
            "artist_id": aid,
            "date": "2027-01-17",
            "time_slot": "10:00",
            "description": "TEST_studio only",
            "estimated_hours": 2,
        }
        r = s.post(f"{API}/bookings", json=payload, headers=demo_auth["headers"])
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["home_service"] is False
        assert b["service_fee"] == 0


# ---------- Follow-ups ----------
class TestFollowups:
    def test_demo_user_followup_diego(self, s, demo_auth):
        r = s.get(f"{API}/bookings/followups", headers=demo_auth["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) <= 3
        # Pre-seeded Diego Ruiz past booking (3 days ago) should be present
        names = [x["artist_name"] for x in data]
        assert "Diego Ruiz" in names, f"expected Diego Ruiz in followups, got: {names}"
        # Each entry has expected shape
        for item in data:
            for k in ("booking_id", "artist_id", "artist_name", "artist_avatar", "date"):
                assert k in item, f"missing key {k} in {item}"

    def test_followup_orders_most_recent(self, s, demo_auth):
        r = s.get(f"{API}/bookings/followups", headers=demo_auth["headers"])
        data = r.json()
        if len(data) >= 2:
            dates = [x["date"] for x in data]
            assert dates == sorted(dates, reverse=True), f"not sorted desc: {dates}"

    def test_fresh_user_empty(self, s, fresh_auth):
        r = s.get(f"{API}/bookings/followups", headers=fresh_auth["headers"])
        assert r.status_code == 200
        assert r.json() == []

    def test_followup_cap_and_reviewed_excluded(self, s, fresh_auth, artists):
        """Insert 4 past bookings via API to test cap=3, then review 1 to test exclusion."""
        # We need past bookings — the API accepts arbitrary date strings, so use dates in the past 14 days.
        base = datetime.now(timezone.utc).date()
        chosen = artists[:4]
        booking_ids = []
        for i, a in enumerate(chosen, start=1):
            d = (base - timedelta(days=i)).isoformat()
            payload = {
                "artist_id": a["id"],
                "date": d,
                "time_slot": f"{10 + i}:00",
                "description": f"TEST_iter7_followup_{i}",
                "estimated_hours": 2,
            }
            r = s.post(f"{API}/bookings", json=payload, headers=fresh_auth["headers"])
            assert r.status_code == 200, r.text
            booking_ids.append((r.json()["id"], a["id"]))

        r = s.get(f"{API}/bookings/followups", headers=fresh_auth["headers"])
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 3, f"expected cap=3 got {len(data)}: {data}"

        # Newest (day -1) should appear first
        assert data[0]["artist_id"] == chosen[0]["id"]

        # Now review the artist for the FIRST booking; that entry should drop out
        rev_payload = {"artist_id": chosen[0]["id"], "rating": 5, "comment": "TEST_iter7 great"}
        rv = s.post(f"{API}/reviews", json=rev_payload, headers=fresh_auth["headers"])
        assert rv.status_code == 200, rv.text

        r2 = s.get(f"{API}/bookings/followups", headers=fresh_auth["headers"])
        data2 = r2.json()
        artist_ids2 = [x["artist_id"] for x in data2]
        assert chosen[0]["id"] not in artist_ids2, "reviewed artist still in followups"
        # Now we should have 3 remaining artists (indices 1,2,3)
        assert len(data2) == 3
        for c in chosen[1:4]:
            assert c["id"] in artist_ids2

    def test_cancelled_bookings_excluded(self, s, fresh_auth, artists):
        """A cancelled past booking should NOT show up in followups."""
        base = datetime.now(timezone.utc).date()
        # pick an artist not yet used in the cap test (index 4)
        a = artists[4]
        payload = {
            "artist_id": a["id"],
            "date": (base - timedelta(days=5)).isoformat(),
            "time_slot": "09:00",
            "description": "TEST_iter7_cancel",
            "estimated_hours": 2,
        }
        r = s.post(f"{API}/bookings", json=payload, headers=fresh_auth["headers"])
        assert r.status_code == 200
        bid = r.json()["id"]
        rc = s.post(f"{API}/bookings/{bid}/cancel", headers=fresh_auth["headers"])
        assert rc.status_code == 200
        # Fetch followups — this artist_id should NOT appear
        r2 = s.get(f"{API}/bookings/followups", headers=fresh_auth["headers"])
        data2 = r2.json()
        aids = [x["artist_id"] for x in data2]
        assert a["id"] not in aids
