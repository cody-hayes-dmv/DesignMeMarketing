import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, BarChart, Bar } from "recharts";
import {
  FileText,
  Download,
  Share2,
  TrendingUp,
  TrendingDown,
  Search,
  Users,
  UserPlus,
  Activity,
  Clock,
  Plus,
  Trash2,
  ArrowLeft,
  Upload,
  RefreshCw,
  Loader2,
  X,
  Eye,
  Edit,
  Send,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  MoreVertical,
  EyeOff,
  Sparkles,
  Trophy,
  Lightbulb,
  Info,
  Target,
  Plug,
  Image,
  Video,
  Link as LinkIcon,
  Calendar,
  Repeat,
  Play,
  StopCircle,
  Globe,
  ExternalLink,
  Building2,
  DollarSign,
  BookOpen,
  MapPin,
} from "lucide-react";
import api, { getUploadFileUrl } from "@/lib/api";
import {
  AccuracyEnvelope,
  formatUnavailableReason,
  formatUnavailableSource,
  getUnavailableMetricInfo,
  normalizeDashboardSummaryPayload,
} from "@/lib/metricAccuracy";
import { Client, updateClient } from "@/store/slices/clientSlice";
import { clientToFormState, formStateToUpdatePayload } from "@/lib/clientAccountForm";
import ClientAccountFormModal, { EMPTY_CLIENT_FORM } from "@/components/ClientAccountFormModal";
import { endOfWeek, format, startOfWeek, subDays } from "date-fns";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import toast from "react-hot-toast";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { logout } from "@/store/slices/authSlice";
import { checkAuth } from "@/store/slices/authSlice";
import RankedKeywordsOverview from "@/components/RankedKeywordsOverview";
import TargetKeywordsOverview from "@/components/TargetKeywordsOverview";
import ConfirmDialog from "@/components/ConfirmDialog";
import OnboardingTemplateModal from "@/components/OnboardingTemplateModal";
import ClientKeywordsManager from "@/components/ClientKeywordsManager";
import WorkLogRecurringModal from "@/components/WorkLogRecurringModal";
import type { WorkLogRecurringRuleForEdit } from "@/components/WorkLogRecurringModal";
import InfoTooltip from "@/components/InfoTooltip";
import GoogleBusinessSearch, { type GoogleBusinessSelection } from "@/components/GoogleBusinessSearch";
import { formatReportPeriodLabel, getReportStatusBadgeClass, toDisplayReportStatus } from "@/lib/reportPresentation";
import WebDesignWorkspace from "@/components/WebDesignWorkspace";

interface TrafficSourceSlice {
  name: string;
  value: number;
  color: string;
}

type ReportTargetKeywordRow = {
  id: string;
  keyword: string;
  locationName: string | null;
  createdAt: string;
  googlePosition: number | null;
  previousPosition: number | null;
  serpItemTypes: unknown;
  googleUrl: string | null;
  type?: "money" | "topical";
};

const BACKLINKS_PAGE_SIZES = [25, 50, 100, 250] as const;
const WORKLOG_PAGE_SIZES = [25, 50, 100, 250] as const;

/** Dashboard API can be slow (DataForSEO + GA4); use 2 min and retry once on timeout to reduce "Request timed out" toasts. */
const DASHBOARD_REQUEST_TIMEOUT_MS = 120000;

interface ClientReport {
  id: string;
  name: string;
  type: string;
  lastGenerated: string;
  status: "Sent" | "Draft" | "Scheduled";
  recipients: string[];
  metrics: {
    keywords: number;
    avgPosition: number;
    traffic: number;
  };
  clientId: string;
  scheduleKind?: "seo" | "local_map" | "ppc" | "campaign_wins";
}

type TaskStatus = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE" | "NEEDS_APPROVAL" | "CANCELLED";
type ActivityType = "COMMENT" | "QUESTION" | "APPROVAL_REQUEST" | "APPROVAL" | "REVISION_REQUEST";
type WorkLogComment = {
  id: string;
  body: string;
  type: ActivityType;
  createdAt: string;
  author?: {
    id: string;
    name?: string | null;
    email?: string | null;
    role?: string | null;
  } | null;
};
type WorkLogTask = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: TaskStatus;
  proof?: string | null;
  createdAt: string;
  updatedAt: string;
  assignee?: { id: string; name?: string | null; email: string } | null;
  createdBy?: { id: string; name?: string | null; email: string; role?: string | null } | null;
};

type BacklinkFilter = "all" | "new" | "natural" | "manual";
type BacklinkRow = {
  id: string;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string | null;
  domainRating: number | null;
  urlRating: number | null;
  traffic: number | null;
  isFollow: boolean;
  isLost: boolean;
  firstSeen: string | null;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
};

type AiSearchVisibilityRow = {
  name: "ChatGPT" | "AI Overview" | "AI Mode" | "Gemini";
  visibility: number;
  mentions: number;
  citedPages: number;
};

interface TopPageItem {
  url: string;
  keywords: number;
  estimatedTraffic: number;
  top1: number;
  top3: number;
  top10: number;
  newKeywords: number;
  upKeywords: number;
  downKeywords: number;
  lostKeywords: number;
  paidTraffic: number;
}

type LocalMapKeywordRow = {
  id: string;
  keywordText: string;
  businessName: string;
  businessAddress: string | null;
  status: "active" | "paused" | "canceled";
  latestAta: number | null;
  previousAta: number | null;
  trend: number | null;
  lastRunDate: string | null;
};

type LocalMapSnapshotReportRow = {
  id: string;
  runDate: string;
  ataScore: number;
  isBenchmark: boolean;
  gridData: string;
};

type LocalMapKeywordReportPayload = {
  keyword: {
    id: string;
    keywordText: string;
    businessName: string;
    businessAddress: string | null;
  };
  current: LocalMapSnapshotReportRow | null;
  previousThree: LocalMapSnapshotReportRow[];
  benchmark: LocalMapSnapshotReportRow | null;
  snapshots: LocalMapSnapshotReportRow[];
  trend: Array<{ runDate: string; ataScore: number }>;
};

interface TrendPoint {
  date: string;
  value: number;
}

interface DashboardSummary {
  totalSessions: number | null;
  organicSessions: number | null;
  averagePosition: number | null;
  conversions: number | null;
  organicSearchEngagedSessions?: number | null;
  // New GA4 metrics
  activeUsers: number | null;
  eventCount: number | null;
  newUsers: number | null;
  keyEvents: number | null;
  activeUsersTrend?: TrendPoint[];
  // Backward compatibility (deprecated)
  totalUsers: number | null;
  firstTimeVisitors: number | null;
  engagedVisitors: number | null;
  engagedSessions: number | null;
  dataSources?: {
    traffic?: string;
    conversions?: string;
  };
  trafficSourceSummary?: {
    breakdown: Array<{ name: string; value: number }>;
    totalKeywords: number;
    totalEstimatedTraffic: number;
    organicEstimatedTraffic: number;
    averageRank: number | null;
    rankSampleSize: number;
  } | null;
  latestReport?: any;
  keywordStats?: any;
  backlinkStats?: any;
  topKeywords?: any[];
  newUsersTrend?: TrendPoint[];
  totalUsersTrend?: TrendPoint[];
  ga4Events?: Array<{
    name: string;
    count: number;
    change?: string;
  }> | null;
  ga4LastUpdated?: string | null;
  dataForSeoLastUpdated?: string | null;
  accuracy?: AccuracyEnvelope;
}

const TRAFFIC_SOURCE_COLORS: Record<string, string> = {
  Organic: "#10B981",
  Direct: "#3B82F6",
  Referral: "#F59E0B",
  Paid: "#EF4444",
  Other: "#6366F1",
};

const LOCAL_MAP_SCHEDULE_PREFIX = "[LOCAL_MAP] ";
const PPC_SCHEDULE_PREFIX = "[PPC] ";

type LocalMapGridCell = { rank: number | null; competitors: string[] };

const parseLocalMapGridData = (raw: string): LocalMapGridCell[] => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: any) => ({
      rank: item?.rank == null ? null : Number(item.rank),
      competitors: Array.isArray(item?.competitors)
        ? item.competitors.filter((entry: unknown): entry is string => typeof entry === "string").slice(0, 3)
        : [],
    }));
  } catch {
    return [];
  }
};

const localMapCellClass = (rank: number | null): string => {
  if (rank != null && rank >= 1 && rank <= 3) return "bg-emerald-500 text-white";
  if (rank != null && rank >= 4 && rank <= 10) return "bg-yellow-300 text-yellow-900";
  if (rank != null && rank >= 11 && rank <= 20) return "bg-orange-300 text-orange-900";
  return "bg-rose-300 text-rose-900";
};

const getTopCompetitorsFromCells = (cells: LocalMapGridCell[]): string[] => {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    for (const name of cell.competitors) {
      const normalized = String(name || "").trim();
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
};

const safeFormatLocalMapDate = (
  value: string | Date | null | undefined,
  pattern: string = "MMM d, yyyy",
  fallback: string = "N/A"
): string => {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  try {
    return format(date, pattern);
  } catch {
    return fallback;
  }
};

const escapeLocalMapEmailHtml = (value: string): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildLocalMapEmailHtmlFromReport = (
  report: LocalMapKeywordReportPayload,
  clientName: string
): string => {
  const keyword = report.keyword;
  const current = report.current;
  const previousThree = report.previousThree || [];
  const benchmark = report.benchmark;
  const heatCellStyle = (rank: number | null): { bg: string; color: string } => {
    if (rank != null && rank >= 1 && rank <= 3) return { bg: "#10b981", color: "#ffffff" };
    if (rank != null && rank >= 4 && rank <= 10) return { bg: "#fde047", color: "#713f12" };
    if (rank != null && rank >= 11 && rank <= 20) return { bg: "#fdba74", color: "#7c2d12" };
    return { bg: "#fda4af", color: "#881337" };
  };
  const renderGrid = (snapshot: LocalMapSnapshotReportRow, options?: { compact?: boolean }): string => {
    const cells = parseLocalMapGridData(snapshot.gridData);
    const size = Math.max(1, Math.round(Math.sqrt(cells.length || 1)));
    const centerIdx = Math.floor(size / 2) * size + Math.floor(size / 2);
    const competitors = getTopCompetitorsFromCells(cells);
    const cellPadding = options?.compact ? "5px 0" : "7px 0";
    const cellFontSize = options?.compact ? "10px" : "11px";
    const rows = Array.from({ length: size }).map((_, rowIdx) => {
      const cols = Array.from({ length: size }).map((__, colIdx) => {
        const pointIdx = rowIdx * size + colIdx;
        const point = cells[pointIdx];
        const rank = point?.rank ?? null;
        const isCenter = pointIdx === centerIdx;
        const style = heatCellStyle(rank);
        return `<td style="border:1px solid #ffffff; background:${style.bg}; color:${style.color}; text-align:center; font-weight:700; font-size:${cellFontSize}; padding:${cellPadding}; width:${Math.round(100 / size)}%;">${isCenter ? "&#128205; " : ""}${rank == null ? "NR" : rank}</td>`;
      });
      return `<tr>${cols.join("")}</tr>`;
    });
    return `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; table-layout: fixed;">
        ${rows.join("")}
      </table>
      ${
        options?.compact
          ? ""
          : `<p style="margin:10px 0 0; font-size:12px; color:#4b5563;"><strong>Top 3 Competitors:</strong> ${competitors.length ? competitors.map((name) => escapeLocalMapEmailHtml(name)).join(", ") : "No competitor names captured for this run."}</p>`
      }
    `;
  };
  const trendRows = (report.trend || []).map((point) => {
    const runDate = escapeLocalMapEmailHtml(safeFormatLocalMapDate(point.runDate, "MMM d, yyyy", "-"));
    const ata = Number(point.ataScore);
    return `
      <tr>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb;">${runDate}</td>
        <td style="padding: 8px 10px; border-bottom: 1px solid #e5e7eb; font-weight: 700; color: #065f46;">${Number.isFinite(ata) ? ata.toFixed(2) : "-"}</td>
      </tr>
    `;
  });
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Local Map Rankings Report</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827; background: #f3f4f6; margin: 0; padding: 24px;">
        <div style="max-width: 880px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden;">
          <div style="padding: 20px; background: linear-gradient(90deg, #4f46e5, #06b6d4); color: #fff;">
            <h2 style="margin: 0 0 6px;">Local Map Rankings Report</h2>
            <p style="margin: 0; color: #dbeafe; font-size: 13px;">
              ${escapeLocalMapEmailHtml(clientName || "Client")} • ${escapeLocalMapEmailHtml(keyword.keywordText)} • ${escapeLocalMapEmailHtml(keyword.businessName)}
            </p>
          </div>
          <div style="padding: 18px;">
            <div style="border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; background: #f8fafc; margin-bottom: 14px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 4px 8px 4px 0; vertical-align: top;">
                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280;">Keyword</p>
                    <p style="margin: 2px 0 8px; font-size: 14px; font-weight: 700; color: #111827;">${escapeLocalMapEmailHtml(keyword.keywordText)}</p>
                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280;">Business</p>
                    <p style="margin: 2px 0 8px; font-size: 13px; color: #1f2937;">${escapeLocalMapEmailHtml(keyword.businessName)}</p>
                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280;">Location</p>
                    <p style="margin: 2px 0 0; font-size: 13px; color: #1f2937;">${escapeLocalMapEmailHtml(keyword.businessAddress || "N/A")}</p>
                  </td>
                  <td style="width: 165px; vertical-align: top;">
                    <div style="border: 1px solid #bbf7d0; border-radius: 8px; background: #ecfdf5; padding: 10px;">
                      <p style="margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #047857; font-weight: 700;">Current ATA</p>
                      <p style="margin: 0; font-size: 28px; font-weight: 700; color: #065f46;">${current ? Number(current.ataScore).toFixed(2) : "-"}</p>
                      <p style="margin: 6px 0 0; font-size: 11px; color: #065f46;">${escapeLocalMapEmailHtml(safeFormatLocalMapDate(current?.runDate, "MMM d, yyyy", "Not run yet"))}</p>
                    </div>
                  </td>
                </tr>
              </table>
              <p style="margin: 10px 0 0; font-size: 12px; color: #6b7280;">ATA = average of all 49 grid positions; missing ranks are counted as 20. Lower ATA is better.</p>
            </div>
            <h3 style="margin: 0 0 8px; font-size: 14px; color: #111827;">ATA Score Trend</h3>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; margin-bottom: 14px;">
              <thead><tr style="background: #f9fafb;"><th align="left" style="padding: 8px 10px; font-size: 12px; color: #374151;">Run Date</th><th align="left" style="padding: 8px 10px; font-size: 12px; color: #374151;">ATA</th></tr></thead>
              <tbody>${trendRows.join("") || `<tr><td colspan="2" style="padding: 10px; color: #6b7280;">No trend data yet.</td></tr>`}</tbody>
            </table>
            ${
              current
                ? `<h3 style="margin: 0 0 8px; font-size: 14px; color: #111827;">Current</h3>
                   <div style="border: 2px solid #c7d2fe; border-radius: 10px; background: #eef2ff; padding: 10px; margin-bottom: 14px;">
                     <p style="margin: 0 0 8px; font-size: 12px; color: #4338ca; font-weight: 700;">
                       ${escapeLocalMapEmailHtml(safeFormatLocalMapDate(current.runDate, "MMM d, yyyy", "-"))} • ATA ${Number(current.ataScore).toFixed(2)}
                     </p>
                     ${renderGrid(current)}
                   </div>`
                : `<p style="margin: 0 0 14px; font-size: 12px; color: #6b7280;">No current grid snapshot available.</p>`
            }
            <h3 style="margin: 0 0 8px; font-size: 14px; color: #111827;">Previous 3 Runs</h3>
            ${
              previousThree.length
                ? previousThree
                    .map(
                      (snap) => `
                        <div style="border: 1px solid #ddd6fe; border-radius: 10px; background: #faf5ff; padding: 10px; margin-bottom: 10px;">
                          <p style="margin: 0 0 8px; font-size: 12px; color: #5b21b6; font-weight: 700;">
                            ${escapeLocalMapEmailHtml(safeFormatLocalMapDate(snap.runDate, "MMM d, yyyy", "-"))} • ATA ${Number(snap.ataScore).toFixed(2)}
                          </p>
                          ${renderGrid(snap, { compact: true })}
                        </div>
                      `
                    )
                    .join("")
                : `<p style="margin: 0 0 14px; font-size: 12px; color: #6b7280;">No previous runs yet.</p>`
            }
            ${
              benchmark
                ? `<div style="border: 1px solid #fcd34d; border-radius: 10px; background: #fffbeb; padding: 12px; margin-bottom: 10px;">
                    <p style="margin: 0 0 8px; font-size: 12px; font-weight: 700; color: #92400e;">Your Benchmark</p>
                    <p style="margin: 0 0 8px; font-size: 12px; color: #b45309;">
                      ${escapeLocalMapEmailHtml(safeFormatLocalMapDate(benchmark.runDate, "MMM d, yyyy", "-"))} • ATA ${Number(benchmark.ataScore).toFixed(2)}
                    </p>
                    ${renderGrid(benchmark, { compact: true })}
                  </div>`
                : ""
            }
            <p style="margin: 0 0 8px; font-size: 12px; color: #6b7280;">Heat map colors: 1-3 (Green), 4-10 (Yellow), 11-20 (Orange), Not ranked / 20+ (Red).</p>
            <p style="margin: 0; font-size: 12px; color: #6b7280;">The attached PDF is exported from the Local Map report view.</p>
          </div>
        </div>
      </body>
    </html>
  `;
};

const buildPpcEmailHtmlFromReport = (
  reportData: any,
  clientName: string
): string => {
  const data = reportData?.data ?? {};
  const summary = data?.summary ?? {};
  const conversionsSummary = data?.conversionsSummary ?? {};
  const campaigns = Array.isArray(data?.campaigns) ? data.campaigns : [];
  const adGroups = Array.isArray(data?.adGroups) ? data.adGroups : [];
  const keywords = Array.isArray(data?.keywords) ? data.keywords : [];
  const conversions = Array.isArray(data?.conversions) ? data.conversions : [];
  const esc = (value: unknown) => escapeLocalMapEmailHtml(String(value ?? ""));
  const fmtInt = (value: unknown) => Number(value ?? 0).toLocaleString();
  const fmtMoney = (value: unknown) =>
    `$${Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (value: unknown, digits = 2) => `${Number(value ?? 0).toFixed(digits)}%`;

  const campaignRows = campaigns
    .map((row: any) => {
      const clicks = Number(row?.clicks ?? 0);
      const impressions = Number(row?.impressions ?? 0);
      const conversionsCount = Number(row?.conversions ?? 0);
      const cost = Number(row?.cost ?? 0);
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const convRate = clicks > 0 ? (conversionsCount / clicks) * 100 : 0;
      const costPerConv = conversionsCount > 0 ? cost / conversionsCount : 0;
      return `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(row?.name || "N/A")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtInt(clicks)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtInt(impressions)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtPct(ctr)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtInt(conversionsCount)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtPct(convRate)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtMoney(cost)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtMoney(row?.avgCpc)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtMoney(costPerConv)}</td>
        </tr>
      `;
    })
    .join("");
  const adGroupRows = adGroups
    .map((row: any) => {
      const clicks = Number(row?.clicks ?? 0);
      const impressions = Number(row?.impressions ?? 0);
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      return `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(row?.name || "N/A")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(row?.campaignName || "N/A")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtInt(row?.clicks)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtInt(row?.impressions)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtPct(ctr)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtInt(row?.conversions)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtMoney(row?.cost)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtMoney(row?.avgCpc)}</td>
        </tr>
      `;
    })
    .join("");
  const keywordRows = keywords
    .map((row: any) => {
      const impressions = Number(row?.impressions ?? 0);
      const clicks = Number(row?.clicks ?? 0);
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      return `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(row?.keyword || "N/A")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(row?.matchType || "UNKNOWN")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(row?.campaignName || "N/A")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtInt(row?.clicks)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtInt(row?.impressions)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtPct(ctr)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtPct(Number(row?.impressionShare ?? 0) * 100, 1)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtInt(row?.conversions)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtMoney(row?.cost)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtMoney(row?.avgCpc)}</td>
        </tr>
      `;
    })
    .join("");
  const conversionRows = conversions
    .map((row: any) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(row?.date ? new Date(row.date).toLocaleDateString() : "N/A")}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(row?.conversionAction || "N/A")}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${esc(row?.campaignName || "N/A")}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtInt(row?.conversions)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtMoney(row?.conversionValue)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtInt(row?.clicks)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtMoney(row?.cost)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${fmtMoney(row?.costPerConversion)}</td>
      </tr>
    `)
    .join("");
  return `
    <!DOCTYPE html>
    <html>
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>PPC Analytics Report</title></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827; background: #f3f4f6; margin: 0; padding: 24px;">
        <div style="max-width: 980px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden;">
          <div style="padding: 20px; background: linear-gradient(90deg, #2563eb, #1d4ed8); color: #fff;">
            <h2 style="margin: 0 0 6px;">PPC Analytics Report</h2>
            <p style="margin: 0; color: #dbeafe; font-size: 13px;">${esc(clientName || "Client")}</p>
          </div>
          <div style="padding: 18px;">
            <h3 style="margin: 0 0 10px; font-size: 14px;">Campaign Performance Overview</h3>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; margin-bottom: 12px;">
              <tr>
                <td style="padding: 8px; border: 1px solid #dbeafe; background: #eff6ff;"><strong>Clicks:</strong> ${fmtInt(summary?.clicks)}</td>
                <td style="padding: 8px; border: 1px solid #dbeafe; background: #eef2ff;"><strong>Impressions:</strong> ${fmtInt(summary?.impressions)}</td>
                <td style="padding: 8px; border: 1px solid #d1fae5; background: #ecfdf5;"><strong>Conversions:</strong> ${fmtInt(summary?.conversions)}</td>
                <td style="padding: 8px; border: 1px solid #e9d5ff; background: #faf5ff;"><strong>Cost:</strong> ${fmtMoney(summary?.cost)}</td>
              </tr>
            </table>

            <h3 style="margin: 12px 0 8px; font-size: 14px;">Campaigns</h3>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; border: 1px solid #e5e7eb; margin-bottom: 12px;"><thead><tr style="background:#f9fafb;"><th align="left" style="padding:8px 10px;">Campaign</th><th align="right" style="padding:8px 10px;">Clicks</th><th align="right" style="padding:8px 10px;">Impr.</th><th align="right" style="padding:8px 10px;">CTR</th><th align="right" style="padding:8px 10px;">Conv.</th><th align="right" style="padding:8px 10px;">Conv. Rate</th><th align="right" style="padding:8px 10px;">Cost</th><th align="right" style="padding:8px 10px;">Avg CPC</th><th align="right" style="padding:8px 10px;">Cost/Conv.</th></tr></thead><tbody>${campaignRows || `<tr><td colspan="9" style="padding:10px;color:#6b7280;">No campaign data available.</td></tr>`}</tbody></table>

            <h3 style="margin: 12px 0 8px; font-size: 14px;">Ad Groups</h3>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; border: 1px solid #e5e7eb; margin-bottom: 12px;"><thead><tr style="background:#f9fafb;"><th align="left" style="padding:8px 10px;">Ad Group</th><th align="left" style="padding:8px 10px;">Campaign</th><th align="right" style="padding:8px 10px;">Clicks</th><th align="right" style="padding:8px 10px;">Impr.</th><th align="right" style="padding:8px 10px;">CTR</th><th align="right" style="padding:8px 10px;">Conv.</th><th align="right" style="padding:8px 10px;">Cost</th><th align="right" style="padding:8px 10px;">Avg CPC</th></tr></thead><tbody>${adGroupRows || `<tr><td colspan="8" style="padding:10px;color:#6b7280;">No ad group data available.</td></tr>`}</tbody></table>

            <h3 style="margin: 12px 0 8px; font-size: 14px;">Keywords</h3>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; border: 1px solid #e5e7eb; margin-bottom: 12px;"><thead><tr style="background:#f9fafb;"><th align="left" style="padding:8px 10px;">Keyword</th><th align="left" style="padding:8px 10px;">Match Type</th><th align="left" style="padding:8px 10px;">Campaign</th><th align="right" style="padding:8px 10px;">Clicks</th><th align="right" style="padding:8px 10px;">Impr.</th><th align="right" style="padding:8px 10px;">CTR</th><th align="right" style="padding:8px 10px;">Imp. Share</th><th align="right" style="padding:8px 10px;">Conv.</th><th align="right" style="padding:8px 10px;">Cost</th><th align="right" style="padding:8px 10px;">Avg CPC</th></tr></thead><tbody>${keywordRows || `<tr><td colspan="10" style="padding:10px;color:#6b7280;">No keyword data available.</td></tr>`}</tbody></table>

            <h3 style="margin: 12px 0 8px; font-size: 14px;">Conversions</h3>
            <p style="margin: 0 0 8px; font-size: 12px; color:#4b5563;">
              <strong>Total Conversions:</strong> ${fmtInt(conversionsSummary?.totalConversions)} &nbsp;•&nbsp;
              <strong>Conversion Value:</strong> ${fmtMoney(conversionsSummary?.conversionValue)} &nbsp;•&nbsp;
              <strong>Conversion Rate:</strong> ${fmtPct(conversionsSummary?.conversionRate)}
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; border: 1px solid #e5e7eb;"><thead><tr style="background:#f9fafb;"><th align="left" style="padding:8px 10px;">Date</th><th align="left" style="padding:8px 10px;">Action</th><th align="left" style="padding:8px 10px;">Campaign</th><th align="right" style="padding:8px 10px;">Conversions</th><th align="right" style="padding:8px 10px;">Value</th><th align="right" style="padding:8px 10px;">Clicks</th><th align="right" style="padding:8px 10px;">Cost</th><th align="right" style="padding:8px 10px;">Cost/Conv.</th></tr></thead><tbody>${conversionRows || `<tr><td colspan="8" style="padding:10px;color:#6b7280;">No conversion data available.</td></tr>`}</tbody></table>
            <p style="margin:10px 0 0; font-size:12px; color:#6b7280;">The attached PDF matches the PPC report preview export.</p>
          </div>
        </div>
      </body>
    </html>
  `;
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to encode PDF"));
    reader.readAsDataURL(blob);
  });


/** Format ISO date as "Last updated X hours ago" for DataForSEO/GA4 timestamps */
const formatLastUpdatedHours = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return null;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours === 0) return "Last updated less than 1 hour ago";
  return `Last updated ${hours} hour${hours !== 1 ? "s" : ""} ago`;
};

/** Format percent change for "Compare To"; use decimals when |change| < 10% */
const formatPercentChange = (current: number, previous: number): { text: string; isPositive: boolean } => {
  if (previous === 0) return { text: current > 0 ? "+100%" : "0%", isPositive: current >= 0 };
  const pct = ((current - previous) / previous) * 100;
  const isPositive = pct >= 0;
  const abs = Math.abs(pct);
  const text = abs < 10 && abs !== 0 ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : `${pct >= 0 ? "+" : ""}${Math.round(pct)}%`;
  return { text, isPositive };
};

const formatDashboardSummary = (payload: any): DashboardSummary =>
  normalizeDashboardSummaryPayload(payload) as DashboardSummary;

type SortDirection = "asc" | "desc";
type PpcSortConfig = { key: string; direction: SortDirection };

function sortPpcRows<T>(
  rows: T[],
  sort: PpcSortConfig,
  getValue: (row: T, key: string) => unknown
): T[] {
  const data = Array.isArray(rows) ? [...rows] : [];
  const dir = sort.direction === "asc" ? 1 : -1;
  data.sort((a, b) => {
    const av = getValue(a, sort.key);
    const bv = getValue(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * dir;
    }
    const ad = av instanceof Date ? av.getTime() : null;
    const bd = bv instanceof Date ? bv.getTime() : null;
    if (ad != null && bd != null) return (ad - bd) * dir;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
  });
  return data;
}

const workLogActivityConfig: Record<ActivityType, { label: string; color: string; bg: string; border: string }> = {
  COMMENT: { label: "Comment", color: "text-slate-700", bg: "bg-slate-50", border: "border-slate-200" },
  QUESTION: { label: "Question", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  APPROVAL_REQUEST: { label: "Approval Request", color: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-200" },
  APPROVAL: { label: "Approval", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  REVISION_REQUEST: { label: "Revision Request", color: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200" },
};

const ClientDashboardPage: React.FC = () => {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);
  const isClientPortal = location.pathname.startsWith("/client/");
  const clientPortalMode = isClientPortal && user?.role === "USER";
  const navState = location.state as {
    reportOnly?: boolean;
    includedReadOnly?: boolean;
    specialistViewOnly?: boolean;
    projectId?: string;
    pageId?: string;
  } | null;
  // When in client portal, we show only the Dashboard view for the invited client.
  const reportOnly = Boolean(navState?.reportOnly);
  const includedReadOnlyFromState = Boolean(navState?.includedReadOnly);
  const specialistReadOnlyFromState = Boolean(navState?.specialistViewOnly);
  // Client portal: list of accessible clients (for the client switcher)
  const [clientPortalClients, setClientPortalClients] = useState<Array<{ id: string; name: string }>>([]);
  const [client, setClient] = useState<Client | null>((location.state as { client?: Client })?.client || null);
  const [includedClientIds, setIncludedClientIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  type ClientDashboardTopTab = "dashboard" | "report" | "users" | "keywords" | "integration" | "web-design";
  type ClientDashboardSection = "seo" | "ai-intelligence" | "local-map" | "ppc" | "backlinks" | "worklog";

  const initialNav = (() => {
    if (clientPortalMode) {
      return { tab: "dashboard" as ClientDashboardTopTab, section: "seo" as ClientDashboardSection };
    }
    const requested = (location.state as { tab?: "dashboard" | "report" | "backlinks" | "worklog" | "users" | "keywords" | "integration" | "web-design" } | null)?.tab;
    if (requested === "report") return { tab: "report" as ClientDashboardTopTab, section: "seo" as ClientDashboardSection };
    if (requested === "users") return { tab: "users" as ClientDashboardTopTab, section: "seo" as ClientDashboardSection };
    if (requested === "keywords") return { tab: "keywords" as ClientDashboardTopTab, section: "seo" as ClientDashboardSection };
    if (requested === "integration") return { tab: "integration" as ClientDashboardTopTab, section: "seo" as ClientDashboardSection };
    if (requested === "web-design") return { tab: "web-design" as ClientDashboardTopTab, section: "seo" as ClientDashboardSection };
    if (requested === "backlinks") return { tab: "dashboard" as ClientDashboardTopTab, section: "backlinks" as ClientDashboardSection };
    if (requested === "worklog") return { tab: "dashboard" as ClientDashboardTopTab, section: "worklog" as ClientDashboardSection };
    return { tab: (reportOnly ? "report" : "dashboard") as ClientDashboardTopTab, section: "seo" as ClientDashboardSection };
  })();

  const [activeTab, setActiveTab] = useState<ClientDashboardTopTab>(initialNav.tab);
  const [dashboardSection, setDashboardSection] = useState<ClientDashboardSection>(initialNav.section);
  const [hasWebDesignProjects, setHasWebDesignProjects] = useState(false);
  const includedClientReadOnly =
    specialistReadOnlyFromState ||
    (user?.role === "SPECIALIST" && location.pathname.startsWith("/specialist/")) ||
    (user?.role === "AGENCY" && (includedReadOnlyFromState || (!!clientId && includedClientIds.includes(clientId))));
  const specialistSeoOverviewOnly =
    user?.role === "SPECIALIST" && location.pathname.startsWith("/specialist/clients/");
  const canModifyClientSettings = !includedClientReadOnly;

  // Client portal guard: if a client user hits a clientId they don't have access to,
  // redirect them to their first allowed client dashboard (or login).
  useEffect(() => {
    if (!clientPortalMode) return;
    if (!clientId) return;
    const clients = (user as any)?.clientAccess?.clients as Array<{ clientId: string }> | undefined;
    if (!Array.isArray(clients) || clients.length === 0) {
      navigate("/login", { replace: true });
      return;
    }
    const allowed = clients.some((c) => c?.clientId === clientId);
    if (!allowed) {
      navigate(`/client/dashboard/${encodeURIComponent(clients[0].clientId)}`, { replace: true });
    }
  }, [clientId, clientPortalMode, navigate, user]);

  useEffect(() => {
    const run = async () => {
      if (!clientPortalMode) return;
      try {
        const res = await api.get("/clients");
        const rows = Array.isArray(res.data) ? res.data : [];
        setClientPortalClients(rows.map((c: any) => ({ id: String(c.id), name: String(c.name || c.domain || c.id) })));
        if (clientId) {
          const currentClient = rows.find((c: any) => String(c?.id) === String(clientId));
          if (currentClient) {
            setClient(currentClient as Client);
          }
        }
      } catch {
        setClientPortalClients([]);
      }
    };
    void run();
  }, [clientId, clientPortalMode]);

  useEffect(() => {
    if (user?.role !== "AGENCY") {
      setIncludedClientIds([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const res = await api.get("/agencies/included-clients");
        if (cancelled) return;
        const rows = Array.isArray(res.data) ? res.data : [];
        const ids = rows
          .map((row: any) => String(row?.clientId ?? row?.client?.id ?? ""))
          .filter((id: string) => id.length > 0);
        setIncludedClientIds(ids);
      } catch {
        if (!cancelled) setIncludedClientIds([]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  const [dateRange, setDateRange] = useState("30");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [compareTo, setCompareTo] = useState<"none" | "previous_period" | "previous_year" | "custom">("none");
  const [compareStartDate, setCompareStartDate] = useState<string>("");
  const [compareEndDate, setCompareEndDate] = useState<string>("");
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  // Date range picker modal: working state (synced when modal opens)
  const [pickerStartDate, setPickerStartDate] = useState<Date | null>(null);
  const [pickerEndDate, setPickerEndDate] = useState<Date | null>(null);
  const [pickerPreset, setPickerPreset] = useState<string>("30");
  const [pickerCompareTo, setPickerCompareTo] = useState<"none" | "previous_period" | "previous_year" | "custom">("none");
  const [pickerCompareStart, setPickerCompareStart] = useState<string>("");
  const [pickerCompareEnd, setPickerCompareEnd] = useState<string>("");
  const [pickerCompareStartDate, setPickerCompareStartDate] = useState<Date | null>(null);
  const [pickerCompareEndDate, setPickerCompareEndDate] = useState<Date | null>(null);
  const [pickerIncludeToday, setPickerIncludeToday] = useState(true);
  /** Which range the single calendar is editing */
  const [calendarEditing, setCalendarEditing] = useState<"dateRange" | "compare">("dateRange");

  // Sync date picker modal state when opening
  useEffect(() => {
    if (!calendarModalOpen) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let start: Date;
    let end: Date | null;
    if (dateRange === "custom" && customStartDate && customEndDate) {
      start = new Date(customStartDate);
      end = new Date(customEndDate);
      setPickerPreset("custom");
    } else {
      const days = Math.max(1, parseInt(dateRange, 10) || 30);
      end = new Date(today);
      start = subDays(end, days - 1);
      setPickerPreset(dateRange);
    }
    setPickerStartDate(start);
    setPickerEndDate(end);
    setPickerCompareTo(compareTo);
    setPickerCompareStart(compareStartDate);
    setPickerCompareEnd(compareEndDate);
    setPickerCompareStartDate(compareStartDate ? new Date(compareStartDate) : null);
    setPickerCompareEndDate(compareEndDate ? new Date(compareEndDate) : null);
    setPickerIncludeToday(true);
    setCalendarEditing(compareTo === "custom" && dateRange !== "custom" ? "compare" : "dateRange");
  }, [calendarModalOpen, dateRange, customStartDate, customEndDate, compareTo, compareStartDate, compareEndDate]);

  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [dashboardSummaryCompare, setDashboardSummaryCompare] = useState<DashboardSummary | null>(null);
  const [visitorSourcesCompare, setVisitorSourcesCompare] = useState<Array<{ source: string; users: number }>>([]);
  const [topEventsCompare, setTopEventsCompare] = useState<Array<{ name: string; count: number }>>([]);
  const [trafficSourcesCompare, setTrafficSourcesCompare] = useState<TrafficSourceSlice[]>([]);
  const [fetchingSummary, setFetchingSummary] = useState(false);
  const [backlinksForChart, setBacklinksForChart] = useState<{
    newRows: BacklinkRow[];
    lostRows: BacklinkRow[];
  }>({ newRows: [], lostRows: [] });
  const [backlinksForChartLoading, setBacklinksForChartLoading] = useState(false);
  const [backlinksForChartError, setBacklinksForChartError] = useState<string | null>(null);
  const [backlinksFilter, setBacklinksFilter] = useState<BacklinkFilter>("all");
  const [backlinksSortBy, setBacklinksSortBy] = useState<"sourceUrl" | "anchorText" | "domainRating" | "firstSeen">("firstSeen");
  const [backlinksOrder, setBacklinksOrder] = useState<"asc" | "desc">("desc");
  const [backlinks, setBacklinks] = useState<BacklinkRow[]>([]);
  const [backlinksLoading, setBacklinksLoading] = useState(false);
  const [backlinksError, setBacklinksError] = useState<string | null>(null);
  const [backlinksPageSize, setBacklinksPageSize] = useState<(typeof BACKLINKS_PAGE_SIZES)[number]>(25);
  const [backlinksPage, setBacklinksPage] = useState(1);
  const [addBacklinkModalOpen, setAddBacklinkModalOpen] = useState(false);
  const [addingBacklink, setAddingBacklink] = useState(false);
  const [addBacklinkForm, setAddBacklinkForm] = useState<{
    sourceUrl: string;
    targetUrl: string;
    anchorText: string;
    domainRating: string;
    isFollow: boolean;
  }>({ sourceUrl: "", targetUrl: "", anchorText: "", domainRating: "", isFollow: true });
  const [importBacklinksModalOpen, setImportBacklinksModalOpen] = useState(false);
  const [importingBacklinks, setImportingBacklinks] = useState(false);
  const [importBacklinksText, setImportBacklinksText] = useState("");
  const [backlinkDeleteConfirm, setBacklinkDeleteConfirm] = useState<{
    isOpen: boolean;
    backlinkId: string | null;
    label: string | null;
    isLost: boolean;
  }>({ isOpen: false, backlinkId: null, label: null, isLost: false });
  const [aiSearchRows, setAiSearchRows] = useState<AiSearchVisibilityRow[]>([]);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [aiSearchError, setAiSearchError] = useState<string | null>(null);
  const [aiIntelligence, setAiIntelligence] = useState<{
    kpis: { aiVisibilityScore: number; aiVisibilityScoreTrend: number | null; totalAiMentions: number; totalAiMentionsTrend: number | null; aiSearchVolume: number; aiSearchVolumeTrend: number | null; monthlyTrendPercent: number | null };
    platforms: { platform: string; color: string; mentions: number; aiSearchVol: number; impressions: number; trend: number | null; share: number }[];
    queriesWhereYouAppear: { query: string; aiVolPerMo: number; platforms: string; mentions: number }[];
    totalQueriesCount: number;
    competitors: { domain: string; label: string; isLeader: boolean; isYou: boolean; score: number; trend: number | null }[];
    gapBehindLeader: number;
    howAiMentionsYou: { query: string; platform: string; aiVolPerMo: number; snippet: string; sourceUrl: string; citationIndex: number }[];
    totalContextsCount: number;
    competitorQueries: { query: string; compMentions: number; aiVol: number; priority: string }[];
    actionItems: string[];
    aiSearchVolumeTrend12Months?: { year: number; month: number; searchVolume: number }[];
    topContentTypes?: { contentType: string; exampleUrls: string[]; mentionPercent: number }[];
    platformDominance?: {
      chatgpt: { domain: string; label: string; mentions: number; isYou: boolean }[];
      google_ai: { domain: string; label: string; mentions: number; isYou: boolean }[];
      perplexity: { domain: string; label: string; mentions: number; isYou: boolean }[];
    };
    meta?: {
      startDate: string;
      endDate: string;
      lastUpdated?: string;
      dataForSeoConnected: boolean;
      locationCode: number;
      languageCode: string;
      competitorDomainsCount: number;
      hasDataForSeoCredentials?: boolean;
      targetDomain?: string;
      apiResponseStatus?: string;
      scoreExplanation?: string;
      dataSource?: string;
      supportsHistoricalTrends?: boolean;
      queriesFilteredByRelevance?: boolean;
      industry?: string | null;
      hasQueryLevelData?: boolean;
      hasCompetitorData?: boolean;
      searchMentionsItemCount?: number;
      kpiVolumeFromTrend?: boolean;
      hasAiMentions?: boolean;
    };
  } | null>(null);
  const [aiIntelligenceLoading, setAiIntelligenceLoading] = useState(false);
  const [aiIntelligenceError, setAiIntelligenceError] = useState<string | null>(null);
  const [showAllQueriesModal, setShowAllQueriesModal] = useState(false);
  const [showCompetitiveAnalysisModal, setShowCompetitiveAnalysisModal] = useState(false);
  const [showAllContextsModal, setShowAllContextsModal] = useState(false);
  const [topPages, setTopPages] = useState<TopPageItem[]>([]);
  const [topPagesLoading, setTopPagesLoading] = useState(false);
  const [topPagesError, setTopPagesError] = useState<string | null>(null);
  const [trafficSources, setTrafficSources] = useState<TrafficSourceSlice[]>([]);
  const [trafficSourcesLoading, setTrafficSourcesLoading] = useState(false);
  const [trafficSourcesError, setTrafficSourcesError] = useState<string | null>(null);
  const [ga4DataRefreshKey, setGa4DataRefreshKey] = useState(0);
  const prevGa4ReadyRef = useRef<boolean>(false);
  const autoRefreshAttemptedRef = useRef<Record<string, boolean>>({});
  const autoBacklinksListRefreshAttemptedRef = useRef<Record<string, boolean>>({});
  const autoDataForSeoAttemptedRef = useRef<{
    topPages: Record<string, boolean>;
    backlinks: Record<string, boolean>;
  }>({ topPages: {}, backlinks: {} });
  const [, setAutoRefreshingGa4] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const dashboardOuterScrollRef = useRef<HTMLDivElement | null>(null);
  const dashboardContentRef = useRef<HTMLDivElement>(null);
  const modalDashboardContentRef = useRef<HTMLDivElement>(null);
  const [viewReportModalOpen, setViewReportModalOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ClientReport | null>(null);
  const [reportDeleteConfirm, setReportDeleteConfirm] = useState<{
    isOpen: boolean;
    reportId: string | null;
    label: string | null;
  }>({ isOpen: false, reportId: null, label: null });

  const [reportPreviewTargetKeywords, setReportPreviewTargetKeywords] = useState<ReportTargetKeywordRow[]>([]);
  const [reportPreviewTargetKeywordsLoading, setReportPreviewTargetKeywordsLoading] = useState(false);
  const [reportPreviewTargetKeywordsError, setReportPreviewTargetKeywordsError] = useState<string | null>(null);
  const [reportPreviewPpcData, setReportPreviewPpcData] = useState<any>(null);
  const [reportPreviewPpcLoading, setReportPreviewPpcLoading] = useState(false);
  const [reportPreviewPpcError, setReportPreviewPpcError] = useState<string | null>(null);
  const [reportPreviewShareUrl, setReportPreviewShareUrl] = useState<string | null>(null);
  const [reportPreviewShareLoading, setReportPreviewShareLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [serverReport, setServerReport] = useState<any | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [ga4Connected, setGa4Connected] = useState<boolean | null>(null);
  const [, setGa4AccountEmail] = useState<string | null>(null);
  const [ga4Connecting, setGa4Connecting] = useState(false);
  const [ga4StatusLoading, setGa4StatusLoading] = useState(true); // Track GA4 status check loading
  const [, setGa4ConnectionError] = useState<string | null>(null);
  // Google Ads (PPC) connection state
  const [googleAdsConnected, setGoogleAdsConnected] = useState<boolean | null>(null);
  const [googleAdsHasTokens, setGoogleAdsHasTokens] = useState(false);
  const [googleAdsAccountEmail, setGoogleAdsAccountEmail] = useState<string | null>(null);
  const [googleAdsConnecting, setGoogleAdsConnecting] = useState(false);
  const [googleAdsStatusLoading, setGoogleAdsStatusLoading] = useState(true);
  const [, setGoogleAdsConnectionError] = useState<string | null>(null);
  const [showGoogleAdsModal, setShowGoogleAdsModal] = useState(false);
  const [googleAdsCustomerId, setGoogleAdsCustomerId] = useState("");
  const [googleAdsCustomers, setGoogleAdsCustomers] = useState<Array<{
    customerId: string;
    customerName: string;
    currencyCode: string;
    timeZone: string;
    managerCustomerId?: string | null;
    status?: string;
    isManager?: boolean;
  }>>([]);
  const [loadingGoogleAdsCustomers, setLoadingGoogleAdsCustomers] = useState(false);
  const [googleAdsSelectedManager, setGoogleAdsSelectedManager] = useState<{ customerId: string; customerName: string } | null>(null);
  const [googleAdsChildAccounts, setGoogleAdsChildAccounts] = useState<Array<{ customerId: string; customerName: string; status: string }>>([]);
  const [loadingGoogleAdsChildAccounts, setLoadingGoogleAdsChildAccounts] = useState(false);
  // PPC dashboard state
  const [ppcSubSection, setPpcSubSection] = useState<"campaigns" | "ad-groups" | "keywords" | "conversions">("campaigns");
  const [ppcData, setPpcData] = useState<any>(null);
  const [ppcLoading, setPpcLoading] = useState(false);
  const [ppcError, setPpcError] = useState<string | null>(null);
  const [ppcCampaignSort, setPpcCampaignSort] = useState<PpcSortConfig>({ key: "clicks", direction: "desc" });
  const [ppcAdGroupSort, setPpcAdGroupSort] = useState<PpcSortConfig>({ key: "clicks", direction: "desc" });
  const [ppcKeywordSort, setPpcKeywordSort] = useState<PpcSortConfig>({ key: "clicks", direction: "desc" });
  const [ppcConversionSort, setPpcConversionSort] = useState<PpcSortConfig>({ key: "date", direction: "desc" });
  const togglePpcSort = useCallback(
    (
      key: string,
      current: PpcSortConfig,
      setter: React.Dispatch<React.SetStateAction<PpcSortConfig>>
    ) => {
      setter(
        current.key === key
          ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
          : { key, direction: "desc" }
      );
    },
    []
  );
  const sortIndicator = useCallback((sort: PpcSortConfig, key: string) => {
    if (sort.key !== key) return "↕";
    return sort.direction === "asc" ? "▲" : "▼";
  }, []);
  const sortedPpcCampaigns = useMemo(
    () =>
      sortPpcRows(ppcData?.data?.campaigns || [], ppcCampaignSort, (campaign: any, key: string) => {
        if (key === "ctr") {
          const impressions = Number(campaign?.impressions ?? 0);
          const clicks = Number(campaign?.clicks ?? 0);
          return impressions > 0 ? (clicks / impressions) * 100 : 0;
        }
        if (key === "convRate") {
          const clicks = Number(campaign?.clicks ?? 0);
          const conversions = Number(campaign?.conversions ?? 0);
          return clicks > 0 ? (conversions / clicks) * 100 : 0;
        }
        if (key === "costPerConversion") {
          const conversions = Number(campaign?.conversions ?? 0);
          const cost = Number(campaign?.cost ?? 0);
          return conversions > 0 ? cost / conversions : 0;
        }
        return campaign?.[key];
      }),
    [ppcData, ppcCampaignSort]
  );
  const sortedPpcAdGroups = useMemo(
    () =>
      sortPpcRows(ppcData?.data?.adGroups || [], ppcAdGroupSort, (adGroup: any, key: string) => {
        if (key === "ctr") {
          const impressions = Number(adGroup?.impressions ?? 0);
          const clicks = Number(adGroup?.clicks ?? 0);
          return impressions > 0 ? (clicks / impressions) * 100 : 0;
        }
        return adGroup?.[key];
      }),
    [ppcData, ppcAdGroupSort]
  );
  const sortedPpcKeywords = useMemo(
    () =>
      sortPpcRows(ppcData?.data?.keywords || [], ppcKeywordSort, (keyword: any, key: string) => {
        if (key === "ctr") {
          const impressions = Number(keyword?.impressions ?? 0);
          const clicks = Number(keyword?.clicks ?? 0);
          return impressions > 0 ? (clicks / impressions) * 100 : 0;
        }
        if (key === "impressionShare") {
          return Number(keyword?.impressionShare ?? 0);
        }
        return keyword?.[key];
      }),
    [ppcData, ppcKeywordSort]
  );
  const sortedPpcConversions = useMemo(
    () =>
      sortPpcRows(ppcData?.data?.conversions || [], ppcConversionSort, (conversion: any, key: string) => {
        if (key === "date") return conversion?.date ? new Date(conversion.date) : null;
        return conversion?.[key];
      }),
    [ppcData, ppcConversionSort]
  );
  const [ppcScheduleMeta, setPpcScheduleMeta] = useState<{
    hasSchedule: boolean;
    scheduleId: string | null;
    isActive: boolean;
    frequency: string | null;
    lastRunAt: string | null;
    nextRunAt: string | null;
    recipients: string[];
  }>({
    hasSchedule: false,
    scheduleId: null,
    isActive: false,
    frequency: null,
    lastRunAt: null,
    nextRunAt: null,
    recipients: [],
  });
  const [localMapScheduleMeta, setLocalMapScheduleMeta] = useState<{
    hasSchedule: boolean;
    scheduleId: string | null;
    isActive: boolean;
    frequency: string | null;
    lastRunAt: string | null;
    nextRunAt: string | null;
    recipients: string[];
  }>({
    hasSchedule: false,
    scheduleId: null,
    isActive: false,
    frequency: null,
    lastRunAt: null,
    nextRunAt: null,
    recipients: [],
  });
  const [ppcReportDeleteConfirm, setPpcReportDeleteConfirm] = useState<{
    isOpen: boolean;
    scheduleId: string | null;
    label: string | null;
  }>({
    isOpen: false,
    scheduleId: null,
    label: null,
  });
  const [localMapReportDeleteConfirm, setLocalMapReportDeleteConfirm] = useState<{
    isOpen: boolean;
    scheduleId: string | null;
    label: string | null;
  }>({
    isOpen: false,
    scheduleId: null,
    label: null,
  });
  const [campaignWinsMeta, setCampaignWinsMeta] = useState<{
    enabled: boolean;
    recipients: string[];
    lastSent: string | null;
  }>({
    enabled: false,
    recipients: [],
    lastSent: null,
  });
  const [sendingCampaignWinsReport, setSendingCampaignWinsReport] = useState(false);
  const [sendingLocalMapReport, setSendingLocalMapReport] = useState(false);
  const [campaignWinsDeleteConfirm, setCampaignWinsDeleteConfirm] = useState<{
    isOpen: boolean;
    label: string | null;
  }>({
    isOpen: false,
    label: null,
  });
  const [campaignWinsPreviewModal, setCampaignWinsPreviewModal] = useState<{
    open: boolean;
    clientName: string;
    subject: string;
    recipients: string[];
    html: string;
  }>({
    open: false,
    clientName: "",
    subject: "",
    recipients: [],
    html: "",
  });
  const [localMapSummary, setLocalMapSummary] = useState<{
    total: number;
    active: number;
    remaining: number;
    activeForDashboard: number;
  }>({
    total: 0,
    active: 0,
    remaining: 0,
    activeForDashboard: 0,
  });
  const [localMapKeywords, setLocalMapKeywords] = useState<LocalMapKeywordRow[]>([]);
  const [localMapLoading, setLocalMapLoading] = useState(false);
  const [localMapActivationOpen, setLocalMapActivationOpen] = useState(false);
  const [localMapMoneyKeywords, setLocalMapMoneyKeywords] = useState<Array<{ id: string; keyword: string }>>([]);
  const [localMapMoneyKeywordsLoading, setLocalMapMoneyKeywordsLoading] = useState(false);
  const [localMapSelectedKeywordId, setLocalMapSelectedKeywordId] = useState("");
  const [localMapBusinessSelection, setLocalMapBusinessSelection] = useState<GoogleBusinessSelection | null>(null);
  const [localMapLabel, setLocalMapLabel] = useState("");
  const [localMapSubmitting, setLocalMapSubmitting] = useState(false);
  const [localMapReportOpen, setLocalMapReportOpen] = useState(false);
  const [localMapReportLoading, setLocalMapReportLoading] = useState(false);
  const [localMapReport, setLocalMapReport] = useState<LocalMapKeywordReportPayload | null>(null);
  const [localMapExportingPdf, setLocalMapExportingPdf] = useState(false);
  const localMapReportContentRef = useRef<HTMLDivElement | null>(null);
  const localMapReportTrendPoints = useMemo(() => {
    if (!localMapReport) return [] as Array<{ runDate: string; ataScore: number }>;
    if (Array.isArray(localMapReport.trend) && localMapReport.trend.length > 0) {
      return localMapReport.trend;
    }
    return [...(localMapReport.snapshots || [])]
      .sort((a, b) => new Date(a.runDate).getTime() - new Date(b.runDate).getTime())
      .map((snap) => ({
        runDate: snap.runDate,
        ataScore: Number(snap.ataScore),
      }));
  }, [localMapReport]);
  const localMapReportBenchmark = useMemo(() => {
    if (!localMapReport) return null;
    return (localMapReport.snapshots || []).find((snap) => snap.isBenchmark) ?? null;
  }, [localMapReport]);

  const loadLocalMapData = useCallback(async () => {
    if (!clientId) return;
    try {
      setLocalMapLoading(true);
      const [summaryRes, listRes] = await Promise.all([
        api.get(`/local-map/summary/${clientId}`),
        api.get(`/local-map/keywords/${clientId}`),
      ]);
      const summary = summaryRes?.data ?? {};
      setLocalMapSummary({
        total: Number(summary.total ?? 0),
        active: Number(summary.active ?? 0),
        remaining: Number(summary.remaining ?? 0),
        activeForDashboard: Number(summary.activeForDashboard ?? 0),
      });
      const rows = Array.isArray(listRes.data) ? listRes.data : [];
      const activeRows = rows.filter((row: any) => String(row?.status || "").toLowerCase() === "active");
      setLocalMapKeywords(
        activeRows.map((row: any) => ({
          id: String(row.id),
          keywordText: String(row.keywordText ?? ""),
          businessName: String(row.businessName ?? ""),
          businessAddress: row.businessAddress ? String(row.businessAddress) : null,
          status: row.status as "active" | "paused" | "canceled",
          latestAta: row.latestAta == null ? null : Number(row.latestAta),
          previousAta: row.previousAta == null ? null : Number(row.previousAta),
          trend: row.trend == null ? null : Number(row.trend),
          lastRunDate: row.lastRunDate ? String(row.lastRunDate) : null,
        }))
      );
    } catch {
      setLocalMapKeywords([]);
    } finally {
      setLocalMapLoading(false);
    }
  }, [clientId]);

  const loadLocalMapMoneyKeywords = useCallback(async () => {
    if (!clientId) return;
    try {
      setLocalMapMoneyKeywordsLoading(true);
      const res = await api.get(`/seo/keywords/${clientId}`);
      const rows = Array.isArray(res.data) ? res.data : [];
      const filtered = rows.filter((row: any) => String(row?.type || "money") === "money");
      setLocalMapMoneyKeywords(
        filtered.map((row: any) => ({
          id: String(row.id),
          keyword: String(row.keyword || ""),
        }))
      );
    } catch {
      setLocalMapMoneyKeywords([]);
    } finally {
      setLocalMapMoneyKeywordsLoading(false);
    }
  }, [clientId]);

  const openLocalMapActivationModal = useCallback(async () => {
    if (includedClientReadOnly) return;
    // Ensure other overlays never mask this modal.
    setShowClientReportModal(false);
    setImportBacklinksModalOpen(false);
    toast("Opening activation form...", { duration: 1200 });
    setLocalMapActivationOpen(true);
    await loadLocalMapMoneyKeywords();
  }, [includedClientReadOnly, loadLocalMapMoneyKeywords]);

  const handleActivateLocalMapKeyword = useCallback(async () => {
    if (!clientId) return;
    if (includedClientReadOnly) return;
    if (localMapSubmitting) return;
    if (!localMapSelectedKeywordId) {
      toast.error("Select a keyword");
      return;
    }

    try {
      setLocalMapSubmitting(true);
      if (!localMapBusinessSelection) {
        toast.error("Select a business profile");
        return;
      }

      const activateRes = await api.post(`/local-map/keywords/${clientId}`, {
        keywordId: localMapSelectedKeywordId,
        placeId: localMapBusinessSelection.placeId,
        businessName: localMapBusinessSelection.businessName,
        businessAddress: localMapBusinessSelection.address,
        centerLat: localMapBusinessSelection.lat,
        centerLng: localMapBusinessSelection.lng,
        locationLabel: localMapLabel.trim() || null,
      }, { _silent: true } as any);
      const result = activateRes?.data as
        | { alreadyActive?: boolean; reactivated?: boolean; message?: string }
        | undefined;
      if (result?.alreadyActive) {
        toast.success(result.message || "This keyword and business listing is already active.");
      } else if (result?.reactivated) {
        toast.success(result.message || "Local map keyword reactivated.");
      } else {
        toast.success("Local map keyword activated");
      }
      setLocalMapActivationOpen(false);
      setLocalMapSelectedKeywordId("");
      setLocalMapBusinessSelection(null);
      setLocalMapLabel("");
      await loadLocalMapData();
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to activate local map keyword";
      toast.error(message);
    } finally {
      setLocalMapSubmitting(false);
    }
  }, [
    clientId,
    includedClientReadOnly,
    localMapBusinessSelection,
    localMapLabel,
    localMapSubmitting,
    localMapSelectedKeywordId,
    loadLocalMapData,
  ]);

  const openLocalMapReport = useCallback(async (gridKeywordId: string) => {
    try {
      // Ensure no other overlays sit above this report modal.
      setLocalMapActivationOpen(false);
      setShowClientReportModal(false);
      setImportBacklinksModalOpen(false);
      setLocalMapReportOpen(true);
      setLocalMapReportLoading(true);
      setLocalMapReport(null);
      const res = await api.get(`/local-map/report/${gridKeywordId}`, { _silent: true } as any);
      setLocalMapReport(res.data as LocalMapKeywordReportPayload);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to load report.");
    } finally {
      setLocalMapReportLoading(false);
    }
  }, []);

  const exportLocalMapReportPdfBlob = useCallback(async (
    reportData?: LocalMapKeywordReportPayload | null,
    options?: { silent?: boolean }
  ): Promise<{ blob: Blob; filename: string } | null> => {
    const report = reportData ?? localMapReport;
    if (!report) {
      if (!options?.silent) toast.error("Report data is not ready yet.");
      return null;
    }
    if (!localMapReportContentRef.current) {
      if (!options?.silent) toast.error("Unable to export report content. Please try again.");
      return null;
    }

    try {
      setLocalMapExportingPdf(true);

      const sections = Array.from(
        localMapReportContentRef.current.querySelectorAll(".local-map-pdf-section")
      ) as HTMLElement[];
      if (sections.length === 0) {
        if (!options?.silent) toast.error("No report sections found to export.");
        return null;
      }

      const ignoreFilter = (el: Element) => el.getAttribute?.("data-pdf-hide") === "true";
      const sectionCanvases: HTMLCanvasElement[] = [];
      for (const sec of sections) {
        const cvs = await html2canvas(sec, {
          scale: 2,
          useCORS: true,
          logging: false,
          scrollX: 0,
          scrollY: 0,
          backgroundColor: "#FFFFFF",
          ignoreElements: ignoreFilter,
        });
        sectionCanvases.push(cvs);
      }

      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const marginX = 12;
      const headerH = 16;
      const footerH = 10;
      const contentMarginTop = headerH + 3;
      const contentMarginBottom = footerH + 2;
      const usableWidth = pageWidth - marginX * 2;
      const usableHeight = pageHeight - contentMarginTop - contentMarginBottom;
      const generatedDate = format(new Date(), "MMMM d, yyyy");
      const websiteName = report.keyword.keywordText || "Local Map Report";
      const subtitle = report.keyword.businessName || "";

      // Cover page.
      pdf.setFillColor(15, 23, 42);
      pdf.rect(0, 0, pageWidth, pageHeight, "F");
      pdf.setFillColor(79, 70, 229);
      pdf.rect(0, 0, pageWidth, 3, "F");
      const labelY = pageHeight * 0.32;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(148, 163, 184);
      pdf.text("LOCAL MAP REPORT", pageWidth / 2, labelY, { align: "center" });
      pdf.setDrawColor(79, 70, 229);
      pdf.setLineWidth(0.6);
      pdf.line(pageWidth / 2 - 25, labelY + 4, pageWidth / 2 + 25, labelY + 4);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(24);
      pdf.setTextColor(255, 255, 255);
      pdf.text(websiteName, pageWidth / 2, labelY + 18, { align: "center", maxWidth: pageWidth - 30 });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(148, 163, 184);
      pdf.text(subtitle, pageWidth / 2, labelY + 30, { align: "center", maxWidth: pageWidth - 30 });
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(generatedDate, pageWidth / 2, labelY + 41, { align: "center", maxWidth: pageWidth - 30 });
      pdf.setFillColor(79, 70, 229);
      pdf.rect(0, pageHeight - 3, pageWidth, 3, "F");

      pdf.addPage();
      let cursorY = 0;
      const pageAssignments: Array<{ canvas: HTMLCanvasElement; page: number; y: number; w: number; h: number }> = [];

      for (const cvs of sectionCanvases) {
        const baseW = usableWidth;
        const baseH = (cvs.height * baseW) / cvs.width;
        let drawW = baseW;
        let drawH = baseH;

        if (drawH > usableHeight) {
          const scale = usableHeight / drawH;
          drawW = drawW * scale;
          drawH = usableHeight;
        }

        if (cursorY > 0 && cursorY + drawH > usableHeight) {
          pdf.addPage();
          cursorY = 0;
        }

        const page = pdf.getNumberOfPages();
        pageAssignments.push({
          canvas: cvs,
          page,
          y: contentMarginTop + cursorY,
          w: drawW,
          h: drawH,
        });
        cursorY += drawH + 4;
      }

      const drawHeader = () => {
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, pageWidth, headerH, "F");
        pdf.setFillColor(79, 70, 229);
        pdf.rect(0, headerH, pageWidth, 0.8, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.setTextColor(255, 255, 255);
        pdf.text("Local Map Report", marginX, 7);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(148, 163, 184);
        pdf.text(subtitle, marginX, 12, { maxWidth: pageWidth * 0.6 });
        pdf.text(generatedDate, pageWidth - marginX, 12, { align: "right" });
      };

      const drawFooter = (pageNum: number, totalPages: number) => {
        const footerY = pageHeight - footerH / 2;
        pdf.setDrawColor(226, 232, 240);
        pdf.setLineWidth(0.3);
        pdf.line(marginX, pageHeight - footerH, pageWidth - marginX, pageHeight - footerH);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth / 2, footerY, { align: "center" });
        pdf.setFontSize(7);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Generated ${generatedDate}`, marginX, footerY);
        pdf.text("Confidential", pageWidth - marginX, footerY, { align: "right" });
      };

      for (const item of pageAssignments) {
        pdf.setPage(item.page);
        const imgData = item.canvas.toDataURL("image/png");
        const imgX = marginX + (usableWidth - item.w) / 2;
        pdf.addImage(imgData, "PNG", imgX, item.y, item.w, item.h);
      }

      const totalPages = pdf.getNumberOfPages();
      for (let p = 2; p <= totalPages; p += 1) {
        pdf.setPage(p);
        drawHeader();
        drawFooter(p, totalPages);
      }
      pdf.setPage(1);
      drawFooter(1, totalPages);

      const fileStem = (report.keyword.keywordText || "local-map-report").replace(/\s+/g, "-").toLowerCase();
      const filename = `${fileStem}-local-map-report.pdf`;
      return { blob: pdf.output("blob"), filename };
    } catch (error: any) {
      if (!options?.silent) toast.error(error?.message || "Unable to export local map report.");
      return null;
    } finally {
      setLocalMapExportingPdf(false);
    }
  }, [localMapReport]);

  const exportLocalMapReportPdf = useCallback(async (reportData?: LocalMapKeywordReportPayload | null) => {
    const result = await exportLocalMapReportPdfBlob(reportData);
    if (!result) return false;
    const objectUrl = URL.createObjectURL(result.blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = result.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return true;
  }, [exportLocalMapReportPdfBlob]);

  const downloadLocalMapKeywordReport = useCallback(async (gridKeywordId: string) => {
    try {
      setLocalMapActivationOpen(false);
      setShowClientReportModal(false);
      setImportBacklinksModalOpen(false);
      setLocalMapReportOpen(true);
      setLocalMapReportLoading(true);
      setLocalMapReport(null);
      const res = await api.get(`/local-map/report/${gridKeywordId}`, { _silent: true } as any);
      const payload = res.data as LocalMapKeywordReportPayload;
      setLocalMapReport(payload);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await exportLocalMapReportPdf(payload);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to download report.");
    } finally {
      setLocalMapReportLoading(false);
    }
  }, [exportLocalMapReportPdf]);

  useEffect(() => {
    if (activeTab !== "dashboard" || dashboardSection !== "local-map") return;
    void loadLocalMapData();
  }, [activeTab, dashboardSection, loadLocalMapData]);

  const [ppcDateRange] = useState("30"); // Fixed last 30 days for PPC data (no UI selector)
  const [showGA4Modal, setShowGA4Modal] = useState(false);
  const [ga4PropertyId, setGa4PropertyId] = useState("");
  const [ga4Properties, setGa4Properties] = useState<Array<{
    propertyId: string;
    propertyName: string;
    accountId: string;
    accountName: string;
    displayName: string;
  }>>([]);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [ga4PropertySearch, setGa4PropertySearch] = useState("");
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);
  const [topEvents, setTopEvents] = useState<Array<{ name: string; count: number }>>([]);
  const [topEventsLoading, setTopEventsLoading] = useState(false);
  const [topEventsError, setTopEventsError] = useState<string | null>(null);
  const [visitorSources, setVisitorSources] = useState<Array<{ source: string; users: number }>>([]);
  const [visitorSourcesLoading, setVisitorSourcesLoading] = useState(false);
  const [visitorSourcesError, setVisitorSourcesError] = useState<string | null>(null);
  const [seoOverviewWidgetsRefreshKey, setSeoOverviewWidgetsRefreshKey] = useState(0);
  const [refreshingTopPages, setRefreshingTopPages] = useState(false);
  const [refreshingBacklinks, setRefreshingBacklinks] = useState(false);
  const dashboardExportReadyRef = useRef({
    refreshingDashboard: false,
    refreshingTopPages: false,
    refreshingBacklinks: false,
    fetchingSummary: false,
  });
  const [sendingReport, setSendingReport] = useState(false);
  const [sendingPpcReport, setSendingPpcReport] = useState(false);
  const [expandedPageUrls, setExpandedPageUrls] = useState<Set<string>>(new Set());
  const [pageKeywords, setPageKeywords] = useState<Record<string, Array<{
    keyword: string;
    currentPosition: number | null;
    previousPosition: number | null;
    searchVolume: number | null;
    isNew?: boolean;
    isUp?: boolean;
    isDown?: boolean;
    isLost?: boolean;
    etv?: number | null;
    keywordDifficulty?: number | null;
    cpc?: number | null;
    competition?: string | null;
    url?: string | null;
    title?: string | null;
    description?: string | null;
  }>>>({});
  const [loadingPageKeywords, setLoadingPageKeywords] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!clientId) return;
    if (activeTab !== "dashboard" || dashboardSection !== "seo") return;
    setSeoOverviewWidgetsRefreshKey((k) => k + 1);
  }, [clientId, activeTab, dashboardSection]);

  // Client-specific report creation modal state
  const [showClientReportModal, setShowClientReportModal] = useState(false);
  const [showViewClientModal, setShowViewClientModal] = useState(false);
  const [viewClientForm, setViewClientForm] = useState(EMPTY_CLIENT_FORM);
  const [viewClientSaving, setViewClientSaving] = useState(false);
  const [clientReportFrequency, setClientReportFrequency] = useState<
    | "weekly"
    | "biweekly"
    | "monthly"
    | "ppc_weekly"
    | "ppc_biweekly"
    | "ppc_monthly"
    | "campaign_wins"
    | "local_map_biweekly"
    | "local_map_monthly"
  >("monthly");
  const [clientReportDayOfWeek, setClientReportDayOfWeek] = useState(1); // Monday
  const [clientReportDayOfMonth, setClientReportDayOfMonth] = useState(1);
  const [clientReportTimeOfDay, setClientReportTimeOfDay] = useState("09:00");
  const [clientReportRecipients, setClientReportRecipients] = useState("");
  const [clientReportEmailSubject, setClientReportEmailSubject] = useState("");
  const [clientReportSubmitting, setClientReportSubmitting] = useState(false);
  // Local form state for Create Report modal so Recipients/Subject update correctly while typing
  const [modalRecipients, setModalRecipients] = useState("");
  const [modalEmailSubject, setModalEmailSubject] = useState("");

  // Work log (tasks linked to this client)
  const [workLogTasks, setWorkLogTasks] = useState<WorkLogTask[]>([]);
  const [workLogLoading, setWorkLogLoading] = useState(false);
  const [workLogError, setWorkLogError] = useState<string | null>(null);
  const [workLogModalOpen, setWorkLogModalOpen] = useState(false);
  const [showRecurringTaskModal, setShowRecurringTaskModal] = useState(false);
  const [workLogRecurringRules, setWorkLogRecurringRules] = useState<Array<WorkLogRecurringRuleForEdit & { nextRunAt: string; isActive: boolean; frequency: string }>>([]);
  const [workLogRecurringRulesOpen, setWorkLogRecurringRulesOpen] = useState(false);
  const [editingWorkLogRecurringRule, setEditingWorkLogRecurringRule] = useState<WorkLogRecurringRuleForEdit | null>(null);
  const [workLogRecurringRemoveConfirm, setWorkLogRecurringRemoveConfirm] = useState<{ isOpen: boolean; ruleId: string | null }>({ isOpen: false, ruleId: null });
  const [workLogModalMode, setWorkLogModalMode] = useState<"create" | "edit" | "view">("create");
  const [selectedWorkLogTaskId, setSelectedWorkLogTaskId] = useState<string | null>(null);
  type WorkLogAttachment = { type: string; value: string; name?: string };
  const [workLogForm, setWorkLogForm] = useState<{
    title: string;
    description: string;
    taskNotes: string;
    category: string;
    dueDate: string;
    assigneeId: string;
    assigneeDisplay: string;
    status: TaskStatus;
    attachments: WorkLogAttachment[];
    approvalNotifyUserIds: string[];
  }>({
    title: "",
    description: "",
    taskNotes: "",
    category: "",
    dueDate: "",
    assigneeId: "",
    assigneeDisplay: "",
    status: "TODO",
    attachments: [],
    approvalNotifyUserIds: [],
  });
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; name: string | null; email: string; role: string }[]>([]);
  const [assignableLoading, setAssignableLoading] = useState(false);
  const [assignableSearch, setAssignableSearch] = useState("");
  const [assignToOpen, setAssignToOpen] = useState(false);
  const [workLogAssigneesModalOpen, setWorkLogAssigneesModalOpen] = useState(false);
  const assignToRef = useRef<HTMLDivElement | null>(null);
  const workLogTaskNotesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!workLogModalOpen) return;
    const initial = workLogForm.taskNotes || "";
    const id = requestAnimationFrame(() => {
      if (workLogTaskNotesRef.current) workLogTaskNotesRef.current.innerHTML = initial;
    });
    return () => cancelAnimationFrame(id);
  }, [workLogModalOpen]);

  useEffect(() => {
    if (!workLogModalOpen && !workLogRecurringRulesOpen && !workLogAssigneesModalOpen) return;
    if (user?.role === "USER") return;
    let cancelled = false;
    const q = assignableSearch.trim();
    setAssignableLoading(true);
    api
      .get("/tasks/assignable-users", { params: q ? { search: q } : {} })
      .then((res) => {
        if (!cancelled) setAssignableUsers(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) setAssignableUsers([]);
      })
      .finally(() => {
        if (!cancelled) setAssignableLoading(false);
      });
    return () => { cancelled = true; };
  }, [workLogModalOpen, workLogRecurringRulesOpen, workLogAssigneesModalOpen, assignableSearch, user?.role]);

  useEffect(() => {
    if (!assignToOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (assignToRef.current && !assignToRef.current.contains(e.target as Node)) setAssignToOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [assignToOpen]);

  const [workLogDeleteConfirm, setWorkLogDeleteConfirm] = useState<{
    isOpen: boolean;
    taskId: string | null;
    taskTitle: string | null;
  }>({ isOpen: false, taskId: null, taskTitle: null });
  const [workLogUploading, setWorkLogUploading] = useState(false);
  const [workLogUrlInput, setWorkLogUrlInput] = useState("");
  const [workLogUrlType, setWorkLogUrlType] = useState<"image" | "video" | "url">("url");
  const [workLogAddMenuOpen, setWorkLogAddMenuOpen] = useState(false);
  const [workLogListTab, setWorkLogListTab] = useState<"upcoming" | "completed">("upcoming");
  const [workLogPageSize, setWorkLogPageSize] = useState<(typeof WORKLOG_PAGE_SIZES)[number]>(25);
  const [workLogPage, setWorkLogPage] = useState(1);
  const [workLogComments, setWorkLogComments] = useState<WorkLogComment[]>([]);
  const [workLogCommentsLoading, setWorkLogCommentsLoading] = useState(false);
  const [workLogCommentsError, setWorkLogCommentsError] = useState<string | null>(null);
  const [workLogNewComment, setWorkLogNewComment] = useState("");
  const [postingWorkLogComment, setPostingWorkLogComment] = useState(false);
  const [workLogMentionQuery, setWorkLogMentionQuery] = useState("");
  const [workLogMentionRange, setWorkLogMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [workLogMentionedUserIds, setWorkLogMentionedUserIds] = useState<string[]>([]);
  const [workLogMentionActiveIndex, setWorkLogMentionActiveIndex] = useState(0);
  const [workLogCommentDeleteConfirm, setWorkLogCommentDeleteConfirm] = useState<{ isOpen: boolean; commentId: string | null }>({
    isOpen: false,
    commentId: null,
  });
  const [workLogCollaboratorEditorOpen, setWorkLogCollaboratorEditorOpen] = useState(false);
  const [workLogCollaboratorSearch, setWorkLogCollaboratorSearch] = useState("");
  const [workLogManualCollaboratorIdsByTask, setWorkLogManualCollaboratorIdsByTask] = useState<Record<string, string[]>>({});
  const [workLogRemovedCollaboratorIdsByTask, setWorkLogRemovedCollaboratorIdsByTask] = useState<Record<string, string[]>>({});
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const workLogCommentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const workLogAddMenuRef = useRef<HTMLDivElement | null>(null);
  const lastAutoOpenedWorkLogTaskIdRef = useRef<string | null>(null);


  // Client portal users (Users tab)
  type ClientUserRow = {
    id: string;
    userId: string;
    name: string | null;
    email: string;
    role: "CLIENT" | "STAFF";
    status: "PENDING" | "ACTIVE";
    lastLoginAt: string | null;
    profileImageUrl?: string | null;
  };
  const [clientUsers, setClientUsers] = useState<ClientUserRow[]>([]);
  const [clientUsersLoading, setClientUsersLoading] = useState(false);
  const [clientUsersError, setClientUsersError] = useState<string | null>(null);
  const [inviteClientUsersModalOpen, setInviteClientUsersModalOpen] = useState(false);
  type InviteClientUserRow = { id: string; email: string; clientIds: string[] };
  const [inviteClientUsersRows, setInviteClientUsersRows] = useState<InviteClientUserRow[]>([]);
  const [inviteClientUsersAllClients, setInviteClientUsersAllClients] = useState<Array<{ id: string; name: string }>>([]);
  const [inviteClientUsersAllClientsLoading, setInviteClientUsersAllClientsLoading] = useState(false);
  const [inviteClientUsersAllClientsError, setInviteClientUsersAllClientsError] = useState<string | null>(null);
  const [inviteClientUsersViaEmail, setInviteClientUsersViaEmail] = useState(true);
  const [invitingClientUsers, setInvitingClientUsers] = useState(false);
  const inviteClientUsersClientsMenuButtonRef = useRef<HTMLElement | null>(null);
  const [inviteClientUsersClientsMenu, setInviteClientUsersClientsMenu] = useState<{
    rowId: string;
    rect: { top: number; left: number; right: number; bottom: number; width: number; height: number };
  } | null>(null);

  const [editClientUserProfileOpen, setEditClientUserProfileOpen] = useState(false);
  const [editClientUserProfileUser, setEditClientUserProfileUser] = useState<{
    userId: string;
    email: string;
    name: string | null;
    profileImageUrl?: string | null;
  } | null>(null);
  const [editClientUserFirstName, setEditClientUserFirstName] = useState("");
  const [editClientUserLastName, setEditClientUserLastName] = useState("");
  const [editClientUserPassword, setEditClientUserPassword] = useState("");
  const [editClientUserPasswordVisible, setEditClientUserPasswordVisible] = useState(false);
  const [editClientUserEmailCredentials, setEditClientUserEmailCredentials] = useState<"YES" | "NO">("NO");
  const [editClientUserPhotoUrl, setEditClientUserPhotoUrl] = useState<string | null>(null);
  const [uploadingClientUserPhoto, setUploadingClientUserPhoto] = useState(false);
  const editClientUserPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [savingClientUserProfile, setSavingClientUserProfile] = useState(false);

  const [editClientAccessOpen, setEditClientAccessOpen] = useState(false);
  const [editClientAccessUser, setEditClientAccessUser] = useState<{ userId: string; email: string; name: string | null } | null>(null);
  const [editClientAccessSearch, setEditClientAccessSearch] = useState("");
  const [editClientAccessClients, setEditClientAccessClients] = useState<Array<{ id: string; name: string; domain?: string }>>([]);
  const [editClientAccessSelected, setEditClientAccessSelected] = useState<Set<string>>(new Set());
  const [editClientAccessLoading, setEditClientAccessLoading] = useState(false);
  const [editClientAccessSaving, setEditClientAccessSaving] = useState(false);

  const [removeClientUserConfirm, setRemoveClientUserConfirm] = useState<{ open: boolean; userId: string | null; label: string | null }>({
    open: false,
    userId: null,
    label: null,
  });

  useEffect(() => {
    if (!inviteClientUsersClientsMenu) return;

    const getRect = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };

    const syncPosition = () => {
      const el = inviteClientUsersClientsMenuButtonRef.current;
      if (!el) return;
      setInviteClientUsersClientsMenu((prev) => (prev ? { ...prev, rect: getRect(el) } : prev));
    };

    const onDocClick = () => setInviteClientUsersClientsMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInviteClientUsersClientsMenu(null);
    };

    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);

    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [inviteClientUsersClientsMenu]);
  const clientUserMoreMenuButtonRef = useRef<HTMLElement | null>(null);
  const [clientUserMoreMenu, setClientUserMoreMenu] = useState<{
    id: string;
    rect: { top: number; left: number; right: number; bottom: number; width: number; height: number };
  } | null>(null);

  useEffect(() => {
    if (!clientUserMoreMenu) return;

    const getRect = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };

    const syncPosition = () => {
      const el = clientUserMoreMenuButtonRef.current;
      if (!el) return;
      setClientUserMoreMenu((prev) => (prev ? { ...prev, rect: getRect(el) } : prev));
    };

    const onDocClick = () => setClientUserMoreMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setClientUserMoreMenu(null);
    };

    // Capture scroll from any scrollable ancestor.
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);

    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [clientUserMoreMenu]);

  const formatGa4ErrorMessage = useCallback((rawError: string | null): string => {
    if (!rawError) {
      return "GA4 connection failed. Please try again.";
    }

    let decoded = rawError;
    try {
      decoded = decodeURIComponent(rawError);
    } catch {
      // Ignore decode issues and keep the original string
    }

    const normalized = decoded.toLowerCase();
    if (normalized.includes("missing required authentication credential")) {
      return "Google rejected the request because it did not receive a valid OAuth token. Please try reconnecting.";
    }
    if (normalized.includes("access_denied")) {
      return "Access was denied by Google. Make sure this Google account is allowed for this OAuth app (add it as a test user or publish the app).";
    }
    if (normalized.includes("invalid_client")) {
      return "Google could not find this OAuth client. Double-check GA4_CLIENT_ID/SECRET and the redirect URI.";
    }
    if (normalized.includes("invalid_grant")) {
      return "The authorization grant is invalid or has expired. Please restart the GA4 connection flow.";
    }
    return decoded;
  }, []);
  // Helper function to build dashboard API URL with date range
  const buildDashboardUrl = useCallback((clientId: string) => {
    let url = `/seo/dashboard/${clientId}`;
    if (dateRange === "custom") {
      // Validate custom dates before building URL
      if (!customStartDate || !customEndDate) {
        // Fallback to last 30 days if custom dates are not set
        url += `?period=30`;
        return url;
      }
      const start = new Date(customStartDate);
      const end = new Date(customEndDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
        // Fallback to last 30 days if dates are invalid
        url += `?period=30`;
        return url;
      }
      url += `?start=${customStartDate}&end=${customEndDate}`;
    } else {
      url += `?period=${dateRange}`;
    }
    return url;
  }, [dateRange, customStartDate, customEndDate]);

  // Build comparison period (previous period, previous year, or custom) for "Compare To"
  const getComparePeriodParams = useCallback((): { start: string; end: string } | null => {
    if (compareTo === "none") return null;
    if (compareTo === "custom") {
      if (!compareStartDate || !compareEndDate) return null;
      const start = new Date(compareStartDate);
      const end = new Date(compareEndDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return null;
      return { start: compareStartDate, end: compareEndDate };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let periodStart: Date;
    let periodEnd: Date;
    if (dateRange === "custom" && customStartDate && customEndDate) {
      periodStart = new Date(customStartDate);
      periodEnd = new Date(customEndDate);
      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodStart > periodEnd) return null;
    } else {
      const days = Math.max(1, parseInt(dateRange, 10) || 30);
      periodEnd = new Date(today);
      periodStart = new Date(today);
      periodStart.setDate(periodStart.getDate() - days);
    }
    const daysDiff = Math.round((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    let startCompare: Date;
    let endCompare: Date;
    if (compareTo === "previous_year") {
      startCompare = new Date(periodStart);
      startCompare.setFullYear(startCompare.getFullYear() - 1);
      endCompare = new Date(periodEnd);
      endCompare.setFullYear(endCompare.getFullYear() - 1);
    } else {
      endCompare = new Date(periodStart);
      endCompare.setDate(endCompare.getDate() - 1);
      startCompare = new Date(endCompare);
      startCompare.setDate(startCompare.getDate() - daysDiff + 1);
    }
    return {
      start: startCompare.toISOString().split("T")[0],
      end: endCompare.toISOString().split("T")[0],
    };
  }, [compareTo, dateRange, customStartDate, customEndDate, compareStartDate, compareEndDate]);

  const fetchWorkLog = useCallback(async () => {
    if (!clientId) return;
    try {
      setWorkLogLoading(true);
      setWorkLogError(null);
      const res = await api.get(`/tasks/worklog/${clientId}`);
      const tasks = (Array.isArray(res.data) ? res.data : []) as WorkLogTask[];
      setWorkLogTasks(tasks);
    } catch (e: any) {
      console.error("Failed to fetch work log", e);
      setWorkLogError(e?.response?.data?.message || "Failed to load work log.");
      setWorkLogTasks([]);
    } finally {
      setWorkLogLoading(false);
    }
  }, [clientId]);

  const fetchWorkLogRecurringRules = useCallback(() => {
    if (!clientId) return;
    api
      .get("/tasks/recurring")
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setWorkLogRecurringRules(list.filter((r: { clientId?: string | null }) => r.clientId === clientId));
      })
      .catch(() => setWorkLogRecurringRules([]));
  }, [clientId]);

  const workLogRecurringFrequencyLabel = (freq: string) => {
    switch (freq) {
      case "WEEKLY": return "Weekly";
      case "MONTHLY": return "Monthly";
      case "QUARTERLY": return "Quarterly";
      case "SEMIANNUAL": return "Every 6 months";
      default: return freq || "—";
    }
  };

  const handleWorkLogStopRecurrence = async (id: string) => {
    try {
      await api.patch(`/tasks/recurring/${id}/stop`);
      toast.success("Recurrence stopped.");
      fetchWorkLogRecurringRules();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err?.response?.data?.message || "Failed to stop recurrence");
    }
  };

  const handleWorkLogResumeRecurrence = async (id: string) => {
    try {
      await api.patch(`/tasks/recurring/${id}/resume`);
      toast.success("Recurrence resumed.");
      fetchWorkLogRecurringRules();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err?.response?.data?.message || "Failed to resume recurrence");
    }
  };

  const handleWorkLogRemoveRecurrence = (id: string) => {
    setWorkLogRecurringRemoveConfirm({ isOpen: true, ruleId: id });
  };

  const confirmWorkLogRemoveRecurrence = async () => {
    if (!workLogRecurringRemoveConfirm.ruleId) return;
    try {
      await api.delete(`/tasks/recurring/${workLogRecurringRemoveConfirm.ruleId}`);
      toast.success("Recurring task removed.");
      fetchWorkLogRecurringRules();
      setWorkLogRecurringRemoveConfirm({ isOpen: false, ruleId: null });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err?.response?.data?.message || "Failed to remove recurring task");
    }
  };

  useEffect(() => {
    if (activeTab === "dashboard" && dashboardSection === "worklog") {
      fetchWorkLog();
      fetchWorkLogRecurringRules();
    }
  }, [activeTab, dashboardSection, fetchWorkLog, fetchWorkLogRecurringRules]);

  const taskStatusLabel = (s: TaskStatus) => {
    switch (s) {
      case "DONE":
        return "Completed";
      case "IN_PROGRESS":
        return "In Progress";
      case "REVIEW":
        return "In Review";
      case "NEEDS_APPROVAL":
        return "Needs Approval";
      case "CANCELLED":
        return "Cancelled";
      default:
        return "Pending";
    }
  };

  const taskStatusClass = (s: TaskStatus) => {
    switch (s) {
      case "DONE":
        return "bg-green-100 text-green-800";
      case "IN_PROGRESS":
        return "bg-blue-100 text-blue-800";
      case "REVIEW":
        return "bg-purple-100 text-purple-800";
      case "NEEDS_APPROVAL":
        return "bg-amber-100 text-amber-800";
      case "CANCELLED":
        return "bg-red-100 text-red-800";
      default:
        return "bg-yellow-100 text-yellow-800";
    }
  };

  const openWorkLogCreate = () => {
    setWorkLogAddMenuOpen(false);
    setWorkLogModalMode("create");
    setSelectedWorkLogTaskId(null);
    setWorkLogForm({ title: "", description: "", taskNotes: "", category: "", dueDate: "", assigneeId: "", assigneeDisplay: "", status: "TODO", attachments: [], approvalNotifyUserIds: [] });
    setWorkLogUrlInput("");
    setWorkLogUrlType("url");
    setAssignableSearch("");
    setAssignToOpen(false);
    setWorkLogModalOpen(true);
  };

  useEffect(() => {
    if (!workLogAddMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (workLogAddMenuRef.current && !workLogAddMenuRef.current.contains(e.target as Node)) {
        setWorkLogAddMenuOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [workLogAddMenuOpen]);

  const parseProofAttachments = (proof: string | null | undefined): WorkLogAttachment[] => {
    if (!proof || typeof proof !== "string") return [];
    try {
      const arr = JSON.parse(proof);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x: any) => x && typeof x.value === "string")
        .map((x: any) => ({
          type: x.type === "video" ? "video" : x.type === "image" ? "image" : "url",
          value: x.value,
          name: x.name,
        }));
    } catch {
      return [];
    }
  };

  const hydrateWorkLogFormFromTask = useCallback((task: WorkLogTask) => {
    const attachments = parseProofAttachments((task as any).proof);
    const titleForForm = (task.description || task.title || "").trim();
    const dueDateRaw = (task as any).dueDate;
    const dueDateStr = dueDateRaw ? (typeof dueDateRaw === "string" ? dueDateRaw.slice(0, 10) : new Date(dueDateRaw).toISOString().slice(0, 10)) : "";
    const assignee = task.assignee;
    const rawApproval = (task as any).approvalNotifyUserIds;
    const approvalIds: string[] = Array.isArray(rawApproval)
      ? rawApproval
      : (typeof rawApproval === "string"
          ? (() => {
              try {
                const a = JSON.parse(rawApproval);
                return Array.isArray(a) ? a : [];
              } catch {
                return [];
              }
            })()
          : []);
    setWorkLogForm({
      title: titleForForm,
      description: titleForForm,
      taskNotes: (task as any).taskNotes || "",
      category: task.category || "",
      dueDate: dueDateStr,
      assigneeId: assignee?.id ?? "",
      assigneeDisplay: assignee ? (assignee.name || assignee.email || "") : "",
      status: task.status,
      attachments,
      approvalNotifyUserIds: approvalIds,
    });
  }, []);

  const openWorkLogEdit = (taskId: string) => {
    const task = workLogTasks.find((t) => t.id === taskId);
    if (task) hydrateWorkLogFormFromTask(task);
    setWorkLogModalMode("edit");
    setSelectedWorkLogTaskId(taskId);
    setWorkLogUrlInput("");
    setWorkLogUrlType("url");
    setWorkLogModalOpen(true);
  };

  const openWorkLogView = (taskId: string) => {
    const task = workLogTasks.find((t) => t.id === taskId);
    if (task) hydrateWorkLogFormFromTask(task);
    setWorkLogModalMode("view");
    setSelectedWorkLogTaskId(taskId);
    setWorkLogUrlInput("");
    setWorkLogUrlType("url");
    setWorkLogModalOpen(true);
  };

  // Notification deep-link support:
  // /client/dashboard/:clientId?tab=worklog&taskId=xxx
  useEffect(() => {
    if (!clientId) return;
    const urlParams = new URLSearchParams(location.search);
    const tabParam = urlParams.get("tab");
    if (tabParam !== "worklog") return;
    if (activeTab !== "dashboard") setActiveTab("dashboard");
    if (dashboardSection !== "worklog") setDashboardSection("worklog");
  }, [clientId, location.search, activeTab, dashboardSection]);

  useEffect(() => {
    if (!clientId) return;
    const urlParams = new URLSearchParams(location.search);
    const tabParam = urlParams.get("tab");
    const taskId = urlParams.get("taskId");
    if (tabParam !== "worklog" || !taskId) {
      lastAutoOpenedWorkLogTaskIdRef.current = null;
      return;
    }
    if (activeTab !== "dashboard" || dashboardSection !== "worklog") return;
    if (workLogLoading) return;
    if (lastAutoOpenedWorkLogTaskIdRef.current === taskId) return;

    const task = workLogTasks.find((t) => t.id === taskId);
    if (!task) return;

    lastAutoOpenedWorkLogTaskIdRef.current = taskId;
    hydrateWorkLogFormFromTask(task);
    setWorkLogModalMode("edit");
    setSelectedWorkLogTaskId(taskId);
    setWorkLogUrlInput("");
    setWorkLogUrlType("url");
    setWorkLogModalOpen(true);

    const nextParams = new URLSearchParams(location.search);
    nextParams.delete("taskId");
    navigate(
      {
        pathname: location.pathname,
        search: nextParams.toString() ? `?${nextParams.toString()}` : "",
      },
      { replace: true }
    );
  }, [
    clientId,
    location.search,
    location.pathname,
    navigate,
    activeTab,
    dashboardSection,
    workLogLoading,
    workLogTasks,
    hydrateWorkLogFormFromTask,
  ]);

  const handleSaveWorkLog = async () => {
    if (!clientId) return;
    const titleValue = workLogForm.description.trim();
    // Read Task field from DOM so we always save current contenteditable content (state can be stale)
    const taskNotesFromDom = workLogTaskNotesRef.current?.innerHTML?.trim() ?? "";
    const taskNotesValue = (taskNotesFromDom || workLogForm.taskNotes || "").trim() || undefined;
    // Normalize proof for task API: each item must have type "image"|"video"|"url" and value as absolute URL
    const apiOrigin =
      typeof window !== "undefined" && api.defaults.baseURL
        ? new URL(api.defaults.baseURL).origin
        : typeof window !== "undefined"
          ? window.location.origin
          : "";
    const proofItems =
      workLogForm.attachments.length > 0
        ? workLogForm.attachments
            .filter((a) => a && typeof a.value === "string" && a.value.trim())
            .map((a) => {
              const type = a.type === "video" ? "video" : a.type === "image" ? "image" : "url";
              let value = a.value.trim();
              if (!value.startsWith("http://") && !value.startsWith("https://") && apiOrigin) {
                value = value.startsWith("/") ? `${apiOrigin}${value}` : `${apiOrigin}/${value}`;
              }
              return { type, value, name: a.name };
            })
            .filter((a) => /^https?:\/\//.test(a.value))
        : undefined;

    const payload: Record<string, unknown> = {
      title: titleValue,
      description: titleValue || undefined,
      taskNotes: taskNotesValue,
      category: workLogForm.category.trim() || undefined,
      dueDate: workLogForm.dueDate.trim() ? workLogForm.dueDate.trim() : undefined,
      assigneeId: workLogForm.assigneeId.trim() || undefined,
      status: workLogForm.status,
      clientId,
      proof: proofItems ?? [],
    };
    if (workLogForm.status === "NEEDS_APPROVAL" && workLogForm.approvalNotifyUserIds?.length) {
      payload.approvalNotifyUserIds = workLogForm.approvalNotifyUserIds;
    }

    if (!titleValue) {
      toast.error("Title is required.");
      return;
    }

    try {
      if (workLogModalMode === "create") {
        await api.post("/tasks", payload);
        toast.success("Work log entry created.");
      } else if (workLogModalMode === "edit" && selectedWorkLogTaskId) {
        await api.put(`/tasks/${selectedWorkLogTaskId}`, payload);
        toast.success("Work log entry updated.");
      }
      setWorkLogModalOpen(false);
      await fetchWorkLog();
    } catch (e: any) {
      console.error("Work log save failed", e);
      toast.error(e?.response?.data?.message || "Failed to save work log entry.");
    }
  };

  const handleDeleteWorkLog = (taskId: string, taskTitle?: string | null) => {
    setWorkLogDeleteConfirm({
      isOpen: true,
      taskId,
      taskTitle: taskTitle ?? null,
    });
  };

  const confirmDeleteWorkLog = async () => {
    const taskId = workLogDeleteConfirm.taskId;
    if (!taskId) return;
    try {
      await api.delete(`/tasks/${taskId}`);
      toast.success("Work log entry deleted.");
      await fetchWorkLog();
    } catch (e: any) {
      console.error("Work log delete failed", e);
      toast.error(e?.response?.data?.message || "Failed to delete work log entry.");
    } finally {
      setWorkLogDeleteConfirm({ isOpen: false, taskId: null, taskTitle: null });
      // If the user deleted the entry they were editing/viewing, close the modal.
      if (selectedWorkLogTaskId === taskId) {
        setWorkLogModalOpen(false);
        setSelectedWorkLogTaskId(null);
      }
    }
  };

  const selectedWorkLogTask = workLogTasks.find((t) => t.id === selectedWorkLogTaskId);
  useEffect(() => {
    if (!workLogModalOpen) return;
    if (!selectedWorkLogTaskId) return;
    if (workLogModalMode === "create") return;
    const task = workLogTasks.find((t) => t.id === selectedWorkLogTaskId);
    if (task) hydrateWorkLogFormFromTask(task);
  }, [workLogModalOpen, workLogModalMode, selectedWorkLogTaskId, workLogTasks, hydrateWorkLogFormFromTask]);
  const isClientWorkLogUser = user?.role === "USER";
  const isAdminViewingSuperAdminWorkLog =
    user?.role === "ADMIN" && selectedWorkLogTask?.createdBy?.role === "SUPER_ADMIN";
  const isAgencyViewingAdminOrSuperAdminWorkLog =
    user?.role === "AGENCY" &&
    (selectedWorkLogTask?.createdBy?.role === "SUPER_ADMIN" || selectedWorkLogTask?.createdBy?.role === "ADMIN");
  const isWorkLogFieldsReadOnly =
    workLogModalMode === "view" ||
    isClientWorkLogUser ||
    isAdminViewingSuperAdminWorkLog ||
    isAgencyViewingAdminOrSuperAdminWorkLog;
  const canEditSelectedWorkLog =
    !isClientWorkLogUser && (user?.role === "SUPER_ADMIN" || selectedWorkLogTask?.createdBy?.id === user?.id);
  const canCommentOnWorkLog =
    Boolean(user) && workLogModalMode !== "view";

  const fetchWorkLogComments = useCallback(async (taskId: string) => {
    try {
      setWorkLogCommentsLoading(true);
      const res = await api.get(`/tasks/${taskId}/comments`, { timeout: 30000 });
      setWorkLogComments(Array.isArray(res.data) ? (res.data as WorkLogComment[]) : []);
      setWorkLogCommentsError(null);
    } catch (e: any) {
      console.error("Failed to fetch work log activity", e);
      setWorkLogComments([]);
      setWorkLogCommentsError(e?.response?.data?.message || "Failed to load activity");
    } finally {
      setWorkLogCommentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!workLogModalOpen || workLogModalMode === "create" || !selectedWorkLogTaskId) {
      setWorkLogComments([]);
      setWorkLogCommentsError(null);
      setWorkLogNewComment("");
      setWorkLogMentionQuery("");
      setWorkLogMentionRange(null);
      setWorkLogMentionedUserIds([]);
      setWorkLogMentionActiveIndex(0);
      return;
    }
    void fetchWorkLogComments(selectedWorkLogTaskId);
  }, [workLogModalOpen, workLogModalMode, selectedWorkLogTaskId, fetchWorkLogComments]);

  const updateWorkLogMentionState = useCallback(
    (value: string, caret: number) => {
      const safeCaret = Math.max(0, Math.min(caret, value.length));
      const beforeCaret = value.slice(0, safeCaret);
      const atIndex = beforeCaret.lastIndexOf("@");
      if (atIndex === -1) {
        setWorkLogMentionRange(null);
        setWorkLogMentionQuery("");
        return;
      }

      const prevChar = atIndex > 0 ? beforeCaret[atIndex - 1] : " ";
      if (!/\s|[\(\[\{,]/.test(prevChar)) {
        setWorkLogMentionRange(null);
        setWorkLogMentionQuery("");
        return;
      }

      const query = beforeCaret.slice(atIndex + 1);
      if (!/^[A-Za-z0-9._-]*$/.test(query)) {
        setWorkLogMentionRange(null);
        setWorkLogMentionQuery("");
        return;
      }

      setWorkLogMentionRange({ start: atIndex, end: safeCaret });
      setWorkLogMentionQuery(query.toLowerCase());
    },
    []
  );

  const handleWorkLogCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setWorkLogNewComment(next);
    updateWorkLogMentionState(next, e.target.selectionStart ?? next.length);
  };

  const buildWorkLogMentionToken = useCallback((member: { id: string; name: string | null; email: string }) => {
    const base =
      (member.name && member.name.trim()) ||
      (member.email.includes("@") ? member.email.split("@")[0] : member.email) ||
      "user";
    const normalized = base
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return normalized || `user_${member.id.slice(0, 6).toLowerCase()}`;
  }, []);

  const handleSelectWorkLogMention = (member: { id: string; name: string | null; email: string }) => {
    if (!workLogMentionRange) return;
    const base = workLogNewComment;
    const mentionText = `@${buildWorkLogMentionToken(member)} `;
    const next =
      base.slice(0, workLogMentionRange.start) +
      mentionText +
      base.slice(workLogMentionRange.end);
    const nextCaret = workLogMentionRange.start + mentionText.length;
    setWorkLogNewComment(next);
    setWorkLogMentionRange(null);
    setWorkLogMentionQuery("");
    setWorkLogMentionActiveIndex(0);
    setWorkLogMentionedUserIds((prev) => (prev.includes(member.id) ? prev : [...prev, member.id]));
    requestAnimationFrame(() => {
      if (workLogCommentInputRef.current) {
        workLogCommentInputRef.current.focus();
        workLogCommentInputRef.current.setSelectionRange(nextCaret, nextCaret);
      }
    });
  };

  const handlePostWorkLogComment = async () => {
    if (!selectedWorkLogTaskId) return;
    const body = workLogNewComment.trim();
    if (!body) return;
    const mentionTokenToId = new Map(
      workLogProjectAssignees.map((member) => [buildWorkLogMentionToken(member), member.id] as const)
    );
    const bodyMentionIds = Array.from(
      new Set(
        (body.match(/@([A-Za-z0-9._-]+)/g) || [])
          .map((raw) => raw.slice(1).toLowerCase())
          .map((token) => mentionTokenToId.get(token))
          .filter((id): id is string => Boolean(id))
      )
    );
    const mentionUserIds = Array.from(
      new Set([...(workLogMentionedUserIds || []), ...bodyMentionIds])
    ).filter((id) => id !== user?.id);
    try {
      setPostingWorkLogComment(true);
      const res = await api.post(
        `/tasks/${selectedWorkLogTaskId}/comments`,
        { body, type: "COMMENT", mentionUserIds },
        { timeout: 30000 },
      );
      const created = res.data as WorkLogComment;
      setWorkLogComments((prev) => [...prev, created]);
      setWorkLogNewComment("");
      setWorkLogMentionQuery("");
      setWorkLogMentionRange(null);
      setWorkLogMentionedUserIds([]);
      setWorkLogMentionActiveIndex(0);
      setWorkLogCommentsError(null);
    } catch (e: any) {
      console.error("Failed to post work log activity", e);
      toast.error(e?.response?.data?.message || "Failed to post activity");
    } finally {
      setPostingWorkLogComment(false);
    }
  };

  const requestDeleteWorkLogComment = (commentId: string) => {
    setWorkLogCommentDeleteConfirm({ isOpen: true, commentId });
  };

  const confirmDeleteWorkLogComment = async () => {
    if (!selectedWorkLogTaskId || !workLogCommentDeleteConfirm.commentId) return;
    try {
      await api.delete(`/tasks/${selectedWorkLogTaskId}/comments/${workLogCommentDeleteConfirm.commentId}`, { timeout: 30000 });
      setWorkLogComments((prev) => prev.filter((c) => c.id !== workLogCommentDeleteConfirm.commentId));
      toast.success("Activity removed.");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to delete activity");
    } finally {
      setWorkLogCommentDeleteConfirm({ isOpen: false, commentId: null });
    }
  };

  const handleWorkLogFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setWorkLogUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }

      const response = await api.post("/upload/worklog", formData);
      const uploadedFiles = Array.isArray(response.data) ? response.data : [response.data];
      const items: WorkLogAttachment[] = uploadedFiles
        .filter((raw: any) => raw && typeof raw.value === "string")
        .map((raw: any) => ({ type: "url", value: raw.value, name: raw.name }));

      if (items.length > 0) {
        setWorkLogForm((prev) => ({ ...prev, attachments: [...prev.attachments, ...items] }));
        toast.success(items.length === 1 ? "File uploaded successfully!" : "Files uploaded successfully!");
      }
    } catch (err: any) {
      console.error("Work log upload error", err);
      toast.error(err?.response?.data?.message || "Failed to upload file(s).");
    } finally {
      setWorkLogUploading(false);
      e.target.value = "";
    }
  };

  const removeWorkLogAttachment = (index: number) => {
    setWorkLogForm((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index),
    }));
  };

  const handleWorkLogAddUrl = () => {
    const trimmed = workLogUrlInput.trim();
    if (!trimmed) return;
    try {
      new URL(trimmed);
      setWorkLogForm((prev) => ({
        ...prev,
        attachments: [
          ...prev.attachments,
          { type: workLogUrlType, value: trimmed, name: trimmed },
        ],
      }));
      setWorkLogUrlInput("");
      toast.success("URL added.");
    } catch {
      toast.error("Please enter a valid URL.");
    }
  };

  useEffect(() => {
    dashboardExportReadyRef.current = {
      refreshingDashboard,
      refreshingTopPages,
      refreshingBacklinks,
      fetchingSummary,
    };
  }, [refreshingDashboard, refreshingTopPages, refreshingBacklinks, fetchingSummary]);

  const handleExportPdf = useCallback(async () => {
    if (!dashboardContentRef.current) {
      toast.error("Switch to the Dashboard tab to export.");
      return;
    }

    if (activeTab !== "dashboard") {
      toast.error("Please switch to the Dashboard tab before exporting.");
      return;
    }

    if (dashboardSection === "ppc") {
      if (!clientId) {
        toast.error("Client ID is missing");
        return;
      }
      try {
        setExportingPdf(true);
        const pdfRes = await api.get(`/seo/reports/${clientId}/ppc/latest-pdf`, {
          params: { period: "monthly" },
          responseType: "blob",
          _silent: true,
        } as any);
        const blob =
          pdfRes?.data instanceof Blob
            ? pdfRes.data
            : new Blob([pdfRes?.data], { type: "application/pdf" });
        const headerValue = String(pdfRes?.headers?.["content-disposition"] || "");
        const filenameMatch = /filename="?([^"]+)"?/i.exec(headerValue);
        const fallbackName = `${(client?.name || "client").replace(/\s+/g, "-").toLowerCase()}-ppc-report-${format(new Date(), "yyyyMMdd")}.pdf`;
        const fileName = filenameMatch?.[1] || fallbackName;
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
        toast.success("PPC dashboard exported successfully!");
      } catch (error: any) {
        console.error("Failed to export PPC dashboard PDF", error);
        toast.error(error?.response?.data?.message || error?.message || "Failed to export PPC dashboard PDF.");
      } finally {
        setExportingPdf(false);
      }
      return;
    }

    const element = dashboardContentRef.current;
    const previousOverflow = document.body.style.overflow;
    const outerScrollEl = dashboardOuterScrollRef.current;
    const rightScrollEl = dashboardRightPanelScrollRef.current;

    const prevOuterScrollTop = outerScrollEl?.scrollTop ?? 0;
    const prevRightScrollTop = rightScrollEl?.scrollTop ?? 0;

    const prevOuterStyle = outerScrollEl
      ? { overflow: outerScrollEl.style.overflow, height: outerScrollEl.style.height, maxHeight: outerScrollEl.style.maxHeight }
      : null;
    const prevRightStyle = rightScrollEl
      ? { overflow: rightScrollEl.style.overflow, height: rightScrollEl.style.height, maxHeight: rightScrollEl.style.maxHeight }
      : null;

    try {
      setExportingPdf(true);

      const maxWaitMs = 60000;
      const pollIntervalMs = 400;
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        const r = dashboardExportReadyRef.current;
        if (!r.refreshingDashboard && !r.refreshingTopPages && !r.refreshingBacklinks && !r.fetchingSummary) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      const stillLoading = dashboardExportReadyRef.current;
      if (stillLoading.refreshingDashboard || stillLoading.refreshingTopPages || stillLoading.refreshingBacklinks || stillLoading.fetchingSummary) {
        toast.error("Export timed out. Please wait for the dashboard to finish loading and try again.");
        setExportingPdf(false);
        return;
      }

      document.body.style.overflow = "hidden";
      element.classList.add("pdf-exporting");

      // Ensure we capture from the top and avoid clipped overflow containers.
      if (outerScrollEl) outerScrollEl.scrollTop = 0;
      if (rightScrollEl) rightScrollEl.scrollTop = 0;

      if (outerScrollEl) {
        outerScrollEl.style.overflow = "visible";
        outerScrollEl.style.height = "auto";
        outerScrollEl.style.maxHeight = "none";
      }
      if (rightScrollEl) {
        rightScrollEl.style.overflow = "visible";
        rightScrollEl.style.height = "auto";
        rightScrollEl.style.maxHeight = "none";
      }

      // Allow layout to settle and paint before snapshotting (longer delay so export captures finished content).
      await new Promise((resolve) => setTimeout(resolve, 800));

      const ignoreFilter = (el: Element) => {
        if (el.getAttribute?.("data-pdf-hide") === "true") return true;
        if (el.classList?.contains?.("cursor-help")) return true;
        return false;
      };
      const sectionHost = rightScrollEl?.firstElementChild as HTMLElement | null;
      const sections: HTMLElement[] =
        sectionHost && sectionHost.children.length > 0
          ? Array.from(sectionHost.children).filter((node): node is HTMLElement => node instanceof HTMLElement)
          : [element];
      if (sections.length === 0) {
        toast.error("No sections found to export.");
        setExportingPdf(false);
        return;
      }

      const sectionCanvases: HTMLCanvasElement[] = [];
      for (const sec of sections) {
        const cvs = await html2canvas(sec, {
          scale: 2,
          useCORS: true,
          logging: false,
          scrollX: 0,
          scrollY: 0,
          backgroundColor: "#FFFFFF",
          ignoreElements: ignoreFilter,
        });
        sectionCanvases.push(cvs);
      }

      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const websiteName = client?.name || client?.domain || "Dashboard";
      const domain = client?.domain || "";
      const sectionLabelMap: Record<string, string> = {
        seo: "SEO Overview",
        "ai-intelligence": "AI Intelligence",
        "local-map": "Local Map Rankings",
        ppc: "PPC",
        backlinks: "Backlinks",
        worklog: "Work Log",
      };
      const activeSectionLabel = sectionLabelMap[dashboardSection] || "Dashboard";
      const generatedDate = format(new Date(), "MMMM d, yyyy");
      const periodLabel =
        dateRange === "7"
          ? "Last 7 Days"
          : dateRange === "90"
          ? "Last 90 Days"
          : dateRange === "365"
          ? "Last Year"
          : "Last 30 Days";

      const marginX = 12;
      const headerH = 16;
      const footerH = 10;
      const contentMarginTop = headerH + 3;
      const contentMarginBottom = footerH + 2;
      const usableWidth = pageWidth - marginX * 2;
      const usableHeight = pageHeight - contentMarginTop - contentMarginBottom;

      const drawHeader = () => {
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, pageWidth, headerH, "F");
        pdf.setFillColor(59, 130, 246);
        pdf.rect(0, headerH, pageWidth, 0.8, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(11);
        pdf.setTextColor(255, 255, 255);
        pdf.text(websiteName, marginX, 7);
        if (domain) {
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(8);
          pdf.setTextColor(148, 163, 184);
          pdf.text(domain, marginX, 12);
        }
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(148, 163, 184);
        pdf.text(periodLabel, pageWidth - marginX, 7, { align: "right" });
        pdf.text(generatedDate, pageWidth - marginX, 12, { align: "right" });
      };

      const drawFooter = (pageNum: number, totalPages: number) => {
        const footerY = pageHeight - footerH / 2;
        pdf.setDrawColor(226, 232, 240);
        pdf.setLineWidth(0.3);
        pdf.line(marginX, pageHeight - footerH, pageWidth - marginX, pageHeight - footerH);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth / 2, footerY, { align: "center" });
        pdf.setFontSize(7);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Generated ${generatedDate}`, marginX, footerY);
        pdf.text("Confidential", pageWidth - marginX, footerY, { align: "right" });
      };

      // Cover page (same style as Share Dashboard)
      pdf.setFillColor(15, 23, 42);
      pdf.rect(0, 0, pageWidth, pageHeight, "F");
      pdf.setFillColor(59, 130, 246);
      pdf.rect(0, 0, pageWidth, 3, "F");
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(148, 163, 184);
      const labelY = pageHeight * 0.32;
      pdf.text("SEO PERFORMANCE REPORT", pageWidth / 2, labelY, { align: "center" });
      const lineW = 50;
      pdf.setDrawColor(59, 130, 246);
      pdf.setLineWidth(0.6);
      pdf.line(pageWidth / 2 - lineW / 2, labelY + 4, pageWidth / 2 + lineW / 2, labelY + 4);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(28);
      pdf.setTextColor(255, 255, 255);
      pdf.text(websiteName, pageWidth / 2, labelY + 18, { align: "center" });
      if (domain) {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(12);
        pdf.setTextColor(148, 163, 184);
        pdf.text(domain, pageWidth / 2, labelY + 28, { align: "center" });
      }
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`${activeSectionLabel}  ·  ${periodLabel}  ·  ${generatedDate}`, pageWidth / 2, labelY + 42, { align: "center" });
      pdf.setFillColor(59, 130, 246);
      pdf.rect(0, pageHeight - 3, pageWidth, 3, "F");

      // Section-based content pagination (Share Dashboard behavior)
      const sectionGap = 4;
      const sectionNaturalHeights = sectionCanvases.map((cvs) => (cvs.height * usableWidth) / cvs.width);
      const sectionHeights = sectionNaturalHeights.map((h) => Math.min(h, usableHeight));
      const sectionScales = sectionNaturalHeights.map((h) => (h > usableHeight ? usableHeight / h : 1));

      const pageAssignments: { pageIdx: number; cursorY: number; sectionIdx: number }[] = [];
      let curPage = 0;
      let cursorY = 0;
      for (let i = 0; i < sectionCanvases.length; i++) {
        const h = sectionHeights[i];
        const fitsOnCurrentPage = cursorY === 0 || cursorY + sectionGap + h <= usableHeight;
        if (!fitsOnCurrentPage) {
          curPage++;
          cursorY = 0;
        }
        const yPos = cursorY === 0 ? 0 : cursorY + sectionGap;
        pageAssignments.push({ pageIdx: curPage, cursorY: yPos, sectionIdx: i });
        cursorY = yPos + h;
      }
      const totalContentPages = curPage + 1;
      const totalPages = 1 + totalContentPages;

      let currentPageRendered = -1;
      for (const assignment of pageAssignments) {
        if (assignment.pageIdx !== currentPageRendered) {
          pdf.addPage();
          drawHeader();
          currentPageRendered = assignment.pageIdx;
        }

        const idx = assignment.sectionIdx;
        const scale = sectionScales[idx];
        const imgW = usableWidth * scale;
        const imgH = sectionHeights[idx];
        const imgX = marginX + (usableWidth - imgW) / 2;
        const imgData = sectionCanvases[idx].toDataURL("image/png");
        pdf.addImage(imgData, "PNG", imgX, contentMarginTop + assignment.cursorY, imgW, imgH);
      }

      for (let p = 0; p < totalContentPages; p++) {
        pdf.setPage(p + 2);
        drawFooter(p + 2, totalPages);
      }

      // Cover page footer
      pdf.setPage(1);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Page 1 of ${totalPages}`, pageWidth / 2, pageHeight - 8, { align: "center" });

      const sectionSlugMap: Record<string, string> = {
        seo: "seo-overview",
        "ai-intelligence": "ai-intelligence",
        "local-map": "local-map-rankings",
        ppc: "ppc",
        backlinks: "backlinks",
        worklog: "work-log",
      };
      const sectionSlug = sectionSlugMap[dashboardSection] || "dashboard";
      const sanitizedName = client?.name ? client.name.replace(/\s+/g, "-").toLowerCase() : "client-dashboard";
      const fileName = `${sanitizedName}-${sectionSlug}-report-${format(new Date(), "yyyyMMdd")}.pdf`;
      pdf.save(fileName);
      toast.success("Dashboard exported successfully!");
    } catch (error: any) {
      console.error("Failed to export dashboard PDF", error);
      toast.error(error?.message || "Failed to export dashboard PDF. Please try again.");
    } finally {
      document.body.style.overflow = previousOverflow;
      element.classList.remove("pdf-exporting");
      if (outerScrollEl && prevOuterStyle) {
        outerScrollEl.style.overflow = prevOuterStyle.overflow;
        outerScrollEl.style.height = prevOuterStyle.height;
        outerScrollEl.style.maxHeight = prevOuterStyle.maxHeight;
        outerScrollEl.scrollTop = prevOuterScrollTop;
      }
      if (rightScrollEl && prevRightStyle) {
        rightScrollEl.style.overflow = prevRightStyle.overflow;
        rightScrollEl.style.height = prevRightStyle.height;
        rightScrollEl.style.maxHeight = prevRightStyle.maxHeight;
        rightScrollEl.scrollTop = prevRightScrollTop;
      }
      setExportingPdf(false);
    }
  }, [activeTab, client?.name, client?.domain, clientId, dateRange, dashboardSection]);

  const handleRefreshDashboard = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!clientId) return;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user?.role || "")) return;
    try {
      setRefreshingDashboard(true);
      setGa4ConnectionError(null); // Clear any previous errors
      const refreshRes = await api.post(`/seo/dashboard/${clientId}/refresh`);
      
      // Show success message with details
      const refreshData = refreshRes.data || {};
      let successMessage = "Dashboard data refreshed successfully!";
      if (refreshData.ga4Refreshed) {
        successMessage += " GA4 data updated.";
      }
      if (!silent) toast.success(successMessage);
      
      // Refetch dashboard data (this will get fresh DataForSEO and GA4 data)
      const res = await api.get(buildDashboardUrl(clientId), { timeout: DASHBOARD_REQUEST_TIMEOUT_MS });
      const payload = res.data || {};
      const payloadSummary = formatDashboardSummary(payload);
      const isGA4Connected = payload?.isGA4Connected || false;
      const dataSource = payload?.dataSources?.traffic || "none";
      
      // Validate GA4 connection after refresh
      if (isGA4Connected && dataSource !== "ga4") {
        // Check actual GA4 status
        try {
          const statusRes = await api.get(`/clients/${clientId}/ga4/status`);
          const actualStatus = statusRes.data?.connected || false;
          setGa4Connected(actualStatus);
          
          if (!actualStatus) {
            setGa4ConnectionError("GA4 connection appears to be invalid. Please reconnect GA4 to get fresh data.");
            // Keep last known values on transient status mismatch to avoid flashing 0/empty.
            setDashboardSummary((prev) => prev ?? payloadSummary);
          } else {
            setDashboardSummary((prev) => {
              const payloadWebVisitors = Number(payloadSummary.totalUsers ?? payloadSummary.activeUsers ?? 0) || 0;
              const payloadLooksEmpty =
                payloadWebVisitors === 0 &&
                (Number(payloadSummary.newUsers ?? 0) || 0) === 0 &&
                (Number(payloadSummary.eventCount ?? 0) || 0) === 0 &&
                (Number(payloadSummary.totalSessions ?? 0) || 0) === 0;
              const prevWebVisitors = Number(prev?.totalUsers ?? prev?.activeUsers ?? 0) || 0;
              if (payloadLooksEmpty && prevWebVisitors > 0) return prev;
              return payloadSummary;
            });
          }
        } catch (statusError) {
          console.warn("Failed to refresh GA4 status:", statusError);
          // Keep current GA4 state + metrics if status check fails transiently.
          setGa4ConnectionError(null);
          setDashboardSummary((prev) => prev ?? payloadSummary);
        }
      } else {
        setGa4Connected(isGA4Connected);
        setDashboardSummary(payloadSummary);
      }
      
      // Refetch top events and visitor sources from database
      // Note: These functions are called directly, not via dependency to avoid circular dependencies
      try {
        const topEventsParams: any = { limit: 10 };
        if (dateRange === "custom" && customStartDate && customEndDate) {
          topEventsParams.start = customStartDate;
          topEventsParams.end = customEndDate;
        } else {
          topEventsParams.period = dateRange;
        }
        const topEventsRes = await api.get(`/seo/events/${clientId}/top`, { params: { ...topEventsParams, type: "keyEvents" } });
        setTopEvents(Array.isArray(topEventsRes.data) ? topEventsRes.data : []);
      } catch (err) {
        console.warn("Failed to refresh top events:", err);
      }
      
      try {
        const visitorSourcesParams: any = { limit: 10 };
        if (dateRange === "custom" && customStartDate && customEndDate) {
          visitorSourcesParams.start = customStartDate;
          visitorSourcesParams.end = customEndDate;
        } else {
          visitorSourcesParams.period = dateRange;
        }
        const visitorSourcesRes = await api.get(`/seo/visitor-sources/${clientId}`, { params: visitorSourcesParams });
        setVisitorSources(Array.isArray(visitorSourcesRes.data) ? visitorSourcesRes.data : []);
      } catch (err) {
        console.warn("Failed to refresh visitor sources:", err);
      }

      // Ensure SEO widgets (Target/Ranked keywords) refetch after dashboard refresh.
      setSeoOverviewWidgetsRefreshKey((k) => k + 1);
    } catch (error: any) {
      if (!silent) toast.error(error.response?.data?.message || "Failed to refresh dashboard data");
      
      // If error is GA4-related, mark connection as invalid
      if (error?.response?.data?.message?.toLowerCase().includes("ga4") || 
          error?.response?.data?.message?.toLowerCase().includes("token")) {
        setGa4Connected(false);
        setGa4ConnectionError("GA4 connection error during refresh. Please reconnect GA4.");
      }
    } finally {
      setRefreshingDashboard(false);
    }
  }, [clientId, buildDashboardUrl, dateRange, customStartDate, customEndDate, user?.role]);

  const handleRefreshTopPages = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!clientId) return;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user?.role || "")) return;
    try {
      setRefreshingTopPages(true);
      const refreshRes = await api.post(`/seo/top-pages/${clientId}/refresh`);
      const skipped = Boolean(refreshRes?.data?.skipped);
      const message = String(refreshRes?.data?.message || "").trim();

      if (skipped) {
        if (!silent) toast(message || "Using cached top pages data (refresh limited to every 48 hours).");
      } else {
        if (!silent) toast.success(message || "Top pages refreshed successfully!");
      }

      // Refetch top pages (same formatting as initial load)
      const res = await api.get(`/seo/top-pages/${clientId}`, { params: { limit: 10 } });
      const data = Array.isArray(res.data) ? res.data : [];
      const formatted = data.map((item: any) => ({
        url: item?.url || item?.page_address || "",
        keywords: Number(item?.organic?.count ?? item?.metrics?.organic?.count ?? 0),
        estimatedTraffic: Number(item?.organic?.etv ?? item?.metrics?.organic?.etv ?? 0),
        top1: Number(item?.organic?.pos1 ?? item?.metrics?.organic?.pos_1 ?? 0),
        top3: Number(item?.organic?.pos2_3 ?? item?.metrics?.organic?.pos_2_3 ?? 0),
        top10: Number(item?.organic?.pos4_10 ?? item?.metrics?.organic?.pos_4_10 ?? 0),
        newKeywords: Number(item?.organic?.isNew ?? item?.metrics?.organic?.is_new ?? 0),
        upKeywords: Number(item?.organic?.isUp ?? item?.metrics?.organic?.is_up ?? 0),
        downKeywords: Number(item?.organic?.isDown ?? item?.metrics?.organic?.is_down ?? 0),
        lostKeywords: Number(item?.organic?.isLost ?? item?.metrics?.organic?.is_lost ?? 0),
        paidTraffic: Number(item?.paid?.etv ?? item?.metrics?.paid?.etv ?? 0),
      }));

      setTopPages(formatted);
      setTopPagesError(null);
    } catch (error: any) {
      if (!silent) toast.error(error.response?.data?.message || "Failed to refresh top pages");
    } finally {
      setRefreshingTopPages(false);
    }
  }, [clientId, user?.role]);

  const fetchBacklinksForChart = useCallback(async () => {
    if (!clientId) return;

    const paramsBase = {
      days: 28, // last 4 weeks
      limit: 5000,
      sortBy: "domainRating",
      order: "desc",
    } as const;

    const fetchBoth = async () => {
      const [newRes, lostRes] = await Promise.all([
        api.get(`/seo/backlinks/${clientId}`, { params: { ...paramsBase, filter: "new" } }),
        api.get(`/seo/backlinks/${clientId}`, { params: { ...paramsBase, filter: "lost" } }),
      ]);
      const newRows = Array.isArray(newRes.data) ? (newRes.data as BacklinkRow[]) : [];
      const lostRows = Array.isArray(lostRes.data) ? (lostRes.data as BacklinkRow[]) : [];
      return { newRows, lostRows };
    };

    try {
      setBacklinksForChartLoading(true);
      const { newRows, lostRows } = await fetchBoth();
      setBacklinksForChart({ newRows, lostRows });
      setBacklinksForChartError(null);

      // If DB is empty, auto-refresh once for SUPER_ADMIN to populate data (throttled server-side).
      if (
        newRows.length === 0 &&
        lostRows.length === 0 &&
        user?.role === "SUPER_ADMIN" &&
        !autoDataForSeoAttemptedRef.current.backlinks[clientId]
      ) {
        autoDataForSeoAttemptedRef.current.backlinks[clientId] = true;
        try {
          await api.post(`/seo/backlinks/${clientId}/refresh`);
          const refreshed = await fetchBoth();
          setBacklinksForChart(refreshed);
          setBacklinksForChartError(null);
        } catch (refreshError) {
          console.warn("Auto-refresh backlinks skipped/failed", refreshError);
        }
      }
    } catch (error: any) {
      console.error("Failed to fetch backlinks chart rows", error);
      setBacklinksForChart({ newRows: [], lostRows: [] });
      const errorMsg = error?.response?.data?.message || "Unable to load backlink trends";
      setBacklinksForChartError(errorMsg);
    } finally {
      setBacklinksForChartLoading(false);
    }
  }, [clientId, user?.role]);

  useEffect(() => {
    void fetchBacklinksForChart();
  }, [fetchBacklinksForChart]);

  const handleRefreshBacklinks = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!clientId) return;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user?.role || "")) return;
    try {
      setRefreshingBacklinks(true);
      const refreshRes = await api.post(`/seo/backlinks/${clientId}/refresh`);
      const skipped = Boolean(refreshRes?.data?.skipped);
      const message = String(refreshRes?.data?.message || "").trim();

      if (skipped) {
        if (!silent) toast(message || "Using cached backlinks data (refresh limited to every 48 hours).");
      } else {
        if (!silent) toast.success(message || "Backlinks refreshed successfully!");
      }

      // Refetch chart rows (built from backlink rows; matches the table)
      await fetchBacklinksForChart();

      // Also refresh the backlinks table if it's being viewed
      if (activeTab === "dashboard" && dashboardSection === "backlinks") {
        try {
          const daysForList = backlinksFilter === "new" ? 28 : 365;
          const listRes = await api.get(`/seo/backlinks/${clientId}`, {
            params: { filter: backlinksFilter, days: daysForList, limit: 5000, sortBy: backlinksSortBy, order: backlinksOrder },
          });
          const list = Array.isArray(listRes.data) ? (listRes.data as BacklinkRow[]) : [];
          setBacklinks(list);
          setBacklinksError(null);
        } catch (listErr: any) {
          console.warn("Failed to refresh backlinks list", listErr);
        }
      }
    } catch (error: any) {
      if (!silent) toast.error(error.response?.data?.message || "Failed to refresh backlinks");
    } finally {
      setRefreshingBacklinks(false);
    }
  }, [activeTab, backlinksFilter, backlinksSortBy, backlinksOrder, clientId, dashboardSection, fetchBacklinksForChart, user?.role]);

  const refreshedOnOpenByClientRef = useRef<Record<string, boolean>>({});
  const getAutoRefreshStorageKey = useCallback(() => {
    const userId = (user as any)?.id ? String((user as any).id) : "anonymous";
    return `client-dashboard-auto-refresh-once:${userId}`;
  }, [user]);

  const hasClientBeenAutoRefreshed = useCallback(
    (id: string): boolean => {
      if (refreshedOnOpenByClientRef.current[id]) return true;
      try {
        const raw = localStorage.getItem(getAutoRefreshStorageKey());
        if (!raw) return false;
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        return Boolean(parsed?.[id]);
      } catch {
        return false;
      }
    },
    [getAutoRefreshStorageKey]
  );

  const markClientAutoRefreshed = useCallback(
    (id: string) => {
      refreshedOnOpenByClientRef.current[id] = true;
      try {
        const key = getAutoRefreshStorageKey();
        const raw = localStorage.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
        parsed[id] = true;
        localStorage.setItem(key, JSON.stringify(parsed));
      } catch {
        // Ignore storage errors; in-memory guard still prevents duplicate refreshes this session.
      }
    },
    [getAutoRefreshStorageKey]
  );

  useEffect(() => {
    if (!clientId) return;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user?.role || "")) return;
    if (hasClientBeenAutoRefreshed(clientId)) return;
    markClientAutoRefreshed(clientId);

    const run = async () => {
      await Promise.allSettled([
        handleRefreshDashboard({ silent: true }),
        handleRefreshTopPages({ silent: true }),
        handleRefreshBacklinks({ silent: true }),
      ]);
    };
    void run();
  }, [clientId, user?.role, handleRefreshDashboard, handleRefreshTopPages, handleRefreshBacklinks, hasClientBeenAutoRefreshed, markClientAutoRefreshed]);

  const handleShare = useCallback(async () => {
    if (!clientId) return;
    try {
      setSharing(true);
      const res = await api.post(`/seo/share-link/${clientId}`);
      const token = res.data?.token;
      if (!token) {
        toast.error("Failed to generate share link");
        return;
      }
      const url = `${window.location.origin}/share/${encodeURIComponent(token)}`;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.success("Shareable link copied to clipboard!");
        // Also show the URL so the user can see/open it
        toast.custom((t) => (
          <div className={`max-w-xl w-full bg-white shadow-xl rounded-xl border-2 border-primary-200 overflow-hidden ${t.visible ? "animate-enter" : "animate-leave"}`}>
            <div className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 px-4 py-3 border-b border-primary-200">
              <p className="text-sm font-semibold text-primary-800">Share link generated</p>
            </div>
            <div className="p-4">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary-600 hover:text-primary-800 hover:underline break-all font-medium"
              >
                {url}
              </a>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                  onClick={async () => {
                    await navigator.clipboard.writeText(url);
                    toast.success("Link copied");
                  }}
                >
                  Copy
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-100 text-emerald-800 hover:bg-emerald-200 transition-colors"
                >
                  Open
                </a>
                <button
                  className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                  onClick={() => toast.dismiss(t.id)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ), { duration: 10000 });
      } else {
        // Fallback prompt
        const ok = window.prompt("Copy this shareable link", url);
        if (ok !== null) {
          toast.success("Share link ready");
        }
      }
    } catch (error: any) {
      console.error("Share link error", error);
      // API interceptor will toast; no duplicate here
    } finally {
      setSharing(false);
    }
  }, [clientId]);
  const formatNumber = (value: number) => {
    if (!Number.isFinite(value)) return "0";
    if (Math.abs(value) >= 1000) {
      return Math.round(value).toLocaleString();
    }
    return value.toFixed(0);
  };


  useEffect(() => {
    if (!clientId) return;
    if (client) return;
    if (clientPortalMode) return;

    const fetchClient = async () => {
      try {
        setLoading(true);
        const res = await api.get("/clients");
        const found = (res.data as Client[]).find((c) => c.id === clientId);
        if (found) {
          setClient(found);
        } else {
          navigate(user?.role === "SPECIALIST" ? "/specialist/clients" : "/agency/clients");
        }
      } catch (error: any) {
        console.error("Failed to load client", error);
        const errorMsg = error?.response?.data?.message || error?.message || "Failed to load client data";
        toast.error(errorMsg);
        navigate(user?.role === "SPECIALIST" ? "/specialist/clients" : "/agency/clients");
      } finally {
        setLoading(false);
      }
    };

    fetchClient();
  }, [clientId, client, clientPortalMode, navigate, user?.role]);

  // Sync view client form when modal opens (same fields as Edit Client modal)
  useEffect(() => {
    if (showViewClientModal && client) {
      setViewClientForm(clientToFormState(client));
    }
  }, [showViewClientModal, client]);

  // Check GA4 connection status and handle OAuth callback
  useEffect(() => {
    if (!clientId) return;
    
    // Check for OAuth callback parameters
    const urlParams = new URLSearchParams(window.location.search);
    const ga4TokensReceived = urlParams.get('ga4_tokens_received');
    const ga4Connected = urlParams.get('ga4_connected');
    const ga4Error = urlParams.get('ga4_error');
    
    if (ga4TokensReceived === 'true') {
      toast.success('OAuth successful! Please enter your GA4 Property ID.');
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
      // Show property ID modal
      setShowGA4Modal(true);
      setGa4Connecting(false);
    } else if (ga4Connected === 'true') {
      toast.success('GA4 connected successfully!');
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
      // Refresh status
      setGa4Connected(true);
      setShowGA4Modal(false);
      setGa4Connecting(false);
      // Refresh dashboard data
      const fetchSummary = async () => {
        try {
          const res = await api.get(buildDashboardUrl(clientId), { timeout: DASHBOARD_REQUEST_TIMEOUT_MS });
          const payload = res.data || {};
          setDashboardSummary(formatDashboardSummary(payload));
        } catch (error) {
          console.error('Failed to refresh dashboard:', error);
        }
      };
      fetchSummary();
    } else if (ga4Error) {
      const friendlyMessage = formatGa4ErrorMessage(ga4Error);
      console.error("GA4 OAuth error:", friendlyMessage);
      toast.error(friendlyMessage);
      window.history.replaceState({}, '', window.location.pathname);
      setGa4Connecting(false);
    }
    
    // Always check GA4 status on mount (only when clientId changes, not dateRange)
    const checkGA4Status = async () => {
      try {
        setGa4StatusLoading(true);
        const res = await api.get(`/clients/${clientId}/ga4/status`);
        const isConnected = res.data?.connected || false;
        const hasTokens = res.data?.hasTokens || false;
        const accountEmail = res.data?.accountEmail || null;
        setGa4Connected(isConnected);
        setGa4AccountEmail(accountEmail);
        
        // If tokens exist but not connected (property ID missing), show modal
        if (hasTokens && !isConnected && !ga4TokensReceived && !ga4Connected && !ga4Error) {
          setShowGA4Modal(true);
        }
      } catch (error: any) {
        console.error("Failed to check GA4 status:", error);
        setGa4Connected(false);
        setGa4AccountEmail(null);
      } finally {
        setGa4StatusLoading(false);
      }
    };
    checkGA4Status();
  }, [clientId]); // Removed dateRange dependency - GA4 status doesn't change with date range

  // Fetch Google Ads status (used on mount and when popup posts OAuth success so current window stays in sync)
  const fetchGoogleAdsStatus = useCallback(async () => {
    if (!clientId) return;
    try {
      setGoogleAdsStatusLoading(true);
      const res = await api.get(`/clients/${clientId}/google-ads/status`);
      const isConnected = res.data?.connected || false;
      const hasTokens = res.data?.hasTokens || false;
      const accountEmail = res.data?.accountEmail || null;
      setGoogleAdsConnected(isConnected);
      setGoogleAdsHasTokens(hasTokens);
      setGoogleAdsAccountEmail(accountEmail);
    } catch (error: any) {
      console.error("Failed to check Google Ads status:", error);
      setGoogleAdsConnected(false);
      setGoogleAdsHasTokens(false);
      setGoogleAdsAccountEmail(null);
    } finally {
      setGoogleAdsStatusLoading(false);
    }
  }, [clientId]);

  // Check Google Ads connection status and handle OAuth callback (URL params when redirect is used)
  useEffect(() => {
    if (!clientId) return;
    const urlParams = new URLSearchParams(window.location.search);
    const googleAdsTokensReceived = urlParams.get('google_ads_tokens_received');
    const googleAdsConnectedParam = urlParams.get('google_ads_connected');
    const googleAdsError = urlParams.get('google_ads_error');
    if (googleAdsTokensReceived === 'true') {
      toast.success('OAuth successful! Please select your Google Ads account.');
      window.history.replaceState({}, '', window.location.pathname);
      setShowGoogleAdsModal(true);
      setGoogleAdsConnecting(false);
    } else if (googleAdsConnectedParam === 'true') {
      toast.success('Google Ads connected successfully!');
      window.history.replaceState({}, '', window.location.pathname);
      setGoogleAdsConnected(true);
      setShowGoogleAdsModal(false);
      setGoogleAdsConnecting(false);
    } else if (googleAdsError) {
      console.error("Google Ads OAuth error:", googleAdsError);
      toast.error(`Google Ads connection failed: ${googleAdsError}`);
      window.history.replaceState({}, '', window.location.pathname);
      setGoogleAdsConnecting(false);
    }
    fetchGoogleAdsStatus();
  }, [clientId, fetchGoogleAdsStatus]);

  // Set active tab from location state when component mounts or location changes
  useEffect(() => {
    if (user?.role === "SPECIALIST") {
      setActiveTab("dashboard");
      setDashboardSection("seo");
      return;
    }
    if (clientPortalMode) {
      setActiveTab("dashboard");
      setDashboardSection("seo");
      return;
    }
    const state = location.state as {
      tab?: "dashboard" | "report" | "backlinks" | "worklog" | "users" | "keywords" | "integration" | "web-design";
      section?: ClientDashboardSection;
    };
    if (!state?.tab && !state?.section) return;

    if (state?.tab === "report") {
      setActiveTab("report");
      return;
    }

    if (state?.tab === "users") {
      setActiveTab("users");
      return;
    }

    if (state?.tab === "keywords") {
      setActiveTab("keywords");
      return;
    }

    if (state?.tab === "integration") {
      setActiveTab("integration");
      return;
    }

    if (state?.tab === "web-design") {
      setActiveTab("web-design");
      return;
    }

    if (state?.tab === "backlinks") {
      setActiveTab("dashboard");
      setDashboardSection("backlinks");
      return;
    }

    if (state?.tab === "worklog") {
      setActiveTab("dashboard");
      setDashboardSection("worklog");
      return;
    }

    if (state?.tab === "dashboard") {
      setActiveTab("dashboard");
      if (state.section) setDashboardSection(state.section);
    }
  }, [clientPortalMode, location.pathname, location.state, user?.role]);

  useEffect(() => {
    if (!clientId) {
      setHasWebDesignProjects(false);
      return;
    }
    if (user?.role === "SPECIALIST") {
      setHasWebDesignProjects(false);
      return;
    }
    api
      .get("/web-design/projects", { _silent: true } as any)
      .then((res) => {
        const rows = Array.isArray(res.data) ? res.data : [];
        setHasWebDesignProjects(rows.some((p: any) => String(p?.clientId) === String(clientId)));
      })
      .catch(() => setHasWebDesignProjects(false));
  }, [clientId, user?.role]);

  useEffect(() => {
    if (!clientId) return;
    
    // If custom is selected but dates are not set, initialize them
    if (dateRange === "custom" && (!customStartDate || !customEndDate)) {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      setCustomEndDate(endDate.toISOString().split('T')[0]);
      setCustomStartDate(startDate.toISOString().split('T')[0]);
      return; // Don't fetch yet, wait for dates to be set
    }
    
    const fetchSummary = async () => {
      try {
        setFetchingSummary(true);
        setGa4ConnectionError(null);
        const isRetriableDashboardError = (err: unknown): boolean => {
          const code = (err as { code?: string })?.code;
          const message = String((err as { message?: string })?.message || "").toLowerCase();
          return (
            code === "ECONNABORTED" ||
            code === "ECONNRESET" ||
            code === "ERR_NETWORK" ||
            message.includes("timeout") ||
            message.includes("connection reset") ||
            message.includes("network error")
          );
        };
        type DashboardPayload = {
          isGA4Connected?: boolean;
          dataSources?: { traffic?: string } | null;
          activeUsers?: number | null;
          newUsers?: number | null;
          totalSessions?: number | null;
          [key: string]: unknown;
        };
        const fetchDashboardPayload = async (): Promise<DashboardPayload> => {
          const maxAttempts = 3;
          let attempt = 0;
          let lastError: unknown = null;

          while (attempt < maxAttempts) {
            try {
              const res = await api.get(buildDashboardUrl(clientId), { timeout: DASHBOARD_REQUEST_TIMEOUT_MS });
              return (res.data as DashboardPayload) || {};
            } catch (err: unknown) {
              lastError = err;
              attempt += 1;
              if (!isRetriableDashboardError(err) || attempt >= maxAttempts) {
                throw err;
              }
              // Small backoff keeps retries from hammering the API during transient resets.
              await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
            }
          }

          throw lastError || new Error("Failed to fetch dashboard payload.");
        };

        const autoRefreshKey = `${clientId}:${dateRange}:${customStartDate ?? ""}:${customEndDate ?? ""}`;

        let payload = await fetchDashboardPayload();
        const payloadSummary = () => formatDashboardSummary(payload);
        let isGA4Connected = Boolean(payload?.isGA4Connected);
        let dataSource = payload?.dataSources?.traffic || "none";

        const looksLikeMissingGa4Metrics =
          isGA4Connected &&
          (payload?.activeUsers == null ||
            payload?.newUsers == null ||
            payload?.totalSessions == null);

        // If GA4 is connected but GA4-backed metrics aren't present yet, auto-refresh once.
        // This prevents the "first load shows blanks until manual browser refresh" glitch.
        if (
          isGA4Connected &&
          ["SUPER_ADMIN", "ADMIN"].includes(user?.role || "") &&
          (dataSource !== "ga4" || looksLikeMissingGa4Metrics) &&
          !autoRefreshAttemptedRef.current[autoRefreshKey]
        ) {
          autoRefreshAttemptedRef.current[autoRefreshKey] = true;
          try {
            setAutoRefreshingGa4(true);
            await api.post(`/seo/dashboard/${clientId}/refresh`);
            payload = await fetchDashboardPayload();
            isGA4Connected = Boolean(payload?.isGA4Connected);
            dataSource = payload?.dataSources?.traffic || "none";
          } catch (refreshError) {
            console.warn("Auto-refresh dashboard skipped/failed", refreshError);
          } finally {
            setAutoRefreshingGa4(false);
          }
        }

        const ga4ReadyNow =
          isGA4Connected &&
          (dataSource === "ga4" ||
            payload?.activeUsers != null ||
            payload?.totalSessions != null);

        if (ga4ReadyNow && !prevGa4ReadyRef.current) {
          prevGa4ReadyRef.current = true;
          // Trigger GA4-dependent sections (top events / visitor sources / traffic sources) to refetch
          setGa4DataRefreshKey((k) => k + 1);
        } else if (!ga4ReadyNow) {
          prevGa4ReadyRef.current = false;
        }
        
        // Validate GA4 connection: if marked as connected but data is not from GA4, connection might be invalid
        if (isGA4Connected && dataSource !== "ga4") {
          // GA4 is marked as connected but we're getting fallback data - connection might be invalid
          // Check actual GA4 status to confirm
          try {
            const statusRes = await api.get(`/clients/${clientId}/ga4/status`);
            const actualStatus = statusRes.data?.connected || false;
            
            if (!actualStatus) {
              // GA4 connection is actually invalid - clear GA4 data and show warning
              setGa4Connected(false);
              setGa4ConnectionError("GA4 connection appears to be invalid. Please reconnect GA4 to get fresh data.");

              // Keep last known values to avoid 0-flash on reload while reconnect is being resolved.
              setDashboardSummary((prev) => prev ?? payloadSummary());
              toast.error("GA4 connection is invalid. Please reconnect to get fresh data.", { duration: 5000 });
            } else {
              // Status is OK but data source is not GA4 - might be using cached data
              setGa4Connected(true);
              setDashboardSummary((prev) => {
                const summary = payloadSummary();
                const payloadWebVisitors = Number(summary.totalUsers ?? summary.activeUsers ?? 0) || 0;
                const payloadLooksEmpty =
                  payloadWebVisitors === 0 &&
                  (Number(summary.newUsers ?? 0) || 0) === 0 &&
                  (Number(summary.eventCount ?? 0) || 0) === 0 &&
                  (Number(summary.totalSessions ?? 0) || 0) === 0;
                const prevWebVisitors = Number(prev?.totalUsers ?? prev?.activeUsers ?? 0) || 0;
                if (payloadLooksEmpty && prevWebVisitors > 0) return prev;
                return summary;
              });
            }
          } catch (statusError: any) {
            // Status check can fail transiently during reload; keep current values.
            console.error("GA4 status check failed:", statusError);
            setGa4ConnectionError(null);
            setDashboardSummary((prev) => prev ?? payloadSummary());
          }
        } else {
          // Normal case: either GA4 is connected and data is from GA4, or GA4 is not connected
          setGa4Connected(isGA4Connected);
          setDashboardSummary(payloadSummary());
        }
      } catch (error: any) {
        console.warn("Failed to fetch dashboard summary", error);
        const status = Number(error?.response?.status || 0);
        const allowedClientIds = (((user as any)?.clientAccess?.clients as Array<{ clientId?: string }> | undefined) ?? [])
          .map((c) => String(c?.clientId || "").trim())
          .filter(Boolean);

        if (status === 403 && clientPortalMode) {
          // If URL points to a client this user cannot access, recover to first allowed dashboard.
          const fallbackClientId = allowedClientIds[0];
          if (fallbackClientId && fallbackClientId !== clientId) {
            navigate(`/client/dashboard/${encodeURIComponent(fallbackClientId)}`, { replace: true });
            return;
          }
          if (!fallbackClientId) {
            navigate("/login", { replace: true });
            return;
          }
        }

        if (status === 400 && dateRange === "custom") {
          // Recover from invalid custom date payload by falling back to default period.
          setDateRange("30");
          setCustomStartDate("");
          setCustomEndDate("");
          return;
        }

        setDashboardSummary(null);
        
        // If error is related to GA4, mark connection as invalid
        if (error?.response?.data?.message?.toLowerCase().includes("ga4") || 
            error?.response?.data?.message?.toLowerCase().includes("token")) {
          setGa4Connected(false);
          setGa4ConnectionError("GA4 connection error. Please reconnect GA4.");
        }
      } finally {
        setFetchingSummary(false);
      }
    };

    fetchSummary();
  }, [clientId, clientPortalMode, dateRange, customStartDate, customEndDate, buildDashboardUrl, navigate, user]);

  // Fetch comparison period data when "Compare To" is enabled
  useEffect(() => {
    if (!clientId || compareTo === "none") {
      setDashboardSummaryCompare(null);
      setVisitorSourcesCompare([]);
      setTopEventsCompare([]);
      setTrafficSourcesCompare([]);
      return;
    }
    const params = getComparePeriodParams();
    if (!params) {
      setDashboardSummaryCompare(null);
      setVisitorSourcesCompare([]);
      setTopEventsCompare([]);
      setTrafficSourcesCompare([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [dashboardRes, visitorRes, eventsRes, trafficRes] = await Promise.all([
          api.get(`/seo/dashboard/${clientId}?start=${params.start}&end=${params.end}`),
          ga4Connected ? api.get(`/seo/visitor-sources/${clientId}`, { params: { ...params, limit: 10 } }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
          ga4Connected ? api.get(`/seo/events/${clientId}/top`, { params: { ...params, limit: 10, type: "keyEvents" } }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
          ga4Connected ? api.get(`/seo/traffic-sources/${clientId}`, { params: { ...params, limit: 100 } }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
        ]);
        if (cancelled) return;
        setDashboardSummaryCompare(formatDashboardSummary(dashboardRes.data || {}));
        setVisitorSourcesCompare(Array.isArray(visitorRes.data) ? visitorRes.data : []);
        setTopEventsCompare(Array.isArray(eventsRes.data) ? eventsRes.data : []);
        const trafficPayload = trafficRes.data;
        const trafficBreakdown = Array.isArray(trafficPayload) ? trafficPayload : Array.isArray(trafficPayload?.breakdown) ? trafficPayload.breakdown : [];
        const trafficFormatted: TrafficSourceSlice[] = trafficBreakdown
          .map((item: any) => {
            const name = typeof item?.name === "string" ? item.name : "Other";
            const value = Number(item?.value ?? 0);
            const color = TRAFFIC_SOURCE_COLORS[name] || TRAFFIC_SOURCE_COLORS.Other;
            return { name, value, color };
          })
          .filter((item: TrafficSourceSlice) => Number.isFinite(item.value) && item.value > 0);
        setTrafficSourcesCompare(trafficFormatted);
      } catch {
        if (!cancelled) {
          setDashboardSummaryCompare(null);
          setVisitorSourcesCompare([]);
          setTopEventsCompare([]);
          setTrafficSourcesCompare([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, compareTo, getComparePeriodParams, ga4Connected]);

  const weeklyBacklinkTimeseries = useMemo(() => {
    const weeks = 4;
    const weekStartsOn = 1 as const; // Monday
    const now = new Date();

    const buckets: Array<{
      key: string; // yyyy-MM-dd (week start)
      label: string;
      newBacklinks: number;
      lostBacklinks: number;
    }> = [];
    const byKey = new Map<string, (typeof buckets)[number]>();

    for (let i = 0; i < weeks; i++) {
      const ref = new Date(now);
      ref.setDate(ref.getDate() - i * 7);
      const ws = startOfWeek(ref, { weekStartsOn });
      const we = endOfWeek(ref, { weekStartsOn });
      const key = format(ws, "yyyy-MM-dd");
      const label = `${format(ws, "MMM d")} – ${format(we, "MMM d")}`;
      const bucket = { key, label, newBacklinks: 0, lostBacklinks: 0 };
      buckets.push(bucket);
      byKey.set(key, bucket);
    }

    for (const row of backlinksForChart.newRows) {
      const raw = row.firstSeen || row.createdAt;
      const dt = new Date(raw);
      if (!Number.isFinite(dt.getTime())) continue;
      const ws = startOfWeek(dt, { weekStartsOn });
      const key = format(ws, "yyyy-MM-dd");
      const bucket = byKey.get(key);
      if (!bucket) continue;
      bucket.newBacklinks += 1;
    }

    for (const row of backlinksForChart.lostRows) {
      const raw = row.lastSeen || row.updatedAt || row.createdAt;
      const dt = new Date(raw);
      if (!Number.isFinite(dt.getTime())) continue;
      const ws = startOfWeek(dt, { weekStartsOn });
      const key = format(ws, "yyyy-MM-dd");
      const bucket = byKey.get(key);
      if (!bucket) continue;
      bucket.lostBacklinks += 1;
    }

    buckets.sort((a, b) => (a.key < b.key ? 1 : -1));
    return buckets;
  }, [backlinksForChart.lostRows, backlinksForChart.newRows]);

  const backlinksKpis = useMemo(() => {
    const totalBacklinks = Number(dashboardSummary?.backlinkStats?.total ?? 0) || 0;
    const avgDomainRating = Number(dashboardSummary?.backlinkStats?.avgDomainRating ?? 0) || 0;
    const lostCount = Number(dashboardSummary?.backlinkStats?.lost ?? 0) || 0;
    const dofollowCount = Number(dashboardSummary?.backlinkStats?.dofollowCount ?? 0) || 0;
    // These should match the Backlinks table tabs:
    // - New tab: last 4 weeks new backlinks (unique rows)
    const newLast4Weeks =
      Number(dashboardSummary?.backlinkStats?.newLast4Weeks ?? 0) ||
      weeklyBacklinkTimeseries.reduce((sum, w) => sum + (Number(w.newBacklinks) || 0), 0) ||
      0;
    const lostLast4Weeks =
      Number(dashboardSummary?.backlinkStats?.lostLast4Weeks ?? 0) ||
      weeklyBacklinkTimeseries.reduce((sum, w) => sum + (Number(w.lostBacklinks) || 0), 0) ||
      0;
    return { totalBacklinks, avgDomainRating, lostCount, newLast4Weeks, lostLast4Weeks, dofollowCount };
  }, [dashboardSummary, weeklyBacklinkTimeseries]);

  // Backlinks pagination (applies to "All" and "New" tables)
  const backlinksPagination = useMemo(() => {
    const totalRows = backlinks.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / backlinksPageSize));
    const page = Math.min(Math.max(1, backlinksPage), totalPages);
    const startIdx = (page - 1) * backlinksPageSize;
    const endIdx = Math.min(totalRows, startIdx + backlinksPageSize);
    const from = totalRows === 0 ? 0 : startIdx + 1;
    const to = endIdx;
    const rows = backlinks.slice(startIdx, endIdx);
    return { totalRows, totalPages, page, from, to, rows };
  }, [backlinks, backlinksPage, backlinksPageSize]);

  useEffect(() => {
    // Reset paging when switching tabs (All/New)
    setBacklinksPage(1);
  }, [backlinksFilter]);

  useEffect(() => {
    // Reset paging when page size changes
    setBacklinksPage(1);
  }, [backlinksPageSize]);

  useEffect(() => {
    // Clamp page if data size changes (e.g. filter/search refresh)
    setBacklinksPage((p) => Math.min(p, backlinksPagination.totalPages));
  }, [backlinksPagination.totalPages]);

  const fetchBacklinksList = useCallback(async () => {
    if (!clientId) return;
    try {
      setBacklinksLoading(true);
      const daysForList = backlinksFilter === "new" ? 28 : 365;
      const res = await api.get(`/seo/backlinks/${clientId}`, {
        params: {
          filter: backlinksFilter,
          days: daysForList,
          limit: 5000,
          sortBy: backlinksSortBy,
          order: backlinksOrder,
        },
      });
      const data = Array.isArray(res.data) ? (res.data as BacklinkRow[]) : [];
      setBacklinks(data);
      setBacklinksError(null);

      // If the list contains only manual rows, try a one-time DataForSEO refresh (throttled server-side).
      // This fixes the common case where timeseries exists but the backlinks table hasn't been populated yet.
      if (
        backlinksFilter === "all" &&
        user?.role === "SUPER_ADMIN" &&
        !autoBacklinksListRefreshAttemptedRef.current[clientId]
      ) {
        const hasNonManual = data.some((b) => Boolean(b.firstSeen) || Boolean(b.lastSeen));
        if (!hasNonManual) {
          autoBacklinksListRefreshAttemptedRef.current[clientId] = true;
          try {
            await api.post(`/seo/backlinks/${clientId}/refresh`);
            const res2 = await api.get(`/seo/backlinks/${clientId}`, {
              params: {
                filter: backlinksFilter,
                days: daysForList,
                limit: 5000,
                sortBy: backlinksSortBy,
                order: backlinksOrder,
              },
            });
            const data2 = Array.isArray(res2.data) ? (res2.data as BacklinkRow[]) : [];
            setBacklinks(data2);
          } catch (refreshErr) {
            console.warn("Auto-refresh backlinks list skipped/failed", refreshErr);
          }
        }
      }
    } catch (error: any) {
      console.error("Failed to fetch backlinks", error);
      setBacklinks([]);
      setBacklinksError(error?.response?.data?.message || "Unable to load backlinks");
    } finally {
      setBacklinksLoading(false);
    }
  }, [clientId, backlinksFilter, backlinksSortBy, backlinksOrder, user?.role]);

  useEffect(() => {
    if (activeTab !== "dashboard" || dashboardSection !== "backlinks") return;
    void fetchBacklinksList();
  }, [activeTab, dashboardSection, fetchBacklinksList]);

  const workLogFilteredTasks = useMemo(() => {
    return workLogListTab === "completed"
      ? workLogTasks.filter((t) => t.status === "DONE")
      : workLogTasks.filter((t) => t.status !== "DONE");
  }, [workLogListTab, workLogTasks]);

  const workLogProjectAssignees = useMemo(() => {
    const byId = new Map<string, { id: string; name: string | null; email: string; role: string | null }>();
    const roleByUserId = new Map(assignableUsers.map((u) => [u.id, u.role] as const));
    const isAgencyRole = (role: string | null | undefined) => String(role || "").toUpperCase().includes("AGENCY");

    for (const cu of clientUsers) {
      const userId = String(cu.userId || "").trim();
      const email = String(cu.email || "").trim();
      if (!userId || !email) continue;
      if (!byId.has(userId)) {
        byId.set(userId, {
          id: userId,
          name: cu.name ?? null,
          email,
          role: roleByUserId.get(userId) ?? cu.role ?? null,
        });
      }
    }

    for (const task of workLogTasks) {
      const a = task.assignee;
      if (!a?.id || !a.email) continue;
      if (!byId.has(a.id)) {
        byId.set(a.id, {
          id: a.id,
          name: a.name ?? null,
          email: a.email,
          role: roleByUserId.get(a.id) ?? null,
        });
      }
    }

    return Array.from(byId.values()).sort((a, b) => {
      if (isAgencyRole(a.role) && !isAgencyRole(b.role)) return 1;
      if (!isAgencyRole(a.role) && isAgencyRole(b.role)) return -1;
      const aLabel = (a.name || a.email).toLowerCase();
      const bLabel = (b.name || b.email).toLowerCase();
      return aLabel.localeCompare(bLabel);
    }).filter((member) => !isAgencyRole(member.role));
  }, [assignableUsers, clientUsers, workLogTasks]);

  const workLogApprovalClientUsers = useMemo(() => {
    return clientUsers
      .filter((u) => u.role === "CLIENT" && u.status === "ACTIVE")
      .map((u) => ({
        id: u.userId,
        name: u.name,
        email: u.email,
      }));
  }, [clientUsers]);

  const workLogMentionSuggestions = useMemo(() => {
    if (!workLogMentionRange) return [];
    const q = workLogMentionQuery.trim();
    return workLogProjectAssignees
      .filter((member) => {
        if (member.id === user?.id) return false;
        if (!q) return true;
        const name = (member.name || "").toLowerCase();
        const email = (member.email || "").toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .slice(0, 8);
  }, [workLogMentionQuery, workLogMentionRange, workLogProjectAssignees, user?.id]);

  const workLogEntryCollaborators = useMemo(() => {
    const byId = new Map<string, { id: string; name: string | null; email: string; role: string | null }>();
    const roleByUserId = new Map(assignableUsers.map((u) => [u.id, u.role] as const));
    const projectById = new Map(workLogProjectAssignees.map((m) => [m.id, m] as const));
    const projectByMentionToken = new Map(
      workLogProjectAssignees.map((m) => [buildWorkLogMentionToken(m), m] as const)
    );

    const addMember = (member: { id: string; name: string | null; email: string; role: string | null }) => {
      if (!member.id || !member.email) return;
      if (!byId.has(member.id)) byId.set(member.id, member);
    };

    const selectedAssignee = selectedWorkLogTask?.assignee;
    if (selectedAssignee?.id && selectedAssignee.email) {
      addMember({
        id: selectedAssignee.id,
        name: selectedAssignee.name ?? null,
        email: selectedAssignee.email,
        role: roleByUserId.get(selectedAssignee.id) ?? projectById.get(selectedAssignee.id)?.role ?? null,
      });
    }

    for (const c of workLogComments) {
      const authorId = c.author?.id || "";
      if (authorId) {
        const fallback = projectById.get(authorId);
        const authorEmail = c.author?.email || fallback?.email || "";
        if (authorEmail) {
          addMember({
            id: authorId,
            name: c.author?.name ?? fallback?.name ?? null,
            email: authorEmail,
            role: c.author?.role ?? fallback?.role ?? roleByUserId.get(authorId) ?? null,
          });
        }
      }

      const mentionMatches = c.body.match(/@([A-Za-z0-9._-]+)/g) || [];
      for (const raw of mentionMatches) {
        const token = raw.slice(1).toLowerCase();
        const member = projectByMentionToken.get(token);
        if (!member) continue;
        addMember(member);
      }
    }

    const taskId = selectedWorkLogTaskId || "";
    const manualIds = new Set((taskId ? workLogManualCollaboratorIdsByTask[taskId] : []) || []);
    const removedIds = new Set((taskId ? workLogRemovedCollaboratorIdsByTask[taskId] : []) || []);
    for (const manualId of manualIds) {
      const member = projectById.get(manualId);
      if (member) addMember(member);
    }
    for (const removedId of removedIds) {
      byId.delete(removedId);
    }

    return Array.from(byId.values()).sort((a, b) => {
      const aLabel = (a.name || a.email).toLowerCase();
      const bLabel = (b.name || b.email).toLowerCase();
      return aLabel.localeCompare(bLabel);
    }).filter((member) => member.id !== user?.id);
  }, [
    assignableUsers,
    buildWorkLogMentionToken,
    selectedWorkLogTask,
    selectedWorkLogTaskId,
    user?.id,
    workLogComments,
    workLogManualCollaboratorIdsByTask,
    workLogProjectAssignees,
    workLogRemovedCollaboratorIdsByTask,
  ]);

  const workLogCollaboratorSearchResults = useMemo(() => {
    const q = workLogCollaboratorSearch.trim().toLowerCase();
    return workLogProjectAssignees.filter((m) => {
      if (m.id === user?.id) return false;
      if (!q) return true;
      const name = (m.name || "").toLowerCase();
      const email = m.email.toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [workLogCollaboratorSearch, workLogProjectAssignees, user?.id]);

  const addWorkLogCollaborator = useCallback(
    (userId: string) => {
      const taskId = selectedWorkLogTaskId;
      if (!taskId) return;
      setWorkLogManualCollaboratorIdsByTask((prev) => {
        const existing = new Set(prev[taskId] || []);
        existing.add(userId);
        return { ...prev, [taskId]: Array.from(existing) };
      });
      setWorkLogRemovedCollaboratorIdsByTask((prev) => {
        const existing = new Set(prev[taskId] || []);
        existing.delete(userId);
        return { ...prev, [taskId]: Array.from(existing) };
      });
    },
    [selectedWorkLogTaskId]
  );

  const removeWorkLogCollaborator = useCallback(
    (userId: string) => {
      const taskId = selectedWorkLogTaskId;
      if (!taskId) return;
      setWorkLogManualCollaboratorIdsByTask((prev) => {
        const existing = new Set(prev[taskId] || []);
        existing.delete(userId);
        return { ...prev, [taskId]: Array.from(existing) };
      });
      setWorkLogRemovedCollaboratorIdsByTask((prev) => {
        const existing = new Set(prev[taskId] || []);
        existing.add(userId);
        return { ...prev, [taskId]: Array.from(existing) };
      });
    },
    [selectedWorkLogTaskId]
  );

  useEffect(() => {
    if (!workLogMentionRange || workLogMentionSuggestions.length === 0) {
      setWorkLogMentionActiveIndex(0);
      return;
    }
    setWorkLogMentionActiveIndex((prev) => Math.min(prev, workLogMentionSuggestions.length - 1));
  }, [workLogMentionRange, workLogMentionSuggestions.length]);

  useEffect(() => {
    setWorkLogCollaboratorEditorOpen(false);
    setWorkLogCollaboratorSearch("");
  }, [selectedWorkLogTaskId, workLogModalOpen]);

  const handleWorkLogMentionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!workLogMentionRange || workLogMentionSuggestions.length === 0) {
      if (e.key === "Escape") {
        setWorkLogMentionRange(null);
        setWorkLogMentionQuery("");
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setWorkLogMentionActiveIndex((prev) => (prev + 1) % workLogMentionSuggestions.length);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setWorkLogMentionActiveIndex((prev) => (prev - 1 + workLogMentionSuggestions.length) % workLogMentionSuggestions.length);
      return;
    }

    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const candidate = workLogMentionSuggestions[workLogMentionActiveIndex];
      if (candidate) handleSelectWorkLogMention(candidate);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setWorkLogMentionRange(null);
      setWorkLogMentionQuery("");
    }
  };

  const renderWorkLogCommentBody = useCallback((body: string) => {
    const parts = body.split(/(@[A-Za-z0-9._-]+)/g);
    return parts.map((part, idx) => {
      if (/^@[A-Za-z0-9._-]+$/.test(part)) {
        return (
          <span key={`mention-${idx}`} className="rounded bg-green-100 px-1 text-green-800 font-medium">
            {part}
          </span>
        );
      }
      return <React.Fragment key={`text-${idx}`}>{part}</React.Fragment>;
    });
  }, []);

  const renderWorkLogCommentEditorOverlay = useCallback((body: string) => {
    const parts = body.split(/(@[A-Za-z0-9._-]+)/g);
    return parts.map((part, idx) => {
      if (/^@[A-Za-z0-9._-]+$/.test(part)) {
        // Keep overlay mention metrics identical to textarea text so caret mapping stays accurate.
        return (
          <span key={`editor-mention-${idx}`} className="rounded-sm bg-green-100/70 text-green-800 font-normal">
            {part}
          </span>
        );
      }
      return <React.Fragment key={`editor-text-${idx}`}>{part}</React.Fragment>;
    });
  }, []);

  const workLogPagination = useMemo(() => {
    const totalRows = workLogFilteredTasks.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / workLogPageSize));
    const page = Math.min(Math.max(1, workLogPage), totalPages);
    const startIdx = (page - 1) * workLogPageSize;
    const endIdx = Math.min(totalRows, startIdx + workLogPageSize);
    const from = totalRows === 0 ? 0 : startIdx + 1;
    const to = endIdx;
    const rows = workLogFilteredTasks.slice(startIdx, endIdx);
    return { totalRows, totalPages, page, from, to, rows };
  }, [workLogFilteredTasks, workLogPage, workLogPageSize]);

  useEffect(() => {
    setWorkLogPage(1);
  }, [workLogListTab]);

  useEffect(() => {
    setWorkLogPage(1);
  }, [workLogPageSize]);

  useEffect(() => {
    setWorkLogPage((p) => Math.min(p, workLogPagination.totalPages));
  }, [workLogPagination.totalPages]);

  const openAddBacklink = useCallback(() => {
    if (reportOnly || includedClientReadOnly) return;
    const defaultTarget = (() => {
      const domain = (client?.domain || "").trim();
      if (!domain) return "";
      if (/^https?:\/\//i.test(domain)) return domain;
      return `https://${domain}`;
    })();
    setAddBacklinkForm({ sourceUrl: "", targetUrl: defaultTarget, anchorText: "", domainRating: "", isFollow: true });
    setAddBacklinkModalOpen(true);
  }, [client?.domain, reportOnly, includedClientReadOnly]);

  const submitAddBacklink = useCallback(async () => {
    if (!clientId) return;
    try {
      setAddingBacklink(true);
      const domainRatingNum = addBacklinkForm.domainRating.trim() ? Number(addBacklinkForm.domainRating) : null;
      await api.post(`/seo/backlinks/${clientId}`, {
        sourceUrl: addBacklinkForm.sourceUrl.trim(),
        targetUrl: addBacklinkForm.targetUrl.trim() || undefined,
        anchorText: addBacklinkForm.anchorText.trim() || null,
        domainRating: domainRatingNum != null && Number.isFinite(domainRatingNum) ? domainRatingNum : null,
        isFollow: addBacklinkForm.isFollow,
      });
      toast.success("Backlink added");
      setAddBacklinkModalOpen(false);
      await fetchBacklinksList();
    } catch (error: any) {
      console.error("Failed to add backlink", error);
      toast.error(error?.response?.data?.message || "Failed to add backlink");
    } finally {
      setAddingBacklink(false);
    }
  }, [addBacklinkForm, clientId, fetchBacklinksList]);

  const submitImportBacklinks = useCallback(async () => {
    if (!clientId) return;
    const rows = importBacklinksText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((sourceUrl) => ({ sourceUrl }));

    if (rows.length === 0) {
      toast.error("Paste at least 1 URL (one per line).");
      return;
    }

    try {
      setImportingBacklinks(true);
      const res = await api.post(`/seo/backlinks/${clientId}/import`, { rows });
      const imported = Number(res?.data?.imported ?? rows.length) || rows.length;
      toast.success(`Imported ${imported} backlinks`);
      setImportBacklinksModalOpen(false);
      setImportBacklinksText("");
      await fetchBacklinksList();
    } catch (error: any) {
      console.error("Failed to import backlinks", error);
      toast.error(error?.response?.data?.message || "Failed to import backlinks");
    } finally {
      setImportingBacklinks(false);
    }
  }, [clientId, fetchBacklinksList, importBacklinksText]);

  const requestRemoveBacklink = useCallback((link: BacklinkRow) => {
    if (reportOnly) return;
    const label = (() => {
      try {
        return new URL(link.sourceUrl).hostname || link.sourceUrl;
      } catch {
        return link.sourceUrl;
      }
    })();
    setBacklinkDeleteConfirm({ isOpen: true, backlinkId: link.id, label, isLost: Boolean(link.isLost) });
  }, [reportOnly]);

  const confirmRemoveBacklink = useCallback(async () => {
    if (!clientId || !backlinkDeleteConfirm.backlinkId) return;
    const deletingId = backlinkDeleteConfirm.backlinkId;
    const deletingIsLost = backlinkDeleteConfirm.isLost;
    try {
      await api.delete(`/seo/backlinks/${clientId}/${deletingId}`);
      toast.success("Backlink removed");
      setBacklinks((prev) => prev.filter((b) => b.id !== deletingId));
      setDashboardSummary((prev) => {
        if (!prev) return prev;
        const stats = prev.backlinkStats;
        if (!stats) return prev;
        const nextTotal = Math.max(0, Number(stats.total ?? 0) - (deletingIsLost ? 0 : 1));
        const nextLost = Math.max(0, Number(stats.lost ?? 0) - (deletingIsLost ? 1 : 0));
        return {
          ...prev,
          backlinkStats: {
            ...stats,
            total: nextTotal,
            lost: nextLost,
          },
        } as any;
      });
      await fetchBacklinksList();
    } catch (error: any) {
      console.error("Failed to remove backlink", error);
      toast.error(error?.response?.data?.message || "Failed to remove backlink");
    } finally {
      setBacklinkDeleteConfirm({ isOpen: false, backlinkId: null, label: null, isLost: false });
    }
  }, [backlinkDeleteConfirm.backlinkId, backlinkDeleteConfirm.isLost, clientId, fetchBacklinksList]);

  const fetchAiSearchVisibility = useCallback(async () => {
    if (!clientId) return;
    try {
      setAiSearchLoading(true);
      const params: any = {};
      if (dateRange === "custom" && customStartDate && customEndDate) {
        params.start = customStartDate;
        params.end = customEndDate;
      } else {
        params.period = dateRange;
      }
      const res = await api.get(`/seo/ai-search-visibility/${clientId}`, { params, timeout: 30000 });
      const rows = Array.isArray(res?.data?.rows) ? (res.data.rows as AiSearchVisibilityRow[]) : [];
      setAiSearchRows(rows);
      setAiSearchError(null);
    } catch (error: any) {
      console.error("Failed to fetch AI Search visibility", error);
      setAiSearchRows([]);
      if (error?.code === "ECONNABORTED") {
        setAiSearchError("AI Search Visibility is taking longer than expected. Please refresh in a moment.");
      } else {
        setAiSearchError(error?.response?.data?.message || "Unable to load AI Search Visibility");
      }
    } finally {
      setAiSearchLoading(false);
    }
  }, [clientId, customEndDate, customStartDate, dateRange]);

  const fetchAiIntelligence = useCallback(async () => {
    if (!clientId) return;
    try {
      setAiIntelligenceLoading(true);
      setAiIntelligenceError(null);
      const params: Record<string, string> = {};
      if (dateRange === "custom" && customStartDate && customEndDate) {
        params.start = customStartDate;
        params.end = customEndDate;
      } else {
        params.period = dateRange;
      }
      const res = await api.get(`/seo/ai-intelligence/${clientId}`, { params, timeout: 120000 }); // 2 min for heavy DataForSEO AI APIs (search volume, mentions, etc.)
      setAiIntelligence(res.data);
    } catch (error: any) {
      console.error("Failed to fetch AI Intelligence", error);
      setAiIntelligence(null);
      setAiIntelligenceError(error?.response?.data?.message || "Unable to load AI Intelligence");
    } finally {
      setAiIntelligenceLoading(false);
    }
  }, [clientId, customEndDate, customStartDate, dateRange]);

  useEffect(() => {
    if (activeTab !== "dashboard") return;
    void fetchAiSearchVisibility();
  }, [activeTab, fetchAiSearchVisibility]);

  useEffect(() => {
    if (activeTab !== "dashboard" || dashboardSection !== "ai-intelligence") return;
    void fetchAiIntelligence();
  }, [activeTab, dashboardSection, fetchAiIntelligence]);

  useEffect(() => {
    if (!clientId) return;

    const fetchTopPages = async () => {
      try {
        setTopPagesLoading(true);
        const res = await api.get(`/seo/top-pages/${clientId}`, {
          params: { limit: 10 },
        });
        const data = Array.isArray(res.data) ? res.data : [];
        const formatted = data.map((item: any) => ({
          url: item?.url || item?.page_address || "",
          keywords: Number(item?.organic?.count ?? item?.metrics?.organic?.count ?? 0),
          estimatedTraffic: Number(item?.organic?.etv ?? item?.metrics?.organic?.etv ?? 0),
          top1: Number(item?.organic?.pos1 ?? item?.metrics?.organic?.pos_1 ?? 0),
          top3: Number(item?.organic?.pos2_3 ?? item?.metrics?.organic?.pos_2_3 ?? 0),
          top10: Number(item?.organic?.pos4_10 ?? item?.metrics?.organic?.pos_4_10 ?? 0),
          newKeywords: Number(item?.organic?.isNew ?? item?.metrics?.organic?.is_new ?? 0),
          upKeywords: Number(item?.organic?.isUp ?? item?.metrics?.organic?.is_up ?? 0),
          downKeywords: Number(item?.organic?.isDown ?? item?.metrics?.organic?.is_down ?? 0),
          lostKeywords: Number(item?.organic?.isLost ?? item?.metrics?.organic?.is_lost ?? 0),
          paidTraffic: Number(item?.paid?.etv ?? item?.metrics?.paid?.etv ?? 0),
        }));

        setTopPages(formatted);
        setTopPagesError(null);

        // If DB is empty, auto-refresh once for SUPER_ADMIN to populate data (throttled server-side).
        if (
          formatted.length === 0 &&
          user?.role === "SUPER_ADMIN" &&
          !autoDataForSeoAttemptedRef.current.topPages[clientId]
        ) {
          autoDataForSeoAttemptedRef.current.topPages[clientId] = true;
          try {
            await api.post(`/seo/top-pages/${clientId}/refresh`);
            const res2 = await api.get(`/seo/top-pages/${clientId}`, { params: { limit: 10 } });
            const data2 = Array.isArray(res2.data) ? res2.data : [];
            const formatted2 = data2.map((item: any) => ({
              url: item?.url || item?.page_address || "",
              keywords: Number(item?.organic?.count ?? item?.metrics?.organic?.count ?? 0),
              estimatedTraffic: Number(item?.organic?.etv ?? item?.metrics?.organic?.etv ?? 0),
              top1: Number(item?.organic?.pos1 ?? item?.metrics?.organic?.pos_1 ?? 0),
              top3: Number(item?.organic?.pos2_3 ?? item?.metrics?.organic?.pos_2_3 ?? 0),
              top10: Number(item?.organic?.pos4_10 ?? item?.metrics?.organic?.pos_4_10 ?? 0),
              newKeywords: Number(item?.organic?.isNew ?? item?.metrics?.organic?.is_new ?? 0),
              upKeywords: Number(item?.organic?.isUp ?? item?.metrics?.organic?.is_up ?? 0),
              downKeywords: Number(item?.organic?.isDown ?? item?.metrics?.organic?.is_down ?? 0),
              lostKeywords: Number(item?.organic?.isLost ?? item?.metrics?.organic?.is_lost ?? 0),
              paidTraffic: Number(item?.paid?.etv ?? item?.metrics?.paid?.etv ?? 0),
            }));
            setTopPages(formatted2);
            setTopPagesError(null);
          } catch (refreshError) {
            console.warn("Auto-refresh top pages skipped/failed", refreshError);
          }
        }
      } catch (error: any) {
        console.error("Failed to fetch top pages", error);
        setTopPages([]);
        const errorMsg = error?.response?.data?.message || "Unable to load top pages data";
        setTopPagesError(errorMsg);
        // Toast is already shown by API interceptor
      } finally {
        setTopPagesLoading(false);
      }
    };

    fetchTopPages();
  }, [clientId, user?.role]);

  const fetchTopEvents = useCallback(async () => {
    if (!clientId) return;
    if (ga4Connected !== true) return;

    try {
      setTopEventsLoading(true);
      setTopEventsError(null);
      
      const params: any = { limit: 10 };
      if (dateRange === "custom" && customStartDate && customEndDate) {
        params.start = customStartDate;
        params.end = customEndDate;
      } else {
        params.period = dateRange;
      }

      const res = await api.get(`/seo/events/${clientId}/top`, { params: { ...params, type: "keyEvents" } });
      const data = Array.isArray(res.data) ? res.data : [];
      setTopEvents(data);
    } catch (error: any) {
      console.error("Failed to fetch top events", error);
      setTopEvents([]);
      const errorMsg = error?.response?.data?.message || "Unable to load top events data";
      setTopEventsError(errorMsg);
    } finally {
      setTopEventsLoading(false);
    }
  }, [clientId, dateRange, customStartDate, customEndDate, ga4Connected, ga4DataRefreshKey]);

  useEffect(() => {
    fetchTopEvents();
  }, [fetchTopEvents]);

  const fetchVisitorSources = useCallback(async () => {
    if (!clientId) return;
    if (ga4Connected !== true) return;

    try {
      setVisitorSourcesLoading(true);
      setVisitorSourcesError(null);
      
      const params: any = { limit: 10 };
      if (dateRange === "custom" && customStartDate && customEndDate) {
        params.start = customStartDate;
        params.end = customEndDate;
      } else {
        params.period = dateRange;
      }

      const res = await api.get(`/seo/visitor-sources/${clientId}`, { params });
      const data = Array.isArray(res.data) ? res.data : [];
      setVisitorSources(data);
    } catch (error: any) {
      console.error("Failed to fetch visitor sources", error);
      setVisitorSources([]);
      const errorMsg = error?.response?.data?.message || "Unable to load visitor sources data";
      setVisitorSourcesError(errorMsg);
    } finally {
      setVisitorSourcesLoading(false);
    }
  }, [clientId, dateRange, customStartDate, customEndDate, ga4Connected, ga4DataRefreshKey]);

  useEffect(() => {
    fetchVisitorSources();
  }, [fetchVisitorSources]);

  const fetchTrafficSources = useCallback(async () => {
    if (!clientId) return;
    if (ga4Connected !== true) return;

    try {
      setTrafficSourcesLoading(true);
      const params: any = { limit: 100 };
      if (dateRange === "custom" && customStartDate && customEndDate) {
        params.start = customStartDate;
        params.end = customEndDate;
      } else {
        params.period = dateRange;
      }
      const res = await api.get(`/seo/traffic-sources/${clientId}`, {
        params,
      });
      const payload = res.data;
      const breakdown = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.breakdown)
        ? payload.breakdown
        : [];
      const formatted: TrafficSourceSlice[] = breakdown
        .map((item: any) => {
          const name = typeof item?.name === "string" ? item.name : "Other";
          const value = Number(item?.value ?? 0);
          const color = TRAFFIC_SOURCE_COLORS[name] || TRAFFIC_SOURCE_COLORS.Other;
          return {
            name,
            value,
            color,
          } as TrafficSourceSlice;
        })
        .filter((item: TrafficSourceSlice) => Number.isFinite(item.value) && item.value > 0);

      if (formatted.length === 0) {
        setTrafficSources([]);
        setTrafficSourcesError(null);
      } else {
        setTrafficSources(formatted);
        setTrafficSourcesError(null);
      }
    } catch (error: any) {
      console.error("Failed to fetch traffic sources", error);
      setTrafficSources([]);
      const errorMsg = error?.response?.data?.message || "Unable to load traffic sources data";
      setTrafficSourcesError(errorMsg);
      // Toast is already shown by API interceptor
    } finally {
      setTrafficSourcesLoading(false);
    }
  }, [clientId, dateRange, customStartDate, customEndDate, ga4Connected, ga4DataRefreshKey]);

  useEffect(() => {
    fetchTrafficSources();
  }, [fetchTrafficSources]);

  // Load single report from server (enforced one report per client)
  const loadReport = useCallback(async (ensureFresh: boolean = true) => {
    if (!clientId) return;
    if (user?.role === "SPECIALIST") {
      setServerReport(null);
      setReportError(null);
      setCampaignWinsMeta({
        enabled: false,
        recipients: [],
        lastSent: null,
      });
      return;
    }
    try {
      setReportLoading(true);
      setReportError(null);
      const [reportRes, campaignWinsRes] = await Promise.all([
        api.get(`/seo/reports/${clientId}`, { params: { period: "monthly", ensureFresh } }),
        api.get(`/seo/reports/${clientId}/campaign-wins`, { _silent: true } as any).catch(() => null),
      ]);
      setServerReport(reportRes.data || null);
      if (campaignWinsRes?.data) {
        const recipients = Array.isArray(campaignWinsRes.data.recipients)
          ? campaignWinsRes.data.recipients.filter((r: unknown): r is string => typeof r === "string" && r.trim().length > 0)
          : [];
        setCampaignWinsMeta({
          enabled: Boolean(campaignWinsRes.data.enabled),
          recipients,
          lastSent: campaignWinsRes.data.lastSent ? String(campaignWinsRes.data.lastSent) : null,
        });
      } else {
        setCampaignWinsMeta({
          enabled: false,
          recipients: [],
          lastSent: null,
        });
      }
    } catch (error: any) {
      console.error("Failed to load report", error);
      const msg = error?.response?.data?.message || "Unable to load report";
      setReportError(msg);
      setServerReport(null);
      setCampaignWinsMeta({
        enabled: false,
        recipients: [],
        lastSent: null,
      });
    } finally {
      setReportLoading(false);
    }
  }, [clientId, user?.role]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const singleReportForClient: ClientReport | null = useMemo(() => {
    if (
      serverReport &&
      typeof serverReport === "object" &&
      serverReport.id &&
      String(serverReport.clientId || "") === String(clientId || "")
    ) {
      // Map backend seoReport to UI ClientReport
      const period = typeof serverReport.period === "string" ? serverReport.period : "monthly";
      const dateStr = serverReport.reportDate ? format(new Date(serverReport.reportDate), "yyyy-MM-dd") : "";
      return {
        id: serverReport.id || "report",
        clientId: clientId!,
        name: "Client SEO Report",
        type: formatReportPeriodLabel(period),
        lastGenerated: dateStr,
        status: toDisplayReportStatus(serverReport.status),
        // Prefer schedule recipients (what user sets in Create Report & Schedule modal) over report.recipients
        recipients: Array.isArray(serverReport.scheduleRecipients) && serverReport.scheduleRecipients.length > 0
          ? serverReport.scheduleRecipients
          : Array.isArray(serverReport.recipients) && serverReport.recipients.length > 0
          ? serverReport.recipients
          : [],
        metrics: {
          keywords: Number(serverReport.totalClicks ?? 0),
          avgPosition: Number(serverReport.averagePosition ?? 0),
          traffic: Number(serverReport.totalImpressions ?? 0),
        },
        scheduleKind:
          typeof serverReport?.scheduleEmailSubject === "string"
          && String(serverReport.scheduleEmailSubject).startsWith(LOCAL_MAP_SCHEDULE_PREFIX)
            ? "local_map"
            : typeof serverReport?.scheduleEmailSubject === "string"
            && String(serverReport.scheduleEmailSubject).startsWith(PPC_SCHEDULE_PREFIX)
              ? "ppc"
            : "seo",
      };
    }
    // No report exists for this client yet
    return null;
  }, [serverReport, clientId]);

  const ppcReportForClient: ClientReport | null = useMemo(() => {
    if (!ppcScheduleMeta.hasSchedule) return null;
    const frequency = String(ppcScheduleMeta.frequency || "monthly");
    const typeLabel =
      frequency === "weekly"
        ? "PPC Weekly"
        : frequency === "biweekly"
        ? "PPC Biweekly"
        : "PPC Monthly";
    const status: ClientReport["status"] =
      !ppcScheduleMeta.isActive ? "Draft" : ppcScheduleMeta.lastRunAt ? "Sent" : "Scheduled";
    return {
      id: `ppc-report-${clientId || "client"}`,
      clientId: clientId || "",
      name: "Client PPC Report",
      type: typeLabel,
      lastGenerated: ppcScheduleMeta.lastRunAt ? format(new Date(ppcScheduleMeta.lastRunAt), "yyyy-MM-dd") : "—",
      status,
      recipients: ppcScheduleMeta.recipients || [],
      metrics: {
        keywords: 0,
        avgPosition: 0,
        traffic: 0,
      },
      scheduleKind: "ppc",
    };
  }, [ppcScheduleMeta, clientId]);

  const localMapReportForClient: ClientReport | null = useMemo(() => {
    if (!localMapScheduleMeta.hasSchedule) return null;
    const frequency = String(localMapScheduleMeta.frequency || "monthly");
    const typeLabel = frequency === "biweekly" ? "Local Map Biweekly" : "Local Map Monthly";
    const status: ClientReport["status"] =
      !localMapScheduleMeta.isActive ? "Draft" : localMapScheduleMeta.lastRunAt ? "Sent" : "Scheduled";
    return {
      id: localMapScheduleMeta.scheduleId || `local-map-report-${clientId || "client"}`,
      clientId: clientId || "",
      name: "Local Map Rankings Report",
      type: typeLabel,
      lastGenerated: localMapScheduleMeta.lastRunAt ? format(new Date(localMapScheduleMeta.lastRunAt), "yyyy-MM-dd") : "—",
      status,
      recipients: localMapScheduleMeta.recipients || [],
      metrics: {
        keywords: 0,
        avgPosition: 0,
        traffic: 0,
      },
      scheduleKind: "local_map",
    };
  }, [localMapScheduleMeta, clientId]);

  const campaignWinsReportForClient: ClientReport | null = useMemo(() => {
    if (!campaignWinsMeta.enabled) return null;
    const status: ClientReport["status"] = campaignWinsMeta.lastSent ? "Sent" : "Scheduled";
    return {
      id: `campaign-wins-report-${clientId || "client"}`,
      clientId: clientId || "",
      name: "Campaign Wins Report",
      type: "Event-driven",
      lastGenerated: campaignWinsMeta.lastSent ? format(new Date(campaignWinsMeta.lastSent), "yyyy-MM-dd") : "—",
      status,
      recipients: campaignWinsMeta.recipients || [],
      metrics: {
        keywords: 0,
        avgPosition: 0,
        traffic: 0,
      },
      scheduleKind: "campaign_wins",
    };
  }, [campaignWinsMeta, clientId]);

  const reportRows: ClientReport[] = useMemo(() => {
    const rows: ClientReport[] = [];
    if (singleReportForClient) rows.push(singleReportForClient);
    if (localMapReportForClient) rows.push(localMapReportForClient);
    if (ppcReportForClient) rows.push(ppcReportForClient);
    if (campaignWinsReportForClient) rows.push(campaignWinsReportForClient);
    return rows;
  }, [singleReportForClient, localMapReportForClient, ppcReportForClient, campaignWinsReportForClient]);

  const handleCreateReportClick = useCallback(() => {
    if (includedClientReadOnly) return;
    if (!clientId) {
      toast.error("Client ID is missing");
      return;
    }
    // Open the client-specific report creation modal
    setShowClientReportModal(true);
  }, [clientId, includedClientReadOnly]);

  // When Create Report modal opens, initialize Recipients and Email Subject from existing schedule or previous input (only on open, not when serverReport updates)
  const prevShowClientReportModal = useRef(false);
  useEffect(() => {
    const justOpened = showClientReportModal && !prevShowClientReportModal.current;
    prevShowClientReportModal.current = showClientReportModal;
    if (!justOpened) return;
    const fromSchedule = Array.isArray(serverReport?.scheduleRecipients) && serverReport.scheduleRecipients.length > 0
      ? serverReport.scheduleRecipients.join(", ")
      : "";
    const fromReport = Array.isArray(serverReport?.recipients) && serverReport.recipients.length > 0
      ? serverReport.recipients.join(", ")
      : "";
    const fromCampaign = Array.isArray(serverReport?.campaignWinsEmails) && serverReport.campaignWinsEmails.length > 0
      ? serverReport.campaignWinsEmails.join(", ")
      : "";
    setModalRecipients(fromSchedule || fromReport || fromCampaign || clientReportRecipients || "");
    if (serverReport?.campaignWinsEnabled) {
      setClientReportFrequency("campaign_wins");
    }
    setModalEmailSubject(serverReport?.scheduleEmailSubject ?? clientReportEmailSubject ?? "");
  }, [showClientReportModal, serverReport?.scheduleRecipients, serverReport?.recipients, serverReport?.scheduleEmailSubject, serverReport?.campaignWinsEmails, serverReport?.campaignWinsEnabled, clientReportRecipients, clientReportEmailSubject]);

  const handleSubmitClientReport = async () => {
    if (!clientId) {
      toast.error("Client ID is missing");
      return;
    }

    const recipientsList = modalRecipients
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);

    if (recipientsList.length === 0) {
      toast.error("Please enter at least one recipient email");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = recipientsList.filter((email) => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      toast.error(`Invalid email addresses: ${invalidEmails.join(", ")}`);
      return;
    }

    try {
      setClientReportSubmitting(true);
      setReportError(null);

      if (clientReportFrequency === "campaign_wins") {
        await api.post(`/seo/reports/${clientId}/campaign-wins`, {
          enabled: true,
          recipients: recipientsList,
        }, { timeout: 15000 });
        setCampaignWinsMeta((prev) => ({
          enabled: true,
          recipients: recipientsList,
          lastSent: prev.lastSent,
        }));
        toast.success("Campaign Wins report enabled successfully");
      } else {
        const isLocalMapSchedule =
          clientReportFrequency === "local_map_biweekly" || clientReportFrequency === "local_map_monthly";
        const isPpcSchedule =
          clientReportFrequency === "ppc_weekly" ||
          clientReportFrequency === "ppc_biweekly" ||
          clientReportFrequency === "ppc_monthly";

        // PPC schedules require an active Google Ads connection.
        // Guard on the client before submitting so users get a clear action message instead of a generic 400 failure.
        if (isPpcSchedule) {
          try {
            const gaRes = await api.get(`/clients/${clientId}/google-ads/status`, { _silent: true } as any);
            if (!gaRes?.data?.connected) {
              toast.error("Please connect Google Ads first before creating a PPC report.");
              return;
            }
          } catch {
            toast.error("Unable to verify Google Ads connection. Please connect Google Ads and try again.");
            return;
          }
        }

        const resolvedFrequency =
          clientReportFrequency === "local_map_biweekly"
            ? "biweekly"
            : clientReportFrequency === "local_map_monthly"
            ? "monthly"
            : clientReportFrequency === "ppc_weekly"
            ? "weekly"
            : clientReportFrequency === "ppc_biweekly"
            ? "biweekly"
            : clientReportFrequency === "ppc_monthly"
            ? "monthly"
            : clientReportFrequency;

        // 1) Create or update schedule for this client
        const scheduleRes = await api.post(`/seo/reports/${clientId}/schedule`, {
          frequency: resolvedFrequency,
          reportKind: isLocalMapSchedule ? "local_map" : isPpcSchedule ? "ppc" : "seo",
          dayOfWeek: resolvedFrequency !== "monthly" ? clientReportDayOfWeek : undefined,
          dayOfMonth: resolvedFrequency === "monthly" ? clientReportDayOfMonth : undefined,
          timeOfDay: clientReportTimeOfDay,
          recipients: recipientsList,
          emailSubject: modalEmailSubject || undefined,
          isActive: true,
        }, { timeout: 15000 });

        // Keep Report tab in sync immediately after PPC schedule save (no browser refresh required).
        if (isPpcSchedule) {
          const savedSchedule = scheduleRes?.data?.schedule;
          setPpcScheduleMeta({
            hasSchedule: true,
            scheduleId: typeof savedSchedule?.id === "string" ? savedSchedule.id : ppcScheduleMeta.scheduleId,
            isActive: savedSchedule?.isActive == null ? true : Boolean(savedSchedule.isActive),
            frequency:
              typeof savedSchedule?.frequency === "string"
                ? savedSchedule.frequency
                : resolvedFrequency,
            lastRunAt: savedSchedule?.lastRunAt ? String(savedSchedule.lastRunAt) : ppcScheduleMeta.lastRunAt,
            nextRunAt: savedSchedule?.nextRunAt ? String(savedSchedule.nextRunAt) : ppcScheduleMeta.nextRunAt,
            recipients: recipientsList,
          });
        }
        if (isLocalMapSchedule) {
          const savedSchedule = scheduleRes?.data?.schedule;
          setLocalMapScheduleMeta({
            hasSchedule: true,
            scheduleId: typeof savedSchedule?.id === "string" ? savedSchedule.id : localMapScheduleMeta.scheduleId,
            isActive: savedSchedule?.isActive == null ? true : Boolean(savedSchedule.isActive),
            frequency:
              typeof savedSchedule?.frequency === "string"
                ? savedSchedule.frequency
                : resolvedFrequency,
            lastRunAt: savedSchedule?.lastRunAt ? String(savedSchedule.lastRunAt) : localMapScheduleMeta.lastRunAt,
            nextRunAt: savedSchedule?.nextRunAt ? String(savedSchedule.nextRunAt) : localMapScheduleMeta.nextRunAt,
            recipients: recipientsList,
          });
        }

        // 2) Generate initial SEO report immediately; Local Map and PPC schedules are handled by scheduler runs.
        if (!isLocalMapSchedule && !isPpcSchedule) {
          await api.post(`/seo/reports/${clientId}/generate`, {
            period: resolvedFrequency,
          }, { timeout: 90000 });
        }

        toast.success(
          isLocalMapSchedule
            ? "Local Map report schedule saved successfully"
            : isPpcSchedule
            ? "PPC report schedule saved successfully"
            : "Report created and schedule saved successfully"
        );
      }

      // Sync parent state so next open shows saved values
      setClientReportRecipients(modalRecipients);
      setClientReportEmailSubject(modalEmailSubject);

      // Reload report data from server so table Recipients column matches what was just saved
      await loadReport(false);

      // Close modal
      setShowClientReportModal(false);
    } catch (error: any) {
      const status = Number(error?.response?.status || 0);
      const isTimeout = error?.code === "ECONNABORTED" || error?.message?.toLowerCase().includes("timeout");
      const msg = isTimeout
        ? "Request timed out. Report generation can take up to a minute. Please try again."
        : (error?.response?.data?.message || "Failed to create report and schedule");
      if (!(status === 400 && /google ads/i.test(String(msg)))) {
        console.error("Failed to create report and schedule", error);
      }
      toast.error(msg);
    } finally {
      setClientReportSubmitting(false);
    }
  };

  const handleViewReport = (report: ClientReport) => {
    setSelectedReport(report);
    setViewReportModalOpen(true);
  };

  const handleViewLocalMapReport = useCallback(async () => {
    if (!clientId) {
      toast.error("Client ID is missing");
      return;
    }
    try {
      const res = await api.get(`/local-map/keywords/${clientId}`, { _silent: true } as any);
      const rows = Array.isArray(res?.data) ? res.data : [];
      const activeRows = rows.filter((row: any) => row?.status === "active" && typeof row?.id === "string");
      const firstKeyword = activeRows[0];
      if (!firstKeyword?.id) {
        toast.error("No active Local Map keywords found for this dashboard.");
        return;
      }
      await openLocalMapReport(firstKeyword.id);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to load Local Map report.");
    }
  }, [clientId, openLocalMapReport]);

  const toStringArray = useCallback((value: unknown): string[] => {
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
  }, []);

  useEffect(() => {
    if (!viewReportModalOpen || !clientId) return;
    if (selectedReport?.scheduleKind === "ppc") {
      setReportPreviewTargetKeywords([]);
      setReportPreviewShareUrl(null);
      setReportPreviewTargetKeywordsError(null);
      setReportPreviewTargetKeywordsLoading(false);
      setReportPreviewShareLoading(false);
      let cancelled = false;

      const runPpcPreview = async () => {
        try {
          setReportPreviewPpcLoading(true);
          setReportPreviewPpcError(null);

          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 30);
          const params = {
            start: startDate.toISOString().split("T")[0],
            end: endDate.toISOString().split("T")[0],
            activeOnly: "true",
          };
          const [campaignsRes, adGroupsRes, keywordsRes, conversionsRes] = await Promise.all([
            api.get(`/clients/${clientId}/google-ads/campaigns`, { params, _silent: true } as any),
            api.get(`/clients/${clientId}/google-ads/ad-groups`, { params, _silent: true } as any),
            api.get(`/clients/${clientId}/google-ads/keywords`, { params, _silent: true } as any),
            api.get(`/clients/${clientId}/google-ads/conversions`, { params, _silent: true } as any),
          ]);

          if (cancelled) return;
          const merged = {
            success: true,
            data: {
              summary: campaignsRes?.data?.data?.summary ?? null,
              campaigns: campaignsRes?.data?.data?.campaigns ?? [],
              adGroups: adGroupsRes?.data?.data?.adGroups ?? [],
              keywords: keywordsRes?.data?.data?.keywords ?? [],
              conversions: conversionsRes?.data?.data?.conversions ?? [],
              conversionsSummary: conversionsRes?.data?.data?.summary ?? null,
            },
          };
          setReportPreviewPpcData(merged);
        } catch (e: any) {
          if (cancelled) return;
          setReportPreviewPpcData(null);
          setReportPreviewPpcError(
            e?.response?.data?.message ||
              e?.response?.data?.error ||
              e?.message ||
              "Failed to load PPC report data."
          );
        } finally {
          if (cancelled) return;
          setReportPreviewPpcLoading(false);
        }
      };

      void runPpcPreview();
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;
    setReportPreviewPpcData(null);
    setReportPreviewPpcError(null);
    setReportPreviewPpcLoading(false);

    const run = async () => {
      try {
        setReportPreviewTargetKeywordsLoading(true);
        setReportPreviewTargetKeywordsError(null);
        setReportPreviewShareLoading(true);

        const [tkRes, shareRes] = await Promise.all([
          api.get(`/seo/target-keywords/${clientId}`),
          api.post(`/seo/share-link/${clientId}`),
        ]);

        if (cancelled) return;

        const tkRows = Array.isArray(tkRes.data) ? (tkRes.data as ReportTargetKeywordRow[]) : [];
        // Sort by highest rank (lowest position number) first, nulls at the end
        const sorted = tkRows.sort((a, b) => {
          const aPos = a.googlePosition ?? Infinity;
          const bPos = b.googlePosition ?? Infinity;
          return aPos - bPos; // Lower position number = higher rank
        });
        setReportPreviewTargetKeywords(sorted.slice(0, 50));

        const token = shareRes?.data?.token;
        const url = token ? `${window.location.origin}/share/${encodeURIComponent(token)}` : null;
        setReportPreviewShareUrl(url);
      } catch (e: any) {
        if (cancelled) return;
        setReportPreviewTargetKeywords([]);
        setReportPreviewShareUrl(null);
        setReportPreviewTargetKeywordsError(e?.response?.data?.message || "Failed to load report details.");
      } finally {
        if (cancelled) return;
        setReportPreviewTargetKeywordsLoading(false);
        setReportPreviewShareLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [clientId, viewReportModalOpen, selectedReport?.scheduleKind]);

  const handleSendReport = useCallback(async () => {
    if (includedClientReadOnly) return;
    if (!singleReportForClient) {
      toast.error("No report to send for this client");
      return;
    }

    if (!singleReportForClient.recipients || singleReportForClient.recipients.length === 0) {
      toast.error("No recipients configured for this report. Please add recipients in the schedule settings first.");
      return;
    }

    try {
      setSendingReport(true);
      await api.post(`/seo/reports/${singleReportForClient.id}/send`, {
        recipients: singleReportForClient.recipients,
      });
      toast.success("Report sent successfully");
      await loadReport();
    } catch (error: any) {
      console.error("Failed to send report", error);
      const msg = error?.response?.data?.message || "Failed to send report";
      toast.error(msg);
    } finally {
      setSendingReport(false);
    }
  }, [singleReportForClient, loadReport, includedClientReadOnly]);

  const handleSendPpcReportNow = useCallback(async () => {
    if (!clientId) {
      toast.error("Client ID is missing");
      return;
    }
    if (!canModifyClientSettings) {
      toast.error("Included clients are view-only.");
      return;
    }
    try {
      setSendingPpcReport(true);
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const params = {
        start: startDate.toISOString().split("T")[0],
        end: endDate.toISOString().split("T")[0],
        activeOnly: "true",
      };
      const [campaignsRes, adGroupsRes, keywordsRes, conversionsRes, pdfRes] = await Promise.all([
        api.get(`/clients/${clientId}/google-ads/campaigns`, { params, _silent: true } as any),
        api.get(`/clients/${clientId}/google-ads/ad-groups`, { params, _silent: true } as any),
        api.get(`/clients/${clientId}/google-ads/keywords`, { params, _silent: true } as any),
        api.get(`/clients/${clientId}/google-ads/conversions`, { params, _silent: true } as any),
        api.get(`/seo/reports/${clientId}/ppc/latest-pdf`, { params: { period: "monthly" }, responseType: "blob", _silent: true } as any),
      ]);
      const reportPayload = {
        success: true,
        data: {
          summary: campaignsRes?.data?.data?.summary ?? null,
          campaigns: campaignsRes?.data?.data?.campaigns ?? [],
          adGroups: adGroupsRes?.data?.data?.adGroups ?? [],
          keywords: keywordsRes?.data?.data?.keywords ?? [],
          conversions: conversionsRes?.data?.data?.conversions ?? [],
          conversionsSummary: conversionsRes?.data?.data?.summary ?? null,
        },
      };
      const emailHtml = buildPpcEmailHtmlFromReport(reportPayload, client?.name || "Client");
      const pdfBlob = pdfRes?.data instanceof Blob ? pdfRes.data : new Blob([pdfRes?.data], { type: "application/pdf" });
      const pdfBase64 = await blobToBase64(pdfBlob);
      await api.post(`/seo/reports/${clientId}/ppc/send`, {
        recipients: ppcScheduleMeta.recipients,
        emailHtml,
        attachment: {
          filename: `ppc-analytics-report-${new Date().toISOString().slice(0, 10)}.pdf`,
          contentType: "application/pdf",
          contentBase64: pdfBase64,
        },
      });
      toast.success("PPC report sent successfully");
    } catch (error: any) {
      console.error("Failed to send PPC report", error);
      const msg =
        error?.response?.data?.message ||
        "Failed to send PPC report. Create a PPC schedule with recipients first.";
      toast.error(msg);
    } finally {
      setSendingPpcReport(false);
    }
  }, [client?.name, clientId, canModifyClientSettings, ppcScheduleMeta.recipients]);

  const handleSendLocalMapReportNow = useCallback(async () => {
    if (!clientId) {
      toast.error("Client ID is missing");
      return;
    }
    if (!canModifyClientSettings) {
      toast.error("Included clients are view-only.");
      return;
    }
    if (!localMapScheduleMeta.recipients.length) {
      toast.error("No recipients configured for Local Map report.");
      return;
    }
    try {
      setSendingLocalMapReport(true);
      let reportPayload = localMapReport;
      if (!reportPayload) {
        const keywordsRes = await api.get(`/local-map/keywords/${clientId}`, { _silent: true } as any);
        const keywordRows = Array.isArray(keywordsRes?.data) ? keywordsRes.data : [];
        const activeRows = keywordRows.filter((row: any) => row?.status === "active" && typeof row?.id === "string");
        const firstKeyword = activeRows[0];
        if (!firstKeyword?.id) {
          toast.error("No active Local Map keywords found for this dashboard.");
          return;
        }
        const reportRes = await api.get(`/local-map/report/${firstKeyword.id}`, { _silent: true } as any);
        reportPayload = reportRes.data as LocalMapKeywordReportPayload;
        setLocalMapReport(reportPayload);
      }
      if (!reportPayload) {
        toast.error("Unable to load Local Map report content.");
        return;
      }
      const modalWasOpen = localMapReportOpen;
      if (!modalWasOpen) {
        setLocalMapReportOpen(true);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      const pdfResult = await exportLocalMapReportPdfBlob(reportPayload, { silent: true });
      if (!pdfResult) {
        toast.error("Unable to generate Local Map PDF for email.");
        if (!modalWasOpen) setLocalMapReportOpen(false);
        return;
      }
      const pdfBase64 = await blobToBase64(pdfResult.blob);
      const emailHtml = buildLocalMapEmailHtmlFromReport(reportPayload, client?.name || "Client");
      await api.post(`/local-map/reports/${clientId}/send`, {
        recipients: localMapScheduleMeta.recipients,
        emailHtml,
        attachment: {
          filename: pdfResult.filename,
          contentType: "application/pdf",
          contentBase64: pdfBase64,
        },
      });
      if (!modalWasOpen) setLocalMapReportOpen(false);
      setLocalMapScheduleMeta((prev) => ({
        ...prev,
        lastRunAt: new Date().toISOString(),
      }));
      toast.success("Local Map report sent successfully");
    } catch (error: any) {
      if (!localMapReportOpen) {
        setLocalMapReportOpen(false);
      }
      const msg =
        error?.response?.data?.message ||
        "Failed to send Local Map report. Create a Local Map schedule with recipients first.";
      toast.error(msg);
    } finally {
      setSendingLocalMapReport(false);
    }
  }, [
    client?.name,
    clientId,
    canModifyClientSettings,
    exportLocalMapReportPdfBlob,
    localMapReport,
    localMapReportOpen,
    localMapScheduleMeta.recipients,
  ]);

  const handleViewCampaignWinsHtml = useCallback(async () => {
    if (!clientId) {
      toast.error("Client ID is missing");
      return;
    }
    try {
      const res = await api.get(`/seo/reports/${clientId}/campaign-wins/preview`, { _silent: true } as any);
      const html = String(res?.data?.html || "");
      if (!html) {
        toast.error("Campaign Wins preview is unavailable.");
        return;
      }
      setCampaignWinsPreviewModal({
        open: true,
        clientName: client?.name || "Client",
        subject: String(res?.data?.subject || ""),
        recipients: Array.isArray(res?.data?.recipients) ? res.data.recipients : [],
        html,
      });
    } catch (error: any) {
      const msg = error?.response?.data?.message || "Failed to load Campaign Wins HTML preview";
      toast.error(msg);
    }
  }, [clientId, client?.name]);

  const handleSendCampaignWinsNow = useCallback(async () => {
    if (!clientId) {
      toast.error("Client ID is missing");
      return;
    }
    if (!canModifyClientSettings) {
      toast.error("Included clients are view-only.");
      return;
    }
    try {
      setSendingCampaignWinsReport(true);
      await api.post(`/seo/reports/${clientId}/campaign-wins/instant-send`, {});
      setCampaignWinsMeta((prev) => ({
        ...prev,
        lastSent: new Date().toISOString(),
      }));
      toast.success("Campaign Wins report sent successfully");
    } catch (error: any) {
      const msg = error?.response?.data?.message || "Failed to send Campaign Wins report";
      toast.error(msg);
    } finally {
      setSendingCampaignWinsReport(false);
    }
  }, [clientId, canModifyClientSettings]);

  const handleDeleteCampaignWinsReport = useCallback(() => {
    if (!canModifyClientSettings) {
      toast.error("Included clients are view-only.");
      return;
    }
    if (!campaignWinsMeta.enabled) {
      toast.error("No Campaign Wins report to delete.");
      return;
    }
    setCampaignWinsDeleteConfirm({
      isOpen: true,
      label: "Campaign Wins Report",
    });
  }, [canModifyClientSettings, campaignWinsMeta.enabled]);

  const confirmDeleteCampaignWinsReport = useCallback(async () => {
    if (!clientId) {
      setCampaignWinsDeleteConfirm({ isOpen: false, label: null });
      return;
    }
    try {
      await api.delete(`/seo/reports/${clientId}/campaign-wins`);
      setCampaignWinsMeta({
        enabled: false,
        recipients: [],
        lastSent: null,
      });
      toast.success("Campaign Wins report deleted successfully");
    } catch (error: any) {
      const msg = error?.response?.data?.message || "Failed to delete Campaign Wins report";
      toast.error(msg);
    } finally {
      setCampaignWinsDeleteConfirm({ isOpen: false, label: null });
    }
  }, [clientId]);

  const handleDeleteReport = useCallback(async () => {
    if (includedClientReadOnly) return;
    if (!singleReportForClient) {
      toast.error("No report to delete for this client");
      return;
    }
    setReportDeleteConfirm({
      isOpen: true,
      reportId: singleReportForClient.id,
      label: singleReportForClient.name,
    });
  }, [singleReportForClient, includedClientReadOnly]);

  const handleDeletePpcReport = useCallback(() => {
    if (!canModifyClientSettings) {
      toast.error("Included clients are view-only.");
      return;
    }
    if (!ppcScheduleMeta.scheduleId) {
      toast.error("No PPC report schedule to delete.");
      return;
    }
    setPpcReportDeleteConfirm({
      isOpen: true,
      scheduleId: ppcScheduleMeta.scheduleId,
      label: "Client PPC Report",
    });
  }, [canModifyClientSettings, ppcScheduleMeta.scheduleId]);

  const handleDeleteLocalMapReport = useCallback(() => {
    if (!canModifyClientSettings) {
      toast.error("Included clients are view-only.");
      return;
    }
    if (!localMapScheduleMeta.scheduleId) {
      toast.error("No Local Map report schedule to delete.");
      return;
    }
    setLocalMapReportDeleteConfirm({
      isOpen: true,
      scheduleId: localMapScheduleMeta.scheduleId,
      label: "Local Map Rankings Report",
    });
  }, [canModifyClientSettings, localMapScheduleMeta.scheduleId]);

  const confirmDeletePpcReport = async () => {
    if (!ppcReportDeleteConfirm.scheduleId) {
      setPpcReportDeleteConfirm({ isOpen: false, scheduleId: null, label: null });
      return;
    }
    try {
      await api.delete(`/seo/reports/schedules/${ppcReportDeleteConfirm.scheduleId}`);
      toast.success("PPC report deleted successfully");
      await loadPpcScheduleMeta();
    } catch (error: any) {
      const msg = error?.response?.data?.message || "Failed to delete PPC report";
      toast.error(msg);
    } finally {
      setPpcReportDeleteConfirm({ isOpen: false, scheduleId: null, label: null });
    }
  };

  const confirmDeleteLocalMapReport = async () => {
    if (!localMapReportDeleteConfirm.scheduleId) {
      setLocalMapReportDeleteConfirm({ isOpen: false, scheduleId: null, label: null });
      return;
    }
    try {
      await api.delete(`/seo/reports/schedules/${localMapReportDeleteConfirm.scheduleId}`);
      toast.success("Local Map report deleted successfully");
      setLocalMapScheduleMeta({
        hasSchedule: false,
        scheduleId: null,
        isActive: false,
        frequency: null,
        lastRunAt: null,
        nextRunAt: null,
        recipients: [],
      });
    } catch (error: any) {
      const msg = error?.response?.data?.message || "Failed to delete Local Map report";
      toast.error(msg);
    } finally {
      setLocalMapReportDeleteConfirm({ isOpen: false, scheduleId: null, label: null });
    }
  };

  const confirmDeleteReport = useCallback(async () => {
    if (!reportDeleteConfirm.reportId) {
      setReportDeleteConfirm({ isOpen: false, reportId: null, label: null });
      return;
    }

    try {
      setReportLoading(true);
      await api.delete(`/seo/reports/${reportDeleteConfirm.reportId}`);
      toast.success("Report deleted successfully");
      // Reload without ensureFresh to prevent auto-generating a new report immediately
      await loadReport(false);
    } catch (error: any) {
      console.error("Failed to delete report", error);
      const errorMsg = error?.response?.data?.message || "Failed to delete report";
      const statusCode = error?.response?.status;
      
      // Provide more specific error messages
      if (statusCode === 403) {
        toast.error("Access denied. You don't have permission to delete this report.");
      } else if (statusCode === 404) {
        toast.error("Report not found. It may have already been deleted.");
        // Still reload to refresh the UI
        await loadReport(false);
      } else {
        toast.error(errorMsg);
      }
    } finally {
      setReportLoading(false);
      setReportDeleteConfirm({ isOpen: false, reportId: null, label: null });
    }
  }, [loadReport, reportDeleteConfirm.reportId]);

  const handleCloseViewModal = () => {
    setViewReportModalOpen(false);
    setSelectedReport(null);
  };

  const resolvedTopPages = useMemo<TopPageItem[]>(() => {
    // Return actual data only, no sample data fallback
    return topPages;
  }, [topPages]);

  const resolvedTrafficSources = useMemo<TrafficSourceSlice[]>(() => {
    return trafficSources;
  }, [trafficSources]);

  const trafficSourcesWithCompare = useMemo(() => {
    if (!trafficSourcesCompare.length) return resolvedTrafficSources.map((t) => ({ ...t, previousValue: undefined as number | undefined }));
    const byName = new Map(trafficSourcesCompare.map((t) => [t.name, t.value]));
    return resolvedTrafficSources.map((t) => ({
      ...t,
      previousValue: byName.get(t.name),
    }));
  }, [resolvedTrafficSources, trafficSourcesCompare]);

  const handleConnectGA4 = async () => {
    if (!clientId) return;
    try {
      setGa4Connecting(true);
      // Request auth URL with popup parameter
      const res = await api.get(`/clients/${clientId}/ga4/auth-url?popup=true`);
      const authUrl = res.data?.authUrl;
      if (authUrl) {
        // Open GA4 OAuth flow in a popup window
        const width = 500;
        const height = 600;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;
        
        const popup = window.open(
          authUrl,
          'ga4-oauth',
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
        );

        if (!popup) {
          toast.error('Please allow popups to connect GA4');
          setGa4Connecting(false);
          return;
        }

        const messageListener = (event: MessageEvent) => {
          // Accept messages from same origin or backend origin
          // The popup callback page is served from the backend, so messages come from backend origin
          try {
            const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
            const backendOrigin = new URL(backendUrl).origin;
            
            // Allow messages from same origin or backend origin
            if (event.origin !== window.location.origin && event.origin !== backendOrigin) {
              return;
            }
          } catch (e) {
            // If URL parsing fails, only accept same-origin messages
            if (event.origin !== window.location.origin) {
              return;
            }
          }

          if (event.data.type === 'GA4_OAUTH_SUCCESS') {
            cleanupPopup();
            toast.success('OAuth successful! Loading your GA4 properties...');
            setGa4Connecting(false);
            setGa4ConnectionError(null); // Clear any previous connection errors
            // Fetch properties list
            handleFetchGA4Properties();
          } else if (event.data.type === 'GA4_OAUTH_ERROR') {
            cleanupPopup();
            toast.error(`GA4 connection failed: ${event.data.error || 'Unknown error'}`);
            setGa4Connecting(false);
          }
        };
        let manualCloseTimeout: number | null = null;

        const cleanupPopup = () => {
          if (messageListener) {
            window.removeEventListener('message', messageListener);
          }
          if (manualCloseTimeout !== null) {
            window.clearTimeout(manualCloseTimeout);
            manualCloseTimeout = null;
          }
        };

        window.addEventListener('message', messageListener);

        // Set a maximum timeout (5 minutes). Do not call popup.close() from opener - COOP blocks it
        manualCloseTimeout = window.setTimeout(() => {
          cleanupPopup();
          if (ga4Connecting) {
            setGa4Connecting(false);
            toast.error('GA4 connection timed out. Please try again.');
          }
        }, 5 * 60 * 1000) as unknown as number;
      }
    } catch (error: any) {
      console.error("Failed to connect GA4:", error);
      toast.error(error.response?.data?.message || "Failed to connect GA4");
      setGa4Connecting(false);
    }
  };

  const handleDisconnectGA4 = async () => {
    if (!clientId) return;
    try {
      setGa4Connecting(true);
      await api.post(`/clients/${clientId}/ga4/disconnect`);
      toast.success("GA4 disconnected successfully");
      setGa4Connected(false);
      setGa4AccountEmail(null);
      setGa4ConnectionError(null); // Clear connection error when disconnecting
      // Optionally clear GA4-derived metrics from the dashboard
      setDashboardSummary((prev) =>
        prev
          ? {
              ...prev,
              activeUsers: null,
              eventCount: null,
              newUsers: null,
              keyEvents: null,
              activeUsersTrend: [],
              newUsersTrend: [],
            }
          : prev
      );
    } catch (error: any) {
      console.error("Failed to disconnect GA4:", error);
      toast.error(error.response?.data?.message || "Failed to disconnect GA4");
    } finally {
      setGa4Connecting(false);
    }
  };

  const handleFetchGA4Properties = async (showModal: boolean = true, forceRefresh: boolean = true) => {
    if (!clientId) return;
    try {
      setLoadingProperties(true);
      // Add cache-busting parameter and force refresh flag to ensure fresh data
      const res = await api.get(`/clients/${clientId}/ga4/properties`, {
        params: { 
          _t: Date.now(), // Cache busting
          forceRefresh: forceRefresh ? 'true' : 'false' // Force token refresh on backend
        }
      });
      const properties = res.data?.properties || [];
      
      if (properties.length === 0) {
        if (showModal) {
          toast.error("No GA4 properties found. Please make sure you have access to at least one GA4 property.");
        }
        setGa4Properties([]);
        if (showModal) {
          setShowGA4Modal(true);
        }
        return;
      }
      
      setGa4Properties(properties);
      if (showModal) {
        setShowGA4Modal(true);
      }
    } catch (error: any) {
      console.error("Failed to fetch GA4 properties:", error);
      const errorMsg = error.response?.data?.message || "Failed to fetch GA4 properties";
      console.error("GA4 Properties Error Details:", {
        message: errorMsg,
        status: error.response?.status,
        data: error.response?.data,
      });
      if (showModal) {
        toast.error(errorMsg);
      }
      // If token expired, suggest reconnecting
      if (errorMsg.includes("expired") || errorMsg.includes("revoked") || errorMsg.includes("reconnect")) {
        toast.error("GA4 access token may be expired. Please disconnect and reconnect GA4 to refresh your permissions.", { duration: 6000 });
      } else if (errorMsg.includes("OAuth flow")) {
        toast.error("Please complete the OAuth flow first by clicking 'Connect GA4' and authorizing access.", { duration: 6000 });
      }
      setGa4Properties([]);
    } finally {
      setLoadingProperties(false);
    }
  };

  // Auto-refresh properties when modal opens to ensure latest access is shown
  useEffect(() => {
    if (showGA4Modal && clientId && !loadingProperties) {
      // Always refresh properties when modal opens to get latest GA4 access
      handleFetchGA4Properties(false, true); // Force refresh when modal opens
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGA4Modal, clientId]);

  const handleSubmitPropertyId = async (selectedPropertyId?: string) => {
    const propertyIdToUse = selectedPropertyId || ga4PropertyId.trim();
    if (!clientId || !propertyIdToUse) {
      toast.error("Please select a GA4 property");
      return;
    }
    try {
      setGa4Connecting(true);
      await api.post(`/clients/${clientId}/ga4/connect`, {
        propertyId: propertyIdToUse,
      });
      toast.success("GA4 connected successfully!");
      setShowGA4Modal(false);
      setGa4PropertyId("");
      setGa4Properties([]);
      setGa4Connected(true);
      // Refresh dashboard data
      const res = await api.get(buildDashboardUrl(clientId), { timeout: DASHBOARD_REQUEST_TIMEOUT_MS });
      const payload = res.data || {};
      setDashboardSummary(formatDashboardSummary(payload));
    } catch (error: any) {
      console.error("Failed to connect GA4 property:", error);
      toast.error(error.response?.data?.message || "Failed to connect GA4 property");
    } finally {
      setGa4Connecting(false);
    }
  };

  // Google Ads (PPC) connection handlers
  const handleConnectGoogleAds = async () => {
    if (!clientId) return;
    try {
      setGoogleAdsConnecting(true);
      const res = await api.get(`/clients/${clientId}/google-ads/auth`, { params: { popup: '1' } });
      const authUrl = res.data?.authUrl;
      const redirectUri = res.data?.redirectUri;
      const oauthClientId = res.data?.oauthClientId;
      if (redirectUri) {
        console.info("[Google Ads] OAuth redirect URI:", redirectUri);
      }
      if (oauthClientId) {
        console.info("[Google Ads] OAuth client ID:", oauthClientId);
      }
      if (authUrl) {
        const width = 500;
        const height = 600;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;
        
        const popup = window.open(
          authUrl,
          'google-ads-oauth',
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
        );

        if (!popup) {
          toast.error('Please allow popups to connect Google Ads');
          setGoogleAdsConnecting(false);
          return;
        }

        const messageListener = (event: MessageEvent) => {
          try {
            const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
            const backendOrigin = new URL(backendUrl).origin;
            if (event.origin !== window.location.origin && event.origin !== backendOrigin) {
              return;
            }
          } catch (e) {
            if (event.origin !== window.location.origin) {
              return;
            }
          }

          if (event.data.type === 'GOOGLE_ADS_OAUTH_SUCCESS') {
            cleanupPopup();
            // Do not call popup.close() from opener - Cross-Origin-Opener-Policy blocks it; the callback page closes the popup itself
            setGoogleAdsConnecting(false);
            setGoogleAdsConnectionError(null);
            // Refresh status in current window so Integrations shows "Select Google Ads account" or "Connected"
            fetchGoogleAdsStatus().then(() => {
              toast.success('OAuth successful! Loading your Google Ads accounts...');
              handleFetchGoogleAdsCustomers();
            });
          } else if (event.data.type === 'GOOGLE_ADS_OAUTH_ERROR') {
            cleanupPopup();
            toast.error(`Google Ads connection failed: ${event.data.error || 'Unknown error'}`);
            setGoogleAdsConnecting(false);
          }
        };
        let manualCloseTimeout: number | null = null;

        const cleanupPopup = () => {
          if (messageListener) {
            window.removeEventListener('message', messageListener);
          }
          if (manualCloseTimeout) {
            clearTimeout(manualCloseTimeout);
          }
        };

        window.addEventListener('message', messageListener);

        // Cleanup after 10 minutes. Do not call popup.close() from opener - COOP blocks it; user can close the popup manually if needed
        manualCloseTimeout = window.setTimeout(() => {
          cleanupPopup();
          setGoogleAdsConnecting(false);
        }, 10 * 60 * 1000);
      }
    } catch (error: any) {
      console.error("Failed to connect Google Ads:", error);
      toast.error(error.response?.data?.message || "Failed to connect Google Ads");
      setGoogleAdsConnecting(false);
    }
  };

  const handleFetchGoogleAdsCustomers = async () => {
    if (!clientId) return;
    try {
      setLoadingGoogleAdsCustomers(true);
      setGoogleAdsSelectedManager(null);
      setGoogleAdsChildAccounts([]);
      // Fetch flattened client accounts list (no manager rows) for simpler PPC connection.
      const res = await api.get(`/clients/${clientId}/google-ads/customers`, {
        params: { clientOnly: 'true' },
      });
      const customers = Array.isArray(res.data?.customers)
        ? res.data.customers.filter((c: any) => !c?.status || String(c.status).toUpperCase() === "ENABLED")
        : [];
      const sortedCustomers = [...customers].sort((a: any, b: any) => {
        const nameA = String(a?.customerName || "").toLowerCase();
        const nameB = String(b?.customerName || "").toLowerCase();
        if (nameA !== nameB) return nameA.localeCompare(nameB);
        return String(a?.customerId || "").localeCompare(String(b?.customerId || ""));
      });
      
      if (sortedCustomers.length === 0) {
        toast.error("No active PPC accounts found. Connect an account that has at least one enabled campaign.");
        return;
      }
      
      setGoogleAdsCustomers(sortedCustomers);
      setShowGoogleAdsModal(true);
    } catch (error: any) {
      console.error("Failed to fetch Google Ads customers:", error);
      toast.error(error.response?.data?.message || "Failed to fetch Google Ads customers");
    } finally {
      setLoadingGoogleAdsCustomers(false);
    }
  };

  const handleSelectGoogleAdsAccount = async (customer: { customerId: string; customerName: string; managerCustomerId?: string | null; isManager?: boolean }) => {
    if (!clientId) return;
    if (customer.isManager) {
      // Manager account: fetch child accounts and show picker so user can select which client to connect
      try {
        setLoadingGoogleAdsChildAccounts(true);
        setGoogleAdsSelectedManager({ customerId: customer.customerId, customerName: customer.customerName });
        const res = await api.get(`/clients/${clientId}/google-ads/child-accounts`, {
          params: { customerId: customer.customerId },
        });
        const children = res.data?.children || [];
        setGoogleAdsChildAccounts(children);
        if (children.length === 0) {
          toast.error("No client accounts found under this manager.");
        }
      } catch (error: any) {
        console.error("Failed to fetch child accounts:", error);
        toast.error(error.response?.data?.message || "Failed to load client accounts");
        setGoogleAdsSelectedManager(null);
        setGoogleAdsChildAccounts([]);
      } finally {
        setLoadingGoogleAdsChildAccounts(false);
      }
    } else {
      // Standalone client account: connect directly
      await handleSubmitGoogleAdsCustomerId(customer.customerId, customer.managerCustomerId ?? undefined);
    }
  };

  const handleSubmitGoogleAdsCustomerId = async (selectedCustomerId?: string, managerCustomerId?: string | null) => {
    const customerIdToUse = selectedCustomerId || googleAdsCustomerId.trim();
    if (!clientId || !customerIdToUse) {
      toast.error("Please select a Google Ads account");
      return;
    }
    try {
      setGoogleAdsConnecting(true);
      const body: { customerId: string; managerCustomerId?: string } = { customerId: customerIdToUse };
      const managerId = managerCustomerId ?? googleAdsSelectedManager?.customerId;
      if (managerId) {
        body.managerCustomerId = managerId;
      }
      await api.post(`/clients/${clientId}/google-ads/connect`, body);
      toast.success("Google Ads connected successfully!");
      setShowGoogleAdsModal(false);
      setGoogleAdsCustomerId("");
      setGoogleAdsCustomers([]);
      setGoogleAdsSelectedManager(null);
      setGoogleAdsChildAccounts([]);
      setGoogleAdsConnected(true);
      // Refresh PPC data if on PPC section
      if (dashboardSection === "ppc") {
        await loadPpcData();
      }
    } catch (error: any) {
      console.error("Failed to connect Google Ads account:", error);
      toast.error(error.response?.data?.message || "Failed to connect Google Ads account");
    } finally {
      setGoogleAdsConnecting(false);
    }
  };

  const handleDisconnectGoogleAds = async () => {
    if (!clientId) return;
    try {
      setGoogleAdsConnecting(true);
      await api.post(`/clients/${clientId}/google-ads/disconnect`);
      toast.success("Google Ads disconnected successfully");
      setGoogleAdsConnected(false);
      setGoogleAdsHasTokens(false);
      setGoogleAdsAccountEmail(null);
      setGoogleAdsConnectionError(null);
      setPpcData(null);
    } catch (error: any) {
      console.error("Failed to disconnect Google Ads:", error);
      toast.error(error.response?.data?.message || "Failed to disconnect Google Ads");
    } finally {
      setGoogleAdsConnecting(false);
    }
  };

  // Load PPC data based on current subsection
  const loadPpcData = async () => {
    if (!clientId || !googleAdsConnected) return;
    try {
      setPpcLoading(true);
      setPpcError(null);
      
      // Calculate date range
      let startDate: Date;
      let endDate: Date = new Date();
      
      const days = parseInt(ppcDateRange, 10) || 30;
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      let endpoint = '';
      const params: any = {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
        activeOnly: "true",
      };
      
      if (ppcSubSection === 'campaigns') {
        endpoint = `/clients/${clientId}/google-ads/campaigns`;
      } else if (ppcSubSection === 'ad-groups') {
        endpoint = `/clients/${clientId}/google-ads/ad-groups`;
      } else if (ppcSubSection === 'keywords') {
        endpoint = `/clients/${clientId}/google-ads/keywords`;
      } else if (ppcSubSection === 'conversions') {
        endpoint = `/clients/${clientId}/google-ads/conversions`;
      }
      
      if (endpoint) {
        const res = await api.get(endpoint, { params, _silent: true } as any);
        setPpcData(res.data);
        if (res.data?.success === false && res.data?.message) {
          setPpcError(res.data.message);
        } else {
          setPpcError(null);
        }
      }
    } catch (error: any) {
      console.error("Failed to load PPC data:", error);
      const message =
        error.response?.data?.message ??
        error.response?.data?.error ??
        error.message ??
        "Failed to load PPC data";
      const normalizedMessage = typeof message === "string" ? message : "Failed to load PPC data";
      const status = Number(error?.response?.status || 0);
      const notConnected =
        /google ads is not connected/i.test(normalizedMessage) ||
        error?.response?.data?.connected === false;
      const inactiveAccount = /isn'?t active|not yet enabled|deactivated|customer_not_enabled/i.test(normalizedMessage);

      if (status === 400 && notConnected) {
        setGoogleAdsConnected(false);
        setPpcData(null);
        setPpcError("Google Ads is not connected for this client. Please reconnect Google Ads.");
        return;
      }

      if (status === 400 && inactiveAccount) {
        setPpcData(null);
        setPpcError(
          "The connected Google Ads account isn't active. Disconnect and reconnect an active Google Ads account."
        );
        return;
      }

      setPpcError(normalizedMessage);
    } finally {
      setPpcLoading(false);
    }
  };

  const loadPpcScheduleMeta = useCallback(async () => {
    if (!clientId) return;
    try {
      const res = await api.get(`/seo/reports/${clientId}/schedules`);
      const schedules = Array.isArray(res.data) ? res.data : [];
      const parseRecipients = (value: unknown): string[] => {
        if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
        if (value == null) return [];
        const raw = String(value).trim();
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
          }
        } catch {
          // ignore and fall back to comma split
        }
        if (raw.includes(",")) return raw.split(",").map((s) => s.trim()).filter(Boolean);
        return [raw];
      };
      const localMapSchedule = schedules.find((s: any) =>
        typeof s?.emailSubject === "string" && String(s.emailSubject).startsWith(LOCAL_MAP_SCHEDULE_PREFIX)
      );
      if (!localMapSchedule) {
        setLocalMapScheduleMeta({
          hasSchedule: false,
          scheduleId: null,
          isActive: false,
          frequency: null,
          lastRunAt: null,
          nextRunAt: null,
          recipients: [],
        });
      } else {
        setLocalMapScheduleMeta({
          hasSchedule: true,
          scheduleId: typeof localMapSchedule.id === "string" ? localMapSchedule.id : null,
          isActive: Boolean(localMapSchedule.isActive),
          frequency: typeof localMapSchedule.frequency === "string" ? localMapSchedule.frequency : null,
          lastRunAt: localMapSchedule.lastRunAt ? String(localMapSchedule.lastRunAt) : null,
          nextRunAt: localMapSchedule.nextRunAt ? String(localMapSchedule.nextRunAt) : null,
          recipients: parseRecipients(localMapSchedule.recipients),
        });
      }

      const ppcSchedule = schedules.find((s: any) =>
        typeof s?.emailSubject === "string" && String(s.emailSubject).startsWith(PPC_SCHEDULE_PREFIX)
      );
      if (!ppcSchedule) {
        setPpcScheduleMeta({
          hasSchedule: false,
          scheduleId: null,
          isActive: false,
          frequency: null,
          lastRunAt: null,
          nextRunAt: null,
          recipients: [],
        });
        return;
      }
      setPpcScheduleMeta({
        hasSchedule: true,
        scheduleId: typeof ppcSchedule.id === "string" ? ppcSchedule.id : null,
        isActive: Boolean(ppcSchedule.isActive),
        frequency: typeof ppcSchedule.frequency === "string" ? ppcSchedule.frequency : null,
        lastRunAt: ppcSchedule.lastRunAt ? String(ppcSchedule.lastRunAt) : null,
        nextRunAt: ppcSchedule.nextRunAt ? String(ppcSchedule.nextRunAt) : null,
        recipients: parseRecipients(ppcSchedule.recipients),
      });
    } catch {
      setLocalMapScheduleMeta({
        hasSchedule: false,
        scheduleId: null,
        isActive: false,
        frequency: null,
        lastRunAt: null,
        nextRunAt: null,
        recipients: [],
      });
      setPpcScheduleMeta({
        hasSchedule: false,
        scheduleId: null,
        isActive: false,
        frequency: null,
        lastRunAt: null,
        nextRunAt: null,
        recipients: [],
      });
    }
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    if (reportOnly || activeTab === "report") {
      void loadPpcScheduleMeta();
    }
  }, [clientId, reportOnly, activeTab, loadPpcScheduleMeta]);

  // Load PPC data when subsection or date range changes
  useEffect(() => {
    if (dashboardSection === "ppc" && googleAdsConnected && clientId) {
      loadPpcData();
      loadPpcScheduleMeta();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ppcSubSection, dashboardSection, googleAdsConnected, clientId, loadPpcScheduleMeta]);

  // When Google Ads is disconnected, leave PPC section so we don't show a hidden section
  useEffect(() => {
    if (googleAdsConnected !== true && dashboardSection === "ppc") {
      setDashboardSection("seo");
    }
  }, [googleAdsConnected, dashboardSection]);

  // Web Visitors (same as Active Users / Total Users)
  const websiteVisitorsDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (ga4Connected !== true) return "—";
    const value = dashboardSummary?.totalUsers;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "—";
  }, [dashboardSummary?.totalUsers, dashboardSummary?.activeUsers, fetchingSummary, ga4Connected]);

  // Organic Traffic (Organic Search - Engaged Sessions)
  const organicTrafficDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (ga4Connected !== true) return "—";
    const value = dashboardSummary?.organicSearchEngagedSessions;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "—";
  }, [dashboardSummary?.organicSearchEngagedSessions, fetchingSummary, ga4Connected]);

  // First Time Visitors (same as New Users)
  const firstTimeVisitorsDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (ga4Connected !== true) return "—";
    if (dashboardSummary?.newUsers !== null && dashboardSummary?.newUsers !== undefined) {
      const numeric = Number(dashboardSummary.newUsers);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "—";
  }, [dashboardSummary?.newUsers, fetchingSummary, ga4Connected]);

  // Engaged Visitors (same as Engaged Sessions from GA4)
  const engagedVisitorsDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (ga4Connected !== true) return "—";
    const value = dashboardSummary?.engagedVisitors;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        // Value is a count (engagedSessions), format as number
        return Math.round(numeric).toLocaleString();
      }
    }
    return "—";
  }, [dashboardSummary?.engagedVisitors, fetchingSummary, ga4Connected]);

  const getUnavailableText = useCallback(
    (metric: string | string[]) => {
      const info = getUnavailableMetricInfo(dashboardSummary?.accuracy, metric);
      if (!info) return null;
      return `Unavailable (${formatUnavailableReason(info.reason)} from ${formatUnavailableSource(info.source)})`;
    },
    [dashboardSummary?.accuracy]
  );
  const webVisitorsUnavailableText = getUnavailableText(["totalUsers", "activeUsers"]);
  const organicTrafficUnavailableText = getUnavailableText("organicSearchEngagedSessions");
  const firstTimeVisitorsUnavailableText = getUnavailableText(["firstTimeVisitors", "newUsers"]);
  const engagedVisitorsUnavailableText = getUnavailableText("engagedVisitors");
  const aiIntelligenceDataStatus = useMemo(() => {
    const meta = aiIntelligence?.meta;
    if (!meta) return null;
    const status = String(meta.apiResponseStatus || "").toLowerCase();
    if (status === "success" && meta.dataForSeoConnected && meta.hasAiMentions) {
      return { label: "Live data", className: "bg-emerald-100 text-emerald-800" };
    }
    if (status === "no_data_or_error" || !meta.dataForSeoConnected) {
      return { label: "No data", className: "bg-rose-100 text-rose-800" };
    }
    return { label: "Partial data", className: "bg-amber-100 text-amber-800" };
  }, [aiIntelligence?.meta]);

  const newUsersTrendData = useMemo(() => {
    if (!dashboardSummary?.newUsersTrend?.length) return [];
    const compareTrend = dashboardSummaryCompare?.newUsersTrend ?? [];
    return dashboardSummary.newUsersTrend.map((point, idx) => {
      const dateObj = new Date(point.date);
      const label = Number.isNaN(dateObj.getTime()) ? point.date : format(dateObj, "MMM d");
      const value = Number(point.value ?? 0);
      const prevValue = idx < compareTrend.length ? Number(compareTrend[idx]?.value ?? 0) : 0;
      return {
        name: label,
        newUsers: Number.isFinite(value) ? value : 0,
        previousPeriod: Number.isFinite(prevValue) ? prevValue : 0,
      };
    });
  }, [dashboardSummary?.newUsersTrend, dashboardSummaryCompare?.newUsersTrend]);

  const totalUsersTrendData = useMemo(() => {
    const trend = dashboardSummary?.totalUsersTrend ?? dashboardSummary?.activeUsersTrend;
    if (!trend?.length) return [];
    const compareTrend = dashboardSummaryCompare?.totalUsersTrend ?? dashboardSummaryCompare?.activeUsersTrend ?? [];
    return trend.map((point, idx) => {
      const dateObj = new Date(point.date);
      const label = Number.isNaN(dateObj.getTime()) ? point.date : format(dateObj, "MMM d");
      const value = Number(point.value ?? 0);
      const prevValue = idx < compareTrend.length ? Number(compareTrend[idx]?.value ?? 0) : 0;
      return {
        name: label,
        totalUsers: Number.isFinite(value) ? value : 0,
        previousPeriod: Number.isFinite(prevValue) ? prevValue : 0,
      };
    });
  }, [dashboardSummary?.totalUsersTrend, dashboardSummary?.activeUsersTrend, dashboardSummaryCompare?.totalUsersTrend, dashboardSummaryCompare?.activeUsersTrend]);

  if (!clientId) {
    return (
      <div className="p-8">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
          Invalid client selection.
        </div>
      </div>
    );
  }

  const handleBackToLogin = () => {
    dispatch(logout() as any);
    navigate("/login", { replace: true });
  };

  const handleBackToClients = useCallback(() => {
    // If user entered this page directly, history "back" may not go anywhere useful.
    // React Router stores an index on window.history.state.idx.
    const idx = Number((window.history as any)?.state?.idx ?? 0);
    if (Number.isFinite(idx) && idx > 0) {
      navigate(-1);
      return;
    }
    if (user?.role === "SPECIALIST") {
      navigate("/specialist/clients", { replace: true });
      return;
    }
    navigate("/agency/clients", { replace: true });
  }, [navigate, user?.role]);

  // NOTE: DashboardLayout wraps pages in an `overflow-auto` container.
  // For the Client Dashboard "Dashboard" tab we want the scroll to live *inside* the tab
  // (so the page chrome stays put). For other tabs we let the layout scroll normally.
  const dashboardOwnsScroll = !reportOnly && activeTab === "dashboard" && !localMapReportOpen;
  const dashboardRightPanelScrollRef = useRef<HTMLDivElement | null>(null);

  const handleInviteUserClick = useCallback(() => {
    if (includedClientReadOnly) return;
    setInviteClientUsersModalOpen(true);
    setInviteClientUsersRows((prev) => {
      // Initialize with one blank row (preselect current client if available)
      if (prev.length > 0) return prev;
      return [
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          email: "",
          clientIds: clientId ? [clientId] : [],
        },
      ];
    });
    setInviteClientUsersViaEmail(true);
  }, [clientId, includedClientReadOnly]);

  useEffect(() => {
    const run = async () => {
      if (!inviteClientUsersModalOpen) return;
      try {
        setInviteClientUsersAllClientsLoading(true);
        setInviteClientUsersAllClientsError(null);
        const res = await api.get("/clients");
        const rows = Array.isArray(res.data) ? res.data : [];
        setInviteClientUsersAllClients(
          rows
            .map((c: any) => ({ id: String(c.id), name: String(c.name || c.domain || c.id) }))
            .filter((c: any) => c.id)
        );
      } catch (e: any) {
        console.error("Failed to load clients for invite modal", e);
        setInviteClientUsersAllClients([]);
        setInviteClientUsersAllClientsError(e?.response?.data?.message || "Failed to load clients.");
      } finally {
        setInviteClientUsersAllClientsLoading(false);
      }
    };
    void run();
  }, [inviteClientUsersModalOpen]);

  const fetchClientUsers = useCallback(async () => {
    if (!clientId) return;
    if (user?.role === "USER") {
      setClientUsers([]);
      setClientUsersError(null);
      return;
    }
    try {
      setClientUsersLoading(true);
      setClientUsersError(null);
      const res = await api.get(`/clients/${clientId}/users`);
      const rows = Array.isArray(res.data) ? (res.data as ClientUserRow[]) : [];
      setClientUsers(rows);
    } catch (e: any) {
      if (e?.response?.status !== 403) {
        console.error("Failed to fetch client users", e);
      }
      setClientUsers([]);
      setClientUsersError(e?.response?.data?.message || "Failed to load users.");
    } finally {
      setClientUsersLoading(false);
    }
  }, [clientId, user?.role]);

  useEffect(() => {
    const isUsersTabActive = activeTab === "users";
    const isWorkLogTabActive = activeTab === "dashboard" && dashboardSection === "worklog";
    if (!isUsersTabActive && !isWorkLogTabActive && !workLogAssigneesModalOpen) return;
    void fetchClientUsers();
  }, [activeTab, dashboardSection, workLogAssigneesModalOpen, fetchClientUsers]);

  const submitInviteClientUsers = useCallback(async () => {
    const normalizedInvites = inviteClientUsersRows
      .map((r) => ({
        email: String(r.email || "").trim().toLowerCase(),
        clientIds: Array.from(new Set((r.clientIds || []).map((c) => String(c)).filter(Boolean))),
      }))
      .filter((r) => r.email);

    if (normalizedInvites.length === 0) {
      toast.error("Add at least 1 email.");
      return;
    }

    for (const r of normalizedInvites) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) {
        toast.error(`Invalid email: ${r.email}`);
        return;
      }
      if (r.clientIds.length === 0) {
        toast.error(`Select at least 1 client for: ${r.email}`);
        return;
      }
    }

    try {
      setInvitingClientUsers(true);
      await api.post(`/clients/users/invite`, {
        invites: normalizedInvites,
        sendEmail: inviteClientUsersViaEmail,
        clientRole: "CLIENT",
      });
      toast.success(`Invited ${normalizedInvites.length} user${normalizedInvites.length === 1 ? "" : "s"}.`);
      setInviteClientUsersModalOpen(false);
      setInviteClientUsersRows([]);
      // Refresh users for the current client (table view)
      await fetchClientUsers();
    } catch (e: any) {
      console.error("Failed to invite client users", e);
      toast.error(e?.response?.data?.message || "Failed to invite users.");
    } finally {
      setInvitingClientUsers(false);
    }
  }, [fetchClientUsers, inviteClientUsersRows, inviteClientUsersViaEmail]);

  const openEditClientUserProfile = useCallback((u: ClientUserRow) => {
    const rawName = String(u.name || "").trim();
    const fallback = u.email.split("@")[0] || "";
    const base = rawName || fallback;
    const parts = base.split(/\s+/g).filter(Boolean);
    const first = parts[0] || "";
    const last = parts.slice(1).join(" ");

    setEditClientUserProfileUser({ userId: u.userId, email: u.email, name: u.name, profileImageUrl: u.profileImageUrl || null });
    setEditClientUserFirstName(first);
    setEditClientUserLastName(last);
    setEditClientUserPassword("");
    setEditClientUserPasswordVisible(false);
    setEditClientUserEmailCredentials("NO");
    setEditClientUserPhotoUrl(u.profileImageUrl || null);
    setEditClientUserProfileOpen(true);
  }, []);

  const triggerClientUserPhotoPicker = useCallback(() => {
    if (uploadingClientUserPhoto || savingClientUserProfile) return;
    editClientUserPhotoInputRef.current?.click();
  }, [savingClientUserProfile, uploadingClientUserPhoto]);

  const handleClientUserPhotoSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Please select an image file.");
        event.target.value = "";
        return;
      }
      try {
        setUploadingClientUserPhoto(true);
        const formData = new FormData();
        formData.append("file", file);
        const res = await api.post("/upload", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const uploadedUrl = String(res.data?.value || "").trim();
        if (!uploadedUrl) throw new Error("Upload did not return a file URL.");
        setEditClientUserPhotoUrl(uploadedUrl);
        toast.success("Profile picture uploaded.");
      } catch (e: any) {
        console.error("Failed to upload client user profile image", e);
        toast.error(e?.response?.data?.message || "Failed to upload profile picture.");
      } finally {
        setUploadingClientUserPhoto(false);
        event.target.value = "";
      }
    },
    []
  );

  const generateRandomPassword = useCallback(() => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
    const len = 12;
    let out = "";
    for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
    setEditClientUserPassword(out);
    setEditClientUserPasswordVisible(true);
  }, []);

  const saveClientUserProfile = useCallback(async () => {
    if (!clientId) return;
    if (!editClientUserProfileUser?.userId) return;
    if (!editClientUserFirstName.trim()) {
      toast.error("First name is required.");
      return;
    }
    const wantsEmailCredentials = editClientUserEmailCredentials === "YES";
    if (wantsEmailCredentials && editClientUserPassword.trim().length < 6) {
      toast.error("Enter a password (min 6) to email credentials.");
      return;
    }

    try {
      setSavingClientUserProfile(true);
      await api.put(`/clients/${clientId}/users/${editClientUserProfileUser.userId}/profile`, {
        firstName: editClientUserFirstName.trim(),
        lastName: editClientUserLastName.trim(),
        profileImageUrl: editClientUserPhotoUrl || null,
        password: editClientUserPassword.trim() ? editClientUserPassword.trim() : undefined,
        emailCredentials: wantsEmailCredentials,
      });
      toast.success("User updated.");
      setEditClientUserProfileOpen(false);
      setEditClientUserProfileUser(null);
      await fetchClientUsers();
    } catch (e: any) {
      console.error("Failed to update client user profile", e);
      toast.error(e?.response?.data?.message || "Failed to update user.");
    } finally {
      setSavingClientUserProfile(false);
    }
  }, [
    clientId,
    editClientUserEmailCredentials,
    editClientUserFirstName,
    editClientUserLastName,
    editClientUserPassword,
    editClientUserPhotoUrl,
    editClientUserProfileUser?.userId,
    fetchClientUsers,
  ]);

  const openEditClientAccess = useCallback(
    async (u: ClientUserRow) => {
      try {
        setEditClientAccessOpen(true);
        setEditClientAccessUser({ userId: u.userId, email: u.email, name: u.name });
        setEditClientAccessSearch("");
        setEditClientAccessLoading(true);

        const [clientsRes, accessRes] = await Promise.all([
          api.get("/clients"),
          api.get(`/clients/users/${encodeURIComponent(u.userId)}/access`),
        ]);

        const all = Array.isArray(clientsRes.data) ? clientsRes.data : [];
        setEditClientAccessClients(all.map((c: any) => ({ id: String(c.id), name: String(c.name || c.domain || c.id), domain: String(c.domain || "") })));

        const selectedIds = new Set<string>();
        const accessClients = accessRes.data?.clients as Array<{ clientId: string }> | undefined;
        if (Array.isArray(accessClients)) {
          for (const r of accessClients) {
            if (r?.clientId) selectedIds.add(String(r.clientId));
          }
        }
        setEditClientAccessSelected(selectedIds);
      } catch (e: any) {
        console.error("Failed to load client access", e);
        toast.error(e?.response?.data?.message || "Failed to load client access.");
        setEditClientAccessOpen(false);
        setEditClientAccessUser(null);
      } finally {
        setEditClientAccessLoading(false);
      }
    },
    []
  );

  const saveEditClientAccess = useCallback(async () => {
    if (!editClientAccessUser?.userId) return;
    try {
      setEditClientAccessSaving(true);
      await api.put(`/clients/users/${encodeURIComponent(editClientAccessUser.userId)}/access`, {
        clientIds: Array.from(editClientAccessSelected),
      });
      toast.success("Client access updated.");
      setEditClientAccessOpen(false);
      setEditClientAccessUser(null);
      await fetchClientUsers();
    } catch (e: any) {
      console.error("Failed to update client access", e);
      toast.error(e?.response?.data?.message || "Failed to update client access.");
    } finally {
      setEditClientAccessSaving(false);
    }
  }, [editClientAccessSelected, editClientAccessUser?.userId, fetchClientUsers]);

  const resendInviteForClientUser = useCallback(
    async (u: ClientUserRow) => {
      if (!clientId) return;
      try {
        await api.post(`/clients/${clientId}/users/${u.userId}/invite`);
        toast.success("Invite sent.");
      } catch (e: any) {
        console.error("Failed to send invite", e);
        toast.error(e?.response?.data?.message || "Failed to send invite.");
      }
    },
    [clientId]
  );

  const loginAsClientUser = useCallback(
    async (u: ClientUserRow) => {
      if (!clientId) return;
      if (u.status !== "ACTIVE") {
        toast.error("Only active users can be logged in.");
        return;
      }
      try {
        const res = await api.post(`/clients/${clientId}/users/${u.userId}/impersonate`);
        const token = res.data?.token as string | undefined;
        const redirectClientId = res.data?.redirect?.clientId as string | undefined;
        if (!token) {
          toast.error("Impersonation failed.");
          return;
        }
        localStorage.setItem("token", token);
        await dispatch(checkAuth() as any);
        navigate(`/client/dashboard/${encodeURIComponent(redirectClientId || clientId)}`, { replace: true });
      } catch (e: any) {
        console.error("Failed to impersonate user", e);
        toast.error(e?.response?.data?.message || "Failed to login as user.");
      }
    },
    [clientId, dispatch, navigate]
  );

  const removeClientUser = useCallback(async () => {
    if (!clientId) return;
    const userId = removeClientUserConfirm.userId;
    if (!userId) return;
    try {
      await api.delete(`/clients/${clientId}/users/${userId}`);
      toast.success("User removed.");
      setRemoveClientUserConfirm({ open: false, userId: null, label: null });
      await fetchClientUsers();
    } catch (e: any) {
      console.error("Failed to remove user", e);
      toast.error(e?.response?.data?.message || "Failed to remove user.");
    }
  }, [clientId, fetchClientUsers, removeClientUserConfirm.userId]);

  // When switching Dashboard left-nav sections, ensure the user sees the section header/actions
  // (e.g. Backlinks Import/Add, Work Log +) by resetting the right panel scroll to the top.
  useEffect(() => {
    if (reportOnly || activeTab !== "dashboard") return;
    const el = dashboardRightPanelScrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [activeTab, dashboardSection, reportOnly]);

  return (
    <div className={dashboardOwnsScroll ? "h-full min-h-0 flex flex-col overflow-hidden" : "h-full min-h-0 flex flex-col"}>
      <div className="px-8 pt-6 space-y-6 shrink-0">
        {/* Back navigation */}
        <div>
          {!clientPortalMode &&
            (!reportOnly ? (
              <button
                onClick={handleBackToClients}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3.5 py-2 text-sm font-medium text-gray-600 shadow-sm ring-1 ring-gray-200/60 transition-all hover:bg-white hover:text-primary-600 hover:shadow-md hover:ring-primary-200"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Clients</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleBackToLogin}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3.5 py-2 text-sm font-medium text-gray-600 shadow-sm ring-1 ring-gray-200/60 transition-all hover:bg-white hover:text-primary-600 hover:shadow-md hover:ring-primary-200"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Login</span>
              </button>
            ))}
          {clientPortalMode && clientPortalClients.length > 0 && (
            <div className="mt-3 inline-flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary-600" />
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Clients</span>
              </div>
              <select
                value={clientId || ""}
                onChange={(e) => {
                  const nextId = e.target.value;
                  if (!nextId) return;
                  navigate(`/client/dashboard/${encodeURIComponent(nextId)}`, { replace: true });
                }}
                className="min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:border-primary-300 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                aria-label="Select client"
              >
                {clientPortalClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Client Info Banner */}
        <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-r from-white via-white to-primary-50/40 shadow-sm">
          <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-primary-500 via-violet-500 to-teal-500" />
          <div className="flex flex-wrap items-center justify-between gap-4 py-5 pl-7 pr-6">
            {/* Left: Name + meta pills */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary-600 to-violet-600 shadow-md">
                <span className="text-lg font-bold text-white">
                  {(client?.name || "C").charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <h1 className="text-xl font-bold text-gray-900 leading-tight">{client?.name || "Client Dashboard"}</h1>
                {client && (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={client.domain.startsWith("http") ? client.domain : `https://${client.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 ring-1 ring-sky-200/60 hover:bg-sky-100 transition-colors"
                    >
                      <Globe className="h-3 w-3" />
                      {client.domain.replace(/^https?:\/\//, "")}
                      <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                    </a>
                    {client.industry && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 ring-1 ring-violet-200/60">
                        <Building2 className="h-3 w-3" />
                        {client.industry}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right: View Info button */}
            {client && (
              <button
                type="button"
                onClick={() => setShowViewClientModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200 transition-all hover:bg-gray-50 hover:shadow-md"
              >
                <Info className="h-4 w-4 text-primary-500" />
                View Client Info
              </button>
            )}
          </div>
        </div>
      </div>

      {!reportOnly && !specialistSeoOverviewOnly && (
        <div className="border-b border-gray-200 px-8">
          <div className="flex items-end justify-between gap-6">
            <nav className="-mb-px flex space-x-8">
              {(clientPortalMode
                ? [
                    { id: "dashboard", label: "Dashboard", icon: Users },
                    ...(hasWebDesignProjects ? [{ id: "web-design", label: "Web Design", icon: FileText }] : []),
                  ]
                : [
                    { id: "dashboard", label: "Dashboard", icon: Users },
                    { id: "report", label: "Report", icon: FileText },
                    { id: "users", label: "Users", icon: UserPlus },
                    { id: "keywords", label: "Keywords", icon: Target },
                    { id: "integration", label: "Integrations", icon: Plug },
                    { id: "web-design", label: "Web Design", icon: FileText },
                  ]
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center space-x-2 ${
                    activeTab === tab.id
                      ? "border-primary-500 text-primary-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  <tab.icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              ))}
            </nav>

            <div className="pb-2 flex flex-col items-end gap-2">
              {activeTab === "dashboard" ? (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setCalendarModalOpen(true)}
                      className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent flex items-center gap-2 bg-white hover:bg-gray-50"
                      title="Date range & comparison"
                    >
                      <Calendar className="h-4 w-4 text-gray-600" />
                      <span className="text-gray-700">
                        {dateRange === "custom"
                          ? "Custom range"
                          : dateRange === "7"
                            ? "Last 7 days"
                            : dateRange === "30"
                              ? "Last 30 days"
                              : dateRange === "90"
                                ? "Last 90 days"
                                : dateRange === "365"
                                  ? "Last year"
                                  : "Data Range"}
                      </span>
                      <ChevronDown className="h-4 w-4 text-gray-500" />
                    </button>

                    {user?.role === "SUPER_ADMIN" && (
                      <button
                        type="button"
                        onClick={() => void handleRefreshDashboard()}
                        disabled={refreshingDashboard}
                        data-pdf-hide="true"
                        className="bg-green-600 text-white p-2 rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                        title="Refresh dashboard data from DataForSEO and GA4"
                      >
                        {refreshingDashboard ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleExportPdf}
                      disabled={exportingPdf || refreshingDashboard || refreshingTopPages || refreshingBacklinks || fetchingSummary}
                      className="bg-gray-100 text-gray-700 p-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                      title={refreshingDashboard || refreshingTopPages || refreshingBacklinks || fetchingSummary ? "Wait for dashboard to finish loading before exporting" : "Export"}
                    >
                      {exportingPdf ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleShare}
                      disabled={sharing}
                      className="bg-primary-600 text-white p-2 rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                      title="Share"
                    >
                      {sharing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Share2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {calendarModalOpen && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setCalendarModalOpen(false)}>
                      <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-4xl w-full overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end px-4 py-2 border-b border-gray-200">
                          <button type="button" onClick={() => setCalendarModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                        <div className="flex flex-1 min-h-0">
                          {/* Single shared calendar for Date Range and Compare To */}
                          <div className="flex flex-col items-start p-4 border-r border-gray-200 bg-gray-50/50">
                            {pickerPreset === "custom" && pickerCompareTo === "custom" && (
                              <div className="flex rounded-lg border border-gray-200 p-1 mb-3 bg-white">
                                <button
                                  type="button"
                                  onClick={() => setCalendarEditing("dateRange")}
                                  className={`px-3 py-1.5 text-sm font-medium rounded-md ${calendarEditing === "dateRange" ? "bg-primary-100 text-primary-700" : "text-gray-600 hover:bg-gray-100"}`}
                                >
                                  Date Range
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCalendarEditing("compare")}
                                  className={`px-3 py-1.5 text-sm font-medium rounded-md ${calendarEditing === "compare" ? "bg-primary-100 text-primary-700" : "text-gray-600 hover:bg-gray-100"}`}
                                >
                                  Compare To
                                </button>
                              </div>
                            )}
                            <DatePicker
                              inline
                              selectsRange
                              monthsShown={2}
                              startDate={calendarEditing === "dateRange" ? pickerStartDate : pickerCompareStartDate}
                              endDate={calendarEditing === "dateRange" ? pickerEndDate : pickerCompareEndDate}
                              minDate={subDays(new Date(), 365 * 2)}
                              maxDate={new Date()}
                              onChange={(dates: [Date | null, Date | null]) => {
                                const [start, end] = dates;
                                if (calendarEditing === "dateRange") {
                                  setPickerStartDate(start);                     
                                  setPickerEndDate(end ?? null);
                                  setPickerPreset("custom");
                                } else {
                                  setPickerCompareStartDate(start);
                                  setPickerCompareEndDate(end ?? null);
                                  setPickerCompareStart(start ? format(start, "yyyy-MM-dd") : "");
                                  setPickerCompareEnd(end ? format(end, "yyyy-MM-dd") : "");
                                }
                              }}
                              className="react-datepicker-range"
                              calendarClassName="border-0 bg-transparent"
                            />
                          </div>
                          {/* Sidebar: presets, dates, compare, actions */}
                          <div className="w-72 flex flex-col p-4">
                            <div className="font-semibold text-gray-900 mb-2">Date Range</div>
                            <select
                              value={pickerPreset}
                              onChange={(e) => {
                                const v = e.target.value;
                                setPickerPreset(v);
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                if (v === "custom") {
                                  setPickerEndDate(today);
                                  setPickerStartDate(subDays(today, 29));
                                  setCalendarEditing("dateRange");
                                  return;
                                }
                                const days = Math.max(1, parseInt(v, 10) || 30);
                                setPickerEndDate(today);
                                setPickerStartDate(subDays(today, days - 1));
                              }}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-3"
                            >
                              <option value="7">Last 7 days</option>
                              <option value="30">Last 30 days</option>
                              <option value="90">Last 90 days</option>
                              <option value="365">Last year</option>
                              <option value="custom">Custom range</option>
                            </select>
                            <div className="flex items-center gap-2 mb-2">
                              <input
                                type="text"
                                readOnly
                                value={pickerStartDate ? format(pickerStartDate, "MMM d, yyyy") : ""}
                                placeholder="Start date"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50"
                              />
                              <span className="text-gray-500 text-sm shrink-0">to</span>
                              <input
                                type="text"
                                readOnly
                                value={pickerEndDate ? format(pickerEndDate, "MMM d, yyyy") : ""}
                                placeholder="Select end date"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 placeholder:text-gray-400"
                              />
                            </div>
                            <label className="flex items-center gap-2 text-sm text-gray-700 mb-4">
                              <input
                                type="checkbox"
                                checked={pickerIncludeToday}
                                onChange={(e) => setPickerIncludeToday(e.target.checked)}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                              />
                              Include Today
                            </label>
                            <div className="font-semibold text-gray-900 mb-2">Compare To</div>
                            <select
                              value={pickerCompareTo}
                              onChange={(e) => {
                                const v = e.target.value as "none" | "previous_period" | "previous_year" | "custom";
                                setPickerCompareTo(v);
                                if (v === "custom") {
                                  const end = new Date();
                                  end.setHours(0, 0, 0, 0);
                                  const start = subDays(end, 29);
                                  setPickerCompareStartDate(start);
                                  setPickerCompareEndDate(end);
                                  setPickerCompareStart(format(start, "yyyy-MM-dd"));
                                  setPickerCompareEnd(format(end, "yyyy-MM-dd"));
                                  setCalendarEditing("compare");
                                }
                              }}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-3"
                            >
                              <option value="none">No comparison</option>
                              <option value="previous_period">Last Period</option>
                              <option value="previous_year">Previous year</option>
                              <option value="custom">Custom comparison range</option>
                            </select>
                            {pickerCompareTo === "custom" && (
                              <div className="flex items-center gap-2 mb-4">
                                <input
                                  type="text"
                                  readOnly
                                  value={pickerCompareStartDate ? format(pickerCompareStartDate, "MMM d, yyyy") : ""}
                                  placeholder="Start date"
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 placeholder:text-gray-400"
                                />
                                <span className="text-gray-500 text-sm shrink-0">to</span>
                                <input
                                  type="text"
                                  readOnly
                                  value={pickerCompareEndDate ? format(pickerCompareEndDate, "MMM d, yyyy") : ""}
                                  placeholder="Select end date"
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50 placeholder:text-gray-400"
                                />
                              </div>
                            )}
                            <div className="flex gap-2 mt-auto pt-4">
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!pickerStartDate) {
                                    toast.error("Please select a start date on the calendar.");
                                    return;
                                  }
                                  if (pickerPreset === "custom" && !pickerEndDate) {
                                    toast.error("Please select an end date on the calendar.");
                                    return;
                                  }
                                  if (pickerCompareTo === "custom" && (!pickerCompareStartDate || !pickerCompareEndDate)) {
                                    toast.error("Please select a comparison date range on the calendar.");
                                    return;
                                  }
                                  const endDateResolved = pickerPreset === "custom" ? (pickerEndDate ?? pickerStartDate) : pickerEndDate!;
                                  const startStr = format(pickerStartDate, "yyyy-MM-dd");
                                  const endStr = format(endDateResolved, "yyyy-MM-dd");
                                  const isPreset = ["7", "30", "90", "365"].includes(pickerPreset);
                                  const days = isPreset ? parseInt(pickerPreset, 10) : null;
                                  const today = new Date();
                                  today.setHours(0, 0, 0, 0);
                                  const matchPreset = days != null && endStr === format(today, "yyyy-MM-dd") && format(subDays(today, days - 1), "yyyy-MM-dd") === startStr;
                                  if (matchPreset) {
                                    setDateRange(pickerPreset);
                                    setCustomStartDate("");
                                    setCustomEndDate("");
                                  } else {
                                    setDateRange("custom");
                                    setCustomStartDate(startStr);
                                    setCustomEndDate(endStr);
                                  }
                                  setCompareTo(pickerCompareTo);
                                  const compareStartStr = pickerCompareTo === "custom" && pickerCompareStartDate
                                    ? format(pickerCompareStartDate, "yyyy-MM-dd")
                                    : pickerCompareStart;
                                  const compareEndStr = pickerCompareTo === "custom" && pickerCompareEndDate
                                    ? format(pickerCompareEndDate, "yyyy-MM-dd")
                                    : pickerCompareEnd;
                                  setCompareStartDate(compareStartStr);
                                  setCompareEndDate(compareEndStr);
                                  setCalendarModalOpen(false);
                                }}
                                className="flex-1 px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium"
                              >
                                Apply
                              </button>
                              <button
                                type="button"
                                onClick={() => setCalendarModalOpen(false)}
                                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="px-4 py-2 border-t border-gray-200 text-sm text-gray-500 flex items-center gap-2">
                          Dates are shown in America/New_York timezone
                          <button type="button" className="text-primary-600 hover:underline">Change</button>
                        </div>
                      </div>
                    </div>
                  )}

                </>
              ) : activeTab === "report" ? (
                <button
                  type="button"
                  onClick={handleCreateReportClick}
                  disabled={!canModifyClientSettings}
                  className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title={canModifyClientSettings ? "Create report" : "Included clients are view-only"}
                >
                  Create Report
                </button>
              ) : activeTab === "keywords" ? (
                null
              ) : activeTab === "integration" ? (
                null
              ) : activeTab === "web-design" ? (
                null
              ) : (
                <button
                  type="button"
                  onClick={handleInviteUserClick}
                  disabled={!canModifyClientSettings}
                  className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  title={canModifyClientSettings ? "Invite user" : "Included clients are view-only"}
                >
                  Invite User
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {(!reportOnly && activeTab === "dashboard" && !localMapReportOpen) ? (
        <div ref={dashboardOuterScrollRef} className={`flex-1 min-h-0 px-8 py-8 overflow-y-auto ${localMapReportOpen ? "" : "lg:overflow-hidden"}`}>
          {loading ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">Loading client data...</div>
          ) : (
            <>
              <div
                ref={dashboardContentRef}
                className="flex flex-col gap-6 lg:flex-row lg:items-start h-full min-h-0 lg:h-full"
              >
                {!specialistSeoOverviewOnly && (
                  <aside className="w-full lg:w-64 shrink-0" data-pdf-hide="true">
                    <div className="bg-white border border-gray-200 rounded-xl p-2 lg:sticky lg:top-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-1 gap-2">
                        {(
                          [
                            { id: "seo", label: "SEO Overview", icon: Search },
                            { id: "ai-intelligence", label: "AI Intelligence", icon: Sparkles },
                            ...(user?.role === "SPECIALIST" ? [] : [{ id: "local-map" as const, label: "Local Map Rankings", icon: MapPin }]),
                            ...(googleAdsConnected === true ? [{ id: "ppc" as const, label: "PPC", icon: TrendingUp }] : []),
                            { id: "backlinks", label: "Backlinks", icon: Search },
                            { id: "worklog", label: "Work Log", icon: Clock },
                          ] as const
                        ).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setDashboardSection(item.id)}
                            className={`w-full rounded-lg px-3 py-2 text-sm font-medium flex items-center gap-2 border transition-colors ${
                              dashboardSection === item.id
                                ? "bg-primary-50 text-primary-700 border-primary-200"
                                : "bg-white text-gray-700 border-transparent hover:bg-gray-50"
                            }`}
                          >
                            <item.icon className="h-4 w-4" />
                            <span className="truncate">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </aside>
                )}

                {/* Right panel scrolls on desktop; sidebar stays fixed */}
                <div
                  ref={dashboardRightPanelScrollRef}
                  className={`min-w-0 flex-1 min-h-0 lg:h-full lg:overflow-y-auto ${specialistSeoOverviewOnly ? "" : "lg:pr-2"}`}
                >
                {dashboardSection === "seo" && (
                  <div className="space-y-8">
                    <div className="flex items-center gap-3 rounded-xl border-l-4 border-primary-500 bg-gradient-to-r from-primary-50/80 via-blue-50/60 to-indigo-50/50 px-5 py-4 shadow-sm">
                      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-600/90 text-white">
                        <Search className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-primary-900 inline-flex items-center gap-1.5">
                          SEO Overview
                          <InfoTooltip content="Traffic, keywords, backlinks, and conversions in one place. Data from GA4 and DataForSEO." iconClassName="h-4 w-4 text-primary-600 cursor-help" />
                        </h2>
                        <p className="text-sm text-primary-800/80 mt-0.5">
                          Website traffic, organic performance, target keywords, and backlink trends.
                        </p>
                      </div>
                    </div>
                    {/* GA4 connection is managed in the Integration tab */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/60 p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-blue-900">
                        Web Visitors
                        <InfoTooltip content="Total number of people who visited your website this month." className="ml-1.5 inline-flex align-middle" />
                      </p>
                      <p className="text-2xl font-bold text-gray-900">{websiteVisitorsDisplay}</p>
                      {webVisitorsUnavailableText && (
                        <p className="mt-1 text-xs font-medium text-amber-700">{webVisitorsUnavailableText}</p>
                      )}
                      {dashboardSummaryCompare != null && (() => {
                        const curr = Number(dashboardSummary?.totalUsers ?? 0);
                        const prev = Number(dashboardSummaryCompare?.totalUsers ?? 0);
                        if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
                        const { text, isPositive } = formatPercentChange(curr, prev);
                        return (
                          <p className={`mt-1 flex items-center gap-1 text-sm font-semibold ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
                            {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                            {text}
                          </p>
                        );
                      })()}
                    </div>
                    <Users className="h-8 w-8 text-blue-600" />
                  </div>
                  {ga4Connected ? (
                    <div className="mt-4 space-y-0.5">
                      <div className="flex items-center space-x-2 text-emerald-700">
                        <TrendingUp className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm font-medium">Real-time data from GA4</span>
                      </div>
                      {formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated) && (
                        <p className="text-xs text-gray-500">{formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated)}</p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <span className="text-xs text-blue-700/80">Connect GA4 to view data</span>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/60 p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-emerald-900">
                        Organic Traffic
                        <InfoTooltip content="Visitors who found you through Google search (not paid ads). This shows how well your SEO is working." className="ml-1.5 inline-flex align-middle" />
                      </p>
                      <p className="text-2xl font-bold text-gray-900">{organicTrafficDisplay}</p>
                      {organicTrafficUnavailableText && (
                        <p className="mt-1 text-xs font-medium text-amber-700">{organicTrafficUnavailableText}</p>
                      )}
                      {dashboardSummaryCompare != null && (() => {
                        const curr = Number(dashboardSummary?.organicSearchEngagedSessions ?? 0);
                        const prev = Number(dashboardSummaryCompare?.organicSearchEngagedSessions ?? 0);
                        if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
                        const { text, isPositive } = formatPercentChange(curr, prev);
                        return (
                          <p className={`mt-1 flex items-center gap-1 text-sm font-semibold ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
                            {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                            {text}
                          </p>
                        );
                      })()}
                    </div>
                    <Search className="h-8 w-8 text-emerald-600" />
                  </div>
                  {ga4Connected ? (
                    <div className="mt-4 space-y-0.5">
                      <div className="flex items-center space-x-2 text-emerald-700">
                        <TrendingUp className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm font-medium">Real-time data from GA4</span>
                      </div>
                      {formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated) && (
                        <p className="text-xs text-gray-500">{formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated)}</p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <span className="text-xs text-emerald-800/80">Connect GA4 to view data</span>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border-l-4 border-violet-500 bg-violet-50/60 p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-violet-900">
                        First Time Visitors
                        <InfoTooltip content="Number of people visiting your website for the very first time this month." className="ml-1.5 inline-flex align-middle" />
                      </p>
                      <p className="text-2xl font-bold text-gray-900">{firstTimeVisitorsDisplay}</p>
                      {firstTimeVisitorsUnavailableText && (
                        <p className="mt-1 text-xs font-medium text-amber-700">{firstTimeVisitorsUnavailableText}</p>
                      )}
                      {dashboardSummaryCompare != null && (() => {
                        const curr = Number(dashboardSummary?.newUsers ?? 0);
                        const prev = Number(dashboardSummaryCompare?.newUsers ?? 0);
                        if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
                        const { text, isPositive } = formatPercentChange(curr, prev);
                        return (
                          <p className={`mt-1 flex items-center gap-1 text-sm font-semibold ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
                            {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                            {text}
                          </p>
                        );
                      })()}
                    </div>
                    <UserPlus className="h-8 w-8 text-violet-600" />
                  </div>
                  {ga4Connected ? (
                    <div className="mt-4 space-y-0.5">
                      <div className="flex items-center space-x-2 text-emerald-700">
                        <TrendingUp className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm font-medium">Real-time data from GA4</span>
                      </div>
                      {formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated) && (
                        <p className="text-xs text-gray-500">{formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated)}</p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <span className="text-xs text-violet-800/80">Connect GA4 to view data</span>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/60 p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-amber-900">
                        Engaged Visitors
                        <InfoTooltip content="Visitors who actively interacted with your site (spent time reading, clicked links, scrolled through pages)." className="ml-1.5 inline-flex align-middle" />
                      </p>
                      <p className="text-2xl font-bold text-gray-900">{engagedVisitorsDisplay}</p>
                      {engagedVisitorsUnavailableText && (
                        <p className="mt-1 text-xs font-medium text-amber-700">{engagedVisitorsUnavailableText}</p>
                      )}
                      {dashboardSummaryCompare != null && (() => {
                        const curr = Number(dashboardSummary?.engagedVisitors ?? 0);
                        const prev = Number(dashboardSummaryCompare?.engagedVisitors ?? 0);
                        if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
                        const { text, isPositive } = formatPercentChange(curr, prev);
                        return (
                          <p className={`mt-1 flex items-center gap-1 text-sm font-semibold ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
                            {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                            {text}
                          </p>
                        );
                      })()}
                    </div>
                    <Activity className="h-8 w-8 text-amber-600" />
                  </div>
                  {ga4Connected ? (
                    <div className="mt-4 space-y-0.5">
                      <div className="flex items-center space-x-2 text-emerald-700">
                        <TrendingUp className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm font-medium">Real-time data from GA4</span>
                      </div>
                      {formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated) && (
                        <p className="text-xs text-gray-500">{formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated)}</p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4">
                      <span className="text-xs text-amber-800/80">Connect GA4 to view data</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border-l-4 border-blue-500 bg-white p-6 shadow-sm ring-1 ring-gray-200/80">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-blue-900 inline-flex items-center gap-1.5">
                      New Users Trending
                      <InfoTooltip content="Daily chart showing how many first-time visitors you're getting. Helps spot growth patterns and traffic spikes." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                    </h3>
                    {fetchingSummary && <span className="text-xs text-gray-400">Updating...</span>}
                    {formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated) && (
                      <p className="text-xs text-gray-500 mt-0.5">{formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated)}</p>
                    )}
                  </div>
                  <div className="h-64">
                    {ga4Connected ? (
                      newUsersTrendData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={newUsersTrendData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis />
                            <Tooltip isAnimationActive={false} contentStyle={{ pointerEvents: "none" }} />
                            <Legend />
                            <Line type="monotone" dataKey="newUsers" stroke="#3B82F6" strokeWidth={2} name="Current" isAnimationActive={false} />
                            {dashboardSummaryCompare != null && (
                              <Line type="monotone" dataKey="previousPeriod" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 2" name={compareTo === "previous_year" ? "Previous year" : "Previous period"} />
                            )}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-gray-500">
                          No GA4 new-user data for this date range.
                        </div>
                      )
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-gray-500">
                        Connect GA4 to view this chart.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border-l-4 border-emerald-500 bg-white p-6 shadow-sm ring-1 ring-gray-200/80">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-emerald-900 inline-flex items-center gap-1.5">
                      Total Users Trending
                      <InfoTooltip content="Daily chart showing all visitors (new + returning). Shows your overall website traffic momentum." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                    </h3>
                    {fetchingSummary && <span className="text-xs text-gray-400">Updating...</span>}
                    {formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated) && (
                      <p className="text-xs text-gray-500 mt-0.5">{formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated)}</p>
                    )}
                  </div>
                  <div className="h-64">
                    {ga4Connected ? (
                      totalUsersTrendData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={totalUsersTrendData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="name" />
                            <YAxis />
                            <Tooltip isAnimationActive={false} contentStyle={{ pointerEvents: "none" }} />
                            <Legend />
                            <Line type="monotone" dataKey="totalUsers" name="Current" stroke="#10B981" strokeWidth={2} isAnimationActive={false} />
                            {dashboardSummaryCompare != null && (
                              <Line type="monotone" dataKey="previousPeriod" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 2" name={compareTo === "previous_year" ? "Previous year" : "Previous period"} />
                            )}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-gray-500">
                          No GA4 total-user data for this date range.
                        </div>
                      )
                    ) : (
                      <div className="h-full flex items-center justify-center text-sm text-gray-500">
                        Connect GA4 to view this chart.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <TargetKeywordsOverview
                clientId={clientId}
                clientName={client?.name}
                title="Target Keywords"
                subtitle="Keywords relevant to this client's website based on DataForSEO analysis."
                titleTooltip="Your money keywords - the most important search terms that drive qualified leads to your business. We track these daily to monitor and improve your rankings."
                lastUpdatedLabel={formatLastUpdatedHours(dashboardSummary?.dataForSeoLastUpdated)}
                enableRefresh={false}
                refreshKey={seoOverviewWidgetsRefreshKey}
              />

              <RankedKeywordsOverview
                clientId={clientId}
                clientName={client?.name}
                title="Total Keywords Ranked"
                subtitle="Monitor how many organic keywords this client ranks for and how that total changes month-to-month."
                titleTooltip="Shows every keyword you're ranking for in Google, broken down by position. Track how your visibility grows as more keywords move from page 2-3 onto page 1."
                lastUpdatedLabel={formatLastUpdatedHours(dashboardSummary?.dataForSeoLastUpdated)}
                enableRefresh={false}
                refreshKey={seoOverviewWidgetsRefreshKey}
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border-l-4 border-violet-500 bg-white p-4 shadow-sm ring-1 ring-gray-200/80">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-violet-900 inline-flex items-center gap-1.5">
                      Traffic Sources
                      <InfoTooltip content="Shows where your website visitors are coming from: Google search, direct visits, other websites, social media, etc." iconClassName="h-4 w-4 text-violet-600 cursor-help" />
                    </h3>
                    {formatLastUpdatedHours(dashboardSummary?.dataForSeoLastUpdated) && (
                      <p className="text-xs text-gray-500 mt-0.5">{formatLastUpdatedHours(dashboardSummary?.dataForSeoLastUpdated)}</p>
                    )}
                  </div>
                  {trafficSourcesError && (
                    <p className="mb-3 text-sm text-rose-600">
                      {trafficSourcesError}
                    </p>
                  )}
                  <div className="h-56">
                    {trafficSourcesLoading ? (
                      <div className="flex items-center justify-center h-full">
                        <p className="text-sm text-gray-500">Loading traffic sources...</p>
                      </div>
                    ) : trafficSourcesWithCompare.length === 0 ? (
                      <div className="flex items-center justify-center h-full">
                        <p className="text-sm text-gray-500">No traffic sources data available.</p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={trafficSourcesWithCompare}
                          layout="vertical"
                          margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" />
                          <YAxis 
                            dataKey="name" 
                            type="category" 
                            width={70}
                            tick={{ fontSize: 12 }}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '4px' }}
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const entry = payload[0].payload as TrafficSourceSlice & { previousValue?: number };
                              const current = entry.value ?? 0;
                              const previous = entry.previousValue;
                              const change = previous != null && previous !== 0 ? formatPercentChange(current, previous) : null;
                              return (
                                <div className="px-3 py-2 text-sm">
                                  <p className="font-medium text-gray-900">{entry.name}</p>
                                  <p className="text-gray-700">Current: {current.toLocaleString()}</p>
                                  {previous != null && <p className="text-gray-600">Previous: {previous.toLocaleString()}</p>}
                                  {change != null && (
                                    <p className={`font-medium ${change.isPositive ? "text-green-600" : "text-red-600"}`}>{change.text}</p>
                                  )}
                                </div>
                              );
                            }}
                          />
                          <Bar 
                            dataKey="value" 
                            radius={[0, 4, 4, 0]}
                            name="Current"
                          >
                            {trafficSourcesWithCompare.map((entry, index) => (
                              <Cell
                                key={`traffic-source-${entry.name}-${index}`}
                                fill={entry.color || TRAFFIC_SOURCE_COLORS.Other}
                              />
                            ))}
                          </Bar>
                          {trafficSourcesCompare.length > 0 && (
                            <Bar 
                              dataKey="previousValue" 
                              radius={[0, 4, 4, 0]}
                              name={compareTo === "previous_year" ? "Previous year" : "Previous period"}
                              fill="#94a3b8"
                              fillOpacity={0.8}
                            />
                          )}
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border-l-4 border-indigo-500 bg-white p-4 shadow-sm ring-1 ring-gray-200/80">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-indigo-900 inline-flex items-center gap-1.5">
                      AI Search Visibility
                      <InfoTooltip content="How often your business appears when people ask AI tools (ChatGPT, Google AI, Perplexity) about services in your area." iconClassName="h-4 w-4 text-indigo-600 cursor-help" />
                    </h3>
                    {formatLastUpdatedHours(dashboardSummary?.dataForSeoLastUpdated) && (
                      <p className="text-xs text-gray-500 mt-0.5">{formatLastUpdatedHours(dashboardSummary?.dataForSeoLastUpdated)}</p>
                    )}
                  </div>

                  {aiSearchError && <p className="mb-3 text-sm text-rose-600">{aiSearchError}</p>}

                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="grid grid-cols-4 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
                      <div>AI Search</div>
                      <div className="text-center">AI Visibility</div>
                      <div className="text-center">Mentions</div>
                      <div className="text-center">Cited Pages</div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {aiSearchLoading ? (
                        <div className="px-3 py-4 text-sm text-gray-500">Loading AI Search visibility...</div>
                      ) : (aiSearchRows?.length || 0) === 0 ? (
                        <div className="px-3 py-4 text-sm text-gray-500">No AI Search visibility data available.</div>
                      ) : (
                        ([
                          { name: "ChatGPT", dotClass: "bg-gray-900" },
                          { name: "AI Overview", dotClass: "bg-blue-600" },
                          { name: "AI Mode", dotClass: "bg-red-500" },
                          { name: "Gemini", dotClass: "bg-green-600" },
                        ] as const).map((meta) => {
                          const row =
                            aiSearchRows.find((r) => r.name === meta.name) ||
                            ({ name: meta.name, visibility: 0, mentions: 0, citedPages: 0 } as AiSearchVisibilityRow);
                          const visibilityDisplay = `${Number(row.visibility || 0)}%`;
                          return (
                            <div key={meta.name} className="grid grid-cols-4 px-3 py-2 text-sm">
                              <div className="flex items-center gap-2 text-gray-900">
                                <span className={`h-2.5 w-2.5 rounded-full ${meta.dotClass}`} />
                                <span className="font-medium">{meta.name}</span>
                              </div>
                              <div className="text-center text-gray-900">{visibilityDisplay}</div>
                              <div className="text-center text-gray-900">{Number(row.mentions || 0).toLocaleString()}</div>
                              <div className="text-center text-gray-900">{Number(row.citedPages || 0).toLocaleString()}</div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border-l-4 border-teal-500 bg-white p-6 shadow-sm ring-1 ring-gray-200/80">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-teal-900 inline-flex items-center gap-1.5">
                      Visitor Sources
                      <InfoTooltip content="Top websites and platforms sending people to your site." iconClassName="h-4 w-4 text-teal-600 cursor-help" />
                    </h3>
                    {ga4Connected && formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated) && (
                      <p className="text-xs text-gray-500 mt-0.5">{formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated)}</p>
                    )}
                  </div>
                  {visitorSourcesError && (
                    <p className="mb-4 text-sm text-rose-600">
                      {visitorSourcesError}
                    </p>
                  )}
                  <div className="space-y-4">
                    {visitorSourcesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <p className="text-sm text-gray-500">Loading visitor sources...</p>
                      </div>
                    ) : visitorSources.length === 0 ? (
                      <div className="text-sm text-gray-500 text-center py-4">
                        {ga4Connected 
                          ? "No visitor sources data available."
                          : "Connect GA4 to view visitor sources data."}
                      </div>
                    ) : (
                      visitorSources.map((source, index) => {
                        const prev = visitorSourcesCompare.find((c) => String(c.source).toLowerCase() === String(source.source).toLowerCase());
                        const change = prev != null && prev.users !== 0 ? formatPercentChange(source.users, prev.users) : null;
                        return (
                          <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <p className="font-medium text-gray-900">{source.source}</p>
                            <div className="text-right">
                              <p className="text-sm text-gray-900">{source.users.toLocaleString()} users</p>
                              {change != null && (
                                <p className={`text-xs font-medium flex items-center justify-end gap-0.5 ${change.isPositive ? "text-green-600" : "text-red-600"}`}>
                                  {change.isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                  {change.text}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="rounded-xl border-l-4 border-amber-500 bg-white p-6 shadow-sm ring-1 ring-gray-200/80">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-amber-900 inline-flex items-center gap-1.5">
                      Conversions
                      <InfoTooltip content="Important actions visitors take on your site: form submissions, phone calls, button clicks, etc." iconClassName="h-4 w-4 text-amber-600 cursor-help" />
                    </h3>
                    {ga4Connected && formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated) && (
                      <p className="text-xs text-gray-500 mt-0.5">{formatLastUpdatedHours(dashboardSummary?.ga4LastUpdated)}</p>
                    )}
                  </div>
                {topEventsError && (
                  <p className="mb-4 text-sm text-rose-600">
                    {topEventsError}
                  </p>
                )}
                <div className="space-y-4">
                  {topEventsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-sm text-gray-500">Loading key events...</p>
                    </div>
                  ) : topEvents.length === 0 ? (
                    <div className="text-sm text-gray-500 text-center py-4">
                      {ga4Connected 
                        ? "No key events data available. Make sure key events are configured in GA4."
                        : "Connect GA4 to view key events data."}
                    </div>
                  ) : (
                    topEvents.map((event, index) => {
                      const prev = topEventsCompare.find((c) => String(c.name).toLowerCase() === String(event.name).toLowerCase());
                      const change = prev != null && prev.count !== 0 ? formatPercentChange(event.count, prev.count) : null;
                      return (
                        <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <p className="font-medium text-gray-900">{event.name}</p>
                          <div className="text-right">
                            <p className="text-sm text-gray-900">{event.count.toLocaleString()}</p>
                            {change != null && (
                              <p className={`text-xs font-medium flex items-center justify-end gap-0.5 ${change.isPositive ? "text-green-600" : "text-red-600"}`}>
                                {change.isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                {change.text}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              </div>

              <div className="rounded-xl border-l-4 border-primary-500 bg-white shadow-sm ring-1 ring-gray-200/80 overflow-hidden">
                <div className="p-6 border-b-2 border-gray-100 bg-gradient-to-r from-primary-50/50 to-blue-50/50 flex items-center justify-between">
                   <div>
                   <h3 className="text-lg font-semibold text-primary-900 inline-flex items-center gap-1.5">
                     Top Pages
                     <InfoTooltip content="Your most popular website pages and how visitors interact with them. Click any page to see every keyword it ranks for in Google." iconClassName="h-4 w-4 text-primary-600 cursor-help" />
                   </h3>
                   {formatLastUpdatedHours(dashboardSummary?.dataForSeoLastUpdated) && (
                     <p className="text-xs text-gray-500 mt-0.5">{formatLastUpdatedHours(dashboardSummary?.dataForSeoLastUpdated)}</p>
                   )}
                   {topPagesError && (
                     <p className="mt-2 text-sm text-rose-600">
                       {topPagesError}
                     </p>
                     )}
                   </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gradient-to-r from-primary-50/80 to-slate-100">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">Page</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">Keywords</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">Est. Traffic (ETV)</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">Top 1</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">Top 2-3</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">Top 4-10</th>
                        <th className="px-6 py-3 text-right text-xs font-semibold text-primary-800 uppercase tracking-wider">Movement</th>
                        <th className="px-6 py-3 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">Paid Traffic</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {topPagesLoading ? (
                        <tr>
                          <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                            Loading top pages...
                          </td>
                        </tr>
                      ) : resolvedTopPages.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                            No top pages data available.
                          </td>
                        </tr>
                      ) : (
                        resolvedTopPages.map((page, index) => {
                          const isExpanded = expandedPageUrls.has(page.url);
                          const keywords = pageKeywords[page.url] || [];
                          const isLoading = loadingPageKeywords[page.url] || false;

                          const handleToggleExpand = async () => {
                            if (isExpanded) {
                              setExpandedPageUrls(prev => {
                                const newSet = new Set(prev);
                                newSet.delete(page.url);
                                return newSet;
                              });
                            } else {
                              setExpandedPageUrls(prev => new Set(prev).add(page.url));
                              
                              // Fetch keywords if not already loaded
                              if (!pageKeywords[page.url] && clientId) {
                                setLoadingPageKeywords(prev => ({ ...prev, [page.url]: true }));
                                try {
                                  const res = await api.get(`/seo/top-pages/${clientId}/keywords`, {
                                    params: { url: page.url }
                                  });
                                  setPageKeywords(prev => ({
                                    ...prev,
                                    [page.url]: res.data || []
                                  }));
                                } catch (error: any) {
                                  console.error("Failed to fetch page keywords:", error);
                                  setPageKeywords(prev => ({
                                    ...prev,
                                    [page.url]: []
                                  }));
                                } finally {
                                  setLoadingPageKeywords(prev => ({ ...prev, [page.url]: false }));
                                }
                              }
                            }
                          };

                          return (
                            <React.Fragment key={`${page.url}-${index}`}>
                              <tr className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap">
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={handleToggleExpand}
                                      className="text-gray-400 hover:text-gray-600"
                                      title="Show keywords ranking for this page"
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                    </button>
                                    <a
                                      href={page.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm font-medium text-blue-600 hover:text-blue-800 break-all"
                                    >
                                      {page.url}
                                    </a>
                                  </div>
                                </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {topPagesLoading ? "..." : formatNumber(page.keywords)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {topPagesLoading ? "..." : formatNumber(page.estimatedTraffic)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {topPagesLoading ? "..." : formatNumber(page.top1)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {topPagesLoading ? "..." : formatNumber(page.top3)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {topPagesLoading ? "..." : formatNumber(page.top10)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                              {topPagesLoading ? (
                                <span>...</span>
                              ) : (
                              <div className="flex flex-row items-end space-x-1">
                                {page.newKeywords > 0 && (
                                  <div className="flex items-center gap-1 text-green-600">
                                    <Plus className="h-3.5 w-3.5" />
                                    <span>{formatNumber(page.newKeywords)}</span>
                                  </div>
                                )}
                                {page.upKeywords > 0 && (
                                  <div className="flex items-center gap-1 text-blue-600">
                                    <TrendingUp className="h-3.5 w-3.5" />
                                    <span>{formatNumber(page.upKeywords)}</span>
                                  </div>
                                )}
                                {page.downKeywords > 0 && (
                                  <div className="flex items-center gap-1 text-orange-600">
                                    <TrendingDown className="h-3.5 w-3.5" />
                                    <span>{formatNumber(page.downKeywords)}</span>
                                  </div>
                                )}
                                {page.lostKeywords > 0 && (
                                  <div className="flex items-center gap-1 text-rose-600">
                                    <TrendingDown className="h-3.5 w-3.5" />
                                    <span>{formatNumber(page.lostKeywords)}</span>
                                  </div>
                                )}
                                {page.newKeywords === 0 && page.upKeywords === 0 && page.downKeywords === 0 && page.lostKeywords === 0 && (
                                  <span className="text-gray-400">—</span>
                                )}
                              </div>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {topPagesLoading ? "..." : formatNumber(page.paidTraffic)}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="px-6 py-4 bg-gray-50">
                                <div className="space-y-2">
                                  <h4 className="text-sm font-semibold text-gray-900 mb-3">
                                    Keywords Ranking for This Page
                                  </h4>
                                  {isLoading ? (
                                    <div className="flex items-center justify-center py-4">
                                      <Loader2 className="h-4 w-4 animate-spin text-primary-600 mr-2" />
                                      <span className="text-sm text-gray-500">Loading keywords...</span>
                                    </div>
                                  ) : keywords.length === 0 ? (
                                    <div className="text-sm text-gray-500 text-center py-4">
                                      No keywords found ranking for this page.
                                    </div>
                                  ) : (
                                    <div className="max-h-64 overflow-y-auto">
                                      <table className="w-full text-sm">
                                        <thead className="bg-gray-100 sticky top-0">
                                          <tr>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Keyword</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Position</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Change</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">Search Volume</th>
                                          </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                          {keywords.map((kw, idx) => {
                                            // Use is_new, is_lost, is_up, is_down flags from API response
                                            const isNew = kw.isNew || false;
                                            const isLost = kw.isLost || false;
                                            const isUp = kw.isUp || false;
                                            const isDown = kw.isDown || false;
                                            
                                            // Calculate position change if available
                                            const positionChange = kw.previousPosition !== null && kw.currentPosition !== null
                                              ? kw.currentPosition - kw.previousPosition
                                              : null;
                                            
                                            // Determine status badge
                                            let statusBadge = null;
                                            if (isNew) {
                                              statusBadge = <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">New</span>;
                                            } else if (isLost) {
                                              statusBadge = <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-800">Lost</span>;
                                            } else if (isUp) {
                                              statusBadge = <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">↑ Up</span>;
                                            } else if (isDown) {
                                              statusBadge = <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">↓ Down</span>;
                                            }
                                            
                                            return (
                                              <tr key={kw.keyword || idx} className="hover:bg-gray-50">
                                                <td className="px-3 py-2">
                                                  <div className="flex items-center gap-2">
                                                    <span className="text-gray-900">{kw.keyword}</span>
                                                    {statusBadge}
                                                  </div>
                                                </td>
                                                <td className="px-3 py-2 text-gray-900">
                                                  {kw.currentPosition !== null ? `#${kw.currentPosition}` : "—"}
                                                </td>
                                                <td className="px-3 py-2">
                                                  {positionChange !== null && positionChange !== 0 ? (
                                                    <span className={`text-xs font-medium ${
                                                      positionChange < 0 ? "text-green-600" : "text-red-600"
                                                    }`}>
                                                      {positionChange < 0 ? "↑" : "↓"} {Math.abs(positionChange)}
                                                    </span>
                                                  ) : (
                                                    <span className="text-xs text-gray-400">—</span>
                                                  )}
                                                </td>
                                                <td className="px-3 py-2 text-gray-700">
                                                  {kw.searchVolume && kw.searchVolume > 0 ? kw.searchVolume.toLocaleString() : "—"}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

                    <div className="rounded-xl border-l-4 border-emerald-500 bg-white shadow-sm ring-1 ring-gray-200/80 overflow-hidden">
                      <div className="p-6 border-b-2 border-gray-100 bg-gradient-to-r from-emerald-50/60 to-teal-50/50 flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-emerald-900 inline-flex items-center gap-1.5">
                            New Links
                            <InfoTooltip content="Total number of backlinks (other websites linking to yours) acquired each week. More quality backlinks help improve your Google rankings." iconClassName="h-4 w-4 text-emerald-600 cursor-help" />
                          </h3>
                          <p className="text-sm text-emerald-800/80">Weekly backlinks acquired (last 4 weeks)</p>
                          {formatLastUpdatedHours(dashboardSummary?.dataForSeoLastUpdated) && (
                            <p className="text-xs text-gray-500 mt-0.5">{formatLastUpdatedHours(dashboardSummary?.dataForSeoLastUpdated)}</p>
                          )}
                        </div>
                      </div>

                      <div className="p-6 space-y-4">
              {backlinksForChartLoading ? (
                <p className="text-sm text-gray-500">Loading backlink trends...</p>
              ) : backlinksForChartError ? (
                <p className="text-sm text-red-600">{backlinksForChartError}</p>
              ) : backlinksForChart.newRows.length === 0 && backlinksForChart.lostRows.length === 0 ? (
                <p className="text-sm text-gray-500">No backlink data available yet.</p>
              ) : (() => {
                const maxNewBacklinks =
                  weeklyBacklinkTimeseries.reduce((acc, cur) => Math.max(acc, cur.newBacklinks), 0) || 1;

                return weeklyBacklinkTimeseries.map((item) => {
                  const widthPercent =
                    item.newBacklinks === 0 ? 2 : Math.max((item.newBacklinks / maxNewBacklinks) * 100, 2);

                  return (
                    <div key={item.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>{item.label}</span>
                        <span
                          className={`font-medium ${
                            item.newBacklinks === 0 ? "text-gray-900" : "text-emerald-600"
                          }`}
                        >
                          {`${item.newBacklinks} new`}
                        </span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full"
                            style={{ width: `${widthPercent}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600 whitespace-nowrap">
                          {`-${item.lostBacklinks} lost`}
                        </span>
                      </div>
                    </div>
                  );
                });
                      })()}
                      </div>
                    </div>
                  </div>
                )}

                {dashboardSection === "ai-intelligence" && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-50 text-primary-600">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold text-gray-900 inline-flex items-center gap-1.5">
                          AI Intelligence
                          <InfoTooltip content="Track your visibility across ChatGPT, Google AI, Perplexity, and emerging AI platforms. Data from DataForSEO." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                        </h2>
                        <p className="text-sm text-gray-500 mt-0.5">
                          Track your visibility across ChatGPT, Google AI, Perplexity, and emerging AI platforms. Data source: DataForSEO.
                        </p>
                        {aiIntelligenceDataStatus && (
                          <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${aiIntelligenceDataStatus.className}`}>
                            {aiIntelligenceDataStatus.label}
                          </span>
                        )}
                      </div>
                    </div>

                    {aiIntelligenceError && (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                        {aiIntelligenceError}
                      </div>
                    )}

                    {aiIntelligenceLoading ? (
                      <div className="bg-white border border-gray-200 rounded-xl p-12 flex items-center justify-center">
                        <span className="inline-flex items-center gap-2 text-gray-500">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          Loading AI Intelligence…
                        </span>
                      </div>
                    ) : aiIntelligence ? (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm min-h-[140px] flex flex-col border-t-4 border-t-primary-500">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                AI Visibility Score
                                <InfoTooltip content="Overall score (0-100) measuring how often your business appears in AI search results. Higher is better." className="ml-1 inline-flex align-middle" />
                              </p>
                            </div>
                            <p className="mt-2 text-2xl font-bold text-gray-900">
                              {aiIntelligence.kpis?.aiVisibilityScore ?? 0} <span className="text-base font-normal text-gray-500">/100</span>
                            </p>
                            {(aiIntelligence.kpis?.aiVisibilityScoreTrend ?? null) == null ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 mt-1">Trend unavailable</span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 text-xs font-medium mt-1 ${(aiIntelligence.kpis?.aiVisibilityScoreTrend ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                                {(aiIntelligence.kpis?.aiVisibilityScoreTrend ?? 0) >= 0 && <TrendingUp className="h-3.5 w-3.5" />}
                                {(aiIntelligence.kpis?.aiVisibilityScoreTrend ?? 0) > 0 ? "+" : ""}{aiIntelligence.kpis?.aiVisibilityScoreTrend ?? 0} pts
                              </span>
                            )}
                            {formatLastUpdatedHours(aiIntelligence.meta?.lastUpdated) && (
                              <p className="text-xs text-gray-500 mt-auto pt-3">{formatLastUpdatedHours(aiIntelligence.meta?.lastUpdated)}</p>
                            )}
                          </div>
                          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm min-h-[140px] flex flex-col border-t-4 border-t-blue-500">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              Total AI Mentions
                              <InfoTooltip content="Number of times your business was mentioned or recommended by AI platforms this period." className="ml-1 inline-flex align-middle" />
                            </p>
                            <p className="mt-2 text-2xl font-bold text-gray-900">{aiIntelligence.kpis?.totalAiMentions ?? 0}</p>
                            {(aiIntelligence.kpis?.totalAiMentionsTrend ?? null) == null ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 mt-1">Trend unavailable</span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 text-xs font-medium mt-1 ${(aiIntelligence.kpis?.totalAiMentionsTrend ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                                {(aiIntelligence.kpis?.totalAiMentionsTrend ?? 0) >= 0 && <TrendingUp className="h-3.5 w-3.5" />}
                                {(aiIntelligence.kpis?.totalAiMentionsTrend ?? 0) > 0 ? "+" : ""}{aiIntelligence.kpis?.totalAiMentionsTrend ?? 0}
                              </span>
                            )}
                            {formatLastUpdatedHours(aiIntelligence.meta?.lastUpdated) && (
                              <p className="text-xs text-gray-500 mt-auto pt-3">{formatLastUpdatedHours(aiIntelligence.meta?.lastUpdated)}</p>
                            )}
                          </div>
                          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm min-h-[140px] flex flex-col border-t-4 border-t-emerald-500">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              AI Search Volume
                              <InfoTooltip content={aiIntelligence.meta?.kpiVolumeFromTrend ? "From keyword trend (last month) when domain-level volume is not yet available. Matches the graph below." : "Total number of AI searches where your business could have appeared based on your industry and keywords."} className="ml-1 inline-flex align-middle" />
                            </p>
                            <p className="mt-2 text-2xl font-bold text-gray-900">
                              {(aiIntelligence.kpis?.aiSearchVolume ?? 0).toLocaleString()}
                            </p>
                            {(aiIntelligence.kpis?.aiSearchVolumeTrend ?? null) == null ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 mt-1">Trend unavailable</span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 text-xs font-medium mt-1 ${(aiIntelligence.kpis?.aiSearchVolumeTrend ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                                {(aiIntelligence.kpis?.aiSearchVolumeTrend ?? 0) >= 0 && <TrendingUp className="h-3.5 w-3.5" />}
                                {(aiIntelligence.kpis?.aiSearchVolumeTrend ?? 0) > 0 ? "+" : ""}{(aiIntelligence.kpis?.aiSearchVolumeTrend ?? 0).toLocaleString()}
                              </span>
                            )}
                            {formatLastUpdatedHours(aiIntelligence.meta?.lastUpdated) && (
                              <p className="text-xs text-gray-500 mt-auto pt-3">{formatLastUpdatedHours(aiIntelligence.meta?.lastUpdated)}</p>
                            )}
                          </div>
                          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm min-h-[140px] flex flex-col border-t-4 border-t-amber-500">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              Monthly Trend
                              <InfoTooltip content="Month-over-month change in AI search volume trend when monthly history is available." className="ml-1 inline-flex align-middle" />
                            </p>
                            {(aiIntelligence.kpis?.monthlyTrendPercent ?? null) == null ? (
                              <>
                                <p className="mt-2 text-2xl font-bold text-gray-500">N/A</p>
                                <p className="text-xs text-gray-500 mt-1">Need at least 2 monthly data points</p>
                              </>
                            ) : (
                              <>
                                <p className={`mt-2 text-2xl font-bold ${(aiIntelligence.kpis?.monthlyTrendPercent ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                                  {(aiIntelligence.kpis?.monthlyTrendPercent ?? 0) > 0 ? "+" : ""}{aiIntelligence.kpis?.monthlyTrendPercent ?? 0}%
                                </p>
                                <p className="text-xs text-gray-500 mt-1">vs previous month</p>
                              </>
                            )}
                            {formatLastUpdatedHours(aiIntelligence.meta?.lastUpdated) && (
                              <p className="text-xs text-gray-500 mt-auto pt-3">{formatLastUpdatedHours(aiIntelligence.meta?.lastUpdated)}</p>
                            )}
                          </div>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="px-6 py-4 border-b border-gray-200">
                            <h3 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-1.5">
                              AI Platform Performance
                              <InfoTooltip content="Breakdown of how each AI platform (ChatGPT, Google AI, Perplexity) is mentioning your business." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                            </h3>
                            <p className="text-xs text-gray-500 mt-0.5">Data from {aiIntelligence.meta?.dataSource || "DataForSEO"}. {formatLastUpdatedHours(aiIntelligence.meta?.lastUpdated) ?? ""}</p>
                          </div>
                          {(aiIntelligence.kpis?.totalAiMentions ?? 0) === 0 && (aiIntelligence.platforms ?? []).every((p) => (p.mentions ?? 0) === 0) ? (
                            <div className="px-6 py-8 text-center text-sm text-gray-500 bg-gray-50/50">
                              <p className="font-medium text-gray-600">No platform data yet</p>
                              <p className="mt-1 text-xs">Mentions and volume will appear when DataForSEO has data for this domain. Check back after indexing or use Refresh if you have Super Admin access.</p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                                      <span className="inline-flex items-center gap-1">
                                        Platform
                                        <InfoTooltip content="The AI search tool being tracked." iconClassName="h-3.5 w-3.5 text-gray-400 cursor-help" />
                                      </span>
                                    </th>
                                    <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                                      <span className="inline-flex items-center gap-1">
                                        Mentions
                                        <InfoTooltip content="Number of times your business appeared in responses from this AI platform." iconClassName="h-3.5 w-3.5 text-gray-400 cursor-help" />
                                      </span>
                                    </th>
                                    <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                                      <span className="inline-flex items-center gap-1">
                                        AI Search Vol
                                        <InfoTooltip content="Total search volume on this platform for queries related to your industry." iconClassName="h-3.5 w-3.5 text-gray-400 cursor-help" />
                                      </span>
                                    </th>
                                    <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                                      <span className="inline-flex items-center gap-1">
                                        Impressions
                                        <InfoTooltip content="Estimated number of people who saw your business mentioned in AI responses." iconClassName="h-3.5 w-3.5 text-gray-400 cursor-help" />
                                      </span>
                                    </th>
                                    <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                                      <span className="inline-flex items-center gap-1">
                                        Trend
                                        <InfoTooltip content="Whether your visibility on this platform is increasing, decreasing, or staying flat." iconClassName="h-3.5 w-3.5 text-gray-400 cursor-help" />
                                      </span>
                                    </th>
                                    <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                                      <span className="inline-flex items-center gap-1">
                                        Share
                                        <InfoTooltip content="Your percentage of total AI mentions compared to all businesses in your industry." iconClassName="h-3.5 w-3.5 text-gray-400 cursor-help" />
                                      </span>
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-100">
                                  {(aiIntelligence.platforms ?? []).map((p) => (
                                    <tr key={p.platform} className="hover:bg-gray-50">
                                      <td className="px-6 py-4">
                                        <span className="inline-flex items-center gap-2">
                                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                                          <span className="font-medium text-gray-900">{p.platform}</span>
                                        </span>
                                      </td>
                                      <td className="px-6 py-4 text-gray-700 font-medium">{p.mentions ?? 0}</td>
                                      <td className="px-6 py-4 text-gray-700 font-medium">{(p.aiSearchVol ?? 0).toLocaleString()}</td>
                                      <td className="px-6 py-4 text-gray-700 font-medium">{(p.impressions ?? 0).toLocaleString()}</td>
                                      <td className="px-6 py-4">
                                        {p.trend == null && <span className="text-gray-400">N/A</span>}
                                        {p.trend != null && p.trend > 0 && <span className="inline-flex items-center gap-1 text-green-600 font-medium"><TrendingUp className="h-4 w-4" />+{p.trend}%</span>}
                                        {p.trend != null && p.trend === 0 && <span className="text-gray-400">—</span>}
                                        {p.trend != null && p.trend < 0 && <span className="inline-flex items-center gap-1 text-red-600 font-medium">{p.trend}%</span>}
                                      </td>
                                      <td className="px-6 py-4 text-gray-700 font-medium">{p.share ?? 0}%</td>
                                    </tr>
                                  ))}
                                  <tr className="bg-gray-50 font-semibold">
                                    <td className="px-6 py-4 text-gray-900">TOTAL</td>
                                    <td className="px-6 py-4 text-gray-900">{aiIntelligence.kpis?.totalAiMentions ?? 0}</td>
                                    <td className="px-6 py-4 text-gray-900">{(aiIntelligence.kpis?.aiSearchVolume ?? 0).toLocaleString()}</td>
                                    <td className="px-6 py-4 text-gray-900">
                                      {(aiIntelligence.platforms ?? []).reduce((s, p) => s + (p.impressions ?? 0), 0).toLocaleString()}
                                    </td>
                                    <td className={`px-6 py-4 ${(aiIntelligence.kpis?.monthlyTrendPercent ?? null) == null ? "text-gray-500" : (aiIntelligence.kpis?.monthlyTrendPercent ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                                      {(aiIntelligence.kpis?.monthlyTrendPercent ?? null) == null
                                        ? "N/A"
                                        : `${(aiIntelligence.kpis?.monthlyTrendPercent ?? 0) > 0 ? "+" : ""}${aiIntelligence.kpis?.monthlyTrendPercent ?? 0}%`}
                                    </td>
                                    <td className="px-6 py-4 text-gray-900">100%</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                          <div className="flex items-start justify-between gap-4 mb-4">
                            <div>
                              <div className="w-1 h-6 bg-green-500 rounded-full inline-block mr-2 align-middle" />
                              <h3 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-1.5 align-middle">
                                Queries Where You Appear in AI
                                <InfoTooltip content="Real AI search queries where your business is being mentioned or recommended. These are actual questions people are asking." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                              </h3>
                              <p className="text-sm text-gray-500 mt-1">Top performing queries triggering AI mentions{aiIntelligence.meta?.queriesFilteredByRelevance ? " (filtered to your industry & target keywords)" : ""}</p>
                            </div>
                            <button 
                              type="button" 
                              onClick={() => setShowAllQueriesModal(true)}
                              className="text-sm font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap"
                            >
                              View All ({aiIntelligence.totalQueriesCount ?? 0}) <ChevronRight className="h-4 w-4 inline" />
                            </button>
                          </div>
                          <div className="space-y-3">
                            {(aiIntelligence.queriesWhereYouAppear ?? []).slice(0, 5).map((q) => (
                              <div key={q.query} className="flex items-center justify-between gap-4 p-4 rounded-lg border border-gray-200 bg-gray-50/50 hover:bg-gray-50">
                                <div>
                                  <p className="font-semibold text-gray-900">{q.query}</p>
                                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                                    <span className="inline-flex items-center gap-1"><Search className="h-3.5 w-3.5" />{(q.aiVolPerMo ?? 0).toLocaleString()} AI vol/mo</span>
                                    <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />{q.platforms}</span>
                                  </div>
                                </div>
                                <span className="px-3 py-1 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold whitespace-nowrap">{q.mentions} mentions</span>
                              </div>
                            ))}
                            {(aiIntelligence.queriesWhereYouAppear ?? []).length === 0 && (aiIntelligence.kpis?.totalAiMentions ?? 0) > 0 && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
                                <p className="font-medium">Your visibility score is from aggregated metrics.</p>
                                <p className="mt-1 text-amber-800">Query-level breakdown (which exact queries trigger your mentions) may not be returned yet by the data provider for your domain. This section will populate when that data is available.
                                </p>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                          <div className="flex items-start justify-between gap-4 mb-4">
                            <div>
                              <div className="w-1 h-6 bg-amber-500 rounded-full inline-block mr-2 align-middle" />
                              <h3 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-1.5 align-middle">
                                AI Competitive Position
                                <InfoTooltip content="Your AI visibility score compared to competitors. Shows who's winning the AI search race in your industry." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                              </h3>
                              <p className="text-sm text-gray-500 mt-1">Your AI visibility vs competitors (from SERP). Same score formula as above. {aiIntelligence.meta?.industry && `Industry: ${aiIntelligence.meta.industry}.`}</p>
                            </div>
                            <button 
                              type="button" 
                              onClick={() => setShowCompetitiveAnalysisModal(true)}
                              className="text-sm font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap"
                            >
                              Full Analysis <ChevronRight className="h-4 w-4 inline" />
                            </button>
                          </div>
                          <div className="space-y-4">
                            {(aiIntelligence.competitors ?? []).map((c) => (
                              <div key={c.domain} className="flex items-center gap-4">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  {c.isLeader && <Trophy className="h-4 w-4 text-amber-500 flex-shrink-0" />}
                                  {c.isYou && <Users className="h-4 w-4 text-primary-600 flex-shrink-0" />}
                                  <span className="font-medium text-gray-900 truncate">{c.label}{c.isYou ? " (YOU)" : ""}</span>
                                </div>
                                <div className="flex-1 max-w-xs">
                                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${c.isYou ? "bg-primary-500" : "bg-gray-400"}`}
                                      style={{ width: `${Math.min(100, c.score)}%` }}
                                    />
                                  </div>
                                </div>
                                <span className="font-semibold text-gray-900 w-8 text-right">{c.score}</span>
                                {c.trend != null && (
                                  <span className={`text-sm font-medium w-12 text-right ${c.trend >= 0 ? "text-green-600" : "text-red-600"}`}>
                                    {c.trend >= 0 ? "+" : ""}{c.trend}
                                  </span>
                                )}
                              </div>
                            ))}
                            {(!aiIntelligence.meta?.hasCompetitorData && (aiIntelligence.competitors ?? []).filter((c) => !c.isYou).length === 0) && (
                              <div className="rounded-lg border border-blue-200 bg-blue-50/80 p-4 text-sm text-blue-900">
                                <p className="font-medium">To see up to 4 competitors here (5 total with you):</p>
                                <p className="mt-1 text-blue-800">Add and track <strong>target keywords</strong> for this client so we can pull competitor domains from SERP data. If we have AI mention data for your domain, we may also show competitors that co-appear in the same queries.
                                </p>
                              </div>
                            )}
                          </div>
                          {(aiIntelligence.gapBehindLeader ?? 0) > 0 && (
                            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
                              <Info className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="text-sm font-medium text-amber-900">
                                  Gap Alert: You&apos;re <strong>{aiIntelligence.gapBehindLeader} points behind the leader</strong>. View opportunities to close the gap.
                                </p>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                          <div className="flex items-start justify-between gap-4 mb-4">
                            <div>
                              <h3 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-1.5">
                                How AI Platforms Mention You
                                <InfoTooltip content="See the exact context and citations where AI tools are recommending your business to users." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                              </h3>
                              <p className="text-sm text-gray-500 mt-1">See exactly how AI tools are citing your business.</p>
                            </div>
                            <button 
                              type="button" 
                              onClick={() => setShowAllContextsModal(true)}
                              className="text-sm font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap"
                            >
                              View All Contexts ({aiIntelligence.totalContextsCount ?? 0}) <ChevronRight className="h-4 w-4 inline" />
                            </button>
                          </div>
                          <div className="space-y-4">
                            {(aiIntelligence.howAiMentionsYou ?? []).slice(0, 2).map((h, idx) => {
                              const cleanUrl = (() => {
                                try {
                                  const raw = h.sourceUrl.replace(/^https?:\/\//, "").split("?")[0] || "";
                                  return raw || h.sourceUrl.replace(/^https?:\/\//, "");
                                } catch {
                                  return h.sourceUrl.replace(/^https?:\/\//, "");
                                }
                              })();
                              return (
                                <div key={idx} className="p-4 rounded-lg border border-gray-200 bg-gray-50/30">
                                  <p className="font-semibold text-gray-900">&quot;{h.query}&quot;</p>
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    <span className="px-2 py-1 rounded-md bg-green-100 text-green-800 text-xs font-medium">{h.platform}</span>
                                    <span className="px-2 py-1 rounded-md bg-gray-200 text-gray-700 text-xs font-medium">{(h.aiVolPerMo ?? 0).toLocaleString()} AI vol/mo</span>
                                  </div>
                                  <div className="mt-2 pl-3 border-l-2 border-primary-200 text-sm text-gray-600 italic">{h.snippet}</div>
                                  <a href={h.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block text-sm text-primary-600 hover:underline font-mono break-all" title={h.sourceUrl}>
                                    {cleanUrl}
                                  </a>
                                  <div className="mt-2 flex justify-end">
                                    <span className="px-2 py-1 rounded-md bg-green-100 text-green-800 text-xs font-medium">#{h.citationIndex} Citation</span>
                                  </div>
                                </div>
                              );
                            })}
                            {(aiIntelligence.howAiMentionsYou ?? []).length === 0 && (aiIntelligence.kpis?.totalAiMentions ?? 0) > 0 && (
                              <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
                                <p className="font-medium">Citation contexts are built from query-level data.</p>
                                <p className="mt-1 text-amber-800">When the data provider returns per-query results that include your domain, exact snippets and citation URLs will appear here.
                                </p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* AI Search Volume Trend (12 months) */}
                        {(aiIntelligence.aiSearchVolumeTrend12Months ?? []).length > 0 && (
                          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4 inline-flex items-center gap-1.5">
                              AI Search Volume Trend (12 Months)
                              <InfoTooltip content="Historical view of total AI search volume in your industry over the past year. Shows seasonal patterns and growth." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                            </h3>
                            <div className="h-64">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart
                                  data={(aiIntelligence.aiSearchVolumeTrend12Months ?? []).map((d) => ({
                                    month: `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.month - 1]} ${String(d.year).slice(2)}`,
                                    volume: d.searchVolume,
                                  }))}
                                  margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                                >
                                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#6b7280" />
                                  <YAxis tick={{ fontSize: 11 }} stroke="#6b7280" tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} />
                                  <Tooltip
                                    isAnimationActive={false}
                                    contentStyle={{ pointerEvents: "none" }}
                                    formatter={(value: number | undefined) => [Number(value ?? 0).toLocaleString(), "AI Search Vol"]}
                                    labelFormatter={(l) => l}
                                  />
                                  <Line type="monotone" dataKey="volume" name="AI Search Volume" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}

                        {/* Top Content Types Cited in AI */}
                        {(aiIntelligence.topContentTypes ?? []).length > 0 && (
                          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                            <div className="px-6 py-4 border-b border-gray-200">
                              <h3 className="text-lg font-semibold text-gray-900">Top Content Types Cited in AI</h3>
                              <p className="text-sm text-gray-500 mt-0.5">What types of pages get cited in your niche</p>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">Content Type</th>
                                    <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">Example URLs</th>
                                    <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">Mention %</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-100">
                                  {(aiIntelligence.topContentTypes ?? []).map((row) => (
                                    <tr key={row.contentType} className="hover:bg-gray-50">
                                      <td className="px-6 py-4 font-medium text-gray-900">{row.contentType}</td>
                                      <td className="px-6 py-4 text-gray-600 text-xs max-w-md truncate" title={row.exampleUrls.join(", ")}>
                                        {row.exampleUrls.slice(0, 2).map((u) => u.replace(/^https?:\/\//, "")).join(", ")}
                                      </td>
                                      <td className="px-6 py-4 font-medium text-gray-900">{row.mentionPercent}%</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                          <div className="mb-4">
                            <div className="w-1 h-6 bg-red-500 rounded-full inline-block mr-2 align-middle" />
                            <h3 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-1.5 align-middle">
                              Queries Where Competitors Appear But You Don&apos;t
                              <InfoTooltip content="High-value opportunities - AI searches where your competitors are being mentioned but you're missing. Target these to increase visibility." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                            </h3>
                          </div>
                          <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-4 flex items-center gap-2">
                            <Target className="h-4 w-4 text-red-600 flex-shrink-0" />
                            <p className="text-sm font-medium text-red-900">High-value opportunities to increase your AI visibility.</p>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">Query</th>
                                  <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">Comp Mentions</th>
                                  <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">AI Vol</th>
                                  <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">Priority</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-100">
                                {(aiIntelligence.competitorQueries ?? []).length === 0 ? (
                                  <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                                      No competitor gap data yet. Opportunities appear when we have competitor domains and DataForSEO data for queries where competitors are mentioned but you are not. Add competitors in SEO settings or check back after more data is collected.
                                    </td>
                                  </tr>
                                ) : (aiIntelligence.competitorQueries ?? []).map((q) => (
                                  <tr key={q.query} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 font-medium text-gray-900">{q.query}</td>
                                    <td className="px-6 py-4 text-gray-700">{q.compMentions}</td>
                                    <td className="px-6 py-4 text-gray-700">{(q.aiVol ?? 0).toLocaleString()}</td>
                                    <td className="px-6 py-4">
                                      <span
                                        className={`px-2 py-1 rounded-full text-xs font-semibold text-white ${
                                          q.priority === "HIGH" ? "bg-red-500" : q.priority === "MED" ? "bg-amber-500" : "bg-gray-400"
                                        }`}
                                      >
                                        {q.priority}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="mt-4 rounded-lg bg-blue-50 border border-blue-200 p-4">
                            <div className="flex items-center gap-2 font-semibold text-gray-900 mb-2">
                              <Lightbulb className="h-4 w-4 text-amber-500" />
                              <span className="inline-flex items-center gap-1.5">
                                Action Items
                                <InfoTooltip content="Recommended steps to improve your AI visibility based on competitor gap analysis and search trends." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 mb-2">Based on competitor gap analysis. Validate that each suggestion fits your business and location before acting.</p>
                            <ul className="list-disc list-inside space-y-1 text-sm text-blue-900">
                              {(aiIntelligence.actionItems ?? []).map((item, i) => (
                                <li key={i}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </>
                    ) : !aiIntelligenceError ? (
                      <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500">
                        <Sparkles className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                        <p className="text-sm font-medium">No AI Intelligence data yet</p>
                        <p className="text-xs mt-1">Data will appear when connected to DataForSEO and AI visibility sources.</p>
                      </div>
                    ) : null}
                  </div>
                )}

                {dashboardSection === "ppc" && (
                  <div className="space-y-6">
                    {/* Google Ads Connection Banner */}
                    {googleAdsStatusLoading ? (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 animate-pulse">
                        <div className="h-6 bg-gray-200 rounded w-48 mb-3"></div>
                        <div className="h-4 bg-gray-200 rounded w-full"></div>
                      </div>
                    ) : googleAdsConnected === false ? (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-yellow-900 mb-2">
                              Connect Google Ads
                            </h3>
                            <p className="text-sm text-yellow-800 mb-4">
                              To view PPC campaign data, please connect your Google Ads account.
                            </p>
                            <button
                              onClick={handleConnectGoogleAds}
                              disabled={googleAdsConnecting}
                              className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {googleAdsConnecting ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  <span>Connecting...</span>
                                </>
                              ) : (
                                <>
                                  <TrendingUp className="h-4 w-4" />
                                  <span>Connect Google Ads</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : googleAdsConnected === true ? (
                      <>
                        {/* PPC Secondary Menu */}
                        <div className="bg-white border border-gray-200 rounded-xl p-4">
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <h2 className="text-xl font-semibold text-gray-900">PPC</h2>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={handleDisconnectGoogleAds}
                                disabled={googleAdsConnecting}
                                className="text-sm text-red-600 hover:text-red-700 disabled:opacity-60"
                              >
                                Disconnect
                              </button>
                            </div>
                          </div>
                          <nav className="flex space-x-2 border-b border-gray-200 mb-4">
                            {[
                              { id: "campaigns", label: "Campaigns" },
                              { id: "ad-groups", label: "Ad Groups" },
                              { id: "keywords", label: "Keywords" },
                              { id: "conversions", label: "Conversions" },
                            ].map((item) => (
                              <button
                                key={item.id}
                                onClick={() => setPpcSubSection(item.id as typeof ppcSubSection)}
                                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                  ppcSubSection === item.id
                                    ? "border-primary-500 text-primary-600"
                                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                                }`}
                              >
                                {item.label}
                              </button>
                            ))}
                          </nav>
                        </div>

                        {/* PPC Content */}
                        <div className="bg-white border border-gray-200 rounded-xl p-6">
                          {ppcLoading ? (
                            <div className="text-center py-8">
                              <Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" />
                              <p className="mt-2 text-sm text-gray-500">Loading PPC data...</p>
                            </div>
                          ) : ppcError ? (
                            <div className="text-center py-8">
                              <AlertTriangle className="h-8 w-8 mx-auto text-red-400" />
                              <p className="mt-2 text-sm text-red-600">{ppcError}</p>
                              <button
                                onClick={loadPpcData}
                                className="mt-4 text-sm text-primary-600 hover:text-primary-700"
                              >
                                Retry
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-6">
                              {ppcSubSection === "campaigns" && (
                                <div>
                                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Campaigns</h3>
                                  {ppcData?.data?.campaigns?.length > 0 ? (
                                    <div className="space-y-6">
                                      {/* Summary Cards */}
                                      {ppcData?.data?.summary && (
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                                            <p className="text-sm text-blue-700 font-medium">Clicks</p>
                                            <p className="text-2xl font-bold text-blue-900 mt-1">
                                              {ppcData.data.summary.clicks?.toLocaleString() || 0}
                                            </p>
                                          </div>
                                          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
                                            <p className="text-sm text-green-700 font-medium">Conversions</p>
                                            <p className="text-2xl font-bold text-green-900 mt-1">
                                              {ppcData.data.summary.conversions?.toLocaleString() || 0}
                                            </p>
                                          </div>
                                          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
                                            <p className="text-sm text-purple-700 font-medium">Cost</p>
                                            <p className="text-2xl font-bold text-purple-900 mt-1">
                                              ${ppcData.data.summary.cost?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                            </p>
                                          </div>
                                          <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200">
                                            <p className="text-sm text-orange-700 font-medium">Cost / Conversion</p>
                                            <p className="text-2xl font-bold text-orange-900 mt-1">
                                              ${ppcData.data.summary.costPerConversion?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                            </p>
                                          </div>
                                        </div>
                                      )}
                                      
                                      {/* Additional Metrics */}
                                      {ppcData?.data?.summary && (
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                                            <p className="text-sm text-gray-600">Impressions</p>
                                            <p className="text-xl font-semibold text-gray-900 mt-1">
                                              {ppcData.data.summary.impressions?.toLocaleString() || 0}
                                            </p>
                                          </div>
                                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                                            <p className="text-sm text-gray-600">Avg CPC</p>
                                            <p className="text-xl font-semibold text-gray-900 mt-1">
                                              ${ppcData.data.summary.avgCpc?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                            </p>
                                          </div>
                                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                                            <p className="text-sm text-gray-600">Conversion Rate</p>
                                            <p className="text-xl font-semibold text-gray-900 mt-1">
                                              {ppcData.data.summary.conversionRate?.toFixed(2) || "0.00"}%
                                            </p>
                                          </div>
                                          <div className="bg-white border border-gray-200 rounded-lg p-4">
                                            <p className="text-sm text-gray-600">CTR</p>
                                            <p className="text-xl font-semibold text-gray-900 mt-1">
                                              {ppcData.data.summary.impressions > 0 
                                                ? ((ppcData.data.summary.clicks / ppcData.data.summary.impressions) * 100).toFixed(2)
                                                : "0.00"}%
                                            </p>
                                          </div>
                                        </div>
                                      )}
                                      {/* Campaigns Table */}
                                      <div className="overflow-x-auto border border-gray-200 rounded-lg">
                                        <table className="min-w-full divide-y divide-gray-200">
                                          <thead className="bg-gray-50">
                                            <tr>
                                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("name", ppcCampaignSort, setPpcCampaignSort)} className="inline-flex items-center gap-1">Campaign <span>{sortIndicator(ppcCampaignSort, "name")}</span></button></th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("clicks", ppcCampaignSort, setPpcCampaignSort)} className="inline-flex items-center gap-1">Clicks <span>{sortIndicator(ppcCampaignSort, "clicks")}</span></button></th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("impressions", ppcCampaignSort, setPpcCampaignSort)} className="inline-flex items-center gap-1">Impressions <span>{sortIndicator(ppcCampaignSort, "impressions")}</span></button></th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("ctr", ppcCampaignSort, setPpcCampaignSort)} className="inline-flex items-center gap-1">CTR <span>{sortIndicator(ppcCampaignSort, "ctr")}</span></button></th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("conversions", ppcCampaignSort, setPpcCampaignSort)} className="inline-flex items-center gap-1">Conversions <span>{sortIndicator(ppcCampaignSort, "conversions")}</span></button></th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("convRate", ppcCampaignSort, setPpcCampaignSort)} className="inline-flex items-center gap-1">Conv. Rate <span>{sortIndicator(ppcCampaignSort, "convRate")}</span></button></th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("cost", ppcCampaignSort, setPpcCampaignSort)} className="inline-flex items-center gap-1">Cost <span>{sortIndicator(ppcCampaignSort, "cost")}</span></button></th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("avgCpc", ppcCampaignSort, setPpcCampaignSort)} className="inline-flex items-center gap-1">Avg CPC <span>{sortIndicator(ppcCampaignSort, "avgCpc")}</span></button></th>
                                              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("costPerConversion", ppcCampaignSort, setPpcCampaignSort)} className="inline-flex items-center gap-1">Cost/Conv. <span>{sortIndicator(ppcCampaignSort, "costPerConversion")}</span></button></th>
                                            </tr>
                                          </thead>
                                          <tbody className="bg-white divide-y divide-gray-200">
                                            {sortedPpcCampaigns.map((campaign: any, idx: number) => {
                                              const ctr = campaign.impressions > 0 
                                                ? ((campaign.clicks / campaign.impressions) * 100).toFixed(2)
                                                : "0.00";
                                              const convRate = campaign.clicks > 0
                                                ? ((campaign.conversions / campaign.clicks) * 100).toFixed(2)
                                                : "0.00";
                                              return (
                                                <tr key={idx} className="hover:bg-gray-50">
                                                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                    <div className="flex items-center gap-2">
                                                      <span>{campaign.name || "N/A"}</span>
                                                      {campaign.status && (
                                                        <span className={`px-2 py-0.5 rounded text-xs ${
                                                          campaign.status === 'ENABLED' 
                                                            ? 'bg-green-100 text-green-800'
                                                            : campaign.status === 'PAUSED'
                                                            ? 'bg-yellow-100 text-yellow-800'
                                                            : 'bg-gray-100 text-gray-800'
                                                        }`}>
                                                          {campaign.status}
                                                        </span>
                                                      )}
                                                    </div>
                                                  </td>
                                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                    {campaign.clicks?.toLocaleString() || 0}
                                                  </td>
                                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                    {campaign.impressions?.toLocaleString() || 0}
                                                  </td>
                                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                    {ctr}%
                                                  </td>
                                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                    {campaign.conversions?.toLocaleString() || 0}
                                                  </td>
                                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                    {convRate}%
                                                  </td>
                                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                    ${campaign.cost?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                                  </td>
                                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                    ${campaign.avgCpc?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                                  </td>
                                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                    ${campaign.conversions > 0 
                                                      ? (campaign.cost / campaign.conversions).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                                      : "0.00"}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-center py-6">
                                      <p className="text-sm text-gray-500">No campaign data available.</p>
                                      <p className="text-xs text-gray-400 mt-1">Ensure your Google Ads account has active campaigns with traffic.</p>
                                    </div>
                                  )}
                                </div>
                              )}
                              {ppcSubSection === "ad-groups" && (
                                <div>
                                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Ad Groups</h3>
                                  {ppcData?.data?.adGroups?.length > 0 ? (
                                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                                      <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                          <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("name", ppcAdGroupSort, setPpcAdGroupSort)} className="inline-flex items-center gap-1">Ad Group <span>{sortIndicator(ppcAdGroupSort, "name")}</span></button></th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("campaignName", ppcAdGroupSort, setPpcAdGroupSort)} className="inline-flex items-center gap-1">Campaign <span>{sortIndicator(ppcAdGroupSort, "campaignName")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("clicks", ppcAdGroupSort, setPpcAdGroupSort)} className="inline-flex items-center gap-1">Clicks <span>{sortIndicator(ppcAdGroupSort, "clicks")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("impressions", ppcAdGroupSort, setPpcAdGroupSort)} className="inline-flex items-center gap-1">Impressions <span>{sortIndicator(ppcAdGroupSort, "impressions")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("ctr", ppcAdGroupSort, setPpcAdGroupSort)} className="inline-flex items-center gap-1">CTR <span>{sortIndicator(ppcAdGroupSort, "ctr")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("conversions", ppcAdGroupSort, setPpcAdGroupSort)} className="inline-flex items-center gap-1">Conversions <span>{sortIndicator(ppcAdGroupSort, "conversions")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("cost", ppcAdGroupSort, setPpcAdGroupSort)} className="inline-flex items-center gap-1">Cost <span>{sortIndicator(ppcAdGroupSort, "cost")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("avgCpc", ppcAdGroupSort, setPpcAdGroupSort)} className="inline-flex items-center gap-1">Avg CPC <span>{sortIndicator(ppcAdGroupSort, "avgCpc")}</span></button></th>
                                          </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                          {sortedPpcAdGroups.map((adGroup: any, idx: number) => {
                                            const ctr = adGroup.impressions > 0 
                                              ? ((adGroup.clicks / adGroup.impressions) * 100).toFixed(2)
                                              : "0.00";
                                            return (
                                              <tr key={idx} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                  {adGroup.name || "N/A"}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                  {adGroup.campaignName || "N/A"}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                  {adGroup.clicks?.toLocaleString() || 0}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                  {adGroup.impressions?.toLocaleString() || 0}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                  {ctr}%
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                  {adGroup.conversions?.toLocaleString() || 0}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                  ${adGroup.cost?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                  ${adGroup.avgCpc?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-gray-500">No ad group data available.</p>
                                  )}
                                </div>
                              )}
                              {ppcSubSection === "keywords" && (
                                <div>
                                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Keywords</h3>
                                  {ppcData?.data?.keywords?.length > 0 ? (
                                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                                      <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                          <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("keyword", ppcKeywordSort, setPpcKeywordSort)} className="inline-flex items-center gap-1">Keyword <span>{sortIndicator(ppcKeywordSort, "keyword")}</span></button></th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("matchType", ppcKeywordSort, setPpcKeywordSort)} className="inline-flex items-center gap-1">Match Type <span>{sortIndicator(ppcKeywordSort, "matchType")}</span></button></th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("campaignName", ppcKeywordSort, setPpcKeywordSort)} className="inline-flex items-center gap-1">Campaign <span>{sortIndicator(ppcKeywordSort, "campaignName")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("clicks", ppcKeywordSort, setPpcKeywordSort)} className="inline-flex items-center gap-1">Clicks <span>{sortIndicator(ppcKeywordSort, "clicks")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("impressions", ppcKeywordSort, setPpcKeywordSort)} className="inline-flex items-center gap-1">Impressions <span>{sortIndicator(ppcKeywordSort, "impressions")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("ctr", ppcKeywordSort, setPpcKeywordSort)} className="inline-flex items-center gap-1">CTR <span>{sortIndicator(ppcKeywordSort, "ctr")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("impressionShare", ppcKeywordSort, setPpcKeywordSort)} className="inline-flex items-center gap-1">Imp. Share <span>{sortIndicator(ppcKeywordSort, "impressionShare")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("conversions", ppcKeywordSort, setPpcKeywordSort)} className="inline-flex items-center gap-1">Conversions <span>{sortIndicator(ppcKeywordSort, "conversions")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("cost", ppcKeywordSort, setPpcKeywordSort)} className="inline-flex items-center gap-1">Cost <span>{sortIndicator(ppcKeywordSort, "cost")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("avgCpc", ppcKeywordSort, setPpcKeywordSort)} className="inline-flex items-center gap-1">Avg CPC <span>{sortIndicator(ppcKeywordSort, "avgCpc")}</span></button></th>
                                          </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                          {sortedPpcKeywords.map((keyword: any, idx: number) => {
                                            const ctr = keyword.impressions > 0 
                                              ? ((keyword.clicks / keyword.impressions) * 100).toFixed(2)
                                              : "0.00";
                                            return (
                                              <tr key={idx} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                  {keyword.keyword || "N/A"}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                  <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
                                                    {keyword.matchType || "UNKNOWN"}
                                                  </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                  {keyword.campaignName || "N/A"}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                  {keyword.clicks?.toLocaleString() || 0}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                  {keyword.impressions?.toLocaleString() || 0}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                  {ctr}%
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                  {keyword.impressionShare ? (keyword.impressionShare * 100).toFixed(1) : "0.0"}%
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                  {keyword.conversions?.toLocaleString() || 0}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                  ${keyword.cost?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                  ${keyword.avgCpc?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-gray-500">No keyword data available.</p>
                                  )}
                                </div>
                              )}
                              {ppcSubSection === "conversions" && (
                                <div>
                                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Conversions</h3>
                                  {ppcData?.data?.summary && (
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                                      <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
                                        <p className="text-sm text-green-700 font-medium">Total Conversions</p>
                                        <p className="text-2xl font-bold text-green-900 mt-1">
                                          {ppcData.data.summary.totalConversions?.toLocaleString() || 0}
                                        </p>
                                      </div>
                                      <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                                        <p className="text-sm text-blue-700 font-medium">Conversion Value</p>
                                        <p className="text-2xl font-bold text-blue-900 mt-1">
                                          ${ppcData.data.summary.conversionValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                        </p>
                                      </div>
                                      <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
                                        <p className="text-sm text-purple-700 font-medium">Conversion Rate</p>
                                        <p className="text-2xl font-bold text-purple-900 mt-1">
                                          {ppcData.data.summary.conversionRate?.toFixed(2) || "0.00"}%
                                        </p>
                                      </div>
                                    </div>
                                  )}
                                  {ppcData?.data?.conversions?.length > 0 ? (
                                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                                      <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                          <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("date", ppcConversionSort, setPpcConversionSort)} className="inline-flex items-center gap-1">Date <span>{sortIndicator(ppcConversionSort, "date")}</span></button></th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("conversionAction", ppcConversionSort, setPpcConversionSort)} className="inline-flex items-center gap-1">Conversion Action <span>{sortIndicator(ppcConversionSort, "conversionAction")}</span></button></th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("campaignName", ppcConversionSort, setPpcConversionSort)} className="inline-flex items-center gap-1">Campaign <span>{sortIndicator(ppcConversionSort, "campaignName")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("conversions", ppcConversionSort, setPpcConversionSort)} className="inline-flex items-center gap-1">Conversions <span>{sortIndicator(ppcConversionSort, "conversions")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("conversionValue", ppcConversionSort, setPpcConversionSort)} className="inline-flex items-center gap-1">Value <span>{sortIndicator(ppcConversionSort, "conversionValue")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("clicks", ppcConversionSort, setPpcConversionSort)} className="inline-flex items-center gap-1">Clicks <span>{sortIndicator(ppcConversionSort, "clicks")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("cost", ppcConversionSort, setPpcConversionSort)} className="inline-flex items-center gap-1">Cost <span>{sortIndicator(ppcConversionSort, "cost")}</span></button></th>
                                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"><button type="button" onClick={() => togglePpcSort("costPerConversion", ppcConversionSort, setPpcConversionSort)} className="inline-flex items-center gap-1">Cost/Conv. <span>{sortIndicator(ppcConversionSort, "costPerConversion")}</span></button></th>
                                          </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                          {sortedPpcConversions.map((conversion: any, idx: number) => (
                                            <tr key={idx} className="hover:bg-gray-50">
                                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                {conversion.date ? new Date(conversion.date).toLocaleDateString() : "N/A"}
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                {conversion.conversionAction || "N/A"}
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                {conversion.campaignName || "N/A"}
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                {conversion.conversions?.toLocaleString() || 0}
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                ${conversion.conversionValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                {conversion.clicks?.toLocaleString() || 0}
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                                ${conversion.cost?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                                ${conversion.costPerConversion?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-gray-500">No conversion data available.</p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                )}

                {dashboardSection === "local-map" && (
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-primary-200 bg-gradient-to-r from-primary-600 via-indigo-600 to-blue-600 p-5 text-white shadow-lg">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h2 className="text-xl font-bold">Local Map Rankings</h2>
                          <p className="text-sm text-white/90">
                            Recurring long-term tracker: all active grid keywords run automatically on the 1st and 15th at midnight (all tiers), each run creates a new snapshot, and snapshot history is always retained.
                          </p>
                        </div>
                        <div className="flex gap-2 text-xs font-semibold">
                          <span className="rounded-full bg-white/15 px-3 py-1">
                            {localMapSummary.total} Available
                          </span>
                          <span className="rounded-full bg-white/15 px-3 py-1">
                            {localMapSummary.active} Active
                          </span>
                          <span className="rounded-full bg-white/15 px-3 py-1">
                            {localMapSummary.remaining} Remaining
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-primary-100 p-4">
                        <p className="text-xs uppercase tracking-wide text-indigo-700 font-semibold">Grid Keywords Available</p>
                        <p className="mt-1 text-2xl font-bold text-indigo-900">{localMapSummary.total}</p>
                        <p className="text-xs text-indigo-700">Account-wide pool</p>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-100 p-4">
                        <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Active Keywords</p>
                        <p className="mt-1 text-2xl font-bold text-emerald-900">{localMapSummary.active}</p>
                        <p className="text-xs text-emerald-700">Across all dashboards</p>
                      </div>
                      <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-100 p-4">
                        <p className="text-xs uppercase tracking-wide text-amber-700 font-semibold">Remaining Slots</p>
                        <p className="mt-1 text-2xl font-bold text-amber-900">{localMapSummary.remaining}</p>
                        <p className="text-xs text-amber-700">Ready to activate</p>
                      </div>
                    </div>

                    {localMapActivationOpen && (
                      <div className="bg-white border-2 border-primary-200 rounded-2xl p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-base font-bold text-gray-900">Activate Local Map Keyword</h3>
                          <button
                            type="button"
                            onClick={() => setLocalMapActivationOpen(false)}
                            className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Close
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Keyword</label>
                            <select
                              value={localMapSelectedKeywordId}
                              onChange={(e) => setLocalMapSelectedKeywordId(e.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                            >
                              <option value="">Select a money keyword</option>
                              {localMapMoneyKeywords.map((kw) => (
                                <option key={kw.id} value={kw.id}>
                                  {kw.keyword}
                                </option>
                              ))}
                            </select>
                            {localMapMoneyKeywordsLoading ? (
                              <p className="mt-1 text-xs text-gray-500">Loading money keywords...</p>
                            ) : localMapMoneyKeywords.length === 0 ? (
                              <p className="mt-1 text-xs text-amber-700">No money keywords found on this dashboard.</p>
                            ) : null}
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Label (optional)</label>
                            <input
                              value={localMapLabel}
                              onChange={(e) => setLocalMapLabel(e.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                              placeholder="Main Office"
                            />
                          </div>
                        </div>
                        <div className="mt-4">
                          <GoogleBusinessSearch
                            value={localMapBusinessSelection}
                            onSelect={setLocalMapBusinessSelection}
                            inputId="local-map-business-inline"
                            placeholder="Search Google Business Profile listing"
                          />
                        </div>
                        <div className="mt-4 flex justify-end">
                          <button
                            type="button"
                            onClick={() => void handleActivateLocalMapKeyword()}
                            disabled={localMapSubmitting}
                            className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-semibold hover:from-primary-700 hover:to-indigo-700 disabled:opacity-60"
                          >
                            {localMapSubmitting ? "Activating..." : "Activate"}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                      <div className="px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-semibold text-gray-800">
                          {localMapSummary.total} Grid Keywords Available - {localMapSummary.active} Active - {localMapSummary.remaining} Remaining (Account-Wide)
                        </p>
                        {user?.role !== "USER" && user?.role !== "SPECIALIST" && (
                          <button
                            type="button"
                            onClick={() => {
                              void openLocalMapActivationModal();
                            }}
                            disabled={includedClientReadOnly}
                            title={includedClientReadOnly ? "Included clients are view-only" : "Add keyword"}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-semibold hover:from-primary-700 hover:to-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <Plus className="h-4 w-4" />
                            Add Keyword
                          </button>
                        )}
                      </div>
                      {localMapLoading ? (
                        <div className="p-6 text-sm text-gray-500">Loading local map rankings...</div>
                      ) : localMapKeywords.length === 0 ? (
                        <div className="p-8 text-center">
                          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Local Map Rankings yet</h3>
                          <p className="text-sm text-gray-600 mb-4">
                            Activate your first keyword to start automatic recurring runs on the 1st and 15th at midnight.
                          </p>
                          {user?.role !== "USER" && user?.role !== "SPECIALIST" && (
                            <button
                              type="button"
                              onClick={() => {
                                void openLocalMapActivationModal();
                              }}
                              disabled={includedClientReadOnly}
                              title={includedClientReadOnly ? "Included clients are view-only" : "Activate your first keyword"}
                              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-semibold hover:from-primary-700 hover:to-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              <Plus className="h-4 w-4" />
                              Activate Your First Keyword
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[720px]">
                            <thead className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Keyword</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">GBP Business</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Last Run</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Current ATA</th>
                                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {localMapKeywords.map((row, idx) => (
                                <tr key={row.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">{row.keywordText}</td>
                                  <td className="px-4 py-3 text-sm text-gray-700">
                                    <div>{row.businessName}</div>
                                    {row.businessAddress && <div className="text-xs text-gray-500">{row.businessAddress}</div>}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-700">
                                    {safeFormatLocalMapDate(row.lastRunDate, "MMM d, yyyy", "Not run yet")}
                                  </td>
                                  <td className="px-4 py-3 text-sm">
                                    <div className="inline-flex items-center gap-2">
                                      <span className="font-semibold text-gray-900">
                                        {row.latestAta == null ? "-" : row.latestAta.toFixed(2)}
                                      </span>
                                      {row.trend == null ? (
                                        <span className="text-gray-500">-</span>
                                      ) : row.trend >= 0 ? (
                                        <span className="inline-flex items-center gap-1 text-emerald-600">
                                          <TrendingUp className="h-4 w-4" />
                                          {row.trend.toFixed(2)}
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 text-rose-600">
                                          <TrendingDown className="h-4 w-4" />
                                          {Math.abs(row.trend).toFixed(2)}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                                      onClick={() => void openLocalMapReport(row.id)}
                                      disabled={localMapReportLoading || localMapExportingPdf}
                                      title={localMapReportLoading ? "Loading report" : "View report"}
                                      aria-label={localMapReportLoading ? "Loading report" : "View report"}
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-primary-300 text-primary-700 hover:bg-primary-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                      onClick={() => void downloadLocalMapKeywordReport(row.id)}
                                      disabled={localMapReportLoading || localMapExportingPdf}
                                      title="Download report"
                                      aria-label="Download report"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                    </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {dashboardSection === "backlinks" && (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-50 text-primary-600">
                          <LinkIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold text-gray-900 inline-flex items-center gap-1.5">
                            Backlinks Overview
                            <InfoTooltip content="Monitor all backlinks, new vs lost trends, and link quality. Use the table below to see each link and its quality. Data from DataForSEO." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                          </h2>
                          <p className="text-sm text-gray-500 mt-0.5">
                            Monitor all backlinks, new vs lost trends, and link quality. Data from DataForSEO.
                          </p>
                        </div>
                      </div>
                      {!reportOnly && !clientPortalMode && (
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => setImportBacklinksModalOpen(true)}
                            disabled={!canModifyClientSettings}
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <Upload className="h-4 w-4" />
                            <span>Import Backlink</span>
                          </button>
                          <button
                            type="button"
                            onClick={openAddBacklink}
                            disabled={!canModifyClientSettings}
                            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <Plus className="h-4 w-4" />
                            <span>Add Backlink</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-white p-6 rounded-xl border border-gray-200">
                        <p className="text-sm font-medium text-gray-600">
                          Total Backlinks
                          <InfoTooltip content="Total number of external websites currently linking to your site." className="ml-1.5 inline-flex align-middle" />
                        </p>
                        <p className="text-2xl font-bold text-gray-900 mt-2">{backlinksKpis.totalBacklinks}</p>
                        <div className="mt-3 flex items-center space-x-2 text-sm text-green-600">
                          <TrendingUp className="h-4 w-4" />
                          <span>+{backlinksKpis.newLast4Weeks} new (last 4 weeks)</span>
                        </div>
                      </div>
                      <div className="bg-white p-6 rounded-xl border border-gray-200">
                        <p className="text-sm font-medium text-gray-600">
                          New Backlinks
                          <InfoTooltip content="Backlinks acquired in the last 4 weeks. Fresh links signal to Google that your site is actively gaining authority." className="ml-1.5 inline-flex align-middle" />
                        </p>
                        <p className="text-2xl font-bold text-gray-900 mt-2">{backlinksKpis.newLast4Weeks}</p>
                        <div className="mt-3 flex items-center space-x-2 text-sm text-green-600">
                          <TrendingUp className="h-4 w-4" />
                          <span>Last 4 weeks</span>
                        </div>
                      </div>
                      <div className="bg-white p-6 rounded-xl border border-gray-200">
                        <p className="text-sm font-medium text-gray-600">
                          DoFollow Backlinks
                          <InfoTooltip content="Links that pass SEO value to your site. These directly improve your Google rankings (vs. NoFollow links which don't pass as much value)." className="ml-1.5 inline-flex align-middle" />
                        </p>
                        <p className="text-2xl font-bold text-gray-900 mt-2">{backlinksKpis.dofollowCount}</p>
                        <div className="mt-3 flex items-center space-x-2 text-sm text-gray-600">
                          <TrendingUp className="h-4 w-4" />
                          <span>Follow links</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200">
                      <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 inline-flex items-center gap-1.5">
                            Backlinks Table
                            <InfoTooltip content="Complete list of all websites linking to you, with quality metrics to help assess their value." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                          </h3>
                          <p className="text-sm text-gray-500 mt-1">Monitor follow vs nofollow backlinks and their quality.</p>
                        </div>
                        <div className="flex items-center flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setBacklinksFilter("all")}
                            className={`px-3 py-1 text-sm rounded-lg border hover:bg-gray-50 ${
                              backlinksFilter === "all"
                                ? "border-primary-200 text-primary-700 bg-primary-50"
                                : "border-gray-200 text-gray-700"
                            }`}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => setBacklinksFilter("new")}
                            className={`px-3 py-1 text-sm rounded-lg border hover:bg-gray-50 ${
                              backlinksFilter === "new"
                                ? "border-primary-200 text-primary-700 bg-primary-50"
                                : "border-gray-200 text-gray-700"
                            }`}
                          >
                            New (Last 30 days)
                          </button>
                          <button
                            type="button"
                            onClick={() => setBacklinksFilter("natural")}
                            className={`px-3 py-1 text-sm rounded-lg border hover:bg-gray-50 ${
                              backlinksFilter === "natural"
                                ? "border-primary-200 text-primary-700 bg-primary-50"
                                : "border-gray-200 text-gray-700"
                            }`}
                          >
                            Natural
                          </button>
                          <button
                            type="button"
                            onClick={() => setBacklinksFilter("manual")}
                            className={`px-3 py-1 text-sm rounded-lg border hover:bg-gray-50 ${
                              backlinksFilter === "manual"
                                ? "border-primary-200 text-primary-700 bg-primary-50"
                                : "border-gray-200 text-gray-700"
                            }`}
                          >
                            Manual
                          </button>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                              {[
                                { key: "sourceUrl" as const, label: "Source", tooltip: "The website that's linking to you.", border: "border-primary-400 first:border-l-0", text: "text-primary-800" },
                                { key: "anchorText" as const, label: "Anchor Text", tooltip: "The clickable text used in the link. Relevant anchor text helps Google understand what your page is about.", border: "border-emerald-300", text: "text-emerald-800" },
                                { key: "domainRating" as const, label: "Domain Rating", tooltip: "Authority score of the linking website (0-100). Higher scores mean more valuable links. Links from DR 50+ sites carry significant weight.", border: "border-amber-300", text: "text-amber-800" },
                                { key: "firstSeen" as const, label: "Publish Date", tooltip: "When the backlink was first discovered or published.", border: "border-violet-300", text: "text-violet-800" },
                              ].map(({ key, label, tooltip, border, text }) => (
                                <th
                                  key={key}
                                  className={`px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer select-none border-l-4 ${border} ${text} hover:from-primary-100 hover:via-blue-100`}
                                  onClick={() => {
                                    setBacklinksSortBy(key);
                                    setBacklinksOrder((prev) => (backlinksSortBy === key && prev === "desc" ? "asc" : "desc"));
                                  }}
                                >
                                  <span className="inline-flex items-center gap-1">
                                    {label}
                                    <span onClick={(e) => e.stopPropagation()}>
                                      <InfoTooltip content={tooltip} iconClassName="h-3.5 w-3.5 text-gray-400 cursor-help" />
                                    </span>
                                    {backlinksSortBy === key && (
                                      <span className="text-primary-600" aria-hidden>{backlinksOrder === "desc" ? "↓" : "↑"}</span>
                                    )}
                                  </span>
                                </th>
                              ))}
                              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">
                                <span className="inline-flex items-center gap-1">
                                  Type
                                  <InfoTooltip content="Whether the link was acquired naturally, manually built, or through other methods." iconClassName="h-3.5 w-3.5 text-gray-400 cursor-help" />
                                </span>
                              </th>
                              <th className="px-6 py-3.5 border-l-4 border-transparent"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {backlinksLoading ? (
                              <tr>
                                <td className="px-6 py-8 text-sm text-gray-500 bg-gray-50/50" colSpan={6}>
                                  Loading backlinks...
                                </td>
                              </tr>
                            ) : backlinksError ? (
                              <tr>
                                <td className="px-6 py-8 text-sm text-rose-600 bg-rose-50/50" colSpan={6}>
                                  {backlinksError}
                                </td>
                              </tr>
                            ) : backlinks.length === 0 ? (
                              <tr>
                                <td className="px-6 py-8 text-sm text-gray-500 bg-amber-50/50" colSpan={6}>
                                  {backlinksFilter === "all"
                                    ? "No backlinks found yet. If you’re a Super Admin, hit the top “Refresh” button to pull from DataForSEO."
                                    : backlinksFilter === "new"
                                    ? "No new backlinks found in the last 4 weeks."
                                    : backlinksFilter === "natural"
                                    ? "No natural (DataForSEO) backlinks."
                                    : "No manual backlinks."}
                                </td>
                              </tr>
                            ) : (
                              backlinksPagination.rows.map((link, index) => {
                                const source = (() => {
                                  try {
                                    return new URL(link.sourceUrl).hostname || link.sourceUrl;
                                  } catch {
                                    return link.sourceUrl;
                                  }
                                })();
                                const publishRaw = link.firstSeen || link.createdAt;
                                const publishDate = (() => {
                                  try {
                                    return new Date(publishRaw).toISOString().slice(0, 10);
                                  } catch {
                                    return "";
                                  }
                                })();
                                const isManual = !link.firstSeen && !link.lastSeen;
                                return (
                                  <tr key={link.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{source}</td>
                                    <td className="px-6 py-4 text-sm text-emerald-800/90 whitespace-normal break-words max-w-[360px] align-top">
                                      {link.anchorText || "—"}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                      {typeof link.domainRating === "number" ? (
                                        <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">
                                          {link.domainRating}
                                        </span>
                                      ) : "—"}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{publishDate || "—"}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                      <span
                                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                          isManual ? "bg-blue-100 text-blue-800" : link.isLost ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"
                                        }`}
                                      >
                                        {isManual ? "Manual" : link.isLost ? "Lost" : "Natural"}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                      <div className="inline-flex items-center gap-2">
                                        <button
                                          type="button"
                                          className="px-2.5 py-1 rounded-lg text-primary-600 hover:bg-primary-50 font-medium"
                                          onClick={() => window.open(link.sourceUrl, "_blank", "noopener,noreferrer")}
                                        >
                                          View
                                        </button>
                                        {!reportOnly && !clientPortalMode && (
                                          <button
                                            type="button"
                                            className="px-2.5 py-1 rounded-lg text-red-600 hover:bg-red-50 font-medium inline-flex items-center gap-1"
                                            onClick={() => requestRemoveBacklink(link)}
                                          >
                                            Remove
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>

                      {!backlinksLoading && !backlinksError && backlinks.length > 0 && (
                        <div className="border-t border-gray-200 px-6 py-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                              <span>Rows per page</span>
                              <select
                                value={backlinksPageSize}
                                onChange={(e) =>
                                  setBacklinksPageSize(Number(e.target.value) as (typeof BACKLINKS_PAGE_SIZES)[number])
                                }
                                className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                              >
                                {BACKLINKS_PAGE_SIZES.map((size) => (
                                  <option key={size} value={size}>
                                    {size}
                                  </option>
                                ))}
                              </select>
                              <span className="text-xs text-gray-500">
                                Showing {backlinksPagination.from}–{backlinksPagination.to} of {backlinksPagination.totalRows}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setBacklinksPage((p) => Math.max(1, p - 1))}
                                disabled={backlinksPagination.page <= 1}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <ChevronLeft className="h-4 w-4" />
                                Prev
                              </button>
                              <span className="text-sm text-gray-600">
                                Page {backlinksPagination.page} of {backlinksPagination.totalPages}
                              </span>
                              <button
                                type="button"
                                onClick={() => setBacklinksPage((p) => Math.min(backlinksPagination.totalPages, p + 1))}
                                disabled={backlinksPagination.page >= backlinksPagination.totalPages}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Next
                                <ChevronRight className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {dashboardSection === "worklog" && (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-50 text-primary-600">
                          <Clock className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold text-gray-900 inline-flex items-center gap-1.5">
                            Work Log
                            <InfoTooltip content="Log tasks, onboarding items, and recurring work for this client." iconClassName="h-4 w-4 text-gray-400 cursor-help" />
                          </h2>
                          <p className="text-sm text-gray-500 mt-0.5">
                            Log tasks, onboarding items, and recurring work for this client.
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        {!reportOnly && !clientPortalMode && (
                          <div className="relative flex-shrink-0" ref={workLogAddMenuRef}>
                            <button
                              type="button"
                              onClick={() => setWorkLogAddMenuOpen((o) => !o)}
                              disabled={!canModifyClientSettings}
                              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                              title={canModifyClientSettings ? "Add entry" : "Included clients are view-only"}
                            >
                              <Plus className="h-4 w-4" />
                              <span>Add Entry</span>
                              <ChevronDown className="h-4 w-4" />
                            </button>
                            {workLogAddMenuOpen && (
                              <div className="absolute right-0 mt-1 w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg z-20">
                                <button
                                  type="button"
                                  onClick={openWorkLogCreate}
                                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                                >
                                  Add a task
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setWorkLogAddMenuOpen(false);
                                    setEditingWorkLogRecurringRule(null);
                                    setShowRecurringTaskModal(true);
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                                >
                                  Add a recurring task
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setWorkLogAddMenuOpen(false);
                                    setShowOnboardingModal(true);
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                                >
                                  Use a template
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setWorkLogAssigneesModalOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                          title="View project assignees and clients"
                        >
                          <Users className="h-4 w-4 text-gray-500" />
                          <span>Assignees</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{workLogProjectAssignees.length}</span>
                        </button>
                        <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
                          <button
                            type="button"
                            onClick={() => setWorkLogListTab("upcoming")}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                              workLogListTab === "upcoming"
                                ? "bg-primary-50 text-primary-700 border border-primary-200"
                                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                            }`}
                          >
                            Upcoming
                          </button>
                          <button
                            type="button"
                            onClick={() => setWorkLogListTab("completed")}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                              workLogListTab === "completed"
                                ? "bg-primary-50 text-primary-700 border border-primary-200"
                                : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                            }`}
                          >
                            Completed
                          </button>
                        </div>
                      </div>
                    </div>
                    {/* Recurring tasks (this client) */}
                    {!reportOnly && (
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setWorkLogRecurringRulesOpen((o) => !o)}
                          className="w-full flex items-center gap-2 px-6 py-3 text-left hover:bg-gray-50 transition-colors"
                        >
                          <Repeat className="h-5 w-5 text-gray-500" />
                          <span className="font-medium text-gray-900">
                            Recurring tasks ({workLogRecurringRules.filter((r) => r.isActive).length} active)
                          </span>
                          <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${workLogRecurringRulesOpen ? "rotate-180" : ""}`} />
                        </button>
                        {workLogRecurringRulesOpen && (
                          <div className="border-t border-gray-200 overflow-x-auto">
                            {workLogRecurringRules.length === 0 ? (
                              <div className="px-6 py-8 text-sm text-gray-500">
                                No recurring tasks yet. Use “Add a recurring task” above to create one.
                              </div>
                            ) : (
                              <table className="w-full">
                                <thead>
                                  <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-400 first:border-l-0">Task</th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider border-l-4 border-emerald-300">Recurrence</th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Next due</th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Status</th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Assignee</th>
                                    {!clientPortalMode && <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {workLogRecurringRules.map((r, idx) => (
                                    <tr key={r.id} className={`transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}>
                                      <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                          <div className="text-sm font-medium text-gray-900">{r.title}</div>
                                          <div className="text-xs text-gray-500">{r.category ?? "—"}</div>
                                        </div>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{workLogRecurringFrequencyLabel(r.frequency)}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                        <div className="flex items-center">
                                          <Calendar className="h-4 w-4 mr-1 text-gray-400" />
                                          {format(new Date(r.nextRunAt), "MMM dd, yyyy")}
                                        </div>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 py-1 text-xs font-bold rounded-full ${r.isActive ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                                          {r.isActive ? "Active" : "Stopped"}
                                        </span>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                        {(r as any).assignee ? ((r as any).assignee.name ?? (r as any).assignee.email) : r.assigneeId ? (assignableUsers.find((u) => u.id === r.assigneeId)?.name ?? assignableUsers.find((u) => u.id === r.assigneeId)?.email ?? "—") : "Unassigned"}
                                      </td>
                                      {!clientPortalMode && (
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                          {(user?.role === "SUPER_ADMIN" || (r as any).createdBy?.id === user?.id) ? (
                                          <div className="flex items-center gap-1">
                                            {r.isActive ? (
                                              <button type="button" onClick={() => handleWorkLogStopRecurrence(r.id)} className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors" title="Stop recurrence">
                                                <StopCircle className="h-4 w-4" />
                                              </button>
                                            ) : (
                                              <button type="button" onClick={() => handleWorkLogResumeRecurrence(r.id)} className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors" title="Resume">
                                                <Play className="h-4 w-4" />
                                              </button>
                                            )}
                                            <button type="button" onClick={() => { setEditingWorkLogRecurringRule(r); setShowRecurringTaskModal(true); }} className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors" title="Edit">
                                              <Edit className="h-4 w-4" />
                                            </button>
                                            <button type="button" onClick={() => handleWorkLogRemoveRecurrence(r.id)} className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove">
                                              <Trash2 className="h-4 w-4" />
                                            </button>
                                          </div>
                                          ) : (
                                            <span className="text-xs text-gray-400">—</span>
                                          )}
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="min-w-full">
                          <thead>
                            <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                              <th className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-400 first:border-l-0">Title</th>
                              <th className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider border-l-4 border-emerald-300">Work Type</th>
                              <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Due date</th>
                              <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Assigned to</th>
                              <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Status</th>
                              <th className="px-6 py-3.5 text-right text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {workLogLoading ? (
                              <tr>
                                <td className="px-6 py-8 text-sm text-gray-500 bg-gray-50/50" colSpan={6}>
                                  Loading work log...
                                </td>
                              </tr>
                            ) : workLogError ? (
                              <tr>
                                <td className="px-6 py-8 text-sm text-rose-600 bg-rose-50/50" colSpan={6}>
                                  {workLogError}
                                </td>
                              </tr>
                            ) : workLogFilteredTasks.length === 0 ? (
                              <tr>
                                <td className="px-6 py-8 text-sm text-gray-500 bg-amber-50/50" colSpan={6}>
                                  {workLogListTab === "completed" ? "No completed entries yet." : "No upcoming entries."}
                                </td>
                              </tr>
                            ) : (
                              workLogPagination.rows.map((task, index) => {
                                const dueDateRaw = (task as any).dueDate;
                                const dueDateStr = dueDateRaw
                                  ? (typeof dueDateRaw === "string" ? dueDateRaw.slice(0, 10) : new Date(dueDateRaw).toISOString().slice(0, 10))
                                  : "—";
                                const workType = (task.category || "General").trim() || "General";
                                const titleText = (task.description || task.title || "").trim();
                                const titleDisplay = titleText.length > 90 ? `${titleText.slice(0, 90)}…` : titleText;
                                return (
                                  <tr key={task.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}>
                                    <td className="px-6 py-4 text-sm font-medium text-gray-900 max-w-xs align-top">
                                      <button
                                        type="button"
                                        onClick={() => openWorkLogEdit(task.id)}
                                        className="block w-full truncate text-left hover:text-primary-700 hover:underline transition-colors"
                                        title={titleText || undefined}
                                      >
                                        {titleDisplay || "—"}
                                      </button>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-emerald-800/90">{workType}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{dueDateStr}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-violet-800/90">
                                      {task.assignee ? (task.assignee.name || task.assignee.email) : "—"}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <span
                                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${taskStatusClass(task.status)}`}
                                      >
                                        {taskStatusLabel(task.status)}
                                      </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                      <div className="inline-flex items-center gap-1 justify-end">
                                      <button
                                        type="button"
                                        className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                        title="View entry"
                                        onClick={() => (user?.role === "SUPER_ADMIN" ? openWorkLogView(task.id) : openWorkLogEdit(task.id))}
                                      >
                                        <Eye className="h-4 w-4" />
                                      </button>
                                      {!reportOnly && !clientPortalMode && (user?.role === "SUPER_ADMIN" || task.createdBy?.id === user?.id) && (
                                        <>
                                          <button
                                            type="button"
                                            className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                            title="Edit entry"
                                            onClick={() => openWorkLogEdit(task.id)}
                                          >
                                            <Edit className="h-4 w-4" />
                                          </button>
                                          <button
                                            type="button"
                                            className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                                            title="Delete entry"
                                            onClick={() => handleDeleteWorkLog(task.id, task.title)}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </button>
                                        </>
                                      )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>

                      {!workLogLoading && !workLogError && workLogFilteredTasks.length > 0 && (
                        <div className="border-t border-gray-200 px-6 py-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                              <span>Rows per page</span>
                              <select
                                value={workLogPageSize}
                                onChange={(e) =>
                                  setWorkLogPageSize(Number(e.target.value) as (typeof WORKLOG_PAGE_SIZES)[number])
                                }
                                className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                              >
                                {WORKLOG_PAGE_SIZES.map((size) => (
                                  <option key={size} value={size}>
                                    {size}
                                  </option>
                                ))}
                              </select>
                              <span className="text-xs text-gray-500">
                                Showing {workLogPagination.from}-{workLogPagination.to} of {workLogPagination.totalRows}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setWorkLogPage((p) => Math.max(1, p - 1))}
                                disabled={workLogPagination.page <= 1}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <ChevronLeft className="h-4 w-4" />
                                Prev
                              </button>
                              <span className="text-sm text-gray-600">
                                Page {workLogPagination.page} of {workLogPagination.totalPages}
                              </span>
                              <button
                                type="button"
                                onClick={() => setWorkLogPage((p) => Math.min(workLogPagination.totalPages, p + 1))}
                                disabled={workLogPagination.page >= workLogPagination.totalPages}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Next
                                <ChevronRight className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              </div>

              {/* Dashboard modals (must render while on Dashboard tab) */}
              {workLogModalOpen && createPortal(
                <div
                  className={`fixed inset-0 z-50 ${
                    workLogModalMode === "edit"
                      ? "pointer-events-none flex items-stretch justify-end p-0"
                      : "flex items-center justify-center p-4"
                  }`}
                >
                  {workLogModalMode !== "edit" && (
                    <div
                      className="absolute inset-0 bg-black/50"
                      onClick={() => setWorkLogModalOpen(false)}
                    />
                  )}
                  <div
                    className={`relative w-full flex flex-col bg-white shadow-2xl overflow-hidden pointer-events-auto ${
                      workLogModalMode === "edit"
                        ? "max-w-2xl h-full rounded-none ring-0"
                        : "max-w-lg max-h-[90vh] rounded-2xl ring-2 ring-primary-200/80"
                    }`}
                    style={workLogModalMode === "edit" ? { animation: "workLogSlideInRight 260ms ease-out" } : undefined}
                  >
                    {workLogModalMode === "edit" && (
                      <style>{`@keyframes workLogSlideInRight{from{transform:translateX(24px);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
                    )}
                    <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-blue-600 border-b-2 border-teal-500/50">
                      <h3 className="text-lg font-bold text-white drop-shadow-sm">
                        {workLogModalMode === "create"
                          ? "Add Work Log Entry"
                          : workLogModalMode === "edit"
                          ? "Edit Work Log Entry"
                          : "Work Log Entry"}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setWorkLogModalOpen(false)}
                        className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    <div
                      className={`overflow-auto overflow-x-auto ${
                        workLogModalMode === "edit"
                          ? "flex-1"
                          : "max-h-[calc(90vh-14rem)]"
                      } bg-gradient-to-b from-slate-50/50 to-white`}
                    >
                      <div className="px-6 py-5 space-y-4 min-w-0">
                      <div className="rounded-xl border-l-4 border-primary-500 bg-primary-50/50 p-3">
                        {workLogModalMode !== "edit" && (
                          <label className="block text-sm font-semibold text-primary-800 mb-1">Title</label>
                        )}
                        <input
                          type="text"
                          maxLength={90}
                          value={workLogForm.description}
                          onChange={(e) => setWorkLogForm({ ...workLogForm, description: e.target.value })}
                          disabled={isWorkLogFieldsReadOnly}
                          className={`w-full border-2 border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-400 disabled:bg-gray-50 transition-shadow ${
                            workLogModalMode === "edit" ? "text-lg font-semibold" : "text-sm"
                          }`}
                          placeholder="e.g. Optimized homepage title tags"
                        />
                      </div>

                      <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-3">
                        <label className="block text-sm font-semibold text-emerald-800 mb-1">Work Type</label>
                        <input
                          type="text"
                          value={workLogForm.category}
                          onChange={(e) => setWorkLogForm({ ...workLogForm, category: e.target.value })}
                          disabled={isWorkLogFieldsReadOnly}
                          className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 disabled:bg-gray-50 transition-shadow"
                          placeholder="e.g. Technical, Content, Link Building"
                        />
                      </div>

                      <div className="rounded-xl border-l-4 border-violet-500 bg-violet-50/50 p-3">
                        <label className="block text-sm font-semibold text-violet-800 mb-1">Due date</label>
                        <input
                          type="date"
                          value={workLogForm.dueDate}
                          onChange={(e) => setWorkLogForm({ ...workLogForm, dueDate: e.target.value })}
                          disabled={isWorkLogFieldsReadOnly}
                          className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-400 disabled:bg-gray-50 transition-shadow"
                        />
                      </div>

                      <div ref={assignToRef} className="relative rounded-xl border-l-4 border-slate-400 bg-slate-50/50 p-3">
                        <label className="block text-sm font-semibold text-slate-700 mb-1">Assign to</label>
                        {isWorkLogFieldsReadOnly ? (
                          <p className="text-sm text-gray-900 py-2">
                            {workLogForm.assigneeId
                              ? (() => {
                                  const task = selectedWorkLogTaskId ? workLogTasks.find((t) => t.id === selectedWorkLogTaskId) : null;
                                  const u = task?.assignee ?? assignableUsers.find((x) => x.id === workLogForm.assigneeId);
                                  return u ? `${u.name || u.email}${u.email && u.name ? ` (${u.email})` : ""}` : "—";
                                })()
                              : "—"}
                          </p>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={workLogForm.assigneeId ? workLogForm.assigneeDisplay : assignableSearch}
                                onChange={(e) => {
                                  setAssignableSearch(e.target.value);
                                  setAssignToOpen(true);
                                  if (workLogForm.assigneeId && e.target.value !== workLogForm.assigneeDisplay) setWorkLogForm((p) => ({ ...p, assigneeId: "", assigneeDisplay: "" }));
                                }}
                                onFocus={() => setAssignToOpen(true)}
                                placeholder="Search by name or email"
                                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                              />
                              {workLogForm.assigneeId && (
                                <button type="button" onClick={() => { setWorkLogForm((p) => ({ ...p, assigneeId: "", assigneeDisplay: "" })); setAssignableSearch(""); setAssignToOpen(true); }} className="text-sm text-gray-500 hover:text-gray-700">
                                  Clear
                                </button>
                              )}
                            </div>
                            {assignToOpen && (
                              <ul className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1">
                                {assignableLoading ? (
                                  <li className="px-3 py-2 text-sm text-gray-500">Loading…</li>
                                ) : assignableUsers.length === 0 ? (
                                  <li className="px-3 py-2 text-sm text-gray-500">No users found. Try a different search.</li>
                                ) : (
                                  assignableUsers.map((u) => (
                                    <li key={u.id}>
                                      <button
                                        type="button"
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 flex items-center justify-between"
                                        onClick={() => { setWorkLogForm((p) => ({ ...p, assigneeId: u.id, assigneeDisplay: u.name || u.email })); setAssignableSearch(""); setAssignToOpen(false); }}
                                      >
                                        <span>{u.name || u.email}</span>
                                        <span className="text-xs text-gray-500 ml-2">{u.role.replace("_", " ")}</span>
                                      </button>
                                    </li>
                                  ))
                                )}
                              </ul>
                            )}
                          </>
                        )}
                      </div>

                      <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-3">
                        <label className="block text-sm font-semibold text-amber-800 mb-1">Description</label>
                        {!isWorkLogFieldsReadOnly && (
                          <div className="flex flex-wrap gap-1 mb-1 p-1 border border-amber-200 rounded-t-lg bg-amber-50/50">
                            <button type="button" onClick={() => document.execCommand("bold")} className="px-2 py-1 text-sm font-bold border border-amber-300 rounded hover:bg-amber-100 text-amber-900" title="Bold">B</button>
                            <button type="button" onClick={() => document.execCommand("insertUnorderedList")} className="px-2 py-1 text-sm border border-amber-300 rounded hover:bg-amber-100 text-amber-900" title="Bullet list">• List</button>
                            <button type="button" onClick={() => document.execCommand("insertOrderedList")} className="px-2 py-1 text-sm border border-amber-300 rounded hover:bg-amber-100 text-amber-900" title="Numbered list">1. List</button>
                          </div>
                        )}
                        <div
                          ref={workLogTaskNotesRef}
                          contentEditable={!isWorkLogFieldsReadOnly}
                          suppressContentEditableWarning
                          onInput={(e) => setWorkLogForm((prev) => ({ ...prev, taskNotes: (e.target as HTMLDivElement).innerHTML }))}
                          onBlur={(e) => setWorkLogForm((prev) => ({ ...prev, taskNotes: (e.target as HTMLDivElement).innerHTML }))}
                          className="min-h-[220px] w-full border border-gray-300 rounded-lg rounded-tl-none px-4 py-3 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-50 overflow-y-auto overflow-x-auto resize-y prose prose-sm max-w-none list-disc pl-5 space-y-1"
                          data-placeholder="Add task details, bullet points, etc."
                          style={{ outline: "none" }}
                        />
                      </div>

                      <div className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50/50 p-3">
                        <label className="block text-sm font-semibold text-indigo-800 mb-2">Proof / Attachments</label>
                        {!isWorkLogFieldsReadOnly && (
                          <>
                            <input
                              id="work-log-file-input-1"
                              type="file"
                              multiple
                              accept=".pdf,.doc,.docx,.xls,.xlsx,image/*,video/*,.txt,.csv"
                              className="sr-only"
                              aria-label="Upload work log attachment"
                              onChange={handleWorkLogFileSelect}
                            />
                            <div className="mb-4">
                              <label
                                htmlFor="work-log-file-input-1"
                                className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-500 transition-colors"
                              >
                                <div className="flex flex-col items-center">
                                  {workLogUploading ? (
                                    <Loader2 className="h-6 w-6 text-gray-400 mb-2 animate-spin" />
                                  ) : (
                                    <Upload className="h-6 w-6 text-gray-400 mb-2" />
                                  )}
                                  <span className="text-sm text-gray-600">
                                    {workLogUploading ? "Uploading…" : "Click to upload files (PDF, Word, Excel, images, etc.)"}
                                  </span>
                                  <span className="text-xs text-gray-500 mt-1">max 25MB per file</span>
                                </div>
                              </label>
                            </div>
                            <div className="space-y-3 mb-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  value={workLogUrlType}
                                  onChange={(e) => setWorkLogUrlType(e.target.value as "image" | "video" | "url")}
                                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent w-full sm:w-40"
                                >
                                  <option value="url">URL</option>
                                  <option value="image">Image URL</option>
                                  <option value="video">Video URL</option>
                                </select>
                                <span className="text-sm text-gray-500 hidden sm:inline">Add a link as proof</span>
                              </div>
                              <div className="flex flex-col sm:flex-row gap-3">
                                <input
                                  type="url"
                                  value={workLogUrlInput}
                                  onChange={(e) => setWorkLogUrlInput(e.target.value)}
                                  placeholder="Enter URL (e.g., https://example.com/image.png)"
                                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                />
                                <button
                                  type="button"
                                  onClick={handleWorkLogAddUrl}
                                  className="sm:self-end w-full sm:w-auto flex-shrink-0 px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center gap-1.5 font-medium"
                                >
                                  <Plus className="h-4 w-4" />
                                  <span>Add link</span>
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                        {workLogForm.attachments.length > 0 ? (
                          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                            {workLogForm.attachments.map((att, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                              >
                                <div className="flex items-center space-x-3 flex-1 min-w-0">
                                  {att.type === "image" && <Image className="h-5 w-5 text-blue-600 flex-shrink-0" />}
                                  {att.type === "video" && <Video className="h-5 w-5 text-purple-600 flex-shrink-0" />}
                                  {(att.type === "url" || !att.type) && <LinkIcon className="h-5 w-5 text-green-600 flex-shrink-0" />}
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-gray-900 truncate">
                                      {att.name || att.value || "Attachment"}
                                    </div>
                                    <a
                                      href={getUploadFileUrl(att.value)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(getUploadFileUrl(att.value), "_blank", "noopener,noreferrer");
                                        e.preventDefault();
                                      }}
                                      className="text-xs text-primary-600 hover:text-primary-800 truncate block"
                                    >
                                      {att.name || att.value}
                                    </a>
                                  </div>
                                </div>
                                {!isWorkLogFieldsReadOnly && (
                                  <button
                                    type="button"
                                    onClick={() => removeWorkLogAttachment(i)}
                                    className="ml-2 p-1 text-red-600 hover:text-red-800 flex-shrink-0"
                                    title="Remove"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">No attachments</p>
                        )}
                      </div>

                      <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-3">
                        <label className="block text-sm font-semibold text-blue-800 mb-1">Status</label>
                        <select
                          value={workLogForm.status}
                          onChange={(e) => setWorkLogForm({ ...workLogForm, status: e.target.value as TaskStatus })}
                          disabled={isWorkLogFieldsReadOnly}
                          className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-400 disabled:bg-gray-50 transition-shadow"
                        >
                          <option value="TODO">Pending</option>
                          <option value="IN_PROGRESS">In Progress</option>
                          <option value="REVIEW">In Review</option>
                          <option value="NEEDS_APPROVAL">Needs Approval</option>
                          <option value="CANCELLED">Cancelled</option>
                          <option value="DONE">Completed</option>
                        </select>
                        {workLogForm.status === "NEEDS_APPROVAL" && !isWorkLogFieldsReadOnly && (
                          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                            <p className="text-xs font-medium text-amber-800 mb-2">Send approval request to (select who should be notified):</p>
                            {clientUsersLoading ? (
                              <p className="text-sm text-amber-700">Loading recipients…</p>
                            ) : workLogApprovalClientUsers.length === 0 ? (
                              <p className="text-sm text-amber-700">No users available for this account.</p>
                            ) : (
                              <div className="max-h-40 overflow-y-auto space-y-1.5">
                                {workLogApprovalClientUsers.map((u) => (
                                  <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={workLogForm.approvalNotifyUserIds.includes(u.id)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setWorkLogForm({ ...workLogForm, approvalNotifyUserIds: [...(workLogForm.approvalNotifyUserIds || []), u.id] });
                                        } else {
                                          setWorkLogForm({ ...workLogForm, approvalNotifyUserIds: (workLogForm.approvalNotifyUserIds || []).filter((id) => id !== u.id) });
                                        }
                                      }}
                                      className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                                    />
                                    <span className="text-sm text-gray-800">{u.name || u.email || u.id}</span>
                                    {u.email && u.name && <span className="text-xs text-gray-500">({u.email})</span>}
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border-l-4 border-teal-500 bg-teal-50/50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <label className="block text-sm font-semibold text-teal-800">Activity</label>
                          {workLogModalMode !== "create" && selectedWorkLogTaskId && (
                            <button
                              type="button"
                              onClick={() => void fetchWorkLogComments(selectedWorkLogTaskId)}
                              className="text-xs text-gray-500 hover:text-gray-700"
                            >
                              Refresh
                            </button>
                          )}
                        </div>
                        {workLogModalMode === "create" || !selectedWorkLogTaskId ? (
                          <p className="mt-2 text-sm text-gray-500">Save the work log entry to start the activity feed.</p>
                        ) : (
                          <div className="mt-3 rounded-lg border border-gray-200 bg-white">
                            <div className="max-h-64 overflow-y-auto p-3 space-y-3">
                              {workLogCommentsLoading ? (
                                <p className="text-sm text-gray-500">Loading activity...</p>
                              ) : workLogCommentsError ? (
                                <p className="text-sm text-rose-600">{workLogCommentsError}</p>
                              ) : workLogComments.length === 0 ? (
                                <p className="text-sm text-gray-500">No activity yet. Start the conversation below.</p>
                              ) : (
                                workLogComments.map((c) => {
                                  const config = workLogActivityConfig[c.type] || workLogActivityConfig.COMMENT;
                                  const displayName = c.author?.name || c.author?.email || "Unknown";
                                  const initials = displayName
                                    .split(/\s+/)
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map((part) => part.charAt(0).toUpperCase())
                                    .join("") || "U";
                                  const authorRole = c.author?.role === "USER"
                                    ? "Client"
                                    : c.author?.role === "SPECIALIST"
                                      ? "Specialist"
                                      : c.author?.role === "SUPER_ADMIN"
                                        ? "Super Admin"
                                        : c.author?.role === "ADMIN"
                                          ? "Admin"
                                          : "Agency";
                                  const when = (() => {
                                    try {
                                      return new Date(c.createdAt).toLocaleString();
                                    } catch {
                                      return "";
                                    }
                                  })();
                                  const isAuthor = Boolean(user?.id) && c.author?.id === user?.id;
                                  const canDelete = isAuthor;
                                  return (
                                    <div key={c.id} className={`group rounded-lg border p-3 ${config.border} ${config.bg}`}>
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex items-start gap-3">
                                          <div
                                            className={`h-8 w-8 flex-shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${
                                              c.author?.role === "USER"
                                                ? "bg-violet-100 text-violet-700"
                                                : c.author?.role === "SPECIALIST"
                                                  ? "bg-emerald-100 text-emerald-700"
                                                  : c.author?.role === "SUPER_ADMIN"
                                                    ? "bg-indigo-100 text-indigo-700"
                                                    : c.author?.role === "ADMIN"
                                                      ? "bg-blue-100 text-blue-700"
                                                      : "bg-slate-100 text-slate-700"
                                            }`}
                                            title={displayName}
                                          >
                                            {initials}
                                          </div>
                                          <div className="min-w-0">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 truncate">
                                              {displayName}
                                            </p>
                                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                              {authorRole}
                                            </span>
                                          </div>
                                          <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap break-words">
                                            {renderWorkLogCommentBody(c.body)}
                                          </p>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                          <p className="text-xs text-gray-500">{when}</p>
                                          {canDelete && (
                                            <button
                                              type="button"
                                              onClick={() => requestDeleteWorkLogComment(c.id)}
                                              className="p-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                              title="Delete"
                                            >
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>

                            <div className="border-t border-gray-200 p-3">
                              {!canCommentOnWorkLog ? (
                                <p className="text-sm text-gray-500">Sign in to participate in the conversation.</p>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <div className="relative flex-1">
                                      <div
                                        aria-hidden
                                        className="absolute inset-0 pointer-events-none px-3 py-2 text-sm leading-5 text-gray-700 whitespace-pre-wrap break-words rounded-lg"
                                      >
                                        {workLogNewComment.length === 0 ? (
                                          <span className="text-gray-400">Write a comment... Use @ to mention a user.</span>
                                        ) : (
                                          renderWorkLogCommentEditorOverlay(workLogNewComment)
                                        )}
                                      </div>
                                      <textarea
                                        ref={workLogCommentInputRef}
                                        value={workLogNewComment}
                                        onChange={handleWorkLogCommentChange}
                                        onClick={(e) => updateWorkLogMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
                                        onKeyUp={(e) => updateWorkLogMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
                                        onKeyDown={handleWorkLogMentionKeyDown}
                                        rows={2}
                                        className="relative z-10 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm leading-5 bg-transparent text-transparent caret-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                        placeholder=""
                                      />
                                      {workLogMentionRange && workLogMentionSuggestions.length > 0 && (
                                        <div className="absolute bottom-full z-30 mb-1 w-full max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                          {workLogMentionSuggestions.map((member, idx) => (
                                            <button
                                              key={member.id}
                                              type="button"
                                              onMouseDown={(e) => {
                                                e.preventDefault();
                                                handleSelectWorkLogMention(member);
                                              }}
                                              className={`w-full px-3 py-2 text-left ${idx === workLogMentionActiveIndex ? "bg-primary-50" : "hover:bg-gray-50"}`}
                                            >
                                              <div className="text-sm font-medium text-gray-900">{member.name || member.email}</div>
                                              <div className="text-xs text-gray-500">{member.email}</div>
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      disabled={postingWorkLogComment || workLogNewComment.trim().length === 0}
                                      onClick={() => void handlePostWorkLogComment()}
                                      className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                                    >
                                      <Send className="h-4 w-4" />
                                      Post
                                    </button>
                                  </div>
                                  <div className="pt-1">
                                    <div className="flex items-center gap-3">
                                      <button
                                        type="button"
                                        onClick={() => setWorkLogCollaboratorEditorOpen((v) => !v)}
                                        className="text-sm font-medium text-gray-700 hover:text-gray-900"
                                      >
                                        Collaborators
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setWorkLogCollaboratorEditorOpen((v) => !v)}
                                        className="flex items-center -space-x-2"
                                        title="Edit collaborators"
                                      >
                                        {workLogEntryCollaborators.slice(0, 8).map((member) => {
                                          const displayName = member.name || member.email;
                                          const initials = displayName
                                            .split(" ")
                                            .filter(Boolean)
                                            .slice(0, 2)
                                            .map((part) => part[0]?.toUpperCase() || "")
                                            .join("") || "U";
                                          return (
                                            <div
                                              key={member.id}
                                              className="h-7 w-7 rounded-full border-2 border-white bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center"
                                              title={`${displayName} (${member.email})`}
                                            >
                                              {initials}
                                            </div>
                                          );
                                        })}
                                        {workLogEntryCollaborators.length > 8 && (
                                          <div
                                            className="h-7 w-7 rounded-full border-2 border-white bg-gray-100 text-gray-600 text-[10px] font-semibold flex items-center justify-center"
                                            title={`${workLogEntryCollaborators.length - 8} more`}
                                          >
                                            +{workLogEntryCollaborators.length - 8}
                                          </div>
                                        )}
                                        <span className="ml-1 h-7 w-7 rounded-full border border-gray-300 bg-white text-gray-600 flex items-center justify-center">
                                          <Plus className="h-3.5 w-3.5" />
                                        </span>
                                      </button>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-500">
                                      Collaborators notified on every message: <span className="font-semibold text-gray-700">{workLogEntryCollaborators.length}</span>
                                      {" "}• @mention adds collaborator
                                    </p>
                                    {workLogCollaboratorEditorOpen && (
                                      <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2.5 space-y-2">
                                        <div className="flex flex-wrap gap-1.5">
                                          {workLogEntryCollaborators.map((member) => (
                                            <span key={member.id} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                              {member.name || member.email}
                                              <button type="button" className="text-gray-500 hover:text-red-600" onClick={() => removeWorkLogCollaborator(member.id)}>
                                                <X className="h-3 w-3" />
                                              </button>
                                            </span>
                                          ))}
                                        </div>
                                        <input
                                          value={workLogCollaboratorSearch}
                                          onChange={(e) => setWorkLogCollaboratorSearch(e.target.value)}
                                          placeholder="Add collaborators by name or email..."
                                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                        />
                                        <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200">
                                          {workLogCollaboratorSearchResults.map((member) => {
                                            const selected = workLogEntryCollaborators.some((m) => m.id === member.id);
                                            return (
                                              <button
                                                key={member.id}
                                                type="button"
                                                onClick={() => (selected ? removeWorkLogCollaborator(member.id) : addWorkLogCollaborator(member.id))}
                                                className="w-full flex items-center justify-between px-2.5 py-2 text-left hover:bg-gray-50"
                                              >
                                                <div className="min-w-0">
                                                  <div className="text-sm text-gray-900 truncate">{member.name || member.email}</div>
                                                  <div className="text-xs text-gray-500 truncate">{member.email}</div>
                                                </div>
                                                <span className={`text-xs font-medium ${selected ? "text-red-600" : "text-primary-600"}`}>
                                                  {selected ? "Remove" : "Add"}
                                                </span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    </div>

<div className="flex-shrink-0 px-6 py-4 border-t-2 border-gray-200 flex items-center justify-end gap-3 bg-gradient-to-r from-gray-50 to-slate-50">
                  <button
                    type="button"
                    onClick={() => setWorkLogModalOpen(false)}
                    className="px-5 py-2.5 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors"
                  >
                    Close
                  </button>
                  {!isWorkLogFieldsReadOnly && canEditSelectedWorkLog && (
                    <button
                      type="button"
                      onClick={handleSaveWorkLog}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-semibold hover:from-emerald-700 hover:to-teal-700 transition-all shadow-md"
                    >
                      Save
                    </button>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}

              {/* Onboarding tasks modal (from Work Log "Use a template") */}
              {!reportOnly && (
                <OnboardingTemplateModal
                  open={showOnboardingModal}
                  setOpen={setShowOnboardingModal}
                  onTasksCreated={() => {
                    fetchWorkLog();
                  }}
                  initialClientId={clientId ?? undefined}
                />
              )}

              {/* Recurring task modal (from Work Log "Add a recurring task" / Edit in recurring table) */}
              {!reportOnly && clientId && (
                <WorkLogRecurringModal
                  open={showRecurringTaskModal}
                  setOpen={(open) => {
                    setShowRecurringTaskModal(open);
                    if (!open) setEditingWorkLogRecurringRule(null);
                  }}
                  onSaved={() => {
                    fetchWorkLog();
                    fetchWorkLogRecurringRules();
                    setShowRecurringTaskModal(false);
                    setEditingWorkLogRecurringRule(null);
                  }}
                  clientId={clientId}
                  rule={editingWorkLogRecurringRule}
                />
              )}
              {/* Confirm remove recurring task (Work Log section) */}
              {!reportOnly && (
                <ConfirmDialog
                  isOpen={workLogRecurringRemoveConfirm.isOpen}
                  onClose={() => setWorkLogRecurringRemoveConfirm({ isOpen: false, ruleId: null })}
                  onConfirm={confirmWorkLogRemoveRecurrence}
                  title="Remove recurring task"
                  message="Are you sure you want to remove this recurring task? This cannot be undone."
                  confirmText="Remove"
                  variant="danger"
                />
              )}

              {/* Add Backlink Modal */}
              {!reportOnly && !includedClientReadOnly &&
                addBacklinkModalOpen &&
                createPortal(
                  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden ring-2 ring-primary-200/80">
                      <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 border-b-2 border-primary-500/50">
                        <h3 className="text-lg font-bold text-white drop-shadow-sm">Add Backlink</h3>
                        <button
                          type="button"
                          onClick={() => setAddBacklinkModalOpen(false)}
                          className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>

                      <div className="px-6 py-4 space-y-4 bg-gradient-to-b from-slate-50/80 to-white">
                        <div className="rounded-xl border-l-4 border-primary-500 bg-primary-50/60 p-3">
                          <label className="block text-sm font-semibold text-primary-800 mb-1">Source URL</label>
                          <input
                            type="text"
                            value={addBacklinkForm.sourceUrl}
                            onChange={(e) => setAddBacklinkForm((p) => ({ ...p, sourceUrl: e.target.value }))}
                            className="w-full border-2 border-primary-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white transition-shadow"
                            placeholder="https://example.com/page"
                          />
                        </div>
                        <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/60 p-3">
                          <label className="block text-sm font-semibold text-emerald-800 mb-1">Target URL</label>
                          <input
                            type="text"
                            value={addBacklinkForm.targetUrl}
                            onChange={(e) => setAddBacklinkForm((p) => ({ ...p, targetUrl: e.target.value }))}
                            className="w-full border-2 border-emerald-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 bg-white transition-shadow"
                            placeholder="https://your-site.com/"
                          />
                        </div>
                        <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/60 p-3">
                          <label className="block text-sm font-semibold text-amber-800 mb-1">Anchor Text (optional)</label>
                          <input
                            type="text"
                            value={addBacklinkForm.anchorText}
                            onChange={(e) => setAddBacklinkForm((p) => ({ ...p, anchorText: e.target.value }))}
                            className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-400 bg-white transition-shadow"
                            placeholder="e.g. best seo services"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="rounded-xl border-l-4 border-violet-500 bg-violet-50/60 p-3">
                            <label className="block text-sm font-semibold text-violet-800 mb-1">Domain Rating (optional)</label>
                            <input
                              type="number"
                              value={addBacklinkForm.domainRating}
                              onChange={(e) => setAddBacklinkForm((p) => ({ ...p, domainRating: e.target.value }))}
                              className="w-full border-2 border-violet-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-400 bg-white transition-shadow"
                              placeholder="e.g. 65"
                            />
                          </div>
                          <div className="flex items-end rounded-xl border-l-4 border-slate-400 bg-slate-50/60 p-3">
                            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                              <input
                                type="checkbox"
                                checked={addBacklinkForm.isFollow}
                                onChange={(e) => setAddBacklinkForm((p) => ({ ...p, isFollow: e.target.checked }))}
                                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                              />
                              Follow link
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className="px-6 py-4 border-t-2 border-gray-200 flex items-center justify-end gap-3 bg-gradient-to-r from-gray-50 to-slate-50">
                        <button
                          type="button"
                          onClick={() => setAddBacklinkModalOpen(false)}
                          className="px-5 py-2.5 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={addingBacklink}
                          onClick={() => void submitAddBacklink()}
                          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary-600 to-blue-600 text-white font-semibold hover:from-primary-700 hover:to-blue-700 disabled:opacity-50 transition-all shadow-md"
                        >
                          {addingBacklink ? "Saving..." : "Add"}
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

              {/* Import Backlinks Modal */}
              {!reportOnly && !includedClientReadOnly &&
                importBacklinksModalOpen &&
                createPortal(
                  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden ring-2 ring-blue-200/80">
                      <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 border-b-2 border-indigo-500/50">
                        <div>
                          <h3 className="text-lg font-bold text-white drop-shadow-sm">Import Backlinks</h3>
                          <p className="text-sm text-white/90 mt-1">Paste source URLs (one per line). Target URL defaults to this client.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setImportBacklinksModalOpen(false)}
                          className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>

                      <div className="px-6 py-4 space-y-3 bg-gradient-to-b from-slate-50/80 to-white">
                        <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/60 p-3">
                          <label className="block text-sm font-semibold text-blue-900 mb-1">Source URLs (one per line)</label>
                          <textarea
                            value={importBacklinksText}
                            onChange={(e) => setImportBacklinksText(e.target.value)}
                            className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-400 bg-white transition-shadow"
                            rows={10}
                            placeholder={"https://example.com/page-1\nhttps://example.com/page-2"}
                          />
                        </div>
                        <p className="text-xs text-amber-800 bg-amber-50 rounded-xl px-4 py-3 border-l-4 border-amber-500 border border-amber-200/80">
                          Tip: after importing, you can click the top “Refresh” button (Super Admin) to pull live/lost backlink data from DataForSEO.
                        </p>
                      </div>

                      <div className="px-6 py-4 border-t-2 border-gray-200 flex items-center justify-end gap-3 bg-gradient-to-r from-gray-50 to-slate-50">
                        <button
                          type="button"
                          onClick={() => setImportBacklinksModalOpen(false)}
                          className="px-5 py-2.5 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={importingBacklinks}
                          onClick={() => void submitImportBacklinks()}
                          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-md"
                        >
                          {importingBacklinks ? "Importing..." : "Import"}
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

              {workLogAssigneesModalOpen &&
                createPortal(
                  <div className="fixed inset-0 z-[80] bg-black/55" onClick={() => setWorkLogAssigneesModalOpen(false)}>
                    <div className="flex min-h-full items-start justify-center p-4 sm:p-8">
                      <div
                        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
                          <h3 className="text-xl font-semibold">Project assignees and clients</h3>
                          <button
                            type="button"
                            onClick={() => setWorkLogAssigneesModalOpen(false)}
                            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                            aria-label="Close"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
                          {workLogProjectAssignees.length === 0 ? (
                            <p className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
                              No assignees found for this project yet.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {workLogProjectAssignees.map((member) => {
                                const displayName = member.name || member.email;
                                const initials = displayName
                                  .split(" ")
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map((part) => part[0]?.toUpperCase() || "")
                                  .join("") || "U";
                                return (
                                  <div key={member.id} className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2.5">
                                    <div className="min-w-0 flex items-center gap-3">
                                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold text-indigo-200">
                                        {initials}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-slate-100">{displayName}</p>
                                        <p className="truncate text-xs text-slate-400">{member.email}</p>
                                      </div>
                                    </div>
                                    <span className="rounded-md border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs text-slate-300">
                                      {(() => {
                                        const normalized = (member.role || "ASSIGNEE").toUpperCase();
                                        if (normalized === "USER") return "Client";
                                        return normalized
                                          .replace(/_/g, " ")
                                          .toLowerCase()
                                          .split(" ")
                                          .filter(Boolean)
                                          .map((part) => part[0]?.toUpperCase() + part.slice(1))
                                          .join(" ");
                                      })()}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

              <ConfirmDialog
                isOpen={workLogDeleteConfirm.isOpen}
                onClose={() => setWorkLogDeleteConfirm({ isOpen: false, taskId: null, taskTitle: null })}
                onConfirm={() => void confirmDeleteWorkLog()}
                title="Delete work log entry"
                message={`Are you sure you want to delete "${workLogDeleteConfirm.taskTitle || "this entry"}"? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                variant="danger"
              />
              <ConfirmDialog
                isOpen={workLogCommentDeleteConfirm.isOpen}
                onClose={() => setWorkLogCommentDeleteConfirm({ isOpen: false, commentId: null })}
                onConfirm={() => void confirmDeleteWorkLogComment()}
                title="Delete activity"
                message="Are you sure you want to delete this activity?"
                confirmText="Delete"
                cancelText="Cancel"
                variant="danger"
              />

              <ConfirmDialog
                isOpen={backlinkDeleteConfirm.isOpen}
                onClose={() => setBacklinkDeleteConfirm({ isOpen: false, backlinkId: null, label: null, isLost: false })}
                onConfirm={() => void confirmRemoveBacklink()}
                title="Remove backlink"
                message={`Remove backlink from "${backlinkDeleteConfirm.label || "this source"}"? This will delete the backlink row from this client.`}
                confirmText="Remove"
                cancelText="Cancel"
                variant="danger"
              />

              {/* View / Edit Client Information Modal (same layout as Edit Client in Clients page) */}
              <ClientAccountFormModal
                open={showViewClientModal && !!client}
                title={["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(user?.role || "") ? "Edit Client" : "Client Information"}
                subtitle="Account information"
                form={viewClientForm}
                setForm={setViewClientForm}
                canEdit={["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(user?.role || "")}
                showStatus={user?.role === "SUPER_ADMIN" || user?.role === "ADMIN"}
                showExtendedSuperAdminFields={user?.role === "SUPER_ADMIN"}
                showSeoRoadmapSection={false}
                onClose={() => setShowViewClientModal(false)}
                onSave={
                  ["SUPER_ADMIN", "ADMIN", "AGENCY"].includes(user?.role || "")
                    ? async () => {
                        if (!client) return;
                        setViewClientSaving(true);
                        try {
                          const data = formStateToUpdatePayload(viewClientForm, {
                            includeStatus: user?.role === "SUPER_ADMIN" || user?.role === "ADMIN",
                            includeManagedServiceFields: user?.role === "SUPER_ADMIN",
                          });
                          await dispatch(updateClient({ id: client.id, data }) as any).unwrap();
                          setClient((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  name: viewClientForm.name,
                                  domain: viewClientForm.domain,
                                  industry: viewClientForm.industry === "Other" ? viewClientForm.industryOther : viewClientForm.industry,
                                }
                              : null
                          );
                          setShowViewClientModal(false);
                          toast.success("Client updated successfully.");
                        } catch (e: any) {
                          toast.error(e?.message || "Failed to update client.");
                        } finally {
                          setViewClientSaving(false);
                        }
                      }
                    : undefined
                }
                saving={viewClientSaving}
              />

              {/* GA4 Property Selection Modal */}
              {showGA4Modal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">Select GA4 Property</h3>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            handleFetchGA4Properties(false, true); // Don't show modal again, but force refresh
                          }}
                          disabled={loadingProperties}
                          className="text-gray-400 hover:text-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Refresh properties list to see newly added GA4 access"
                        >
                          <RefreshCw className={`h-5 w-5 ${loadingProperties ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={() => {
                            setShowGA4Modal(false);
                            setGa4PropertyId("");
                            setGa4Properties([]);
                          }}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Select a Google Analytics 4 property to connect. These are all the properties accessible with your Google account. Click the refresh icon to update the list if you recently gained access to new properties.
                    </p>
                    
                    {loadingProperties ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
                        <span className="ml-2 text-gray-600">Loading properties...</span>
                      </div>
                    ) : ga4Properties.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <p className="font-medium mb-2">No GA4 properties found.</p>
                        <p className="text-sm mb-2">Please make sure you have access to at least one GA4 property.</p>
                        <p className="text-xs mb-4 text-gray-400">Note: Only GA4 properties are shown. Universal Analytics properties are not supported.</p>
                        <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                          <p className="text-sm font-medium text-gray-700 mb-2">Can't find your property?</p>
                          <p className="text-xs text-gray-600 mb-3">If you know your GA4 Property ID, you can enter it manually below:</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={ga4PropertyId}
                              onChange={(e) => setGa4PropertyId(e.target.value)}
                              placeholder="Enter Property ID (e.g., 502875974)"
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                            <button
                              onClick={() => handleSubmitPropertyId()}
                              disabled={!ga4PropertyId.trim() || ga4Connecting}
                              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                            >
                              Connect
                            </button>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">Find your Property ID in Google Analytics: Admin → Property Settings</p>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Search Bar */}
                        <div className="mb-4">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Search by property name, account, or property ID..."
                              value={ga4PropertySearch}
                              onChange={(e) => setGa4PropertySearch(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                          </div>
                        </div>
                        
                        {(() => {
                          // Filter and sort properties
                          const filtered = ga4Properties.filter((property) => {
                            if (!ga4PropertySearch.trim()) return true;
                            const searchLower = ga4PropertySearch.toLowerCase();
                            return (
                              property.propertyName.toLowerCase().includes(searchLower) ||
                              property.accountName.toLowerCase().includes(searchLower) ||
                              property.propertyId.includes(searchLower) ||
                              property.displayName.toLowerCase().includes(searchLower)
                            );
                          });
                          
                          // Sort alphabetically by property name
                          const sorted = filtered.sort((a, b) => 
                            a.propertyName.localeCompare(b.propertyName)
                          );

                          if (sorted.length === 0 && ga4PropertySearch.trim()) {
                            return (
                              <div className="text-center py-8 text-gray-500 border border-gray-200 rounded-lg">
                                <p>No properties found matching "{ga4PropertySearch}"</p>
                                <p className="text-sm mt-2">Try a different search term</p>
                              </div>
                            );
                          }

                          return (
                            <div className="flex-1 overflow-y-auto mb-4 border border-gray-200 rounded-lg">
                              <div className="divide-y divide-gray-200">
                                {sorted.map((property) => (
                                  <button
                                    key={property.propertyId}
                                    onClick={() => handleSubmitPropertyId(property.propertyId)}
                                    disabled={ga4Connecting}
                                    className="w-full text-left p-4 hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex-1">
                                        <div className="font-medium text-gray-900">{property.propertyName}</div>
                                        <div className="text-sm text-gray-500 mt-1">
                                          Account: {property.accountName}
                                        </div>
                                        <div className="text-xs text-gray-400 mt-1">
                                          Property ID: {property.propertyId}
                                        </div>
                                      </div>
                                      {ga4Connecting ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                                      ) : (
                                        <div className="text-primary-600">
                                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                          </svg>
                                        </div>
                                      )}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                        
                        {/* Manual Property ID Input (fallback) */}
                        <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                          <p className="text-xs font-medium text-gray-700 mb-2">Can't find your property in the list?</p>
                          <p className="text-xs text-gray-600 mb-2">You can manually enter your GA4 Property ID:</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={ga4PropertyId}
                              onChange={(e) => setGa4PropertyId(e.target.value)}
                              placeholder="Enter Property ID (e.g., 502875974)"
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                            <button
                              onClick={() => handleSubmitPropertyId()}
                              disabled={!ga4PropertyId.trim() || ga4Connecting}
                              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                            >
                              Connect
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-end mt-4">
                          <button
                            onClick={() => {
                              setShowGA4Modal(false);
                              setGa4PropertyId("");
                              setGa4Properties([]);
                              setGa4PropertySearch("");
                            }}
                            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
          </>
          )}
        </div>
      ) : (
        <div className="px-8 py-8">
          {loading ? (
            <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">Loading client data...</div>
          ) : (
            <>
              {!reportOnly && activeTab === "keywords" && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Keywords</h2>
                  </div>
                  <ClientKeywordsManager clientId={clientId} readOnly={includedClientReadOnly} />
                </div>
              )}
              {!reportOnly && activeTab === "integration" && (
                <div className="space-y-8 max-w-3xl">
                  <h2 className="text-xl font-semibold text-gray-900">Integrations</h2>
                  <p className="text-sm text-gray-600">Connect Google Analytics 4 and Google Ads for this client. When Google Ads is connected, the PPC tab appears in the Dashboard.</p>

                  {/* GA4 */}
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-primary-600" />
                      Google Analytics 4 (GA4)
                    </h3>
                    {ga4StatusLoading ? (
                      <div className="h-20 bg-gray-50 rounded-lg animate-pulse" />
                    ) : ga4Connected === true ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-emerald-800">GA4 is connected</p>
                          <p className="text-xs text-gray-500 mt-1">Traffic and analytics data come from your connected property.</p>
                        </div>
                        <button
                          onClick={handleDisconnectGA4}
                          disabled={ga4Connecting}
                          className="bg-white border border-emerald-300 text-emerald-800 px-3 py-1.5 rounded-lg text-sm hover:bg-emerald-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {ga4Connecting ? "Disconnecting..." : "Disconnect GA4"}
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm text-gray-600 mb-3">Connect GA4 to view real traffic and analytics on the Dashboard.</p>
                        <button
                          onClick={handleConnectGA4}
                          disabled={ga4Connecting}
                          className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {ga4Connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          {ga4Connecting ? "Connecting..." : "Connect GA4"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Google Ads (PPC) */}
                  <div className="bg-white border border-gray-200 rounded-xl p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-primary-600" />
                      Google Ads (PPC)
                    </h3>
                    {googleAdsStatusLoading ? (
                      <div className="h-20 bg-gray-50 rounded-lg animate-pulse" />
                    ) : googleAdsConnected === false && googleAdsHasTokens ? (
                      <div>
                        <p className="text-sm text-gray-600 mb-3">Select a Google Ads account to finish connecting. The PPC tab will appear in the Dashboard once connected.</p>
                        <button
                          onClick={handleFetchGoogleAdsCustomers}
                          disabled={loadingGoogleAdsCustomers}
                          className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {loadingGoogleAdsCustomers ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
                          {loadingGoogleAdsCustomers ? "Loading..." : "Select Google Ads account"}
                        </button>
                      </div>
                    ) : googleAdsConnected === false ? (
                      <div>
                        <p className="text-sm text-gray-600 mb-3">Connect Google Ads to view PPC campaigns and the PPC tab in the Dashboard.</p>
                        <button
                          onClick={handleConnectGoogleAds}
                          disabled={googleAdsConnecting}
                          className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {googleAdsConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
                          {googleAdsConnecting ? "Connecting..." : "Connect Google Ads"}
                        </button>
                      </div>
                    ) : googleAdsConnected === true ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-emerald-800">Google Ads is connected</p>
                          {googleAdsAccountEmail && <p className="text-xs text-gray-500 mt-1">Account: {googleAdsAccountEmail}</p>}
                          <p className="text-xs text-gray-500 mt-1">The PPC tab is visible in the Dashboard.</p>
                        </div>
                        <button
                          onClick={handleDisconnectGoogleAds}
                          disabled={googleAdsConnecting}
                          className="bg-white border border-red-300 text-red-700 px-3 py-1.5 rounded-lg text-sm hover:bg-red-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {googleAdsConnecting ? "Disconnecting..." : "Disconnect"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
              {!reportOnly && activeTab === "web-design" && (
                <WebDesignWorkspace
                  embedded
                  clientId={clientId}
                  initialProjectId={navState?.projectId}
                  initialPageId={navState?.pageId}
                />
              )}
              {!reportOnly && activeTab === "users" && (
                <div className="space-y-6">
                  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-amber-800/90 bg-amber-50/80 rounded-lg px-3 py-2 border border-amber-200">
                          Showing {clientUsers.length} of {clientUsers.length} Rows
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={includedClientReadOnly}
                        className="p-2 rounded-full hover:bg-gray-100 text-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={includedClientReadOnly ? "Included clients are view-only" : "More"}
                        onClick={() => {
                          if (!includedClientReadOnly) toast("More actions coming soon.");
                        }}
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full">
                        <thead>
                          <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-400 first:border-l-0">Name</th>
                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider border-l-4 border-emerald-300">Email</th>
                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Role</th>
                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Status</th>
                            <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Last Login</th>
                            <th className="px-6 py-3.5 text-right text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {clientUsersLoading ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500 bg-gray-50/50">
                                Loading users...
                              </td>
                            </tr>
                          ) : clientUsersError ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-8 text-center text-sm text-rose-600 bg-rose-50/50">
                                {clientUsersError}
                              </td>
                            </tr>
                          ) : clientUsers.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500 bg-amber-50/50">
                                No users yet.
                              </td>
                            </tr>
                          ) : (
                            clientUsers.map((u, index) => {
                              const initials = (u.name || u.email || "?")
                                .split(" ")
                                .map((p) => p.trim()[0] || "")
                                .join("")
                                .slice(0, 2)
                                .toUpperCase();
                              const lastLogin = u.lastLoginAt
                                ? new Date(u.lastLoginAt).toLocaleString()
                                : "Never";
                              return (
                                <tr key={u.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center gap-3">
                                      <div className="h-9 w-9 rounded-full bg-primary-100 flex items-center justify-center text-xs font-semibold text-primary-800">
                                        {initials}
                                      </div>
                                      <div className="text-sm font-medium text-gray-900">
                                        {u.name || u.email}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-emerald-800/90">{u.email}</td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-slate-700 text-white">
                                      {u.role}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span
                                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                        u.status === "ACTIVE"
                                          ? "bg-emerald-100 text-emerald-700"
                                          : "bg-amber-100 text-amber-700"
                                      }`}
                                    >
                                      {u.status}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-violet-800/90">{lastLogin}</td>
                                  <td className="px-6 py-4 whitespace-nowrap text-right">
                                    {u.role === "CLIENT" && !includedClientReadOnly ? (
                                      <div className="relative inline-block">
                                        <button
                                          type="button"
                                          className="inline-flex items-center justify-center h-9 w-9 rounded-lg p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const el = e.currentTarget as unknown as HTMLElement;
                                            clientUserMoreMenuButtonRef.current = el;
                                            const r = el.getBoundingClientRect();
                                            setClientUserMoreMenu((prev) =>
                                              prev?.id === u.id
                                                ? null
                                                : {
                                                    id: u.id,
                                                    rect: {
                                                      top: r.top,
                                                      left: r.left,
                                                      right: r.right,
                                                      bottom: r.bottom,
                                                      width: r.width,
                                                      height: r.height,
                                                    },
                                                  }
                                            );
                                          }}
                                          title="More"
                                        >
                                          <MoreVertical className="h-5 w-5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-gray-300">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {!includedClientReadOnly &&
                    clientUserMoreMenu &&
                    typeof window !== "undefined" &&
                    createPortal(
                      (() => {
                        const menuWidth = 224; // 14rem (w-56)
                        const menuMaxHeight = 320;
                        const gap = 8;
                        const u = clientUsers.find((x) => x.id === clientUserMoreMenu.id) || null;

                        const rightEdge = Math.min(
                          Math.max(clientUserMoreMenu.rect.right, menuWidth + gap),
                          window.innerWidth - gap
                        );
                        const top = Math.min(
                          clientUserMoreMenu.rect.bottom + gap,
                          Math.max(gap, window.innerHeight - gap - menuMaxHeight)
                        );

                        return (
                          <div
                            className="fixed inset-0 z-[60]"
                            onClick={() => setClientUserMoreMenu(null)}
                          >
                            <div
                              className="absolute rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden"
                              style={{
                                top,
                                left: rightEdge,
                                transform: "translateX(-100%)",
                                width: menuWidth,
                                maxHeight: menuMaxHeight,
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                onClick={() => {
                                  if (u) openEditClientUserProfile(u);
                                  else toast.error("Unable to load user.");
                                  setClientUserMoreMenu(null);
                                }}
                              >
                                Edit Profile
                              </button>
                              <button
                                type="button"
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                onClick={() => {
                                  if (u) void openEditClientAccess(u);
                                  else toast.error("Unable to load user.");
                                  setClientUserMoreMenu(null);
                                }}
                              >
                                Edit Client Access
                              </button>
                              <button
                                type="button"
                                disabled
                                title="Edit permissions is coming soon."
                                className="w-full text-left px-4 py-2 text-sm text-gray-400 cursor-not-allowed"
                              >
                                Edit Permissions (Coming soon)
                              </button>
                              <div className="h-px bg-gray-100" />
                              {u?.status === "PENDING" && (
                                <button
                                  type="button"
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                  onClick={() => {
                                    if (u) void resendInviteForClientUser(u);
                                    else toast.error("Unable to load user.");
                                    setClientUserMoreMenu(null);
                                  }}
                                >
                                  Send Invite
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={u?.status !== "ACTIVE"}
                                title={u?.status === "ACTIVE" ? "Login as user" : "Only active users can be logged in"}
                                className={`w-full text-left px-4 py-2 text-sm ${
                                  u?.status === "ACTIVE"
                                    ? "text-gray-700 hover:bg-gray-50"
                                    : "text-gray-400 cursor-not-allowed"
                                }`}
                                onClick={() => {
                                  if (u) void loginAsClientUser(u);
                                  else toast.error("Unable to load user.");
                                  setClientUserMoreMenu(null);
                                }}
                              >
                                Login as user
                              </button>
                              <div className="h-px bg-gray-100" />
                              <button
                                type="button"
                                className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50"
                                onClick={() => {
                                  if (!u) {
                                    toast.error("Unable to load user.");
                                    setClientUserMoreMenu(null);
                                    return;
                                  }
                                  setRemoveClientUserConfirm({
                                    open: true,
                                    userId: u.userId,
                                    label: u.name || u.email,
                                  });
                                  setClientUserMoreMenu(null);
                                }}
                              >
                                Remove user
                              </button>
                            </div>
                          </div>
                        );
                      })(),
                      document.body
                    )}

                  {inviteClientUsersModalOpen &&
                    createPortal(
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div
                          className="absolute inset-0 bg-black/50"
                          onClick={() => !invitingClientUsers && setInviteClientUsersModalOpen(false)}
                        />
                        <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border-2 border-primary-200 overflow-hidden">
                          <div className="px-8 py-6 bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200 text-center">
                            <h2 className="text-3xl font-bold text-primary-900">Add Client User(s)</h2>
                            <p className="mt-3 text-sm text-primary-700/90">
                              Fill in the email of the users you would like to create. You can choose to send invitation emails now, or send them manually later to complete the signup process.
                            </p>
                          </div>

                          <div className="px-8 py-8 bg-white">
                            {inviteClientUsersAllClientsError && (
                              <div className="mb-4 rounded-lg border-2 border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700 font-medium">
                                {inviteClientUsersAllClientsError}
                              </div>
                            )}

                            <div className="space-y-4">
                              {inviteClientUsersRows.map((row) => (
                                <div key={row.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-start p-4 rounded-xl bg-gray-50/50 border border-gray-100">
                                  <div>
                                    <label className="block text-sm font-semibold text-primary-800 mb-2">Email</label>
                                    <input
                                      type="email"
                                      value={row.email}
                                      onChange={(e) =>
                                        setInviteClientUsersRows((prev) =>
                                          prev.map((r) => (r.id === row.id ? { ...r, email: e.target.value } : r))
                                        )
                                      }
                                      placeholder="Type User's Email"
                                      className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-400 transition-shadow"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-sm font-semibold text-emerald-800 mb-2">Clients</label>
                                    <button
                                      type="button"
                                      className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white flex items-center justify-between gap-2 hover:bg-emerald-50 hover:border-emerald-300 focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 transition-colors"
                                      disabled={inviteClientUsersAllClientsLoading}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const el = e.currentTarget as unknown as HTMLElement;
                                        inviteClientUsersClientsMenuButtonRef.current = el;
                                        const r = el.getBoundingClientRect();
                                        setInviteClientUsersClientsMenu((prev) =>
                                          prev?.rowId === row.id
                                            ? null
                                            : {
                                                rowId: row.id,
                                                rect: {
                                                  top: r.top,
                                                  left: r.left,
                                                  right: r.right,
                                                  bottom: r.bottom,
                                                  width: r.width,
                                                  height: r.height,
                                                },
                                              }
                                        );
                                      }}
                                    >
                                      <span className="truncate text-left">
                                        {row.clientIds.length === 0
                                          ? "Select..."
                                          : row.clientIds.length === 1
                                            ? (inviteClientUsersAllClients.find((c) => c.id === row.clientIds[0])?.name ||
                                                "1 client selected")
                                            : `${row.clientIds.length} clients selected`}
                                      </span>
                                      <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
                                    </button>
                                  </div>

                                  <div className="pt-7">
                                    {inviteClientUsersRows.length > 1 && (
                                      <button
                                        type="button"
                                        className="h-10 w-10 inline-flex items-center justify-center rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                                        title="Remove"
                                        onClick={() =>
                                          setInviteClientUsersRows((prev) => prev.filter((r) => r.id !== row.id))
                                        }
                                        disabled={invitingClientUsers}
                                      >
                                        <X className="h-5 w-5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="mt-6 flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() =>
                                  setInviteClientUsersRows((prev) => [
                                    ...prev,
                                    {
                                      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                                      email: "",
                                      clientIds: clientId ? [clientId] : [],
                                    },
                                  ])
                                }
                                className="px-4 py-2.5 rounded-lg border-2 border-primary-200 text-primary-700 font-medium hover:bg-primary-50 hover:border-primary-300 inline-flex items-center gap-2 transition-colors"
                              >
                                <Plus className="h-4 w-4" />
                                Add Client User
                              </button>

                              <label className="inline-flex items-center gap-2 text-sm font-medium text-violet-800">
                                <input
                                  type="checkbox"
                                  checked={inviteClientUsersViaEmail}
                                  onChange={(e) => setInviteClientUsersViaEmail(e.target.checked)}
                                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                />
                                Invite users via email
                              </label>
                            </div>

                            <div className="mt-10 flex items-center justify-between pt-4 border-t border-gray-200">
                              <button
                                type="button"
                                disabled={invitingClientUsers}
                                onClick={() => setInviteClientUsersModalOpen(false)}
                                className="px-5 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 disabled:opacity-60 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={invitingClientUsers}
                                onClick={() => void submitInviteClientUsers()}
                                className="px-10 py-3 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60 transition-colors shadow-sm"
                              >
                                {invitingClientUsers ? "Sending..." : "Next"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}

                  {inviteClientUsersClientsMenu &&
                    typeof window !== "undefined" &&
                    createPortal(
                      (() => {
                        const menuWidth = Math.max(260, Math.min(420, inviteClientUsersClientsMenu.rect.width));
                        const menuMaxHeight = 360;
                        const gap = 8;
                        const left = Math.min(
                          Math.max(inviteClientUsersClientsMenu.rect.left, gap),
                          window.innerWidth - gap - menuWidth
                        );
                        const top = Math.min(
                          inviteClientUsersClientsMenu.rect.bottom + gap,
                          Math.max(gap, window.innerHeight - gap - menuMaxHeight)
                        );

                        const rowId = inviteClientUsersClientsMenu.rowId;
                        const active = inviteClientUsersRows.find((r) => r.id === rowId);
                        const selected = new Set(active?.clientIds || []);

                        const toggle = (clientId: string) => {
                          setInviteClientUsersRows((prev) =>
                            prev.map((r) => {
                              if (r.id !== rowId) return r;
                              const next = new Set(r.clientIds || []);
                              if (next.has(clientId)) next.delete(clientId);
                              else next.add(clientId);
                              return { ...r, clientIds: Array.from(next) };
                            })
                          );
                        };

                        return (
                          <div className="fixed inset-0 z-[70]" onClick={() => setInviteClientUsersClientsMenu(null)}>
                            <div
                              className="absolute rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden"
                              style={{ top, left, width: menuWidth, maxHeight: menuMaxHeight }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                                <div className="text-sm font-semibold text-gray-900">Select Clients</div>
                                <button
                                  type="button"
                                  className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500"
                                  onClick={() => setInviteClientUsersClientsMenu(null)}
                                  aria-label="Close"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                              <div className="max-h-[300px] overflow-y-auto">
                                {inviteClientUsersAllClients.map((c) => (
                                  <label
                                    key={c.id}
                                    className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selected.has(c.id)}
                                      onChange={() => toggle(c.id)}
                                    />
                                    <span className="truncate">{c.name}</span>
                                  </label>
                                ))}
                                {inviteClientUsersAllClients.length === 0 && (
                                  <div className="px-4 py-6 text-sm text-gray-500">No clients found.</div>
                                )}
                              </div>
                              <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                                <button
                                  type="button"
                                  className="text-sm text-gray-600 hover:text-gray-900"
                                  onClick={() =>
                                    setInviteClientUsersRows((prev) =>
                                      prev.map((r) => (r.id === rowId ? { ...r, clientIds: [] } : r))
                                    )
                                  }
                                >
                                  Clear
                                </button>
                                <button
                                  type="button"
                                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700"
                                  onClick={() => setInviteClientUsersClientsMenu(null)}
                                >
                                  Done
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })(),
                      document.body
                    )}

                  {editClientUserProfileOpen &&
                    editClientUserProfileUser &&
                    createPortal(
                      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
                        <div
                          className="absolute inset-0 bg-black/50"
                          onClick={() => !savingClientUserProfile && setEditClientUserProfileOpen(false)}
                        />
                        <div className="relative w-full max-w-5xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
                          <button
                            type="button"
                            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 inline-flex items-center justify-center"
                            onClick={() => !savingClientUserProfile && setEditClientUserProfileOpen(false)}
                            aria-label="Close"
                          >
                            <X className="h-5 w-5" />
                          </button>

                          <div className="px-10 py-10">
                            <h2 className="text-3xl font-bold text-gray-900 text-center">
                              What are the login details for this user?
                            </h2>
                            <p className="mt-3 text-sm text-gray-600 text-center">
                              Fill in the contact details for this user and optionally upload a picture
                            </p>

                            <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">First Name</label>
                                <input
                                  type="text"
                                  value={editClientUserFirstName}
                                  onChange={(e) => setEditClientUserFirstName(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Last Name</label>
                                <input
                                  type="text"
                                  value={editClientUserLastName}
                                  onChange={(e) => setEditClientUserLastName(e.target.value)}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                                <input
                                  type="email"
                                  value={editClientUserProfileUser.email}
                                  disabled
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50"
                                />
                              </div>

                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <label className="block text-sm font-medium text-gray-700">Password</label>
                                  <button
                                    type="button"
                                    className="text-sm text-primary-600 hover:text-primary-700"
                                    onClick={() => generateRandomPassword()}
                                  >
                                    Generate
                                  </button>
                                </div>
                                <div className="relative">
                                  <input
                                    type={editClientUserPasswordVisible ? "text" : "password"}
                                    value={editClientUserPassword}
                                    onChange={(e) => setEditClientUserPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-10"
                                  />
                                  <button
                                    type="button"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                    onClick={() => setEditClientUserPasswordVisible((v) => !v)}
                                    aria-label="Toggle password visibility"
                                  >
                                    {editClientUserPasswordVisible ? (
                                      <EyeOff className="h-4 w-4" />
                                    ) : (
                                      <Eye className="h-4 w-4" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Email Login Credentials</label>
                                <select
                                  value={editClientUserEmailCredentials}
                                  onChange={(e) => setEditClientUserEmailCredentials(e.target.value as any)}
                                  disabled={!editClientUserPassword.trim()}
                                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50"
                                >
                                  <option value="NO">No</option>
                                  <option value="YES">Yes</option>
                                </select>
                                {!editClientUserPassword.trim() && (
                                  <p className="mt-1 text-xs text-gray-500">Enter a password to enable this option.</p>
                                )}
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">Photo</label>
                                <input
                                  ref={editClientUserPhotoInputRef}
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => void handleClientUserPhotoSelected(e)}
                                />
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
                                    {editClientUserPhotoUrl ? (
                                      <img
                                        src={editClientUserPhotoUrl}
                                        alt="User profile"
                                        className="h-10 w-10 rounded-full object-cover"
                                      />
                                    ) : (
                                      <Users className="h-5 w-5" />
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    disabled={uploadingClientUserPhoto || savingClientUserProfile}
                                    title="Upload profile picture"
                                    className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
                                    onClick={() => triggerClientUserPhotoPicker()}
                                  >
                                    {uploadingClientUserPhoto ? "Uploading..." : "Upload New Picture"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!editClientUserPhotoUrl || uploadingClientUserPhoto || savingClientUserProfile}
                                    title="Delete profile picture"
                                    className="text-sm text-rose-600 hover:text-rose-700 disabled:text-rose-300 disabled:cursor-not-allowed"
                                    onClick={() => setEditClientUserPhotoUrl(null)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            </div>

                            <div className="mt-12">
                              <button
                                type="button"
                                disabled={savingClientUserProfile}
                                onClick={() => void saveClientUserProfile()}
                                className="px-10 py-3 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
                              >
                                {savingClientUserProfile ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}

                  {editClientAccessOpen &&
                    editClientAccessUser &&
                    createPortal(
                      <div className="fixed inset-0 z-[85] flex items-center justify-center p-4">
                        <div
                          className="absolute inset-0 bg-black/50"
                          onClick={() => !editClientAccessSaving && setEditClientAccessOpen(false)}
                        />
                        <div className="relative w-full max-w-5xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden">
                          <button
                            type="button"
                            className="absolute top-4 right-4 h-10 w-10 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 inline-flex items-center justify-center"
                            onClick={() => !editClientAccessSaving && setEditClientAccessOpen(false)}
                            aria-label="Close"
                          >
                            <X className="h-5 w-5" />
                          </button>

                          <div className="px-10 py-10">
                            <h2 className="text-3xl font-bold text-gray-900 text-center">
                              Which clients should this user have access to?
                            </h2>
                            <p className="mt-3 text-sm text-gray-600 text-center">
                              Choose to restrict this user to specific clients in order to control what they have access to
                            </p>

                            <div className="mt-8 border-t border-gray-200 pt-8">
                              <div className="border border-gray-200 rounded-xl overflow-hidden">
                                <div className="px-4 py-3 border-b border-gray-200 bg-white">
                                  <input
                                    type="text"
                                    value={editClientAccessSearch}
                                    onChange={(e) => setEditClientAccessSearch(e.target.value)}
                                    placeholder="Search..."
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                                  />
                                </div>

                                <div className="max-h-[360px] overflow-y-auto">
                                  {editClientAccessLoading ? (
                                    <div className="px-6 py-10 text-center text-sm text-gray-500">Loading clients...</div>
                                  ) : (
                                    editClientAccessClients
                                      .filter((c) => {
                                        const q = editClientAccessSearch.trim().toLowerCase();
                                        if (!q) return true;
                                        return (
                                          c.name.toLowerCase().includes(q) ||
                                          String(c.domain || "").toLowerCase().includes(q)
                                        );
                                      })
                                      .map((c) => {
                                        const checked = editClientAccessSelected.has(c.id);
                                        return (
                                          <button
                                            key={c.id}
                                            type="button"
                                            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                                            onClick={() =>
                                              setEditClientAccessSelected((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(c.id)) next.delete(c.id);
                                                else next.add(c.id);
                                                return next;
                                              })
                                            }
                                          >
                                            <div className="flex items-center gap-4">
                                              <div
                                                className={`h-8 w-8 rounded-full flex items-center justify-center border ${
                                                  checked ? "bg-primary-600 border-primary-600" : "bg-white border-gray-300"
                                                }`}
                                              >
                                                {checked && <span className="text-white text-sm font-bold">✓</span>}
                                              </div>
                                              <div className="text-left">
                                                <div className="text-sm font-medium text-gray-900">{c.name}</div>
                                              </div>
                                            </div>
                                            <div className="text-sm text-gray-400 truncate max-w-[50%]">
                                              {c.domain ? `https://${c.domain}/` : ""}
                                            </div>
                                          </button>
                                        );
                                      })
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="mt-10">
                              <button
                                type="button"
                                disabled={editClientAccessSaving}
                                onClick={() => void saveEditClientAccess()}
                                className="px-10 py-3 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
                              >
                                {editClientAccessSaving ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}

                  {removeClientUserConfirm.open && (
                    <ConfirmDialog
                      isOpen={removeClientUserConfirm.open}
                      title="Remove user"
                      message={`Remove ${removeClientUserConfirm.label || "this user"} from this client?`}
                      confirmText="Remove"
                      cancelText="Cancel"
                      onConfirm={() => void removeClientUser()}
                      onClose={() => setRemoveClientUserConfirm({ open: false, userId: null, label: null })}
                      variant="danger"
                    />
                  )}
                </div>
              )}

              {(reportOnly || activeTab === "report" || localMapReportOpen) && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h2 className="text-xl font-semibold text-gray-900">Reports</h2>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-full" aria-label="Client reports table">
                        <thead>
                          <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-400 first:border-l-0">Name</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider border-l-4 border-emerald-300">Type</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Last Generated</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Status</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Recipients</th>
                            <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {reportLoading ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500 bg-gray-50/50">Loading report...</td>
                            </tr>
                          ) : reportError ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-8 text-center text-sm text-rose-600 bg-rose-50/50">{reportError}</td>
                            </tr>
                          ) : reportRows.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500 bg-amber-50/50">
                                No reports yet for this client.
                              </td>
                            </tr>
                          ) : (
                            reportRows.map((reportRow) => (
                            <tr key={reportRow.id} className="bg-white hover:bg-primary-50/50 transition-colors">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{reportRow.name}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-emerald-800/90">
                                <div className="inline-flex items-center gap-2">
                                  <span>{reportRow.type}</span>
                                  <span
                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                      reportRow.scheduleKind === "local_map"
                                        ? "bg-violet-100 text-violet-700"
                                        : reportRow.scheduleKind === "ppc"
                                        ? "bg-sky-100 text-sky-700"
                                        : reportRow.scheduleKind === "campaign_wins"
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-emerald-100 text-emerald-700"
                                    }`}
                                  >
                                    {reportRow.scheduleKind === "local_map"
                                      ? "Local Map"
                                      : reportRow.scheduleKind === "ppc"
                                      ? "PPC"
                                      : reportRow.scheduleKind === "campaign_wins"
                                      ? "Campaign Wins"
                                      : "SEO"}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{reportRow.lastGenerated}</td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span
                                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getReportStatusBadgeClass(reportRow.status)}`}
                                >
                                  {toDisplayReportStatus(reportRow.status)}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-sm text-violet-800/90 max-w-xs break-words">
                                {reportRow.recipients.join(", ")}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <div className="inline-flex items-center gap-1 justify-end">
                                  <button
                                    onClick={
                                      reportRow.scheduleKind === "campaign_wins"
                                        ? handleViewCampaignWinsHtml
                                        : reportRow.scheduleKind === "local_map"
                                        ? () => void handleViewLocalMapReport()
                                        : () => handleViewReport(reportRow)
                                    }
                                    className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                    title={
                                      reportRow.scheduleKind === "campaign_wins"
                                        ? "View HTML"
                                        : reportRow.scheduleKind === "local_map"
                                        ? "View Local Map report"
                                        : "View report"
                                    }
                                    aria-label={
                                      reportRow.scheduleKind === "campaign_wins"
                                        ? "View HTML"
                                        : reportRow.scheduleKind === "local_map"
                                        ? "View Local Map report"
                                        : "View report"
                                    }
                                  >
                                    <Eye className="h-4 w-4" />
                                  </button>
                                  {reportRow.scheduleKind !== "campaign_wins" && reportRow.scheduleKind !== "local_map" && (
                                    <button
                                      onClick={handleShare}
                                      className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                      title="Share dashboard"
                                      aria-label="Share dashboard"
                                    >
                                      <Share2 className="h-4 w-4" />
                                    </button>
                                  )}
                                  {reportRow.scheduleKind === "ppc" ? (
                                    <>
                                      <button
                                        onClick={handleSendPpcReportNow}
                                        disabled={sendingPpcReport || !canModifyClientSettings}
                                        className="p-2 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        title={canModifyClientSettings ? "Send PPC report via email" : "Included clients are view-only"}
                                        aria-label="Send PPC report"
                                      >
                                        <Send className="h-4 w-4" />
                                      </button>
                                      <button
                                        onClick={handleDeletePpcReport}
                                        disabled={!canModifyClientSettings || !ppcScheduleMeta.scheduleId}
                                        className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        title={canModifyClientSettings ? "Delete report" : "Included clients are view-only"}
                                        aria-label="Delete report"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </>
                                  ) : reportRow.scheduleKind === "campaign_wins" ? (
                                    <>
                                      <button
                                        onClick={handleSendCampaignWinsNow}
                                        disabled={sendingCampaignWinsReport || !canModifyClientSettings}
                                        className="p-2 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        title={canModifyClientSettings ? "Instant send Campaign Wins report" : "Included clients are view-only"}
                                        aria-label="Instant send Campaign Wins report"
                                      >
                                        <Send className="h-4 w-4" />
                                      </button>
                                      <button
                                        onClick={handleDeleteCampaignWinsReport}
                                        disabled={!canModifyClientSettings}
                                        className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        title={canModifyClientSettings ? "Delete Campaign Wins report" : "Included clients are view-only"}
                                        aria-label="Delete Campaign Wins report"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </>
                                  ) : reportRow.scheduleKind === "local_map" ? (
                                    <>
                                      <button
                                        onClick={handleSendLocalMapReportNow}
                                        disabled={sendingLocalMapReport || !canModifyClientSettings}
                                        className="p-2 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        title={canModifyClientSettings ? "Send Local Map report via email" : "Included clients are view-only"}
                                        aria-label="Send Local Map report"
                                      >
                                        <Send className="h-4 w-4" />
                                      </button>
                                      <button
                                        onClick={handleDeleteLocalMapReport}
                                        disabled={!canModifyClientSettings || !localMapScheduleMeta.scheduleId}
                                        className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        title={canModifyClientSettings ? "Delete report" : "Included clients are view-only"}
                                        aria-label="Delete report"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        onClick={handleSendReport}
                                        disabled={sendingReport || !canModifyClientSettings}
                                        className="p-2 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        title={canModifyClientSettings ? "Send report via email" : "Included clients are view-only"}
                                        aria-label="Send report"
                                      >
                                        <Send className="h-4 w-4" />
                                      </button>
                                      <button
                                        onClick={handleDeleteReport}
                                        disabled={!canModifyClientSettings}
                                        className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                        title={canModifyClientSettings ? "Delete report" : "Included clients are view-only"}
                                        aria-label="Delete report"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

          {/* Client-specific Create Report & Schedule Modal */}
          {showClientReportModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col border-2 border-primary-200 shadow-xl">
                <div className="flex-shrink-0 flex justify-between items-center px-6 py-4 bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                  <h2 className="text-xl font-bold text-primary-900">Create Report</h2>
                  <button
                    onClick={() => setShowClientReportModal(false)}
                    className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-100 transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <p className="text-sm text-primary-700/90">
                    Configure report type and recipients.
                  </p>
                  <div>
                    <label className="block text-sm font-semibold text-emerald-800 mb-2">Report Type</label>
                    <select
                      value={clientReportFrequency}
                      onChange={(e) =>
                        setClientReportFrequency(
                          e.target.value as
                            | "weekly"
                            | "biweekly"
                            | "monthly"
                            | "ppc_weekly"
                            | "ppc_biweekly"
                            | "ppc_monthly"
                            | "campaign_wins"
                            | "local_map_biweekly"
                            | "local_map_monthly"
                        )
                      }
                      className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 transition-shadow"
                    >
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Biweekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="ppc_weekly">PPC - Weekly</option>
                      <option value="ppc_biweekly">PPC - Biweekly</option>
                      <option value="ppc_monthly">PPC - Monthly</option>
                      <option value="local_map_biweekly">Local Map Rankings - Biweekly</option>
                      <option value="local_map_monthly">Local Map Rankings - Monthly</option>
                      <option value="campaign_wins">Campaign Wins Report</option>
                    </select>
                  </div>
                  {clientReportFrequency === "campaign_wins" && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      <p className="font-semibold mb-1">Campaign Wins Report</p>
                      <p>
                        Campaign Wins reports are sent automatically when meaningful milestones are reached — new page 1 rankings, traffic growth, work completed, and more.
                        We&apos;ll never send the same win twice, and nothing goes out if there&apos;s nothing to celebrate.
                      </p>
                    </div>
                  )}
                  {clientReportFrequency !== "campaign_wins" &&
                  clientReportFrequency !== "monthly" &&
                  clientReportFrequency !== "local_map_monthly" &&
                  clientReportFrequency !== "ppc_monthly" ? (
                    <div>
                      <label className="block text-sm font-semibold text-amber-800 mb-2">Day of Week</label>
                      <select
                        value={clientReportDayOfWeek}
                        onChange={(e) => setClientReportDayOfWeek(Number(e.target.value))}
                        className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-400 transition-shadow"
                      >
                        {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
                          (day, index) => (
                            <option key={index} value={index}>
                              {day}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  ) : clientReportFrequency === "monthly" || clientReportFrequency === "local_map_monthly" || clientReportFrequency === "ppc_monthly" ? (
                    <div>
                      <label className="block text-sm font-semibold text-amber-800 mb-2">Day of Month</label>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={clientReportDayOfMonth}
                        onChange={(e) => setClientReportDayOfMonth(Number(e.target.value))}
                        className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-400 transition-shadow"
                      />
                    </div>
                  ) : null}
                  {clientReportFrequency !== "campaign_wins" &&
                    !clientReportFrequency.startsWith("local_map_") && (
                  <div>
                    <label className="block text-sm font-semibold text-violet-800 mb-2">Time of Day</label>
                    <input
                      type="time"
                      value={clientReportTimeOfDay}
                      onChange={(e) => setClientReportTimeOfDay(e.target.value)}
                      className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-400 transition-shadow"
                    />
                  </div>
                  )}
                  <div>
                    <label className="block text-sm font-semibold text-primary-800 mb-2">
                      Recipients (comma-separated emails)
                    </label>
                    <input
                      type="text"
                      value={modalRecipients}
                      onChange={(e) => setModalRecipients(e.target.value)}
                      placeholder="email1@example.com, email2@example.com"
                      className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-400 transition-shadow"
                    />
                  </div>
                  {clientReportFrequency !== "campaign_wins" && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Email Subject (optional)</label>
                    <input
                      type="text"
                      value={modalEmailSubject}
                      onChange={(e) => setModalEmailSubject(e.target.value)}
                      placeholder="Custom email subject"
                      className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-shadow"
                    />
                  </div>
                  )}
                  <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 mt-6">
                    <button
                      type="button"
                      onClick={() => setShowClientReportModal(false)}
                      className="px-5 py-2.5 text-gray-700 bg-gray-100 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={clientReportSubmitting}
                      onClick={handleSubmitClientReport}
                      className="px-5 py-2.5 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {clientReportSubmitting
                        ? "Saving..."
                        : clientReportFrequency === "campaign_wins"
                        ? "Save Campaign Wins"
                        : clientReportFrequency.startsWith("local_map_")
                        ? "Save Local Map Schedule"
                        : clientReportFrequency.startsWith("ppc_")
                        ? "Save PPC Schedule"
                        : "Create Report"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {workLogModalOpen && createPortal(
            <div
              className={`fixed inset-0 z-50 ${
                workLogModalMode === "edit"
                  ? "pointer-events-none flex items-stretch justify-end p-0"
                  : "flex items-center justify-center p-4"
              }`}
            >
              {workLogModalMode !== "edit" && (
                <div
                  className="absolute inset-0 bg-black/50"
                  onClick={() => setWorkLogModalOpen(false)}
                />
              )}
              <div
                className={`relative w-full flex flex-col bg-white shadow-2xl overflow-hidden pointer-events-auto ${
                  workLogModalMode === "edit"
                    ? "max-w-2xl h-full rounded-none border-0"
                    : "max-w-lg max-h-[90vh] rounded-2xl border-2 border-primary-200"
                }`}
                style={workLogModalMode === "edit" ? { animation: "workLogSlideInRight 260ms ease-out" } : undefined}
              >
                {workLogModalMode === "edit" && (
                  <style>{`@keyframes workLogSlideInRight{from{transform:translateX(24px);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
                )}
                <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                  <h3 className="text-lg font-bold text-primary-900">
                    {workLogModalMode === "create"
                      ? "Add Work Log Entry"
                      : workLogModalMode === "edit"
                      ? "Edit Work Log Entry"
                      : "Work Log Entry"}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setWorkLogModalOpen(false)}
                    className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-100 transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div
                  className={`overflow-auto overflow-x-auto ${
                    workLogModalMode === "edit"
                      ? "flex-1"
                      : "max-h-[calc(90vh-14rem)]"
                  }`}
                >
                  <div className="px-6 py-5 space-y-4 min-w-0">
                  <div>
                    {workLogModalMode !== "edit" && (
                      <label className="block text-sm font-semibold text-primary-800 mb-1">Title</label>
                    )}
                    <input
                      type="text"
                      maxLength={90}
                      value={workLogForm.description}
                      onChange={(e) => setWorkLogForm({ ...workLogForm, description: e.target.value })}
                      disabled={isWorkLogFieldsReadOnly}
                      className={`w-full border-2 border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-400 disabled:bg-gray-50 transition-shadow ${
                        workLogModalMode === "edit" ? "text-lg font-semibold" : "text-sm"
                      }`}
                      placeholder="e.g. Optimized homepage title tags"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-emerald-800 mb-1">Work Type</label>
                    <input
                      type="text"
                      value={workLogForm.category}
                      onChange={(e) => setWorkLogForm({ ...workLogForm, category: e.target.value })}
                      disabled={isWorkLogFieldsReadOnly}
                      className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 disabled:bg-gray-50 transition-shadow"
                      placeholder="e.g. Technical, Content, Link Building"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-violet-800 mb-1">Due date</label>
                    <input
                      type="date"
                      value={workLogForm.dueDate}
                      onChange={(e) => setWorkLogForm({ ...workLogForm, dueDate: e.target.value })}
                      disabled={isWorkLogFieldsReadOnly}
                      className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-400 disabled:bg-gray-50 transition-shadow"
                    />
                  </div>

                  <div ref={assignToRef} className="relative">
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Assign to</label>
                    {isWorkLogFieldsReadOnly ? (
                      <p className="text-sm text-gray-900 py-2">
                        {workLogForm.assigneeId
                          ? (() => {
                              const task = selectedWorkLogTaskId ? workLogTasks.find((t) => t.id === selectedWorkLogTaskId) : null;
                              const u = task?.assignee ?? assignableUsers.find((x) => x.id === workLogForm.assigneeId);
                              return u ? `${u.name || u.email}${u.email && u.name ? ` (${u.email})` : ""}` : "—";
                            })()
                          : "—"}
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={workLogForm.assigneeId ? workLogForm.assigneeDisplay : assignableSearch}
                            onChange={(e) => {
                              setAssignableSearch(e.target.value);
                              setAssignToOpen(true);
                              if (workLogForm.assigneeId && e.target.value !== workLogForm.assigneeDisplay) setWorkLogForm((p) => ({ ...p, assigneeId: "", assigneeDisplay: "" }));
                            }}
                            onFocus={() => setAssignToOpen(true)}
                            placeholder="Search by name or email"
                            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-400 transition-shadow"
                          />
                          {workLogForm.assigneeId && (
                            <button type="button" onClick={() => { setWorkLogForm((p) => ({ ...p, assigneeId: "", assigneeDisplay: "" })); setAssignableSearch(""); setAssignToOpen(true); }} className="text-sm text-slate-600 hover:text-primary-600 font-medium">
                              Clear
                            </button>
                          )}
                        </div>
                        {assignToOpen && (
                          <ul className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border-2 border-primary-200 bg-white shadow-lg py-1">
                            {assignableLoading ? (
                              <li className="px-3 py-2 text-sm text-gray-500">Loading…</li>
                            ) : assignableUsers.length === 0 ? (
                              <li className="px-3 py-2 text-sm text-gray-500">No users found. Try a different search.</li>
                            ) : (
                              assignableUsers.map((u) => (
                                <li key={u.id}>
                                  <button
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 flex items-center justify-between"
                                    onClick={() => { setWorkLogForm((p) => ({ ...p, assigneeId: u.id, assigneeDisplay: u.name || u.email })); setAssignableSearch(""); setAssignToOpen(false); }}
                                  >
                                    <span>{u.name || u.email}</span>
                                    <span className="text-xs text-gray-500 ml-2">{u.role.replace("_", " ")}</span>
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                        )}
                      </>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-amber-800 mb-1">Description</label>
                    {!isWorkLogFieldsReadOnly && (
                      <div className="flex flex-wrap gap-1 mb-1 p-1 border border-amber-200 rounded-t-lg bg-amber-50/50">
                        <button type="button" onClick={() => document.execCommand("bold")} className="px-2 py-1 text-sm font-bold border border-amber-300 rounded hover:bg-amber-100 text-amber-900" title="Bold">B</button>
                        <button type="button" onClick={() => document.execCommand("insertUnorderedList")} className="px-2 py-1 text-sm border border-amber-300 rounded hover:bg-amber-100 text-amber-900" title="Bullet list">• List</button>
                        <button type="button" onClick={() => document.execCommand("insertOrderedList")} className="px-2 py-1 text-sm border border-amber-300 rounded hover:bg-amber-100 text-amber-900" title="Numbered list">1. List</button>
                      </div>
                    )}
                    <div
                      ref={workLogTaskNotesRef}
                      contentEditable={!isWorkLogFieldsReadOnly}
                      suppressContentEditableWarning
                      onInput={(e) => setWorkLogForm((prev) => ({ ...prev, taskNotes: (e.target as HTMLDivElement).innerHTML }))}
                      onBlur={(e) => setWorkLogForm((prev) => ({ ...prev, taskNotes: (e.target as HTMLDivElement).innerHTML }))}
                      className="min-h-[220px] w-full border border-gray-300 rounded-lg rounded-tl-none px-4 py-3 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-50 overflow-y-auto overflow-x-auto resize-y prose prose-sm max-w-none list-disc pl-5 space-y-1"
                      style={{ outline: "none" }}
                    />
                  </div>

                  <div className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50/50 p-3">
                    <label className="block text-sm font-semibold text-indigo-800 mb-2">Proof / Attachments</label>
                    {!isWorkLogFieldsReadOnly && (
                      <>
                        <input
                          id="work-log-file-input-2"
                          type="file"
                          multiple
                          accept=".pdf,.doc,.docx,.xls,.xlsx,image/*,video/*,.txt,.csv"
                          className="sr-only"
                          aria-label="Upload work log attachment"
                          onChange={handleWorkLogFileSelect}
                        />
                        <div className="mb-4">
                          <label
                            htmlFor="work-log-file-input-2"
                            className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-500 transition-colors"
                          >
                            <div className="flex flex-col items-center">
                              {workLogUploading ? (
                                <Loader2 className="h-6 w-6 text-gray-400 mb-2 animate-spin" />
                              ) : (
                                <Upload className="h-6 w-6 text-gray-400 mb-2" />
                              )}
                              <span className="text-sm text-gray-600">
                                {workLogUploading ? "Uploading…" : "Click to upload files (PDF, Word, Excel, images, etc.)"}
                              </span>
                              <span className="text-xs text-gray-500 mt-1">max 25MB per file</span>
                            </div>
                          </label>
                        </div>
                        <div className="space-y-3 mb-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={workLogUrlType}
                              onChange={(e) => setWorkLogUrlType(e.target.value as "image" | "video" | "url")}
                              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent w-full sm:w-40"
                            >
                              <option value="url">URL</option>
                              <option value="image">Image URL</option>
                              <option value="video">Video URL</option>
                            </select>
                            <span className="text-sm text-gray-500 hidden sm:inline">Add a link as proof</span>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-3">
                            <input
                              type="url"
                              value={workLogUrlInput}
                              onChange={(e) => setWorkLogUrlInput(e.target.value)}
                              placeholder="Enter URL (e.g., https://example.com/image.png)"
                              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                            <button
                              type="button"
                              onClick={handleWorkLogAddUrl}
                              className="sm:self-end w-full sm:w-auto flex-shrink-0 px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center gap-1.5 font-medium"
                            >
                              <Plus className="h-4 w-4" />
                              <span>Add link</span>
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                    {workLogForm.attachments.length > 0 ? (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {workLogForm.attachments.map((att, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                          >
                            <div className="flex items-center space-x-3 flex-1 min-w-0">
                              {att.type === "image" && <Image className="h-5 w-5 text-blue-600 flex-shrink-0" />}
                              {att.type === "video" && <Video className="h-5 w-5 text-purple-600 flex-shrink-0" />}
                              {(att.type === "url" || !att.type) && <LinkIcon className="h-5 w-5 text-green-600 flex-shrink-0" />}
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900 truncate">
                                  {att.name || att.value || "Attachment"}
                                </div>
                                <a
                                  href={att.value}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary-600 hover:text-primary-800 truncate block"
                                >
                                  {att.value}
                                </a>
                              </div>
                            </div>
                            {!isWorkLogFieldsReadOnly && (
                              <button
                                type="button"
                                onClick={() => removeWorkLogAttachment(i)}
                                className="ml-2 p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 flex-shrink-0 transition-colors"
                                title="Remove"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-violet-700/80">No attachments</p>
                    )}
                  </div>

                  <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-3">
                    <label className="block text-sm font-semibold text-blue-800 mb-1">Status</label>
                    <select
                      value={workLogForm.status}
                      onChange={(e) => setWorkLogForm({ ...workLogForm, status: e.target.value as TaskStatus })}
                      disabled={isWorkLogFieldsReadOnly}
                      className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-slate-400 focus:border-slate-400 disabled:bg-gray-50 transition-shadow"
                    >
                      <option value="TODO">Pending</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="REVIEW">In Review</option>
                      <option value="NEEDS_APPROVAL">Needs Approval</option>
                      <option value="CANCELLED">Cancelled</option>
                      <option value="DONE">Completed</option>
                    </select>
                    {workLogForm.status === "NEEDS_APPROVAL" && !isWorkLogFieldsReadOnly && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                        <p className="text-xs font-medium text-amber-800 mb-2">Send approval request to (select who should be notified):</p>
                        {clientUsersLoading ? (
                          <p className="text-sm text-amber-700">Loading recipients…</p>
                        ) : workLogApprovalClientUsers.length === 0 ? (
                          <p className="text-sm text-amber-700">No users available for this account.</p>
                        ) : (
                          <div className="max-h-40 overflow-y-auto space-y-1.5">
                            {workLogApprovalClientUsers.map((u) => (
                              <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={workLogForm.approvalNotifyUserIds.includes(u.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setWorkLogForm({ ...workLogForm, approvalNotifyUserIds: [...(workLogForm.approvalNotifyUserIds || []), u.id] });
                                    } else {
                                      setWorkLogForm({ ...workLogForm, approvalNotifyUserIds: (workLogForm.approvalNotifyUserIds || []).filter((id) => id !== u.id) });
                                    }
                                  }}
                                  className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                                />
                                <span className="text-sm text-gray-800">{u.name || u.email || u.id}</span>
                                {u.email && u.name && <span className="text-xs text-gray-500">({u.email})</span>}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border-l-4 border-teal-500 bg-teal-50/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-sm font-semibold text-teal-800">Activity</label>
                      {workLogModalMode !== "create" && selectedWorkLogTaskId && (
                        <button
                          type="button"
                          onClick={() => void fetchWorkLogComments(selectedWorkLogTaskId)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Refresh
                        </button>
                      )}
                    </div>
                    {workLogModalMode === "create" || !selectedWorkLogTaskId ? (
                      <p className="mt-2 text-sm text-gray-500">Save the work log entry to start the activity feed.</p>
                    ) : (
                      <div className="mt-3 rounded-lg border border-gray-200 bg-white">
                        <div className="max-h-64 overflow-y-auto p-3 space-y-3">
                          {workLogCommentsLoading ? (
                            <p className="text-sm text-gray-500">Loading activity...</p>
                          ) : workLogCommentsError ? (
                            <p className="text-sm text-rose-600">{workLogCommentsError}</p>
                          ) : workLogComments.length === 0 ? (
                            <p className="text-sm text-gray-500">No activity yet. Start the conversation below.</p>
                          ) : (
                            workLogComments.map((c) => {
                              const config = workLogActivityConfig[c.type] || workLogActivityConfig.COMMENT;
                              const displayName = c.author?.name || c.author?.email || "Unknown";
                              const initials = displayName
                                .split(/\s+/)
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((part) => part.charAt(0).toUpperCase())
                                .join("") || "U";
                              const authorRole = c.author?.role === "USER"
                                ? "Client"
                                : c.author?.role === "SPECIALIST"
                                  ? "Specialist"
                                  : c.author?.role === "SUPER_ADMIN"
                                    ? "Super Admin"
                                    : c.author?.role === "ADMIN"
                                      ? "Admin"
                                      : "Agency";
                              const when = (() => {
                                try {
                                  return new Date(c.createdAt).toLocaleString();
                                } catch {
                                  return "";
                                }
                              })();
                              const isAuthor = Boolean(user?.id) && c.author?.id === user?.id;
                              const canDelete = isAuthor;
                              return (
                                <div key={c.id} className={`group rounded-lg border p-3 ${config.border} ${config.bg}`}>
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex items-start gap-3">
                                      <div
                                        className={`h-8 w-8 flex-shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${
                                          c.author?.role === "USER"
                                            ? "bg-violet-100 text-violet-700"
                                            : c.author?.role === "SPECIALIST"
                                              ? "bg-emerald-100 text-emerald-700"
                                              : c.author?.role === "SUPER_ADMIN"
                                                ? "bg-indigo-100 text-indigo-700"
                                                : c.author?.role === "ADMIN"
                                                  ? "bg-blue-100 text-blue-700"
                                                  : "bg-slate-100 text-slate-700"
                                        }`}
                                        title={displayName}
                                      >
                                        {initials}
                                      </div>
                                      <div className="min-w-0">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <p className="text-sm font-medium text-gray-900 truncate">
                                          {displayName}
                                        </p>
                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                          {authorRole}
                                        </span>
                                      </div>
                                      <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap break-words">
                                        {renderWorkLogCommentBody(c.body)}
                                      </p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <p className="text-xs text-gray-500">{when}</p>
                                      {canDelete && (
                                        <button
                                          type="button"
                                          onClick={() => requestDeleteWorkLogComment(c.id)}
                                          className="p-1 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                          title="Delete"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>

                        <div className="border-t border-gray-200 p-3">
                          {!canCommentOnWorkLog ? (
                            <p className="text-sm text-gray-500">Sign in to participate in the conversation.</p>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex flex-col sm:flex-row gap-2">
                                <div className="relative flex-1">
                                  <div
                                    aria-hidden
                                    className="absolute inset-0 pointer-events-none px-3 py-2 text-sm leading-5 text-gray-700 whitespace-pre-wrap break-words rounded-lg"
                                  >
                                    {workLogNewComment.length === 0 ? (
                                      <span className="text-gray-400">Write a comment... Use @ to mention a user.</span>
                                    ) : (
                                      renderWorkLogCommentEditorOverlay(workLogNewComment)
                                    )}
                                  </div>
                                  <textarea
                                    ref={workLogCommentInputRef}
                                    value={workLogNewComment}
                                    onChange={handleWorkLogCommentChange}
                                    onClick={(e) => updateWorkLogMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
                                    onKeyUp={(e) => updateWorkLogMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? e.currentTarget.value.length)}
                                    onKeyDown={handleWorkLogMentionKeyDown}
                                    rows={2}
                                    className="relative z-10 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm leading-5 bg-transparent text-transparent caret-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    placeholder=""
                                  />
                                  {workLogMentionRange && workLogMentionSuggestions.length > 0 && (
                                    <div className="absolute bottom-full z-30 mb-1 w-full max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                      {workLogMentionSuggestions.map((member, idx) => (
                                        <button
                                          key={member.id}
                                          type="button"
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            handleSelectWorkLogMention(member);
                                          }}
                                          className={`w-full px-3 py-2 text-left ${idx === workLogMentionActiveIndex ? "bg-primary-50" : "hover:bg-gray-50"}`}
                                        >
                                          <div className="text-sm font-medium text-gray-900">{member.name || member.email}</div>
                                          <div className="text-xs text-gray-500">{member.email}</div>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  disabled={postingWorkLogComment || workLogNewComment.trim().length === 0}
                                  onClick={() => void handlePostWorkLogComment()}
                                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                                >
                                  <Send className="h-4 w-4" />
                                  Post
                                </button>
                              </div>
                              <div className="pt-1">
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => setWorkLogCollaboratorEditorOpen((v) => !v)}
                                    className="text-sm font-medium text-gray-700 hover:text-gray-900"
                                  >
                                    Collaborators
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setWorkLogCollaboratorEditorOpen((v) => !v)}
                                    className="flex items-center -space-x-2"
                                    title="Edit collaborators"
                                  >
                                    {workLogEntryCollaborators.slice(0, 8).map((member) => {
                                      const displayName = member.name || member.email;
                                      const initials = displayName
                                        .split(" ")
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .map((part) => part[0]?.toUpperCase() || "")
                                        .join("") || "U";
                                      return (
                                        <div
                                          key={member.id}
                                          className="h-7 w-7 rounded-full border-2 border-white bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center"
                                          title={`${displayName} (${member.email})`}
                                        >
                                          {initials}
                                        </div>
                                      );
                                    })}
                                    {workLogEntryCollaborators.length > 8 && (
                                      <div
                                        className="h-7 w-7 rounded-full border-2 border-white bg-gray-100 text-gray-600 text-[10px] font-semibold flex items-center justify-center"
                                        title={`${workLogEntryCollaborators.length - 8} more`}
                                      >
                                        +{workLogEntryCollaborators.length - 8}
                                      </div>
                                    )}
                                    <span className="ml-1 h-7 w-7 rounded-full border border-gray-300 bg-white text-gray-600 flex items-center justify-center">
                                      <Plus className="h-3.5 w-3.5" />
                                    </span>
                                  </button>
                                </div>
                                <p className="mt-1 text-xs text-gray-500">
                                  Collaborators notified on every message: <span className="font-semibold text-gray-700">{workLogEntryCollaborators.length}</span>
                                  {" "}• @mention adds collaborator
                                </p>
                                {workLogCollaboratorEditorOpen && (
                                  <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2.5 space-y-2">
                                    <div className="flex flex-wrap gap-1.5">
                                      {workLogEntryCollaborators.map((member) => (
                                        <span key={member.id} className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                                          {member.name || member.email}
                                          <button type="button" className="text-gray-500 hover:text-red-600" onClick={() => removeWorkLogCollaborator(member.id)}>
                                            <X className="h-3 w-3" />
                                          </button>
                                        </span>
                                      ))}
                                    </div>
                                    <input
                                      value={workLogCollaboratorSearch}
                                      onChange={(e) => setWorkLogCollaboratorSearch(e.target.value)}
                                      placeholder="Add collaborators by name or email..."
                                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    />
                                    <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200">
                                      {workLogCollaboratorSearchResults.map((member) => {
                                        const selected = workLogEntryCollaborators.some((m) => m.id === member.id);
                                        return (
                                          <button
                                            key={member.id}
                                            type="button"
                                            onClick={() => (selected ? removeWorkLogCollaborator(member.id) : addWorkLogCollaborator(member.id))}
                                            className="w-full flex items-center justify-between px-2.5 py-2 text-left hover:bg-gray-50"
                                          >
                                            <div className="min-w-0">
                                              <div className="text-sm text-gray-900 truncate">{member.name || member.email}</div>
                                              <div className="text-xs text-gray-500 truncate">{member.email}</div>
                                            </div>
                                            <span className={`text-xs font-medium ${selected ? "text-red-600" : "text-primary-600"}`}>
                                              {selected ? "Remove" : "Add"}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                </div>

                <div className="flex-shrink-0 px-6 py-4 border-t-2 border-gray-200 flex items-center justify-end gap-3 bg-gradient-to-r from-gray-50 to-slate-50">
                  <button
                    type="button"
                    onClick={() => setWorkLogModalOpen(false)}
                    className="px-5 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 transition-colors"
                  >
                    Close
                  </button>
                  {!isWorkLogFieldsReadOnly && canEditSelectedWorkLog && (
                    <button
                      type="button"
                      onClick={handleSaveWorkLog}
                      className="px-5 py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 transition-colors shadow-sm"
                    >
                      Save
                    </button>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}

      {/* Add Backlink Modal */}
      {!reportOnly && !includedClientReadOnly &&
        addBacklinkModalOpen &&
        createPortal(
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden ring-2 ring-primary-200/80">
              <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 border-b-2 border-primary-500/50">
                <h3 className="text-lg font-bold text-white drop-shadow-sm">Add Backlink</h3>
                <button
                  type="button"
                  onClick={() => setAddBacklinkModalOpen(false)}
                  className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-4 bg-gradient-to-b from-slate-50/80 to-white">
                <div className="rounded-xl border-l-4 border-primary-500 bg-primary-50/60 p-3">
                  <label className="block text-sm font-semibold text-primary-800 mb-1">Source URL</label>
                  <input
                    type="text"
                    value={addBacklinkForm.sourceUrl}
                    onChange={(e) => setAddBacklinkForm((p) => ({ ...p, sourceUrl: e.target.value }))}
                    className="w-full border-2 border-primary-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-400 bg-white transition-shadow"
                    placeholder="https://example.com/page"
                  />
                </div>
                <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/60 p-3">
                  <label className="block text-sm font-semibold text-emerald-800 mb-1">Target URL</label>
                  <input
                    type="text"
                    value={addBacklinkForm.targetUrl}
                    onChange={(e) => setAddBacklinkForm((p) => ({ ...p, targetUrl: e.target.value }))}
                    className="w-full border-2 border-emerald-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-400 bg-white transition-shadow"
                    placeholder="https://your-site.com/"
                  />
                </div>
                <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/60 p-3">
                  <label className="block text-sm font-semibold text-amber-800 mb-1">Anchor Text (optional)</label>
                  <input
                    type="text"
                    value={addBacklinkForm.anchorText}
                    onChange={(e) => setAddBacklinkForm((p) => ({ ...p, anchorText: e.target.value }))}
                    className="w-full border-2 border-amber-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-400 bg-white transition-shadow"
                    placeholder="e.g. best seo services"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="rounded-xl border-l-4 border-violet-500 bg-violet-50/60 p-3">
                    <label className="block text-sm font-semibold text-violet-800 mb-1">Domain Rating (optional)</label>
                    <input
                      type="number"
                      value={addBacklinkForm.domainRating}
                      onChange={(e) => setAddBacklinkForm((p) => ({ ...p, domainRating: e.target.value }))}
                      className="w-full border-2 border-violet-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-400 bg-white transition-shadow"
                      placeholder="e.g. 65"
                    />
                  </div>
                  <div className="flex items-end rounded-xl border-l-4 border-slate-400 bg-slate-50/60 p-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={addBacklinkForm.isFollow}
                        onChange={(e) => setAddBacklinkForm((p) => ({ ...p, isFollow: e.target.checked }))}
                        className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                      />
                      Follow link
                    </label>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t-2 border-gray-200 flex items-center justify-end gap-3 bg-gradient-to-r from-gray-50 to-slate-50">
                <button
                  type="button"
                  onClick={() => setAddBacklinkModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={addingBacklink}
                  onClick={() => void submitAddBacklink()}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary-600 to-blue-600 text-white font-semibold hover:from-primary-700 hover:to-blue-700 disabled:opacity-50 transition-all shadow-md"
                >
                  {addingBacklink ? "Saving..." : "Add"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Import Backlinks Modal */}
      {!reportOnly && !includedClientReadOnly &&
        importBacklinksModalOpen &&
        createPortal(
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden ring-2 ring-blue-200/80">
              <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 border-b-2 border-indigo-500/50">
                <div>
                  <h3 className="text-lg font-bold text-white drop-shadow-sm">Import Backlinks</h3>
                  <p className="text-sm text-white/90 mt-1">Paste source URLs (one per line). Target URL defaults to this client.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setImportBacklinksModalOpen(false)}
                  className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-3 bg-gradient-to-b from-slate-50/80 to-white">
                <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/60 p-3">
                <label className="block text-sm font-semibold text-blue-900 mb-1">Source URLs (one per line)</label>
                  <textarea
                    value={importBacklinksText}
                    onChange={(e) => setImportBacklinksText(e.target.value)}
                    className="w-full border-2 border-blue-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-400 bg-white transition-shadow"
                    rows={10}
                    placeholder={"https://example.com/page-1\nhttps://example.com/page-2"}
                  />
                </div>
                <p className="text-xs text-amber-800 bg-amber-50 rounded-xl px-4 py-3 border-l-4 border-amber-500 border border-amber-200/80">
                  Tip: after importing, you can click the top “Refresh” button (Super Admin) to pull live/lost backlink data from DataForSEO.
                </p>
              </div>

              <div className="px-6 py-4 border-t-2 border-gray-200 flex items-center justify-end gap-3 bg-gradient-to-r from-gray-50 to-slate-50">
                <button
                  type="button"
                  onClick={() => setImportBacklinksModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={importingBacklinks}
                  onClick={() => void submitImportBacklinks()}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-md"
                >
                  {importingBacklinks ? "Importing..." : "Import"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {workLogAssigneesModalOpen &&
        createPortal(
          <div className="fixed inset-0 z-[80] bg-black/55" onClick={() => setWorkLogAssigneesModalOpen(false)}>
            <div className="flex min-h-full items-start justify-center p-4 sm:p-8">
              <div
                className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
                  <h3 className="text-xl font-semibold">Project assignees and clients</h3>
                  <button
                    type="button"
                    onClick={() => setWorkLogAssigneesModalOpen(false)}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
                  {workLogProjectAssignees.length === 0 ? (
                    <p className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
                      No assignees found for this project yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {workLogProjectAssignees.map((member) => {
                        const displayName = member.name || member.email;
                        const initials = displayName
                          .split(" ")
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((part) => part[0]?.toUpperCase() || "")
                          .join("") || "U";
                        return (
                          <div key={member.id} className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/70 px-3 py-2.5">
                            <div className="min-w-0 flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold text-indigo-200">
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-100">{displayName}</p>
                                <p className="truncate text-xs text-slate-400">{member.email}</p>
                              </div>
                            </div>
                            <span className="rounded-md border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs text-slate-300">
                              {(() => {
                                const normalized = (member.role || "ASSIGNEE").toUpperCase();
                                if (normalized === "USER") return "Client";
                                return normalized
                                  .replace(/_/g, " ")
                                  .toLowerCase()
                                  .split(" ")
                                  .filter(Boolean)
                                  .map((part) => part[0]?.toUpperCase() + part.slice(1))
                                  .join(" ");
                              })()}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {localMapReportOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-indigo-950/70 via-violet-900/60 to-cyan-900/60 p-4 backdrop-blur-sm"
          style={{ zIndex: 2147483000 }}
        >
          <div className="w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden rounded-2xl border border-indigo-200/80 bg-white shadow-[0_18px_60px_-22px_rgba(79,70,229,0.55)]">
            <div className="relative flex items-center justify-between overflow-hidden bg-gradient-to-r from-primary-600 via-violet-600 to-cyan-500 px-5 py-4 text-white">
              <div className="pointer-events-none absolute -right-14 -top-14 h-36 w-36 rounded-full bg-white/20 blur-xl" />
              <div className="pointer-events-none absolute -left-10 -bottom-16 h-32 w-32 rounded-full bg-fuchsia-300/30 blur-xl" />
              <div>
                <h3 className="text-lg font-bold">Local Map Report</h3>
                {localMapReport ? (
                  <p className="text-xs text-white/90">
                    {localMapReport.keyword.keywordText} - {localMapReport.keyword.businessName}
                  </p>
                ) : (
                  <p className="text-xs text-white/90">Loading report…</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLocalMapReportOpen(false)}
                className="rounded-md border border-white/40 bg-white/15 p-1 text-white/90 hover:bg-white/25"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {!localMapReport ? (
              <div className="overflow-y-auto bg-gradient-to-b from-indigo-50/60 via-violet-50/30 to-cyan-50/40 p-8">
                {localMapReportLoading ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading local map report...
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-sm text-gray-600">Unable to load this keyword report.</p>
                    <button
                      type="button"
                      onClick={() => setLocalMapReportOpen(false)}
                      className="mt-3 px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            ) : (
            <div ref={localMapReportContentRef} className="overflow-y-auto space-y-5 bg-gradient-to-b from-indigo-50/60 via-violet-50/20 to-cyan-50/30 p-5">
              <div className="local-map-pdf-section rounded-xl border border-gray-200 bg-gradient-to-r from-slate-50 via-blue-50 to-indigo-50 p-4">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <div className="md:col-span-2">
                    <p className="text-xs uppercase tracking-wide text-gray-500">Keyword</p>
                    <p className="text-sm font-semibold text-gray-900">{localMapReport.keyword.keywordText}</p>
                    <p className="mt-2 text-xs uppercase tracking-wide text-gray-500">Business</p>
                    <p className="text-sm font-semibold text-gray-900">{localMapReport.keyword.businessName}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Location</p>
                    <p className="text-sm text-gray-800">{localMapReport.keyword.businessAddress || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Run Date</p>
                    <p className="text-sm text-gray-800">
                      {safeFormatLocalMapDate(localMapReport.current?.runDate, "MMM d, yyyy", "Not run yet")}
                    </p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Current ATA</p>
                    <p className="text-2xl font-bold text-emerald-900">
                      {localMapReport.current?.ataScore != null ? Number(localMapReport.current.ataScore).toFixed(2) : "-"}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-gray-600">
                  ATA = average of all 49 grid positions; missing ranks are counted as 20. Lower ATA is better.
                </p>
              </div>

              <div className="local-map-pdf-section rounded-xl border border-sky-200 bg-gradient-to-br from-white via-sky-50/30 to-cyan-50/50 p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">ATA Score Trend</h4>
                {localMapReportTrendPoints.length ? (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={localMapReportTrendPoints.map((point) => ({
                          runDate: safeFormatLocalMapDate(point.runDate, "MMM d", "-"),
                          ata: Number(point.ataScore),
                        }))}
                      >
                        <defs>
                          <linearGradient id="localMapTrendStroke" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#4f46e5" />
                            <stop offset="55%" stopColor="#7c3aed" />
                            <stop offset="100%" stopColor="#06b6d4" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#c7d2fe" />
                        <XAxis dataKey="runDate" tick={{ fontSize: 11, fill: "#4338ca" }} stroke="#818cf8" />
                        <YAxis tick={{ fontSize: 11, fill: "#0e7490" }} stroke="#67e8f9" />
                        <Tooltip
                          isAnimationActive={false}
                          contentStyle={{
                            pointerEvents: "none",
                            borderRadius: 10,
                            border: "1px solid #c4b5fd",
                            background: "linear-gradient(135deg, #eef2ff 0%, #f5f3ff 55%, #ecfeff 100%)",
                            boxShadow: "0 10px 24px rgba(79, 70, 229, 0.18)",
                          }}
                          labelStyle={{ color: "#312e81", fontWeight: 700 }}
                          itemStyle={{ color: "#0f766e", fontWeight: 600 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="ata"
                          stroke="url(#localMapTrendStroke)"
                          strokeWidth={3}
                          dot={{ r: 3, fill: "#7c3aed", stroke: "#ffffff", strokeWidth: 1.5 }}
                          activeDot={{ r: 5, fill: "#06b6d4", stroke: "#ffffff", strokeWidth: 2 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No trend data yet.</p>
                )}
                <p className="mt-3 text-xs text-gray-600">
                  Heat map colors: 1-3 (Green), 4-10 (Yellow), 11-20 (Orange), Not ranked / 20+ (Red).
                </p>
              </div>

              {localMapReport.current && (
                <div className="local-map-pdf-section rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-white via-indigo-50/30 to-violet-50/40 p-4">
                  <div className="mb-3">
                    <div>
                      <h4 className="text-sm font-bold text-gray-900">CURRENT</h4>
                      <p className="text-xs text-gray-600">
                        {safeFormatLocalMapDate(localMapReport.current.runDate, "MMM d, yyyy", "-")} · ATA {Number(localMapReport.current.ataScore).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  {(() => {
                    const cells = parseLocalMapGridData(localMapReport.current!.gridData);
                    const size = Math.max(1, Math.round(Math.sqrt(cells.length || 1)));
                    const centerIdx = Math.floor(size / 2) * size + Math.floor(size / 2);
                    const topCompetitors = getTopCompetitorsFromCells(cells);
                    return (
                      <>
                        <div className="space-y-1 min-w-[520px] overflow-x-auto">
                          {Array.from({ length: size }).map((_, rowIdx) => (
                            <div key={`current-${rowIdx}`} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
                              {Array.from({ length: size }).map((__, colIdx) => {
                                const pointIdx = rowIdx * size + colIdx;
                                const point = cells[pointIdx];
                                const rank = point?.rank ?? null;
                                const isCenter = pointIdx === centerIdx;
                                return (
                                  <div
                                    key={`current-${rowIdx}-${colIdx}`}
                                    className={`h-11 rounded text-[11px] font-semibold flex items-center justify-center gap-1 ${localMapCellClass(rank)}`}
                                  >
                                    {isCenter && <MapPin className="h-3.5 w-3.5" />}
                                    <span>{rank == null ? "NR" : rank}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                        <div className="mt-3">
                          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Top 3 Competitors (Current Grid)</p>
                          <div className="flex flex-wrap gap-2">
                            {topCompetitors.length ? topCompetitors.map((name) => (
                              <span key={name} className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-800">
                                {name}
                              </span>
                            )) : <span className="text-xs text-gray-500">No competitor names captured for this run.</span>}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              <div className="local-map-pdf-section bg-white border border-gray-200 rounded-xl p-4">
                <h4 className="text-sm font-bold text-gray-900 mb-3">PREVIOUS 3 RUNS</h4>
                {localMapReport.previousThree.length === 0 ? (
                  <p className="text-sm text-gray-500">No previous runs yet.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {localMapReport.previousThree.map((snap) => {
                      const cells = parseLocalMapGridData(snap.gridData);
                      const size = Math.max(1, Math.round(Math.sqrt(cells.length || 1)));
                      const centerIdx = Math.floor(size / 2) * size + Math.floor(size / 2);
                      return (
                        <div key={snap.id} className="rounded-lg border border-violet-200 bg-gradient-to-br from-white to-violet-50/40 p-3">
                          <div className="mb-2">
                            <div>
                              <p className="text-xs font-semibold text-gray-900">{safeFormatLocalMapDate(snap.runDate, "MMM d, yyyy", "-")}</p>
                              <p className="text-[11px] text-gray-600">ATA {Number(snap.ataScore).toFixed(2)}</p>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {Array.from({ length: size }).map((_, rowIdx) => (
                              <div key={`${snap.id}-row-${rowIdx}`} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
                                {Array.from({ length: size }).map((__, colIdx) => {
                                  const pointIdx = rowIdx * size + colIdx;
                                  const point = cells[pointIdx];
                                  const rank = point?.rank ?? null;
                                  const isCenter = pointIdx === centerIdx;
                                  return (
                                    <div
                                      key={`${snap.id}-${rowIdx}-${colIdx}`}
                                      className={`h-8 rounded text-[10px] font-semibold flex items-center justify-center gap-0.5 ${localMapCellClass(rank)}`}
                                    >
                                      {isCenter && <MapPin className="h-3 w-3" />}
                                      <span>{rank == null ? "NR" : rank}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {localMapReportBenchmark && (
                <div className="local-map-pdf-section bg-white border border-amber-300 rounded-xl p-4">
                  <div className="mb-3">
                    <div>
                      <h4 className="text-sm font-bold text-amber-900">YOUR BENCHMARK</h4>
                      <p className="text-xs font-semibold text-amber-800">
                        Benchmark — {safeFormatLocalMapDate(localMapReportBenchmark.runDate, "MMM d, yyyy", "-")}
                      </p>
                      <p className="text-xs text-amber-700">ATA {Number(localMapReportBenchmark.ataScore).toFixed(2)}</p>
                    </div>
                  </div>
                  {(() => {
                    const cells = parseLocalMapGridData(localMapReportBenchmark.gridData);
                    const size = Math.max(1, Math.round(Math.sqrt(cells.length || 1)));
                    const centerIdx = Math.floor(size / 2) * size + Math.floor(size / 2);
                    return (
                      <div className="space-y-1 min-w-[360px] overflow-x-auto">
                        {Array.from({ length: size }).map((_, rowIdx) => (
                          <div key={`benchmark-row-${rowIdx}`} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
                            {Array.from({ length: size }).map((__, colIdx) => {
                              const pointIdx = rowIdx * size + colIdx;
                              const point = cells[pointIdx];
                              const rank = point?.rank ?? null;
                              const isCenter = pointIdx === centerIdx;
                              return (
                                <div
                                  key={`benchmark-${rowIdx}-${colIdx}`}
                                  className={`h-9 rounded text-[10px] font-semibold flex items-center justify-center gap-0.5 ${localMapCellClass(rank)}`}
                                >
                                  {isCenter && <MapPin className="h-3 w-3" />}
                                  <span>{rank == null ? "NR" : rank}</span>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      )}
      {localMapActivationOpen && (
        <div className="fixed top-4 right-4 z-[140] rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 shadow">
          Debug: localMapActivationOpen = true
        </div>
      )}

      {false && localMapActivationOpen && (
        <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-primary-600 via-indigo-600 to-blue-600 text-white">
              <div>
                <h3 className="text-lg font-bold">Activate Local Map Keyword</h3>
                <p className="text-xs text-white/90">Choose a money keyword and select a GBP listing.</p>
              </div>
              <button
                type="button"
                onClick={() => setLocalMapActivationOpen(false)}
                className="p-1 rounded-md text-white/80 hover:bg-white/15"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-primary-100 px-3 py-2 text-xs text-indigo-800">
                Grid defaults: 7x7 points, 0.5 mile spacing. Center point is pulled from the selected GBP listing.
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5 text-primary-600" />
                    Keyword
                  </span>
                </label>
                <select
                  value={localMapSelectedKeywordId}
                  onChange={(e) => setLocalMapSelectedKeywordId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select a money keyword</option>
                  {localMapMoneyKeywords.map((kw) => (
                    <option key={kw.id} value={kw.id}>
                      {kw.keyword}
                    </option>
                  ))}
                </select>
                {localMapMoneyKeywordsLoading ? (
                  <p className="mt-1 text-xs text-gray-500">Loading money keywords...</p>
                ) : localMapMoneyKeywords.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    No money keywords found on this dashboard yet. Add money keywords first, then activate Local Map.
                  </p>
                ) : null}
              </div>

              <GoogleBusinessSearch
                value={localMapBusinessSelection}
                onSelect={setLocalMapBusinessSelection}
                inputId="local-map-business-modal"
                placeholder="Search Google Business Profile listing"
              />

              {localMapBusinessSelection && (
                <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-100 px-3 py-2 text-sm text-emerald-900">
                  <div className="font-semibold">{localMapBusinessSelection?.businessName}</div>
                  <div className="text-emerald-800">{localMapBusinessSelection?.address}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Center: {localMapBusinessSelection?.lat}, {localMapBusinessSelection?.lng}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="inline-flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5 text-primary-600" />
                    Label (optional)
                  </span>
                </label>
                <input
                  value={localMapLabel}
                  onChange={(e) => setLocalMapLabel(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="Main Office"
                />
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setLocalMapActivationOpen(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleActivateLocalMapKeyword()}
                disabled={localMapSubmitting || includedClientReadOnly}
                title={includedClientReadOnly ? "Included clients are view-only" : "Activate"}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-semibold hover:from-primary-700 hover:to-indigo-700 disabled:opacity-60"
              >
                {localMapSubmitting ? "Activating..." : "Activate"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={workLogDeleteConfirm.isOpen}
        onClose={() => setWorkLogDeleteConfirm({ isOpen: false, taskId: null, taskTitle: null })}
        onConfirm={() => void confirmDeleteWorkLog()}
        title="Delete work log entry"
        message={`Are you sure you want to delete "${workLogDeleteConfirm.taskTitle || "this entry"}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
      <ConfirmDialog
        isOpen={workLogCommentDeleteConfirm.isOpen}
        onClose={() => setWorkLogCommentDeleteConfirm({ isOpen: false, commentId: null })}
        onConfirm={() => void confirmDeleteWorkLogComment()}
        title="Delete activity"
        message="Are you sure you want to delete this activity?"
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={backlinkDeleteConfirm.isOpen}
        onClose={() => setBacklinkDeleteConfirm({ isOpen: false, backlinkId: null, label: null, isLost: false })}
        onConfirm={() => void confirmRemoveBacklink()}
        title="Remove backlink"
        message={`Remove backlink from "${backlinkDeleteConfirm.label || "this source"}"? This will delete the backlink row from this client.`}
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={reportDeleteConfirm.isOpen}
        onClose={() => setReportDeleteConfirm({ isOpen: false, reportId: null, label: null })}
        onConfirm={() => void confirmDeleteReport()}
        title="Delete report"
        message={`Are you sure you want to delete "${reportDeleteConfirm.label || "this report"}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={ppcReportDeleteConfirm.isOpen}
        onClose={() => setPpcReportDeleteConfirm({ isOpen: false, scheduleId: null, label: null })}
        onConfirm={() => void confirmDeletePpcReport()}
        title="Delete report"
        message={`Are you sure you want to delete "${ppcReportDeleteConfirm.label || "this report"}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
      <ConfirmDialog
        isOpen={localMapReportDeleteConfirm.isOpen}
        onClose={() => setLocalMapReportDeleteConfirm({ isOpen: false, scheduleId: null, label: null })}
        onConfirm={() => void confirmDeleteLocalMapReport()}
        title="Delete report"
        message={`Are you sure you want to delete "${localMapReportDeleteConfirm.label || "this report"}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={campaignWinsDeleteConfirm.isOpen}
        onClose={() => setCampaignWinsDeleteConfirm({ isOpen: false, label: null })}
        onConfirm={() => void confirmDeleteCampaignWinsReport()}
        title="Delete report"
        message={`Are you sure you want to delete "${campaignWinsDeleteConfirm.label || "this report"}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      {campaignWinsPreviewModal.open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-gray-200/80 w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
            <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Campaign Wins Email Preview</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {campaignWinsPreviewModal.clientName}
                </p>
                <p className="text-sm text-gray-700 mt-2">
                  <span className="font-medium">Subject:</span> {campaignWinsPreviewModal.subject || "N/A"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  To: {campaignWinsPreviewModal.recipients.length > 0 ? campaignWinsPreviewModal.recipients.join(", ") : "No recipients"}
                </p>
              </div>
              <button
                onClick={() =>
                  setCampaignWinsPreviewModal({
                    open: false,
                    clientName: "",
                    subject: "",
                    recipients: [],
                    html: "",
                  })
                }
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                title="Close preview"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 bg-gray-50 flex-1 overflow-auto">
              <iframe
                title="Campaign Wins email HTML preview"
                srcDoc={campaignWinsPreviewModal.html}
                className="w-full h-[65vh] rounded-lg border border-gray-200 bg-white"
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() =>
                  setCampaignWinsPreviewModal({
                    open: false,
                    clientName: "",
                    subject: "",
                    recipients: [],
                    html: "",
                  })
                }
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Report Modal */}
      {viewReportModalOpen && selectedReport && createPortal(
        <div className="fixed top-0 left-0 right-0 bottom-0 bg-black bg-opacity-50 z-50 m-0 p-0">
          <div className="bg-gray-50 w-full h-full overflow-hidden flex flex-col m-0 p-0">
            {/* Close button - floating */}
            <button
              onClick={handleCloseViewModal}
              className="fixed top-4 right-4 z-50 p-2 bg-white rounded-full shadow-lg text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close report"
            >
              <X className="h-6 w-6" />
            </button>

            {/* Modal Content - Report Preview */}
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
              <div ref={modalDashboardContentRef} className="max-w-5xl mx-auto space-y-6">
                {/* Report Header Card */}
                <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-xl p-8 text-white shadow-lg">
                  <div className="text-center">
                    <div className="flex items-center justify-center mb-3">
                      <FileText className="h-8 w-8 mr-3" />
                      <h1 className="text-3xl font-bold">
                        {selectedReport?.scheduleKind === "ppc" ? "PPC Analytics Report" : "SEO Analytics Report"}
                      </h1>
                    </div>
                    <p className="text-primary-100 text-lg mt-2">
                      {(() => {
                        const defaultPeriod =
                          (serverReport?.period ? String(serverReport.period) : String(selectedReport.type))
                            .charAt(0)
                            .toUpperCase() +
                          (serverReport?.period ? String(serverReport.period) : String(selectedReport.type))
                            .slice(1)
                            .toLowerCase();
                        if (selectedReport?.scheduleKind !== "ppc") {
                          return `${defaultPeriod} report for ${client?.name || "Client"}`;
                        }
                        const ppcType = String(selectedReport?.type || "").toLowerCase();
                        const ppcPeriod = ppcType.includes("biweekly")
                          ? "Biweekly"
                          : ppcType.includes("weekly")
                          ? "Weekly"
                          : "Monthly";
                        return `${ppcPeriod} report for ${client?.name || "Client"}`;
                      })()}
                    </p>
                  </div>

                  <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm">
                      <div className="text-primary-200 text-xs font-medium mb-1">Client</div>
                      <div className="text-white font-semibold">{client?.name || "—"}</div>
                    </div>
                    <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm">
                      <div className="text-primary-200 text-xs font-medium mb-1">Domain</div>
                      <div className="text-white font-semibold break-all">{client?.domain || "—"}</div>
                    </div>
                    <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm">
                      <div className="text-primary-200 text-xs font-medium mb-1">Report Date</div>
                      <div className="text-white font-semibold">
                        {serverReport?.reportDate ? new Date(serverReport.reportDate).toLocaleDateString() : selectedReport.lastGenerated}
                      </div>
                    </div>
                  </div>
                </div>

                {selectedReport?.scheduleKind === "ppc" ? (
                  <div className="bg-white rounded-xl p-6 shadow-md border border-gray-200">

                    {reportPreviewPpcLoading ? (
                      <div className="flex items-center justify-center py-8 text-gray-500">
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                        <span>Loading PPC report data...</span>
                      </div>
                    ) : reportPreviewPpcError ? (
                      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                        {reportPreviewPpcError}
                      </div>
                    ) : (
                      (reportPreviewPpcData?.data?.campaigns?.length ?? 0) > 0 ||
                      (reportPreviewPpcData?.data?.adGroups?.length ?? 0) > 0 ||
                      (reportPreviewPpcData?.data?.keywords?.length ?? 0) > 0 ||
                      (reportPreviewPpcData?.data?.conversions?.length ?? 0) > 0
                    ) ? (
                      <div className="space-y-6">
                        {reportPreviewPpcData?.data?.summary && (
                          <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                                <div className="text-xs font-medium text-blue-600 mb-1">Clicks</div>
                                <div className="text-2xl font-bold text-blue-900">
                                  {Number(reportPreviewPpcData.data.summary.clicks ?? 0).toLocaleString()}
                                </div>
                              </div>
                              <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-100">
                                <div className="text-xs font-medium text-indigo-600 mb-1">Impressions</div>
                                <div className="text-2xl font-bold text-indigo-900">
                                  {Number(reportPreviewPpcData.data.summary.impressions ?? 0).toLocaleString()}
                                </div>
                              </div>
                              <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                                <div className="text-xs font-medium text-green-600 mb-1">Conversions</div>
                                <div className="text-2xl font-bold text-green-900">
                                  {Number(reportPreviewPpcData.data.summary.conversions ?? 0).toLocaleString()}
                                </div>
                              </div>
                              <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
                                <div className="text-xs font-medium text-purple-600 mb-1">Cost</div>
                                <div className="text-2xl font-bold text-purple-900">
                                  ${Number(reportPreviewPpcData.data.summary.cost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div className="bg-white rounded-lg p-4 border border-gray-200">
                                <div className="text-xs font-medium text-gray-600 mb-1">Avg CPC</div>
                                <div className="text-xl font-semibold text-gray-900">
                                  ${Number(reportPreviewPpcData.data.summary.avgCpc ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                              </div>
                              <div className="bg-white rounded-lg p-4 border border-gray-200">
                                <div className="text-xs font-medium text-gray-600 mb-1">Cost / Conversion</div>
                                <div className="text-xl font-semibold text-gray-900">
                                  ${Number(reportPreviewPpcData.data.summary.costPerConversion ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                              </div>
                              <div className="bg-white rounded-lg p-4 border border-gray-200">
                                <div className="text-xs font-medium text-gray-600 mb-1">CTR</div>
                                <div className="text-xl font-semibold text-gray-900">
                                  {Number(reportPreviewPpcData.data.summary.impressions ?? 0) > 0
                                    ? ((Number(reportPreviewPpcData.data.summary.clicks ?? 0) / Number(reportPreviewPpcData.data.summary.impressions ?? 0)) * 100).toFixed(2)
                                    : "0.00"}
                                  %
                                </div>
                              </div>
                              <div className="bg-white rounded-lg p-4 border border-gray-200">
                                <div className="text-xs font-medium text-gray-600 mb-1">Conversion Rate</div>
                                <div className="text-xl font-semibold text-gray-900">
                                  {Number(reportPreviewPpcData.data.summary.conversionRate ?? 0).toFixed(2)}%
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                        <div className="overflow-x-auto border border-gray-200 rounded-lg">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Clicks</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Impressions</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">CTR</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Conversions</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Conv. Rate</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Avg CPC</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Cost/Conv.</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {reportPreviewPpcData.data.campaigns.map((campaign: any, idx: number) => {
                                const ctr = Number(campaign.impressions ?? 0) > 0
                                  ? ((Number(campaign.clicks ?? 0) / Number(campaign.impressions ?? 0)) * 100).toFixed(2)
                                  : "0.00";
                                const convRate = Number(campaign.clicks ?? 0) > 0
                                  ? ((Number(campaign.conversions ?? 0) / Number(campaign.clicks ?? 0)) * 100).toFixed(2)
                                  : "0.00";
                                const cost = Number(campaign.cost ?? 0);
                                const conversions = Number(campaign.conversions ?? 0);
                                return (
                                  <tr key={idx} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                      <div className="flex items-center gap-2">
                                        <span>{campaign.name || "N/A"}</span>
                                        {campaign.status && (
                                          <span className={`px-2 py-0.5 rounded text-xs ${
                                            campaign.status === "ENABLED"
                                              ? "bg-green-100 text-green-800"
                                              : campaign.status === "PAUSED"
                                              ? "bg-yellow-100 text-yellow-800"
                                              : "bg-gray-100 text-gray-800"
                                          }`}>
                                            {campaign.status}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">{Number(campaign.clicks ?? 0).toLocaleString()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{Number(campaign.impressions ?? 0).toLocaleString()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{ctr}%</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">{Number(campaign.conversions ?? 0).toLocaleString()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{convRate}%</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                      ${cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                      ${Number(campaign.avgCpc ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                                      ${conversions > 0
                                        ? (cost / conversions).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                        : "0.00"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-3">Ad Groups</h3>
                          {reportPreviewPpcData?.data?.adGroups?.length > 0 ? (
                            <div className="overflow-x-auto border border-gray-200 rounded-lg">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ad Group</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Clicks</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Impressions</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">CTR</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Conversions</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Avg CPC</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {reportPreviewPpcData.data.adGroups.map((adGroup: any, idx: number) => {
                                    const ctr = Number(adGroup.impressions ?? 0) > 0
                                      ? ((Number(adGroup.clicks ?? 0) / Number(adGroup.impressions ?? 0)) * 100).toFixed(2)
                                      : "0.00";
                                    return (
                                      <tr key={idx} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{adGroup.name || "N/A"}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{adGroup.campaignName || "N/A"}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">{Number(adGroup.clicks ?? 0).toLocaleString()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{Number(adGroup.impressions ?? 0).toLocaleString()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{ctr}%</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">{Number(adGroup.conversions ?? 0).toLocaleString()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">${Number(adGroup.cost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">${Number(adGroup.avgCpc ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500">No ad group data available.</p>
                          )}
                        </div>

                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-3">Keywords</h3>
                          {reportPreviewPpcData?.data?.keywords?.length > 0 ? (
                            <div className="overflow-x-auto border border-gray-200 rounded-lg">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Keyword</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Match Type</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Clicks</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Impressions</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">CTR</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Imp. Share</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Conversions</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Avg CPC</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {reportPreviewPpcData.data.keywords.map((keyword: any, idx: number) => {
                                    const ctr = Number(keyword.impressions ?? 0) > 0
                                      ? ((Number(keyword.clicks ?? 0) / Number(keyword.impressions ?? 0)) * 100).toFixed(2)
                                      : "0.00";
                                    return (
                                      <tr key={idx} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{keyword.keyword || "N/A"}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{keyword.matchType || "UNKNOWN"}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{keyword.campaignName || "N/A"}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">{Number(keyword.clicks ?? 0).toLocaleString()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{Number(keyword.impressions ?? 0).toLocaleString()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{ctr}%</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{(Number(keyword.impressionShare ?? 0) * 100).toFixed(1)}%</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">{Number(keyword.conversions ?? 0).toLocaleString()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">${Number(keyword.cost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">${Number(keyword.avgCpc ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500">No keyword data available.</p>
                          )}
                        </div>

                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-3">Conversions</h3>
                          {reportPreviewPpcData?.data?.conversionsSummary && (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
                                <p className="text-sm text-green-700 font-medium">Total Conversions</p>
                                <p className="text-2xl font-bold text-green-900 mt-1">{Number(reportPreviewPpcData.data.conversionsSummary.totalConversions ?? 0).toLocaleString()}</p>
                              </div>
                              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                                <p className="text-sm text-blue-700 font-medium">Conversion Value</p>
                                <p className="text-2xl font-bold text-blue-900 mt-1">${Number(reportPreviewPpcData.data.conversionsSummary.conversionValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              </div>
                              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
                                <p className="text-sm text-purple-700 font-medium">Conversion Rate</p>
                                <p className="text-2xl font-bold text-purple-900 mt-1">{Number(reportPreviewPpcData.data.conversionsSummary.conversionRate ?? 0).toFixed(2)}%</p>
                              </div>
                            </div>
                          )}
                          {reportPreviewPpcData?.data?.conversions?.length > 0 ? (
                            <div className="overflow-x-auto border border-gray-200 rounded-lg">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conversion Action</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Campaign</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Conversions</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Clicks</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Cost/Conv.</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {reportPreviewPpcData.data.conversions.map((conversion: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-gray-50">
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{conversion.date ? new Date(conversion.date).toLocaleDateString() : "N/A"}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{conversion.conversionAction || "N/A"}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{conversion.campaignName || "N/A"}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">{Number(conversion.conversions ?? 0).toLocaleString()}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">${Number(conversion.conversionValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">{Number(conversion.clicks ?? 0).toLocaleString()}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">${Number(conversion.cost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">${Number(conversion.costPerConversion ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500">No conversion data available.</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-6">
                        <p className="text-sm text-gray-500">No PPC data available.</p>
                        <p className="text-xs text-gray-400 mt-1">Ensure your Google Ads account has active campaigns, ad groups, keywords, or conversions in this period.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Traffic Overview Card - aligned with SEO Overview metrics */}
                    <div className="bg-white rounded-xl p-6 shadow-md border border-gray-200">
                      <div className="flex items-center mb-4">
                        <Activity className="h-5 w-5 text-blue-500 mr-2" />
                        <h2 className="text-xl font-bold text-gray-900">Traffic Overview</h2>
                      </div>
                      <p className="text-sm text-gray-500 mb-4">Core visitor metrics for this reporting period.</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                          <div className="text-xs font-medium text-blue-600 mb-1">Web Visitors</div>
                          <div className="text-2xl font-bold text-blue-900">{Number(serverReport?.totalUsers ?? serverReport?.activeUsers ?? 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                          <div className="text-xs font-medium text-green-600 mb-1">Organic Traffic</div>
                          <div className="text-2xl font-bold text-green-900">{Number(serverReport?.organicSearchEngagedSessions ?? 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-4 border border-purple-100">
                          <div className="text-xs font-medium text-purple-600 mb-1">First Time Visitors</div>
                          <div className="text-2xl font-bold text-purple-900">{Number(serverReport?.newUsers ?? 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-orange-50 rounded-lg p-4 border border-orange-100">
                          <div className="text-xs font-medium text-orange-600 mb-1">Engaged Visitors</div>
                          <div className="text-2xl font-bold text-orange-900">{Number(serverReport?.engagedVisitors ?? serverReport?.engagedSessions ?? 0).toLocaleString()}</div>
                        </div>
                      </div>
                    </div>

                    {/* Target Keywords — split by Money / Topical */}
                    {reportPreviewTargetKeywordsError && (
                      <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                        {reportPreviewTargetKeywordsError}
                      </div>
                    )}
                    {reportPreviewTargetKeywordsLoading ? (
                      <div className="bg-white rounded-xl p-6 shadow-md border border-gray-200">
                        <div className="flex items-center justify-center py-8 text-gray-500">
                          <Loader2 className="h-5 w-5 animate-spin mr-2" />
                          <span>Loading target keywords…</span>
                        </div>
                      </div>
                    ) : (
                      <>
                    {/* Money Keywords */}
                    {(() => {
                      const moneyKws = reportPreviewTargetKeywords.filter((k) => (k.type || "money") === "money");
                      return (
                        <div className="bg-white rounded-xl p-6 shadow-md border border-gray-200">
                          <div className="flex items-center mb-4">
                            <DollarSign className="h-5 w-5 text-emerald-600 mr-2" />
                            <h2 className="text-xl font-bold text-gray-900">Money Keywords</h2>
                            <span className="ml-2 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">{moneyKws.length}</span>
                          </div>
                          <p className="text-sm text-gray-500 mb-4">High-intent keywords that drive qualified opportunities.</p>
                          {moneyKws.length === 0 ? (
                            <div className="p-6 text-center text-gray-500 bg-gray-50 rounded-lg border border-gray-200">
                              <DollarSign className="h-10 w-10 mx-auto mb-2 text-gray-400" />
                              <p>No money keywords tracked yet.</p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto border border-gray-200 rounded-lg">
                              <table className="min-w-full">
                                <thead className="bg-gradient-to-r from-emerald-50 to-green-50 border-b-2 border-emerald-200">
                                  <tr>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Keyword</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Location</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Date Added</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Position</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Change</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">SERP Features</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">URL</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {moneyKws.map((k) => {
                                    const current = typeof k.googlePosition === "number" ? k.googlePosition : null;
                                    const prev = typeof k.previousPosition === "number" ? k.previousPosition : null;
                                    const diff = current != null && prev != null ? prev - current : null;
                                    const diffText = diff == null ? "—" : diff === 0 ? "0" : diff > 0 ? `+${diff}` : `${diff}`;
                                    const serp = toStringArray(k.serpItemTypes).slice(0, 3).join(", ") || "—";
                                    const isRanked = current !== null && current <= 10;
                                    const isTop3 = current !== null && current <= 3;
                                    return (
                                      <tr key={k.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap">
                                          <div className="flex items-center">
                                            {isTop3 && <Trophy className="h-4 w-4 text-yellow-500 mr-2" />}
                                            <span className="font-semibold text-gray-900">{k.keyword}</span>
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{k.locationName || "United States"}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{k.createdAt ? new Date(k.createdAt).toLocaleDateString() : "—"}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                          {current !== null ? (
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isTop3 ? 'bg-green-100 text-green-800' : isRanked ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>{current}</span>
                                          ) : <span className="text-gray-400">—</span>}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                          {diff !== null ? (
                                            <div className="flex items-center">
                                              {diff > 0 ? <TrendingUp className="h-4 w-4 text-green-500 mr-1" /> : diff < 0 ? <TrendingDown className="h-4 w-4 text-red-500 mr-1" /> : null}
                                              <span className={`text-sm font-medium ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-600'}`}>{diffText}</span>
                                            </div>
                                          ) : <span className="text-gray-400">—</span>}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                                          <div className="flex flex-wrap gap-1">
                                            {serp !== "—" ? serp.split(", ").map((feature, idx) => (
                                              <span key={idx} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{feature}</span>
                                            )) : <span className="text-gray-400">—</span>}
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600 break-all max-w-xs">
                                          {k.googleUrl ? (
                                            <a className="text-blue-600 hover:text-blue-800 underline truncate block" href={k.googleUrl} target="_blank" rel="noreferrer" title={k.googleUrl}>
                                              {k.googleUrl.length > 50 ? `${k.googleUrl.substring(0, 50)}...` : k.googleUrl}
                                            </a>
                                          ) : <span className="text-gray-400">—</span>}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Topical Keywords */}
                    {(() => {
                      const topicalKws = reportPreviewTargetKeywords.filter((k) => (k.type || "money") === "topical");
                      return (
                        <div className="bg-white rounded-xl p-6 shadow-md border border-gray-200">
                          <div className="flex items-center mb-4">
                            <BookOpen className="h-5 w-5 text-blue-600 mr-2" />
                            <h2 className="text-xl font-bold text-gray-900">Topical Keywords</h2>
                            <span className="ml-2 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-700">{topicalKws.length}</span>
                          </div>
                          <p className="text-sm text-gray-500 mb-4">Supportive topic coverage and informational discovery terms.</p>
                          {topicalKws.length === 0 ? (
                            <div className="p-6 text-center text-gray-500 bg-gray-50 rounded-lg border border-gray-200">
                              <BookOpen className="h-10 w-10 mx-auto mb-2 text-gray-400" />
                              <p>No topical keywords tracked yet.</p>
                            </div>
                          ) : (
                            <div className="overflow-x-auto border border-gray-200 rounded-lg">
                              <table className="min-w-full">
                                <thead className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b-2 border-blue-200">
                                  <tr>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Keyword</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Location</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Date Added</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Position</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Change</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">SERP Features</th>
                                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">URL</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {topicalKws.map((k) => {
                                    const current = typeof k.googlePosition === "number" ? k.googlePosition : null;
                                    const prev = typeof k.previousPosition === "number" ? k.previousPosition : null;
                                    const diff = current != null && prev != null ? prev - current : null;
                                    const diffText = diff == null ? "—" : diff === 0 ? "0" : diff > 0 ? `+${diff}` : `${diff}`;
                                    const serp = toStringArray(k.serpItemTypes).slice(0, 3).join(", ") || "—";
                                    const isRanked = current !== null && current <= 10;
                                    const isTop3 = current !== null && current <= 3;
                                    return (
                                      <tr key={k.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap">
                                          <div className="flex items-center">
                                            {isTop3 && <Trophy className="h-4 w-4 text-yellow-500 mr-2" />}
                                            <span className="font-semibold text-gray-900">{k.keyword}</span>
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{k.locationName || "United States"}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{k.createdAt ? new Date(k.createdAt).toLocaleDateString() : "—"}</td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                          {current !== null ? (
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isTop3 ? 'bg-green-100 text-green-800' : isRanked ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>{current}</span>
                                          ) : <span className="text-gray-400">—</span>}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap">
                                          {diff !== null ? (
                                            <div className="flex items-center">
                                              {diff > 0 ? <TrendingUp className="h-4 w-4 text-green-500 mr-1" /> : diff < 0 ? <TrendingDown className="h-4 w-4 text-red-500 mr-1" /> : null}
                                              <span className={`text-sm font-medium ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-600'}`}>{diffText}</span>
                                            </div>
                                          ) : <span className="text-gray-400">—</span>}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                                          <div className="flex flex-wrap gap-1">
                                            {serp !== "—" ? serp.split(", ").map((feature, idx) => (
                                              <span key={idx} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{feature}</span>
                                            )) : <span className="text-gray-400">—</span>}
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600 break-all max-w-xs">
                                          {k.googleUrl ? (
                                            <a className="text-blue-600 hover:text-blue-800 underline truncate block" href={k.googleUrl} target="_blank" rel="noreferrer" title={k.googleUrl}>
                                              {k.googleUrl.length > 50 ? `${k.googleUrl.substring(0, 50)}...` : k.googleUrl}
                                            </a>
                                          ) : <span className="text-gray-400">—</span>}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                      </>
                    )}
                  </>
                )}

                {selectedReport?.scheduleKind !== "ppc" && (
                  <div className="bg-white rounded-xl p-6 shadow-md border border-gray-200">
                    <div className="flex items-center mb-4">
                      <Share2 className="h-5 w-5 text-purple-500 mr-2" />
                      <h2 className="text-xl font-bold text-gray-900">Live Dashboard</h2>
                    </div>
                    <p className="text-sm text-gray-500 mb-4">Share this live report URL to provide read-only visibility.</p>
                    {reportPreviewShareLoading ? (
                      <div className="flex items-center justify-center py-8 text-gray-500">
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                        <span>Generating share link…</span>
                      </div>
                    ) : reportPreviewShareUrl ? (
                      <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                        <a
                          className="text-purple-700 hover:text-purple-900 underline break-all font-medium flex items-center"
                          href={reportPreviewShareUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Share2 className="h-4 w-4 mr-2" />
                          {reportPreviewShareUrl}
                        </a>
                      </div>
                    ) : (
                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-gray-500">
                        Share link unavailable.
                      </div>
                    )}
                  </div>
                )}

                {/* Hide the old dashboard-style preview */}
                <div className="hidden">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Web Visitors</p>
                        <p className="text-2xl font-bold text-gray-900">{websiteVisitorsDisplay}</p>
                      </div>
                      <Users className="h-8 w-8 text-blue-500" />
                    </div>
                    {ga4Connected ? (
                      <div className="mt-4 flex items-center space-x-2">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        <span className="text-sm text-green-600">Real-time data from GA4</span>
                      </div>
                    ) : (
                      <div className="mt-4">
                        <span className="text-xs text-gray-500">Connect GA4 to view data</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Organic Traffic</p>
                        <p className="text-2xl font-bold text-gray-900">{organicTrafficDisplay}</p>
                      </div>
                      <Search className="h-8 w-8 text-green-500" />
                    </div>
                    {ga4Connected ? (
                      <div className="mt-4 flex items-center space-x-2">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        <span className="text-sm text-green-600">Real-time data from GA4</span>
                      </div>
                    ) : (
                      <div className="mt-4">
                        <span className="text-xs text-gray-500">Connect GA4 to view data</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">First Time Visitors</p>
                        <p className="text-2xl font-bold text-gray-900">{firstTimeVisitorsDisplay}</p>
                      </div>
                      <UserPlus className="h-8 w-8 text-purple-500" />
                    </div>
                    {ga4Connected ? (
                      <div className="mt-4 flex items-center space-x-2">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        <span className="text-sm text-green-600">Real-time data from GA4</span>
                      </div>
                    ) : (
                      <div className="mt-4">
                        <span className="text-xs text-gray-500">Connect GA4 to view data</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600">Engaged Visitors</p>
                        <p className="text-2xl font-bold text-gray-900">{engagedVisitorsDisplay}</p>
                      </div>
                      <Activity className="h-8 w-8 text-orange-500" />
                    </div>
                    {ga4Connected ? (
                      <div className="mt-4 flex items-center space-x-2">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        <span className="text-sm text-green-600">Real-time data from GA4</span>
                      </div>
                    ) : (
                      <div className="mt-4">
                        <span className="text-xs text-gray-500">Connect GA4 to view data</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">New Users Trending</h3>
                      {fetchingSummary && <span className="text-xs text-gray-400">Updating...</span>}
                    </div>
                    <div className="h-64">
                      {ga4Connected ? (
                        newUsersTrendData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={newUsersTrendData}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="name" />
                              <YAxis />
                              <Tooltip isAnimationActive={false} contentStyle={{ pointerEvents: "none" }} />
                              <Legend />
                              <Line type="monotone" dataKey="newUsers" stroke="#3B82F6" strokeWidth={2} isAnimationActive={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-full flex items-center justify-center text-sm text-gray-500">
                            No GA4 new-user data for this date range.
                          </div>
                        )
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-gray-500">
                          Connect GA4 to view this chart.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Total Users Trending</h3>
                    <div className="h-64">
                      {ga4Connected ? (
                        totalUsersTrendData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={totalUsersTrendData}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="name" />
                              <YAxis />
                              <Tooltip isAnimationActive={false} contentStyle={{ pointerEvents: "none" }} />
                              <Legend />
                              <Line type="monotone" dataKey="totalUsers" name="Total Users" stroke="#10B981" strokeWidth={2} isAnimationActive={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-full flex items-center justify-center text-sm text-gray-500">
                            No GA4 total-user data for this date range.
                          </div>
                        )
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-gray-500">
                          Connect GA4 to view this chart.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <RankedKeywordsOverview
                  clientId={clientId || ""}
                  clientName={client?.name}
                  title="Total Keywords Ranked"
                  subtitle="Monitor how many organic keywords this client ranks for and how that total changes month-to-month."
                  enableRefresh={false}
                  refreshKey={seoOverviewWidgetsRefreshKey}
                />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white p-4 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold text-gray-900">Traffic Sources</h3>
                    </div>
                    {trafficSourcesError && (
                      <p className="mb-3 text-sm text-rose-600">
                        {trafficSourcesError}
                      </p>
                    )}
                    <div className="h-56">
                      {trafficSourcesLoading ? (
                        <div className="flex items-center justify-center h-full">
                          <p className="text-sm text-gray-500">Loading traffic sources...</p>
                        </div>
                      ) : trafficSourcesWithCompare.length === 0 ? (
                        <div className="flex items-center justify-center h-full">
                          <p className="text-sm text-gray-500">No traffic sources data available.</p>
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={trafficSourcesWithCompare}
                            layout="vertical"
                            margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" />
                            <YAxis 
                              dataKey="name" 
                              type="category" 
                              width={70}
                              tick={{ fontSize: 12 }}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '4px' }}
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const entry = payload[0].payload as TrafficSourceSlice & { previousValue?: number };
                                const current = entry.value ?? 0;
                                const previous = entry.previousValue;
                                const change = previous != null && previous !== 0 ? formatPercentChange(current, previous) : null;
                                return (
                                  <div className="px-3 py-2 text-sm">
                                    <p className="font-medium text-gray-900">{entry.name}</p>
                                    <p className="text-gray-700">Current: {current.toLocaleString()}</p>
                                    {previous != null && <p className="text-gray-600">Previous: {previous.toLocaleString()}</p>}
                                    {change != null && (
                                      <p className={`font-medium ${change.isPositive ? "text-green-600" : "text-red-600"}`}>{change.text}</p>
                                    )}
                                  </div>
                                );
                              }}
                            />
                            <Bar 
                              dataKey="value" 
                              radius={[0, 4, 4, 0]}
                              name="Current"
                            >
                              {trafficSourcesWithCompare.map((entry, index) => (
                                <Cell
                                  key={`traffic-source-${entry.name}-${index}`}
                                  fill={entry.color || TRAFFIC_SOURCE_COLORS.Other}
                                />
                              ))}
                            </Bar>
                            {trafficSourcesCompare.length > 0 && (
                              <Bar 
                                dataKey="previousValue" 
                                radius={[0, 4, 4, 0]}
                                name={compareTo === "previous_year" ? "Previous year" : "Previous period"}
                                fill="#94a3b8"
                                fillOpacity={0.8}
                              />
                            )}
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold text-gray-900">AI Search Visibility</h3>
                    </div>

                    {aiSearchError && <p className="mb-3 text-sm text-rose-600">{aiSearchError}</p>}

                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="grid grid-cols-4 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
                        <div>AI Search</div>
                        <div className="text-center">AI Visibility</div>
                        <div className="text-center">Mentions</div>
                        <div className="text-center">Cited Pages</div>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {aiSearchLoading ? (
                          <div className="px-3 py-4 text-sm text-gray-500">Loading AI Search visibility...</div>
                        ) : (aiSearchRows?.length || 0) === 0 ? (
                          <div className="px-3 py-4 text-sm text-gray-500">No AI Search visibility data available.</div>
                        ) : (
                          ([
                            { name: "ChatGPT", dotClass: "bg-gray-900" },
                            { name: "AI Overview", dotClass: "bg-blue-600" },
                            { name: "AI Mode", dotClass: "bg-red-500" },
                            { name: "Gemini", dotClass: "bg-green-600" },
                          ] as const).map((meta) => {
                            const row =
                              aiSearchRows.find((r) => r.name === meta.name) ||
                              ({ name: meta.name, visibility: 0, mentions: 0, citedPages: 0 } as AiSearchVisibilityRow);
                            const visibilityDisplay = `${Number(row.visibility || 0)}%`;
                            return (
                              <div key={meta.name} className="grid grid-cols-4 px-3 py-2 text-sm">
                                <div className="flex items-center gap-2 text-gray-900">
                                  <span className={`h-2.5 w-2.5 rounded-full ${meta.dotClass}`} />
                                  <span className="font-medium">{meta.name}</span>
                                </div>
                                <div className="text-center text-gray-900">{visibilityDisplay}</div>
                                <div className="text-center text-gray-900">{Number(row.mentions || 0).toLocaleString()}</div>
                                <div className="text-center text-gray-900">{Number(row.citedPages || 0).toLocaleString()}</div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200">
                  <div className="p-6 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Top Pages</h3>
                    {topPagesError && (
                      <p className="mt-2 text-sm text-rose-600">
                        {topPagesError}
                      </p>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Page</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Keywords</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Est. Traffic (ETV)</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Top 1</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Top 2-3</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Top 4-10</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Movement</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Paid Traffic</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {topPagesLoading ? (
                          <tr>
                            <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                              Loading top pages...
                            </td>
                          </tr>
                        ) : resolvedTopPages.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                              No top pages data available.
                            </td>
                          </tr>
                        ) : (
                          resolvedTopPages.map((page, index) => (
                            <tr key={`${page.url}-${index}`} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <a
                                  href={page.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm font-medium text-blue-600 hover:text-blue-800 break-all"
                                >
                                  {page.url}
                                </a>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {topPagesLoading ? "..." : formatNumber(page.keywords)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {topPagesLoading ? "..." : formatNumber(page.estimatedTraffic)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {topPagesLoading ? "..." : formatNumber(page.top1)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {topPagesLoading ? "..." : formatNumber(page.top3)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {topPagesLoading ? "..." : formatNumber(page.top10)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                                {topPagesLoading ? (
                                  <span>...</span>
                                ) : (
                                  <div className="flex flex-col items-end space-y-1">
                                    {page.newKeywords > 0 && (
                                      <div className="flex items-center gap-1 text-green-600">
                                        <Plus className="h-3.5 w-3.5" />
                                        <span>{formatNumber(page.newKeywords)}</span>
                                      </div>
                                    )}
                                    {page.upKeywords > 0 && (
                                      <div className="flex items-center gap-1 text-blue-600">
                                        <TrendingUp className="h-3.5 w-3.5" />
                                        <span>{formatNumber(page.upKeywords)}</span>
                                      </div>
                                    )}
                                    {page.downKeywords > 0 && (
                                      <div className="flex items-center gap-1 text-orange-600">
                                        <TrendingDown className="h-3.5 w-3.5" />
                                        <span>{formatNumber(page.downKeywords)}</span>
                                      </div>
                                    )}
                                    {page.lostKeywords > 0 && (
                                      <div className="flex items-center gap-1 text-rose-600">
                                        <X className="h-3.5 w-3.5" />
                                        <span>{formatNumber(page.lostKeywords)}</span>
                                      </div>
                                    )}
                                    {page.newKeywords === 0 && page.upKeywords === 0 && page.downKeywords === 0 && page.lostKeywords === 0 && (
                                      <span className="text-gray-400">—</span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {topPagesLoading ? "..." : formatNumber(page.paidTraffic)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200">
                  <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">New Links</h3>
                      <p className="text-sm text-gray-500">Weekly backlinks acquired (last 4 weeks)</p>
                    </div>
                  </div>
                  <div className="p-6 space-y-4">
                    {backlinksForChartLoading ? (
                      <p className="text-sm text-gray-500">Loading backlink trends...</p>
                    ) : backlinksForChartError ? (
                      <p className="text-sm text-red-600">{backlinksForChartError}</p>
                    ) : backlinksForChart.newRows.length === 0 && backlinksForChart.lostRows.length === 0 ? (
                      <p className="text-sm text-gray-500">No backlink data available yet.</p>
                    ) : (() => {
                      const maxNewBacklinks =
                        weeklyBacklinkTimeseries.reduce((acc, cur) => Math.max(acc, cur.newBacklinks), 0) || 1;

                      return weeklyBacklinkTimeseries.map((item) => {
                        const widthPercent =
                          item.newBacklinks === 0 ? 2 : Math.max((item.newBacklinks / maxNewBacklinks) * 100, 2);

                        return (
                          <div key={item.key} className="space-y-1">
                            <div className="flex items-center justify-between text-xs text-gray-500">
                              <span>{item.label}</span>
                              <span
                                className={`font-medium ${
                                  item.newBacklinks === 0 ? "text-gray-900" : "text-emerald-600"
                                }`}
                              >
                                {`${item.newBacklinks} new`}
                              </span>
                            </div>
                            <div className="flex items-center space-x-3">
                              <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary-500 rounded-full"
                                  style={{ width: `${widthPercent}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-600 whitespace-nowrap">
                                {`-${item.lostBacklinks} lost`}
                              </span>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200">
              <button
                onClick={handleCloseViewModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
              <button
                onClick={async () => {
                   if (!modalDashboardContentRef.current) {
                     toast.error("Unable to export. Please try again.");
                     return;
                   }
                   const element = modalDashboardContentRef.current;
                   const previousOverflow = document.body.style.overflow;

                   const scrollableContainer = element.closest('.overflow-y-auto') as HTMLElement;
                   const originalScrollTop = scrollableContainer?.scrollTop || 0;

                   try {
                     setExportingPdf(true);
                     document.body.style.overflow = "hidden";

                     if (scrollableContainer) {
                       scrollableContainer.scrollTop = 0;
                       await new Promise(resolve => setTimeout(resolve, 300));
                     }

                     const sections = Array.from(element.children).filter(
                       (el) => el instanceof HTMLElement && el.offsetHeight > 0
                     ) as HTMLElement[];
                     if (sections.length === 0) {
                       toast.error("No sections found to export.");
                       setExportingPdf(false);
                       return;
                     }

                     const ignoreFilter = (el: Element) => el.getAttribute?.("data-pdf-hide") === "true";
                     const sectionCanvases: HTMLCanvasElement[] = [];
                     for (const sec of sections) {
                       const cvs = await html2canvas(sec, {
                         scale: 2,
                         useCORS: true,
                         scrollY: -window.scrollY,
                         scrollX: -window.scrollX,
                         backgroundColor: "#FFFFFF",
                         ignoreElements: ignoreFilter,
                       });
                       sectionCanvases.push(cvs);
                     }

                     const pdf = new jsPDF("p", "mm", "a4");
                     const pageWidth = pdf.internal.pageSize.getWidth();
                     const pageHeight = pdf.internal.pageSize.getHeight();

                     const websiteName = client?.name || client?.domain || "Report";
                     const domain = client?.domain || "";
                     const generatedDate = format(new Date(), "MMMM d, yyyy");
                     const periodLabel = selectedReport?.name || (serverReport?.period
                       ? String(serverReport.period).charAt(0).toUpperCase() + String(serverReport.period).slice(1) + " Report"
                       : "SEO Report");

                     const marginX = 12;
                     const headerH = 16;
                     const footerH = 10;
                     const contentMarginTop = headerH + 3;
                     const contentMarginBottom = footerH + 2;
                     const usableWidth = pageWidth - marginX * 2;
                     const usableHeight = pageHeight - contentMarginTop - contentMarginBottom;
                     const sectionGap = 4;

                     const drawHeader = () => {
                       pdf.setFillColor(15, 23, 42);
                       pdf.rect(0, 0, pageWidth, headerH, "F");
                       pdf.setFillColor(59, 130, 246);
                       pdf.rect(0, headerH, pageWidth, 0.8, "F");
                       pdf.setFont("helvetica", "bold");
                       pdf.setFontSize(11);
                       pdf.setTextColor(255, 255, 255);
                       pdf.text(websiteName, marginX, 7);
                       if (domain) {
                         pdf.setFont("helvetica", "normal");
                         pdf.setFontSize(8);
                         pdf.setTextColor(148, 163, 184);
                         pdf.text(domain, marginX, 12);
                       }
                       pdf.setFont("helvetica", "normal");
                       pdf.setFontSize(8);
                       pdf.setTextColor(148, 163, 184);
                       pdf.text(periodLabel, pageWidth - marginX, 7, { align: "right" });
                       pdf.text(generatedDate, pageWidth - marginX, 12, { align: "right" });
                     };

                     const drawFooter = (pageNum: number, totalPages: number) => {
                       const footerY = pageHeight - footerH / 2;
                       pdf.setDrawColor(226, 232, 240);
                       pdf.setLineWidth(0.3);
                       pdf.line(marginX, pageHeight - footerH, pageWidth - marginX, pageHeight - footerH);
                       pdf.setFont("helvetica", "normal");
                       pdf.setFontSize(8);
                       pdf.setTextColor(100, 116, 139);
                       pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth / 2, footerY, { align: "center" });
                       pdf.setFontSize(7);
                       pdf.setTextColor(148, 163, 184);
                       pdf.text(`Generated ${generatedDate}`, marginX, footerY);
                       pdf.text("Confidential", pageWidth - marginX, footerY, { align: "right" });
                     };

                     // Cover page
                     pdf.setFillColor(15, 23, 42);
                     pdf.rect(0, 0, pageWidth, pageHeight, "F");
                     pdf.setFillColor(59, 130, 246);
                     pdf.rect(0, 0, pageWidth, 3, "F");
                     pdf.setFont("helvetica", "normal");
                     pdf.setFontSize(11);
                     pdf.setTextColor(148, 163, 184);
                     const labelY = pageHeight * 0.32;
                    pdf.text(
                      selectedReport?.scheduleKind === "ppc" ? "PPC ANALYTICS REPORT" : "SEO ANALYTICS REPORT",
                      pageWidth / 2,
                      labelY,
                      { align: "center" }
                    );
                     const lineW = 50;
                     pdf.setDrawColor(59, 130, 246);
                     pdf.setLineWidth(0.6);
                     pdf.line(pageWidth / 2 - lineW / 2, labelY + 4, pageWidth / 2 + lineW / 2, labelY + 4);
                     pdf.setFont("helvetica", "bold");
                     pdf.setFontSize(28);
                     pdf.setTextColor(255, 255, 255);
                     pdf.text(websiteName, pageWidth / 2, labelY + 18, { align: "center" });
                     if (domain) {
                       pdf.setFont("helvetica", "normal");
                       pdf.setFontSize(12);
                       pdf.setTextColor(148, 163, 184);
                       pdf.text(domain, pageWidth / 2, labelY + 28, { align: "center" });
                     }
                     pdf.setFont("helvetica", "normal");
                     pdf.setFontSize(10);
                     pdf.setTextColor(100, 116, 139);
                     pdf.text(`${periodLabel}  ·  ${generatedDate}`, pageWidth / 2, labelY + 42, { align: "center" });
                     pdf.setFillColor(59, 130, 246);
                     pdf.rect(0, pageHeight - 3, pageWidth, 3, "F");

                     // Section-based content pages
                     // Calculate natural height, then cap oversized sections to fit one page
                     const sectionNaturalHeights = sectionCanvases.map((cvs) => (cvs.height * usableWidth) / cvs.width);
                     const sectionHeights = sectionNaturalHeights.map((h) => Math.min(h, usableHeight));
                     const sectionScales = sectionNaturalHeights.map((h) =>
                       h > usableHeight ? usableHeight / h : 1
                     );

                     const pageAssignments: { pageIdx: number; cursorY: number; sectionIdx: number }[] = [];
                     let curPage = 0;
                     let cursorY = 0;
                     for (let i = 0; i < sectionCanvases.length; i++) {
                       const h = sectionHeights[i];
                       const fitsOnCurrentPage = cursorY === 0 || cursorY + sectionGap + h <= usableHeight;
                       if (!fitsOnCurrentPage) {
                         curPage++;
                         cursorY = 0;
                       }
                       const yPos = cursorY === 0 ? 0 : cursorY + sectionGap;
                       pageAssignments.push({ pageIdx: curPage, cursorY: yPos, sectionIdx: i });
                       cursorY = yPos + h;
                     }
                     const totalContentPages = curPage + 1;
                     const totalPages = 1 + totalContentPages;

                     let currentPageRendered = -1;
                     for (const assignment of pageAssignments) {
                       if (assignment.pageIdx !== currentPageRendered) {
                         pdf.addPage();
                         drawHeader();
                         currentPageRendered = assignment.pageIdx;
                       }
                       const idx = assignment.sectionIdx;
                       const scale = sectionScales[idx];
                       const imgW = usableWidth * scale;
                       const imgH = sectionHeights[idx];
                       const imgX = marginX + (usableWidth - imgW) / 2;
                       const sectionImgData = sectionCanvases[idx].toDataURL("image/png");
                       pdf.addImage(sectionImgData, "PNG", imgX, contentMarginTop + assignment.cursorY, imgW, imgH);
                     }

                     for (let p = 0; p < totalContentPages; p++) {
                       pdf.setPage(p + 2);
                       drawFooter(p + 2, totalPages);
                     }

                     pdf.setPage(1);
                     pdf.setFont("helvetica", "normal");
                     pdf.setFontSize(7);
                     pdf.setTextColor(100, 116, 139);
                     pdf.text(`Page 1 of ${totalPages}`, pageWidth / 2, pageHeight - 8, { align: "center" });

                     const sanitizedName = client?.name
                       ? client.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()
                       : "report";
                     const fileName = `${sanitizedName}-report-${format(new Date(), "yyyyMMdd")}.pdf`;
                     pdf.save(fileName);
                     toast.success("Report exported successfully!");

                     if (scrollableContainer) {
                       scrollableContainer.scrollTop = originalScrollTop;
                     }
                   } catch (error: any) {
                     console.error("Failed to export report PDF", error);
                     toast.error(error?.message || "Failed to export report PDF. Please try again.");
                   } finally {
                     document.body.style.overflow = previousOverflow;
                     setExportingPdf(false);
                   }
                 }}
                disabled={exportingPdf}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {exportingPdf ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Exporting...</span>
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    <span>Export PDF</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
        , document.body
      )}

      {/* GA4 Property Selection Modal */}
      {showGA4Modal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Select GA4 Property</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    handleFetchGA4Properties(false, true); // Don't show modal again, but force refresh
                  }}
                  disabled={loadingProperties}
                  className="text-gray-400 hover:text-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Refresh properties list to see newly added GA4 access"
                >
                  <RefreshCw className={`h-5 w-5 ${loadingProperties ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => {
                    setShowGA4Modal(false);
                    setGa4PropertyId("");
                    setGa4Properties([]);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Select a Google Analytics 4 property to connect. These are all the properties accessible with your Google account. Click the refresh icon to update the list if you recently gained access to new properties.
            </p>
            
            {loadingProperties ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
                <span className="ml-2 text-gray-600">Loading properties...</span>
              </div>
            ) : ga4Properties.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No GA4 properties found.</p>
                <p className="text-sm mt-2">Please make sure you have access to at least one GA4 property.</p>
              </div>
            ) : (
              <>
                {/* Search Bar */}
                <div className="mb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search by property name, account, or property ID..."
                      value={ga4PropertySearch}
                      onChange={(e) => setGa4PropertySearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>
                </div>
                
                {(() => {
                  // Filter and sort properties
                  const filtered = ga4Properties.filter((property) => {
                    if (!ga4PropertySearch.trim()) return true;
                    const searchLower = ga4PropertySearch.toLowerCase();
                    return (
                      property.propertyName.toLowerCase().includes(searchLower) ||
                      property.accountName.toLowerCase().includes(searchLower) ||
                      property.propertyId.includes(searchLower) ||
                      property.displayName.toLowerCase().includes(searchLower)
                    );
                  });
                  
                  // Sort alphabetically by property name
                  const sorted = filtered.sort((a, b) => 
                    a.propertyName.localeCompare(b.propertyName)
                  );

                  if (sorted.length === 0 && ga4PropertySearch.trim()) {
                    return (
                      <div className="text-center py-8 text-gray-500 border border-gray-200 rounded-lg">
                        <p>No properties found matching "{ga4PropertySearch}"</p>
                        <p className="text-sm mt-2">Try a different search term</p>
                      </div>
                    );
                  }

                  return (
                    <div className="flex-1 overflow-y-auto mb-4 border border-gray-200 rounded-lg">
                      <div className="divide-y divide-gray-200">
                        {sorted.map((property) => (
                      <button
                        key={property.propertyId}
                        onClick={() => handleSubmitPropertyId(property.propertyId)}
                        disabled={ga4Connecting}
                        className="w-full text-left p-4 hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">{property.propertyName}</div>
                            <div className="text-sm text-gray-500 mt-1">
                              Account: {property.accountName}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              Property ID: {property.propertyId}
                            </div>
                          </div>
                          {ga4Connecting ? (
                            <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                          ) : (
                            <div className="text-primary-600">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                
                <div className="flex items-center justify-end">
                  <button
                    onClick={() => {
                      setShowGA4Modal(false);
                      setGa4PropertyId("");
                      setGa4Properties([]);
                      setGa4PropertySearch("");
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Google Ads Customer Selection Modal */}
      {showGoogleAdsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {googleAdsSelectedManager
                  ? "Select client account"
                  : "Select Google Ads Account"}
              </h3>
              <button
                onClick={() => {
                  setShowGoogleAdsModal(false);
                  setGoogleAdsCustomerId("");
                  setGoogleAdsCustomers([]);
                  setGoogleAdsSelectedManager(null);
                  setGoogleAdsChildAccounts([]);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {googleAdsSelectedManager ? (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  <span className="font-medium text-gray-700">{googleAdsSelectedManager.customerName}</span> is a manager account and has no campaign stats. Select the client account that has the PPC data for this client.
                </p>
                {loadingGoogleAdsChildAccounts ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
                    <span className="ml-2 text-gray-600">Loading client accounts...</span>
                  </div>
                ) : googleAdsChildAccounts.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>No client accounts found under this manager.</p>
                    <button
                      onClick={() => { setGoogleAdsSelectedManager(null); setGoogleAdsChildAccounts([]); }}
                      className="mt-3 text-primary-600 hover:underline"
                    >
                      Back to account list
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 overflow-y-auto mb-4 border border-gray-200 rounded-lg">
                      <div className="divide-y divide-gray-200">
                        {googleAdsChildAccounts.map((child) => (
                          <button
                            key={child.customerId}
                            onClick={() => handleSubmitGoogleAdsCustomerId(child.customerId, googleAdsSelectedManager?.customerId)}
                            disabled={googleAdsConnecting}
                            className="w-full text-left p-4 hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="font-medium text-gray-900">{child.customerName}</div>
                                <div className="text-sm text-gray-500 mt-1">
                                  Customer ID: {child.customerId}
                                </div>
                                {child.status && (
                                  <div className="text-xs text-gray-400 mt-1">Status: {child.status}</div>
                                )}
                              </div>
                              {googleAdsConnecting ? (
                                <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                              ) : (
                                <div className="text-primary-600">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => { setGoogleAdsSelectedManager(null); setGoogleAdsChildAccounts([]); }}
                        className="px-4 py-2 text-gray-600 hover:text-gray-900"
                      >
                        ← Back to account list
                      </button>
                      <button
                        onClick={() => {
                          setShowGoogleAdsModal(false);
                          setGoogleAdsCustomerId("");
                          setGoogleAdsCustomers([]);
                          setGoogleAdsSelectedManager(null);
                          setGoogleAdsChildAccounts([]);
                        }}
                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  Select the active Google Ads account for this client. Each row shows account name and customer ID.
                </p>
                {loadingGoogleAdsCustomers ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
                    <span className="ml-2 text-gray-600">Loading accounts...</span>
                  </div>
                ) : googleAdsCustomers.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>No Google Ads accounts found.</p>
                    <p className="text-sm mt-2">Please make sure you have access to at least one Google Ads account.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 overflow-y-auto mb-4 border border-gray-200 rounded-lg">
                      <div className="divide-y divide-gray-200">
                        {googleAdsCustomers.map((customer) => (
                          <button
                            key={customer.customerId}
                            onClick={() => handleSelectGoogleAdsAccount(customer)}
                            disabled={googleAdsConnecting || loadingGoogleAdsChildAccounts}
                            className="w-full text-left p-4 hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-900">{customer.customerName}</span>
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                                    {String(customer.status || "PPC Active")}
                                  </span>
                                  {customer.isManager && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                      Manager account
                                    </span>
                                  )}
                                </div>
                                <div className="text-sm text-gray-500 mt-1">
                                  Customer ID: {customer.customerId}
                                </div>
                                <div className="text-xs text-gray-400 mt-1">
                                  Currency: {customer.currencyCode} | Timezone: {customer.timeZone}
                                </div>
                              </div>
                              {googleAdsConnecting || loadingGoogleAdsChildAccounts ? (
                                <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                              ) : (
                                <div className="text-primary-600">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => {
                          setShowGoogleAdsModal(false);
                          setGoogleAdsCustomerId("");
                          setGoogleAdsCustomers([]);
                          setGoogleAdsSelectedManager(null);
                          setGoogleAdsChildAccounts([]);
                        }}
                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
            </>
          )}
        </div>
      )}

      {/* View All Queries Modal */}
      {showAllQueriesModal && aiIntelligence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">All Queries Where You Appear in AI</h2>
                <p className="text-sm text-gray-500 mt-1">Total: {aiIntelligence.totalQueriesCount ?? 0} queries</p>
              </div>
              <button
                onClick={() => setShowAllQueriesModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-3">
                {(aiIntelligence.queriesWhereYouAppear ?? []).map((q, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-4 p-4 rounded-lg border border-gray-200 bg-gray-50/50 hover:bg-gray-50">
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{q.query}</p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1"><Search className="h-3.5 w-3.5" />{(q.aiVolPerMo ?? 0).toLocaleString()} AI vol/mo</span>
                        <span className="inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />{q.platforms}</span>
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold whitespace-nowrap">{q.mentions ?? 0} mentions</span>
                  </div>
                ))}
                {(aiIntelligence.queriesWhereYouAppear ?? []).length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Search className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm font-medium">No queries found</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Competitive Analysis Modal */}
      {showCompetitiveAnalysisModal && aiIntelligence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Full Competitive Analysis</h2>
                <p className="text-sm text-gray-500 mt-1">AI Visibility Score Comparison</p>
              </div>
              <button
                onClick={() => setShowCompetitiveAnalysisModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4 mb-6">
                {(aiIntelligence.competitors ?? []).map((c) => (
                  <div key={c.domain} className="flex items-center gap-4 p-4 rounded-lg border border-gray-200 bg-gray-50/50">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {c.isLeader && <Trophy className="h-5 w-5 text-amber-500 flex-shrink-0" />}
                      {c.isYou && <Users className="h-5 w-5 text-primary-600 flex-shrink-0" />}
                      <span className="font-medium text-gray-900 truncate">{c.label}{c.isYou ? " (YOU)" : ""}</span>
                    </div>
                    <div className="flex-1 max-w-xs">
                      <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${c.isYou ? "bg-primary-500" : "bg-gray-400"}`}
                          style={{ width: `${Math.min(100, c.score)}%` }}
                        />
                      </div>
                    </div>
                    <span className="font-semibold text-gray-900 w-12 text-right">{c.score}/100</span>
                    {c.trend != null && (
                      <span className={`text-sm font-medium w-16 text-right ${c.trend >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {c.trend >= 0 ? "+" : ""}{c.trend}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {(aiIntelligence.gapBehindLeader ?? 0) > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-900 mb-2">
                        Gap Alert: You&apos;re <strong>{aiIntelligence.gapBehindLeader} points behind the leader</strong>
                      </p>
                      <p className="text-xs text-amber-800">
                        Focus on increasing your AI mentions and search volume to close the gap with competitors.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-2 font-semibold text-gray-900 mb-2">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  Action Items:
                </div>
                <ul className="list-disc list-inside space-y-1 text-sm text-blue-900">
                  {(aiIntelligence.actionItems ?? []).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View All Contexts Modal */}
      {showAllContextsModal && aiIntelligence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">All AI Platform Mentions</h2>
                <p className="text-sm text-gray-500 mt-1">Total: {aiIntelligence.totalContextsCount ?? 0} contexts</p>
              </div>
              <button
                onClick={() => setShowAllContextsModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {(aiIntelligence.howAiMentionsYou ?? []).map((h, idx) => (
                  <div key={idx} className="p-4 rounded-lg border border-gray-200 bg-gray-50/30">
                    <p className="font-semibold text-gray-900">&quot;{h.query}&quot;</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="px-2 py-1 rounded-md bg-green-100 text-green-800 text-xs font-medium">{h.platform}</span>
                      <span className="px-2 py-1 rounded-md bg-gray-200 text-gray-700 text-xs font-medium">{(h.aiVolPerMo ?? 0).toLocaleString()} AI vol/mo</span>
                    </div>
                    <div className="mt-2 pl-3 border-l-2 border-primary-200 text-sm text-gray-600 italic">{h.snippet}</div>
                    <a href={h.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-primary-600 hover:underline break-all">
                      URL: {h.sourceUrl.replace(/^https?:\/\//, "")}
                    </a>
                    <div className="mt-2 flex justify-end">
                      <span className="px-2 py-1 rounded-md bg-green-100 text-green-800 text-xs font-medium">#{h.citationIndex} Citation</span>
                    </div>
                  </div>
                ))}
                {(aiIntelligence.howAiMentionsYou ?? []).length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Sparkles className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm font-medium">No contexts found</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientDashboardPage;



