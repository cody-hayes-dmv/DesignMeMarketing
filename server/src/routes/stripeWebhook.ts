import express from "express";
import Stripe from "stripe";
import { getStripe } from "../lib/stripe.js";
import { prisma } from "../lib/prisma.js";
import { normalizeTierId } from "../lib/tiers.js";
import { getTierFromSubscriptionItems } from "../lib/stripeTierSync.js";

const router = express.Router();

/**
 * Stripe webhook handler. Expects raw body (mount with express.raw).
 * Syncs customer.subscription.created/updated -> agency.subscriptionTier and stripeSubscriptionId.
 * customer.subscription.deleted -> clear subscriptionTier / stripeSubscriptionId.
 */
router.post("/", async (req, res) => {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return res.status(500).json({ error: "Webhook or Stripe not configured" });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ error: "Missing signature or raw body" });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.warn("[Stripe webhook] Signature verification failed:", err?.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  const customerId =
    typeof (event.data?.object as any)?.customer === "string"
      ? (event.data.object as any).customer
      : (event.data?.object as any)?.customer?.id;

  if (!customerId) {
    return res.status(200).json({ received: true });
  }

  const agency = await prisma.agency.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true, name: true },
  });

  if (!agency) {
    return res.status(200).json({ received: true });
  }

  try {
    if (event.type === "customer.subscription.deleted") {
      await prisma.agency.update({
        where: { id: agency.id },
        data: { subscriptionTier: null, stripeSubscriptionId: null },
      });
      return res.status(200).json({ received: true });
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
      const sub = event.data.object as Stripe.Subscription;
      const subscriptionId = sub.id;
      if (sub.status === "active") {
        const items = sub.items?.data ?? [];
        const tierId = getTierFromSubscriptionItems(items);
        const normalized = tierId ? normalizeTierId(tierId) : null;
        await prisma.agency.update({
          where: { id: agency.id },
          data: {
            subscriptionTier: normalized,
            stripeSubscriptionId: subscriptionId,
          },
        });
      } else {
        await prisma.agency.update({
          where: { id: agency.id },
          data: { subscriptionTier: null, stripeSubscriptionId: null },
        });
      }
    }
  } catch (err) {
    console.error("[Stripe webhook] Update agency error:", err);
    return res.status(500).json({ error: "Processing failed" });
  }

  res.status(200).json({ received: true });
});

export default router;
