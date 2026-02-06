import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith("sk_")) return null;
  stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });
  return stripe;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY?.startsWith("sk_");
}

// Map Stripe product/price to our categories
export type MrrCategory =
  | "platform_solo"
  | "platform_starter"
  | "platform_growth"
  | "platform_pro"
  | "platform_enterprise"
  | "platform_business_lite"
  | "platform_business_pro"
  | "managed_foundation"
  | "managed_growth"
  | "managed_domination"
  | "addon_slots"
  | "addon_mappacks"
  | "addon_creditpacks"
  | "other";

const PLATFORM_TIERS = ["solo", "starter", "growth", "pro", "enterprise", "business_lite", "business_pro"];
const MANAGED_PACKAGES = ["foundation", "growth", "domination"];
export function categorizeProduct(product: Stripe.Product | string): MrrCategory | "other" {
  const name = typeof product === "string" ? product : (product.name || "").toLowerCase();
  const metadata =
    typeof product === "object" && product.metadata
      ? Object.fromEntries(
          Object.entries(product.metadata).map(([k, v]) => [k.toLowerCase(), String(v || "").toLowerCase()])
        )
      : {};

  // Check metadata first
  const tier = metadata.tier || metadata.plan || metadata.package || "";
  for (const t of PLATFORM_TIERS) {
    if (tier.includes(t)) return (`platform_${t}` as MrrCategory);
  }
  for (const p of MANAGED_PACKAGES) {
    if (tier.includes(p)) return (`managed_${p}` as MrrCategory);
  }

  // Check product name
  for (const t of PLATFORM_TIERS) {
    if (name.includes(t)) return (`platform_${t}` as MrrCategory);
  }
  for (const p of MANAGED_PACKAGES) {
    if (name.includes(p) && (name.includes("managed") || name.includes("service")))
      return (`managed_${p}` as MrrCategory);
  }
  if (name.includes("slot") || name.includes("extra slot")) return "addon_slots";
  if (name.includes("map pack") || name.includes("mappack")) return "addon_mappacks";
  if (name.includes("credit pack") || name.includes("creditpack")) return "addon_creditpacks";

  return "other";
}

export const CATEGORY_LABELS: Record<MrrCategory | "other", string> = {
  platform_solo: "Solo",
  platform_starter: "Starter",
  platform_growth: "Growth",
  platform_pro: "Pro",
  platform_enterprise: "Enterprise",
  platform_business_lite: "Business Lite",
  platform_business_pro: "Business Pro",
  managed_foundation: "Foundation (Managed)",
  managed_growth: "Growth (Managed)",
  managed_domination: "Domination (Managed)",
  addon_slots: "Extra Slots",
  addon_mappacks: "Map Packs",
  addon_creditpacks: "Credit Packs",
  other: "Other",
};
