# GhostLayer MV3 App Check Token Broker

Zero-dependency Cloudflare Worker (free tier) that mints short-lived Firebase App Check tokens for GhostLayer's Chrome MV3 extension so **every user** gets live Cloud Gemini + enforced App Check automatically with zero manual debug tokens.

## Setup (3 minutes)

1. In Google Cloud Console for project `gh0stlairr`, create a Service Account with role **Firebase App Check Token Creator** (`roles/firebaseappcheck.tokenCreator`) and download its JSON key (never commit it).
2. Deploy the Worker:
   ```bash
   cd workers/appcheck-broker
   npx wrangler deploy
   ```
3. Set the 5 secrets in Cloudflare:
   ```bash
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_EMAIL
   npx wrangler secret put FIREBASE_PRIVATE_KEY
   npx wrangler secret put FIREBASE_PROJECT_NUMBER
   npx wrangler secret put FIREBASE_APP_ID
   npx wrangler secret put ALLOWED_EXTENSION_ORIGINS
   ```
   *(Set `ALLOWED_EXTENSION_ORIGINS` to `chrome-extension://<your-extension-id>`.)*
4. Put the deployed Worker URL into `extension/.env.local` as `VITE_FIREBASE_APPCHECK_BROKER_URL=https://ghostlayer-appcheck-broker.<your-subdomain>.workers.dev` and rebuild `extension/` (`npm run build`).
