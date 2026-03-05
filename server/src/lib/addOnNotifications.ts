export type SnapshotCreditPackNotificationContent = {
  displayName: string;
  billingLabel: string;
  agencyNotification: {
    type: "addon_added";
    title: string;
    message: string;
    link: "/agency/add-ons";
  };
  superAdminNotification: {
    type: "addon_added";
    title: string;
    message: string;
    link: "/agency/agencies";
  };
  agencyEmail: {
    subject: string;
    html: string;
  };
  superAdminEmail: {
    subject: string;
    html: string;
  };
};

export function buildSnapshotCreditPackNotificationContent(params: {
  agencyName: string;
  credits: number;
  priceCents: number;
  brandDisplayName: string;
  agencyGreetingName?: string;
}): SnapshotCreditPackNotificationContent {
  const agencyName = String(params.agencyName || "Agency");
  const credits = Number(params.credits) || 0;
  const priceCents = Number(params.priceCents) || 0;
  const brandDisplayName = String(params.brandDisplayName || "DesignMe");
  const agencyGreetingName = String(params.agencyGreetingName || "there");
  const displayName = `Local Map Snapshot Credits (${credits})`;
  const billingLabel = "one-time";
  const priceLabel = `$${(priceCents / 100).toFixed(2)} ${billingLabel}`;

  return {
    displayName,
    billingLabel,
    agencyNotification: {
      type: "addon_added",
      title: "Add-on added",
      message: `${displayName} was added to your plan.`,
      link: "/agency/add-ons",
    },
    superAdminNotification: {
      type: "addon_added",
      title: "Agency add-on added",
      message: `${agencyName} added ${displayName}.`,
      link: "/agency/agencies",
    },
    agencyEmail: {
      subject: `Add-on added to your plan - ${brandDisplayName}`,
      html: `
        <h2>Add-on added successfully</h2>
        <p>Hi ${agencyGreetingName},</p>
        <p><strong>${displayName}</strong> has been added to your plan for <strong>${agencyName}</strong>.</p>
        <p><strong>Billing:</strong> ${priceLabel}</p>
      `,
    },
    superAdminEmail: {
      subject: `Agency add-on added - ${agencyName}`,
      html: `
        <h2>Agency add-on added</h2>
        <p><strong>Agency:</strong> ${agencyName}</p>
        <p><strong>Add-on:</strong> ${displayName}</p>
        <p><strong>Price:</strong> ${priceLabel}</p>
        <p><strong>Added:</strong> ${new Date().toISOString()}</p>
      `,
    },
  };
}
