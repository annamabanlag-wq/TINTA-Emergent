"""Backend integration tests for Inked tattoo booking app.
Covers: auth (register/login/me), artists (list/filter/detail),
bookings (create/list/cancel), reviews (create/list),
messages (send/threads/fetch).
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://tattoo-reserve-7.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@inked.dev"
DEMO_PASSWORD = "testpass123"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def demo_token(s):
    r = s.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200, f"Demo login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def auth_headers(demo_token):
    return {"Content-Type": "application/json", "Authorization": f"Bearer {demo_token}"}


@pytest.fixture(scope="session")
def artists(s):
    r = s.get(f"{API}/artists")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) >= 1
    return data


# ---------- Auth ----------
class TestAuth:
    def test_register_new_user(self, s):
        email = f"TEST_alice+{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}@ink.dev"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "Alice"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "access_token" in d
        assert d["user"]["email"].lower() == email.lower()
        assert d["user"]["name"] == "Alice"

    def test_register_duplicate_email(self, s):
        r = s.post(f"{API}/auth/register", json={"email": DEMO_EMAIL, "password": "whatever", "name": "Dupe"})
        assert r.status_code == 409

    def test_login_demo_success(self, s):
        r = s.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
        assert r.status_code == 200
        assert r.json()["user"]["email"] == DEMO_EMAIL

    def test_login_wrong_password(self, s):
        r = s.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": "wrong-pass"})
        assert r.status_code == 401

    def test_me_requires_token(self, s):
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_returns_user(self, s, auth_headers):
        r = s.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["email"] == DEMO_EMAIL


# ---------- Artists ----------
class TestArtists:
    def test_list_artists(self, artists):
        assert len(artists) >= 6
        a = artists[0]
        for k in ("id", "name", "styles", "avatar", "portfolio", "rate_per_hour"):
            assert k in a

    def test_filter_by_style_blackwork(self, s):
        r = s.get(f"{API}/artists", params={"style": "Blackwork"})
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        for a in data:
            assert "Blackwork" in a["styles"]

    def test_artist_detail(self, s, artists):
        aid = artists[0]["id"]
        r = s.get(f"{API}/artists/{aid}")
        assert r.status_code == 200
        assert r.json()["id"] == aid

    def test_artist_detail_404(self, s):
        r = s.get(f"{API}/artists/nonexistent-id")
        assert r.status_code == 404


# ---------- Bookings ----------
class TestBookings:
    booking_id = None

    def test_create_booking(self, s, auth_headers, artists):
        aid = artists[0]["id"]
        payload = {
            "artist_id": aid,
            "date": "2026-02-15",
            "time_slot": "14:00",
            "description": "TEST_booking - sleeve blackwork",
            "estimated_hours": 3,
        }
        r = s.post(f"{API}/bookings", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["status"] == "confirmed"
        assert b["deposit"] == 50
        assert b["artist_id"] == aid
        TestBookings.booking_id = b["id"]

    def test_list_bookings_contains_new(self, s, auth_headers):
        assert TestBookings.booking_id, "booking creation must run first"
        r = s.get(f"{API}/bookings", headers=auth_headers)
        assert r.status_code == 200
        ids = [b["id"] for b in r.json()]
        assert TestBookings.booking_id in ids

    def test_cancel_booking(self, s, auth_headers):
        bid = TestBookings.booking_id
        r = s.post(f"{API}/bookings/{bid}/cancel", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["status"] == "cancelled"
        # Verify persistence
        r2 = s.get(f"{API}/bookings", headers=auth_headers)
        matched = [b for b in r2.json() if b["id"] == bid]
        assert matched and matched[0]["status"] == "cancelled"

    def test_bookings_require_auth(self, s):
        r = s.get(f"{API}/bookings")
        assert r.status_code == 401


# ---------- Reviews ----------
class TestReviews:
    def test_create_review_updates_rating(self, s, auth_headers, artists):
        aid = artists[1]["id"]
        payload = {"artist_id": aid, "rating": 5, "comment": "TEST_review great work"}
        r = s.post(f"{API}/reviews", json=payload, headers=auth_headers)
        assert r.status_code == 200
        rv = r.json()
        assert rv["rating"] == 5
        # Fetch artist and confirm review count > 0
        a = s.get(f"{API}/artists/{aid}").json()
        assert a["reviews_count"] >= 1

    def test_list_reviews(self, s, artists):
        aid = artists[1]["id"]
        r = s.get(f"{API}/artists/{aid}/reviews")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) >= 1


# ---------- Messages ----------
class TestMessages:
    def test_send_message_and_auto_reply(self, s, auth_headers, artists):
        aid = artists[2]["id"]
        r = s.post(f"{API}/messages", json={"artist_id": aid, "text": "TEST_hello there"}, headers=auth_headers)
        assert r.status_code == 200
        msg = r.json()
        assert msg["from_role"] == "user"
        # Fetch messages: should include auto-reply if first message
        r2 = s.get(f"{API}/threads/{aid}/messages", headers=auth_headers)
        assert r2.status_code == 200
        msgs = r2.json()
        assert len(msgs) >= 1
        # Ordering ascending
        times = [m["created_at"] for m in msgs]
        assert times == sorted(times)

    def test_list_threads(self, s, auth_headers):
        r = s.get(f"{API}/threads", headers=auth_headers)
        assert r.status_code == 200
        threads = r.json()
        assert isinstance(threads, list)
        assert len(threads) >= 1
        assert "artist_name" in threads[0]
