import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshotCreditPackNotificationContent } from "./addOnNotifications.js";

test("buildSnapshotCreditPackNotificationContent returns addon_added payloads for agency and super admin", () => {
  const content = buildSnapshotCreditPackNotificationContent({
    agencyName: "Acme Agency",
    credits: 10,
    priceCents: 3400,
    brandDisplayName: "DesignMe",
    agencyGreetingName: "Alex",
  });

  assert.equal(content.displayName, "Local Map Snapshot Credits (10)");
  assert.equal(content.billingLabel, "one-time");

  assert.deepEqual(content.agencyNotification, {
    type: "addon_added",
    title: "Add-on added",
    message: "Local Map Snapshot Credits (10) was added to your plan.",
    link: "/agency/add-ons",
  });

  assert.deepEqual(content.superAdminNotification, {
    type: "addon_added",
    title: "Agency add-on added",
    message: "Acme Agency added Local Map Snapshot Credits (10).",
    link: "/agency/agencies",
  });
});

test("buildSnapshotCreditPackNotificationContent email content includes agency, credits and one-time price", () => {
  const content = buildSnapshotCreditPackNotificationContent({
    agencyName: "North Star",
    credits: 25,
    priceCents: 7400,
    brandDisplayName: "DesignMe",
    agencyGreetingName: "Taylor",
  });

  assert.equal(content.agencyEmail.subject, "Add-on added to your plan - DesignMe");
  assert.match(content.agencyEmail.html, /Hi Taylor,/);
  assert.match(content.agencyEmail.html, /Local Map Snapshot Credits \(25\)/);
  assert.match(content.agencyEmail.html, /\$74\.00 one-time/);

  assert.equal(content.superAdminEmail.subject, "Agency add-on added - North Star");
  assert.match(content.superAdminEmail.html, /Agency:\<\/strong> North Star/);
  assert.match(content.superAdminEmail.html, /Price:\<\/strong> \$74\.00 one-time/);
});
