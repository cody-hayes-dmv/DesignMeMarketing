import { prisma } from './prisma.js';
import { sendEmail } from './email.js';
import PDFDocument from 'pdfkit';
import crypto from "crypto";
import {
  BRAND_DISPLAY_NAME,
  buildReportEmailSubject,
  normalizeReportPeriod,
  normalizeReportStatus,
  normalizeEmailRecipients,
  REPORT_SECTION_TITLES,
} from "./qualityContracts.js";

export const LOCAL_MAP_SCHEDULE_SUBJECT_PREFIX = "[LOCAL_MAP] ";
export const PPC_SCHEDULE_SUBJECT_PREFIX = "[PPC] ";

export function isLocalMapScheduleSubject(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(LOCAL_MAP_SCHEDULE_SUBJECT_PREFIX);
}

export function isPpcScheduleSubject(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PPC_SCHEDULE_SUBJECT_PREFIX);
}

type ReportTargetKeywordRow = {
  id: string;
  keyword: string;
  locationName: string | null;
  createdAt: Date | string | null;
  googlePosition: number | null;
  previousPosition: number | null;
  serpItemTypes: unknown;
  googleUrl: string | null;
  type: string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeLocationName(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ");
}

function normalizeKeywordKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    } catch {
      // ignore
    }
    if (value.includes(",")) return value.split(",").map((s) => s.trim()).filter(Boolean);
    if (value.trim()) return [value.trim()];
  }
  return [];
}

function safeNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return false;
  return /^https?:\/\//i.test(s);
}

/** Returns true if the URL is a Google search/SERP page, not a ranking website. */
function isGoogleSerpUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return (host === "google.com" || host.endsWith(".google.com")) && u.pathname === "/search";
  } catch {
    return false;
  }
}

/** Use only for the "Google URL" field: returns the URL if it's a real website, null if it's a Google SERP URL. */
function onlyRankingWebsiteUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return null;
  if (isGoogleSerpUrl(url)) return null;
  return url;
}

export async function getReportTargetKeywords(clientId: string): Promise<ReportTargetKeywordRow[]> {
  // Match the dashboard behavior:
  // - only show TargetKeywords that are also tracked keywords
  // - fall back to tracked keyword rank/url if target keyword rank/url is missing
  const trackedKeywords = await prisma.keyword.findMany({
    where: { clientId },
    select: { keyword: true, currentPosition: true, previousPosition: true, googleUrl: true },
  });
  const trackedKeywordSet = new Set(trackedKeywords.map((k) => normalizeKeywordKey(k.keyword)));
  const trackedByKeyword = new Map(
    trackedKeywords.map((k) => [
      normalizeKeywordKey(k.keyword),
      {
        currentPosition: k.currentPosition ?? null,
        previousPosition: k.previousPosition ?? null,
        googleUrl: k.googleUrl ?? null,
      },
    ])
  );

  const allTargetKeywords = await prisma.targetKeyword.findMany({
    where: { clientId },
  });

  const filtered = allTargetKeywords
    .filter((tk) => trackedKeywordSet.has(normalizeKeywordKey(tk.keyword)))
    .slice(0, 50);

  const mapped = filtered.map((tk) => {
    const tracked = trackedByKeyword.get(normalizeKeywordKey(tk.keyword));
    const googlePosition = (tk as any).googlePosition ?? tracked?.currentPosition ?? null;
    return {
      id: tk.id,
      keyword: tk.keyword,
      locationName: tk.locationName ? normalizeLocationName(tk.locationName) : tk.locationName,
      createdAt: tk.createdAt,
      googlePosition,
      previousPosition: (tk as any).previousPosition ?? tracked?.previousPosition ?? null,
      serpItemTypes: (tk as any).serpItemTypes,
      googleUrl: onlyRankingWebsiteUrl((tk as any).googleUrl ?? tracked?.googleUrl) ?? null,
      type: (tk as any).type || "money",
    };
  });

  // Sort by highest rank (lowest position number) first, nulls at the end
  return mapped.sort((a, b) => {
    const aPos = a.googlePosition ?? Infinity;
    const bPos = b.googlePosition ?? Infinity;
    return aPos - bPos;
  });
}

export async function buildShareDashboardUrl(clientId: string): Promise<string | null> {
  const frontendUrlRaw = process.env.FRONTEND_URL || "";
  const frontendUrl = frontendUrlRaw.replace(/\/+$/, "");
  if (!frontendUrl) return null;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { dashboardShareToken: true },
  });
  if (!client) return null;

  let token = client.dashboardShareToken;
  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    await prisma.client.update({
      where: { id: clientId },
      data: { dashboardShareToken: token },
    });
  }

  return `${frontendUrl}/share/${encodeURIComponent(token)}`;
}

/**
 * Calculate next run time for a schedule
 */
export function calculateNextRunTime(
  frequency: string,
  dayOfWeek?: number,
  dayOfMonth?: number,
  timeOfDay: string = "09:00"
): Date {
  const [hours, minutes] = timeOfDay.split(":").map(Number);
  const now = new Date();
  const nextRun = new Date();

  nextRun.setHours(hours, minutes, 0, 0);

  if (frequency === "weekly" && dayOfWeek !== undefined) {
    const daysUntilNext = (dayOfWeek - now.getDay() + 7) % 7;
    if (daysUntilNext === 0 && nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 7);
    } else {
      nextRun.setDate(nextRun.getDate() + daysUntilNext);
    }
  } else if (frequency === "biweekly" && dayOfWeek !== undefined) {
    const daysUntilNext = (dayOfWeek - now.getDay() + 14) % 14;
    if (daysUntilNext === 0 && nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 14);
    } else {
      nextRun.setDate(nextRun.getDate() + daysUntilNext);
    }
  } else if (frequency === "monthly" && dayOfMonth !== undefined) {
    nextRun.setDate(dayOfMonth);
    if (nextRun <= now) {
      nextRun.setMonth(nextRun.getMonth() + 1);
    }
  } else {
    // Default: next week same day
    nextRun.setDate(nextRun.getDate() + 7);
  }

  return nextRun;
}

function buildKeywordTableHtml(keywords: ReportTargetKeywordRow[]): string {
  return `
    <div style="overflow-x: auto;">
      <table style="border-collapse: collapse; width: 100%; font-size: 12px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background: linear-gradient(to right, #f9fafb, #f3f4f6); border-bottom: 2px solid #d1d5db;">
            <th style="padding: 12px; text-align: left; font-weight: 700; color: #374151; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Keyword</th>
            <th style="padding: 12px; text-align: left; font-weight: 700; color: #374151; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Location</th>
            <th style="padding: 12px; text-align: left; font-weight: 700; color: #374151; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Date Added</th>
            <th style="padding: 12px; text-align: left; font-weight: 700; color: #374151; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Position</th>
            <th style="padding: 12px; text-align: left; font-weight: 700; color: #374151; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">Change</th>
            <th style="padding: 12px; text-align: left; font-weight: 700; color: #374151; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">SERP Features</th>
            <th style="padding: 12px; text-align: left; font-weight: 700; color: #374151; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;">URL</th>
          </tr>
        </thead>
        <tbody>
          ${keywords
            .map((k) => {
              const current = typeof k.googlePosition === "number" ? k.googlePosition : null;
              const prev = typeof k.previousPosition === "number" ? k.previousPosition : null;
              const diff = current != null && prev != null ? prev - current : null;
              const diffText = diff == null ? "—" : diff === 0 ? "0" : diff > 0 ? `+${diff}` : `${diff}`;
              const dateAdded = k.createdAt ? new Date(k.createdAt as any).toLocaleDateString() : "—";
              const serp = toStringArray(k.serpItemTypes).slice(0, 3).join(", ") || "—";
              const displayUrl = onlyRankingWebsiteUrl(k.googleUrl);
              const urlCell = displayUrl
                ? `<a href="${escapeHtml(displayUrl)}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline;">${escapeHtml(displayUrl.length > 50 ? displayUrl.substring(0, 50) + "..." : displayUrl)}</a>`
                : "—";
              const isTop3 = current !== null && current <= 3;
              const isRanked = current !== null && current <= 10;
              const positionBadgeColor = isTop3 ? "#dcfce7" : isRanked ? "#dbeafe" : "#f3f4f6";
              const positionTextColor = isTop3 ? "#166534" : isRanked ? "#1e40af" : "#374151";
              const diffColor = diff !== null ? (diff > 0 ? "#059669" : diff < 0 ? "#dc2626" : "#6b7280") : "#6b7280";
              const diffSymbol = diff !== null ? (diff > 0 ? "↑" : diff < 0 ? "↓" : "") : "";
              
              return `
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 12px; font-weight: 600; color: #111827;">${isTop3 ? "🏆 " : ""}${escapeHtml(k.keyword)}</td>
                  <td style="padding: 12px; color: #4b5563;">${escapeHtml(k.locationName || "United States")}</td>
                  <td style="padding: 12px; color: #6b7280;">${escapeHtml(dateAdded)}</td>
                  <td style="padding: 12px;">
                    ${current !== null ? `
                      <span style="display: inline-block; background-color: ${positionBadgeColor}; color: ${positionTextColor}; padding: 4px 8px; border-radius: 12px; font-weight: 600; font-size: 11px;">
                        ${current}
                      </span>
                    ` : '<span style="color: #9ca3af;">—</span>'}
                  </td>
                  <td style="padding: 12px;">
                    ${diff !== null ? `
                      <span style="color: ${diffColor}; font-weight: 600;">
                        ${diffSymbol} ${diffText}
                      </span>
                    ` : '<span style="color: #9ca3af;">—</span>'}
                  </td>
                  <td style="padding: 12px; color: #4b5563;">
                    ${serp !== "—" ? serp.split(", ").map((feature: string) => 
                      `<span style="display: inline-block; background-color: #f3f4f6; color: #374151; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-right: 4px; margin-bottom: 4px;">${escapeHtml(feature)}</span>`
                    ).join("") : '<span style="color: #9ca3af;">—</span>'}
                  </td>
                  <td style="padding: 12px; word-break: break-all; max-width: 200px; color: #4b5563;">${urlCell}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Generate email HTML for a report
 */
export function generateReportEmailHTML(
  report: any,
  client: any,
  opts?: { targetKeywords?: ReportTargetKeywordRow[]; shareUrl?: string | null }
): string {
  const normalizedPeriod = normalizeReportPeriod(report.period);
  const periodLabel = normalizedPeriod.charAt(0).toUpperCase() + normalizedPeriod.slice(1);
  const reportDate = new Date(report.reportDate).toLocaleDateString();
  const safeClientName = escapeHtml(client?.name);
  const safeDomain = client?.domain ? escapeHtml(client.domain) : "";
  const shareUrl = opts?.shareUrl || null;
  const allKeywords = (opts?.targetKeywords || []).sort((a, b) => {
    const aPos = a.googlePosition ?? Infinity;
    const bPos = b.googlePosition ?? Infinity;
    return aPos - bPos;
  });
  const moneyKeywords = allKeywords.filter((k) => k.type !== "topical");
  const topicalKeywords = allKeywords.filter((k) => k.type === "topical");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${BRAND_DISPLAY_NAME} Report - ${safeClientName}</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #111827; background-color: #f3f4f6; margin: 0; padding: 24px;">
      <div style="max-width: 900px; margin: 0 auto; background-color: #ffffff;">
        
        <!-- Report Header Card -->
        <div style="background-color: #2563eb; border-radius: 12px 12px 0 0; padding: 32px; color: #ffffff; text-align: center;">
          <h1 style="margin: 0 0 12px 0; font-size: 28px; font-weight: 700; color: #ffffff;">SEO Analytics Report</h1>
          <p style="margin: 0; font-size: 16px; color: #bfdbfe;">${escapeHtml(periodLabel)} report for ${safeClientName}</p>
          
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 24px;">
            <tr>
              <td align="center" style="padding: 0 6px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: rgba(255, 255, 255, 0.15); border-radius: 8px;">
                  <tr>
                    <td style="padding: 12px; text-align: center;">
                      <div style="font-size: 11px; color: #bfdbfe; margin-bottom: 4px; font-weight: 500;">Client</div>
                      <div style="font-size: 14px; font-weight: 600; color: #ffffff;">${safeClientName}</div>
                    </td>
                  </tr>
                </table>
              </td>
              ${safeDomain ? `
              <td align="center" style="padding: 0 6px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: rgba(255, 255, 255, 0.15); border-radius: 8px;">
                  <tr>
                    <td style="padding: 12px; text-align: center;">
                      <div style="font-size: 11px; color: #bfdbfe; margin-bottom: 4px; font-weight: 500;">Domain</div>
                      <div style="font-size: 14px; font-weight: 600; color: #ffffff;">${safeDomain}</div>
                    </td>
                  </tr>
                </table>
              </td>
              ` : ""}
              <td align="center" style="padding: 0 6px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: rgba(255, 255, 255, 0.15); border-radius: 8px;">
                  <tr>
                    <td style="padding: 12px; text-align: center;">
                      <div style="font-size: 11px; color: #bfdbfe; margin-bottom: 4px; font-weight: 500;">Report Date</div>
                      <div style="font-size: 14px; font-weight: 600; color: #ffffff;">${escapeHtml(reportDate)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>

        <div style="padding: 24px;">
          <!-- Traffic Overview Card -->
          <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
            <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #111827;">
              <span style="display: inline-block; width: 4px; height: 20px; background-color: #3b82f6; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>
              ${REPORT_SECTION_TITLES.traffic_overview}
            </h2>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
              <tr>
                <td width="25%" align="center" valign="top" style="padding: 8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px;">
                    <tr>
                      <td style="padding: 16px; text-align: center;">
                        <div style="font-size: 11px; font-weight: 600; color: #1e40af; margin-bottom: 4px;">Web Visitors</div>
                        <div style="font-size: 24px; font-weight: 700; color: #1e3a8a;">${Number((report as any).totalUsers ?? report.activeUsers ?? 0).toLocaleString()}</div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="25%" align="center" valign="top" style="padding: 8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
                    <tr>
                      <td style="padding: 16px; text-align: center;">
                        <div style="font-size: 11px; font-weight: 600; color: #166534; margin-bottom: 4px;">Organic Traffic</div>
                        <div style="font-size: 24px; font-weight: 700; color: #14532d;">${Number((report as any).organicSearchEngagedSessions ?? 0).toLocaleString()}</div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="25%" align="center" valign="top" style="padding: 8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px;">
                    <tr>
                      <td style="padding: 16px; text-align: center;">
                        <div style="font-size: 11px; font-weight: 600; color: #6b21a8; margin-bottom: 4px;">First Time Visitors</div>
                        <div style="font-size: 24px; font-weight: 700; color: #581c87;">${Number(report.newUsers ?? 0).toLocaleString()}</div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="25%" align="center" valign="top" style="padding: 8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px;">
                    <tr>
                      <td style="padding: 16px; text-align: center;">
                        <div style="font-size: 11px; font-weight: 600; color: #9a3412; margin-bottom: 4px;">Engaged Visitors</div>
                        <div style="font-size: 24px; font-weight: 700; color: #7c2d12;">${Number((report as any).engagedVisitors ?? (report as any).engagedSessions ?? 0).toLocaleString()}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </div>

          <!-- Money Keywords Card -->
          <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
            <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #111827;">
              <span style="display: inline-block; width: 4px; height: 20px; background-color: #2563eb; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>
              ${REPORT_SECTION_TITLES.money_keywords}
            </h2>
            <p style="margin: 0 0 16px 0; font-size: 12px; color: #6b7280;">High-intent keywords that drive qualified opportunities.</p>
            ${
              moneyKeywords.length === 0
                ? `<div style="padding: 32px; text-align: center; color: #6b7280; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                    <p style="margin: 0;">No money keywords tracked yet.</p>
                  </div>`
                : buildKeywordTableHtml(moneyKeywords)
            }
          </div>

          <!-- Topical Keywords Card -->
          <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
            <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #111827;">
              <span style="display: inline-block; width: 4px; height: 20px; background-color: #8b5cf6; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>
              ${REPORT_SECTION_TITLES.topical_keywords}
            </h2>
            <p style="margin: 0 0 16px 0; font-size: 12px; color: #6b7280;">Supportive topic coverage and informational discovery terms.</p>
            ${
              topicalKeywords.length === 0
                ? `<div style="padding: 32px; text-align: center; color: #6b7280; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                    <p style="margin: 0;">No topical keywords tracked yet.</p>
                  </div>`
                : buildKeywordTableHtml(topicalKeywords)
            }
          </div>

          <!-- Live Dashboard Card -->
          <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
            <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #111827;">
              <span style="display: inline-block; width: 4px; height: 20px; background-color: #a855f7; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>
              ${REPORT_SECTION_TITLES.live_dashboard}
            </h2>
            <p style="margin: 0 0 12px 0; font-size: 12px; color: #6b7280;">Share this live report URL to provide read-only visibility.</p>
            ${
              shareUrl
                ? `<div style="background-color: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 16px;">
                    <a href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener noreferrer" style="color: #7c3aed; font-weight: 600; text-decoration: underline; word-break: break-all;">
                      ${escapeHtml(shareUrl)}
                    </a>
                  </div>`
                : `<div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; color: #6b7280;">
                    Share link unavailable.
                  </div>`
            }
          </div>
        </div>

        <div style="background-color: #f9fafb; border-top: 1px solid #e5e7eb; padding: 16px; text-align: center;">
          <p style="margin: 0; color: #6b7280; font-size: 12px;">
            This is an automated report generated by ${BRAND_DISPLAY_NAME}.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate a PDF buffer for a report
 * (keeps it simple: text-only summary matching the email content)
 */
export async function generateReportPDFBuffer(
  report: any,
  client: any,
  opts?: { targetKeywords?: ReportTargetKeywordRow[]; shareUrl?: string | null }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];

    // doc.on('data', (chunk) => chunks.push(chunk));
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    // doc.on('error', (err) => reject(err));
    doc.on("error", (err: Error) => reject(err));

    const normalizedPeriod = normalizeReportPeriod(report.period);
    const periodLabel = normalizedPeriod.charAt(0).toUpperCase() + normalizedPeriod.slice(1);
    const reportDate = new Date(report.reportDate).toLocaleDateString();
    const shareUrl = opts?.shareUrl || null;
    const targetKeywords = opts?.targetKeywords || [];
    const defaultMargin = 40;
    const brandColor = "#4f46e5";
    const generatedAt = new Date().toLocaleString();
    const footerReserved = 42;

    const ensurePageSpace = (requiredHeight = 28) => {
      const pageHeight = safeNumber((doc as any)?.page?.height, 842);
      if (doc.y + requiredHeight > pageHeight - footerReserved) {
        doc.addPage();
      }
    };

    const drawSectionHeader = (title: string) => {
      ensurePageSpace(36);
      const pageLeft = safeNumber((doc as any)?.page?.margins?.left, defaultMargin);
      const pageRight =
        safeNumber((doc as any)?.page?.width, 595) - safeNumber((doc as any)?.page?.margins?.right, defaultMargin);
      const sectionWidth = Math.max(1, pageRight - pageLeft);
      const y = doc.y;
      doc.save();
      doc.roundedRect(pageLeft, y, sectionWidth, 24, 4).fill("#f8fafc");
      doc.rect(pageLeft, y, 4, 24).fill(brandColor);
      doc.restore();
      doc
        .fontSize(7.5)
        .fillColor("#64748b")
        .text("SECTION", pageLeft + 10, y + 4.5, { width: sectionWidth - 14, align: "left" });
      doc
        .fontSize(10.5)
        .fillColor("#0f172a")
        .text(title, pageLeft + 10, y + 11, { width: sectionWidth - 14, align: "left" });
      doc.moveDown(1.8);
      doc.fillColor("#000000");
    };

    const drawMetricRow = (label: string, value: string | number) => {
      ensurePageSpace(20);
      const pageLeft = safeNumber((doc as any)?.page?.margins?.left, defaultMargin);
      const pageRight =
        safeNumber((doc as any)?.page?.width, 595) - safeNumber((doc as any)?.page?.margins?.right, defaultMargin);
      const rowWidth = Math.max(1, pageRight - pageLeft);
      const y = doc.y;
      doc
        .fontSize(11)
        .fillColor("#475569")
        .text(String(label), pageLeft, y, { width: rowWidth * 0.58, align: "left" });
      doc
        .fontSize(11)
        .fillColor("#0f172a")
        .text(String(value), pageLeft, y, { width: rowWidth, align: "right" });
      doc
        .strokeColor("#e2e8f0")
        .lineWidth(1)
        .moveTo(pageLeft, y + 15)
        .lineTo(pageRight, y + 15)
        .stroke();
      doc.moveDown(0.7);
      doc.fillColor("#000000");
    };

    const drawSectionDescription = (text: string) => {
      ensurePageSpace(20);
      const pageLeft = safeNumber((doc as any)?.page?.margins?.left, defaultMargin);
      const pageRight =
        safeNumber((doc as any)?.page?.width, 595) - safeNumber((doc as any)?.page?.margins?.right, defaultMargin);
      const rowWidth = Math.max(1, pageRight - pageLeft);
      doc.fontSize(9.5).fillColor("#64748b").text(text, pageLeft, doc.y, { width: rowWidth, align: "left" });
      doc.moveDown(0.6);
      doc.fillColor("#000000");
    };

    const drawPageChrome = (pageIndex: number, totalPages: number) => {
      doc.switchToPage(pageIndex);
      const pageWidth = safeNumber((doc as any)?.page?.width, 595);
      const pageHeight = safeNumber((doc as any)?.page?.height, 842);
      const marginLeft = safeNumber((doc as any)?.page?.margins?.left, defaultMargin);
      const marginRight = safeNumber((doc as any)?.page?.margins?.right, defaultMargin);

      doc.save();
      doc.rect(0, 0, pageWidth, 4).fill(brandColor);
      doc.restore();

      doc
        .fontSize(8)
        .fillColor("#64748b")
        .text(BRAND_DISPLAY_NAME, marginLeft, 14, {
          width: pageWidth - marginLeft - marginRight,
          align: "left",
        })
        .text(`Page ${pageIndex + 1} of ${totalPages}`, marginLeft, pageHeight - 26, {
          width: pageWidth - marginLeft - marginRight,
          align: "center",
        })
        .text(`Generated ${generatedAt}`, marginLeft, pageHeight - 26, {
          width: pageWidth - marginLeft - marginRight,
          align: "right",
        });

      doc
        .strokeColor("#e2e8f0")
        .lineWidth(1)
        .moveTo(marginLeft, pageHeight - 32)
        .lineTo(pageWidth - marginRight, pageHeight - 32)
        .stroke();

      doc.fillColor("#000000");
    };

    doc.fontSize(20).fillColor("#0f172a").text(`SEO Analytics Report`, { align: 'center' });
    doc.moveDown(0.35);
    doc.fontSize(13).fillColor("#334155").text(`${periodLabel} report for ${client.name}`, { align: 'center' });
    doc.moveDown(0.9);

    doc.fontSize(11).fillColor("#475569").text(`Client: ${client.name}`);
    if (client.domain) {
      doc.text(`Domain: ${client.domain}`);
    }
    doc.text(`Report date: ${reportDate}`);
    doc.fillColor("#000000");

    doc.moveDown();
    drawSectionHeader(REPORT_SECTION_TITLES.traffic_overview);
    drawSectionDescription("Core visitor metrics for this reporting period.");
    const webVisitors = (report as any).totalUsers ?? 0;
    const organicTraffic = (report as any).organicSearchEngagedSessions ?? 0;
    drawMetricRow("Web Visitors", Number(webVisitors).toLocaleString());
    drawMetricRow("Organic Traffic", Number(organicTraffic).toLocaleString());
    drawMetricRow("First Time Visitors", Number(report.newUsers ?? 0).toLocaleString());
    drawMetricRow("Engaged Visitors", Number((report as any).engagedVisitors ?? (report as any).engagedSessions ?? 0).toLocaleString());

    const moneyKws = targetKeywords.filter((k) => (k as any).type !== "topical");
    const topicalKws = targetKeywords.filter((k) => (k as any).type === "topical");

    const drawKeywordTable = (title: string, subtitle: string, keywords: ReportTargetKeywordRow[]) => {
      if (keywords.length === 0) return;

      doc.addPage({ layout: "landscape" });
      doc.fontSize(16).fillColor("#000000").text(title);
      doc.moveDown(0.15);
      doc.fontSize(9.5).fillColor("#64748b").text(subtitle);
      doc.fillColor("#000000");
      doc.moveDown(0.5);

      const pageLeft = safeNumber((doc as any)?.page?.margins?.left, defaultMargin);
      const pageRight =
        safeNumber((doc as any)?.page?.width, 0) - safeNumber((doc as any)?.page?.margins?.right, defaultMargin);
      const usableWidth = Math.max(1, pageRight - pageLeft);

      const col = {
        keyword: 200,
        location: 140,
        date: 90,
        google: 60,
        change: 80,
        serp: 140,
        url: Math.max(usableWidth - (200 + 140 + 90 + 60 + 80 + 140), 120),
      };

      const headers: Array<{ key: keyof typeof col; label: string }> = [
        { key: "keyword", label: "Keyword" },
        { key: "location", label: "Location" },
        { key: "date", label: "Date Added" },
        { key: "google", label: "Position" },
        { key: "change", label: "Change" },
        { key: "serp", label: "SERP Features" },
        { key: "url", label: "URL" },
      ];

      const rowPaddingY = 4;
      const rowPaddingX = 4;
      const headerBg = "#f3f4f6";
      const borderColor = "#d1d5db";

      const drawHeader = (y: number) => {
        let x = pageLeft;
        const h = 18;
        doc.save();
        doc.rect(pageLeft, y, usableWidth, h).fill(headerBg);
        doc.restore();
        doc.fontSize(10).fillColor("#111827");
        headers.forEach((hcol) => {
          doc
            .strokeColor(borderColor)
            .rect(x, y, col[hcol.key], h)
            .stroke();
          doc.text(hcol.label, x + rowPaddingX, y + 5, { width: col[hcol.key] - rowPaddingX * 2 });
          x += col[hcol.key];
        });
        doc.fillColor("#000000");
        return y + h;
      };

      const formatDate = (value: any) => {
        if (!value) return "—";
        try {
          return new Date(value).toLocaleDateString();
        } catch {
          return "—";
        }
      };

      let y = doc.y;
      y = drawHeader(y);
      doc.fontSize(9);

      for (const k of keywords) {
        const current = typeof k.googlePosition === "number" ? k.googlePosition : null;
        const prev = typeof k.previousPosition === "number" ? k.previousPosition : null;
        const diff = current != null && prev != null ? prev - current : null;
        const diffText = diff == null ? "—" : diff === 0 ? "0" : diff > 0 ? `+${diff}` : `${diff}`;
        const serp = toStringArray(k.serpItemTypes).slice(0, 3).join(", ") || "—";
        const cells = {
          keyword: String(k.keyword || ""),
          location: String(k.locationName || "United States"),
          date: formatDate(k.createdAt),
          google: current != null ? String(current) : "—",
          change: diffText,
          serp,
          url: onlyRankingWebsiteUrl(k.googleUrl) ? String(onlyRankingWebsiteUrl(k.googleUrl)) : "—",
        };

        let maxH = 0;
        (Object.keys(col) as Array<keyof typeof col>).forEach((key) => {
          const text = (cells as any)[key] as string;
          const h = doc.heightOfString(text, { width: col[key] - rowPaddingX * 2 });
          maxH = Math.max(maxH, h);
        });
        const rowH = Math.max(14, maxH) + rowPaddingY * 2;

        const pageHeight = safeNumber((doc as any)?.page?.height, 0);
        const marginBottom = safeNumber((doc as any)?.page?.margins?.bottom, defaultMargin);
        const bottomLimit = Math.max(1, pageHeight - marginBottom - 24);
        if (y + rowH > bottomLimit) {
          doc.addPage({ layout: "landscape" });
          doc.fontSize(16).fillColor("#000000").text(title);
          doc.moveDown(0.15);
          doc.fontSize(9.5).fillColor("#64748b").text(subtitle);
          doc.fillColor("#000000");
          doc.moveDown(0.5);
          y = drawHeader(doc.y);
          doc.fontSize(9);
        }

        let x = pageLeft;
        (Object.keys(col) as Array<keyof typeof col>).forEach((key) => {
          const colW = Math.max(1, safeNumber(col[key], 120));
          const textW = Math.max(1, colW - rowPaddingX * 2);
          const xSafe = safeNumber(x, pageLeft);
          const ySafe = safeNumber(y, doc.y);
          const rowHSafe = Math.max(1, safeNumber(rowH, 14));

          doc.strokeColor(borderColor).rect(xSafe, ySafe, colW, rowHSafe).stroke();
          if (key === "url" && isHttpUrl(onlyRankingWebsiteUrl(k.googleUrl))) {
            doc
              .fillColor("#1d4ed8")
              .text(cells.url, xSafe + rowPaddingX, ySafe + rowPaddingY, {
                width: textW,
              })
              .fillColor("#000000");
          } else {
            doc.text((cells as any)[key], xSafe + rowPaddingX, ySafe + rowPaddingY, {
              width: textW,
            });
          }
          x += colW;
        });

        y += rowH;
      }
    };

    if (moneyKws.length > 0 || topicalKws.length > 0) {
      drawKeywordTable("Money Keywords", "High-intent keywords that drive qualified opportunities.", moneyKws);
      drawKeywordTable("Topical Keywords", "Supportive topic coverage and informational discovery terms.", topicalKws);
    } else {
      doc.moveDown();
      drawSectionHeader("Money Keywords");
      drawMetricRow("Status", "No money keywords tracked yet.");
      doc.moveDown();
      drawSectionHeader("Topical Keywords");
      drawMetricRow("Status", "No topical keywords tracked yet.");
    }

    doc.moveDown();
    drawSectionHeader("Live Dashboard");
    drawSectionDescription("Share this live report URL to provide read-only visibility.");
    drawMetricRow("URL", isHttpUrl(shareUrl) ? shareUrl : "Share link unavailable.");

    ensurePageSpace(42);
    doc.moveDown(0.8);
    const pageLeft = safeNumber((doc as any)?.page?.margins?.left, defaultMargin);
    const pageRight =
      safeNumber((doc as any)?.page?.width, 595) - safeNumber((doc as any)?.page?.margins?.right, defaultMargin);
    const noticeWidth = Math.max(1, pageRight - pageLeft);
    const noticeY = doc.y;
    doc.save();
    doc.roundedRect(pageLeft, noticeY, noticeWidth, 34, 4).fill("#f8fafc");
    doc.restore();
    doc.fontSize(10).fillColor('#64748b').text(
      `This PDF was generated automatically by ${BRAND_DISPLAY_NAME} based on the latest available analytics data.`,
      pageLeft + 10,
      noticeY + 11,
      { width: noticeWidth - 20, align: 'center' }
    );

    const pageRange = doc.bufferedPageRange();
    for (let i = 0; i < pageRange.count; i += 1) {
      drawPageChrome(i, pageRange.count);
    }

    doc.end();
  });
}

/**
 * Auto-generate a report for a client
 */
export async function autoGenerateReport(clientId: string, period: string = "monthly"): Promise<any> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      user: true
    }
  });

  if (!client) {
    throw new Error('Client not found');
  }

  // Calculate date range based on period - aligned with SEO Overview date picker ranges
  // so Report Traffic Overview metrics match SEO Overview when viewing the same period
  const endDate = new Date();
  let startDate: Date;
  const normalizedPeriod = normalizeReportPeriod(period);
  if (normalizedPeriod === "weekly") {
    // Last 7 days - matches SEO Overview "Last 7 days"
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);
  } else if (normalizedPeriod === "biweekly") {
    // Last 14 days - matches SEO Overview when user selects 14-day equivalent
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 14);
  } else if (normalizedPeriod === "monthly") {
    // Last 30 days - matches SEO Overview default "Last 30 days"
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 30);
  } else {
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 30);
  }

  // Fetch dashboard data (this will get GA4 + DataForSEO data)
  // We'll need to call the dashboard endpoint logic directly
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // Get GA4 data if connected
  let ga4Data: any = null;
  const isGA4Connected = !!(client.ga4RefreshToken && client.ga4PropertyId && client.ga4ConnectedAt);
  
  if (isGA4Connected) {
    try {
      const { fetchGA4TrafficData } = await import('./ga4.js');
      ga4Data = await fetchGA4TrafficData(clientId, startDate, endDate);
    } catch (error) {
      console.error(`Failed to fetch GA4 data for client ${clientId}:`, error);
    }
  }

  // Get keyword stats
  const keywordStats = await prisma.keyword.aggregate({
    where: { clientId },
    _count: { id: true },
    _avg: { 
      currentPosition: true,
      ctr: true
    },
    _sum: {
      clicks: true,
      impressions: true
    }
  });

  // Get traffic sources
  const trafficSources = await prisma.trafficSource.findMany({
    where: { clientId },
  });

  const firstSource = trafficSources[0];
  const trafficSourceSummary = firstSource ? {
    totalEstimatedTraffic: firstSource.totalEstimatedTraffic,
    organicEstimatedTraffic: firstSource.organicEstimatedTraffic,
    averageRank: firstSource.averageRank,
  } : null;

  // Total Clicks / Impressions: use Keyword table (GSC) when available; fallback to traffic source when 0
  const keywordClicks = keywordStats._sum.clicks ?? 0;
  const keywordImpressions = keywordStats._sum.impressions ?? 0;
  const totalClicks = keywordClicks > 0 ? keywordClicks : 0;
  const totalImpressions = keywordImpressions > 0 ? keywordImpressions : 0;

  // Create report data
  // Traffic Overview aligns with SEO Overview: Web Visitors, Organic Traffic, First Time Visitors, Engaged Visitors
  const reportData = {
    reportDate: endDate,
    period: normalizedPeriod,
    status: normalizeReportStatus("draft"),
    totalSessions: Math.round(ga4Data?.totalSessions || trafficSourceSummary?.totalEstimatedTraffic || 0),
    organicSessions: Math.round(ga4Data?.organicSessions || trafficSourceSummary?.organicEstimatedTraffic || 0),
    paidSessions: 0,
    directSessions: 0,
    referralSessions: 0,
    totalClicks,
    totalImpressions,
    averageCtr: keywordStats._avg.ctr || 0,
    averagePosition: trafficSourceSummary?.averageRank || keywordStats._avg.currentPosition || 0,
    bounceRate: ga4Data?.bounceRate || 0,
    avgSessionDuration: ga4Data?.avgSessionDuration || 0,
    pagesPerSession: ga4Data?.pagesPerSession || 0,
    conversions: Math.round(ga4Data?.conversions || 0),
    conversionRate: ga4Data?.conversionRate || 0,
    activeUsers: Math.round(ga4Data?.activeUsers || 0),
    totalUsers: ga4Data?.totalUsers != null ? Math.round(ga4Data.totalUsers) : null,
    organicSearchEngagedSessions: ga4Data?.organicSearchEngagedSessions != null ? Math.round(ga4Data.organicSearchEngagedSessions) : null,
    engagedSessions: ga4Data?.engagedSessions != null ? Math.round(ga4Data.engagedSessions) : null,
    eventCount: Math.round(ga4Data?.eventCount || 0),
    newUsers: Math.round(ga4Data?.newUsers || 0),
    keyEvents: Math.round(ga4Data?.keyEvents || 0),
  };

  // Upsert report (one report per client)
  // Use findFirst instead of findUnique(clientId) to be compatible with older Prisma clients
  const existing = await prisma.seoReport.findFirst({
    where: { clientId }
  });

  // Link report to the schedule that matches this period (weekly/biweekly/monthly) so recipients display correctly
  const activeSchedule = await prisma.reportSchedule.findFirst({
    where: {
      clientId,
      isActive: true,
      frequency: period as "weekly" | "biweekly" | "monthly"
    }
  });

  // If there's an active schedule, set status to "scheduled" instead of "draft"
  if (activeSchedule && reportData.status === "draft") {
    reportData.status = normalizeReportStatus("scheduled");
  }

  const report = existing
    ? await prisma.seoReport.update({
        where: { id: existing.id },
        data: {
          ...reportData,
          scheduleId: activeSchedule?.id || existing.scheduleId || null
        }
      })
    : await prisma.seoReport.create({
        data: {
          ...reportData,
          clientId,
          scheduleId: activeSchedule?.id || null
        }
      });

  return report;
}

/**
 * Auto-refresh GA4 data for all connected clients (runs every Monday morning)
 */
export async function refreshAllGA4Data(): Promise<void> {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const hour = now.getHours();
    
    // Only run on Monday mornings (1 = Monday, between 1 AM and 9 AM)
    if (dayOfWeek !== 1 || hour < 1 || hour > 9) {
      return;
    }

    console.log(`[GA4 Auto-Refresh] Starting Monday morning refresh at ${now.toISOString()}`);
    
    // Find all non-archived clients with GA4 connected (includes Vendasta clients — they have full features)
    const connectedClients = await prisma.client.findMany({
      where: {
        ga4RefreshToken: { not: null },
        ga4PropertyId: { not: null },
        ga4ConnectedAt: { not: null },
        status: { notIn: ["ARCHIVED", "SUSPENDED", "REJECTED"] },
      },
      select: {
        id: true,
        name: true,
        ga4PropertyId: true
      }
    });

    console.log(`[GA4 Auto-Refresh] Found ${connectedClients.length} clients with GA4 connected`);

    // Refresh data for each client in parallel (but limit concurrency)
    const refreshPromises = connectedClients.map(async (client) => {
      try {
        const { fetchGA4TrafficData, fetchGA4EventsData, saveGA4MetricsToDB } = await import('./ga4.js');
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30); // Last 30 days

        const [trafficData, eventsData] = await Promise.all([
          fetchGA4TrafficData(client.id, startDate, endDate).catch(err => {
            console.warn(`[GA4 Auto-Refresh] Failed to refresh traffic for ${client.name}:`, err.message);
            return null;
          }),
          fetchGA4EventsData(client.id, startDate, endDate).catch(err => {
            console.warn(`[GA4 Auto-Refresh] Failed to refresh events for ${client.name}:`, err.message);
            return null;
          })
        ]);

        // Save to database if we got data
        if (trafficData) {
          await saveGA4MetricsToDB(client.id, startDate, endDate, trafficData, eventsData || undefined);
          console.log(`[GA4 Auto-Refresh] ✅ Refreshed and saved data for ${client.name}`);
        }
      } catch (error: any) {
        console.error(`[GA4 Auto-Refresh] ❌ Failed to refresh ${client.name}:`, error.message);
      }
    });

    await Promise.allSettled(refreshPromises);
    console.log(`[GA4 Auto-Refresh] Completed refresh for ${connectedClients.length} clients`);
  } catch (error: any) {
    console.error('[GA4 Auto-Refresh] Error:', error);
  }
}

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 (Sun) ... 6 (Sat)
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function slugifyForThreshold(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function parseRecipientEmails(value: unknown): string[] {
  const arr = toStringArray(value);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return arr.map((s) => s.trim()).filter((s) => emailRegex.test(s));
}

type CampaignWinPriority =
  | "KEYWORD_WIN"
  | "TRAFFIC_MILESTONE"
  | "WORK_COMPLETED"
  | "AI_VISIBILITY"
  | "REVIEW_ACTIVITY";

const campaignWinPriorityOrder: CampaignWinPriority[] = [
  "KEYWORD_WIN",
  "TRAFFIC_MILESTONE",
  "WORK_COMPLETED",
  "AI_VISIBILITY",
  "REVIEW_ACTIVITY",
];

function cooldownDaysForEventType(eventType: CampaignWinPriority): number | null {
  if (eventType === "TRAFFIC_MILESTONE") return 60;
  if (eventType === "WORK_COMPLETED" || eventType === "REVIEW_ACTIVITY") return null;
  return 30;
}

function campaignWinsEmailHtml(params: {
  clientName: string;
  clientFirstName: string;
  eventDetails: string[];
  dashboardUrl: string | null;
}): string {
  const dashboardLink = params.dashboardUrl ? escapeHtml(params.dashboardUrl) : "";
  const winAccentColors = ["#ec4899", "#8b5cf6", "#06b6d4", "#22c55e", "#f59e0b"];
  const winsHtml = params.eventDetails
    .map((line, index) => {
      const accent = winAccentColors[index % winAccentColors.length];
      return `
        <tr>
          <td style="padding: 0 0 10px 0;">
            <div style="background: #ffffff; border: 1px solid #f1f5f9; border-left: 5px solid ${accent}; border-radius: 10px; padding: 12px 14px; color: #111827; font-size: 14px; line-height: 1.5;">
              ${escapeHtml(line)}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
  const agencyName = BRAND_DISPLAY_NAME;
  const safeClientName = escapeHtml(params.clientName || "your campaign");
  return `
    <div style="margin: 0; padding: 24px 12px; background: linear-gradient(160deg, #eff6ff 0%, #f5f3ff 35%, #fdf2f8 100%); font-family: Arial, sans-serif; color: #111827;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 640px; margin: 0 auto;">
        <tr>
          <td style="padding: 0;">
            <div style="border-radius: 18px; overflow: hidden; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);">
              <div style="padding: 24px; background: linear-gradient(120deg, #4f46e5 0%, #a21caf 55%, #ec4899 100%); color: #ffffff;">
                <div style="font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.9;">Campaign Wins</div>
                <h1 style="margin: 8px 0 4px; font-size: 24px; line-height: 1.25;">Great progress for ${safeClientName}</h1>
                <p style="margin: 0; font-size: 14px; color: #fdf4ff;">Fresh SEO milestones are in for this week.</p>
              </div>

              <div style="background: #ffffff; padding: 22px 24px 18px;">
                <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.6; color: #111827;">
                  Hi ${escapeHtml(params.clientFirstName || "there")},
                </p>
                <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.65; color: #334155;">
                  Here are the biggest wins we detected in your campaign:
                </p>

                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 14px;">
                  ${winsHtml}
                </table>

                <div style="margin: 16px 0 0; padding: 14px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0;">
                  <p style="margin: 0 0 10px 0; font-size: 13px; line-height: 1.5; color: #475569;">
                    Open your dashboard for the full picture and latest updates.
                  </p>
                  ${
                    params.dashboardUrl
                      ? `<a href="${dashboardLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background: linear-gradient(120deg, #2563eb 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700; padding: 10px 14px; border-radius: 8px;">View Dashboard</a>`
                      : `<span style="font-size: 13px; color: #94a3b8;">Dashboard link unavailable right now.</span>`
                  }
                </div>

                <p style="margin: 18px 0 0; font-size: 14px; line-height: 1.6; color: #334155;">
                  Talk soon,<br/>
                  <span style="font-weight: 700; color: #0f172a;">${escapeHtml(agencyName)}</span>
                </p>
              </div>
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;
}

async function upsertCampaignWinEvent(input: {
  clientId: string;
  eventType: CampaignWinPriority;
  thresholdKey: string;
  eventDetail: string;
  triggeredAt?: Date;
}): Promise<void> {
  const now = input.triggeredAt || new Date();
  const existing = await prisma.campaignWinEvent.findUnique({
    where: {
      clientId_thresholdKey: {
        clientId: input.clientId,
        thresholdKey: input.thresholdKey,
      },
    },
  });

  if (!existing) {
    await prisma.campaignWinEvent.create({
      data: {
        clientId: input.clientId,
        eventType: input.eventType as any,
        thresholdKey: input.thresholdKey,
        eventDetail: input.eventDetail,
        triggeredAt: now,
      },
    });
    return;
  }

  if (existing.cooldownUntil && existing.cooldownUntil > now) {
    return;
  }

  // Re-arm event after cooldown window if eligible.
  if (existing.notifiedAt) {
    if (input.eventType === "WORK_COMPLETED" || input.eventType === "REVIEW_ACTIVITY") {
      return;
    }
    await prisma.campaignWinEvent.update({
      where: { id: existing.id },
      data: {
        eventType: input.eventType as any,
        eventDetail: input.eventDetail,
        triggeredAt: now,
        notifiedAt: null,
      },
    });
    return;
  }

  await prisma.campaignWinEvent.update({
    where: { id: existing.id },
    data: {
      eventType: input.eventType as any,
      eventDetail: input.eventDetail,
    },
  });
}

type KeywordWinLevel = "POSITION1" | "TOP3" | "PAGE1";

function toUtcStartOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function getKeywordWinThresholdMeta(level: KeywordWinLevel, keywordText: string): {
  suffix: "position1" | "top3" | "page1";
  detail: string;
} {
  if (level === "POSITION1") {
    return {
      suffix: "position1",
      detail: `"${keywordText}" is holding the #1 position on Google.`,
    };
  }
  if (level === "TOP3") {
    return {
      suffix: "top3",
      detail: `"${keywordText}" is ranking in the top 3 Google results.`,
    };
  }
  return {
    suffix: "page1",
    detail: `"${keywordText}" is holding page 1 visibility on Google.`,
  };
}

async function evaluateKeywordWinThreshold(params: {
  clientId: string;
  keywordId: string;
  keywordText: string;
  level: KeywordWinLevel;
  isAbove: boolean;
  now: Date;
}): Promise<void> {
  const { clientId, keywordId, keywordText, level, isAbove, now } = params;
  const meta = getKeywordWinThresholdMeta(level, keywordText);
  const thresholdKey = `keyword_${keywordId}_${meta.suffix}`;
  const today = toUtcStartOfDay(now);

  const state = await (prisma as any).campaignWinKeywordState.findUnique({
    where: { clientId_keywordId_level: { clientId, keywordId, level } },
    select: {
      id: true,
      isAbove: true,
      aboveStreak: true,
      belowStreak: true,
      lastEvaluatedAt: true,
    },
  });

  const alreadyEvaluatedToday =
    state?.lastEvaluatedAt instanceof Date && isSameUtcDay(state.lastEvaluatedAt, today);

  let wasAboveBefore = Boolean(state?.isAbove);
  let belowStreakBefore = Number(state?.belowStreak ?? 0);
  let aboveStreakAfter = Number(state?.aboveStreak ?? 0);
  let belowStreakAfter = Number(state?.belowStreak ?? 0);

  if (!state) {
    await (prisma as any).campaignWinKeywordState.create({
      data: {
        clientId,
        keywordId,
        level,
        isAbove,
        aboveStreak: isAbove ? 1 : 0,
        belowStreak: isAbove ? 0 : 1,
        lastEvaluatedAt: today,
      },
    });
    wasAboveBefore = false;
    belowStreakBefore = 0;
    aboveStreakAfter = isAbove ? 1 : 0;
    belowStreakAfter = isAbove ? 0 : 1;
  } else if (!alreadyEvaluatedToday) {
    aboveStreakAfter = isAbove ? (state.isAbove ? state.aboveStreak + 1 : 1) : 0;
    belowStreakAfter = isAbove ? 0 : (state.isAbove ? 1 : state.belowStreak + 1);
    await (prisma as any).campaignWinKeywordState.update({
      where: { id: state.id },
      data: {
        isAbove,
        aboveStreak: aboveStreakAfter,
        belowStreak: belowStreakAfter,
        lastEvaluatedAt: today,
      },
    });
  }

  if (!isAbove) return;

  const event = await prisma.campaignWinEvent.findUnique({
    where: { clientId_thresholdKey: { clientId, thresholdKey } },
    select: { id: true, notifiedAt: true, cooldownUntil: true },
  });

  if (!event) {
    if (aboveStreakAfter < 7) return;
    await prisma.campaignWinEvent.create({
      data: {
        clientId,
        eventType: "KEYWORD_WIN",
        thresholdKey,
        eventDetail: meta.detail,
        triggeredAt: now,
      },
    });
    return;
  }

  if (event.cooldownUntil && event.cooldownUntil > now) return;

  // Re-fire rule: keyword must be below threshold for 14+ consecutive days,
  // then return above threshold.
  const justReturned = !wasAboveBefore && isAbove;
  const rearmed = justReturned && belowStreakBefore >= 14;

  if (event.notifiedAt) {
    if (!rearmed) return;
    if (aboveStreakAfter < 7) return;
    await prisma.campaignWinEvent.update({
      where: { id: event.id },
      data: {
        eventType: "KEYWORD_WIN",
        eventDetail: meta.detail,
        triggeredAt: now,
        notifiedAt: null,
        cooldownUntil: null,
      },
    });
    return;
  }

  if (aboveStreakAfter >= 7) {
    await prisma.campaignWinEvent.update({
      where: { id: event.id },
      data: {
        eventType: "KEYWORD_WIN",
        eventDetail: meta.detail,
        triggeredAt: now,
      },
    });
  }
}

async function detectKeywordWins(clientId: string): Promise<void> {
  const now = new Date();
  const keywords = await prisma.keyword.findMany({
    where: { clientId },
    select: { id: true, keyword: true, currentPosition: true },
    take: 1000,
  });

  for (const kw of keywords) {
    const pos = typeof kw.currentPosition === "number" ? kw.currentPosition : null;
    const isPosition1 = pos === 1;
    const isTop3 = !!pos && pos >= 1 && pos <= 3;
    const isPage1 = !!pos && pos >= 1 && pos <= 10;

    await evaluateKeywordWinThreshold({
      clientId,
      keywordId: kw.id,
      keywordText: kw.keyword,
      level: "POSITION1",
      isAbove: isPosition1,
      now,
    });
    await evaluateKeywordWinThreshold({
      clientId,
      keywordId: kw.id,
      keywordText: kw.keyword,
      level: "TOP3",
      isAbove: isTop3,
      now,
    });
    await evaluateKeywordWinThreshold({
      clientId,
      keywordId: kw.id,
      keywordText: kw.keyword,
      level: "PAGE1",
      isAbove: isPage1,
      now,
    });
  }
}

async function detectTrafficMilestones(clientId: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { ga4RefreshToken: true, ga4PropertyId: true, ga4ConnectedAt: true },
  });
  if (!client?.ga4RefreshToken || !client.ga4PropertyId || !client.ga4ConnectedAt) return;

  const { fetchGA4TrafficData } = await import("./ga4.js");
  const now = new Date();
  const currentEnd = new Date(now);
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - 30);
  const prevEnd = new Date(currentStart);
  const prevStart = new Date(currentStart);
  prevStart.setDate(prevStart.getDate() - 30);

  const [current, previous] = await Promise.all([
    fetchGA4TrafficData(clientId, currentStart, currentEnd).catch(() => null),
    fetchGA4TrafficData(clientId, prevStart, prevEnd).catch(() => null),
  ]);

  const currentSessions = Number(current?.organicSessions ?? 0);
  const previousSessions = Number(previous?.organicSessions ?? 0);
  if (!(currentSessions > 0 && previousSessions > 0)) return;

  const pctIncrease = ((currentSessions - previousSessions) / previousSessions) * 100;
  const tiers = [50, 30, 15];
  for (const tier of tiers) {
    if (pctIncrease < tier) continue;
    const thresholdKey = `traffic_${clientId}_${tier}pct`;
    const detail = `Organic traffic is up ${Math.round(pctIncrease)}% vs the previous 30-day period.`;
    await upsertCampaignWinEvent({
      clientId,
      eventType: "TRAFFIC_MILESTONE",
      thresholdKey,
      eventDetail: detail,
    });
  }
}

async function detectWorkCompleted(clientId: string): Promise<void> {
  const now = new Date();
  const weekStart = startOfWeekMonday(now);
  const count = await prisma.task.count({
    where: {
      clientId,
      status: "DONE",
      updatedAt: { gte: weekStart },
    },
  });
  if (count <= 0) return;

  const key = `work_${clientId}_${weekStart.toISOString().slice(0, 10)}`;
  const detail =
    count === 1
      ? "Your team completed 1 task this week."
      : `Your team completed ${count} tasks this week.`;
  await upsertCampaignWinEvent({
    clientId,
    eventType: "WORK_COMPLETED",
    thresholdKey: key,
    eventDetail: detail,
  });
}

async function detectAiVisibility(clientId: string): Promise<void> {
  const now = new Date();
  const recentSince = new Date(now);
  recentSince.setDate(recentSince.getDate() - 7);
  let recentMentions: Array<{ query: string; platform: string; dateRecorded: Date }> = [];
  try {
    recentMentions = await prisma.aiMention.findMany({
      where: {
        clientId,
        dateRecorded: { gte: recentSince },
        mentions: { gt: 0 },
      },
      select: { query: true, platform: true, dateRecorded: true },
      orderBy: { dateRecorded: "desc" },
      take: 300,
    });
  } catch (error: any) {
    const missingTable =
      error?.code === "P2021" &&
      String(error?.meta?.table || "").toLowerCase().includes("ai_mentions");
    if (missingTable) {
      console.warn(
        "[Campaign Wins] Skipping AI_VISIBILITY: table `ai_mentions` is missing. Run `npx prisma db push` (or deploy migrations) to enable this feature."
      );
      return;
    }
    throw error;
  }

  const seen = new Set<string>();
  for (const mention of recentMentions) {
    const query = String(mention.query || "").trim();
    const platform = String(mention.platform || "").trim().toLowerCase();
    if (!query || !platform) continue;
    const dedupeKey = `${query.toLowerCase()}::${platform}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const previous = await prisma.aiMention.findFirst({
      where: {
        clientId,
        query,
        platform,
        dateRecorded: { lt: mention.dateRecorded },
      },
      orderBy: { dateRecorded: "desc" },
      select: { dateRecorded: true },
    });

    const canTrigger =
      !previous ||
      (mention.dateRecorded.getTime() - previous.dateRecorded.getTime()) / (1000 * 60 * 60 * 24) >= 30;
    if (!canTrigger) continue;

    const thresholdKey = `ai_${clientId}_${slugifyForThreshold(query)}_${slugifyForThreshold(platform)}`;
    const detail = `Your brand appeared in ${platform.replace(/_/g, " ")} AI results for "${query}".`;
    await upsertCampaignWinEvent({
      clientId,
      eventType: "AI_VISIBILITY",
      thresholdKey,
      eventDetail: detail,
    });
  }
}

async function detectReviewOrLeadActivity(clientId: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { managedServiceStatus: true },
  });
  if (client?.managedServiceStatus !== "active") return;

  const now = new Date();
  const weekStart = startOfWeekMonday(now);
  const reviewLeadCount = await prisma.notification.count({
    where: {
      createdAt: { gte: weekStart },
      OR: [
        { type: { contains: "review" } },
        { type: { contains: "lead" } },
        { type: { contains: "pipeline" } },
      ],
      message: { contains: clientId },
    },
  });

  if (reviewLeadCount <= 0) return;

  const key = `reviews_${clientId}_${weekStart.toISOString().slice(0, 10)}`;
  const detail =
    reviewLeadCount === 1
      ? "New review or lead activity was detected this week."
      : `${reviewLeadCount} new review/lead activity updates were detected this week.`;
  await upsertCampaignWinEvent({
    clientId,
    eventType: "REVIEW_ACTIVITY",
    thresholdKey: key,
    eventDetail: detail,
  });
}

function sortCampaignWinEvents<T extends { eventType: string }>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const ai = campaignWinPriorityOrder.indexOf(a.eventType as CampaignWinPriority);
    const bi = campaignWinPriorityOrder.indexOf(b.eventType as CampaignWinPriority);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

async function processCampaignWinsForClient(client: {
  id: string;
  name: string;
  campaignWinsEmails: string | null;
  campaignWinsEnabled: boolean;
  campaignWinsLastSent: Date | null;
  user: { name: string | null } | null;
}): Promise<void> {
  if (!client.campaignWinsEnabled) return;
  const recipients = parseRecipientEmails(client.campaignWinsEmails);
  if (recipients.length === 0) return;

  await detectKeywordWins(client.id);
  await detectTrafficMilestones(client.id);
  await detectWorkCompleted(client.id);
  await detectAiVisibility(client.id);
  await detectReviewOrLeadActivity(client.id);

  const now = new Date();
  const weekStart = startOfWeekMonday(now);

  // Frequency cap safety check: never more than 2 sends per client/week.
  const recentNotifications = await prisma.campaignWinEvent.findMany({
    where: {
      clientId: client.id,
      notifiedAt: { gte: weekStart },
    },
    select: { notifiedAt: true },
  });
  const sendStamps = new Set(
    recentNotifications
      .map((e) => e.notifiedAt?.toISOString())
      .filter((v): v is string => Boolean(v))
  );
  const lastSentThisWeek =
    client.campaignWinsLastSent != null && client.campaignWinsLastSent >= weekStart;
  const estimatedSendsThisWeek = Math.max(sendStamps.size, lastSentThisWeek ? 1 : 0);
  if (estimatedSendsThisWeek >= 2) return;

  const pendingEvents = await prisma.campaignWinEvent.findMany({
    where: {
      clientId: client.id,
      notifiedAt: null,
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
    },
    orderBy: { triggeredAt: "asc" },
  });
  if (pendingEvents.length === 0) return;

  const minKeywordHoldDate = new Date(now);
  minKeywordHoldDate.setDate(minKeywordHoldDate.getDate() - 7);
  const queue = sortCampaignWinEvents(
    pendingEvents.filter((event) => {
      if (event.eventType !== "KEYWORD_WIN") return true;
      return event.triggeredAt <= minKeywordHoldDate;
    })
  ).slice(0, 3);
  if (queue.length === 0) return;

  // Safety dedupe before sending: never send an event if it has already been
  // notified or is still in cooldown.
  const safeQueue = (
    await Promise.all(
      queue.map(async (event) => {
        const latest = await prisma.campaignWinEvent.findUnique({
          where: { id: event.id },
          select: { id: true, notifiedAt: true, cooldownUntil: true },
        });
        if (!latest) return null;
        if (latest.notifiedAt) return null;
        if (latest.cooldownUntil && latest.cooldownUntil > now) return null;
        return event;
      })
    )
  ).filter((e): e is (typeof queue)[number] => Boolean(e));
  if (safeQueue.length === 0) return;

  const shareUrl = await buildShareDashboardUrl(client.id).catch(() => null);
  const clientFirstName = String(client.user?.name || "").trim().split(/\s+/)[0] || "there";
  const subject = `Campaign Update — ${client.name}`;
  const html = campaignWinsEmailHtml({
    clientName: client.name,
    clientFirstName,
    eventDetails: safeQueue.map((e) => e.eventDetail),
    dashboardUrl: shareUrl,
  });

  await Promise.all(
    recipients.map((to) =>
      sendEmail({
        to,
        subject,
        html,
      })
    )
  );

  for (const event of safeQueue) {
    // Queue/send rule safety: apply 30-day cooldown on fired events.
    // Weekly-dedup events also use week-based threshold keys, so this does not
    // block next week's distinct keys.
    const cooldownUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await prisma.campaignWinEvent.update({
      where: { id: event.id },
      data: {
        notifiedAt: now,
        cooldownUntil,
      },
    });
  }

  await prisma.client.update({
    where: { id: client.id },
    data: { campaignWinsLastSent: now },
  });
}

export async function getCampaignWinsInstantPreviewForClient(clientId: string): Promise<{
  recipients: string[];
  subject: string;
  eventDetails: string[];
  html: string;
  preview: boolean;
}> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      campaignWinsEnabled: true,
      campaignWinsEmails: true,
      user: { select: { name: true } },
    },
  });
  if (!client) {
    throw new Error("Client not found");
  }
  if (!client.campaignWinsEnabled) {
    throw new Error("Campaign Wins is not enabled for this client");
  }

  const recipients = parseRecipientEmails(client.campaignWinsEmails);
  if (recipients.length === 0) {
    throw new Error("No Campaign Wins recipients configured");
  }

  // Refresh event detection before previewing to include newly-eligible wins.
  await detectKeywordWins(client.id);
  await detectTrafficMilestones(client.id);
  await detectWorkCompleted(client.id);
  await detectAiVisibility(client.id);
  await detectReviewOrLeadActivity(client.id);

  const now = new Date();
  const pendingEvents = await prisma.campaignWinEvent.findMany({
    where: {
      clientId: client.id,
      OR: [{ notifiedAt: null }, { notifiedAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } }],
    },
    orderBy: { triggeredAt: "desc" },
    take: 10,
  });

  const selectedEvents = sortCampaignWinEvents(pendingEvents).slice(0, 3);
  const eventDetails =
    selectedEvents.length > 0
      ? selectedEvents.map((e) => e.eventDetail)
      : [
          "Your campaign is active and we are tracking performance milestones this week.",
          "This is a preview message so you can review the Campaign Wins email format.",
        ];

  const shareUrl = await buildShareDashboardUrl(client.id).catch(() => null);
  const clientFirstName = String(client.user?.name || "").trim().split(/\s+/)[0] || "there";
  const subject = `Campaign Update Preview — ${client.name}`;
  const html = campaignWinsEmailHtml({
    clientName: client.name,
    clientFirstName,
    eventDetails,
    dashboardUrl: shareUrl,
  });

  return {
    recipients,
    subject,
    eventDetails,
    html,
    preview: true,
  };
}

export async function sendCampaignWinsInstantEmailForClient(clientId: string): Promise<{
  recipients: string[];
  subject: string;
  eventDetails: string[];
  preview: boolean;
}> {
  const previewPayload = await getCampaignWinsInstantPreviewForClient(clientId);
  const { recipients, subject, html, eventDetails, preview } = previewPayload;

  await Promise.all(
    recipients.map((to) =>
      sendEmail({
        to,
        subject,
        html,
      })
    )
  );

  return {
    recipients,
    subject,
    eventDetails,
    preview,
  };
}

export async function processCampaignWinsReports(): Promise<void> {
  try {
    const clients = await prisma.client.findMany({
      where: {
        campaignWinsEnabled: true,
        status: { notIn: ["ARCHIVED", "SUSPENDED", "REJECTED"] },
      },
      select: {
        id: true,
        name: true,
        campaignWinsEnabled: true,
        campaignWinsEmails: true,
        campaignWinsLastSent: true,
        user: { select: { name: true } },
      },
    });

    for (const client of clients) {
      try {
        await processCampaignWinsForClient(client);
      } catch (error: any) {
        console.error(`[Campaign Wins] Failed for client ${client.id}:`, error?.message || error);
      }
    }
  } catch (error: any) {
    console.error("[Campaign Wins] Scheduler failed:", error?.message || error);
  }
}

function getPpcRangeForPeriod(period: string): { startDate: Date; endDate: Date } {
  const normalized = normalizeReportPeriod(period);
  const endDate = new Date();
  const startDate = new Date(endDate);
  if (normalized === "weekly") {
    startDate.setDate(startDate.getDate() - 7);
  } else if (normalized === "biweekly") {
    startDate.setDate(startDate.getDate() - 14);
  } else {
    startDate.setDate(startDate.getDate() - 30);
  }
  return { startDate, endDate };
}

export async function autoGeneratePpcReport(clientId: string, period: string): Promise<{
  period: string;
  dateRange: { start: string; end: string };
  campaignSummary: {
    clicks: number;
    impressions: number;
    cost: number;
    conversions: number;
    conversionRate: number;
    avgCpc: number;
    costPerConversion: number;
  };
  conversionSummary: {
    totalConversions: number;
    conversionValue: number;
    conversionRate: number;
    totalClicks: number;
    totalCost: number;
    costPerConversion: number;
  };
  campaigns: any[];
  adGroups: any[];
  keywords: any[];
  conversions: any[];
}> {
  const normalized = normalizeReportPeriod(period);
  const { startDate, endDate } = getPpcRangeForPeriod(normalized);
  const { fetchGoogleAdsCampaigns, fetchGoogleAdsAdGroups, fetchGoogleAdsKeywords, fetchGoogleAdsConversions } =
    await import("./googleAds.js");

  const [campaignData, adGroupData, keywordData, conversionData] = await Promise.all([
    fetchGoogleAdsCampaigns(clientId, startDate, endDate).catch(() => ({ campaigns: [], summary: {} })),
    fetchGoogleAdsAdGroups(clientId, startDate, endDate).catch(() => ({ adGroups: [] })),
    fetchGoogleAdsKeywords(clientId, startDate, endDate).catch(() => ({ keywords: [] })),
    fetchGoogleAdsConversions(clientId, startDate, endDate).catch(() => ({
      conversions: [],
      summary: {
        totalConversions: 0,
        conversionValue: 0,
        conversionRate: 0,
        totalClicks: 0,
        totalCost: 0,
        costPerConversion: 0,
      },
    })),
  ]);

  return {
    period: normalized,
    dateRange: {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
    },
    campaignSummary: {
      clicks: Number(campaignData?.summary?.clicks ?? 0),
      impressions: Number(campaignData?.summary?.impressions ?? 0),
      cost: Number(campaignData?.summary?.cost ?? 0),
      conversions: Number(campaignData?.summary?.conversions ?? 0),
      conversionRate: Number(campaignData?.summary?.conversionRate ?? 0),
      avgCpc: Number(campaignData?.summary?.avgCpc ?? 0),
      costPerConversion: Number(campaignData?.summary?.costPerConversion ?? 0),
    },
    conversionSummary: {
      totalConversions: Number(conversionData?.summary?.totalConversions ?? 0),
      conversionValue: Number(conversionData?.summary?.conversionValue ?? 0),
      conversionRate: Number(conversionData?.summary?.conversionRate ?? 0),
      totalClicks: Number(conversionData?.summary?.totalClicks ?? 0),
      totalCost: Number(conversionData?.summary?.totalCost ?? 0),
      costPerConversion: Number(conversionData?.summary?.costPerConversion ?? 0),
    },
    campaigns: Array.isArray(campaignData?.campaigns) ? campaignData.campaigns : [],
    adGroups: Array.isArray(adGroupData?.adGroups) ? adGroupData.adGroups : [],
    keywords: Array.isArray(keywordData?.keywords) ? keywordData.keywords : [],
    conversions: Array.isArray(conversionData?.conversions) ? conversionData.conversions : [],
  };
}

export function generatePpcReportEmailHtml(clientName: string, report: Awaited<ReturnType<typeof autoGeneratePpcReport>>): string {
  const periodLabel = report.period.charAt(0).toUpperCase() + report.period.slice(1);
  const topCampaigns = report.campaigns.slice(0, 10);
  const topAdGroups = report.adGroups.slice(0, 10);
  const topKeywords = report.keywords.slice(0, 10);
  const topConversions = report.conversions.slice(0, 10);
  const money = (value: number) =>
    Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const renderCompactRows = (
    rows: any[],
    emptyText: string,
    formatter: (row: any) => string
  ) =>
    rows.length > 0
      ? `
        <ul style="margin: 0; padding-left: 18px;">
          ${rows.map((row) => `<li style="margin: 0 0 6px;">${formatter(row)}</li>`).join("")}
        </ul>
      `
      : `<p style="margin: 0; color: #6b7280;">${escapeHtml(emptyText)}</p>`;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${BRAND_DISPLAY_NAME} PPC Report - ${escapeHtml(clientName)}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #111827; background-color: #f3f4f6; margin: 0; padding: 24px;">
        <div style="max-width: 900px; margin: 0 auto; background-color: #ffffff;">
          <div style="background-color: #2563eb; border-radius: 12px 12px 0 0; padding: 32px; color: #ffffff; text-align: center;">
            <h1 style="margin: 0 0 12px 0; font-size: 28px; font-weight: 700; color: #ffffff;">PPC Performance Report</h1>
            <p style="margin: 0; font-size: 16px; color: #bfdbfe;">${escapeHtml(periodLabel)} report for ${escapeHtml(clientName)}</p>
            <p style="margin: 8px 0 0 0; font-size: 13px; color: #dbeafe;">
              ${escapeHtml(report.dateRange.start)} to ${escapeHtml(report.dateRange.end)}
            </p>
          </div>

          <div style="padding: 24px;">
            <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
              <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #111827;">
                <span style="display: inline-block; width: 4px; height: 20px; background-color: #3b82f6; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>
                PPC Summary
              </h2>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
                <tr>
                  <td width="25%" align="center" valign="top" style="padding: 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px;">
                      <tr><td style="padding: 16px; text-align: center;"><div style="font-size: 11px; font-weight: 600; color: #1e40af; margin-bottom: 4px;">Clicks</div><div style="font-size: 22px; font-weight: 700; color: #1e3a8a;">${report.campaignSummary.clicks.toLocaleString()}</div></td></tr>
                    </table>
                  </td>
                  <td width="25%" align="center" valign="top" style="padding: 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
                      <tr><td style="padding: 16px; text-align: center;"><div style="font-size: 11px; font-weight: 600; color: #166534; margin-bottom: 4px;">Impressions</div><div style="font-size: 22px; font-weight: 700; color: #14532d;">${report.campaignSummary.impressions.toLocaleString()}</div></td></tr>
                    </table>
                  </td>
                  <td width="25%" align="center" valign="top" style="padding: 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px;">
                      <tr><td style="padding: 16px; text-align: center;"><div style="font-size: 11px; font-weight: 600; color: #6b21a8; margin-bottom: 4px;">Spend</div><div style="font-size: 22px; font-weight: 700; color: #581c87;">$${money(report.campaignSummary.cost)}</div></td></tr>
                    </table>
                  </td>
                  <td width="25%" align="center" valign="top" style="padding: 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px;">
                      <tr><td style="padding: 16px; text-align: center;"><div style="font-size: 11px; font-weight: 600; color: #9a3412; margin-bottom: 4px;">Conversions</div><div style="font-size: 22px; font-weight: 700; color: #7c2d12;">${report.conversionSummary.totalConversions.toLocaleString()}</div></td></tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin: 14px 0 0; color: #475569; font-size: 12px;">
                Conversion Value: <strong>$${money(report.conversionSummary.conversionValue)}</strong> •
                Avg CPC: <strong>$${money(report.campaignSummary.avgCpc)}</strong> •
                Cost / Conversion: <strong>$${money(report.conversionSummary.costPerConversion)}</strong>
              </p>
            </div>

            <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
              <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #111827;"><span style="display: inline-block; width: 4px; height: 20px; background-color: #2563eb; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>Top Campaigns</h2>
              ${renderCompactRows(topCampaigns, "No campaign activity in this period.", (row) =>
                `${escapeHtml(row?.name || "Unnamed")} — ${Number(row?.clicks || 0).toLocaleString()} clicks, ${Number(row?.conversions || 0).toLocaleString()} conversions`
              )}
            </div>

            <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
              <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #111827;"><span style="display: inline-block; width: 4px; height: 20px; background-color: #8b5cf6; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>Top Ad Groups</h2>
              ${renderCompactRows(topAdGroups, "No ad group activity in this period.", (row) =>
                `${escapeHtml(row?.name || "Unnamed")} — ${Number(row?.clicks || 0).toLocaleString()} clicks, ${Number(row?.conversions || 0).toLocaleString()} conversions`
              )}
            </div>

            <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
              <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #111827;"><span style="display: inline-block; width: 4px; height: 20px; background-color: #0ea5e9; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>Top Keywords</h2>
              ${renderCompactRows(topKeywords, "No keyword activity in this period.", (row) =>
                `${escapeHtml(row?.keyword || "Unknown")} — ${Number(row?.clicks || 0).toLocaleString()} clicks, ${Number(row?.conversions || 0).toLocaleString()} conversions`
              )}
            </div>

            <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
              <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #111827;"><span style="display: inline-block; width: 4px; height: 20px; background-color: #f59e0b; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>Top Conversion Actions</h2>
              ${renderCompactRows(topConversions, "No conversion rows in this period.", (row) =>
                `${escapeHtml(row?.conversionAction || "All conversions")} — ${Number(row?.conversions || 0).toLocaleString()} conversions, $${money(Number(row?.conversionValue || 0))} value`
              )}
            </div>
          </div>

          <div style="background-color: #f9fafb; border-top: 1px solid #e5e7eb; padding: 16px; text-align: center;">
            <p style="margin: 0; color: #6b7280; font-size: 12px;">
              This is an automated report generated by ${BRAND_DISPLAY_NAME}.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}

export async function generatePpcReportPdfBuffer(
  clientName: string,
  report: Awaited<ReturnType<typeof autoGeneratePpcReport>>
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err: Error) => reject(err));

    const periodLabel = report.period.charAt(0).toUpperCase() + report.period.slice(1);
    const money = (value: number) =>
      Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const brandColor = "#2563eb";
    const pageLeft = 40;
    const pageRight = 555;
    const cardWidth = pageRight - pageLeft;
    const bottomLimit = 770;
    const ensureSpace = (height: number) => {
      if (doc.y + height > bottomLimit) doc.addPage();
    };
    const drawSectionHeader = (title: string, accent = brandColor) => {
      ensureSpace(30);
      const y = doc.y;
      doc.save();
      doc.roundedRect(pageLeft, y, cardWidth, 24, 4).fill("#f8fafc");
      doc.rect(pageLeft, y, 4, 24).fill(accent);
      doc.restore();
      doc.fontSize(11).fillColor("#0f172a").text(title, pageLeft + 12, y + 7);
      doc.fillColor("#000000");
      doc.moveDown(1.6);
    };
    const drawMetricRow = (label: string, value: string) => {
      ensureSpace(20);
      const y = doc.y;
      doc.fontSize(10.5).fillColor("#475569").text(label, pageLeft, y, { width: cardWidth * 0.6, align: "left" });
      doc.fontSize(10.5).fillColor("#0f172a").text(value, pageLeft, y, { width: cardWidth, align: "right" });
      doc.strokeColor("#e2e8f0").moveTo(pageLeft, y + 15).lineTo(pageRight, y + 15).stroke();
      doc.fillColor("#000000");
      doc.moveDown(0.7);
    };

    doc.fontSize(22).fillColor("#0f172a").text("PPC Performance Report", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor("#334155").text(`${periodLabel} report for ${clientName}`, { align: "center" });
    doc.moveDown(0.7);
    doc.fontSize(10.5).fillColor("#475569").text(`Client: ${clientName}`);
    doc.text(`Date range: ${report.dateRange.start} to ${report.dateRange.end}`);
    doc.fillColor("#000000");
    doc.moveDown();

    drawSectionHeader("PPC Summary");
    drawMetricRow("Clicks", report.campaignSummary.clicks.toLocaleString());
    drawMetricRow("Impressions", report.campaignSummary.impressions.toLocaleString());
    drawMetricRow("Spend", `$${money(report.campaignSummary.cost)}`);
    drawMetricRow("Conversions", report.conversionSummary.totalConversions.toLocaleString());
    drawMetricRow("Conversion Value", `$${money(report.conversionSummary.conversionValue)}`);
    drawMetricRow("Avg CPC", `$${money(report.campaignSummary.avgCpc)}`);
    drawMetricRow("Cost / Conversion", `$${money(report.conversionSummary.costPerConversion)}`);
    doc.moveDown();

    const writeTopRows = (title: string, rows: any[], label: (row: any) => string, accent: string) => {
      drawSectionHeader(title, accent);
      doc.fontSize(10.5).fillColor("#111827");
      if (!rows.length) {
        doc.text("No activity in this period.", pageLeft, doc.y, { width: cardWidth });
        doc.moveDown(0.6);
        doc.fillColor("#000000");
        return;
      }
      for (const row of rows.slice(0, 12)) {
        ensureSpace(16);
        doc.text(`- ${label(row)}`, pageLeft, doc.y, { width: cardWidth });
      }
      doc.fillColor("#000000");
      doc.moveDown(0.6);
    };

    writeTopRows("Top Campaigns", report.campaigns, (row) =>
      `${String(row?.name || "Unnamed")} (${Number(row?.clicks || 0).toLocaleString()} clicks, ${Number(row?.conversions || 0).toLocaleString()} conv)`
    , "#2563eb");
    writeTopRows("Top Ad Groups", report.adGroups, (row) =>
      `${String(row?.name || "Unnamed")} (${Number(row?.clicks || 0).toLocaleString()} clicks, ${Number(row?.conversions || 0).toLocaleString()} conv)`
    , "#8b5cf6");
    writeTopRows("Top Keywords", report.keywords, (row) =>
      `${String(row?.keyword || "Unknown")} (${Number(row?.clicks || 0).toLocaleString()} clicks, ${Number(row?.conversions || 0).toLocaleString()} conv)`
    , "#0ea5e9");
    writeTopRows("Top Conversion Actions", report.conversions, (row) =>
      `${String(row?.conversionAction || "All conversions")} (${Number(row?.conversions || 0).toLocaleString()} conv, $${money(Number(row?.conversionValue || 0))} value)`
    , "#f59e0b");

    doc.end();
  });
}

/**
 * Process scheduled reports - called by cron job
 */
export async function processScheduledReports(): Promise<void> {
  try {
    const now = new Date();
    
    // Find all active schedules that are due (skip archived/suspended/rejected clients)
    const dueSchedules = await prisma.reportSchedule.findMany({
      where: {
        isActive: true,
        nextRunAt: {
          lte: now
        },
        client: {
          status: { notIn: ["ARCHIVED", "SUSPENDED", "REJECTED"] },
        },
      },
      include: {
        client: true
      }
    });

    const seoDueSchedules = dueSchedules.filter(
      (schedule) =>
        !isLocalMapScheduleSubject(schedule.emailSubject) && !isPpcScheduleSubject(schedule.emailSubject)
    );
    const ppcDueSchedules = dueSchedules.filter((schedule) => isPpcScheduleSubject(schedule.emailSubject));

    console.log(`[Report Scheduler] Checking scheduled reports at ${now.toISOString()}`);
    console.log(`[Report Scheduler] Found ${seoDueSchedules.length} due SEO schedule(s)`);
    console.log(`[Report Scheduler] Found ${ppcDueSchedules.length} due PPC schedule(s)`);
    
    if (seoDueSchedules.length === 0 && ppcDueSchedules.length === 0) {
      // Log all active schedules for debugging
      const allActiveSchedules = await prisma.reportSchedule.findMany({
        where: { isActive: true },
        select: {
          id: true,
          clientId: true,
          frequency: true,
          nextRunAt: true,
          recipients: true
        }
      });
      if (allActiveSchedules.length > 0) {
        console.log(`[Report Scheduler] Active schedules (not due yet):`, allActiveSchedules.map(s => ({
          id: s.id,
          frequency: s.frequency,
          nextRunAt: s.nextRunAt?.toISOString(),
          recipients: s.recipients
        })));
      }
      return;
    }

    for (const schedule of seoDueSchedules) {
      try {
        console.log(`[Report Scheduler] Processing schedule ${schedule.id} for client ${schedule.client.name}`);
        
        // Generate report
        const report = await autoGenerateReport(schedule.clientId, schedule.frequency);
        console.log(`[Report Scheduler] Report generated: ${report.id}`);
        
        // Link report to schedule
        await prisma.seoReport.update({
          where: { id: report.id },
          data: { scheduleId: schedule.id }
        });

        // Send email to recipients (stored as JSON string)
        const recipients = normalizeEmailRecipients(schedule.recipients);
        if (recipients && recipients.length > 0) {
          console.log(`[Report Scheduler] Sending emails to: ${recipients.join(", ")}`);
          
          const shareUrl = await buildShareDashboardUrl(schedule.clientId).catch((err: any) => {
            console.warn(
              `[Report Scheduler] Failed to build share URL for client ${schedule.clientId}:`,
              err?.message || err
            );
            return null;
          });

          const targetKeywords = await getReportTargetKeywords(schedule.clientId).catch((err) => {
            console.warn(
              `[Report Scheduler] Failed to fetch target keywords for client ${schedule.clientId}:`,
              err?.message || err
            );
            return [] as ReportTargetKeywordRow[];
          });

          const emailHtml = generateReportEmailHTML(report, schedule.client, { targetKeywords, shareUrl });
          const emailSubject = schedule.emailSubject || buildReportEmailSubject(schedule.client.name, schedule.frequency);
          const pdfBuffer = await generateReportPDFBuffer(report, schedule.client, { targetKeywords, shareUrl });

          const emailPromises = recipients.map((email: string) =>
            sendEmail({
              to: email,
              subject: emailSubject,
              html: emailHtml,
              attachments: [
                {
                  filename: `seo-report-${schedule.client.name.replace(/\s+/g, '-').toLowerCase()}-${report.period}.pdf`,
                  content: pdfBuffer,
                  contentType: 'application/pdf'
                }
              ]
            }).then(() => {
              console.log(`[Report Scheduler] Email sent successfully to ${email}`);
            }).catch((error) => {
              console.error(`[Report Scheduler] Failed to send email to ${email}:`, error);
              throw error;
            })
          );

          await Promise.all(emailPromises);

          // Update report status
          await prisma.seoReport.update({
            where: { id: report.id },
            data: {
              status: normalizeReportStatus("sent"),
              sentAt: new Date(),
              // SeoReport.recipients is a String column; store as JSON for consistency with ReportSchedule.recipients.
              recipients: JSON.stringify(recipients),
              emailSubject
            }
          });

          console.log(`[Report Scheduler] ✓ Report generated and sent for client ${schedule.client.name} (${schedule.frequency})`);
        } else {
          console.log(`[Report Scheduler] ⚠ No recipients configured for schedule ${schedule.id}`);
        }

        // Calculate and update next run time
        const nextRunAt = calculateNextRunTime(
          schedule.frequency,
          schedule.dayOfWeek || undefined,
          schedule.dayOfMonth || undefined,
          schedule.timeOfDay
        );

        await prisma.reportSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: now,
            nextRunAt
          }
        });

        console.log(`[Report Scheduler] Next run scheduled for: ${nextRunAt.toISOString()}`);

      } catch (error: any) {
        console.error(`[Report Scheduler] ✗ Failed to process schedule ${schedule.id} for client ${schedule.clientId}:`, error);
        console.error(`[Report Scheduler] Error details:`, error.message, error.stack);
        // Continue with other schedules even if one fails
      }
    }

    for (const schedule of ppcDueSchedules) {
      try {
        console.log(`[Report Scheduler] Processing PPC schedule ${schedule.id} for client ${schedule.client.name}`);
        const ppcReport = await autoGeneratePpcReport(schedule.clientId, schedule.frequency);
        const recipients = normalizeEmailRecipients(schedule.recipients);

        if (recipients && recipients.length > 0) {
          const subjectWithoutMarker = String(schedule.emailSubject || "")
            .replace(PPC_SCHEDULE_SUBJECT_PREFIX, "")
            .trim();
          const emailSubject =
            subjectWithoutMarker || `PPC Report - ${buildReportEmailSubject(schedule.client.name, schedule.frequency)}`;
          const emailHtml = generatePpcReportEmailHtml(schedule.client.name, ppcReport);
          const pdfBuffer = await generatePpcReportPdfBuffer(schedule.client.name, ppcReport);

          await Promise.all(
            recipients.map((email: string) =>
              sendEmail({
                to: email,
                subject: emailSubject,
                html: emailHtml,
                attachments: [
                  {
                    filename: `ppc-report-${schedule.client.name.replace(/\s+/g, "-").toLowerCase()}-${ppcReport.period}.pdf`,
                    content: pdfBuffer,
                    contentType: "application/pdf",
                  },
                ],
              })
            )
          );
          console.log(`[Report Scheduler] ✓ PPC report sent for client ${schedule.client.name} (${schedule.frequency})`);
        } else {
          console.log(`[Report Scheduler] ⚠ No recipients configured for PPC schedule ${schedule.id}`);
        }

        const nextRunAt = calculateNextRunTime(
          schedule.frequency,
          schedule.dayOfWeek || undefined,
          schedule.dayOfMonth || undefined,
          schedule.timeOfDay
        );
        await prisma.reportSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: now,
            nextRunAt,
          },
        });
      } catch (error: any) {
        console.error(`[Report Scheduler] ✗ Failed to process PPC schedule ${schedule.id} for client ${schedule.clientId}:`, error);
      }
    }

    console.log(`[Report Scheduler] Finished processing scheduled reports.`);
  } catch (error: any) {
    console.error('[Report Scheduler] Error processing scheduled reports:', error);
    console.error('[Report Scheduler] Error details:', error.message, error.stack);
  }
}

