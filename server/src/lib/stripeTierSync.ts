import Stripe from "stripe";
import { getStripe } from "./stripe.js";
import { prisma } from "./prisma.js";
import { normalizeTierId, type TierId } from "./tiers.js";

/** Map Stripe Price ID (env key) to our tier id. Order: enterprise first, then descending. */
const PLAN_PRICE_TO_TIER: { envKey: string; tierId: TierId }[] = [
  { envKey: "STRIPE_PRICE_PLAN_ENTERPRISE", tierId: "enterprise" },
  { envKey: "STRIPE_PRICE_PLAN_PRO", tierId: "pro" },
  { envKey: "STRIPE_PRICE_PLAN_GROWTH", tierId: "growth" },
  { envKey: "STRIPE_PRICE_PLAN_STARTER", tierId: "starter" },
  { envKey: "STRIPE_PRICE_PLAN_SOLO", tierId: "solo" },
  { envKey: "STRIPE_PRICE_PLAN_BUSINESS_PRO", tierId: "business_pro" },
  { envKey: "STRIPE_PRICE_PLAN_BUSINESS_LITE", tierId: "business_lite" },
];

/**
 * Resolve tier id from Stripe subscription items (matches first plan price in PLAN_PRICE_TO_TIER).
 */
export function getTierFromSubscriptionItems(items: Stripe.SubscriptionItem[]): TierId | null {
  const priceIds = new Set(
    items.map((i) => (typeof i.price === "string" ? i.price : i.price?.id)).filter(Boolean)
  );
  for (const { envKey, tierId } of PLAN_PRICE_TO_TIER) {
    const priceId = process.env[envKey];
    if (priceId && priceIds.has(priceId)) return tierId;
  }
  return null;
}

/** Return Stripe Price ID for a given tier from env (e.g. STRIPE_PRICE_PLAN_STARTER). */
export function getPriceIdForTier(tierId: TierId): string | null {
  const entry = PLAN_PRICE_TO_TIER.find((e) => e.tierId === tierId);
  if (!entry) return null;
  const priceId = process.env[entry.envKey];
  return typeof priceId === "string" && priceId.length > 0 ? priceId : null;
}

/**
 * Find the subscription item that represents the base plan (first item whose price is a STRIPE_PRICE_PLAN_*).
 * Used to change only the base plan when subscription has multiple items (add-ons, managed services).
 */
export function findBasePlanSubscriptionItem(
  items: Stripe.SubscriptionItem[]
): { itemId: string; priceId: string } | null {
  const planPriceIds = new Set(
    PLAN_PRICE_TO_TIER.map((e) => process.env[e.envKey]).filter(Boolean) as string[]
  );
  for (const item of items) {
    const priceId = typeof item.price === "string" ? item.price : item.price?.id;
    if (priceId && planPriceIds.has(priceId)) return { itemId: item.id, priceId };
  }
  return null;
}

/**
 * Fetch the agency's current subscription from Stripe and update agency.subscriptionTier
 * (and stripeSubscriptionId if we got sub from list). Call when loading subscription page
 * or after returning from billing portal so the app stays in sync even if webhooks didn't fire.
 * Returns { updated: true } if agency row was updated, { updated: false } otherwise.
 */
export async function syncAgencyTierFromStripe(agencyId: string): Promise<{ updated: boolean }> {
  const stripe = getStripe();
  if (!stripe) return { updated: false };

  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: {
      id: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionTier: true,
    },
  });
  if (!agency?.stripeCustomerId && !agency?.stripeSubscriptionId) return { updated: false };

  let sub: Stripe.Subscription | null = null;
  if (agency.stripeSubscriptionId) {
    try {
      sub = await stripe.subscriptions.retrieve(agency.stripeSubscriptionId, {
        expand: ["items.data.price"],
      });
    } catch (e) {
      // Subscription may have been deleted
      return { updated: false };
    }
  }
  if (!sub && agency.stripeCustomerId) {
    const list = await stripe.subscriptions.list({
      customer: agency.stripeCustomerId,
      status: "active",
      limit: 1,
    });
    sub = list.data[0] ?? null;
  }
  if (!sub || sub.status !== "active") {
    if (agency.subscriptionTier != null || agency.stripeSubscriptionId != null) {
      await prisma.agency.update({
        where: { id: agencyId },
        data: { subscriptionTier: null, stripeSubscriptionId: null },
      });
      return { updated: true };
    }
    return { updated: false };
  }

  const items = sub.items?.data ?? [];
  const tierId = getTierFromSubscriptionItems(items);
  const normalized = tierId ? normalizeTierId(tierId) : null;
  const currentTier = agency.subscriptionTier ? normalizeTierId(agency.subscriptionTier) : null;
  if (normalized === currentTier && sub.id === agency.stripeSubscriptionId) {
    return { updated: false };
  }

  await prisma.agency.update({
    where: { id: agencyId },
    data: {
      subscriptionTier: normalized,
      stripeSubscriptionId: sub.id,
    },
  });
  return { updated: true };
}
