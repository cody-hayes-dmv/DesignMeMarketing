/**
 * Client status lifecycle automation.
 * When canceledEndDate is reached for a CANCELED client, set status to ARCHIVED.
 * When scheduledArchiveAt is reached for any non-archived client, archive it.
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

export async function archiveScheduledClients(): Promise<{ archived: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const toArchive = await prisma.client.findMany({
    where: {
      scheduledArchiveAt: { lte: today },
      status: { not: "ARCHIVED" },
    },
    select: { id: true },
  });

  if (toArchive.length === 0) return { archived: 0 };

  const ids = toArchive.map((c) => c.id);

  await prisma.$transaction([
    prisma.client.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "ARCHIVED",
        managedServiceStatus: "archived",
        scheduledArchiveAt: null,
      },
    }),
    prisma.reportSchedule.updateMany({
      where: { clientId: { in: ids } },
      data: { isActive: false },
    }),
  ]);

  console.log(`[Client Status] Archived ${toArchive.length} client(s) from scheduled archive date.`);
  return { archived: toArchive.length };
}
