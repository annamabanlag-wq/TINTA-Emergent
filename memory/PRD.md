# Inked — Tattoo Booking Platform

## Vision
A dark, edgy Philippine-focused mobile marketplace where clients discover tattoo artists in Manila / Cebu / Metro Manila, browse portfolios, book sessions with a Stripe / GCash / Maya deposit, get travel-to-you service for weddings & events, message artists, save favorites, follow up on past sessions, and leave reviews — all in English or Tagalog.

## Users
- **Primary:** Clients booking tattoo artists in the Philippines.

## Core Features
1. **Auth** — Email/password (JWT + bcrypt), session in `expo-secure-store`.
2. **Discover** — Feed with style filters, search, Featured "Artist of the Week" with countdown & discount.
3. **Artist Profile** — Hero, bio (EN or TL), styles, portfolio grid (tap-to-zoom fullscreen viewer), stats, reviews, heart, share, studio map, and **HOME SERVICE AVAILABLE** badge with fee when offered.
4. **Booking Flow** — 3 steps:
   - Date + time (with **availability disabled slots**) + hours
   - Describe piece + **inspiration photo upload** + **AT STUDIO / HOME SERVICE** selector + address if home
   - Review with home service fee line, **CARD / GCASH / MAYA** payment method, **Cancellation Policy** link, and Stripe ₱2,900 deposit
5. **Bookings** — Upcoming / Past tabs. **Follow-up card** ("How was your session?") for past bookings without a review, with Leave Review + Book Again CTAs. Reminder banner within 3 days. PAID / UNPAID / REFUNDED pill. Book Again on past & cancelled. Cancel triggers auto-refund when eligible (>48h).
6. **Messaging** — Thread list + chat with artist auto-reply.
7. **Reviews** — 5-star + comment updates aggregate.
8. **Favorites / Wishlist** — Heart everywhere + dedicated Wishlist.
9. **Profile** — Account, language toggle (EN / TL), section links, sign out.
10. **Admin Console** (gated tab, only for `is_admin` users) — Overview stats (users/artists/bookings/paid), revenue (Gross, INKED Commission 15%, Artist Earnings, Pending Payouts), manage users (promote/demote admin), manage artists (create/edit/disable/block-dates), all bookings (filter + admin refund), payments log, per-artist commissions breakdown, and payouts (record artist payout marking their pending earnings as paid out).

## Business & Money Flow
- Every paid booking auto-splits: **INKED commission = 15%** of `deposit + service_fee`; the remainder is credited to the artist's earnings ledger as `pending_payout`.
- Admin creates a payout to move an artist's `pending_payout` entries to `paid_out` (with note field for bank ref).
- Admin refund reverses booking status → refunded and marks ledger `refunded` (destination-charge reverse pattern; test-mode only right now).

## Integrations
- **Stripe (test mode / mock)** — Checkout Session in PHP (`currency: php`, `unit_amount: 290000`). Supports `card` and `gcash` natively; Maya falls back to card rails. Auto-refund on early cancel. Mock-checkout flow active until a real `sk_test_...` key is provided (user opted to keep test payments only).
- **Emergent Object Storage** — Reference-photo uploads.
- **Featured Artist** — Weekly rotating spotlight with countdown to Sunday.
- **Maps** — Brutalist styled map card + deep-link to Apple / Google Maps.

## Design
Brutalist Mobile (DARK): `#0A0A0A` obsidian, `#E51C24` signal red, zero radius, 2pt borders, uppercase display type, edge-to-edge imagery. Admin console re-uses the same design system — no separate skin.

## Backend
- FastAPI + Motor MongoDB + JWT + bcrypt. All routes `/api`. Seeds 6 artists with lat/lon/address, bio_tl, and home service on startup; backfills existing rows.
- Seeds admin user `admin@inked.dev` / `admin123` on startup.
- Collections: users (with `is_admin`), artists (with `active`, `blocked_dates`), bookings (with `commission_amount`, `artist_earnings`, `amount_paid`), earnings_ledger (`pending_payout | paid_out | refunded`), payouts.
- Endpoints: existing customer endpoints untouched. New admin endpoints under `/api/admin/*` (stats, users, artists CRUD, bookings + refund, payments, commissions, payouts) — all gated by `require_admin`.

## Environment
- `STRIPE_API_KEY` — placeholder → mock mode (per user request).
- `INKED_COMMISSION_PERCENT` — defaults to 15.
- `EMERGENT_LLM_KEY` — Object Storage.
- `BACKEND_PUBLIC_URL` — external URL.
- `JWT_SECRET` — auth signing.

