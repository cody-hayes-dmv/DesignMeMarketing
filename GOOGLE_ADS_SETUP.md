# Google Ads Integration Setup Guide

This guide explains how to integrate **Google Ads** with the DesignMe Marketing SEO dashboard. The app uses the **Google Ads API** (OAuth 2.0 + developer token) to connect **per-client** Google Ads accounts and pull PPC data (campaigns, ad groups, keywords, conversions) and to enrich **Domain Research** with paid keywords.

---

## What the integration does

| Feature | Description |
|--------|-------------|
| **Client-level connection** | Each client can have one Google Ads account linked (standalone or under an MCC). |
| **Dashboard PPC tab** | When connected, the Client Dashboard shows a **PPC** tab with campaigns, ad groups, keywords, and conversions. |
| **Domain Research** | In **Research → Domain Research**, paid keyword data (top paid keywords, paid position distribution, paid competitors) is filled from Google Ads when the client has Google Ads connected. |
| **OAuth flow** | Users connect via popup or redirect; the app stores refresh token and selected customer ID per client. |

---

## Prerequisites

1. **Google Cloud project** with the Google Ads API used via OAuth (same or different project than GA4).
2. **OAuth 2.0 credentials** (Web application) for the Google Ads OAuth flow.
3. **Google Ads Developer Token** from a Google Ads account (Tools & Settings → Setup → API Center). The API requires this for all data access.

---

## Step 1: Google Cloud – OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable **Google Ads API** (optional for OAuth; the token exchange uses standard Google OAuth2).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
5. If prompted, configure the **OAuth consent screen**:
   - User type: External (for multi-user) or Internal (for organization only).
   - App name, support email, developer contact.
   - **Scopes**: add  
     `https://www.googleapis.com/auth/adwords`  
     `https://www.googleapis.com/auth/userinfo.email`
6. Create **OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs** (must match exactly):
     - Dev: `http://localhost:5000/api/clients/google-ads/callback`
     - Prod: `https://your-api-domain.com/api/clients/google-ads/callback`
7. Copy **Client ID** and **Client Secret**.

---

## Step 2: Google Ads Developer Token

1. Log in to [Google Ads](https://ads.google.com/).
2. **Tools & Settings** (wrench) → **Setup** → **API Center**.
3. Apply for **API access** if you haven’t already. For testing you can use a **Test account** (developer token in test mode).
4. Copy the **Developer token** (required for all Google Ads API data calls).

---

## Step 3: Environment variables

In **`server/.env`** set:

```env
# Google Ads OAuth (same style as GA4)
GOOGLE_ADS_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_ADS_CLIENT_SECRET=your_client_secret

# Callback URL (defaults to BACKEND_URL + /api/clients/google-ads/callback if not set)
GOOGLE_ADS_REDIRECT_URI=http://localhost:5000/api/clients/google-ads/callback

# Required for Google Ads API (campaigns, keywords, etc.)
GOOGLE_ADS_DEVELOPER_TOKEN=your_developer_token_here

# Backend base URL (used if GOOGLE_ADS_REDIRECT_URI is not set)
BACKEND_URL=http://localhost:5000
```

- **GOOGLE_ADS_CLIENT_ID** / **GOOGLE_ADS_CLIENT_SECRET**: From Step 1.  
- **GOOGLE_ADS_REDIRECT_URI**: Must match one of the redirect URIs in the OAuth client.  
- **GOOGLE_ADS_DEVELOPER_TOKEN**: From Step 2. Without it, the app will throw when any Google Ads API call is made.

Restart the server after changing `.env`.

---

## Step 4: Connect in the app

1. Open **Agency** (or main) **Clients** list and open a client.
2. Go to **Client Settings** (or the client’s **Integrations** section).
3. Find **Google Ads (PPC)**:
   - **Not connected**: Click **Connect Google Ads**. Sign in with Google and grant access. After redirect/popup, click **Select Google Ads account** and choose the account (or pick a child under an MCC).
   - **Tokens received, account not selected**: Click **Select Google Ads account** and choose the client’s Google Ads account.
4. Once an account is selected and saved, **Google Ads is connected** for that client. The **PPC** tab appears on the Client Dashboard and Domain Research can show paid keywords.

---

## API endpoints (backend)

The server exposes these under the clients router (e.g. `/api/clients/:clientId/...`):

| Endpoint | Purpose |
|---------|--------|
| `GET /clients/:id/google-ads/auth` | Returns OAuth URL (optional `?popup=1` for popup flow). |
| `GET /clients/google-ads/callback` | OAuth callback; exchanges code for tokens and optionally redirects with success/error. |
| `GET /clients/:id/google-ads/status` | Returns connection status, hasTokens, accountEmail. |
| `GET /clients/:id/google-ads/customers` | Lists accessible Google Ads accounts (for account picker). |
| `GET /clients/:id/google-ads/child-accounts` | Lists child accounts under an MCC. |
| `POST /clients/:id/google-ads/connect` | Saves selected `customerId` (and optional `managerCustomerId`) for the client. |
| `POST /clients/:id/google-ads/disconnect` | Clears Google Ads tokens and customer ID. |
| `GET /clients/:id/google-ads/campaigns` | Fetches campaigns (date range in query). |
| `GET /clients/:id/google-ads/ad-groups` | Fetches ad groups. |
| `GET /clients/:id/google-ads/keywords` | Fetches keywords. |
| `GET /clients/:id/google-ads/conversions` | Fetches conversions. |

Domain overview paid keywords are loaded in **server** when building the domain overview response (see `server/src/routes/seo.ts` and `server/src/lib/googleAds.ts`).

---

## Database (Prisma)

The **Client** model stores (in `server/prisma/schema.prisma`):

- `googleAdsAccessToken` – short-lived access token.
- `googleAdsRefreshToken` – used to get new access tokens.
- `googleAdsCustomerId` – selected Google Ads account ID.
- `googleAdsManagerCustomerId` – MCC ID when the linked account is under a manager.
- `googleAdsAccountEmail` – email from OAuth (optional).
- `googleAdsConnectedAt` – when the connection was completed.

Tokens and customer ID are set by the OAuth callback and the connect endpoint; they are cleared by the disconnect endpoint.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| "Google Ads credentials not configured" | Set `GOOGLE_ADS_CLIENT_ID` and `GOOGLE_ADS_CLIENT_SECRET` in `server/.env` and restart. |
| "Google Ads API requires a developer token" | Set `GOOGLE_ADS_DEVELOPER_TOKEN` in `server/.env` and restart. |
| Redirect URI mismatch | `GOOGLE_ADS_REDIRECT_URI` must match exactly a redirect URI in the OAuth client (including `/api/clients/google-ads/callback`). |
| "Google did not return a refresh token" | Disconnect and reconnect; ensure OAuth consent screen uses `prompt: 'consent'` so a refresh token is issued (already used in `server/src/lib/googleAds.ts`). |
| "No Google Ads accounts found" | The signed-in Google user must have access to at least one Google Ads account (or MCC). |
| PPC tab / Domain Research paid data empty | Confirm the client has **Google Ads connected** and a **customer ID** selected; ensure the linked account has campaigns/keywords and the developer token is approved (or in test mode with a test account). |

---

## Summary

1. Create OAuth credentials in Google Cloud and add the redirect URI for `/api/clients/google-ads/callback`.
2. Get a Google Ads **Developer token** from Google Ads (API Center).
3. Set **GOOGLE_ADS_CLIENT_ID**, **GOOGLE_ADS_CLIENT_SECRET**, **GOOGLE_ADS_REDIRECT_URI**, and **GOOGLE_ADS_DEVELOPER_TOKEN** in `server/.env`.
4. Restart the server and connect a client via **Client Settings → Integrations → Google Ads**.
5. After selecting the Google Ads account, the Client Dashboard PPC tab and Domain Research paid data will use the linked account.

Implementation details: **`server/src/lib/googleAds.ts`** (OAuth, token refresh, API calls), **`server/src/routes/clients.ts`** (Google Ads routes and callback), **`app/src/pages/ClientDashboardPage.tsx`** (connection UI and PPC tab).
