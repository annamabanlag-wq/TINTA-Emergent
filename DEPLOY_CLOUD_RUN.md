# Deploy TINTA to Google Cloud Run (Free-tier friendly)

## Prerequisites
- Google Cloud account (free tier is enough to start)
- `gcloud` CLI installed: https://cloud.google.com/sdk/docs/install
- MongoDB Atlas free M0 cluster ready

## Step-by-step

### 1. Create / select project
```bash
gcloud projects create tinta-prod --name="TINTA Production"
gcloud config set project tinta-prod
# Enable billing (required even for free tier usage) and Cloud Run API
gcloud services enable run.googleapis.com cloudbuild.googleapis.com
```

### 2. Prepare secrets / env
Create a file `env.yaml` (do **not** commit it):

```yaml
MONGO_URL: "mongodb+srv://..."
DB_NAME: "inked"
JWT_SECRET: "your-super-long-random-secret"
APP_URL: "https://placeholder"   # will update after first deploy
INKED_ADMIN_EMAIL: "admin@..."
INKED_ADMIN_PASSWORD: "..."
TEST_PAYMENT_MODE: "false"
INKED_COMMISSION_PERCENT: "15"
```

### 3. First deploy
```bash
gcloud run deploy tinta \
  --source . \
  --region asia-southeast1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 300 \
  --port 8000 \
  --set-env-vars-file env.yaml
```

Note the Service URL that is printed (e.g. `https://tinta-xxxxx-as.a.run.app`).

### 4. Update APP_URL and redeploy
Edit `env.yaml` → set real `APP_URL`, then:
```bash
gcloud run services update tinta \
  --region asia-southeast1 \
  --update-env-vars APP_URL=https://tinta-xxxxx-as.a.run.app
```

Or redeploy with the updated file.

### 5. Verify
```bash
curl https://your-service-url/api/styles
# should return the list of styles
```

### 6. Custom domain (optional, later)
Cloud Run → Manage custom domains → follow Google’s steps (needs domain verification).

### Tips for free tier
- Keep `min-instances=0` so it scales to zero when idle (no cost).
- 512Mi is usually enough for this app.
- Atlas free tier + Cloud Run free quota is enough for early users and testing.
- Monitor Cloud Run metrics and Atlas usage.

### Troubleshooting “needs VPN”
Cloud Run is public by default with `--allow-unauthenticated`.  
If testers still can’t reach it:
- Confirm the exact URL (no trailing slash issues)
- Check Atlas Network Access allows the Cloud Run IPs or `0.0.0.0/0`
- Test from multiple networks / mobile data
- Look at Cloud Run logs: `gcloud run services logs read tinta --region asia-southeast1`

## Frontend
After backend is live, point the Expo app / web build to the new Cloud Run URL and rebuild.
