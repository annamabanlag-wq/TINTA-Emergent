# Inked — Tattoo Booking Platform

## Vision
A dark, edgy mobile marketplace where clients discover tattoo artists, browse portfolios, book sessions with a Stripe deposit, message artists, save favorites, and leave reviews.

## Users
- **Primary:** Clients booking tattoo artists.

## Core Features
1. **Auth** — Email/password signup & login (JWT + bcrypt), session in `expo-secure-store`.
2. **Discover** — Feed of artists with horizontal style-filter chips + search + Featured "Artist of the Week" card with countdown & discount.
3. **Artist Profile** — Hero, bio, styles, portfolio grid (tap-to-zoom fullscreen viewer with pinch/pan on native), reviews, heart, share, and **Studio Location map** (address, coordinates, tap-to-open in Apple/Google Maps).
4. **Booking Flow** — 3 steps: date/time + hours → describe piece + inspiration photo upload → review & Stripe deposit ($50).
5. **Bookings** — Upcoming / Past tabs; PAID / UNPAID / REFUNDED pill; reference-image thumbnail; TODAY / TOMORROW / X-DAYS-AWAY reminder banner; **Book Again** button on past & cancelled; Cancel on upcoming.
6. **Cancellation Refunds** — Cancelling a paid booking 48h+ before the session auto-refunds the deposit via Stripe (mock refund for mock payments).
7. **Messaging** — Thread list + chat (artist auto-reply on first message).
8. **Reviews** — 5-star rating + comment updates artist aggregate.
9. **Favorites / Wishlist** — Heart on cards + artist detail; dedicated Wishlist screen.
10. **Profile** — Account info, Wishlist / Bookings / Messages / Discover links, sign out.

## Integrations
- **Stripe** — hosted Checkout Session for $50 deposit + auto-refund on early cancel. Detects placeholder `sk_test_emergent` and uses in-app mock flow; drop in a real `sk_test_...` to go live with zero code changes.
- **Emergent Object Storage** — `/api/upload` uses `INTEGRATION_PROXY_URL` + `EMERGENT_LLM_KEY`. Files served via authenticated `/api/files/{path}`.
- **Featured Artist** — weekly rotating spotlight with countdown to Sunday.
- **Maps** — Brutalist styled map card + `Linking.openURL` to Apple Maps (iOS) / Google Maps (Android/web).

## Design
Brutalist Mobile (DARK): `#0A0A0A` obsidian, `#E51C24` signal red accent, zero radius, 2pt borders, edge-to-edge imagery, uppercase display type.

## Backend
- FastAPI + Motor MongoDB + JWT + bcrypt.
- All routes prefixed `/api`. Seeds 6 artists with lat/lon/address on startup; backfills for existing rows.
- Cancel endpoint issues refund (Stripe or mock) automatically when eligible.

## Environment
- `STRIPE_API_KEY` — placeholder in pod (`sk_test_emergent`) → mock mode. Replace with real `sk_test_...` to enable live Stripe.
- `EMERGENT_LLM_KEY` — enables Object Storage.
- `BACKEND_PUBLIC_URL` — external URL for file links & Stripe redirect.

## Deferred
- Artist-side app / studio dashboard.
- Push notifications.
- Real map tiles (currently a stylized brutalist grid — replace with Mapbox/MapTiler when a token is provided).
