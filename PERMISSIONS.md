# Permissions & Access Control

## SUPER Admin
- **Can see everything** (all agencies, clients, tasks, financials).
- **Can create/edit/delete specialists** (Team invite, manage members).
- **Can assign tasks to anyone** (create tasks, set assignee).
- **Can view all client dashboards** (no agency filter).
- **Can approve managed services** (managed services flows; financial overview).

## Specialist
- **Can ONLY see:**
  - Their own task list (API returns only tasks where `assigneeId === user.id`).
  - Tasks assigned to them (view, comment, update status via PATCH).
  - Clients they have tasks for (via task context; read-only where exposed).
- **Cannot see:**
  - Other specialists' tasks.
  - Financial data (financial routes require AGENCY / ADMIN / SUPER_ADMIN).
  - Agency management (no Clients, Team management, Managed Services, Add-Ons, Subscription, etc.).
  - Client creation/editing.
  - Task assignment (they receive tasks; cannot create, edit details, or delete tasks).

**API enforcement:**  
`GET /tasks` for SPECIALIST returns only tasks with `assigneeId = current user`.  
`POST /tasks`, `PUT /tasks/:id`, `DELETE /tasks/:id` return 403 for SPECIALIST.  
`PATCH /tasks/:id/status` allowed only for tasks assigned to the specialist.  
Managed services and financial routes explicitly block SPECIALIST.

## Agency Admin (AGENCY / ADMIN)
- **Can see their own clients** (clients scoped by user’s agency membership).
- **Can create tasks for their clients** (create task, set clientId, assigneeId).
- **Can assign tasks to specialists** in their agency (if allowed by product rules).
- **Cannot see other agencies’ data** (agency-scoped queries via `UserAgency` membership).

## Client status workflow & automation

1. **Dashboard Only:** Agency creates client dashboard → status `DASHBOARD_ONLY`.
2. **Pending:** Agency activates managed service → status `PENDING`; email notification to Super Admin.
3. **Active:** Super Admin approves → status `ACTIVE`; confirmation to agency; billing starts (Stripe).
4. **Canceled:** Agency or Super Admin cancels → status `CANCELED` with end date (optional `keepDashboard` in body).
5. **End date arrives:** Daily job runs:
   - If `keepDashboardAfterEndDate` is true → status `DASHBOARD_ONLY` (client keeps dashboard, reporting only).
   - Else → status `ARCHIVED`.
6. **Suspended:** Agency can suspend a client’s dashboard (e.g. non-payment) → status `SUSPENDED`; dashboard is frozen until reactivated via `PATCH /clients/:id/reactivate`.

Endpoints: `POST /agencies/managed-services` (creates PENDING, emails Super Admin), `PATCH /agencies/managed-services/:id/approve` (Super Admin), `PATCH /agencies/managed-services/:id/cancel` (optional `endDate`, `keepDashboard`), `PATCH /clients/:id/suspend`, `PATCH /clients/:id/reactivate`.

---

*Backend enforcement is in `server/src/routes/tasks.ts`, `server/src/routes/agencies.ts`, `server/src/routes/financial.ts`, and related routes. Frontend hides menu items and actions by role (e.g. Sidebar, TasksPage).*
