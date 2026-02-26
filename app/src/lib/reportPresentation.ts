export type ReportStatus = "Sent" | "Scheduled" | "Draft";

export function normalizeReportStatus(status: unknown): "sent" | "scheduled" | "draft" {
  const raw = String(status ?? "").trim().toLowerCase();
  if (raw === "sent") return "sent";
  if (raw === "scheduled") return "scheduled";
  return "draft";
}

export function toDisplayReportStatus(status: unknown): ReportStatus {
  const normalized = normalizeReportStatus(status);
  if (normalized === "sent") return "Sent";
  if (normalized === "scheduled") return "Scheduled";
  return "Draft";
}

export function getReportStatusBadgeClass(status: unknown): string {
  const normalized = normalizeReportStatus(status);
  if (normalized === "sent") return "bg-green-100 text-green-800";
  if (normalized === "scheduled") return "bg-blue-100 text-blue-800";
  return "bg-yellow-100 text-yellow-800";
}

export function formatReportPeriodLabel(period: unknown): string {
  const raw = String(period ?? "").trim().toLowerCase();
  if (raw === "biweekly") return "Biweekly";
  if (raw === "weekly") return "Weekly";
  return "Monthly";
}
