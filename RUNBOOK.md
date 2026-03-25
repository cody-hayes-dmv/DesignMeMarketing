# Incident Runbook

Use this runbook to triage and resolve incidents quickly across Clients, Tasks, Reports, Local Map, Web Design, and Billing flows.

## 0) Ticket Header

- Issue:
- Environment: local / staging / prod
- User role: AGENCY / SPECIALIST / DESIGNER / USER / ADMIN / SUPER_ADMIN
- Client/agency IDs:
- First seen at:

## 1) Reproduction

- Page + action:
- Steps to reproduce:
- Expected:
- Actual:

## 2) Network Evidence

- Request URL:
- Method:
- Status code:
- Request payload:
- Response body (`message`):
- Request ID / timestamp (if available):

## 3) Trace Path (UI -> API -> Backend)

- Frontend file/function:
- API path used:
- Backend route file/handler:
- Middleware in path (auth/trial/domain):

## 4) Root Cause Classification

- [ ] Auth/JWT
- [ ] Role/permission
- [ ] Tenant/agency/domain context
- [ ] Validation/schema mismatch
- [ ] Integration/env (Stripe, GA4, Google Ads, DataForSEO, SMTP)
- [ ] Data integrity/record linkage
- [ ] UI state bug
- [ ] Regression from recent change

## 5) Fix

- Code change summary:
- Files touched:
- Why this fix is safe:
- Backward compatibility impact:

## 6) Verification

- [ ] Original repro now passes
- [ ] No role regression (test at least 2 roles)
- [ ] No tenant leakage (agency/client scope check)
- [ ] Related flows still work
- [ ] Error handling/toast still correct

## 7) Post-Fix Notes

- Need migration/env update?
- Need test coverage?
- Need monitoring alert/log?
- Follow-up tasks:

---

## Quick "Probable Cause -> First File" Map

- 401/403 on protected route -> `server/src/middleware/auth.ts`
- Blocked by trial/plan -> `server/src/middleware/requireAgencyTrialNotExpired.ts`
- Wrong brand/tenant behavior -> `server/src/middleware/resolveAgencyDomainContext.ts`
- Client CRUD issues -> `server/src/routes/clients.ts` and `app/src/store/slices/clientSlice.ts`
- Task create/update/status issues -> `server/src/routes/tasks.ts` and `app/src/store/slices/taskSlice.ts`
- Report generate/send/schedule issues -> `server/src/routes/seo.ts` and `app/src/pages/ReportsPage.tsx`
- Local Map snapshot failures -> `server/src/routes/localMap.ts` and `app/src/components/LocalMapSnapshotRunner.tsx`
- Web Design workflow failures -> `server/src/routes/webDesign.ts` and `app/src/components/WebDesignWorkspace.tsx`
- Upload errors -> `server/src/routes/upload.ts`
- Billing/subscription/add-on errors -> `server/src/routes/agencies.ts`, `server/src/routes/stripeWebhook.ts`, `server/src/routes/financial.ts`
- CORS/custom domain issues -> `server/src/index.ts` and domain context middleware

---

## 5-Minute Triage Sequence

1. Capture the failing request from browser network tools.
2. Confirm role, token, and endpoint match the expected flow.
3. Open the backend route handler for that endpoint and check guards first.
4. Check related middleware (auth/trial/domain).
5. For 500s, compare payload shape against zod/prisma expectations.
6. If integration is involved, verify env vars and external credential state.

---

## Feature Routing Reference

### Clients

- UI: `app/src/pages/ClientsPage.tsx`
- API layer: `app/src/store/slices/clientSlice.ts`
- Backend: `server/src/routes/clients.ts`
- Common endpoints:
  - `GET /clients`
  - `POST /clients`
  - `PUT /clients/:id`
  - `PATCH /clients/:id/archive`
  - `PATCH /clients/:id/restore`
  - `DELETE /clients/:id`

### Tasks

- UI: `app/src/pages/TasksPage.tsx`
- API layer: `app/src/store/slices/taskSlice.ts`
- Backend: `server/src/routes/tasks.ts`
- Common endpoints:
  - `GET /tasks`
  - `POST /tasks`
  - `PUT /tasks/:id`
  - `PATCH /tasks/:id/status`
  - `GET /tasks/assignable-users`
  - `GET /tasks/recurring`

### Reports (SEO)

- UI: `app/src/pages/ReportsPage.tsx`
- Backend: `server/src/routes/seo.ts`
- Common endpoints:
  - `GET /seo/reports/:clientId`
  - `POST /seo/reports/:clientId/generate`
  - `POST /seo/reports/:reportId/send`
  - `POST /seo/reports/:clientId/schedule`
  - `POST /seo/share-link/:clientId`

### Local Map Snapshot

- UI wrapper: `app/src/pages/Agency/LocalMapSnapshotPage.tsx`
- Main component: `app/src/components/LocalMapSnapshotRunner.tsx`
- Backend: `server/src/routes/localMap.ts`
- Common endpoints:
  - `GET /local-map/snapshot/summary`
  - `POST /local-map/snapshot/run`
  - `POST /local-map/snapshot/point-serp`
  - `GET /local-map/snapshot/static-map`

### Web Design

- UI wrapper: `app/src/pages/WebDesignPage.tsx`
- Main component: `app/src/components/WebDesignWorkspace.tsx`
- Backend: `server/src/routes/webDesign.ts`
- Common endpoints:
  - `GET /web-design/projects`
  - `GET /web-design/projects/:projectId`
  - `POST /web-design/projects/activate`
  - `POST /web-design/projects/:projectId/pages`
  - `POST /web-design/pages/:pageId/versions`
  - `POST /web-design/pages/:pageId/comments`
  - `POST /web-design/pages/:pageId/approve`

