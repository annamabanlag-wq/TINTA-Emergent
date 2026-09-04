# Inked — Tattoo Booking Platform

## Vision
A dark, edgy mobile marketplace where clients discover tattoo artists, browse portfolios, book sessions with deposits, message artists, save favorites, and leave reviews.

## Users
- **Primary:** Clients booking tattoo artists.

## Core Features
1. **Auth** — Email/password signup & login (JWT + bcrypt), session in `expo-secure-store`.
2. **Discover** — Feed of artists with horizontal style-filter chips + search + **Featured "Artist of the Week"** card at top with countdown & discount.
3. **Artist Profile** — Hero, bio, styles, portfolio grid, stats (rating/reviews/rate), reviews list, heart button, "BOOK SESSION" CTA.
4. **Booking Flow** — 3 steps: date/time + hours → describe piece + **inspiration photo upload** → review & **Stripe deposit payment** ($50).
5. **Bookings** — Upcoming / Past tabs with PAID / UNPAID pill, reference-image thumbnail, and cancel action.
6. **Messaging** — Thread list + chat (artist auto-replies to first message).
7. **Reviews** — 5-star rating + comment; aggregate rating updates artist profile.
8. **Favorites / Wishlist** — Heart button on artist cards & artist detail; dedicated Wishlist screen accessible from Profile.
9. **Profile** — Account info, section links (Wishlist, Bookings, Messages, Discover), sign out.

## Integrations
- **Stripe** — hosted Checkout Session for $50 deposit. Detects placeholder `sk_test_emergent` and falls back to an in-app mock confirmation for previews. Real key drops in without code changes.
- **Emergent Object Storage** — `/api/upload` uses `INTEGRATION_PROXY_URL` + `EMERGENT_LLM_KEY`. Files served via authenticated `/api/files/{path}`.
- **Featured Artist** — deterministic weekly rotation with countdown to Sunday.

## Design
Brutalist Mobile (DARK): `#0A0A0A` obsidian surface, `#E51C24` signal red accent, zero radius, 2pt borders, edge-to-edge imagery, uppercase display type.

## Backend
- FastAPI + Motor MongoDB + JWT + bcrypt.
- All routes prefixed `/api`. Seeds 6 artists on startup.
- New endpoints in this iteration:
  - `GET /api/featured`
  - `GET /api/favorites`, `GET /api/favorites/ids`, `POST /api/favorites/toggle`
  - `POST /api/upload`, `GET /api/files/{path}` (auth via header or ?token=)
  - `POST /api/payments/checkout-session`, `GET /api/payments/verify/{id}`, `POST /api/payments/mock-confirm`

## Environment
- `STRIPE_API_KEY` — placeholder in pod (`sk_test_emergent`) → mock mode; replace with real `sk_test_...` for live Stripe.
- `EMERGENT_LLM_KEY` — enables Object Storage.
- `BACKEND_PUBLIC_URL` — external URL for file links & Stripe redirect.

## Deferred
- Real refund flow (Stripe webhook + refund endpoint).
- Artist-side app.
- Push notifications.
