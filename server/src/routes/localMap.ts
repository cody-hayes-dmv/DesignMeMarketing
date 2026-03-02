import express from "express";
import { Prisma } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { getTierConfig, normalizeTierId } from "../lib/tiers.js";
import { calculateAtaScore, runDataForSeoLocalGrid, searchGoogleBusinessProfiles, type LocalMapGridPoint } from "../lib/localMap.js";
import { generateLocalMapBundlePdfBuffer, generateLocalMapKeywordPdfBuffer } from "../lib/localMapPdf.js";
import { sendEmail } from "../lib/email.js";
import { buildReportEmailSubject, normalizeEmailRecipients } from "../lib/qualityContracts.js";
import { LOCAL_MAP_SCHEDULE_SUBJECT_PREFIX, calculateNextRunTime, isLocalMapScheduleSubject } from "../lib/reportScheduler.js";

const router = express.Router();
const localMapEnabled = String(process.env.ENABLE_LOCAL_MAP_RANKINGS ?? "true").toLowerCase() === "true";

const GRID_RUN_DAYS = new Set([1, 15]);
const DEFAULT_GRID_SIZE = 7;
const DEFAULT_GRID_SPACING_MILES = 0.5;

router.use((req, res, next) => {
  if (localMapEnabled) return next();
  return res.status(503).json({ message: "Local Map Rankings feature is disabled." });
});

function isManagerRole(role: string): boolean {
  return role === "AGENCY" || role === "ADMIN" || role === "SUPER_ADMIN";
}

function normalizeKeywordPoolByTier(tier: string | null | undefined): number {
  const normalized = normalizeTierId(tier);
  switch (normalized) {
    case "solo":
      return 5;
    case "starter":
      return 15;
    case "growth":
      return 30;
    case "pro":
      return 60;
    case "enterprise":
      return 100;
    default:
      return 0;
  }
}

function normalizeMonthlySnapshotAllowance(tier: string | null | undefined): number {
  const normalized = normalizeTierId(tier);
  switch (normalized) {
    case "solo":
      return 3;
    case "starter":
      return 5;
    case "growth":
      return 10;
    case "pro":
      return 20;
    case "enterprise":
      return 100000;
    default:
      return 0;
  }
}

function ensureSnapshotCounterWindow(resetAt: Date | null): Date {
  if (resetAt && new Date() <= resetAt) return resetAt;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
}

async function getAgencyIdForUser(userId: string): Promise<string | null> {
  const membership = await prisma.userAgency.findFirst({
    where: { userId },
    select: { agencyId: true },
  });
  return membership?.agencyId ?? null;
}

async function resolveAgencyIdForClient(clientId: string, fallbackUserId?: string): Promise<string | null> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { belongsToAgencyId: true, userId: true },
  });
  if (!client) return null;

  if (client.belongsToAgencyId) return client.belongsToAgencyId;

  const ownerAgencyId = await getAgencyIdForUser(client.userId);
  if (ownerAgencyId) return ownerAgencyId;

  if (fallbackUserId) {
    const fallbackAgencyId = await getAgencyIdForUser(fallbackUserId);
    if (fallbackAgencyId) return fallbackAgencyId;
  }

  const existingGridKeyword = await prisma.gridKeyword.findFirst({
    where: { clientId },
    select: { agencyId: true },
    orderBy: { createdAt: "desc" },
  });
  return existingGridKeyword?.agencyId ?? null;
}

async function ensureAgencySnapshotCounters(agencyId: string): Promise<{
  monthlyAllowance: number;
  monthlyUsed: number;
  purchasedCredits: number;
  resetsAt: Date;
}> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: {
      id: true,
      subscriptionTier: true,
      snapshotMonthlyAllowance: true,
      snapshotMonthlyUsed: true,
      snapshotMonthlyResetAt: true,
      snapshotPurchasedCredits: true,
    },
  });
  if (!agency) {
    throw new Error("Agency not found");
  }

  const tierAllowance = normalizeMonthlySnapshotAllowance(agency.subscriptionTier);
  const resetAt = ensureSnapshotCounterWindow(agency.snapshotMonthlyResetAt);
  const shouldReset = !agency.snapshotMonthlyResetAt || new Date() > agency.snapshotMonthlyResetAt;

  const nextMonthlyAllowance = Math.max(agency.snapshotMonthlyAllowance, tierAllowance);
  const nextMonthlyUsed = shouldReset ? 0 : agency.snapshotMonthlyUsed;

  if (
    shouldReset
    || agency.snapshotMonthlyAllowance !== nextMonthlyAllowance
    || agency.snapshotMonthlyUsed !== nextMonthlyUsed
    || !agency.snapshotMonthlyResetAt
  ) {
    await prisma.agency.update({
      where: { id: agency.id },
      data: {
        snapshotMonthlyAllowance: nextMonthlyAllowance,
        snapshotMonthlyUsed: nextMonthlyUsed,
        snapshotMonthlyResetAt: resetAt,
      },
    });
  }

  return {
    monthlyAllowance: nextMonthlyAllowance,
    monthlyUsed: nextMonthlyUsed,
    purchasedCredits: agency.snapshotPurchasedCredits,
    resetsAt: resetAt,
  };
}

async function getMapKeywordCapacity(agencyId: string): Promise<{ total: number; active: number; remaining: number }> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { subscriptionTier: true, addOns: { select: { addOnType: true, addOnOption: true } } },
  });
  if (!agency) {
    return { total: 0, active: 0, remaining: 0 };
  }

  let total = normalizeKeywordPoolByTier(agency.subscriptionTier);
  for (const addOn of agency.addOns) {
    if (addOn.addOnType === "local_map_rankings_extra_keywords") {
      if (addOn.addOnOption === "5") total += 5;
      if (addOn.addOnOption === "15") total += 15;
    }
  }

  const active = await prisma.gridKeyword.count({
    where: { agencyId, status: "active" },
  });
  return {
    total,
    active,
    remaining: Math.max(0, total - active),
  };
}

function pickCreditSource(data: { monthlyAllowance: number; monthlyUsed: number; purchasedCredits: number }, isSuperAdmin: boolean) {
  if (isSuperAdmin) return "super_admin" as const;
  if (data.monthlyUsed < data.monthlyAllowance) return "monthly_allowance" as const;
  if (data.purchasedCredits > 0) return "purchased_credits" as const;
  return null;
}

async function consumeOnDemandCredit(agencyId: string, isSuperAdmin: boolean) {
  const counters = await ensureAgencySnapshotCounters(agencyId);
  const source = pickCreditSource(counters, isSuperAdmin);
  if (!source) {
    throw new Error("No snapshot credits remaining");
  }
  if (source === "super_admin") {
    return source;
  }

  if (source === "monthly_allowance") {
    await prisma.agency.update({
      where: { id: agencyId },
      data: { snapshotMonthlyUsed: counters.monthlyUsed + 1 },
    });
    return source;
  }

  await prisma.agency.update({
    where: { id: agencyId },
    data: { snapshotPurchasedCredits: Math.max(0, counters.purchasedCredits - 1) },
  });
  return source;
}

async function canReadClient(user: Express.Request["user"], clientId: string): Promise<boolean> {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return true;

  if (user.role === "USER") {
    const linked = await prisma.clientUser.findFirst({
      where: { userId: user.userId, clientId, status: "ACTIVE" },
      select: { id: true },
    });
    return Boolean(linked);
  }

  const agencyId = await getAgencyIdForUser(user.userId);
  if (!agencyId) return false;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, belongsToAgencyId: true, userId: true },
  });
  if (!client) return false;
  if (client.belongsToAgencyId === agencyId) return true;
  return client.userId === user.userId;
}

export async function runScheduledGridKeyword(gridKeywordId: string, runDate = new Date()) {
  const gridKeyword = await prisma.gridKeyword.findUnique({
    where: { id: gridKeywordId },
  });
  if (!gridKeyword || gridKeyword.status !== "active") return null;

  const result = await runDataForSeoLocalGrid({
    keyword: gridKeyword.keywordText,
    placeId: gridKeyword.placeId,
    centerLat: Number(gridKeyword.centerLat),
    centerLng: Number(gridKeyword.centerLng),
    gridSize: gridKeyword.gridSize,
    gridSpacingMiles: Number(gridKeyword.gridSpacingMiles),
  });

  const existingCount = await prisma.gridSnapshot.count({
    where: { gridKeywordId },
  });

  const snapshot = await prisma.gridSnapshot.create({
    data: {
      gridKeywordId,
      runDate,
      gridData: JSON.stringify(result.gridData),
      ataScore: result.ataScore,
      isBenchmark: existingCount === 0,
    },
  });

  await prisma.gridKeyword.update({
    where: { id: gridKeywordId },
    data: {
      lastRunAt: runDate,
      nextRunAt: computeNextRunDate(runDate),
    },
  });

  return snapshot;
}

function computeNextRunDate(from: Date): Date {
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 40; i += 1) {
    cursor.setDate(cursor.getDate() + 1);
    if (GRID_RUN_DAYS.has(cursor.getDate())) return cursor;
  }
  return cursor;
}

export async function processScheduledLocalMapRankings(now = new Date()): Promise<void> {
  const isRunDay = GRID_RUN_DAYS.has(now.getDate());
  if (!isRunDay) return;

  const due = await prisma.gridKeyword.findMany({
    where: {
      status: "active",
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    select: { id: true, clientId: true },
    take: 300,
  });

  const touchedClientIds = new Set<string>();
  for (const row of due) {
    try {
      await runScheduledGridKeyword(row.id, now);
      touchedClientIds.add(row.clientId);
    } catch (error) {
      console.error("[LocalMap] scheduled run failed", row.id, error);
    }
  }

  await processScheduledLocalMapEmails(Array.from(touchedClientIds), now);
}

async function processScheduledLocalMapEmails(clientIds: string[], now: Date): Promise<void> {
  if (!clientIds.length) return;

  const schedules = await prisma.reportSchedule.findMany({
    where: {
      isActive: true,
      clientId: { in: clientIds },
      frequency: { in: ["biweekly", "monthly"] },
      nextRunAt: { lte: now },
    },
    include: {
      client: { select: { id: true, name: true } },
    },
  });

  const localMapSchedules = schedules.filter((schedule) => isLocalMapScheduleSubject(schedule.emailSubject));
  for (const schedule of localMapSchedules) {
    try {
      if (schedule.frequency === "monthly" && now.getDate() !== 1) continue;

      const recipients = normalizeEmailRecipients(schedule.recipients);
      if (!recipients.length) continue;

      const keywords = await prisma.gridKeyword.findMany({
        where: { clientId: schedule.clientId, status: "active" },
        include: {
          snapshots: {
            orderBy: { runDate: "desc" },
          },
        },
        orderBy: { keywordText: "asc" },
      });
      if (!keywords.length) continue;

      const pdf = await generateLocalMapBundlePdfBuffer(
        keywords.map((row) => ({
          keyword: row,
          snapshots: row.snapshots,
        }))
      );

      const subjectWithoutMarker = String(schedule.emailSubject || "")
        .replace(LOCAL_MAP_SCHEDULE_SUBJECT_PREFIX, "")
        .trim();
      const emailSubject = subjectWithoutMarker
        || `Local Map Rankings - ${buildReportEmailSubject(schedule.client?.name || "Client", schedule.frequency)}`;
      const html = `
        <div style="font-family: Arial, sans-serif; color: #111827;">
          <h2 style="margin: 0 0 8px;">Local Map Rankings Report</h2>
          <p style="margin: 0 0 10px;">Your latest Local Map Rankings bundle is attached.</p>
          <p style="margin: 0; color: #6b7280; font-size: 12px;">Client: ${schedule.client?.name || "Unknown"}</p>
        </div>
      `;

      await Promise.all(
        recipients.map((to) =>
          sendEmail({
            to,
            subject: emailSubject,
            html,
            attachments: [
              {
                filename: `local-map-rankings-${(schedule.client?.name || "client").replace(/\s+/g, "-").toLowerCase()}.pdf`,
                content: pdf,
                contentType: "application/pdf",
              },
            ],
          })
        )
      );

      const nextRunAt = calculateNextRunTime(
        schedule.frequency,
        schedule.dayOfWeek ?? undefined,
        schedule.dayOfMonth ?? undefined,
        schedule.timeOfDay
      );
      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, nextRunAt },
      });
    } catch (error) {
      console.error("[LocalMap] scheduled email failed", schedule.id, error);
    }
  }
}

router.get("/gbp/search", authenticateToken, async (req, res) => {
  try {
    if (!isManagerRole(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json([]);
    const rows = await searchGoogleBusinessProfiles(q);
    return res.json(rows);
  } catch (error: any) {
    console.error("[LocalMap] GBP search failed", error);
    return res.status(500).json({ message: error?.message || "Failed to search businesses" });
  }
});

router.get("/summary/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const canRead = await canReadClient(req.user, clientId);
    if (!canRead) return res.status(403).json({ message: "Access denied" });

    const activeForDashboard = await prisma.gridKeyword.count({
      where: { clientId, status: "active" },
    });
    const agencyId = await resolveAgencyIdForClient(clientId, req.user.userId);
    if (!agencyId) {
      return res.json({
        total: 0,
        active: 0,
        remaining: 0,
        activeForDashboard,
      });
    }

    const capacity = await getMapKeywordCapacity(agencyId);

    return res.json({
      ...capacity,
      activeForDashboard,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to load local map summary" });
  }
});

router.get("/keywords/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const canRead = await canReadClient(req.user, clientId);
    if (!canRead) return res.status(403).json({ message: "Access denied" });

    const rows = await prisma.gridKeyword.findMany({
      where: { clientId },
      include: {
        snapshots: {
          orderBy: { runDate: "desc" },
          take: 2,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(
      rows.map((row) => {
        const latest = row.snapshots[0] ?? null;
        const previous = row.snapshots[1] ?? null;
        return {
          ...row,
          latestAta: latest?.ataScore ?? null,
          previousAta: previous?.ataScore ?? null,
          trend:
            latest && previous
              ? Number((previous.ataScore - latest.ataScore).toFixed(2))
              : null,
          lastRunDate: latest?.runDate ?? null,
        };
      })
    );
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to fetch grid keywords" });
  }
});

router.post("/keywords/:clientId", authenticateToken, async (req, res) => {
  try {
    if (!isManagerRole(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { clientId } = req.params;
    const canRead = await canReadClient(req.user, clientId);
    if (!canRead) return res.status(403).json({ message: "Access denied" });

    const { keywordId, placeId, businessName, businessAddress, centerLat, centerLng, locationLabel } = req.body ?? {};
    if (!keywordId || !placeId || !businessName || centerLat == null || centerLng == null) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const keyword = await prisma.keyword.findFirst({
      where: { id: String(keywordId), clientId, type: "money" },
      select: { id: true, keyword: true },
    });
    if (!keyword) {
      return res.status(404).json({ message: "Money keyword not found on this dashboard" });
    }

    const agencyId = await resolveAgencyIdForClient(clientId, req.user.userId);
    if (!agencyId) {
      return res.status(400).json({ message: "Unable to resolve agency account for this dashboard." });
    }

    const capacity = await getMapKeywordCapacity(agencyId);
    if (capacity.remaining <= 0) {
      return res.status(402).json({
        code: "LOCAL_MAP_KEYWORD_CAP_REACHED",
        message: "No grid keyword slots remaining. Upgrade or add Local Map Rankings keyword pack.",
      });
    }

    const created = await prisma.gridKeyword.create({
      data: {
        agencyId,
        clientId,
        keywordId: keyword.id,
        keywordText: keyword.keyword,
        placeId: String(placeId),
        businessName: String(businessName),
        businessAddress: businessAddress ? String(businessAddress) : null,
        centerLat: new Prisma.Decimal(Number(centerLat)),
        centerLng: new Prisma.Decimal(Number(centerLng)),
        locationLabel: locationLabel ? String(locationLabel) : null,
        gridSize: DEFAULT_GRID_SIZE,
        gridSpacingMiles: new Prisma.Decimal(DEFAULT_GRID_SPACING_MILES),
        status: "active",
        nextRunAt: computeNextRunDate(new Date()),
      },
    });

    return res.status(201).json(created);
  } catch (error: any) {
    console.error("[LocalMap] create keyword failed", error);
    return res.status(500).json({ message: error?.message || "Failed to activate grid keyword" });
  }
});

router.patch("/keywords/:gridKeywordId", authenticateToken, async (req, res) => {
  try {
    if (!isManagerRole(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { gridKeywordId } = req.params;
    const status = String(req.body?.status ?? "");
    if (!["active", "paused", "canceled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const updated = await prisma.gridKeyword.update({
      where: { id: gridKeywordId },
      data: { status: status as "active" | "paused" | "canceled" },
    });
    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to update grid keyword" });
  }
});

router.get("/report/:gridKeywordId", authenticateToken, async (req, res) => {
  try {
    const { gridKeywordId } = req.params;
    const keyword = await prisma.gridKeyword.findUnique({
      where: { id: gridKeywordId },
      include: {
        snapshots: {
          orderBy: { runDate: "desc" },
        },
      },
    });
    if (!keyword) return res.status(404).json({ message: "Grid keyword not found" });
    const canRead = await canReadClient(req.user, keyword.clientId);
    if (!canRead) return res.status(403).json({ message: "Access denied" });

    const current = keyword.snapshots[0] ?? null;
    const previousThree = keyword.snapshots.slice(1, 4);
    const benchmark = keyword.snapshots.find((x) => x.isBenchmark) ?? null;
    const trend = keyword.snapshots
      .slice()
      .reverse()
      .map((item) => ({ runDate: item.runDate, ataScore: item.ataScore }));

    return res.json({
      keyword,
      current,
      previousThree,
      benchmark,
      trend,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to load report" });
  }
});

router.post("/snapshot/run", authenticateToken, async (req, res) => {
  try {
    if (!isManagerRole(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { keyword, placeId, businessName, businessAddress, centerLat, centerLng, clientId, superAdminMode } = req.body ?? {};
    if (!keyword || !placeId || !businessName || centerLat == null || centerLng == null) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    let agencyId: string | null = null;
    if (typeof clientId === "string" && clientId) {
      agencyId = await resolveAgencyIdForClient(clientId, req.user.userId);
    }
    if (!agencyId) {
      agencyId = await getAgencyIdForUser(req.user.userId);
    }

    if (!agencyId && !(req.user.role === "SUPER_ADMIN" || req.user.role === "ADMIN")) {
      return res.status(400).json({ message: "Agency context not found" });
    }

    const result = await runDataForSeoLocalGrid({
      keyword: String(keyword),
      placeId: String(placeId),
      centerLat: Number(centerLat),
      centerLng: Number(centerLng),
      gridSize: DEFAULT_GRID_SIZE,
      gridSpacingMiles: DEFAULT_GRID_SPACING_MILES,
    });

    const isSuperAdminRun = Boolean(superAdminMode) && (req.user.role === "SUPER_ADMIN" || req.user.role === "ADMIN");
    const creditSource = agencyId
      ? await consumeOnDemandCredit(agencyId, isSuperAdminRun)
      : "super_admin";

    const log = await prisma.onDemandSnapshotLog.create({
      data: {
        agencyId,
        clientId: clientId ? String(clientId) : null,
        runByUserId: req.user.userId,
        keywordText: String(keyword),
        placeId: String(placeId),
        businessName: String(businessName),
        businessAddress: businessAddress ? String(businessAddress) : null,
        centerLat: new Prisma.Decimal(Number(centerLat)),
        centerLng: new Prisma.Decimal(Number(centerLng)),
        gridData: JSON.stringify(result.gridData),
        ataScore: result.ataScore,
        creditSource,
      },
    });

    return res.status(201).json({
      runId: log.id,
      ataScore: result.ataScore,
      gridData: result.gridData,
      topCompetitorsCurrent: result.topCompetitorsCurrent,
      creditSource,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to run snapshot" });
  }
});

router.get("/snapshot/summary", authenticateToken, async (req, res) => {
  try {
    if (!isManagerRole(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const agencyId = await getAgencyIdForUser(req.user.userId);
    if (!agencyId) return res.json({ monthlyRemaining: 0, monthlyAllowance: 0, purchasedCredits: 0, resetsAt: null });
    const counters = await ensureAgencySnapshotCounters(agencyId);
    return res.json({
      monthlyAllowance: counters.monthlyAllowance,
      monthlyUsed: counters.monthlyUsed,
      monthlyRemaining: Math.max(0, counters.monthlyAllowance - counters.monthlyUsed),
      purchasedCredits: counters.purchasedCredits,
      resetsAt: counters.resetsAt,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to load snapshot balance" });
  }
});

router.get("/admin/keywords", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN" && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }
    const rows = await prisma.gridKeyword.findMany({
      include: {
        client: { select: { name: true } },
        agency: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return res.json(rows);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to load grid keywords" });
  }
});

router.post("/admin/trigger/:gridKeywordId", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN" && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }
    const { gridKeywordId } = req.params;
    const snapshot = await runScheduledGridKeyword(gridKeywordId, new Date());
    return res.json({ ok: true, snapshot });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to trigger run" });
  }
});

router.patch("/admin/keywords/:gridKeywordId", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN" && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }
    const { gridKeywordId } = req.params;
    const status = req.body?.status as "active" | "paused" | "canceled" | undefined;
    const gridSize = req.body?.gridSize == null ? undefined : Number(req.body.gridSize);
    const gridSpacingMiles = req.body?.gridSpacingMiles == null ? undefined : Number(req.body.gridSpacingMiles);

    const updated = await prisma.gridKeyword.update({
      where: { id: gridKeywordId },
      data: {
        ...(status ? { status } : {}),
        ...(Number.isFinite(gridSize) && gridSize != null ? { gridSize } : {}),
        ...(Number.isFinite(gridSpacingMiles) && gridSpacingMiles != null
          ? { gridSpacingMiles: new Prisma.Decimal(gridSpacingMiles) }
          : {}),
      },
    });
    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to update keyword controls" });
  }
});

router.get("/admin/overview", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN" && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const scheduledRuns = await prisma.gridSnapshot.count({
      where: { runDate: { gte: monthStart, lt: monthEnd } },
    });
    const ondemandRuns = await prisma.onDemandSnapshotLog.count({
      where: { createdAt: { gte: monthStart, lt: monthEnd } },
    });

    const costPerRun = 0.78;
    return res.json({
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      scheduledRuns,
      ondemandRuns,
      totalRuns: scheduledRuns + ondemandRuns,
      projectedApiCostUsd: Number(((scheduledRuns + ondemandRuns) * costPerRun).toFixed(2)),
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to load local map overview" });
  }
});

router.get("/admin/agencies-usage", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN" && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }
    const agencies = await prisma.agency.findMany({
      select: {
        id: true,
        name: true,
        snapshotMonthlyAllowance: true,
        snapshotMonthlyUsed: true,
        snapshotPurchasedCredits: true,
      },
      orderBy: { name: "asc" },
    });
    return res.json(agencies);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to load agency usage" });
  }
});

router.post("/admin/agencies/:agencyId/snapshot-credits/issue", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only Super Admin can issue snapshot credits." });
    }
    const { agencyId } = req.params;
    const amount = Number(req.body?.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const updated = await prisma.agency.update({
      where: { id: agencyId },
      data: { snapshotPurchasedCredits: { increment: amount } },
      select: { id: true, name: true, snapshotPurchasedCredits: true },
    });

    await prisma.notification.create({
      data: {
        agencyId,
        type: "snapshot_credits_issued",
        title: `Snapshot credits issued (+${amount})`,
        message: `Super Admin issued ${amount} Local Map Snapshot credits to your account.`,
        link: "/agency/local-map-snapshot",
      },
    }).catch(() => undefined);

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to issue credits" });
  }
});

router.get("/pdf/keyword/:gridKeywordId", authenticateToken, async (req, res) => {
  try {
    const { gridKeywordId } = req.params;
    const keyword = await prisma.gridKeyword.findUnique({
      where: { id: gridKeywordId },
      include: { snapshots: { orderBy: { runDate: "desc" } } },
    });
    if (!keyword) return res.status(404).json({ message: "Grid keyword not found" });
    const canRead = await canReadClient(req.user, keyword.clientId);
    if (!canRead) return res.status(403).json({ message: "Access denied" });
    const pdf = await generateLocalMapKeywordPdfBuffer(keyword, keyword.snapshots);
    const sanitizedKeyword = keyword.keywordText.replace(/\s+/g, "-").toLowerCase();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${sanitizedKeyword}-local-map-report.pdf"`);
    return res.send(pdf);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to generate PDF" });
  }
});

router.get("/pdf/snapshot/:snapshotId", authenticateToken, async (req, res) => {
  try {
    const snapshot = await prisma.gridSnapshot.findUnique({
      where: { id: req.params.snapshotId },
      include: { gridKeyword: true },
    });
    if (!snapshot) return res.status(404).json({ message: "Snapshot not found" });
    const canRead = await canReadClient(req.user, snapshot.gridKeyword.clientId);
    if (!canRead) return res.status(403).json({ message: "Access denied" });
    const pdf = await generateLocalMapKeywordPdfBuffer(snapshot.gridKeyword, [snapshot]);
    const sanitizedKeyword = snapshot.gridKeyword.keywordText.replace(/\s+/g, "-").toLowerCase();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${sanitizedKeyword}-snapshot.pdf"`);
    return res.send(pdf);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to generate PDF" });
  }
});

router.get("/pdf/dashboard/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const canRead = await canReadClient(req.user, clientId);
    if (!canRead) return res.status(403).json({ message: "Access denied" });

    const keywords = await prisma.gridKeyword.findMany({
      where: { clientId, status: "active" },
      include: {
        snapshots: {
          orderBy: { runDate: "desc" },
        },
      },
      orderBy: { keywordText: "asc" },
    });

    const pdf = await generateLocalMapBundlePdfBuffer(
      keywords.map((row) => ({
        keyword: row,
        snapshots: row.snapshots,
      }))
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="local-map-rankings-bundle.pdf"');
    return res.send(pdf);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to generate bundled PDF" });
  }
});

export default router;

export function parseGridDataOrFallback(raw: string): LocalMapGridPoint[] {
  try {
    const parsed = JSON.parse(raw) as LocalMapGridPoint[];
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

export function calculateAtaFromRawGrid(raw: string): number {
  const grid = parseGridDataOrFallback(raw);
  return calculateAtaScore(grid);
}
