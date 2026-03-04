const LEGACY_BRAND_PATTERNS: Array<[RegExp, string]> = [
  [/YourSEODashboard/gi, "Your Marketing Dashboard"],
  [/Your SEO Dashboard/gi, "Your Marketing Dashboard"],
  [/SEO Dashboard/gi, "Your Marketing Dashboard"],
  [/Design ME Dashboard/gi, "Your Marketing Dashboard"],
  [/Design ME Marketing/gi, "Your Marketing Dashboard"],
  [/ZOESI/gi, "Your Marketing Dashboard"],
  [/Client Dashboard/gi, "Your Marketing Dashboard"],
  [/Agency Dashboard/gi, "Your Marketing Dashboard"],
];

export const BRAND_DISPLAY_NAME = "Your Marketing Dashboard";
export const BRAND_DEFAULT_FROM_EMAIL = "noreply@yourmarketingdashboard.com";
export type CanonicalReportStatus = "draft" | "scheduled" | "sent";
export type CanonicalReportPeriod = "weekly" | "biweekly" | "monthly";

export const REPORT_SECTION_ORDER = [
  "traffic_overview",
  "seo_performance",
  "money_keywords",
  "topical_keywords",
  "live_dashboard",
] as const;

export const REPORT_SECTION_TITLES: Record<(typeof REPORT_SECTION_ORDER)[number], string> = {
  traffic_overview: "Traffic Overview",
  seo_performance: "SEO Performance",
  money_keywords: "Money Keywords",
  topical_keywords: "Topical Keywords",
  live_dashboard: "Live Dashboard",
};

export function normalizeWhitelabelText(value: unknown): string {
  let text = String(value ?? "");
  for (const [pattern, replacement] of LEGACY_BRAND_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function getWhitelabelFromAddress(): string {
  const rawFrom = String(process.env.SMTP_FROM || "").trim();
  const emailMatch = rawFrom.match(/<([^>]+)>/);
  const configuredFromEmail = (emailMatch?.[1] || rawFrom).trim().toLowerCase();
  const smtpUserEmail = String(process.env.SMTP_USER || "").trim().toLowerCase();
  const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const fromEmail = looksLikeEmail(configuredFromEmail)
    ? configuredFromEmail
    : looksLikeEmail(smtpUserEmail)
      ? smtpUserEmail
      : BRAND_DEFAULT_FROM_EMAIL;
  return `"${BRAND_DISPLAY_NAME}" <${fromEmail}>`;
}

export function parsePeriodDays(input: unknown, fallback = 30): number {
  const parsed = Number.parseInt(String(input ?? ""), 10);
  const allowed = new Set([7, 14, 30, 60, 90]);
  if (!Number.isFinite(parsed) || !allowed.has(parsed)) {
    return fallback;
  }
  return parsed;
}

export function normalizeEmailRecipients(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }
  if (value == null) return [];

  const raw = String(value).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => String(entry || "").trim())
        .filter(Boolean);
    }
  } catch {
    // Not JSON; continue to comma-separated parsing.
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildReportEmailSubject(clientName: string, period: string): string {
  const periodLabel = period.charAt(0).toUpperCase() + period.slice(1);
  return `${BRAND_DISPLAY_NAME} Report - ${clientName} - ${periodLabel}`;
}

export function normalizeReportStatus(status: unknown): CanonicalReportStatus {
  const raw = String(status ?? "").trim().toLowerCase();
  if (raw === "sent") return "sent";
  if (raw === "scheduled") return "scheduled";
  return "draft";
}

export function toDisplayReportStatus(status: unknown): "Sent" | "Scheduled" | "Draft" {
  const normalized = normalizeReportStatus(status);
  if (normalized === "sent") return "Sent";
  if (normalized === "scheduled") return "Scheduled";
  return "Draft";
}

export function normalizeReportPeriod(period: unknown): CanonicalReportPeriod {
  const raw = String(period ?? "").trim().toLowerCase();
  if (raw === "weekly" || raw === "biweekly" || raw === "monthly") {
    return raw;
  }
  return "monthly";
}
