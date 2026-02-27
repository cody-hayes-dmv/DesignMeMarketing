import test from "node:test";
import assert from "node:assert/strict";
import {
  enforceAiIntelligenceAccuracy,
  enforceAiVisibilityAccuracy,
  enforceDashboardMetricAccuracy,
  enforceDomainOverviewAccuracy,
} from "./metricAccuracy.js";

test("fail-closes dashboard GA4 metrics when source is not ga4", () => {
  const out = enforceDashboardMetricAccuracy({
    totalSessions: 123,
    organicSessions: 80,
    conversions: 5,
    activeUsers: 40,
    eventCount: 100,
    newUsers: 12,
    keyEvents: 4,
    totalUsers: 55,
    firstTimeVisitors: 12,
    engagedVisitors: 20,
    averagePosition: 8.3,
    dataSources: { traffic: "database", conversions: "seo_report" },
  });

  assert.equal(out.totalSessions, null);
  assert.equal(out.organicSessions, null);
  assert.equal(out.conversions, null);
  assert.equal(out.averagePosition, 8.3);
  assert.equal(out.accuracy.mode, "fail_closed");
  assert.equal(Array.isArray(out.accuracy.unavailable), true);
  assert.equal(out.accuracy.unavailable.length > 0, true);
});

test("keeps dashboard metrics when GA4 source is authoritative", () => {
  const out = enforceDashboardMetricAccuracy({
    totalSessions: 123,
    organicSessions: 80,
    conversions: 5,
    activeUsers: 40,
    eventCount: 100,
    newUsers: 12,
    keyEvents: 4,
    totalUsers: 55,
    firstTimeVisitors: 12,
    engagedVisitors: 20,
    organicSearchEngagedSessions: 18,
    averagePosition: 8.3,
    dataSources: { traffic: "ga4", conversions: "ga4" },
  });

  assert.equal(out.totalSessions, 123);
  assert.equal(out.organicSessions, 80);
  assert.equal(out.conversions, 5);
  assert.equal(out.accuracy.isAccurate, true);
});

test("normalizes invalid AI visibility payload", () => {
  const out = enforceAiVisibilityAccuracy({ rows: [{ name: "ChatGPT", visibility: "n/a", mentions: 3, citedPages: 1 }] });
  assert.equal(Array.isArray(out.rows), true);
  assert.equal(out.rows.length, 0);
  assert.equal(out.accuracy.isAccurate, false);
});

test("fail-closes malformed AI intelligence payload", () => {
  const out = enforceAiIntelligenceAccuracy({ kpis: null });
  assert.equal(out.kpis.aiVisibilityScore, 0);
  assert.equal(out.accuracy.isAccurate, false);
});

test("adds accuracy envelope to domain overview", () => {
  const out = enforceDomainOverviewAccuracy({
    metrics: {
      organicSearch: { keywords: 10, traffic: 120 },
      authorityScore: 45,
    },
  });
  assert.equal(out.metrics.organicSearch.keywords, 10);
  assert.equal(out.metrics.authorityScore, 45);
  assert.equal(out.accuracy.isAccurate, true);
});
