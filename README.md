# TINTA (Inked) – Tattoo Booking Platform

Fast, brutalist dark-themed tattoo artist discovery + booking app for the Philippines.

- **Frontend**: Expo (React Native) – iOS / Android / Web
- **Backend**: FastAPI + MongoDB
- **Payments**: Manual GCash (customer submits proof → admin approves) + commission split
- **Features**: Artist profiles & portfolios, booking + availability, chat, reviews, favorites, admin panel, artist earnings ledger

---

## Quick Start (Local)

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example .env     # fill in values
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
yarn install
yarn start                  # or yarn web / yarn android
```

Set `EXPO_PUBLIC_API_URL` (or equivalent) to your backend URL.

---

## Production Deployment (Recommended: Google Cloud Run)

Cloud Run is free-tier friendly, scales to zero, has no forced 15-minute sleep like Render free, and is publicly accessible worldwide (no VPN required).

### 1. Database – MongoDB Atlas (Free M0)
1. Create account at https://cloud.mongodb.com
2. Create a free M0 cluster
3. Create database user + password
4. Network Access → Add IP `0.0.0.0/0` (or restrict later)
5. Get connection string → use as `MONGO_URL`

### 2. Environment Variables (Cloud Run)
Copy from `.env.example` and set these in Cloud Run:

| Variable | Required | Notes |
|----------|----------|-------|
| `MONGO_URL` | Yes | Atlas connection string |
| `DB_NAME` | Yes | e.g. `inked` |
| `JWT_SECRET` | Yes | Long random string (32+ chars) |
| `APP_URL` or `BACKEND_PUBLIC_URL` | Yes | Your Cloud Run URL (https://...) |
| `INKED_COMMISSION_PERCENT` | No | Default 15 |
| `INKED_ADMIN_EMAIL` + `INKED_ADMIN_PASSWORD` | Recommended | Auto-creates admin on first boot |
| `TEST_PAYMENT_MODE` | No | Set `false` in production |
| `STRIPE_API_KEY` | Optional | Only if using Stripe later |
| `EMERGENT_LLM_KEY` / storage keys | If using object storage | |

### 3. Deploy to Cloud Run (from this repo)

```bash
# One-time: install gcloud CLI and login
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Build & deploy (uses the root Dockerfile)
gcloud run deploy tinta \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars "MONGO_URL=...,DB_NAME=inked,JWT_SECRET=...,APP_URL=https://tinta-xxxx-as.a.run.app" \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5 \
  --timeout 300
```

After first deploy, update `APP_URL` to the real Cloud Run URL and redeploy (or set it via console).

### 4. Frontend Web
The root Dockerfile already builds Expo web (`npx expo export --platform web`) and copies it.  
For pure static hosting you can also:
```bash
cd frontend
npx expo export --platform web
# then deploy the `dist` folder to Cloudflare Pages / Vercel / Netlify
```

Point the web app’s API base URL to your Cloud Run service.

### 5. Android APK
Existing GitHub Actions workflows (`.github/workflows/`) build APKs.  
Update the API URL in the app config / env before building for production.

---

## Why Cloud Run instead of Render free?
- No 15-minute sleep → much better public experience
- Globally accessible (solves “needs VPN” issues)
- Docker-native, scales to zero (cheap/free at low traffic)
- Easy custom domain later

---

## Architecture Notes
- Backend applies many production patches at import time via `sitecustomize.py` (GCash security, chat, auth, CORS, artist portal, email verification, etc.).
- GCash flow is **manual**: customer submits reference + receipt image → admin reviews in `/admin/gcash-payments`.
- Commission is calculated and stored in `earnings_ledger` for artist payouts.
- Account deletion endpoint exists for store compliance.

---

## Roadmap (this branch)
- [x] Branch + production docs
- [ ] Health endpoint + better startup validation
- [ ] Clean / merge critical patches into main server for maintainability
- [ ] Security hardening (rate limits, production flags)
- [ ] GCash + booking UX polish
- [ ] Admin & artist portal frontend improvements
- [ ] Search, reviews, notifications polish
- [ ] MongoDB indexes for performance

---

## License / Ownership
Private project – TINTA / Inked Tattoo Booking.
