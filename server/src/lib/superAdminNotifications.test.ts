import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSuperAdminNotificationRecipients,
  shouldReceiveSuperAdminSignupEmail,
} from "./superAdminNotifications.js";

test("shouldReceiveSuperAdminSignupEmail defaults to true", () => {
  assert.equal(shouldReceiveSuperAdminSignupEmail(null), true);
  assert.equal(shouldReceiveSuperAdminSignupEmail(undefined), true);
  assert.equal(shouldReceiveSuperAdminSignupEmail({}), true);
});

test("shouldReceiveSuperAdminSignupEmail honors teamUpdates flag", () => {
  assert.equal(shouldReceiveSuperAdminSignupEmail({ teamUpdates: false }), false);
  assert.equal(shouldReceiveSuperAdminSignupEmail({ teamUpdates: true }), true);
});

test("resolveSuperAdminNotificationRecipients includes opted-in super admins and env fallbacks", () => {
  const recipients = resolveSuperAdminNotificationRecipients(
    [
      { email: "One@Example.com", notificationPreferences: null },
      { email: "two@example.com", notificationPreferences: { teamUpdates: true } },
      { email: "skip@example.com", notificationPreferences: { teamUpdates: false } },
      { email: "  one@example.com  ", notificationPreferences: {} },
      { email: "", notificationPreferences: null },
      { email: null, notificationPreferences: null },
    ],
    {
      superAdminNotifyEmail: "fallback@example.com",
      managedServiceNotifyEmail: " two@example.com , extra@example.com ",
      johnnyEmail: "",
    }
  ).sort();

  assert.deepEqual(recipients, [
    "extra@example.com",
    "fallback@example.com",
    "one@example.com",
    "two@example.com",
  ]);
});
