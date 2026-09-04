# Inked — Tattoo Booking Platform (MVP)

## Vision
A dark, edgy mobile marketplace where clients discover tattoo artists, browse portfolios, book sessions with deposits, message artists, and leave reviews.

## Users
- **Primary:** Clients booking tattoo artists.

## Core Features (MVP built)
1. **Auth** — Email/password signup & login (JWT + bcrypt), sessions stored via `expo-secure-store`.
2. **Discover** — Feed of artists with horizontal style-filter chips and search.
3. **Artist Profile** — Hero, bio, styles, portfolio grid, stats (rating/reviews/rate), reviews list, "BOOK SESSION" CTA.
4. **Booking Flow** — 3 steps: date/time + hours → describe piece → review & mock deposit payment ($50 flat).
5. **Bookings** — Upcoming / Past tabs with cancel action.
6. **Messaging** — Thread list + real-time-feel chat (artist auto-replies to first message).
7. **Reviews** — 5-star rating + comment; aggregate rating updates artist profile.
8. **Profile** — Account info, section links, sign out.

## Design
Brutalist Mobile (DARK): `#0A0A0A` obsidian surface, `#E51C24` signal red accent, zero radius, 2pt borders, edge-to-edge imagery, uppercase display type.

## Backend
- FastAPI + Motor (MongoDB) + JWT + bcrypt.
- All routes prefixed `/api`. Seeds 6 artists on startup.
- Endpoints: auth, artists, styles, bookings, reviews, threads/messages.

## Deferred (post-MVP)
- Real Stripe deposits (currently mocked at $50).
- Emergent Object Storage uploads for user references (currently URL/string).
- Push notifications.
- Artist-side app.
