import { expect, test } from "@playwright/test";

const credentials = {
  SUPER_ADMIN: {
    email: process.env.E2E_SUPERADMIN_EMAIL,
    password: process.env.E2E_SUPERADMIN_PASSWORD,
  },
  ADMIN: {
    email: process.env.E2E_ADMIN_EMAIL,
    password: process.env.E2E_ADMIN_PASSWORD,
  },
  AGENCY: {
    email: process.env.E2E_AGENCY_EMAIL,
    password: process.env.E2E_AGENCY_PASSWORD,
  },
  SPECIALIST: {
    email: process.env.E2E_SPECIALIST_EMAIL,
    password: process.env.E2E_SPECIALIST_PASSWORD,
  },
  DESIGNER: {
    email: process.env.E2E_DESIGNER_EMAIL,
    password: process.env.E2E_DESIGNER_PASSWORD,
  },
  USER: {
    email: process.env.E2E_USER_EMAIL,
    password: process.env.E2E_USER_PASSWORD,
  },
};

const roleMatrix = [
  {
    role: "SUPER_ADMIN",
    landing: /\/superadmin\/dashboard$/,
    allowedRoutes: ["/superadmin/dashboard", "/superadmin/financial-overview", "/superadmin/web-design"],
    forbiddenProbe: { path: "/agency/local-map-snapshot", expectedRedirect: /\/superadmin\/dashboard$/ },
  },
  {
    role: "ADMIN",
    landing: /\/superadmin\/dashboard$/,
    allowedRoutes: ["/superadmin/dashboard", "/superadmin/financial-overview", "/agency/clients"],
    forbiddenProbe: { path: "/agency/local-map-snapshot", expectedRedirect: /\/superadmin\/dashboard$/ },
  },
  {
    role: "AGENCY",
    landing: /\/agency\/dashboard$/,
    allowedRoutes: ["/agency/dashboard", "/agency/tasks", "/agency/reports", "/agency/local-map-snapshot"],
    forbiddenProbe: { path: "/superadmin/financial-overview", expectedRedirect: /\/agency\/dashboard$/ },
  },
  {
    role: "SPECIALIST",
    landing: /\/specialist\/dashboard$/,
    allowedRoutes: ["/specialist/dashboard", "/specialist/tasks", "/specialist/inbox"],
    forbiddenProbe: { path: "/superadmin/financial-overview", expectedRedirect: /\/specialist\/dashboard$/ },
  },
  {
    role: "DESIGNER",
    landing: /\/designer\/web-design$/,
    allowedRoutes: ["/designer/web-design", "/designer/settings"],
    forbiddenProbe: { path: "/superadmin/financial-overview", expectedRedirect: /\/designer\/web-design$/ },
  },
  {
    role: "USER",
    landing: /\/client\/dashboard\/.+/,
    allowedRoutes: ["/client/tasks", "/client/inbox", "/client/settings"],
    forbiddenProbe: { path: "/superadmin/financial-overview", expectedRedirect: /\/client\/dashboard\/.+/ },
  },
];

const missingCredentialRoles = Object.entries(credentials)
  .filter(([, value]) => !value.email || !value.password)
  .map(([role]) => role);

async function assertBackendUp() {
  const response = await fetch("http://localhost:5000/health");
  if (!response.ok) {
    throw new Error(`Backend health check failed with status ${response.status}`);
  }
}

async function login(page, role) {
  const creds = credentials[role];
  if (!creds?.email || !creds?.password) {
    throw new Error(`Missing credentials for ${role}.`);
  }

  await page.goto("/login");
  await page.getByLabel("Email Address").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

test.describe("Role-based portal smoke", () => {
  test.skip(
    missingCredentialRoles.length > 0,
    `Missing E2E credential env vars for: ${missingCredentialRoles.join(", ")}`
  );

  test.beforeAll(async () => {
    await assertBackendUp();
  });

  for (const item of roleMatrix) {
    test(`${item.role}: login, route access, forbidden redirect, logout`, async ({ page }) => {
      await login(page, item.role);
      const signOutButton = page.getByRole("button", { name: /sign out/i }).first();

      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 30_000 })
        .toMatch(item.landing);

      await expect(signOutButton).toBeVisible();

      for (const route of item.allowedRoutes) {
        await page.goto(route);
        await expect
          .poll(() => new URL(page.url()).pathname, { timeout: 20_000 })
          .toMatch(new RegExp(`^${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      }

      await page.goto(item.forbiddenProbe.path);
      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 20_000 })
        .toMatch(item.forbiddenProbe.expectedRedirect);

      await signOutButton.click();
      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 20_000 })
        .toBe("/login");
    });
  }
});
