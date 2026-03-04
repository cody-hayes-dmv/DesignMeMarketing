import { prisma } from "./prisma.js";
import { sendEmail } from "./email.js";
import { BRAND_DISPLAY_NAME } from "./qualityContracts.js";
import { renderBillingEmailTemplate } from "./billingEmailTemplates.js";

const normalizeEmail = (value: string | null | undefined): string | null => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
};

async function resolveAgencyRecipient(agencyId: string, fallbackUserId?: string) {
  const [agency, fallbackUser] = await Promise.all([
    prisma.agency.findUnique({
      where: { id: agencyId },
      select: { name: true, contactEmail: true, contactName: true },
    }),
    fallbackUserId
      ? prisma.user.findUnique({
          where: { id: fallbackUserId },
          select: { email: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    agencyName: agency?.name ?? "your agency",
    recipientEmail: normalizeEmail(agency?.contactEmail) ?? normalizeEmail(fallbackUser?.email),
    recipientName: String(agency?.contactName || fallbackUser?.name || "there").trim(),
  };
}

export async function sendAgencyPlanActivationEmail(options: {
  agencyId: string;
  tierName: string;
  billingType: string;
  statusLabel: string;
  trialEndsAtIso?: string | null;
  trialDaysLeft?: number | null;
  fallbackUserId?: string;
}): Promise<void> {
  const recipient = await resolveAgencyRecipient(options.agencyId, options.fallbackUserId);
  if (!recipient.recipientEmail) {
    console.warn("Agency activation welcome email skipped: no recipient email");
    return;
  }

  const trialEndsText = options.trialEndsAtIso
    ? new Date(options.trialEndsAtIso).toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "N/A";
  const trialDaysLeftText =
    typeof options.trialDaysLeft === "number" && options.trialDaysLeft >= 0
      ? `${options.trialDaysLeft} day${options.trialDaysLeft === 1 ? "" : "s"}`
      : "N/A";

  await sendEmail({
    to: recipient.recipientEmail,
    subject: `Welcome to ${options.tierName} - ${BRAND_DISPLAY_NAME}`,
    html: renderBillingEmailTemplate({
      title: `Your ${options.tierName} plan is active`,
      introLines: [
        `Hi ${recipient.recipientName},`,
        `Great news - your ${BRAND_DISPLAY_NAME} subscription for ${recipient.agencyName} is now activated.`,
        "You can now access your upgraded limits and features from your Agency panel.",
      ],
      sections: [
        {
          title: "Current account status",
          rows: [
            { label: "Status", value: options.statusLabel },
            { label: "Plan", value: options.tierName },
            { label: "Billing Type", value: options.billingType },
            { label: "Trial Ends", value: trialEndsText },
            { label: "Days Until First Charge", value: trialDaysLeftText },
            { label: "Activated At", value: new Date().toLocaleString("en-US") },
          ],
        },
      ],
      footerLines: ["Need help? Reply to this email and our team will assist you."],
    }),
  }).catch((emailErr: any) => {
    console.warn("Agency activation welcome email failed:", emailErr?.message);
  });
}

export async function sendAgencyPlanChangeEmail(options: {
  agencyId: string;
  oldTierName: string;
  newTierName: string;
  isUpgrade: boolean;
  billingType?: string;
  statusLabel?: string;
  trialEndsAtIso?: string | null;
  trialDaysLeft?: number | null;
  fallbackUserId?: string;
}): Promise<void> {
  const recipient = await resolveAgencyRecipient(options.agencyId, options.fallbackUserId);
  if (!recipient.recipientEmail) {
    console.warn("Agency plan change email skipped: no recipient email");
    return;
  }

  const trialEndsText = options.trialEndsAtIso
    ? new Date(options.trialEndsAtIso).toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "N/A";
  const trialDaysLeftText =
    typeof options.trialDaysLeft === "number" && options.trialDaysLeft >= 0
      ? `${options.trialDaysLeft} day${options.trialDaysLeft === 1 ? "" : "s"}`
      : "N/A";

  await sendEmail({
    to: recipient.recipientEmail,
    subject: `${options.isUpgrade ? "Plan upgraded" : "Plan downgraded"} - ${BRAND_DISPLAY_NAME}`,
    html: renderBillingEmailTemplate({
      title: options.isUpgrade ? "Your plan has been upgraded" : "Your plan has been downgraded",
      introLines: [
        `Hi ${recipient.recipientName},`,
        `Your ${BRAND_DISPLAY_NAME} subscription for ${recipient.agencyName} has been updated.`,
      ],
      sections: [
        {
          title: "Plan change details",
          rows: [
            { label: "Previous Plan", value: options.oldTierName },
            { label: "Current Plan", value: options.newTierName },
            ...(options.statusLabel ? [{ label: "Current Status", value: options.statusLabel }] : []),
            ...(options.billingType ? [{ label: "Billing Type", value: options.billingType }] : []),
            { label: "Trial Ends", value: trialEndsText },
            { label: "Days Until First Charge", value: trialDaysLeftText },
            { label: "Changed At", value: new Date().toLocaleString("en-US") },
          ],
        },
      ],
      footerLines: ["You can review plan details anytime in your Subscription page."],
    }),
  }).catch((emailErr: any) => {
    console.warn("Agency plan change email failed:", emailErr?.message);
  });
}

export async function sendAgencyPlanCancellationEmail(options: {
  agencyId: string;
  canceledPlanName: string;
  billingType: string;
  statusLabel: string;
  fallbackUserId?: string;
}): Promise<void> {
  const recipient = await resolveAgencyRecipient(options.agencyId, options.fallbackUserId);
  if (!recipient.recipientEmail) {
    console.warn("Agency plan cancellation email skipped: no recipient email");
    return;
  }

  await sendEmail({
    to: recipient.recipientEmail,
    subject: `Subscription canceled - ${BRAND_DISPLAY_NAME}`,
    html: renderBillingEmailTemplate({
      title: "Your subscription has been canceled",
      introLines: [
        `Hi ${recipient.recipientName},`,
        `Your ${BRAND_DISPLAY_NAME} subscription for ${recipient.agencyName} has been canceled.`,
      ],
      sections: [
        {
          title: "Current account status",
          rows: [
            { label: "Previous Plan", value: options.canceledPlanName },
            { label: "Status", value: options.statusLabel },
            { label: "Billing Type", value: options.billingType },
            { label: "Canceled At", value: new Date().toLocaleString("en-US") },
          ],
        },
      ],
      footerLines: ["You can reactivate anytime from your Subscription page."],
    }),
  }).catch((emailErr: any) => {
    console.warn("Agency plan cancellation email failed:", emailErr?.message);
  });
}
