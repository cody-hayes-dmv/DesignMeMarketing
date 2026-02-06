/**
 * Client status lifecycle automation.
 * When canceledEndDate is reached for a CANCELED client, set status to ARCHIVED.
 */
import { prisma } from "./prisma.js";

export async function archiveCanceledClientsPastEndDate(): Promise<{ archived: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const toProcess = await prisma.client.findMany({
    where: {
      status: "CANCELED",
      canceledEndDate: { lte: today },
    },
    select: { id: true },
  });

  if (toProcess.length === 0) return { archived: 0 };

  await prisma.client.updateMany({
    where: { id: { in: toProcess.map((c) => c.id) } },
    data: {
      status: "ARCHIVED",
      managedServiceStatus: "archived",
    },
  });
  console.log(`[Client Status] Archived ${toProcess.length} client(s) past canceled end date.`);
  return { archived: toProcess.length };
}
