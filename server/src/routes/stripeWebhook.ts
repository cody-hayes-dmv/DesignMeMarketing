import express from "express";
import Stripe from "stripe";
import { getStripe } from "../lib/stripe.js";
import { prisma } from "../lib/prisma.js";
import { normalizeTierId, getTierConfig } from "../lib/tiers.js";
import { getTierFromSubscriptionItems } from "../lib/stripeTierSync.js";
import { sendEmail } from "../lib/email.js";
import { resolveSuperAdminNotificationRecipients } from "../lib/superAdminNotifications.js";
import {
  sendAgencyPlanCancellationEmail,
  sendAgencyPlanChangeEmail,
} from "../lib/agencyPlanEmails.js";
import { renderBillingEmailTemplate } from "../lib/billingEmailTemplates.js";

const router = express.Router();

function tierLevel(tier: string | null): number {
  const cfg = getTierConfig(tier);
  return cfg?.priceMonthlyUsd ?? 0;
}

const resolveSuperAdminNotificationEmails = async (): Promise<string[]> => {
  const superAdmins = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN" },
    select: { email: true, notificationPreferences: true },
  });
  return resolveSuperAdminNotificationRecipients(superAdmins, {
    superAdminNotifyEmail: process.env.SUPER_ADMIN_NOTIFY_EMAIL,
    managedServiceNotifyEmail: process.env.MANAGED_SERVICE_NOTIFY_EMAIL,
    johnnyEmail: process.env.JOHNNY_EMAIL,
  });
};

const notifySuperAdminsByEmail = async (options: { subject: string; html: string }) => {
  const recipients = await resolveSuperAdminNotificationEmails();
  if (!recipients.length) return;
  await Promise.all(
    recipients.map((to) =>
      sendEmail({ to, subject: options.subject, html: options.html }).catch((err: any) => {
        console.warn("[Stripe webhook] Super admin email failed:", to, err?.message);
      })
    )
  );
};

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
    select: { id: true, name: true, subscriptionTier: true, billingType: true, trialEndsAt: true },
  });

  if (!agency) {
    return res.status(200).json({ received: true });
  }

  try {
    if (event.type === "invoice.payment_failed") {
      await prisma.notification.create({
        data: {
          agencyId: agency.id,
          type: "payment_failed",
          title: "Payment failed",
          message: "We couldn't charge your payment method. Please update it in Subscription & Billing to avoid service interruption.",
          link: "/agency/subscription",
        },
      }).catch((e) => console.warn("[Stripe webhook] Create payment_failed notification failed:", e?.message));
      return res.status(200).json({ received: true });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata ?? {};
      if (metadata.addOnType === "local_map_snapshot_credit_pack" && metadata.agencyId) {
        const credits = metadata.addOnOption === "25" ? 25 : metadata.addOnOption === "10" ? 10 : 5;
        const priceCents = metadata.addOnOption === "25" ? 7400 : metadata.addOnOption === "10" ? 3400 : 1900;
        const details = `Stripe checkout session ${session.id}`;

        const existing = await prisma.agencyAddOn.findFirst({
          where: {
            agencyId: metadata.agencyId,
            addOnType: "local_map_snapshot_credit_pack",
            details,
          },
          select: { id: true },
        });

        if (!existing) {
          await prisma.$transaction([
            prisma.agency.update({
              where: { id: metadata.agencyId },
              data: {
                snapshotPurchasedCredits: { increment: credits },
              },
            }),
            prisma.agencyAddOn.create({
              data: {
                agencyId: metadata.agencyId,
                addOnType: "local_map_snapshot_credit_pack",
                addOnOption: String(metadata.addOnOption || "5"),
                displayName: `Local Map Snapshot Credits (${credits})`,
                details,
                priceCents,
                billingInterval: "one_time",
              },
            }),
          ]);
        }
      }
      return res.status(200).json({ received: true });
    }

    if (event.type === "customer.subscription.deleted") {
      const oldTierName = getTierConfig(agency.subscriptionTier)?.name ?? agency.subscriptionTier ?? "Unknown";
      await prisma.agency.update({
        where: { id: agency.id },
        data: {
          subscriptionTier: "free",
          billingType: "free",
          stripeSubscriptionId: null,
          trialEndsAt: null,
        },
      });

      // Notify the agency
      await prisma.notification.create({
        data: {
          agencyId: agency.id,
          type: "subscription_canceled",
          title: "Subscription canceled",
          message: "Your subscription has been canceled. Your account will revert to the free tier.",
          link: "/agency/subscription",
        },
      }).catch((e) => console.warn("[Stripe webhook] Create cancellation notification failed:", e?.message));

      // Notify super admins
      await prisma.notification.create({
        data: {
          agencyId: null,
          type: "subscription_canceled",
          title: "Subscription canceled",
          message: `${agency.name} canceled their ${oldTierName} subscription.`,
          link: "/agency/agencies",
        },
      }).catch((e) => console.warn("[Stripe webhook] Create SA cancellation notification failed:", e?.message));

      const canceledAt = new Date();
      await sendAgencyPlanCancellationEmail({
        agencyId: agency.id,
        canceledPlanName: oldTierName,
        billingType: "free",
        statusLabel: "Canceled - Free",
      }).catch((e: any) => console.warn("[Stripe webhook] Agency cancellation email failed:", e?.message));

      await notifySuperAdminsByEmail({
        subject: `Agency subscription canceled - ${agency.name}`,
        html: renderBillingEmailTemplate({
          title: "Agency subscription canceled",
          introLines: [`${agency.name} canceled their subscription.`],
          sections: [
            {
              title: "Current account status",
              rows: [
                { label: "Agency", value: agency.name },
                { label: "Canceled Plan", value: oldTierName },
                { label: "Current Status", value: "Canceled - Free" },
                { label: "Billing Type", value: "free" },
                { label: "Canceled At", value: canceledAt.toISOString() },
              ],
            },
          ],
        }),
      }).catch((e: any) => console.warn("[Stripe webhook] SA cancellation email failed:", e?.message));

      return res.status(200).json({ received: true });
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
      const sub = event.data.object as Stripe.Subscription;
      const subscriptionId = sub.id;
      const oldTier = agency.subscriptionTier ?? null;
      if (sub.status === "active" || sub.status === "trialing") {
        const items = sub.items?.data ?? [];
        const tierId = getTierFromSubscriptionItems(items);
        const normalized = tierId ? normalizeTierId(tierId) : null;
        const trialEndsAt = typeof sub.trial_end === "number" ? new Date(sub.trial_end * 1000) : null;
        await prisma.agency.update({
          where: { id: agency.id },
          data: {
            subscriptionTier: normalized,
            billingType: "paid",
            stripeSubscriptionId: subscriptionId,
            trialEndsAt,
          },
        });
        if (event.type === "customer.subscription.updated" && oldTier !== normalized) {
          const tierName = getTierConfig(normalized)?.name ?? normalized ?? "your plan";
          const oldTierName = getTierConfig(oldTier)?.name ?? oldTier ?? "Free";
          const isUpgrade = tierLevel(normalized) > tierLevel(oldTier);
          const trialDaysLeft = trialEndsAt
            ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000))
            : null;
          const currentStatusLabel =
            trialDaysLeft != null && trialDaysLeft > 0 ? "Active - Trialing" : "Active - Paid";

          // Skip if the change-plan endpoint already created a notification in the last 60s
          const recentNotif = await prisma.notification.findFirst({
            where: {
              agencyId: agency.id,
              type: { in: ["plan_upgrade", "plan_downgrade"] },
              createdAt: { gte: new Date(Date.now() - 60_000) },
            },
          });
          if (!recentNotif) {
            // Notify the agency
            await prisma.notification.create({
              data: {
                agencyId: agency.id,
                type: isUpgrade ? "plan_upgrade" : "plan_downgrade",
                title: isUpgrade ? "Plan upgraded" : "Plan changed",
                message: isUpgrade
                  ? `Your subscription has been upgraded to ${tierName}.`
                  : `Your subscription has been changed to ${tierName}.`,
                link: "/agency/subscription",
              },
            }).catch((e) => console.warn("[Stripe webhook] Create plan change notification failed:", e?.message));

            // Notify super admins
            await prisma.notification.create({
              data: {
                agencyId: null,
                type: isUpgrade ? "plan_upgrade" : "plan_downgrade",
                title: isUpgrade ? "Agency upgraded" : "Agency downgraded",
                message: isUpgrade
                  ? `${agency.name} upgraded from ${oldTierName} to ${tierName}.`
                  : `${agency.name} downgraded from ${oldTierName} to ${tierName}.`,
                link: "/agency/agencies",
              },
            }).catch((e) => console.warn("[Stripe webhook] Create SA plan change notification failed:", e?.message));

            await sendAgencyPlanChangeEmail({
              agencyId: agency.id,
              oldTierName,
              newTierName: tierName,
              isUpgrade,
              billingType: "paid",
              statusLabel: currentStatusLabel,
              trialEndsAtIso: trialEndsAt?.toISOString() ?? null,
              trialDaysLeft,
            }).catch((e: any) => console.warn("[Stripe webhook] Agency plan-change email failed:", e?.message));

            await notifySuperAdminsByEmail({
              subject: `${isUpgrade ? "Agency plan upgraded" : "Agency plan changed"} - ${agency.name}`,
              html: renderBillingEmailTemplate({
                title: isUpgrade ? "Agency plan upgraded" : "Agency plan changed",
                introLines: [`${agency.name} has ${isUpgrade ? "upgraded" : "changed"} their plan.`],
                sections: [
                  {
                    title: "Current account status",
                    rows: [
                      { label: "Agency", value: agency.name },
                      { label: "Previous Plan", value: oldTierName },
                      { label: "Current Plan", value: tierName },
                      { label: "Current Status", value: currentStatusLabel },
                      { label: "Billing Type", value: "paid" },
                      { label: "Trial Ends", value: trialEndsAt ? trialEndsAt.toLocaleString("en-US") : "N/A" },
                      { label: "Days Until First Charge", value: trialDaysLeft != null ? String(trialDaysLeft) : "N/A" },
                      { label: "Changed At", value: new Date().toISOString() },
                    ],
                  },
                ],
              }),
            }).catch((e: any) => console.warn("[Stripe webhook] SA plan-change email failed:", e?.message));
          }
        }
      } else {
        await prisma.agency.update({
          where: { id: agency.id },
          data: {
            subscriptionTier: "free",
            billingType: "free",
            stripeSubscriptionId: null,
            trialEndsAt: null,
          },
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
