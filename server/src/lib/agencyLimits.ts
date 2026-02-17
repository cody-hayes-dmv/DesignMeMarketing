import { prisma } from "./prisma.js";
import { getTierConfig, type TierConfig } from "./tiers.js";

const TRIAL_EXPIRED_MESSAGE = "Trial ended. Contact support to add a paid plan to continue.";

export interface AgencyTierContext {
  agencyId: string | null;
  agency: { id: string; subscriptionTier: string | null; keywordResearchCreditsUsed: number; keywordResearchCreditsResetAt: Date | null } | null;
  /** True when agency is free (no-charge) and trial period has ended */
  trialExpired: boolean;
  tierConfig: TierConfig | null;
  /** Number of client dashboards accessible (for limit check) */
  dashboardCount: number;
  /** Total keywords across all accessible clients (for business tier limit) */
  totalKeywords: number;
  /** Per-client keyword counts (for agency tier limit). clientId -> count */
  keywordsByClient: Map<string, number>;
  /** Total target keywords (for limit when adding target keywords) */
  totalTargetKeywords: number;
  /** Per-client target keyword counts. clientId -> count */
  targetKeywordsByClient: Map<string, number>;
  teamMemberCount: number;
  /** Credits used this month (after applying reset if needed) */
  creditsUsed: number;
  /** Credits limit from tier + extra keyword research add-ons */
  creditsLimit: number;
  /** When credits reset (end of current month) */
  creditsResetsAt: Date | null;
  /** Max dashboards (tier + extra dashboard add-ons). If null, use tierConfig.maxDashboards. */
  effectiveMaxDashboards: number | null;
  /** Total keyword cap (base tier + extra keywords tracked add-ons). Used for business total and agency account-wide cap. */
  effectiveKeywordCap: number | null;
}

const now = () => new Date();

/**
 * Reset credits if we're past the reset date; update DB and return new used count and resetAt.
 */
async function ensureCreditsReset(
  agencyId: string,
  agency: { keywordResearchCreditsUsed: number; keywordResearchCreditsResetAt: Date | null }
): Promise<{ used: number; resetsAt: Date }> {
  const resetAt = agency.keywordResearchCreditsResetAt;
  if (resetAt && now() <= resetAt) return { used: agency.keywordResearchCreditsUsed, resetsAt: resetAt };
  const endOfMonth = new Date(now().getFullYear(), now().getMonth() + 1, 0, 23, 59, 59, 999);
  await prisma.agency.update({
    where: { id: agencyId },
    data: { keywordResearchCreditsUsed: 0, keywordResearchCreditsResetAt: endOfMonth },
  });
  return { used: 0, resetsAt: endOfMonth };
}

/**
 * Get tier context for the current user: their agency, tier config, and usage counts.
 * For SUPER_ADMIN/ADMIN we don't apply limits (return null tierConfig or high limits).
 */
export async function getAgencyTierContext(userId: string, role: string): Promise<AgencyTierContext> {
  const emptyContext: AgencyTierContext = {
    agencyId: null,
    agency: null,
    trialExpired: false,
    tierConfig: null,
  dashboardCount: 0,
  totalKeywords: 0,
  keywordsByClient: new Map(),
  totalTargetKeywords: 0,
  targetKeywordsByClient: new Map(),
  teamMemberCount: 0,
  creditsUsed: 0,
  creditsLimit: 0,
  creditsResetsAt: null,
  effectiveMaxDashboards: null,
  effectiveKeywordCap: null,
};

  if (role === "SUPER_ADMIN" || role === "ADMIN") {
    const allClients = await prisma.client.count();
    const totalKeywords = await prisma.keyword.count();
  return {
    ...emptyContext,
    dashboardCount: allClients,
    totalKeywords,
    creditsLimit: 10000,
    creditsResetsAt: null,
    effectiveMaxDashboards: null,
    effectiveKeywordCap: null,
  };
}

async function getTargetKeywordCounts(clientIds: string[]) {
  if (clientIds.length === 0) return { total: 0, byClient: new Map<string, number>() };
  const rows = await prisma.targetKeyword.groupBy({
    by: ["clientId"],
    where: { clientId: { in: clientIds } },
    _count: { id: true },
  });
  const byClient = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    byClient.set(r.clientId, r._count.id);
    total += r._count.id;
  }
  return { total, byClient };
}

  const membership = await prisma.userAgency.findFirst({
    where: { userId },
    include: {
      agency: {
        select: {
          id: true,
          subscriptionTier: true,
          billingType: true,
          trialEndsAt: true,
          keywordResearchCreditsUsed: true,
          keywordResearchCreditsResetAt: true,
        },
      },
    },
  });

  if (!membership?.agency) {
    return emptyContext;
  }

  const agency = membership.agency;
  const now = new Date();
  const trialExpired =
    agency.billingType === "free" &&
    (agency.trialEndsAt == null || agency.trialEndsAt <= now);
  const tierConfig = getTierConfig(agency.subscriptionTier) ?? (agency.billingType === "free" ? getTierConfig("free") : null);

  // Clients accessible by any user in this agency (same logic as dashboard)
  const agencyUserIds = await prisma.userAgency.findMany({
    where: { agencyId: agency.id },
    select: { userId: true },
  }).then((rows) => rows.map((r) => r.userId));

  const clients = await prisma.client.findMany({
    where: { userId: { in: agencyUserIds } },
    select: { id: true, isAgencyOwnDashboard: true },
  });
  const clientIds = clients.map((c) => c.id);

  // Included clients (ClientAgencyIncluded) are free - they do not count toward tier dashboard limit
  const includedClientIds = await prisma.clientAgencyIncluded
    .findMany({ where: { agencyId: agency.id }, select: { clientId: true } })
    .then((rows) => new Set(rows.map((r) => r.clientId)));

  // Default agency dashboard (isAgencyOwnDashboard) does not count toward tier limit
  // Exclude included clients so they are free (do not consume tier slots)
  const dashboardCount = clients.filter(
    (c) => !c.isAgencyOwnDashboard && !includedClientIds.has(c.id)
  ).length;

  const keywordCounts = await prisma.keyword.groupBy({
    by: ["clientId"],
    where: { clientId: { in: clientIds } },
    _count: { id: true },
  });
  const keywordsByClient = new Map<string, number>();
  let totalKeywords = 0;
  for (const row of keywordCounts) {
    keywordsByClient.set(row.clientId, row._count.id);
    totalKeywords += row._count.id;
  }

  const { total: totalTargetKeywords, byClient: targetKeywordsByClient } = await getTargetKeywordCounts(clientIds);

  const teamMemberCount = await prisma.userAgency.count({
    where: { agencyId: agency.id },
  });

  let creditsUsed = agency.keywordResearchCreditsUsed;
  let creditsResetsAt: Date | null = agency.keywordResearchCreditsResetAt;
  if (tierConfig && (agency.keywordResearchCreditsResetAt || agency.keywordResearchCreditsUsed > 0)) {
    const reset = await ensureCreditsReset(agency.id, agency);
    creditsUsed = reset.used;
    creditsResetsAt = reset.resetsAt;
  }
  let creditsLimit = tierConfig?.keywordResearchCreditsPerMonth ?? 0;
  let effectiveMaxDashboards: number | null = tierConfig?.maxDashboards ?? null;

  const addOns = await prisma.agencyAddOn.findMany({
    where: { agencyId: agency.id },
    select: { addOnType: true, addOnOption: true },
  });
  let addOnKeywords = 0;
  for (const a of addOns) {
    if (a.addOnType === "extra_keyword_lookups") {
      if (a.addOnOption === "100") creditsLimit += 100;
      else if (a.addOnOption === "300") creditsLimit += 300;
      else if (a.addOnOption === "500") creditsLimit += 500;
    } else if (a.addOnType === "extra_dashboards") {
      if (effectiveMaxDashboards != null) {
        if (a.addOnOption === "5_slots") effectiveMaxDashboards += 5;
        else if (a.addOnOption === "10_slots") effectiveMaxDashboards += 10;
        else if (a.addOnOption === "25_slots") effectiveMaxDashboards += 25;
      }
    } else if (a.addOnType === "extra_keywords_tracked") {
      if (a.addOnOption === "100") addOnKeywords += 100;
      else if (a.addOnOption === "250") addOnKeywords += 250;
      else if (a.addOnOption === "500") addOnKeywords += 500;
    }
  }

  let effectiveKeywordCap: number | null = null;
  if (tierConfig) {
    if (tierConfig.type === "business" && tierConfig.keywordsTotal != null) {
      effectiveKeywordCap = tierConfig.keywordsTotal + addOnKeywords;
    } else if (tierConfig.maxDashboards != null && tierConfig.keywordsPerDashboard != null) {
      const maxD = effectiveMaxDashboards ?? tierConfig.maxDashboards;
      effectiveKeywordCap = maxD * tierConfig.keywordsPerDashboard + addOnKeywords;
    }
  }

  return {
    agencyId: agency.id,
    agency: { ...agency, keywordResearchCreditsUsed: creditsUsed },
    trialExpired,
    tierConfig: tierConfig ?? null,
    dashboardCount,
    totalKeywords,
    keywordsByClient,
    totalTargetKeywords,
    targetKeywordsByClient,
    teamMemberCount,
    creditsUsed,
    creditsLimit,
    creditsResetsAt,
    effectiveMaxDashboards,
    effectiveKeywordCap,
  };
}

/**
 * Check if user can add one more dashboard. Returns { allowed, message }.
 */
export function canAddDashboard(ctx: AgencyTierContext): { allowed: boolean; message?: string } {
  if (ctx.trialExpired) return { allowed: false, message: TRIAL_EXPIRED_MESSAGE };
  if (!ctx.tierConfig) return { allowed: true };
  const max = ctx.effectiveMaxDashboards ?? ctx.tierConfig.maxDashboards;
  if (max === null) return { allowed: true };
  if (ctx.dashboardCount >= max) {
    return {
      allowed: false,
      message: `Your plan allows up to ${max} dashboard${max === 1 ? "" : "s"}. Upgrade or add an add-on to add more.`,
    };
  }
  return { allowed: true };
}

/**
 * Check if user can add more keywords to a client (agency: per-dashboard limit; business: total limit).
 * Uses Keyword table counts.
 */
export function canAddKeywords(
  ctx: AgencyTierContext,
  clientId: string,
  addCount: number
): { allowed: boolean; message?: string } {
  if (ctx.trialExpired) return { allowed: false, message: TRIAL_EXPIRED_MESSAGE };
  if (!ctx.tierConfig) return { allowed: true };
  const currentForClient = ctx.keywordsByClient.get(clientId) ?? 0;
  const totalAfter = ctx.totalKeywords + addCount;
  const cap = ctx.effectiveKeywordCap;
  if (cap != null && totalAfter > cap) {
    return {
      allowed: false,
      message: `Your plan allows ${cap} keywords total. You have ${ctx.totalKeywords}. Upgrade or add an add-on to add more.`,
    };
  }
  if (ctx.tierConfig.type === "business") return { allowed: true };
  const perDashboard = ctx.tierConfig.keywordsPerDashboard ?? 0;
  const forThisClient = currentForClient + addCount;
  if (forThisClient > perDashboard) {
    return {
      allowed: false,
      message: `Your plan allows ${perDashboard} keywords per dashboard. This dashboard has ${currentForClient}. Upgrade to add more.`,
    };
  }
  return { allowed: true };
}

/**
 * Check if user can add more target keywords (same limits as canAddKeywords but using target keyword counts).
 */
export function canAddTargetKeyword(ctx: AgencyTierContext, clientId: string): { allowed: boolean; message?: string } {
  if (ctx.trialExpired) return { allowed: false, message: TRIAL_EXPIRED_MESSAGE };
  if (!ctx.tierConfig) return { allowed: true };
  const currentForClient = ctx.targetKeywordsByClient.get(clientId) ?? 0;
  const cap = ctx.effectiveKeywordCap;
  if (cap != null && ctx.totalTargetKeywords + 1 > cap) {
    return {
      allowed: false,
      message: `Your plan allows ${cap} keywords total. You have ${ctx.totalTargetKeywords}. Upgrade or add an add-on to add more.`,
    };
  }
  if (ctx.tierConfig.type === "business") return { allowed: true };
  const perDashboard = ctx.tierConfig.keywordsPerDashboard ?? 0;
  if (currentForClient + 1 > perDashboard) {
    return {
      allowed: false,
      message: `Your plan allows ${perDashboard} keywords per dashboard. This dashboard has ${currentForClient}. Upgrade to add more.`,
    };
  }
  return { allowed: true };
}

/**
 * Check if user can add more team members.
 */
export function canAddTeamMember(ctx: AgencyTierContext): { allowed: boolean; message?: string } {
  if (ctx.trialExpired) return { allowed: false, message: TRIAL_EXPIRED_MESSAGE };
  if (!ctx.tierConfig) return { allowed: true };
  const max = ctx.tierConfig.maxTeamUsers;
  if (max === null) return { allowed: true };
  if (ctx.teamMemberCount >= max) {
    return {
      allowed: false,
      message: `Your plan allows up to ${max} team member${max === 1 ? "" : "s"}. Upgrade to add more.`,
    };
  }
  return { allowed: true };
}

/**
 * Check if user has keyword research credits remaining.
 */
export function hasResearchCredits(ctx: AgencyTierContext, need: number = 1): { allowed: boolean; message?: string } {
  if (ctx.trialExpired) return { allowed: false, message: TRIAL_EXPIRED_MESSAGE };
  if (!ctx.tierConfig) return { allowed: true };
  if (ctx.creditsUsed + need > ctx.creditsLimit) {
    return {
      allowed: false,
      message: `You have used ${ctx.creditsUsed} of ${ctx.creditsLimit} keyword research credits this month. Upgrade or wait until next month.`,
    };
  }
  return { allowed: true };
}

/**
 * Consume keyword research credits after a successful research call.
 * Ensures monthly reset if needed, increments used count, and sets resetAt on first use in the period.
 */
export async function useResearchCredits(agencyId: string, count: number): Promise<void> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { keywordResearchCreditsUsed: true, keywordResearchCreditsResetAt: true },
  });
  if (!agency) return;

  let used = agency.keywordResearchCreditsUsed;
  let resetAt = agency.keywordResearchCreditsResetAt;
  const n = now();

  if (!resetAt || n > resetAt) {
    const endOfMonth = new Date(n.getFullYear(), n.getMonth() + 1, 0, 23, 59, 59, 999);
    await prisma.agency.update({
      where: { id: agencyId },
      data: { keywordResearchCreditsUsed: 0, keywordResearchCreditsResetAt: endOfMonth },
    });
    used = 0;
    resetAt = endOfMonth;
  }

  await prisma.agency.update({
    where: { id: agencyId },
    data: { keywordResearchCreditsUsed: used + count },
  });
}
