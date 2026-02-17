import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from "recharts";
import { Download, TrendingUp, TrendingDown, Search, Users, Loader2, UserPlus, Activity } from "lucide-react";
import RankedKeywordsOverview from "@/components/RankedKeywordsOverview";
import TargetKeywordsOverview from "@/components/TargetKeywordsOverview";
import api from "@/lib/api";
import { endOfWeek, format, startOfWeek } from "date-fns";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import toast from "react-hot-toast";
import { createNonOverlappingPieValueLabel } from "@/utils/recharts";

interface TrafficSourceSlice {
  name: string;
  value: number;
  color: string;
  [key: string]: string | number;
}

interface BacklinkTimeseriesItem {
  date: string;
  newBacklinks: number;
  lostBacklinks: number;
  newReferringDomains: number;
  lostReferringDomains: number;
}

type BacklinkRow = {
  id: string;
  firstSeen: string | null;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
};

interface VisitorSourceItem {
  source: string;
  users: number;
}

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

type AiSearchVisibilityRow = {
  name: "ChatGPT" | "AI Overview" | "AI Mode" | "Gemini";
  visibility: number; // %
  mentions: number;
  citedPages: number;
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
  // GA4 metrics
  activeUsers: number | null;
  eventCount: number | null;
  newUsers: number | null;
  keyEvents: number | null;
  // Backward-compatible names used by the main dashboard UI
  totalUsers?: number | null;
  firstTimeVisitors?: number | null;
  engagedVisitors?: number | null;
  newUsersTrend?: TrendPoint[] | null;
  activeUsersTrend?: TrendPoint[] | null;
  totalUsersTrend?: TrendPoint[] | null;
  isGA4Connected?: boolean;
  ga4Events?: Array<{
    name: string;
    count: number;
    change?: string;
  }> | null;
  client?: {
    id: string;
    name: string;
    domain: string;
  };
  trafficSourceSummary?: {
    breakdown: Array<{ name: string; value: number }>;
    totalKeywords: number;
    totalEstimatedTraffic: number;
    organicEstimatedTraffic: number;
    averageRank: number | null;
    rankSampleSize: number;
  } | null;
}

const TRAFFIC_SOURCE_COLORS: Record<string, string> = {
  Organic: "#10B981",
  Direct: "#3B82F6",
  Referral: "#F59E0B",
  Paid: "#EF4444",
  Other: "#6366F1",
};

/** Catches chart/render errors (e.g. Recharts removeChild) and shows a fallback instead of breaking the page */
class ShareDashboardErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/80 p-8 text-center shadow-md">
          <p className="text-amber-900 font-semibold mb-2">Something went wrong displaying the dashboard.</p>
          <p className="text-sm text-amber-800/90 mb-4">Try refreshing the page.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium hover:from-amber-600 hover:to-orange-600 shadow-md"
          >
            Refresh page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ShareDashboardPage: React.FC = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [fetchingSummary, setFetchingSummary] = useState(false);
  const [backlinksForChart, setBacklinksForChart] = useState<{ newRows: BacklinkRow[]; lostRows: BacklinkRow[] }>({
    newRows: [],
    lostRows: [],
  });
  const [backlinksForChartLoading, setBacklinksForChartLoading] = useState(false);
  const [backlinksForChartError, setBacklinksForChartError] = useState<string | null>(null);
  const [topPages, setTopPages] = useState<TopPageItem[]>([]);
  const [topPagesLoading, setTopPagesLoading] = useState(false);
  const [topPagesError, setTopPagesError] = useState<string | null>(null);
  const [trafficSources, setTrafficSources] = useState<TrafficSourceSlice[]>([]);
  const [trafficSourcesLoading, setTrafficSourcesLoading] = useState(false);
  const [trafficSourcesError, setTrafficSourcesError] = useState<string | null>(null);
  const [visitorSources, setVisitorSources] = useState<VisitorSourceItem[]>([]);
  const [visitorSourcesLoading, setVisitorSourcesLoading] = useState(false);
  const [visitorSourcesError, setVisitorSourcesError] = useState<string | null>(null);
  const [topEvents, setTopEvents] = useState<Array<{ name: string; count: number }>>([]);
  const [topEventsLoading, setTopEventsLoading] = useState(false);
  const [topEventsError, setTopEventsError] = useState<string | null>(null);
  const [aiSearchRows, setAiSearchRows] = useState<AiSearchVisibilityRow[]>([]);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [aiSearchError, setAiSearchError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const dashboardContentRef = useRef<HTMLDivElement>(null);
  const [dateRange, setDateRange] = useState("30");
  // Defer mounting charts/content to avoid Recharts removeChild errors (DOM must be stable)
  const [contentMounted, setContentMounted] = useState(false);
  useEffect(() => {
    if (loading) {
      setContentMounted(false);
    } else {
      const t = window.setTimeout(() => setContentMounted(true), 50);
      return () => window.clearTimeout(t);
    }
  }, [loading]);

  const handleExportPdf = useCallback(async () => {
    if (!dashboardContentRef.current) {
      toast.error("Unable to export. Please try again.");
      return;
    }

    const element = dashboardContentRef.current;
    const previousOverflow = document.body.style.overflow;

    try {
      setExportingPdf(true);
      document.body.style.overflow = "hidden";

      // Temporarily remove padding for full-width capture
      const contentWrapper = element.parentElement;
      const originalPadding = contentWrapper?.style.padding ?? "";
      if (contentWrapper) contentWrapper.style.padding = "0";

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        scrollY: -window.scrollY,
        scrollX: -window.scrollX,
        backgroundColor: "#FFFFFF",
        ignoreElements: (el) => el.getAttribute?.("data-pdf-hide") === "true",
      });

      // Restore padding
      if (contentWrapper) contentWrapper.style.padding = originalPadding;

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const domain = dashboardSummary?.client?.domain;
      const headerHeightMm = domain ? 18 : 14;
      const gapMm = 4;
      const contentTopMm = headerHeightMm + gapMm;
      const websiteName = dashboardSummary?.client?.name || dashboardSummary?.client?.domain || "Shared Dashboard";

      // Title style: match ShareDashboard nav (gradient blue bar, white text) but centered
      pdf.setFillColor(37, 99, 235); // primary-600 / blue-600
      pdf.rect(0, 0, pageWidth, headerHeightMm, "F");
      pdf.setDrawColor(59, 130, 246); // primary-500 border
      pdf.setLineWidth(0.4);
      pdf.line(0, headerHeightMm, pageWidth, headerHeightMm);
      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(255, 255, 255);
      pdf.text(websiteName, pageWidth / 2, domain ? 6 : headerHeightMm / 2 + 2.5, { align: "center" });
      if (domain) {
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        pdf.text(`Domain: ${domain}`, pageWidth / 2, 12, { align: "center" });
      }
      pdf.setFont("helvetica", "normal");

      // Dashboard: always full page width; add gap below title; multi-page if tall
      const imgWidth = pageWidth;
      const fullImgHeightMm = (canvas.height * pageWidth) / canvas.width;
      const firstPageContentMm = pageHeight - contentTopMm;
      let srcY = 0;
      let remainingHeightMm = fullImgHeightMm;
      let isFirstPage = true;
      while (remainingHeightMm > 0) {
        const contentAreaMm = isFirstPage ? firstPageContentMm : pageHeight;
        const sliceHeightMm = Math.min(remainingHeightMm, contentAreaMm);
        const sliceHeightPx = (sliceHeightMm / fullImgHeightMm) * canvas.height;
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.ceil(sliceHeightPx);
        const ctx = sliceCanvas.getContext("2d")!;
        ctx.drawImage(canvas, 0, srcY, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
        const sliceData = sliceCanvas.toDataURL("image/png");
        const imgY = isFirstPage ? contentTopMm : 0;
        pdf.addImage(sliceData, "PNG", 0, imgY, imgWidth, sliceHeightMm);
        remainingHeightMm -= sliceHeightMm;
        srcY += sliceHeightPx;
        if (remainingHeightMm > 0) {
          pdf.addPage();
          isFirstPage = false;
        }
      }

      const sanitizedName = dashboardSummary?.client?.name 
        ? dashboardSummary.client.name.replace(/[^a-z0-9]/gi, "-").toLowerCase() 
        : "shared-dashboard";
      const fileName = `${sanitizedName}-${format(new Date(), "yyyyMMdd")}.pdf`;
      pdf.save(fileName);
      toast.success("Dashboard exported successfully!");
    } catch (error: any) {
      console.error("Failed to export dashboard PDF", error);
      toast.error(error?.message || "Failed to export dashboard PDF. Please try again.");
    } finally {
      document.body.style.overflow = previousOverflow;
      setExportingPdf(false);
    }
  }, [dashboardSummary?.client?.name, dashboardSummary?.client?.domain]);

  const formatNumber = (value: number) => {
    if (!Number.isFinite(value)) return "0";
    if (Math.abs(value) >= 1000) {
      return Math.round(value).toLocaleString();
    }
    return value.toFixed(0);
  };

  useEffect(() => {
    if (!token) return;
    const fetchSummary = async () => {
      try {
        setFetchingSummary(true);
        // Share dashboard may trigger a GA4 fetch on first view; allow longer than the default 10s timeout.
        const res = await api.get(`/seo/share/${encodeURIComponent(token)}/dashboard?period=${dateRange}`, {
          timeout: 30000,
        });
        const payload = res.data || {};
        const normalizeTrendPoints = (trend: any): TrendPoint[] => {
          if (!Array.isArray(trend)) return [];
          return trend
            .map((point) => ({
              date: typeof point?.date === "string" ? point.date : "",
              value: Number(point?.value ?? 0) || 0,
            }))
            .filter((point) => Boolean(point.date));
        };

        setDashboardSummary({
          ...payload,
          totalSessions:
            payload?.totalSessions !== undefined && payload?.totalSessions !== null
              ? Number(payload.totalSessions)
              : null,
          organicSessions:
            payload?.organicSessions !== undefined && payload?.organicSessions !== null
              ? Number(payload.organicSessions)
              : null,
          averagePosition:
            payload?.averagePosition !== undefined && payload?.averagePosition !== null
              ? Number(payload.averagePosition)
              : null,
          conversions:
            payload?.conversions !== undefined && payload?.conversions !== null
              ? Number(payload.conversions)
              : null,
          // GA4 metrics
          activeUsers: payload?.activeUsers !== undefined && payload?.activeUsers !== null ? Number(payload.activeUsers) : null,
          eventCount: payload?.eventCount !== undefined && payload?.eventCount !== null ? Number(payload.eventCount) : null,
          newUsers: payload?.newUsers !== undefined && payload?.newUsers !== null ? Number(payload.newUsers) : null,
          keyEvents: payload?.keyEvents !== undefined && payload?.keyEvents !== null ? Number(payload.keyEvents) : null,
          // Backward-compatible names used by the main dashboard UI
          totalUsers: payload?.totalUsers !== undefined && payload?.totalUsers !== null ? Number(payload.totalUsers) : null,
          firstTimeVisitors:
            payload?.firstTimeVisitors !== undefined && payload?.firstTimeVisitors !== null ? Number(payload.firstTimeVisitors) : null,
          engagedVisitors:
            payload?.engagedVisitors !== undefined && payload?.engagedVisitors !== null ? Number(payload.engagedVisitors) : null,
          newUsersTrend: normalizeTrendPoints(payload?.newUsersTrend),
          activeUsersTrend: normalizeTrendPoints(payload?.activeUsersTrend),
          totalUsersTrend: normalizeTrendPoints(payload?.totalUsersTrend),
          isGA4Connected: payload?.isGA4Connected || false,
        });
        setLoading(false);
      } catch (error: any) {
        console.error("Failed to fetch dashboard summary", error);
        if (error?.code === "ECONNABORTED") {
          toast.error("This shared report is taking longer than expected. Please refresh in a moment.");
        } else {
          toast.error(error?.response?.data?.message || "Invalid or expired share link");
        }
        setLoading(false);
      } finally {
        setFetchingSummary(false);
      }
    };

    fetchSummary();
  }, [token, dateRange]);

  const fetchBacklinksForChart = useCallback(async () => {
    if (!token) return;

    const paramsBase = {
      days: 28, // last 4 weeks
      limit: 5000,
      sortBy: "domainRating",
      order: "desc",
    } as const;

    const fetchBoth = async () => {
      const [newRes, lostRes] = await Promise.all([
        api.get(`/seo/share/${encodeURIComponent(token)}/backlinks`, { params: { ...paramsBase, filter: "new" } }),
        api.get(`/seo/share/${encodeURIComponent(token)}/backlinks`, { params: { ...paramsBase, filter: "lost" } }),
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
    } catch (error: any) {
      console.error("Failed to fetch backlinks chart rows (share)", error);
      setBacklinksForChart({ newRows: [], lostRows: [] });
      const errorMsg = error?.response?.data?.message || "Unable to load backlink trends";
      setBacklinksForChartError(errorMsg);
    } finally {
      setBacklinksForChartLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchBacklinksForChart();
  }, [fetchBacklinksForChart]);

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

  useEffect(() => {
    if (!token) return;

    const fetchTopPages = async () => {
      try {
        setTopPagesLoading(true);
        const res = await api.get(`/seo/share/${encodeURIComponent(token)}/top-pages`, {
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
      } catch (error: any) {
        console.error("Failed to fetch top pages", error);
        setTopPages([]);
        const errorMsg = error?.response?.data?.message || "Unable to load top pages data";
        setTopPagesError(errorMsg);
      } finally {
        setTopPagesLoading(false);
      }
    };

    fetchTopPages();
  }, [token]);

  const fetchTrafficSources = useCallback(async () => {
    if (!token) return;

    try {
      setTrafficSourcesLoading(true);
      const res = await api.get(`/seo/share/${encodeURIComponent(token)}/traffic-sources`, {
        params: { limit: 100, period: dateRange },
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
          };
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
    } finally {
      setTrafficSourcesLoading(false);
    }
  }, [token, dateRange]);

  useEffect(() => {
    fetchTrafficSources();
  }, [fetchTrafficSources]);

  const fetchVisitorSources = useCallback(async () => {
    if (!token) return;
    if (dashboardSummary?.isGA4Connected !== true) {
      setVisitorSources([]);
      setVisitorSourcesError(null);
      return;
    }

    try {
      setVisitorSourcesLoading(true);
      setVisitorSourcesError(null);
      const res = await api.get(`/seo/share/${encodeURIComponent(token)}/visitor-sources`, {
        params: { limit: 10, period: dateRange },
      });
      const data = Array.isArray(res.data) ? res.data : [];
      setVisitorSources(
        data
          .map((item: any) => ({
            source: typeof item?.source === "string" ? item.source : "",
            users: Number(item?.users ?? 0),
          }))
          .filter((item: VisitorSourceItem) => Boolean(item.source))
      );
    } catch (error: any) {
      console.error("Failed to fetch visitor sources", error);
      setVisitorSources([]);
      const errorMsg = error?.response?.data?.message || "Unable to load visitor sources data";
      setVisitorSourcesError(errorMsg);
    } finally {
      setVisitorSourcesLoading(false);
    }
  }, [token, dateRange, dashboardSummary?.isGA4Connected]);

  useEffect(() => {
    fetchVisitorSources();
  }, [fetchVisitorSources]);

  const fetchTopEvents = useCallback(async () => {
    if (!token) return;
    if (dashboardSummary?.isGA4Connected !== true) {
      setTopEvents([]);
      setTopEventsError(null);
      return;
    }

    try {
      setTopEventsLoading(true);
      setTopEventsError(null);
      const res = await api.get(`/seo/share/${encodeURIComponent(token)}/events/top`, {
        params: { limit: 10, period: dateRange, type: "keyevents" },
      });
      const data = Array.isArray(res.data) ? res.data : [];
      setTopEvents(
        data
          .map((item: any) => ({
            name: typeof item?.name === "string" ? item.name : "",
            count: Number(item?.count ?? 0),
          }))
          .filter((item: { name: string; count: number }) => Boolean(item.name))
      );
    } catch (error: any) {
      console.error("Failed to fetch top events", error);
      setTopEvents([]);
      const errorMsg = error?.response?.data?.message || "Unable to load key events data";
      setTopEventsError(errorMsg);
    } finally {
      setTopEventsLoading(false);
    }
  }, [token, dateRange, dashboardSummary?.isGA4Connected]);

  useEffect(() => {
    fetchTopEvents();
  }, [fetchTopEvents]);

  const fetchAiSearchVisibility = useCallback(async () => {
    if (!token) return;
    try {
      setAiSearchLoading(true);
      setAiSearchError(null);
      const res = await api.get(`/seo/share/${encodeURIComponent(token)}/ai-search-visibility`, {
        params: { period: dateRange },
        timeout: 30000,
      });
      const rows = Array.isArray(res?.data?.rows) ? (res.data.rows as AiSearchVisibilityRow[]) : [];
      setAiSearchRows(rows);
    } catch (error: any) {
      console.error("Failed to fetch AI Search visibility", error);
      setAiSearchRows([]);
      setAiSearchError(error?.response?.data?.message || "Unable to load AI Search Visibility");
    } finally {
      setAiSearchLoading(false);
    }
  }, [token, dateRange]);

  useEffect(() => {
    fetchAiSearchVisibility();
  }, [fetchAiSearchVisibility]);

  const resolvedTopPages = useMemo<TopPageItem[]>(() => {
    // Match main dashboard: show actual data only (no sample fallback)
    return topPages;
  }, [topPages]);

  const resolvedTrafficSources = useMemo<TrafficSourceSlice[]>(() => {
    // Match the main dashboard: show actual data only (no sample fallback)
    return trafficSources;
  }, [trafficSources]);

  // Match the main dashboard KPI set:
  // Web Visitors, Organic Traffic, First Time Visitors, Engaged Visitors

  // Web Visitors (same as Active Users / Total Users)
  const activeUsersDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (dashboardSummary?.isGA4Connected !== true) return "—";
    const value = dashboardSummary?.totalUsers ?? dashboardSummary?.activeUsers;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "—";
  }, [dashboardSummary?.totalUsers, dashboardSummary?.activeUsers, fetchingSummary, dashboardSummary?.isGA4Connected]);

  // Organic Traffic (Organic Search - Engaged Sessions)
  const organicTrafficDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (dashboardSummary?.isGA4Connected !== true) return "—";
    const value = dashboardSummary?.organicSearchEngagedSessions;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "—";
  }, [dashboardSummary?.organicSearchEngagedSessions, fetchingSummary, dashboardSummary?.isGA4Connected]);

  // First Time Visitors (same as New Users - match SEO Overview)
  const newUsersDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (dashboardSummary?.isGA4Connected !== true) return "—";
    const value = dashboardSummary?.newUsers;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "—";
  }, [dashboardSummary?.newUsers, fetchingSummary, dashboardSummary?.isGA4Connected]);

  // Engaged Visitors (same as Engaged Sessions from GA4)
  const keyEventsDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (dashboardSummary?.isGA4Connected !== true) return "—";
    const value = dashboardSummary?.engagedVisitors;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "—";
  }, [dashboardSummary?.engagedVisitors, fetchingSummary, dashboardSummary?.isGA4Connected]);

  // Trend data processing
  const newUsersTrendData = useMemo(() => {
    if (!dashboardSummary?.newUsersTrend?.length) return [];
    return dashboardSummary.newUsersTrend.map((point) => {
      const dateObj = new Date(point.date);
      const label = Number.isNaN(dateObj.getTime()) ? point.date : format(dateObj, "MMM d");
      const value = Number(point.value ?? 0);
      return {
        name: label,
        newUsers: Number.isFinite(value) ? value : 0,
      };
    });
  }, [dashboardSummary?.newUsersTrend]);

  const totalUsersTrendData = useMemo(() => {
    const trend = dashboardSummary?.totalUsersTrend ?? dashboardSummary?.activeUsersTrend;
    if (!trend?.length) return [];
    return trend.map((point) => {
      const dateObj = new Date(point.date);
      const label = Number.isNaN(dateObj.getTime()) ? point.date : format(dateObj, "MMM d");
      const value = Number(point.value ?? 0);
      return {
        name: label,
        totalUsers: Number.isFinite(value) ? value : 0,
      };
    });
  }, [dashboardSummary?.totalUsersTrend, dashboardSummary?.activeUsersTrend]);

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center p-8">
        <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50 px-6 py-4 text-amber-900 shadow-md max-w-md">
          <p className="font-semibold">Invalid share link.</p>
          <p className="text-sm mt-1 text-amber-800/90">Please check the URL and try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-gray-50 to-slate-100">
      {/* Top Navbar */}
      <nav className="bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 border-b-2 border-primary-500/50 px-8 py-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white drop-shadow-sm">
              {dashboardSummary?.client?.name || "Shared Dashboard"}
            </h1>
            {dashboardSummary?.client?.domain && (
              <p className="text-sm text-white/90 mt-1">
                <span className="font-medium">Domain:</span>{" "}
                <a
                  href={dashboardSummary.client.domain.startsWith("http") ? dashboardSummary.client.domain : `https://${dashboardSummary.client.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white underline decoration-white/70 hover:decoration-white"
                >
                  {dashboardSummary.client.domain}
                </a>
              </p>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="border-2 border-white/30 bg-white/15 text-white rounded-xl px-4 py-2 focus:ring-2 focus:ring-white/40 focus:border-white/50 focus:outline-none [&>option]:text-gray-900"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exportingPdf}
              className="bg-white/20 hover:bg-white/30 text-white border-2 border-white/40 px-4 py-2 rounded-xl font-medium transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {exportingPdf ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Exporting...</span>
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  <span>Download PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Dashboard Content - defer chart mount by one frame to avoid Recharts removeChild */}
      <div className="p-8 space-y-8">
        <div ref={dashboardContentRef} className="space-y-8">
          {loading ? (
            <div className="rounded-2xl border-l-4 border-primary-500 bg-primary-50/60 p-8 text-center text-primary-800 shadow-md">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary-600" />
              <p className="font-medium">Loading shared dashboard...</p>
            </div>
          ) : !contentMounted ? (
            <div className="rounded-2xl border-l-4 border-blue-500 bg-blue-50/60 p-8 text-center text-blue-900 shadow-md">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-blue-600" />
              <p className="font-medium">Preparing dashboard...</p>
            </div>
          ) : (
            <ShareDashboardErrorBoundary>
            <>
            {/* Report View - GA4 Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/60 p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-blue-900">Web Visitors</p>
                    <p className="text-2xl font-bold text-gray-900">{activeUsersDisplay}</p>
                  </div>
                  <Users className="h-8 w-8 text-blue-600" />
                </div>
                {dashboardSummary?.isGA4Connected ? (
                  <div className="mt-4 flex items-center space-x-2 text-emerald-700">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium">Real-time data from GA4</span>
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
                    <p className="text-sm font-semibold text-emerald-900">Organic Traffic</p>
                    <p className="text-2xl font-bold text-gray-900">{organicTrafficDisplay}</p>
                  </div>
                  <Search className="h-8 w-8 text-emerald-600" />
                </div>
                {dashboardSummary?.isGA4Connected ? (
                  <div className="mt-4 flex items-center space-x-2 text-emerald-700">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium">Real-time data from GA4</span>
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
                    <p className="text-sm font-semibold text-violet-900">First Time Visitors</p>
                    <p className="text-2xl font-bold text-gray-900">{newUsersDisplay}</p>
                  </div>
                  <UserPlus className="h-8 w-8 text-violet-600" />
                </div>
                {dashboardSummary?.isGA4Connected ? (
                  <div className="mt-4 flex items-center space-x-2 text-emerald-700">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium">Real-time data from GA4</span>
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
                    <p className="text-sm font-semibold text-amber-900">Engaged Visitors</p>
                    <p className="text-2xl font-bold text-gray-900">{keyEventsDisplay}</p>
                  </div>
                  <Activity className="h-8 w-8 text-amber-600" />
                </div>
                {dashboardSummary?.isGA4Connected ? (
                  <div className="mt-4 flex items-center space-x-2 text-emerald-700">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium">Real-time data from GA4</span>
                  </div>
                ) : (
                  <div className="mt-4">
                    <span className="text-xs text-amber-800/80">Connect GA4 to view data</span>
                  </div>
                )}
              </div>
            </div>

            {/* Trend Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border-l-4 border-blue-500 bg-white p-6 shadow-sm ring-1 ring-gray-200/80">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-blue-900">New Users Trending</h3>
                  {fetchingSummary && <span className="text-xs text-gray-400">Updating...</span>}
                </div>
                <div className="h-64">
                  {dashboardSummary?.isGA4Connected ? (
                    newUsersTrendData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={newUsersTrendData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="newUsers" stroke="#3B82F6" strokeWidth={2} />
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
                <h3 className="text-lg font-semibold text-emerald-900 mb-4">Total Users Trending</h3>
                <div className="h-64">
                  {dashboardSummary?.isGA4Connected ? (
                    totalUsersTrendData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={totalUsersTrendData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="totalUsers" name="Total Users" stroke="#10B981" strokeWidth={2} />
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

            {/* Target Keywords first (same order as Dashboard SEO Overview) */}
            {dashboardSummary?.client?.id && token && (
              <TargetKeywordsOverview
                clientId={dashboardSummary.client.id}
                clientName={dashboardSummary.client.name}
                shareToken={token}
              />
            )}

            {/* Ranked Keywords Overview */}
            {dashboardSummary?.client?.id && token && (
              <RankedKeywordsOverview
                clientId={dashboardSummary.client.id}
                clientName={dashboardSummary.client.name}
                title="Total Keywords Ranked"
                subtitle="Monitor how many organic keywords this client ranks for and how that total changes month-to-month."
                shareToken={token}
                enableRefresh={false}
              />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border-l-4 border-violet-500 bg-white p-4 shadow-sm ring-1 ring-gray-200/80">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-violet-900">Traffic Sources</h3>
                </div>
                {trafficSourcesError && (
                  <p className="mb-3 text-sm text-rose-600">{trafficSourcesError}</p>
                )}
                <div className="h-56">
                  {trafficSourcesLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-sm text-gray-500">Loading traffic sources...</p>
                    </div>
                  ) : resolvedTrafficSources.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-sm text-gray-500">No traffic sources data available.</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={resolvedTrafficSources}
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
                          formatter={(value: number) => value.toLocaleString()}
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '4px' }}
                        />
                        <Bar 
                          dataKey="value" 
                          radius={[0, 4, 4, 0]}
                        >
                          {resolvedTrafficSources.map((entry, index) => (
                            <Cell
                              key={`traffic-source-${entry.name}-${index}`}
                              fill={entry.color || TRAFFIC_SOURCE_COLORS.Other}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              <div className="rounded-xl border-l-4 border-indigo-500 bg-white p-4 shadow-sm ring-1 ring-gray-200/80">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-indigo-900">AI Search Visibility</h3>
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
                  <h3 className="text-lg font-semibold text-teal-900">Visitor Sources</h3>
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
                      {dashboardSummary?.isGA4Connected
                        ? "No visitor sources data available."
                        : "Connect GA4 to view visitor sources data."}
                    </div>
                  ) : (
                    visitorSources.map((source, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <p className="font-medium text-gray-900">{source.source}</p>
                        <p className="text-sm text-gray-500">{source.users.toLocaleString()} users</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl border-l-4 border-amber-500 bg-white p-6 shadow-sm ring-1 ring-gray-200/80">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-amber-900">Conversions</h3>
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
                      {dashboardSummary?.isGA4Connected
                        ? "No key events data available. Make sure key events are configured in GA4."
                        : "Connect GA4 to view key events data."}
                    </div>
                  ) : (
                    topEvents.map((event, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <p className="font-medium text-gray-900">{event.name}</p>
                        <p className="text-sm text-gray-500">{event.count.toLocaleString()}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border-l-4 border-primary-500 bg-white shadow-sm ring-1 ring-gray-200/80 overflow-hidden">
              <div className="p-6 border-b-2 border-gray-100 bg-gradient-to-r from-primary-50/50 to-blue-50/50">
                <h3 className="text-lg font-semibold text-primary-900">Top Pages</h3>
                {topPagesError && (
                  <p className="mt-2 text-sm text-rose-600">
                    {topPagesError}
                  </p>
                )}
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
                      <th className="px-6 py-3 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">Movement</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider">Paid Traffic</th>
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
                                    <span className="text-xs font-medium">+</span>
                                    <span className="text-xs">{formatNumber(page.newKeywords)}</span>
                                  </div>
                                )}
                                {page.upKeywords > 0 && (
                                  <div className="flex items-center gap-1 text-blue-600">
                                    <TrendingUp className="h-3.5 w-3.5" />
                                    <span className="text-xs">{formatNumber(page.upKeywords)}</span>
                                  </div>
                                )}
                                {page.downKeywords > 0 && (
                                  <div className="flex items-center gap-1 text-orange-600">
                                    <TrendingDown className="h-3.5 w-3.5" />
                                    <span className="text-xs">{formatNumber(page.downKeywords)}</span>
                                  </div>
                                )}
                                {page.lostKeywords > 0 && (
                                  <div className="flex items-center gap-1 text-rose-600">
                                    <span className="text-xs font-medium">−</span>
                                    <span className="text-xs">{formatNumber(page.lostKeywords)}</span>
                                  </div>
                                )}
                                {page.newKeywords === 0 &&
                                  page.upKeywords === 0 &&
                                  page.downKeywords === 0 &&
                                  page.lostKeywords === 0 && <span className="text-gray-400">—</span>}
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

            <div className="rounded-xl border-l-4 border-emerald-500 bg-white shadow-sm ring-1 ring-gray-200/80 overflow-hidden">
              <div className="p-6 border-b-2 border-gray-100 bg-gradient-to-r from-emerald-50/60 to-teal-50/50 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-emerald-900">New Links</h3>
                  <p className="text-sm text-emerald-800/80">Weekly backlinks acquired (last 4 weeks)</p>
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
            </>
            </ShareDashboardErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShareDashboardPage;

