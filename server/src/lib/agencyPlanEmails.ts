import { prisma } from "./prisma.js";
import { sendEmail } from "./email.js";
import { BRAND_DISPLAY_NAME } from "./qualityContracts.js";

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
  fallbackUserId?: string;
}): Promise<void> {
  const recipient = await resolveAgencyRecipient(options.agencyId, options.fallbackUserId);
  if (!recipient.recipientEmail) {
    console.warn("Agency activation welcome email skipped: no recipient email");
    return;
  }

  await sendEmail({
    to: recipient.recipientEmail,
    subject: `Welcome to ${options.tierName} - ${BRAND_DISPLAY_NAME}`,
    html: `
      <h1>Welcome to your ${options.tierName} plan!</h1>
      <p>Hi ${recipient.recipientName},</p>
      <p>Your subscription for <strong>${recipient.agencyName}</strong> is now active.</p>
      <p>You can now access your upgraded limits and features from your Agency panel.</p>
      <p><strong>Activated plan:</strong> ${options.tierName}</p>
    `,
  }).catch((emailErr: any) => {
    console.warn("Agency activation welcome email failed:", emailErr?.message);
  });
}

export async function sendAgencyPlanChangeEmail(options: {
  agencyId: string;
  oldTierName: string;
  newTierName: string;
  isUpgrade: boolean;
  fallbackUserId?: string;
}): Promise<void> {
  const recipient = await resolveAgencyRecipient(options.agencyId, options.fallbackUserId);
  if (!recipient.recipientEmail) {
    console.warn("Agency plan change email skipped: no recipient email");
    return;
  }

  await sendEmail({
    to: recipient.recipientEmail,
    subject: `${options.isUpgrade ? "Plan upgraded" : "Plan changed"} - ${BRAND_DISPLAY_NAME}`,
    html: `
      <h1>${options.isUpgrade ? "Your plan has been upgraded" : "Your plan has been updated"}</h1>
      <p>Hi ${recipient.recipientName},</p>
      <p>Your ${BRAND_DISPLAY_NAME} subscription for <strong>${recipient.agencyName}</strong> has been updated.</p>
      <p><strong>Previous plan:</strong> ${options.oldTierName}</p>
      <p><strong>Current plan:</strong> ${options.newTierName}</p>
    `,
  }).catch((emailErr: any) => {
    console.warn("Agency plan change email failed:", emailErr?.message);
  });
}
