import test from "node:test";
import assert from "node:assert/strict";
import { canAddKeywords, canAddTargetKeyword, type AgencyTierContext } from "./agencyLimits.js";

function makeCtx(overrides: Partial<AgencyTierContext>): AgencyTierContext {
  return {
    agencyId: "agency-1",
    agency: {
      id: "agency-1",
      subscriptionTier: "free",
      keywordResearchCreditsUsed: 0,
      keywordResearchCreditsResetAt: null,
    },
    trialExpired: false,
    tierConfig: {
      id: "free",
      name: "Free",
      type: "agency",
      maxDashboards: 0,
      keywordsTotal: 0,
      researchCreditsPerMonth: 5,
      rankUpdateFrequency: "weekly",
      aiUpdateFrequency: "weekly",
      maxTeamUsers: 0,
      hasWhiteLabel: true,
      hasClientPortal: true,
      priceMonthlyUsd: 0,
    },
    dashboardCount: 0,
    totalKeywords: 0,
    keywordsByClient: new Map<string, number>(),
    totalTargetKeywords: 0,
    targetKeywordsByClient: new Map<string, number>(),
    teamMemberCount: 0,
    creditsUsed: 0,
    creditsLimit: 5,
    creditsResetsAt: null,
    effectiveMaxDashboards: 0,
    effectiveKeywordCap: 0,
    effectiveMaxTeamUsers: 0,
    ...overrides,
  };
}

test("canAddKeywords blocks Free tier when keyword cap is 0", () => {
  const ctx = makeCtx({ effectiveKeywordCap: 0, totalKeywords: 0 });
  const result = canAddKeywords(ctx, "client-1", 1);
  assert.equal(result.allowed, false);
  assert.match(result.message || "", /allows 0 keywords/i);
});

test("canAddTargetKeyword blocks Free tier when keyword cap is 0", () => {
  const ctx = makeCtx({ effectiveKeywordCap: 0, totalTargetKeywords: 0 });
  const result = canAddTargetKeyword(ctx, "client-1");
  assert.equal(result.allowed, false);
  assert.match(result.message || "", /allows 0 keywords/i);
});

test("canAddKeywords allows when under cap", () => {
  const ctx = makeCtx({ effectiveKeywordCap: 5, totalKeywords: 4 });
  const result = canAddKeywords(ctx, "client-1", 1);
  assert.equal(result.allowed, true);
});
