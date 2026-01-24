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
    orderBy: [{ searchVolume: "desc" }, { keyword: "asc" }],
  });

  const filtered = allTargetKeywords
    .filter((tk) => trackedKeywordSet.has(normalizeKeywordKey(tk.keyword)))
    .slice(0, 50);

  return filtered.map((tk) => {
    const tracked = trackedByKeyword.get(normalizeKeywordKey(tk.keyword));
    return {
      id: tk.id,
      keyword: tk.keyword,
      locationName: tk.locationName ? normalizeLocationName(tk.locationName) : tk.locationName,
      createdAt: tk.createdAt,
      googlePosition: (tk as any).googlePosition ?? tracked?.currentPosition ?? null,
      previousPosition: (tk as any).previousPosition ?? tracked?.previousPosition ?? null,
      serpItemTypes: (tk as any).serpItemTypes,
      googleUrl: (tk as any).googleUrl ?? tracked?.googleUrl ?? null,
    };
  });
}

export function buildShareDashboardUrl(clientId: string): string | null {
  const frontendUrlRaw = process.env.FRONTEND_URL || "";
  const frontendUrl = frontendUrlRaw.replace(/\/+$/, "");
  if (!frontendUrl) return null;

  const secret = process.env.JWT_SECRET || "change_me_secret";
  const token = jwt.sign(
    { type: "client_share", clientId, issuedBy: "report_scheduler" },
    secret,
    { expiresIn: "7d" }
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
  const targetKeywords = opts?.targetKeywords || [];

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SEO Report - ${safeClientName}</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.35; color: #111827; max-width: 900px; margin: 0 auto; padding: 24px;">
      <div style="text-align:center;">
        <h1 style="margin: 0; font-size: 24px;">SEO Analytics Report</h1>
        <p style="margin: 6px 0 0 0; font-size: 14px; color: #374151;">${escapeHtml(periodLabel)} report for ${safeClientName}</p>
      </div>

      <div style="margin-top: 16px; font-size: 13px;">
        <p style="margin: 0;"><strong>Client:</strong> ${safeClientName}</p>
        ${safeDomain ? `<p style="margin: 0;"><strong>Domain:</strong> ${safeDomain}</p>` : ""}
        <p style="margin: 0;"><strong>Report date:</strong> ${escapeHtml(reportDate)}</p>
      </div>

      <h2 style="margin: 18px 0 6px 0; font-size: 15px; text-decoration: underline;">Traffic Overview</h2>
      <div style="font-size: 13px;">
        <div>Total Sessions: ${Number(report.totalSessions || 0).toLocaleString()}</div>
        <div>Organic Sessions: ${Number(report.organicSessions || 0).toLocaleString()}</div>
        ${report.activeUsers != null ? `<div>Active Users: ${Number(report.activeUsers || 0).toLocaleString()}</div>` : ""}
        ${report.newUsers != null ? `<div>New Users: ${Number(report.newUsers || 0).toLocaleString()}</div>` : ""}
        ${report.eventCount != null ? `<div>Event Count: ${Number(report.eventCount || 0).toLocaleString()}</div>` : ""}
        ${report.keyEvents != null ? `<div>Key Events: ${Number(report.keyEvents || 0).toLocaleString()}</div>` : ""}
      </div>

      <h2 style="margin: 18px 0 6px 0; font-size: 15px; text-decoration: underline;">SEO Performance</h2>
      <div style="font-size: 13px;">
        <div>Average Position: ${report.averagePosition != null ? Number(report.averagePosition).toFixed(1) : "0.0"}</div>
        <div>Total Clicks: ${Number(report.totalClicks || 0).toLocaleString()}</div>
        <div>Total Impressions: ${Number(report.totalImpressions || 0).toLocaleString()}</div>
        <div>Average CTR: ${report.averageCtr != null ? (Number(report.averageCtr) * 100).toFixed(2) : "0.00"}%</div>
      </div>

      <h2 style="margin: 18px 0 8px 0; font-size: 15px; text-decoration: underline;">Target Keywords</h2>
      ${
        targetKeywords.length === 0
          ? `<div style="font-size: 13px; color: #4b5563;">No target keywords available.</div>`
          : `
            <div style="overflow-x:auto;">
              <table style="border-collapse: collapse; width: 100%; font-size: 12px;">
                <thead>
                  <tr>
                    <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left; background:#f9fafb;">Keyword</th>
                    <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left; background:#f9fafb;">Location</th>
                    <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left; background:#f9fafb;">Date Added</th>
                    <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left; background:#f9fafb;">Google</th>
                    <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left; background:#f9fafb;">Google Change</th>
                    <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left; background:#f9fafb;">Google SERP Features</th>
                    <th style="border: 1px solid #e5e7eb; padding: 6px; text-align: left; background:#f9fafb;">Google URL</th>
                  </tr>
                </thead>
                <tbody>
                  ${targetKeywords
                    .map((k) => {
                      const current = typeof k.googlePosition === "number" ? k.googlePosition : null;
                      const prev = typeof k.previousPosition === "number" ? k.previousPosition : null;
                      const diff = current != null && prev != null ? prev - current : null; // positive means improved
                      const diffText = diff == null ? "—" : diff === 0 ? "0" : diff > 0 ? `+${diff}` : `${diff}`;
                      const dateAdded = k.createdAt ? new Date(k.createdAt as any).toLocaleDateString() : "—";
                      const serp = toStringArray(k.serpItemTypes).slice(0, 3).join(", ") || "—";
                      const urlCell = k.googleUrl
                        ? `<a href="${escapeHtml(k.googleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(k.googleUrl)}</a>`
                        : "—";
                      return `
                        <tr>
                          <td style="border: 1px solid #e5e7eb; padding: 6px;">${escapeHtml(k.keyword)}</td>
                          <td style="border: 1px solid #e5e7eb; padding: 6px;">${escapeHtml(k.locationName || "United States")}</td>
                          <td style="border: 1px solid #e5e7eb; padding: 6px;">${escapeHtml(dateAdded)}</td>
                          <td style="border: 1px solid #e5e7eb; padding: 6px;">${current != null ? escapeHtml(current) : "—"}</td>
                          <td style="border: 1px solid #e5e7eb; padding: 6px;">${escapeHtml(diffText)}</td>
                          <td style="border: 1px solid #e5e7eb; padding: 6px;">${escapeHtml(serp)}</td>
                          <td style="border: 1px solid #e5e7eb; padding: 6px; word-break: break-all;">${urlCell}</td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>
          `
      }

      ${
        shareUrl
          ? `<div style="margin-top: 18px; font-size: 13px;">
              <strong>Live dashboard:</strong> <a href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shareUrl)}</a>
            </div>`
          : ""
      }

      <p style="text-align: center; color: #6b7280; font-size: 12px; margin-top: 22px;">
        This is an automated report generated by SEO Dashboard.
      </p>
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
    doc.text(`Total Sessions: ${report.totalSessions?.toLocaleString?.() ?? report.totalSessions ?? 0}`);
    doc.text(`Organic Sessions: ${report.organicSessions?.toLocaleString?.() ?? report.organicSessions ?? 0}`);
    if (report.activeUsers != null) doc.text(`Active Users: ${report.activeUsers}`);
    if (report.newUsers != null) doc.text(`New Users: ${report.newUsers}`);
    if (report.eventCount != null) doc.text(`Event Count: ${report.eventCount}`);
    if (report.keyEvents != null) doc.text(`Key Events: ${report.keyEvents}`);

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
          url: k.googleUrl ? String(k.googleUrl) : "—",
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
          if (key === "url" && isHttpUrl(k.googleUrl)) {
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

  // Calculate date range based on period
  const endDate = new Date();
  const startDate = new Date();
  
  if (period === "weekly") {
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === "biweekly") {
    startDate.setDate(startDate.getDate() - 14);
  } else if (period === "monthly") {
    startDate.setMonth(startDate.getMonth() - 1);
  } else {
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

  // Create report data
  const reportData = {
    reportDate: endDate,
    period: period,
    status: "draft" as string,
    totalSessions: Math.round(ga4Data?.totalSessions || trafficSourceSummary?.totalEstimatedTraffic || 0),
    organicSessions: Math.round(ga4Data?.organicSessions || trafficSourceSummary?.organicEstimatedTraffic || 0),
    paidSessions: 0,
    directSessions: 0,
    referralSessions: 0,
    totalClicks: keywordStats._sum.clicks || 0,
    totalImpressions: keywordStats._sum.impressions || 0,
    averageCtr: keywordStats._avg.ctr || 0,
    averagePosition: trafficSourceSummary?.averageRank || keywordStats._avg.currentPosition || 0,
    bounceRate: ga4Data?.bounceRate || 0,
    avgSessionDuration: ga4Data?.avgSessionDuration || 0,
    pagesPerSession: ga4Data?.pagesPerSession || 0,
    conversions: Math.round(ga4Data?.conversions || 0),
    conversionRate: ga4Data?.conversionRate || 0,
    activeUsers: Math.round(ga4Data?.activeUsers || 0),
    eventCount: Math.round(ga4Data?.eventCount || 0),
    newUsers: Math.round(ga4Data?.newUsers || 0),
    keyEvents: Math.round(ga4Data?.keyEvents || 0),
  };

  // Upsert report (one report per client)
  // Use findFirst instead of findUnique(clientId) to be compatible with older Prisma clients
  const existing = await prisma.seoReport.findFirst({
    where: { clientId }
  });

  // Check if there's an active schedule for this client
  const activeSchedule = await prisma.reportSchedule.findFirst({
    where: {
      clientId,
      isActive: true
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
    
    // Find all clients with GA4 connected
    const connectedClients = await prisma.client.findMany({
      where: {
        ga4RefreshToken: { not: null },
        ga4PropertyId: { not: null },
        ga4ConnectedAt: { not: null }
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
    
    // Find all active schedules that are due
    const dueSchedules = await prisma.reportSchedule.findMany({
      where: {
        isActive: true,
        nextRunAt: {
          lte: now
        }
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

