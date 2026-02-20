import { prisma } from './prisma.js';
import { sendEmail } from './email.js';
import PDFDocument from 'pdfkit';
import jwt from "jsonwebtoken";

type ReportTargetKeywordRow = {
  id: string;
  keyword: string;
  locationName: string | null;
  createdAt: Date | string | null;
  googlePosition: number | null;
  previousPosition: number | null;
  serpItemTypes: unknown;
  googleUrl: string | null;
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

  // Map to include position data and sort by highest rank (lowest position number) first
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
    };
  });

  // Sort by highest rank (lowest position number) first, nulls at the end
  return mapped.sort((a, b) => {
    const aPos = a.googlePosition ?? Infinity;
    const bPos = b.googlePosition ?? Infinity;
    return aPos - bPos;
  });
}

export function buildShareDashboardUrl(clientId: string): string | null {
  const frontendUrlRaw = process.env.FRONTEND_URL || "";
  const frontendUrl = frontendUrlRaw.replace(/\/+$/, "");
  if (!frontendUrl) return null;

  const secret = process.env.JWT_SECRET || "change_me_secret";
  const token = jwt.sign(
    { type: "client_share", clientId, issuedBy: "report_scheduler" },
    secret
    // No expiresIn = permanent token
  );
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

/**
 * Generate email HTML for a report
 */
export function generateReportEmailHTML(
  report: any,
  client: any,
  opts?: { targetKeywords?: ReportTargetKeywordRow[]; shareUrl?: string | null }
): string {
  const periodLabel = report.period.charAt(0).toUpperCase() + report.period.slice(1);
  const reportDate = new Date(report.reportDate).toLocaleDateString();
  const safeClientName = escapeHtml(client?.name);
  const safeDomain = client?.domain ? escapeHtml(client.domain) : "";
  const shareUrl = opts?.shareUrl || null;
  // Sort keywords by highest rank (lowest position number) first
  const targetKeywords = (opts?.targetKeywords || []).sort((a, b) => {
    const aPos = a.googlePosition ?? Infinity;
    const bPos = b.googlePosition ?? Infinity;
    return aPos - bPos;
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SEO Report - ${safeClientName}</title>
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
              Traffic Overview
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
                        <div style="font-size: 24px; font-weight: 700; color: #14532d;">${Number((report as any).organicSearchEngagedSessions ?? report.organicSessions ?? 0).toLocaleString()}</div>
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
                        <div style="font-size: 24px; font-weight: 700; color: #7c2d12;">${Number((report as any).engagedSessions ?? 0).toLocaleString()}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </div>

          <!-- SEO Performance Card -->
          <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
            <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #111827;">
              <span style="display: inline-block; width: 4px; height: 20px; background-color: #10b981; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>
              SEO Performance
            </h2>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
              <tr>
                <td width="25%" align="center" valign="top" style="padding: 8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                    <tr>
                      <td style="padding: 16px; text-align: center;">
                        <div style="font-size: 11px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">Average Position</div>
                        <div style="font-size: 24px; font-weight: 700; color: #111827;">${report.averagePosition != null ? Number(report.averagePosition).toFixed(1) : "0.0"}</div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="25%" align="center" valign="top" style="padding: 8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                    <tr>
                      <td style="padding: 16px; text-align: center;">
                        <div style="font-size: 11px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">Total Clicks</div>
                        <div style="font-size: 24px; font-weight: 700; color: #111827;">${Number(report.totalClicks || 0).toLocaleString()}</div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="25%" align="center" valign="top" style="padding: 8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                    <tr>
                      <td style="padding: 16px; text-align: center;">
                        <div style="font-size: 11px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">Total Impressions</div>
                        <div style="font-size: 24px; font-weight: 700; color: #111827;">${Number(report.totalImpressions || 0).toLocaleString()}</div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="25%" align="center" valign="top" style="padding: 8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                    <tr>
                      <td style="padding: 16px; text-align: center;">
                        <div style="font-size: 11px; font-weight: 600; color: #4b5563; margin-bottom: 4px;">Average CTR</div>
                        <div style="font-size: 24px; font-weight: 700; color: #111827;">${report.averageCtr != null ? (Number(report.averageCtr) * 100).toFixed(2) : "0.00"}%</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </div>

          <!-- Target Keywords Card -->
          <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
            <h2 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; color: #111827;">
              <span style="display: inline-block; width: 4px; height: 20px; background-color: #2563eb; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>
              Target Keywords
            </h2>
            <p style="margin: 0 0 16px 0; font-size: 12px; color: #6b7280;">(Sorted by highest rank)</p>
            ${
              targetKeywords.length === 0
                ? `<div style="padding: 32px; text-align: center; color: #6b7280; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                    <p style="margin: 0;">No target keywords available.</p>
                  </div>`
                : `
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
                        ${targetKeywords
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
                                  ${serp !== "—" ? serp.split(", ").map((feature) => 
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
                `
            }
          </div>

          <!-- Live Dashboard Card -->
          ${
            shareUrl
              ? `<div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
                  <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #111827;">
                    <span style="display: inline-block; width: 4px; height: 20px; background-color: #a855f7; border-radius: 2px; margin-right: 8px; vertical-align: middle;"></span>
                    Live Dashboard
                  </h2>
                  <div style="background-color: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 16px;">
                    <a href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener noreferrer" style="color: #7c3aed; font-weight: 600; text-decoration: underline; word-break: break-all;">
                      ${escapeHtml(shareUrl)}
                    </a>
                  </div>
                </div>`
              : ""
          }
        </div>

        <div style="background-color: #f9fafb; border-top: 1px solid #e5e7eb; padding: 16px; text-align: center;">
          <p style="margin: 0; color: #6b7280; font-size: 12px;">
            This is an automated report generated by SEO Dashboard.
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
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];

    // doc.on('data', (chunk) => chunks.push(chunk));
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    // doc.on('error', (err) => reject(err));
    doc.on("error", (err: Error) => reject(err));

    const periodLabel = report.period.charAt(0).toUpperCase() + report.period.slice(1);
    const reportDate = new Date(report.reportDate).toLocaleDateString();
    const shareUrl = opts?.shareUrl || null;
    const targetKeywords = opts?.targetKeywords || [];
    const defaultMargin = 40;

    doc.fontSize(20).text(`SEO Analytics Report`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).text(`${periodLabel} report for ${client.name}`, { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Client: ${client.name}`);
    if (client.domain) {
      doc.text(`Domain: ${client.domain}`);
    }
    doc.text(`Report date: ${reportDate}`);

    doc.moveDown();
    doc.fontSize(14).text('Traffic Overview');
    doc.moveDown(0.5);
    doc.fontSize(12);
    const webVisitors = (report as any).totalUsers ?? report.activeUsers ?? 0;
    const organicTraffic = (report as any).organicSearchEngagedSessions ?? report.organicSessions ?? 0;
    doc.text(`Web Visitors: ${Number(webVisitors).toLocaleString()}`);
    doc.text(`Organic Traffic: ${Number(organicTraffic).toLocaleString()}`);
    doc.text(`First Time Visitors: ${Number(report.newUsers ?? 0).toLocaleString()}`);
    doc.text(`Engaged Visitors: ${Number((report as any).engagedSessions ?? 0).toLocaleString()}`);

    doc.moveDown();
    doc.fontSize(14).text('SEO Performance');
    doc.moveDown(0.5);
    doc.fontSize(12);
    if (report.averagePosition != null) {
      doc.text(`Average Position: ${Number(report.averagePosition).toFixed(1)}`);
    }
    doc.text(`Total Clicks: ${report.totalClicks?.toLocaleString?.() ?? report.totalClicks ?? 0}`);
    doc.text(`Total Impressions: ${report.totalImpressions?.toLocaleString?.() ?? report.totalImpressions ?? 0}`);
    if (report.averageCtr != null) {
      doc.text(`Average CTR: ${(Number(report.averageCtr) * 100).toFixed(2)}%`);
    }

    if (report.conversions != null && report.conversions > 0) {
      doc.moveDown();
      doc.fontSize(14).text('Conversions');
      doc.moveDown(0.5);
      doc.fontSize(12);
      doc.text(`Conversions: ${report.conversions}`);
      if (report.conversionRate != null) {
        doc.text(`Conversion Rate: ${(Number(report.conversionRate) * 100).toFixed(2)}%`);
      }
    }

    // NOTE: PDFKit link annotations can throw "unsupported number: NaN" on some environments.
    // To keep email sending reliable, render URLs as plain text in the PDF (no clickable links).
    if (isHttpUrl(shareUrl)) {
      doc.moveDown();
      // Avoid underline for long URLs (PDFKit underline path can NaN on some systems)
      doc.fillColor("#1d4ed8").fontSize(11).text(`Live dashboard: ${shareUrl}`);
      doc.fillColor("#000000");
    }

    if (targetKeywords.length > 0) {
      // Put the table on a separate landscape page for readability.
      doc.addPage({ layout: "landscape" });
      doc.fontSize(16).fillColor("#000000").text("Target Keywords");
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
        { key: "google", label: "Google" },
        { key: "change", label: "Change" },
        { key: "serp", label: "SERP Features" },
        { key: "url", label: "Google URL" },
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

      for (const k of targetKeywords) {
        const current = typeof k.googlePosition === "number" ? k.googlePosition : null;
        const prev = typeof k.previousPosition === "number" ? k.previousPosition : null;
        const diff = current != null && prev != null ? prev - current : null; // positive means improved
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

        // Measure row height based on wrapped text.
        let maxH = 0;
        (Object.keys(col) as Array<keyof typeof col>).forEach((key) => {
          const text = (cells as any)[key] as string;
          const h = doc.heightOfString(text, { width: col[key] - rowPaddingX * 2 });
          maxH = Math.max(maxH, h);
        });
        const rowH = Math.max(14, maxH) + rowPaddingY * 2;

        // Pagination
        const pageHeight = safeNumber((doc as any)?.page?.height, 0);
        const marginBottom = safeNumber((doc as any)?.page?.margins?.bottom, defaultMargin);
        const bottomLimit = Math.max(1, pageHeight - marginBottom - 24);
        if (y + rowH > bottomLimit) {
          doc.addPage({ layout: "landscape" });
          doc.fontSize(16).fillColor("#000000").text("Target Keywords");
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

      if (isHttpUrl(shareUrl)) {
        doc.moveDown(1.5);
        // Avoid underline for long URLs (PDFKit underline path can NaN on some systems)
        doc.fillColor("#1d4ed8").fontSize(11).text(`Live dashboard: ${shareUrl}`);
        doc.fillColor("#000000");
      }
    }

    doc.moveDown(2);
    doc.fontSize(10).fillColor('#666').text(
      'This PDF was generated automatically by SEO Dashboard based on the latest available analytics data.',
      { align: 'center' }
    );

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
  if (period === "weekly") {
    // Last 7 days - matches SEO Overview "Last 7 days"
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === "biweekly") {
    // Last 14 days - matches SEO Overview when user selects 14-day equivalent
    startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 14);
  } else if (period === "monthly") {
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
  const totalClicks = keywordClicks > 0
    ? keywordClicks
    : Math.round(trafficSourceSummary?.organicEstimatedTraffic ?? 0);
  const totalImpressions = keywordImpressions > 0
    ? keywordImpressions
    : (trafficSourceSummary?.organicEstimatedTraffic != null
        ? Math.round(trafficSourceSummary.organicEstimatedTraffic * 15)
        : 0);

  // Create report data
  // Traffic Overview aligns with SEO Overview: Web Visitors, Organic Traffic, First Time Visitors, Engaged Visitors
  const reportData = {
    reportDate: endDate,
    period: period,
    status: "draft" as string,
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
    reportData.status = "scheduled";
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

    console.log(`[Report Scheduler] Checking scheduled reports at ${now.toISOString()}`);
    console.log(`[Report Scheduler] Found ${dueSchedules.length} due schedule(s)`);
    
    if (dueSchedules.length === 0) {
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

    for (const schedule of dueSchedules) {
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
        const recipients: string[] = (() => {
          if (!schedule.recipients) return [];
          try {
            const parsed = JSON.parse(String(schedule.recipients));
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })();
        if (recipients && recipients.length > 0) {
          console.log(`[Report Scheduler] Sending emails to: ${recipients.join(", ")}`);
          
          const shareUrl = (() => {
            try {
              return buildShareDashboardUrl(schedule.clientId);
            } catch (err: any) {
              console.warn(
                `[Report Scheduler] Failed to build share URL for client ${schedule.clientId}:`,
                err?.message || err
              );
              return null;
            }
          })();

          const targetKeywords = await getReportTargetKeywords(schedule.clientId).catch((err) => {
            console.warn(
              `[Report Scheduler] Failed to fetch target keywords for client ${schedule.clientId}:`,
              err?.message || err
            );
            return [] as ReportTargetKeywordRow[];
          });

          const emailHtml = generateReportEmailHTML(report, schedule.client, { targetKeywords, shareUrl });
          const emailSubject = schedule.emailSubject || `SEO Report - ${schedule.client.name} - ${schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1)}`;
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
              status: "sent",
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

    console.log(`[Report Scheduler] Finished processing scheduled reports.`);
  } catch (error: any) {
    console.error('[Report Scheduler] Error processing scheduled reports:', error);
    console.error('[Report Scheduler] Error details:', error.message, error.stack);
  }
}

