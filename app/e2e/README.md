## Playwright E2E Smoke

This suite validates role-based login and route access for:

- `SUPER_ADMIN`
- `ADMIN`
- `AGENCY`
- `SPECIALIST`
- `DESIGNER`
- `USER`

### Required env vars

Set these before running:

- `E2E_SUPERADMIN_EMAIL`
- `E2E_SUPERADMIN_PASSWORD`
- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`
- `E2E_AGENCY_EMAIL`
- `E2E_AGENCY_PASSWORD`
- `E2E_SPECIALIST_EMAIL`
- `E2E_SPECIALIST_PASSWORD`
- `E2E_DESIGNER_EMAIL`
- `E2E_DESIGNER_PASSWORD`
- `E2E_USER_EMAIL`
- `E2E_USER_PASSWORD`

Optional:

- `E2E_BASE_URL` (default: `http://localhost:3001`)

### Run

From `app/`:

- `npm run test:e2e`
- `npm run test:e2e:headed`
- `npm run test:e2e:ui`
