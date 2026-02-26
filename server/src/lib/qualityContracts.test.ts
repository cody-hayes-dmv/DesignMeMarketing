import test from "node:test";
import assert from "node:assert/strict";
import {
  BRAND_DISPLAY_NAME,
  REPORT_SECTION_ORDER,
  REPORT_SECTION_TITLES,
  buildReportEmailSubject,
  normalizeReportPeriod,
  normalizeReportStatus,
  normalizeEmailRecipients,
  normalizeWhitelabelText,
  parsePeriodDays,
  toDisplayReportStatus,
} from "./qualityContracts.js";

test("normalizes legacy brand references", () => {
  const normalized = normalizeWhitelabelText(
    "Welcome to YourSEODashboard by Design ME Marketing (formerly ZOESI)."
  );
  assert.equal(
    normalized,
    "Welcome to Your Marketing Dashboard by Your Marketing Dashboard (formerly Your Marketing Dashboard)."
  );
});

test("parses period days with strict allowed values", () => {
  assert.equal(parsePeriodDays("30"), 30);
  assert.equal(parsePeriodDays("7"), 7);
  assert.equal(parsePeriodDays("999"), 30);
  assert.equal(parsePeriodDays("abc"), 30);
});

test("normalizes recipients from multiple formats", () => {
  assert.deepEqual(normalizeEmailRecipients('["a@test.com"," b@test.com "]'), [
    "a@test.com",
    "b@test.com",
  ]);
  assert.deepEqual(normalizeEmailRecipients("a@test.com, b@test.com"), [
    "a@test.com",
    "b@test.com",
  ]);
  assert.deepEqual(normalizeEmailRecipients(null), []);
});

test("builds report subject with global brand", () => {
  assert.equal(
    buildReportEmailSubject("Acme Co", "monthly"),
    `${BRAND_DISPLAY_NAME} Report - Acme Co - Monthly`
  );
});

test("normalizes report status consistently", () => {
  assert.equal(normalizeReportStatus("SENT"), "sent");
  assert.equal(normalizeReportStatus("Scheduled"), "scheduled");
  assert.equal(normalizeReportStatus("unknown"), "draft");
  assert.equal(toDisplayReportStatus("sent"), "Sent");
  assert.equal(toDisplayReportStatus("scheduled"), "Scheduled");
  assert.equal(toDisplayReportStatus("anything"), "Draft");
});

test("normalizes report period to supported values", () => {
  assert.equal(normalizeReportPeriod("weekly"), "weekly");
  assert.equal(normalizeReportPeriod("biweekly"), "biweekly");
  assert.equal(normalizeReportPeriod("monthly"), "monthly");
  assert.equal(normalizeReportPeriod("daily"), "monthly");
});

test("keeps report section contract stable", () => {
  assert.deepEqual(REPORT_SECTION_ORDER, [
    "traffic_overview",
    "seo_performance",
    "money_keywords",
    "topical_keywords",
    "live_dashboard",
  ]);
  assert.equal(REPORT_SECTION_TITLES.traffic_overview, "Traffic Overview");
  assert.equal(REPORT_SECTION_TITLES.live_dashboard, "Live Dashboard");
});
