# How to Test Stripe Integration

This guide walks you through testing all Stripe-related features: **Financial Overview** (MRR, subscription activity), **Billing portal**, **Managed services** (subscription items on approve), and **Add-ons**.

---

## Stripe integration overview (is it okay?)

**Yes.** The Stripe integration is structured correctly and is safe to use, with a few design choices to be aware of:

| Area | Status | Notes |
|------|--------|--------|
| **Secret key** | OK | Only read from `STRIPE_SECRET_KEY` in env; never sent to the frontend. |
| **Initialization** | OK | `server/src/lib/stripe.ts` creates one Stripe instance; uses API version `2025-02-24.acacia`. |
| **Billing portal** | OK | Creates a session with `customer` and `return_url`. Returns portal URL to the client for redirect. |
| **Managed services** | OK | On approve: finds customer’s active subscription, adds a subscription item for the managed price. If Stripe/env is missing, approval still succeeds in the DB and a warning is logged. |
| **Add-ons** | OK | Same pattern: add/remove subscription items; DB and tier validation are correct. |
| **Financial (MRR)** | OK | Lists subscriptions with expand, categorizes by product; product is now expanded to avoid N+1. |
| **Errors** | OK | Stripe calls are in try/catch; failures return 4xx/5xx or log and continue where appropriate. |

**Current behavior:**

- **Per-agency Stripe customer:** Each agency has `agency.stripeCustomerId`. The billing portal and managed/add-on flows use that (or create a Stripe customer on first portal open and save it). `STRIPE_AGENCY_CUSTOMER_ID` is only a fallback for single-tenant when an agency has no `stripeCustomerId` yet.
- **Billing portal customer:** Always derived from the current user’s agency: `agency.stripeCustomerId ?? STRIPE_AGENCY_CUSTOMER_ID`. If both are null, the app creates a Stripe customer and saves it to the agency. The request body is never used for the customer ID.
- **Plan sync from Stripe:** A webhook at `POST /api/webhooks/stripe` (with `STRIPE_WEBHOOK_SECRET` and optional `STRIPE_PRICE_PLAN_*` env vars) syncs `customer.subscription.created/updated/deleted` to `agency.subscriptionTier` and `agency.stripeSubscriptionId`, so changing plan in the Stripe portal updates the app.

---

## Prerequisites

1. **Stripe Test mode**  
   In [Stripe Dashboard](https://dashboard.stripe.com), ensure the test-mode toggle (top right) is **ON**. All steps use test data.

2. **Real test secret key**  
   Get your key from [API Keys](https://dashboard.stripe.com/test/apikeys). It must start with `sk_test_` (e.g. `sk_test_51...`).  
   In `server/.env`:
   ```env
   STRIPE_SECRET_KEY=sk_test_51xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   Do **not** use the literal string `sk_test_xxx` — API calls will fail.

3. **Server restarted**  
   After any `.env` change, restart the backend so new values are loaded.

---

## What Uses Stripe in This App

| Feature | Env vars required | Where it’s used |
|--------|--------------------|------------------|
| **Financial Overview** (MRR, subscription activity) | `STRIPE_SECRET_KEY` | Admin/Financial pages that show MRR breakdown and subscription activity |
| **Billing portal** | `STRIPE_SECRET_KEY`; per-agency `agency.stripeCustomerId` (or fallback `STRIPE_AGENCY_CUSTOMER_ID`) | Agency → Subscription → “Manage billing” / “Download invoices” |
| **Plan sync (webhook)** | `STRIPE_WEBHOOK_SECRET`, optional `STRIPE_PRICE_PLAN_*` | Stripe → `POST /api/webhooks/stripe` → updates `agency.subscriptionTier` |
| **Managed services** (Stripe line items on approve) | Above + `STRIPE_PRICE_MANAGED_*` | When Super Admin approves a managed service request |
| **Add-ons** (Stripe line items) | Above + `STRIPE_PRICE_ADDON_*` | When Agency adds an add-on (dashboards, keywords tracked, keyword lookups) |

---

## 1. One-Time Stripe Dashboard Setup

### 1.1 Create the agency customer

1. Open [Customers](https://dashboard.stripe.com/test/customers) (test mode).
2. Click **Add customer**.
3. Enter name (e.g. “DesignMe Agency”) and email. Save.
4. Copy the **Customer ID** (e.g. `cus_xxxxxxxxxxxxx`).
5. In `server/.env`:
   ```env
   STRIPE_AGENCY_CUSTOMER_ID=cus_xxxxxxxxxxxxx
   ```

### 1.2 Give the customer an active subscription (required for portal + managed/add-on items)

The app adds **subscription items** to an existing subscription. The customer must have at least one active subscription.

1. In Stripe: [Products](https://dashboard.stripe.com/test/products) → **Add product** (e.g. “Agency Platform”).
2. Add a **Price** (e.g. $0 or $1/month, recurring). Copy the **Price ID** (`price_xxx`).
3. [Customers](https://dashboard.stripe.com/test/customers) → open your agency customer → **Create subscription**.
4. Select the price you created. At payment, use test card **4242 4242 4242 4242** (any future expiry, any CVC).
5. Complete the subscription. You should see it under the customer as **Active**.

**Result:** Billing portal will work, and the app can attach managed-service and add-on prices to this subscription.

### 1.3 (Optional) Managed service prices

If you want **managed service approvals** to create Stripe line items:

1. Create one **Product** per managed package (names can match the app):
   - SEO Essentials + Automation  
   - Growth & Automation  
   - Authority Builder  
   - Market Domination  
   - Custom  
2. For each product, add a **recurring Price** (e.g. monthly). Copy each **Price ID**.
3. In `server/.env`:
   ```env
   STRIPE_PRICE_MANAGED_SEO_ESSENTIALS_AUTOMATION=price_xxx
   STRIPE_PRICE_MANAGED_GROWTH_AUTOMATION=price_xxx
   STRIPE_PRICE_MANAGED_AUTHORITY_BUILDER=price_xxx
   STRIPE_PRICE_MANAGED_MARKET_DOMINATION=price_xxx
   STRIPE_PRICE_MANAGED_CUSTOM=price_xxx
   ```

### 1.4 (Optional) Add-on prices

If you want **add-ons** to create Stripe line items, create Products/Prices for each add-on option and set in `server/.env`:

```env
STRIPE_PRICE_ADDON_EXTRA_DASHBOARDS_5_SLOTS=price_xxx
STRIPE_PRICE_ADDON_EXTRA_DASHBOARDS_10_SLOTS=price_xxx
STRIPE_PRICE_ADDON_EXTRA_DASHBOARDS_25_SLOTS=price_xxx
STRIPE_PRICE_ADDON_EXTRA_KEYWORDS_TRACKED_100=price_xxx
STRIPE_PRICE_ADDON_EXTRA_KEYWORDS_TRACKED_250=price_xxx
STRIPE_PRICE_ADDON_EXTRA_KEYWORDS_TRACKED_500=price_xxx
STRIPE_PRICE_ADDON_EXTRA_KEYWORD_LOOKUPS_100=price_xxx
STRIPE_PRICE_ADDON_EXTRA_KEYWORD_LOOKUPS_300=price_xxx
STRIPE_PRICE_ADDON_EXTRA_KEYWORD_LOOKUPS_500=price_xxx
```

Restart the server after editing `.env`.

---

## 2. Test: Financial Overview (MRR / subscription activity)

**Requires:** `STRIPE_SECRET_KEY` set to a valid test key.

1. Log in as a user with access to **Financial** (e.g. Admin / Super Admin).
2. Open the Financial/overview page that shows MRR breakdown and/or subscription activity.
3. **Expected:** Data loads (or empty state if no subscriptions yet). No “Stripe is not configured” error.
4. **If you see “Stripe is not configured”:** Ensure `STRIPE_SECRET_KEY` in `.env` is a real `sk_test_...` key and the server was restarted.

---

## 3. Test: Billing portal

**Requires:** `STRIPE_SECRET_KEY`. The app uses the **current user’s agency** `stripeCustomerId` (or creates a Stripe customer on first use and saves it). Single-tenant fallback: `STRIPE_AGENCY_CUSTOMER_ID` when the agency has no `stripeCustomerId`. The customer ID is never taken from the request body.

1. Log in as **Agency** or **Admin** (not Specialist).
2. Go to **Subscription** (e.g. **Agency** → **Subscription** in the app, or `/agency/subscription`).
3. Click **Manage billing** or **Download invoices**.
4. **Expected:** Browser redirects to Stripe’s hosted billing portal. If the agency had no Stripe customer, one is created and stored in `agency.stripeCustomerId`.
5. Use the link on the portal page to return to your app.

**Troubleshooting:**

| What you see | Fix |
|--------------|-----|
| “Billing is not configured” | Set `STRIPE_SECRET_KEY` to a valid `sk_test_...` and restart server. |
| “No agency found” | User must belong to an agency. |
| Portal opens but shows no subscription | Create a subscription for that customer in Stripe (§1.2). |

---

## How to upgrade or downgrade subscription

Plan changes are done in **Stripe’s billing portal**. The app sends you there; Stripe handles the actual upgrade/downgrade.

### In the app (Agency panel)

1. Log in as **Agency** (or Admin).
2. Open **Subscription** in the sidebar (or go to `/agency/subscription`).
3. Use one of these:
   - **Upgrade Plan** (top section) – opens the billing portal so you can switch to a higher tier.
   - **Manage Billing** – same portal; you can update subscription, payment method, or invoices.
   - On a **plan card**: click **Upgrade** (higher tier) or **Downgrade** (lower tier) – both open the same portal.

You are redirected to Stripe’s hosted billing portal. When you’re done, use the link on the page to return to the app (back to the Subscription page).

### In the Stripe billing portal

- **Update subscription** – if enabled in your Stripe settings, you’ll see an option to change plan (e.g. switch from Starter to Growth). Select the new plan and confirm.
- **Upgrades** – usually prorated and take effect right away.
- **Downgrades** – usually take effect at the **next billing cycle** (you keep the current plan until then).

If you don’t see an option to change plan, the Stripe **Customer portal** may not have “Update subscription” enabled. An admin must configure that in Stripe: [Dashboard → Settings → Billing → Customer portal](https://dashboard.stripe.com/settings/billing/portal), and ensure the right **products and prices** (Solo, Starter, Growth, Pro, Enterprise) exist and are available for the subscription.

### After changing plan in Stripe

If the **Stripe webhook** is configured (§3b below), the app syncs **Current Plan** from Stripe: when a subscription is created or updated, the webhook sets `agency.subscriptionTier` and `agency.stripeSubscriptionId`. If the webhook is not set up, an admin can update the agency’s tier in the app to match Stripe.

---

## 3b. Stripe webhook (sync plan to app)

**Requires:** `STRIPE_WEBHOOK_SECRET`. Optional: `STRIPE_PRICE_PLAN_SOLO`, `STRIPE_PRICE_PLAN_STARTER`, etc., so the webhook can map subscription items to a tier.

1. In Stripe: [Developers → Webhooks](https://dashboard.stripe.com/test/webhooks) → **Add endpoint**.
2. **Endpoint URL:** `https://your-api-domain.com/api/webhooks/stripe` (or `http://localhost:5000/api/webhooks/stripe` for local testing with Stripe CLI).
3. **Events to send:** `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. After creating the endpoint, open it and reveal the **Signing secret** (`whsec_...`). In `server/.env`:
   ```env
   STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
   ```
5. (Optional) To sync tier from subscription items, create Products/Prices in Stripe for each plan (Solo, Starter, Growth, Pro, Enterprise, Business Lite, Business Pro) and set in `.env`:
   ```env
   STRIPE_PRICE_PLAN_SOLO=price_xxx
   STRIPE_PRICE_PLAN_STARTER=price_xxx
   STRIPE_PRICE_PLAN_GROWTH=price_xxx
   STRIPE_PRICE_PLAN_PRO=price_xxx
   STRIPE_PRICE_PLAN_ENTERPRISE=price_xxx
   STRIPE_PRICE_PLAN_BUSINESS_LITE=price_xxx
   STRIPE_PRICE_PLAN_BUSINESS_PRO=price_xxx
   ```
   The webhook finds the agency by `stripeCustomerId` and sets `subscriptionTier` from the first matching plan price in the subscription. Restart the server after changing `.env`.

---

## 4. Test: Managed services (approve → Stripe line item)

**Requires:** Billing portal setup (§1.1, §1.2) plus managed service price IDs (§1.3) if you want Stripe line items.

1. Log in as **Agency**. Ensure the agency has at least one client.
2. Go to **Managed Services** (`/agency/managed-services`).
3. Click **Activate** on a package (e.g. SEO Essentials + Automation), choose a client, confirm, and submit.
4. **Expected:** Request appears as **Pending**.
5. Log in as **Super Admin**. Open the Super Admin dashboard or **Clients** and find the pending managed service request.
6. Click **Approve**.
7. **Expected:** Success message; managed service shows as **Active** for that client.
8. **Verify in Stripe:** The subscription used is the **requesting agency’s** (from the managed service row). The app uses `agency.stripeCustomerId` or `STRIPE_AGENCY_CUSTOMER_ID`. In [Subscriptions](https://dashboard.stripe.com/test/subscriptions), open that customer’s subscription and confirm a new **subscription item** for the approved package (if the corresponding `STRIPE_PRICE_MANAGED_*` is set in `.env`).

**Notes:**

- If a managed price ID is missing, the app still approves the request in the DB but does not add a Stripe line item (and may log a warning).
- Package IDs in the app map to env vars by name (e.g. “SEO Essentials + Automation” → `STRIPE_PRICE_MANAGED_SEO_ESSENTIALS_AUTOMATION`).

### Troubleshooting: No subscription item in Stripe / nothing in Financial Overview

If you approved a managed service but **no new subscription item** appears in Stripe and **nothing shows** in Financial Overview, work through these checks:

1. **Check the server log** after you click Approve. You should see one of:
   - `[Managed service approve] No Stripe subscription item created: STRIPE_PRICE_MANAGED_<NAME> is not set in .env`  
     → Add the missing env var (see §1.3). Use the exact name for the package you approved (e.g. `STRIPE_PRICE_MANAGED_SEO_ESSENTIALS_AUTOMATION` for “SEO Essentials + Automation”). Restart the server.
   - `[Managed service approve] No Stripe subscription item created: customer cus_xxx has no active subscription`  
     → In Stripe Dashboard, open that customer and create a subscription (§1.2). Use test card 4242 4242 4242 4242.

2. **Confirm `.env` has the right variable for the package you approved:**

   | Package you approved | Env var to set |
   |---------------------|----------------|
   | SEO Essentials + Automation | `STRIPE_PRICE_MANAGED_SEO_ESSENTIALS_AUTOMATION` |
   | Growth & Automation | `STRIPE_PRICE_MANAGED_GROWTH_AUTOMATION` |
   | Authority Builder | `STRIPE_PRICE_MANAGED_AUTHORITY_BUILDER` |
   | Market Domination | `STRIPE_PRICE_MANAGED_MARKET_DOMINATION` |
   | Custom | `STRIPE_PRICE_MANAGED_CUSTOM` |

   Each value must be a **Price ID** from Stripe (starts with `price_`). Create the product and price in [Stripe → Products](https://dashboard.stripe.com/test/products), then paste the Price ID into `.env`.

3. **Confirm the same customer is used everywhere:**  
   `STRIPE_AGENCY_CUSTOMER_ID` in `.env` must be the customer that has the **active subscription** in Stripe. If you created a subscription under a different customer, either use that customer’s ID in `.env` or create a new subscription for the customer ID you have in `.env`.

4. **Restart the server** after any `.env` change.

5. **Financial Overview** shows data from **all active Stripe subscriptions**. If no subscription item was created (because of the steps above), there is no new line to show. After fixing env vars and subscription, approve another managed service (or add a new one and approve it) and check again.

---

## 5. Test: Add-ons (Stripe line items)

**Requires:** Billing portal setup (§1.1, §1.2) plus add-on price IDs (§1.4) for the options you test.

1. Log in as **Agency** (or Admin).
2. Go to **Add-ons** (`/agency/add-ons`).
3. Click **Add to Plan** for an add-on your tier allows (e.g. Extra Keywords Tracked +100).
4. **Expected:** Success toast; the add-on appears in **Active Add-ons**.
5. **Verify in Stripe:** [Subscriptions](https://dashboard.stripe.com/test/subscriptions) → open the agency customer’s subscription. You should see a new line item for that add-on (if the matching `STRIPE_PRICE_ADDON_*` is set).

**Troubleshooting:**

- If the add-on is added in the app but no new line appears in Stripe, check that the correct `STRIPE_PRICE_ADDON_*` is in `.env` (e.g. `STRIPE_PRICE_ADDON_EXTRA_KEYWORDS_TRACKED_100`) and the server was restarted.
- Add-on availability is tier-based (e.g. Business Lite/Pro cannot add Extra Dashboards).

---

## 6. Quick checklist

| Test | Env vars | Pass criteria |
|------|----------|----------------|
| Financial Overview | `STRIPE_SECRET_KEY` | MRR/activity loads or empty state; no “not configured” error. |
| Billing portal | `STRIPE_SECRET_KEY`, `STRIPE_AGENCY_CUSTOMER_ID`, customer has subscription | Redirect to Stripe portal; can return to app. |
| Managed services (Stripe) | Above + `STRIPE_PRICE_MANAGED_*` for the package | Approve request → new subscription item in Stripe. |
| Add-ons (Stripe) | Above + `STRIPE_PRICE_ADDON_*` for the option | Add add-on → new subscription item in Stripe. |

**Test card:** Use **4242 4242 4242 4242** whenever Stripe asks for payment (any future expiry, any CVC).
