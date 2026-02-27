# White-Label Branding + Domain QA Checklist

## Preconditions
- Agency user account on an agency tier (not business tier).
- Access to DNS records for the test custom domain.
- Server running with latest migration applied.

## 1) Agency Settings: Branding Save
- Go to `Agency -> Settings -> Agency`.
- Set `Brand display name`, `Logo URL`, and `Primary brand color`.
- Click `Save Changes`.
- Expected:
  - Success toast.
  - Values persist after refresh.
  - `/api/agencies/me` returns saved branding values.

## 2) Agency Settings: Custom Domain Save
- Enter a valid custom domain (for example `portal.example.com`) and save.
- Expected:
  - Domain status becomes `PENDING_VERIFICATION`.
  - DNS instructions are displayed (TXT + CNAME).
  - Verification token exists server-side.

## 3) Domain Verification
- Add the TXT DNS record shown in settings.
- Click `Verify domain`.
- Expected:
  - Status changes to `VERIFIED`.
  - Verification timestamp is set.
  - Error state clears.

## 4) SSL Provisioning
- After verification, click `Provision SSL`.
- Expected:
  - Status transitions to `ACTIVE`.
  - SSL issued timestamp is set.
  - No SSL error shown.

## 5) Agency App Shell Branding
- Open agency routes with sidebar/header (for example `/agency/dashboard`, `/agency/clients`).
- Expected:
  - Sidebar logo uses agency logo when provided.
  - Sidebar/header show brand display name.
  - Active shell accents use primary brand color.

## 6) Client Panel Shell Branding
- Log in as a client user under the same agency.
- Open `/client/dashboard/:clientId` and `/client/tasks`.
- Expected:
  - Client sidebar/header reflect same agency branding.
  - Brand color appears on active nav/header accents.

## 7) Custom Domain Runtime Guard
- Access API through an inactive custom domain host.
- Expected:
  - API returns guard message indicating domain is not active.
- Access API through active custom domain.
- Expected:
  - Requests resolve normally.

## 8) Regression Checks
- Business-tier agency: `Agency` branding controls are hidden.
- Super Admin/Admin flows continue to load and save agencies.
- Existing subdomain-based links still render correctly.

