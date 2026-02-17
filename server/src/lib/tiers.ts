/**
 * Tiered pricing: capacity limits only. All tiers include AI Intelligence.
 * Agency tiers: white-label + client portal. Business tiers: one dashboard "Your Business", no white-label.
 */

export type TierType = "agency" | "business";

export type TierId =
  | "free"
  | "solo"
  | "starter"
  | "growth"
  | "pro"
  | "enterprise"
  | "business_lite"
  | "business_pro";

export interface TierConfig {
  id: TierId;
  name: string;
  type: TierType;
  /** Max client dashboards (agencies) or 1 for business */
  maxDashboards: number | null; // null = unlimited
  /** Keywords per dashboard (agency only). Business uses keywordsTotal. */
  keywordsPerDashboard: number | null;
  /** Total keywords across the single dashboard (business only) */
  keywordsTotal: number | null;
  keywordResearchCreditsPerMonth: number;
  rankUpdateFrequency: "weekly" | "daily" | "4x_daily" | "realtime";
  aiUpdateFrequency: "monthly" | "weekly" | "daily" | "realtime";
  maxTeamUsers: number | null; // null = unlimited
  hasWhiteLabel: boolean;
  hasClientPortal: boolean;
  /** Price in USD per month; null = custom */
  priceMonthlyUsd: number | null;
}

export const TIER_IDS: TierId[] = [
  "free",
  "solo",
  "starter",
  "growth",
  "pro",
  "enterprise",
  "business_lite",
  "business_pro",
];

export const AGENCY_TIER_IDS: TierId[] = ["free", "solo", "starter", "growth", "pro", "enterprise"];
export const BUSINESS_TIER_IDS: TierId[] = ["business_lite", "business_pro"];

export const TIERS: Record<TierId, TierConfig> = {
  free: {
    id: "free",
    name: "Free",
    type: "agency",
    maxDashboards: 0,
    keywordsPerDashboard: 0,
    keywordsTotal: null,
    keywordResearchCreditsPerMonth: 0,
    rankUpdateFrequency: "daily",
    aiUpdateFrequency: "weekly",
    maxTeamUsers: 0,
    hasWhiteLabel: true,
    hasClientPortal: true,
    priceMonthlyUsd: 0,
  },
  solo: {
    id: "solo",
    name: "Solo",
    type: "agency",
    maxDashboards: 3,
    keywordsPerDashboard: 50,
    keywordsTotal: null,
    keywordResearchCreditsPerMonth: 50,
    rankUpdateFrequency: "daily",
    aiUpdateFrequency: "weekly",
    maxTeamUsers: 1,
    hasWhiteLabel: true,
    hasClientPortal: true,
    priceMonthlyUsd: 147,
  },
  starter: {
    id: "starter",
    name: "Starter",
    type: "agency",
    maxDashboards: 10,
    keywordsPerDashboard: 50,
    keywordsTotal: null,
    keywordResearchCreditsPerMonth: 150,
    rankUpdateFrequency: "daily",
    aiUpdateFrequency: "daily",
    maxTeamUsers: 2,
    hasWhiteLabel: true,
    hasClientPortal: true,
    priceMonthlyUsd: 297,
  },
  growth: {
    id: "growth",
    name: "Growth",
    type: "agency",
    maxDashboards: 25,
    keywordsPerDashboard: 100,
    keywordsTotal: null,
    keywordResearchCreditsPerMonth: 400,
    rankUpdateFrequency: "daily",
    aiUpdateFrequency: "daily",
    maxTeamUsers: 5,
    hasWhiteLabel: true,
    hasClientPortal: true,
    priceMonthlyUsd: 597,
  },
  pro: {
    id: "pro",
    name: "Pro",
    type: "agency",
    maxDashboards: 50,
    keywordsPerDashboard: 200,
    keywordsTotal: null,
    keywordResearchCreditsPerMonth: 1000,
    rankUpdateFrequency: "4x_daily",
    aiUpdateFrequency: "realtime",
    maxTeamUsers: 15,
    hasWhiteLabel: true,
    hasClientPortal: true,
    priceMonthlyUsd: 997,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    type: "agency",
    maxDashboards: null,
    keywordsPerDashboard: 500,
    keywordsTotal: null,
    keywordResearchCreditsPerMonth: 3000,
    rankUpdateFrequency: "realtime",
    aiUpdateFrequency: "realtime",
    maxTeamUsers: null,
    hasWhiteLabel: true,
    hasClientPortal: true,
    priceMonthlyUsd: null,
  },
  business_lite: {
    id: "business_lite",
    name: "Business Lite",
    type: "business",
    maxDashboards: 1,
    keywordsPerDashboard: null,
    keywordsTotal: 15,
    keywordResearchCreditsPerMonth: 25,
    rankUpdateFrequency: "weekly",
    aiUpdateFrequency: "monthly",
    maxTeamUsers: 1,
    hasWhiteLabel: false,
    hasClientPortal: false,
    priceMonthlyUsd: 79,
  },
  business_pro: {
    id: "business_pro",
    name: "Business Pro",
    type: "business",
    maxDashboards: 1,
    keywordsPerDashboard: null,
    keywordsTotal: 250,
    keywordResearchCreditsPerMonth: 300,
    rankUpdateFrequency: "daily",
    aiUpdateFrequency: "daily",
    maxTeamUsers: 5,
    hasWhiteLabel: false,
    hasClientPortal: false,
    priceMonthlyUsd: 197,
  },
};

/** Normalized tier id from DB (e.g. lowercase, strip spaces). */
export function normalizeTierId(value: string | null | undefined): TierId | null {
  if (!value || typeof value !== "string") return null;
  const v = value.trim().toLowerCase().replace(/\s+/g, "_");
  if (TIER_IDS.includes(v as TierId)) return v as TierId;
  if (v === "business_lite" || v === "biz_lite") return "business_lite";
  if (v === "business_pro" || v === "biz_pro") return "business_pro";
  if (v === "free") return "free";
  return null;
}

export function getTierConfig(tierFromDb: string | null | undefined): TierConfig | null {
  const id = normalizeTierId(tierFromDb);
  return id ? TIERS[id] ?? null : null;
}

/** Default tier when none set (e.g. legacy accounts). */
export const DEFAULT_TIER_ID: TierId = "solo";

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;
const MS_WEEK = 7 * MS_DAY;

/** Min interval between rank refreshes (ms). 0 = no throttle (realtime). */
export function getRankRefreshIntervalMs(tier: TierConfig): number {
  switch (tier.rankUpdateFrequency) {
    case "realtime":
      return 0;
    case "4x_daily":
      return 6 * MS_HOUR;
    case "daily":
      return MS_DAY;
    case "weekly":
      return MS_WEEK;
    default:
      return MS_DAY;
  }
}

/** Min interval between AI visibility refreshes (ms). 0 = no throttle (realtime). */
export function getAiRefreshIntervalMs(tier: TierConfig): number {
  switch (tier.aiUpdateFrequency) {
    case "realtime":
      return 0;
    case "daily":
      return MS_DAY;
    case "weekly":
      return MS_WEEK;
    case "monthly":
      return 30 * MS_DAY;
    default:
      return MS_DAY;
  }
}
