import express from "express";
import { Prisma, type GridKeyword, type GridSnapshot } from "@prisma/client";
import axios from "axios";
import { authenticateToken } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { getTierConfig, normalizeTierId } from "../lib/tiers.js";
import { calculateAtaScore, fetchDataForSeoPointSerp, runDataForSeoLocalGrid, searchGoogleBusinessProfiles, type LocalMapGridPoint } from "../lib/localMap.js";
import { generateLocalMapBundlePdfBuffer, generateLocalMapKeywordPdfBuffer } from "../lib/localMapPdf.js";
import { sendEmail } from "../lib/email.js";
import { buildReportEmailSubject, normalizeEmailRecipients } from "../lib/qualityContracts.js";
import { LOCAL_MAP_SCHEDULE_SUBJECT_PREFIX, calculateNextRunTime, isLocalMapScheduleSubject } from "../lib/reportScheduler.js";

const router = express.Router();
const localMapEnabled = String(process.env.ENABLE_LOCAL_MAP_RANKINGS ?? "true").toLowerCase() === "true";
const localMapApiCostPerRunUsd = Number(process.env.LOCAL_MAP_API_COST_PER_RUN_USD ?? "0.78");
const resolvedLocalMapApiCostPerRunUsd = Number.isFinite(localMapApiCostPerRunUsd) && localMapApiCostPerRunUsd >= 0
  ? localMapApiCostPerRunUsd
  : 0.78;
const LOCAL_MAP_COST_CONFIG_KEY = "local_map_api_cost_per_run_usd";
let platformConfigTableEnsured = false;

const GRID_RUN_DAYS = new Set([1, 15]);
const DEFAULT_GRID_SIZE = 7;
const DEFAULT_GRID_SPACING_MILES = 0.5;
const DEFAULT_MAP_ZOOM = 11;

async function ensurePlatformConfigTable(): Promise<void> {
  if (platformConfigTableEnsured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS platform_configs (
      configKey VARCHAR(191) NOT NULL PRIMARY KEY,
      configValue VARCHAR(255) NOT NULL,
      createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    )
  `);
  platformConfigTableEnsured = true;
}

async function getConfiguredLocalMapCostPerRunUsd(): Promise<number> {
  try {
    await ensurePlatformConfigTable();
    const rows = await prisma.$queryRaw<Array<{ configValue: string }>>`
      SELECT configValue
      FROM platform_configs
      WHERE configKey = ${LOCAL_MAP_COST_CONFIG_KEY}
      LIMIT 1
    `;
    const parsed = Number(rows?.[0]?.configValue ?? "");
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  } catch {
    // fall through to env/default value
  }
  return resolvedLocalMapApiCostPerRunUsd;
}

async function setConfiguredLocalMapCostPerRunUsd(value: number): Promise<number> {
  await ensurePlatformConfigTable();
  const normalized = Number(value.toFixed(4));
  await prisma.$executeRaw`
    INSERT INTO platform_configs (configKey, configValue)
    VALUES (${LOCAL_MAP_COST_CONFIG_KEY}, ${String(normalized)})
    ON DUPLICATE KEY UPDATE configValue = VALUES(configValue)
  `;
  return normalized;
}

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
    case "business_lite":
      return 1;
    case "business_pro":
      return 3;
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
    case "business_lite":
      return 2;
    case "business_pro":
      return 5;
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

  // Keep allowance aligned to the current subscription tier.
  // Do not preserve historical higher values after downgrades.
  const nextMonthlyAllowance = tierAllowance;
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

async function getSnapshotPackBreakdown(agencyId: string): Promise<{
  pack5: number;
  pack10: number;
  pack25: number;
  totalPurchases: number;
  latestPurchaseAt: Date | null;
}> {
  const packs = await prisma.agencyAddOn.findMany({
    where: {
      agencyId,
      addOnType: "local_map_snapshot_credit_pack",
      billingInterval: "one_time",
    },
    select: { addOnOption: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const breakdown = {
    pack5: 0,
    pack10: 0,
    pack25: 0,
    totalPurchases: packs.length,
    latestPurchaseAt: packs[0]?.createdAt ?? null,
  };
  for (const pack of packs) {
    if (pack.addOnOption === "25") {
      breakdown.pack25 += 1;
    } else if (pack.addOnOption === "10") {
      breakdown.pack10 += 1;
    } else {
      breakdown.pack5 += 1;
    }
  }
  return breakdown;
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

async function buildLocalMapClientBundlePdf(clientId: string): Promise<Buffer | null> {
  const keywords = await getLocalMapBundleRows(clientId);
  if (!keywords.length) return null;
  return generateLocalMapBundlePdfBuffer(
    keywords.map((row) => ({
      keyword: row,
      snapshots: row.snapshots,
    }))
  );
}

async function getLocalMapBundleRows(
  clientId: string
): Promise<Array<GridKeyword & { snapshots: GridSnapshot[] }>> {
  return prisma.gridKeyword.findMany({
    where: { clientId, status: "active" },
    include: {
      snapshots: {
        orderBy: { runDate: "desc" },
      },
    },
    orderBy: { keywordText: "asc" },
  });
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function buildLocalMapReportEmailHtml(
  clientName: string,
  rows: Array<GridKeyword & { snapshots: GridSnapshot[] }>
): string {
  const safeClientName = escapeHtml(clientName || "Client");
  const generatedDate = formatDate(new Date());
  const previewRows = rows.slice(0, 6).map((row) => {
    const current = row.snapshots[0] ?? null;
    const previous = row.snapshots[1] ?? null;
    const currentAta = current ? current.ataScore.toFixed(2) : "N/A";
    const runDate = current ? formatDate(current.runDate) : "N/A";
    const trend =
      current && previous
        ? Number((previous.ataScore - current.ataScore).toFixed(2))
        : null;
    const trendLabel =
      trend == null
        ? "No prior run"
        : trend > 0
        ? `Improved by ${trend.toFixed(2)}`
        : trend < 0
        ? `Declined by ${Math.abs(trend).toFixed(2)}`
        : "No change";
    const trendColor =
      trend == null ? "#6b7280" : trend > 0 ? "#047857" : trend < 0 ? "#b91c1c" : "#374151";
    return `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: #111827;">${escapeHtml(row.keywordText)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: #111827;">${escapeHtml(row.businessName)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: #111827;">${escapeHtml(runDate)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: #065f46; font-weight: 700;">${escapeHtml(currentAta)}</td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; color: ${trendColor};">${escapeHtml(trendLabel)}</td>
      </tr>
    `;
  });
  const hasMore = rows.length > 6;
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Local Map Rankings Report</title>
      </head>
      <body style="font-family: Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 24px; color: #111827;">
        <div style="max-width: 900px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(90deg, #4338ca, #06b6d4); padding: 24px;">
            <h1 style="margin: 0 0 8px; color: #ffffff; font-size: 28px;">Local Map Rankings Report</h1>
            <p style="margin: 0; color: #e0f2fe; font-size: 14px;">${safeClientName} • Generated ${escapeHtml(generatedDate)}</p>
          </div>
          <div style="padding: 20px;">
            <p style="margin: 0 0 14px; color: #374151;">Your Local Map report preview is below. The full report is attached as PDF.</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
              <thead>
                <tr style="background-color: #f9fafb;">
                  <th align="left" style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #374151;">Keyword</th>
                  <th align="left" style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #374151;">Business</th>
                  <th align="left" style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #374151;">Run Date</th>
                  <th align="left" style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #374151;">Current ATA</th>
                  <th align="left" style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #374151;">Trend</th>
                </tr>
              </thead>
              <tbody>
                ${previewRows.join("") || `
                <tr>
                  <td colspan="5" style="padding: 16px; color: #6b7280;">No Local Map snapshots available yet.</td>
                </tr>
                `}
              </tbody>
            </table>
            ${hasMore ? `<p style="margin: 12px 0 0; color: #6b7280; font-size: 12px;">Showing 6 of ${rows.length} keywords. See the attached PDF for full details.</p>` : ""}
            <p style="margin: 14px 0 0; color: #6b7280; font-size: 12px;">ATA = average of all 49 grid positions; lower ATA is better.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

function resolveLocalMapEmailSubject(params: {
  bodySubject?: string;
  scheduleSubject?: string;
  clientName?: string;
  frequency?: "biweekly" | "monthly";
}): string {
  const bodySubject = String(params.bodySubject || "").trim();
  const scheduleSubject = String(params.scheduleSubject || "")
    .replace(LOCAL_MAP_SCHEDULE_SUBJECT_PREFIX, "")
    .trim();
  const normalizedBody = bodySubject && !looksLikeEmail(bodySubject) ? bodySubject : "";
  const normalizedSchedule = scheduleSubject && !looksLikeEmail(scheduleSubject) ? scheduleSubject : "";
  return (
    normalizedBody
    || normalizedSchedule
    || `Local Map Rankings - ${buildReportEmailSubject(params.clientName || "Client", params.frequency || "monthly")}`
  );
}

function buildPdfEmailAttachment(filename: string, pdfBuffer: Buffer) {
  const normalized = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
  if (normalized.length < 8 || normalized.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("Generated Local Map PDF is invalid");
  }
  console.log("[LocalMap] Prepared PDF attachment", {
    filename,
    bytes: normalized.length,
    signature: normalized.subarray(0, 8).toString("ascii"),
  });
  return {
    filename,
    content: normalized.toString("base64"),
    encoding: "base64" as const,
    contentType: "application/pdf",
  };
}

function parseClientProvidedPdfAttachment(rawAttachment: unknown): { filename: string; pdf: Buffer } | null {
  if (!rawAttachment || typeof rawAttachment !== "object") return null;
  const record = rawAttachment as Record<string, unknown>;
  const contentBase64 = typeof record.contentBase64 === "string" ? record.contentBase64.trim() : "";
  if (!contentBase64) return null;
  const cleanedBase64 = contentBase64.replace(/^data:application\/pdf;base64,/i, "").replace(/\s+/g, "");
  const pdf = Buffer.from(cleanedBase64, "base64");
  if (!pdf.length || pdf.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error("Client-provided Local Map PDF is invalid");
  }
  const rawFilename = typeof record.filename === "string" ? record.filename.trim() : "";
  const filename = (rawFilename || "local-map-report.pdf").replace(/[^\w.\-]/g, "-");
  return { filename, pdf };
}

function parseClientProvidedInlineImages(
  rawInlineImages: unknown
): Array<{ filename: string; contentType: string; content: Buffer; cid: string }> {
  if (!Array.isArray(rawInlineImages)) return [];
  const parsed: Array<{ filename: string; contentType: string; content: Buffer; cid: string }> = [];
  for (const item of rawInlineImages) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const cidRaw = typeof record.cid === "string" ? record.cid.trim() : "";
    const contentBase64 = typeof record.contentBase64 === "string" ? record.contentBase64.trim() : "";
    if (!cidRaw || !contentBase64) continue;
    const cid = cidRaw.replace(/[^\w.\-@]/g, "");
    if (!cid) continue;
    const rawFilename = typeof record.filename === "string" ? record.filename.trim() : "";
    const filename = (rawFilename || `${cid}.png`).replace(/[^\w.\-]/g, "-");
    const contentTypeRaw = typeof record.contentType === "string" ? record.contentType.trim().toLowerCase() : "";
    const contentType = contentTypeRaw === "image/jpeg" || contentTypeRaw === "image/jpg" ? "image/jpeg" : "image/png";
    const cleanedBase64 = contentBase64
      .replace(/^data:image\/(?:png|jpe?g);base64,/i, "")
      .replace(/\s+/g, "");
    let content: Buffer;
    try {
      content = Buffer.from(cleanedBase64, "base64");
    } catch {
      continue;
    }
    if (!content.length) continue;
    parsed.push({ filename, contentType, content, cid });
  }
  return parsed;
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

async function notifySnapshotRunCompleted(params: {
  userId: string;
  role: string;
  keyword: string;
  businessName: string;
  ataScore: number;
  agencyId: string | null;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) return;

    const title = "Local Map snapshot completed";
    const message = `${params.keyword} for ${params.businessName} finished. ATA ${params.ataScore.toFixed(2)}.`;
    const appPath = params.role === "SUPER_ADMIN" || params.role === "ADMIN"
      ? "/superadmin/prospect-snapshot"
      : "/agency/local-map-snapshot";

    await prisma.notification.create({
      data: {
        agencyId: params.agencyId,
        userId: user.id,
        type: "local_map_snapshot_completed",
        title,
        message,
        link: appPath,
      },
    }).catch(() => undefined);

    if (!user.email) return;
    const frontendBase = String(process.env.FRONTEND_URL || "https://app.yourmarketingdashboard.ai").replace(/\/+$/, "");
    const appUrl = `${frontendBase}${appPath}`;
    const safeName = String(user.name || user.email || "there");
    await sendEmail({
      to: user.email,
      subject: `Local Map Snapshot Complete - ${params.keyword}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
          <p style="margin: 0 0 10px;">Hi ${safeName},</p>
          <p style="margin: 0 0 10px;">Your Local Map snapshot has completed successfully.</p>
          <ul style="margin: 0 0 12px 18px; padding: 0;">
            <li>Keyword: ${params.keyword}</li>
            <li>Business: ${params.businessName}</li>
            <li>ATA: ${params.ataScore.toFixed(2)}</li>
          </ul>
        </div>
      `,
    }).catch(() => undefined);
  } catch (error) {
    console.warn("[LocalMap] completion notification failed", error);
  }
}

async function notifySnapshotRunFailed(params: {
  userId: string;
  role: string;
  keyword: string;
  businessName: string;
  agencyId: string | null;
  errorMessage: string;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) return;

    const title = "Local Map snapshot failed";
    const message = `${params.keyword} for ${params.businessName} failed: ${params.errorMessage}`;
    const appPath = params.role === "SUPER_ADMIN" || params.role === "ADMIN"
      ? "/superadmin/prospect-snapshot"
      : "/agency/local-map-snapshot";

    await prisma.notification.create({
      data: {
        agencyId: params.agencyId,
        userId: user.id,
        type: "local_map_snapshot_failed",
        title,
        message,
        link: appPath,
      },
    }).catch(() => undefined);

    if (!user.email) return;
    const frontendBase = String(process.env.FRONTEND_URL || "https://app.yourmarketingdashboard.ai").replace(/\/+$/, "");
    const appUrl = `${frontendBase}${appPath}`;
    const safeName = String(user.name || user.email || "there");
    await sendEmail({
      to: user.email,
      subject: `Local Map Snapshot Failed - ${params.keyword}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
          <p style="margin: 0 0 10px;">Hi ${safeName},</p>
          <p style="margin: 0 0 10px;">Your Local Map snapshot could not be completed.</p>
          <ul style="margin: 0 0 12px 18px; padding: 0;">
            <li>Keyword: ${params.keyword}</li>
            <li>Business: ${params.businessName}</li>
            <li>Error: ${params.errorMessage}</li>
          </ul>
        </div>
      `,
    }).catch(() => undefined);
  } catch (error) {
    console.warn("[LocalMap] failure notification failed", error);
  }
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
    businessName: gridKeyword.businessName,
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

function normalizeToMidnight(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function resolveScheduledRunTimestamp(now: Date): Date | null {
  const scheduled = normalizeToMidnight(now);
  if (!GRID_RUN_DAYS.has(scheduled.getDate())) return null;
  return scheduled;
}

export async function processScheduledLocalMapRankings(now = new Date()): Promise<void> {
  const scheduledRunAt = resolveScheduledRunTimestamp(now);
  if (!scheduledRunAt) return;

  const due = await prisma.gridKeyword.findMany({
    where: {
      status: "active",
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: scheduledRunAt } }],
    },
    select: { id: true, clientId: true },
    take: 300,
  });

  const touchedClientIds = new Set<string>();
  for (const row of due) {
    try {
      await runScheduledGridKeyword(row.id, scheduledRunAt);
      touchedClientIds.add(row.clientId);
    } catch (error) {
      console.error("[LocalMap] scheduled run failed", row.id, error);
    }
  }

  await processScheduledLocalMapEmails(Array.from(touchedClientIds), scheduledRunAt);
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

      const rows = await getLocalMapBundleRows(schedule.clientId);
      if (!rows.length) continue;
      const pdf = await generateLocalMapBundlePdfBuffer(
        rows.map((row) => ({
          keyword: row,
          snapshots: row.snapshots,
        }))
      );
      const emailSubject = resolveLocalMapEmailSubject({
        scheduleSubject: schedule.emailSubject ?? undefined,
        clientName: schedule.client?.name || "Client",
        frequency: schedule.frequency as "biweekly" | "monthly",
      });
      const html = buildLocalMapReportEmailHtml(schedule.client?.name || "Client", rows);

      console.log("[LocalMap] Sending scheduled Local Map report email", {
        scheduleId: schedule.id,
        clientId: schedule.clientId,
        recipients: recipients.length,
        subject: emailSubject,
      });
      await Promise.all(
        recipients.map((to) =>
          sendEmail({
            to,
            subject: emailSubject,
            html,
            attachments: [
              buildPdfEmailAttachment(
                `local-map-rankings-${(schedule.client?.name || "client").replace(/\s+/g, "-").toLowerCase()}.pdf`,
                pdf
              ),
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

router.get("/snapshot/static-map", authenticateToken, async (req, res) => {
  try {
    if (!isManagerRole(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const centerLat = Number(req.query.centerLat);
    const centerLng = Number(req.query.centerLng);
    const zoom = Math.max(3, Math.min(18, Number(req.query.zoom ?? DEFAULT_MAP_ZOOM)));
    const size = Math.max(300, Math.min(1200, Number(req.query.size ?? 640)));
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
      return res.status(400).json({ message: "Invalid center coordinates" });
    }

    const key = String(
      process.env.GOOGLE_MAPS_API_KEY
      || process.env.GOOGLE_PLACES_API_KEY
      || process.env.GOOGLE_API_KEY
      || ""
    ).trim();

    const candidates: string[] = [];
    if (key) {
      candidates.push(
        `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(`${centerLat},${centerLng}`)}&zoom=${encodeURIComponent(String(zoom))}&size=${encodeURIComponent(`${size}x${size}`)}&scale=2&maptype=roadmap&key=${encodeURIComponent(key)}`
      );
    }
    candidates.push(
      `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(`${centerLat},${centerLng}`)}&zoom=${encodeURIComponent(String(zoom))}&size=${encodeURIComponent(`${size}x${size}`)}&scale=2&maptype=roadmap`,
      `https://staticmap.openstreetmap.de/staticmap.php?center=${encodeURIComponent(`${centerLat},${centerLng}`)}&zoom=${encodeURIComponent(String(zoom))}&size=${encodeURIComponent(`${size}x${size}`)}`
    );

    let lastError = "Unknown map fetch error";
    for (const mapUrl of candidates) {
      try {
        const upstream = await axios.get<ArrayBuffer>(mapUrl, {
          responseType: "arraybuffer",
          timeout: 20000,
          validateStatus: () => true,
        });
        const contentType = String(upstream.headers["content-type"] || "");
        if (upstream.status >= 200 && upstream.status < 300 && contentType.includes("image")) {
          const bytes = Buffer.from(upstream.data);
          res.setHeader("Content-Type", contentType || "image/png");
          res.setHeader("Cache-Control", "private, max-age=300");
          return res.status(200).send(bytes);
        }
        lastError = `Upstream ${upstream.status} ${contentType || "unknown-content-type"}`;
      } catch (e: any) {
        lastError = e?.message || "Request failed";
      }
    }

    return res.status(502).json({ message: `Failed to fetch map image: ${lastError}` });
  } catch (error: any) {
    console.error("[LocalMap] static map proxy failed", error);
    return res.status(500).json({ message: error?.message || "Failed to render static map" });
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

    const normalizedPlaceId = String(placeId);
    const existing = await prisma.gridKeyword.findFirst({
      where: {
        clientId,
        keywordId: keyword.id,
        placeId: normalizedPlaceId,
      },
    });

    if (existing) {
      if (existing.status === "active") {
        return res.json({
          ...existing,
          alreadyActive: true,
          message: "This keyword and business listing is already active.",
        });
      }

      const capacity = await getMapKeywordCapacity(agencyId);
      if (capacity.remaining <= 0) {
        return res.status(402).json({
          code: "LOCAL_MAP_KEYWORD_CAP_REACHED",
          message: "No grid keyword slots remaining. Upgrade or add Local Map Rankings keyword pack.",
        });
      }

      const reactivated = await prisma.gridKeyword.update({
        where: { id: existing.id },
        data: {
          agencyId,
          keywordText: keyword.keyword,
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

      return res.json({
        ...reactivated,
        reactivated: true,
      });
    }

    const capacity = await getMapKeywordCapacity(agencyId);
    if (capacity.remaining <= 0) {
      return res.status(402).json({
        code: "LOCAL_MAP_KEYWORD_CAP_REACHED",
        message: "No grid keyword slots remaining. Upgrade or add Local Map Rankings keyword pack.",
      });
    }

    try {
      const created = await prisma.gridKeyword.create({
        data: {
          agencyId,
          clientId,
          keywordId: keyword.id,
          keywordText: keyword.keyword,
          placeId: normalizedPlaceId,
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicate = await prisma.gridKeyword.findFirst({
          where: {
            clientId,
            keywordId: keyword.id,
            placeId: normalizedPlaceId,
          },
        });
        if (duplicate) {
          return res.json({
            ...duplicate,
            alreadyActive: duplicate.status === "active",
            message:
              duplicate.status === "active"
                ? "This keyword and business listing is already active."
                : "This keyword and business listing already exists.",
          });
        }
      }
      throw error;
    }
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
    const useLiveSource = String(req.query?.live ?? "").toLowerCase() === "1"
      || String(req.query?.live ?? "").toLowerCase() === "true";
    const useLiveOnlySource = String(req.query?.liveOnly ?? "").toLowerCase() === "1"
      || String(req.query?.liveOnly ?? "").toLowerCase() === "true"
      || String(req.query?.source ?? "").toLowerCase() === "live";
    let keyword = await prisma.gridKeyword.findUnique({
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

    // First preview bootstrap:
    // If no stored snapshot exists yet, compute a live grid once and persist it.
    // Subsequent modal opens then read from saved data instead of recomputing each time.
    if (!useLiveOnlySource && keyword.snapshots.length === 0) {
      try {
        const firstRun = await runDataForSeoLocalGrid({
          keyword: keyword.keywordText,
          placeId: keyword.placeId,
          businessName: keyword.businessName,
          centerLat: Number(keyword.centerLat),
          centerLng: Number(keyword.centerLng),
          gridSize: Number(keyword.gridSize) || DEFAULT_GRID_SIZE,
          gridSpacingMiles: Number(keyword.gridSpacingMiles) || DEFAULT_GRID_SPACING_MILES,
        });
        await prisma.gridSnapshot.create({
          data: {
            gridKeywordId: keyword.id,
            runDate: new Date(),
            gridData: JSON.stringify(firstRun.gridData),
            ataScore: firstRun.ataScore,
            isBenchmark: true,
          },
        });
        const refreshed = await prisma.gridKeyword.findUnique({
          where: { id: gridKeywordId },
          include: {
            snapshots: {
              orderBy: { runDate: "desc" },
            },
          },
        });
        if (refreshed) keyword = refreshed;
      } catch (bootstrapError: any) {
        console.warn("[LocalMap] first preview bootstrap failed", {
          gridKeywordId,
          message: bootstrapError?.message,
        });
      }
    }

    if (useLiveOnlySource) {
      const live = await runDataForSeoLocalGrid({
        keyword: keyword.keywordText,
        placeId: keyword.placeId,
        businessName: keyword.businessName,
        centerLat: Number(keyword.centerLat),
        centerLng: Number(keyword.centerLng),
        gridSize: Number(keyword.gridSize) || DEFAULT_GRID_SIZE,
        gridSpacingMiles: Number(keyword.gridSpacingMiles) || DEFAULT_GRID_SPACING_MILES,
      });
      const currentLiveSnapshot = {
        id: `live-${keyword.id}-${Date.now()}`,
        runDate: new Date(),
        ataScore: live.ataScore,
        isBenchmark: false,
        gridData: JSON.stringify(live.gridData),
      } as GridSnapshot;
      return res.json({
        keyword,
        current: currentLiveSnapshot,
        previousThree: [],
        benchmark: null,
        snapshots: [currentLiveSnapshot],
        trend: [{ runDate: currentLiveSnapshot.runDate, ataScore: currentLiveSnapshot.ataScore }],
        liveOnly: true,
      });
    }

    // Optional self-heal for stale all-NR snapshots.
    // Keep default preview reads DB-only unless explicitly requested via ?rehydrate=1.
    const allowRehydrate = String(req.query?.rehydrate ?? "").toLowerCase() === "1"
      || String(req.query?.rehydrate ?? "").toLowerCase() === "true";
    const latestSnapshot = keyword.snapshots[0] ?? null;
    const latestGrid = latestSnapshot ? parseGridDataOrFallback(latestSnapshot.gridData) : [];
    const latestHasAnyRank = latestGrid.some((point) => point.rank != null && Number(point.rank) > 0);
    if (latestSnapshot && !latestHasAnyRank && allowRehydrate) {
      try {
        const rerun = await runDataForSeoLocalGrid({
          keyword: keyword.keywordText,
          placeId: keyword.placeId,
          businessName: keyword.businessName,
          centerLat: Number(keyword.centerLat),
          centerLng: Number(keyword.centerLng),
          gridSize: Number(keyword.gridSize) || DEFAULT_GRID_SIZE,
          gridSpacingMiles: Number(keyword.gridSpacingMiles) || DEFAULT_GRID_SPACING_MILES,
        });
        await prisma.gridSnapshot.update({
          where: { id: latestSnapshot.id },
          data: {
            gridData: JSON.stringify(rerun.gridData),
            ataScore: rerun.ataScore,
          },
        });
        const refreshed = await prisma.gridKeyword.findUnique({
          where: { id: gridKeywordId },
          include: {
            snapshots: {
              orderBy: { runDate: "desc" },
            },
          },
        });
        if (refreshed) keyword = refreshed;
      } catch (rehydrateError) {
        console.warn("[LocalMap] report rehydrate skipped", {
          gridKeywordId,
          message: (rehydrateError as any)?.message,
        });
      }
    }

    let current = keyword.snapshots[0] ?? null;
    const previousThree = keyword.snapshots.slice(1, 4);
    const benchmark = keyword.snapshots.find((x) => x.isBenchmark) ?? null;
    const trend = keyword.snapshots
      .slice()
      .reverse()
      .map((item) => ({ runDate: item.runDate, ataScore: item.ataScore }));

    // Optional live mode: recompute current grid from the same data source path used by
    // Local Map Snapshot Result modal for most accurate point-level preview.
    if (useLiveSource) {
      try {
        const live = await runDataForSeoLocalGrid({
          keyword: keyword.keywordText,
          placeId: keyword.placeId,
          businessName: keyword.businessName,
          centerLat: Number(keyword.centerLat),
          centerLng: Number(keyword.centerLng),
          gridSize: Number(keyword.gridSize) || DEFAULT_GRID_SIZE,
          gridSpacingMiles: Number(keyword.gridSpacingMiles) || DEFAULT_GRID_SPACING_MILES,
        });
        current = {
          id: `live-${keyword.id}-${Date.now()}`,
          runDate: new Date(),
          ataScore: live.ataScore,
          isBenchmark: false,
          gridData: JSON.stringify(live.gridData),
        } as GridSnapshot;
      } catch (liveError: any) {
        console.warn("[LocalMap] live report source failed; falling back to stored snapshot", {
          gridKeywordId,
          message: liveError?.message,
        });
      }
    }

    return res.json({
      keyword,
      current,
      previousThree,
      benchmark,
      snapshots: keyword.snapshots,
      trend,
      liveOnly: false,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to load report" });
  }
});

router.post("/reports/:clientId/send", authenticateToken, async (req, res) => {
  try {
    if (!isManagerRole(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { clientId } = req.params;
    const canRead = await canReadClient(req.user, clientId);
    if (!canRead) return res.status(403).json({ message: "Access denied" });

    const bodyRecipients = normalizeEmailRecipients(req.body?.recipients);
    const bodySubject = typeof req.body?.emailSubject === "string" ? req.body.emailSubject.trim() : "";

    const activeSchedule = await prisma.reportSchedule.findFirst({
      where: {
        clientId,
        isActive: true,
        frequency: { in: ["biweekly", "monthly"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    const latestLocalMapSchedule = await prisma.reportSchedule.findFirst({
      where: {
        clientId,
        frequency: { in: ["biweekly", "monthly"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    const scheduleCandidate = [activeSchedule, latestLocalMapSchedule]
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .find((row) => isLocalMapScheduleSubject(row.emailSubject));

    if (!scheduleCandidate && !bodyRecipients.length) {
      return res.status(400).json({
        message: "No Local Map recipients found. Create a Local Map schedule or provide recipients.",
      });
    }

    const recipients = bodyRecipients.length
      ? bodyRecipients
      : normalizeEmailRecipients(scheduleCandidate?.recipients);
    const uniqueRecipients = [...new Set(
      recipients.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
    )];
    if (!uniqueRecipients.length) {
      return res.status(400).json({ message: "No recipients configured for this Local Map report." });
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { name: true },
    });
    const bodyEmailHtml = typeof req.body?.emailHtml === "string" ? req.body.emailHtml.trim() : "";
    const clientProvidedAttachment = parseClientProvidedPdfAttachment(req.body?.attachment);
    const inlineImages = parseClientProvidedInlineImages(req.body?.inlineImages);
    let rows: Array<GridKeyword & { snapshots: GridSnapshot[] }> = [];
    if (!bodyEmailHtml || !clientProvidedAttachment) {
      rows = await getLocalMapBundleRows(clientId);
      if (!rows.length) {
        return res.status(400).json({ message: "No active Local Map keywords found for this client." });
      }
    }
    const pdfAttachment = clientProvidedAttachment
      ? buildPdfEmailAttachment(clientProvidedAttachment.filename, clientProvidedAttachment.pdf)
      : buildPdfEmailAttachment(
          `local-map-rankings-${clientId}-${new Date().toISOString().slice(0, 10)}.pdf`,
          await generateLocalMapBundlePdfBuffer(
            rows.map((row) => ({
              keyword: row,
              snapshots: row.snapshots,
            }))
          )
        );

    const now = new Date();
    const emailSubject = resolveLocalMapEmailSubject({
      bodySubject,
      scheduleSubject: scheduleCandidate?.emailSubject ?? undefined,
      clientName: client?.name || "Client",
      frequency: (scheduleCandidate?.frequency as "biweekly" | "monthly" | undefined) || "monthly",
    });
    // Always prefer caller-provided HTML when available.
    // This keeps "Send now" content aligned with the exact preview payload.
    const html = bodyEmailHtml || buildLocalMapReportEmailHtml(client?.name || "Client", rows);

    console.log("[LocalMap] Sending on-demand Local Map report email", {
      clientId,
      recipients: uniqueRecipients.length,
      subject: emailSubject,
    });
    await Promise.all(
      uniqueRecipients.map((to) =>
        sendEmail({
          to,
          subject: emailSubject,
          html,
          attachments: [
            pdfAttachment,
            ...inlineImages.map((img) => ({
              filename: img.filename,
              content: img.content,
              contentType: img.contentType,
              cid: img.cid,
              contentDisposition: "inline" as const,
            })),
          ],
        })
      )
    );

    if (activeSchedule && isLocalMapScheduleSubject(activeSchedule.emailSubject)) {
      const nextRunAt = calculateNextRunTime(
        activeSchedule.frequency as "biweekly" | "monthly",
        activeSchedule.dayOfWeek ?? undefined,
        activeSchedule.dayOfMonth ?? undefined,
        activeSchedule.timeOfDay ?? undefined
      );

      await prisma.reportSchedule.update({
        where: { id: activeSchedule.id },
        data: { lastRunAt: now, nextRunAt },
      });
    }

    return res.json({ message: "Local Map report sent successfully", recipients: uniqueRecipients.length });
  } catch (error: any) {
    console.error("[LocalMap] send now failed", error);
    return res.status(500).json({ message: error?.message || "Failed to send Local Map report" });
  }
});

router.post("/snapshot/run", authenticateToken, async (req, res) => {
  try {
    if (!isManagerRole(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { keyword, placeId, mapsCid, businessName, businessAddress, centerLat, centerLng, clientId, superAdminMode } = req.body ?? {};
    if (!keyword || !placeId || !businessName || centerLat == null || centerLng == null) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const isSuperAdminRun = Boolean(superAdminMode) && (req.user.role === "SUPER_ADMIN" || req.user.role === "ADMIN");
    let agencyId: string | null = null;
    if (!isSuperAdminRun) {
      if (typeof clientId === "string" && clientId) {
        agencyId = await resolveAgencyIdForClient(clientId, req.user.userId);
      }
      if (!agencyId) {
        agencyId = await getAgencyIdForUser(req.user.userId);
      }
      if (!agencyId) {
        return res.status(400).json({ message: "Agency context not found" });
      }
    }

    const result = await runDataForSeoLocalGrid({
      keyword: String(keyword),
      placeId: String(placeId),
      mapsCid: mapsCid ? String(mapsCid) : undefined,
      businessName: String(businessName),
      centerLat: Number(centerLat),
      centerLng: Number(centerLng),
      gridSize: DEFAULT_GRID_SIZE,
      gridSpacingMiles: DEFAULT_GRID_SPACING_MILES,
    });

    const creditSource = isSuperAdminRun
      ? "super_admin"
      : await consumeOnDemandCredit(agencyId as string, false);

    const log = await prisma.onDemandSnapshotLog.create({
      data: {
        agencyId: isSuperAdminRun ? null : agencyId,
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

    await notifySnapshotRunCompleted({
      userId: req.user.userId,
      role: req.user.role,
      keyword: String(keyword),
      businessName: String(businessName),
      ataScore: result.ataScore,
      agencyId: isSuperAdminRun ? null : agencyId,
    });

    return res.status(201).json({
      runId: log.id,
      ataScore: result.ataScore,
      gridData: result.gridData,
      topCompetitorsCurrent: result.topCompetitorsCurrent,
      topDetectedBusinesses: result.topDetectedBusinesses,
      creditSource,
    });
  } catch (error: any) {
    const body = req.body ?? {};
    const isSuperAdminRun = Boolean(body?.superAdminMode) && (req.user?.role === "SUPER_ADMIN" || req.user?.role === "ADMIN");
    let agencyIdForNotification: string | null = null;
    const userId = req.user?.userId;
    if (!isSuperAdminRun && userId) {
      agencyIdForNotification = await getAgencyIdForUser(userId).catch(() => null);
    }
    if (userId) {
      await notifySnapshotRunFailed({
        userId,
        role: req.user?.role || "AGENCY",
        keyword: String(body?.keyword || "Unknown keyword"),
        businessName: String(body?.businessName || "Unknown business"),
        agencyId: isSuperAdminRun ? null : agencyIdForNotification,
        errorMessage: String(error?.message || "Failed to run snapshot"),
      });
    }
    console.error("[LocalMap] snapshot run failed", {
      message: error?.message,
      stack: error?.stack,
      userId: req.user?.userId,
      role: req.user?.role,
      body: req.body,
    });
    return res.status(500).json({ message: error?.message || "Failed to run snapshot" });
  }
});

router.post("/snapshot/point-serp", authenticateToken, async (req, res) => {
  try {
    if (!isManagerRole(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const { keyword, placeId, mapsCid, businessName, lat, lng } = req.body ?? {};
    if (!keyword || !placeId || !businessName || lat == null || lng == null) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const result = await fetchDataForSeoPointSerp({
      keyword: String(keyword),
      placeId: String(placeId),
      mapsCid: mapsCid ? String(mapsCid) : undefined,
      businessName: String(businessName),
      lat: Number(lat),
      lng: Number(lng),
      includePlaceDetails: true,
    });
    return res.status(200).json({
      rank: result.rank,
      competitors: result.competitors,
      serpBusinesses: result.serpBusinesses,
      debug: result.debug,
    });
  } catch (error: any) {
    console.error("[LocalMap] snapshot point-serp failed", {
      message: error?.message,
      stack: error?.stack,
      body: req.body,
      userId: req.user?.userId,
      role: req.user?.role,
    });
    return res.status(500).json({ message: error?.message || "Failed to load point SERP" });
  }
});

router.get("/snapshot/summary", authenticateToken, async (req, res) => {
  try {
    if (!isManagerRole(req.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    const agencyId = await getAgencyIdForUser(req.user.userId);
    if (!agencyId) {
      return res.json({
        monthlyRemaining: 0,
        monthlyAllowance: 0,
        purchasedCredits: 0,
        purchasedPacks: { pack5: 0, pack10: 0, pack25: 0, totalPurchases: 0, latestPurchaseAt: null },
        resetsAt: null,
      });
    }
    const counters = await ensureAgencySnapshotCounters(agencyId);
    const purchasedPacks = await getSnapshotPackBreakdown(agencyId);
    return res.json({
      monthlyAllowance: counters.monthlyAllowance,
      monthlyUsed: counters.monthlyUsed,
      monthlyRemaining: Math.max(0, counters.monthlyAllowance - counters.monthlyUsed),
      purchasedCredits: counters.purchasedCredits,
      purchasedPacks,
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
        snapshots: {
          orderBy: { runDate: "desc" },
          take: 1,
          select: { id: true, runDate: true, ataScore: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return res.json(rows);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to load grid keywords" });
  }
});

router.get("/admin/snapshots", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN" && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }
    const rows = await prisma.gridSnapshot.findMany({
      include: {
        gridKeyword: {
          select: {
            id: true,
            keywordText: true,
            businessName: true,
            client: { select: { id: true, name: true } },
            agency: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { runDate: "desc" },
      take: 300,
    });
    return res.json(rows);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to load snapshots" });
  }
});

router.delete("/admin/snapshots/:snapshotId", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN" && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }
    const { snapshotId } = req.params;
    await prisma.gridSnapshot.delete({
      where: { id: snapshotId },
    });
    return res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ message: "Snapshot not found" });
    }
    return res.status(500).json({ message: error?.message || "Failed to delete snapshot" });
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

    const costPerRunUsd = await getConfiguredLocalMapCostPerRunUsd();
    return res.json({
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
      scheduledRuns,
      ondemandRuns,
      totalRuns: scheduledRuns + ondemandRuns,
      costPerRunUsd,
      projectedApiCostUsd: Number(((scheduledRuns + ondemandRuns) * costPerRunUsd).toFixed(2)),
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to load local map overview" });
  }
});

router.put("/admin/config/cost-per-run", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN" && req.user.role !== "ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }
    const nextValue = Number(req.body?.costPerRunUsd);
    if (!Number.isFinite(nextValue) || nextValue < 0) {
      return res.status(400).json({ message: "costPerRunUsd must be a valid non-negative number" });
    }
    const saved = await setConfiguredLocalMapCostPerRunUsd(nextValue);
    return res.json({ costPerRunUsd: saved });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Failed to update cost per run" });
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
    const disposition = String(req.query?.inline ?? "").toLowerCase() === "1" ? "inline" : "attachment";
    res.setHeader("Content-Disposition", `${disposition}; filename="${sanitizedKeyword}-local-map-report.pdf"`);
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
    const disposition = String(req.query?.inline ?? "").toLowerCase() === "1" ? "inline" : "attachment";
    res.setHeader("Content-Disposition", `${disposition}; filename="${sanitizedKeyword}-snapshot.pdf"`);
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

    const pdf = await buildLocalMapClientBundlePdf(clientId);
    if (!pdf) return res.status(400).json({ message: "No active Local Map keywords found for this client." });
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
