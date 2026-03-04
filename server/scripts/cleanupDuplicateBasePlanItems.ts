/**
 * One-time script: remove duplicate base-plan subscription items from Stripe subscriptions.
 *
 * Why: some subscriptions may contain multiple base plans (e.g. Solo + Starter),
 * which can cause stacked recurring amounts and incorrect future bills.
 *
 * Usage:
 *   npm run stripe:cleanup-base-plans                 (dry run)
 *   npm run stripe:cleanup-base-plans -- --apply      (apply changes)
 *   npm run stripe:cleanup-base-plans -- --agency=<agencyId> --apply
 */

import "dotenv/config";
import Stripe from "stripe";
import { prisma } from "../src/lib/prisma.js";
import { getStripe } from "../src/lib/stripe.js";
import { getTierFromSubscriptionItems } from "../src/lib/stripeTierSync.js";

const args = process.argv.slice(2);
const applyChanges = args.includes("--apply");
const agencyArg = args.find((arg) => arg.startsWith("--agency="));
const onlyAgencyId = agencyArg ? agencyArg.split("=")[1]?.trim() : null;

type AgencyRow = {
  id: string;
  name: string | null;
  stripeSubscriptionId: string | null;
  subscriptionTier: string | null;
};

const pickKeepItem = (
  baseItems: Array<{ item: Stripe.SubscriptionItem; tierId: string }>,
  preferredTier: string | null
) => {
  if (preferredTier) {
    const preferred = baseItems.find((x) => x.tierId === preferredTier);
    if (preferred) return preferred.item;
  }
  return baseItems[0].item;
};

async function main() {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY before running this script.");
  }

  const agencies = await prisma.agency.findMany({
    where: {
      stripeSubscriptionId: { not: null },
      ...(onlyAgencyId ? { id: onlyAgencyId } : {}),
    },
    select: {
      id: true,
      name: true,
      stripeSubscriptionId: true,
      subscriptionTier: true,
    },
  }) as AgencyRow[];

  if (!agencies.length) {
    console.log("No agencies with Stripe subscriptions found.");
    return;
  }

  console.log(
    `${applyChanges ? "APPLY" : "DRY RUN"}: scanning ${agencies.length} subscription(s) for duplicate base-plan items...`
  );

  let affectedSubscriptions = 0;
  let deletedItemsTotal = 0;

  for (const agency of agencies) {
    const subscriptionId = agency.stripeSubscriptionId;
    if (!subscriptionId) continue;

    let subscription: Stripe.Subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["items.data.price"],
      });
    } catch (err: any) {
      console.warn(
        `[skip] ${agency.name ?? agency.id}: could not retrieve subscription ${subscriptionId}: ${err?.message}`
      );
      continue;
    }

    const items = subscription.items?.data ?? [];
    const baseItems = items
      .map((item) => {
        const tierId = getTierFromSubscriptionItems([item]);
        return tierId ? { item, tierId } : null;
      })
      .filter((row): row is { item: Stripe.SubscriptionItem; tierId: string } => !!row);

    if (baseItems.length <= 1) continue;

    const keepItem = pickKeepItem(baseItems, agency.subscriptionTier);
    const duplicateItems = baseItems.filter((x) => x.item.id !== keepItem.id);
    const duplicateIds = duplicateItems.map((x) => x.item.id);

    affectedSubscriptions += 1;
    deletedItemsTotal += duplicateIds.length;

    const keepTier = getTierFromSubscriptionItems([keepItem]) ?? "unknown";
    const duplicateTiers = duplicateItems.map((x) => x.tierId).join(", ");
    console.log(
      `[${applyChanges ? "fix" : "plan"}] ${agency.name ?? agency.id} | sub=${subscriptionId} | keep=${keepTier} (${keepItem.id}) | delete=${duplicateTiers} (${duplicateIds.join(", ")})`
    );

    if (!applyChanges) continue;

    await stripe.subscriptions.update(subscriptionId, {
      items: duplicateIds.map((id) => ({ id, deleted: true })),
      // Prevent retroactive credits/charges while cleaning corrupted stacked items.
      proration_behavior: "none",
      billing_cycle_anchor: "unchanged",
    });
  }

  console.log(
    `${applyChanges ? "Done" : "Preview done"}: ${affectedSubscriptions} subscription(s) with duplicates, ${deletedItemsTotal} duplicate base-plan item(s) ${applyChanges ? "removed" : "would be removed"}.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
