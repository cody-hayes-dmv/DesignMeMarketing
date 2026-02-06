/**
 * Tier display and UI helpers. Limits come from API (single source of truth on server).
 */

export type TierId =
  | "solo"
  | "starter"
  | "growth"
  | "pro"
  | "enterprise"
  | "business_lite"
  | "business_pro";

export const TIER_LABELS: Record<TierId, string> = {
  solo: "Solo",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  enterprise: "Enterprise",
  business_lite: "Business Lite",
  business_pro: "Business Pro",
};

export const AGENCY_TIER_IDS: TierId[] = ["solo", "starter", "growth", "pro", "enterprise"];
export const BUSINESS_TIER_IDS: TierId[] = ["business_lite", "business_pro"];

export function isBusinessTier(tierId: string | null | undefined): boolean {
  if (!tierId) return false;
  const v = tierId.trim().toLowerCase().replace(/\s+/g, "_");
  return BUSINESS_TIER_IDS.includes(v as TierId);
}

export function getTierLabel(tierId: string | null | undefined): string {
  if (!tierId) return "—";
  const v = tierId.trim().toLowerCase().replace(/\s+/g, "_") as TierId;
  return TIER_LABELS[v] ?? tierId;
}
