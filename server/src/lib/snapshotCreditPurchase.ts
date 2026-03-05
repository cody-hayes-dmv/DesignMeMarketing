type SessionLike = {
  id: string;
  metadata?: Record<string, string | undefined> | null;
  payment_status?: string | null;
  status?: string | null;
};

export type SnapshotPackOption = "5" | "10" | "25";

export class SnapshotPurchaseValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "SnapshotPurchaseValidationError";
    this.statusCode = statusCode;
  }
}

export function normalizeSnapshotPackOption(raw: string | undefined): SnapshotPackOption {
  if (raw === "25") return "25";
  if (raw === "10") return "10";
  return "5";
}

export function getSnapshotPackPricing(option: SnapshotPackOption): { credits: number; priceCents: number } {
  if (option === "25") return { credits: 25, priceCents: 7400 };
  if (option === "10") return { credits: 10, priceCents: 3400 };
  return { credits: 5, priceCents: 1900 };
}

export function parseSnapshotCheckoutSession(
  session: SessionLike,
  expectedAgencyId?: string
): { agencyId: string; option: SnapshotPackOption; details: string } {
  const metadata = session.metadata ?? {};
  const agencyId = String(metadata.agencyId || "");

  if (metadata.addOnType !== "local_map_snapshot_credit_pack" || !agencyId) {
    throw new SnapshotPurchaseValidationError("Invalid checkout session", 400);
  }
  if (expectedAgencyId && agencyId !== expectedAgencyId) {
    throw new SnapshotPurchaseValidationError("Invalid checkout session", 400);
  }

  const isPaid = session.payment_status === "paid" || session.status === "complete";
  if (!isPaid) {
    throw new SnapshotPurchaseValidationError("Payment is not completed yet", 409);
  }

  const option = normalizeSnapshotPackOption(metadata.addOnOption);
  return {
    agencyId,
    option,
    details: `Stripe checkout session ${session.id}`,
  };
}

export async function applySnapshotCreditPackPurchase(params: {
  prismaClient: any;
  agencyId: string;
  option: SnapshotPackOption;
  details: string;
}): Promise<{ applied: boolean; credits: number; priceCents: number }> {
  const { prismaClient, agencyId, option, details } = params;
  const { credits, priceCents } = getSnapshotPackPricing(option);

  const existing = await prismaClient.agencyAddOn.findFirst({
    where: {
      agencyId,
      addOnType: "local_map_snapshot_credit_pack",
      details,
    },
    select: { id: true },
  });

  if (!existing) {
    await prismaClient.$transaction([
      prismaClient.agency.update({
        where: { id: agencyId },
        data: {
          snapshotPurchasedCredits: { increment: credits },
        },
      }),
      prismaClient.agencyAddOn.create({
        data: {
          agencyId,
          addOnType: "local_map_snapshot_credit_pack",
          addOnOption: option,
          displayName: `Local Map Snapshot Credits (${credits})`,
          details,
          priceCents,
          billingInterval: "one_time",
        },
      }),
    ]);
  }

  return {
    applied: !existing,
    credits,
    priceCents,
  };
}
