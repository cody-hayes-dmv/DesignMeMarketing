import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
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
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import api from "@/lib/api";
import { Client } from "@/store/slices/clientSlice";
import { endOfWeek, format, startOfWeek } from "date-fns";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import toast from "react-hot-toast";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { logout } from "@/store/slices/authSlice";
import RankedKeywordsOverview from "@/components/RankedKeywordsOverview";
import TargetKeywordsOverview from "@/components/TargetKeywordsOverview";
import ConfirmDialog from "@/components/ConfirmDialog";

interface TrafficSourceSlice {
  name: string;
  value: number;
  color: string;
}

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
}

type TaskStatus = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
type WorkLogTask = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  assignee?: { id: string; name?: string | null; email: string } | null;
  createdBy?: { id: string; name?: string | null; email: string } | null;
};

interface BacklinkTimeseriesItem {
  date: string;
  newBacklinks: number;
  lostBacklinks: number;
  newReferringDomains: number;
  lostReferringDomains: number;
}

type BacklinkFilter = "all" | "new" | "lost";
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

interface TrendPoint {
  date: string;
  value: number;
}

interface DashboardSummary {
  totalSessions: number | null;
  organicSessions: number | null;
  averagePosition: number | null;
  conversions: number | null;
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
}

const TRAFFIC_SOURCE_COLORS: Record<string, string> = {
  Organic: "#10B981",
  Direct: "#3B82F6",
  Referral: "#F59E0B",
  Paid: "#EF4444",
  Other: "#6366F1",
};


const parseNumericValue = (value: any): number | null => {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeTrendPoints = (trend: any): TrendPoint[] => {
  if (!Array.isArray(trend)) return [];
  return trend
    .map((point) => ({
      date: typeof point?.date === "string" ? point.date : "",
      value: Number(point?.value ?? 0) || 0,
    }))
    .filter((point) => Boolean(point.date));
};

const formatDashboardSummary = (payload: any): DashboardSummary => ({
  ...payload,
  totalSessions: parseNumericValue(payload?.totalSessions),
  organicSessions: parseNumericValue(payload?.organicSessions),
  averagePosition: parseNumericValue(payload?.averagePosition),
  conversions: parseNumericValue(payload?.conversions),
  // New GA4 metrics
  activeUsers: parseNumericValue(payload?.activeUsers),
  eventCount: parseNumericValue(payload?.eventCount),
  newUsers: parseNumericValue(payload?.newUsers),
  keyEvents: parseNumericValue(payload?.keyEvents),
  activeUsersTrend: normalizeTrendPoints(payload?.activeUsersTrend),
  // Backward compatibility
  totalUsers: parseNumericValue(payload?.totalUsers ?? payload?.activeUsers),
  firstTimeVisitors: parseNumericValue(payload?.firstTimeVisitors ?? payload?.newUsers),
  // Engaged Visitors should reflect GA4 engaged sessions (NOT key events / conversions)
  engagedVisitors: parseNumericValue(payload?.engagedVisitors ?? payload?.engagedSessions),
  newUsersTrend: normalizeTrendPoints(payload?.newUsersTrend),
  totalUsersTrend: normalizeTrendPoints(payload?.totalUsersTrend ?? payload?.activeUsersTrend),
});

const ClientDashboardPage: React.FC = () => {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);
  const isClientPortal = location.pathname.startsWith("/client/");
  const reportOnly = user?.role === "CLIENT" || isClientPortal || Boolean((location.state as any)?.reportOnly);
  const [client, setClient] = useState<Client | null>((location.state as { client?: Client })?.client || null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "report" | "backlinks" | "worklog">(
    (location.state as { tab?: "dashboard" | "report" | "backlinks" | "worklog" })?.tab || (reportOnly ? "report" : "dashboard")
  );
  const [dateRange, setDateRange] = useState("30");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [fetchingSummary, setFetchingSummary] = useState(false);
  const [backlinkTimeseries, setBacklinkTimeseries] = useState<BacklinkTimeseriesItem[]>([]);
  const [backlinkTimeseriesLoading, setBacklinkTimeseriesLoading] = useState(false);
  const [backlinkTimeseriesError, setBacklinkTimeseriesError] = useState<string | null>(null);
  const [backlinksFilter, setBacklinksFilter] = useState<BacklinkFilter>("all");
  const [backlinks, setBacklinks] = useState<BacklinkRow[]>([]);
  const [backlinksLoading, setBacklinksLoading] = useState(false);
  const [backlinksError, setBacklinksError] = useState<string | null>(null);
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
  const [topPages, setTopPages] = useState<TopPageItem[]>([]);
  const [topPagesLoading, setTopPagesLoading] = useState(false);
  const [topPagesError, setTopPagesError] = useState<string | null>(null);
  const [trafficSources, setTrafficSources] = useState<TrafficSourceSlice[]>([]);
  const [trafficSourcesLoading, setTrafficSourcesLoading] = useState(false);
  const [trafficSourcesError, setTrafficSourcesError] = useState<string | null>(null);
  const [ga4DataRefreshKey, setGa4DataRefreshKey] = useState(0);
  const prevGa4ReadyRef = useRef<boolean>(false);
  const autoRefreshAttemptedRef = useRef<Record<string, boolean>>({});
  const autoDataForSeoAttemptedRef = useRef<{
    topPages: Record<string, boolean>;
    backlinks: Record<string, boolean>;
  }>({ topPages: {}, backlinks: {} });
  const [autoRefreshingGa4, setAutoRefreshingGa4] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const dashboardContentRef = useRef<HTMLDivElement>(null);
  const modalDashboardContentRef = useRef<HTMLDivElement>(null);
  const [viewReportModalOpen, setViewReportModalOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ClientReport | null>(null);
  const [sharing, setSharing] = useState(false);
  const [serverReport, setServerReport] = useState<any | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [ga4Connected, setGa4Connected] = useState<boolean | null>(null);
  const [, setGa4AccountEmail] = useState<string | null>(null);
  const [ga4Connecting, setGa4Connecting] = useState(false);
  const [ga4StatusLoading, setGa4StatusLoading] = useState(true); // Track GA4 status check loading
  const [ga4ConnectionError, setGa4ConnectionError] = useState<string | null>(null);
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
  const [refreshingTopPages, setRefreshingTopPages] = useState(false);
  const [refreshingBacklinks, setRefreshingBacklinks] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
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

  // Client-specific report creation modal state
  const [showClientReportModal, setShowClientReportModal] = useState(false);
  const [clientReportFrequency, setClientReportFrequency] = useState<"weekly" | "biweekly" | "monthly">("monthly");
  const [clientReportDayOfWeek, setClientReportDayOfWeek] = useState(1); // Monday
  const [clientReportDayOfMonth, setClientReportDayOfMonth] = useState(1);
  const [clientReportTimeOfDay, setClientReportTimeOfDay] = useState("09:00");
  const [clientReportRecipients, setClientReportRecipients] = useState("");
  const [clientReportEmailSubject, setClientReportEmailSubject] = useState("");
  const [clientReportSubmitting, setClientReportSubmitting] = useState(false);

  // Work log (tasks linked to this client)
  const [workLogTasks, setWorkLogTasks] = useState<WorkLogTask[]>([]);
  const [workLogLoading, setWorkLogLoading] = useState(false);
  const [workLogError, setWorkLogError] = useState<string | null>(null);
  const [workLogModalOpen, setWorkLogModalOpen] = useState(false);
  const [workLogModalMode, setWorkLogModalMode] = useState<"create" | "edit" | "view">("create");
  const [selectedWorkLogTaskId, setSelectedWorkLogTaskId] = useState<string | null>(null);
  const [workLogForm, setWorkLogForm] = useState<{
    title: string;
    description: string;
    category: string;
    status: TaskStatus;
  }>({
    title: "",
    description: "",
    category: "",
    status: "TODO",
  });
  const [workLogDeleteConfirm, setWorkLogDeleteConfirm] = useState<{
    isOpen: boolean;
    taskId: string | null;
    taskTitle: string | null;
  }>({ isOpen: false, taskId: null, taskTitle: null });

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

  useEffect(() => {
    if (activeTab === "worklog") {
      fetchWorkLog();
    }
  }, [activeTab, fetchWorkLog]);

  const taskStatusLabel = (s: TaskStatus) => {
    switch (s) {
      case "DONE":
        return "Completed";
      case "IN_PROGRESS":
        return "In Progress";
      case "REVIEW":
        return "In Review";
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
      default:
        return "bg-yellow-100 text-yellow-800";
    }
  };

  const openWorkLogCreate = () => {
    setWorkLogModalMode("create");
    setSelectedWorkLogTaskId(null);
    setWorkLogForm({ title: "", description: "", category: "", status: "TODO" });
    setWorkLogModalOpen(true);
  };

  const openWorkLogView = (taskId: string) => {
    const task = workLogTasks.find((t) => t.id === taskId);
    if (task) {
      setWorkLogForm({
        title: task.title || "",
        description: task.description || "",
        category: task.category || "",
        status: task.status,
      });
    }
    setWorkLogModalMode("view");
    setSelectedWorkLogTaskId(taskId);
    setWorkLogModalOpen(true);
  };

  const openWorkLogEdit = (taskId: string) => {
    const task = workLogTasks.find((t) => t.id === taskId);
    if (task) {
      setWorkLogForm({
        title: task.title || "",
        description: task.description || "",
        category: task.category || "",
        status: task.status,
      });
    }
    setWorkLogModalMode("edit");
    setSelectedWorkLogTaskId(taskId);
    setWorkLogModalOpen(true);
  };

  const handleSaveWorkLog = async () => {
    if (!clientId) return;
    const payload = {
      title: workLogForm.title.trim(),
      description: workLogForm.description.trim() || undefined,
      category: workLogForm.category.trim() || undefined,
      status: workLogForm.status,
      clientId,
    };

    if (!payload.title) {
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

  const handleExportPdf = useCallback(async () => {
    if (!dashboardContentRef.current) {
      toast.error("Switch to the Dashboard tab to export.");
      return;
    }

    if (activeTab !== "dashboard") {
      toast.error("Please switch to the Dashboard tab before exporting.");
      return;
    }

    const element = dashboardContentRef.current;
    const previousOverflow = document.body.style.overflow;

    try {
      setExportingPdf(true);
      document.body.style.overflow = "hidden";
      element.classList.add("pdf-exporting");

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        scrollY: -window.scrollY,
        scrollX: -window.scrollX,
        backgroundColor: "#FFFFFF",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const sanitizedName = client?.name ? client.name.replace(/\s+/g, "-").toLowerCase() : "client-dashboard";
      const fileName = `${sanitizedName}-${format(new Date(), "yyyyMMdd")}.pdf`;
      pdf.save(fileName);
      toast.success("Dashboard exported successfully!");
    } catch (error: any) {
      console.error("Failed to export dashboard PDF", error);
      toast.error(error?.message || "Failed to export dashboard PDF. Please try again.");
    } finally {
      document.body.style.overflow = previousOverflow;
      element.classList.remove("pdf-exporting");
      setExportingPdf(false);
    }
  }, [activeTab, client?.name]);

  const handleRefreshDashboard = useCallback(async () => {
    if (!clientId) return;
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
      toast.success(successMessage);
      
      // Refetch dashboard data (this will get fresh DataForSEO and GA4 data)
      const res = await api.get(buildDashboardUrl(clientId));
      const payload = res.data || {};
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
            // Clear GA4 data
            const summary = formatDashboardSummary(payload);
            summary.activeUsers = null;
            summary.eventCount = null;
            summary.newUsers = null;
            summary.keyEvents = null;
            summary.activeUsersTrend = [];
            summary.newUsersTrend = [];
            summary.totalUsers = null;
            summary.firstTimeVisitors = null;
            summary.engagedVisitors = null;
            summary.totalUsersTrend = [];
            summary.ga4Events = null;
            setDashboardSummary(summary);
          } else {
            setDashboardSummary(formatDashboardSummary(payload));
          }
        } catch (statusError) {
          console.warn("Failed to refresh GA4 status:", statusError);
          setGa4Connected(false);
          setGa4ConnectionError("Unable to verify GA4 connection. Please reconnect GA4.");
        }
      } else {
        setGa4Connected(isGA4Connected);
        setDashboardSummary(formatDashboardSummary(payload));
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
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to refresh dashboard data");
      
      // If error is GA4-related, mark connection as invalid
      if (error?.response?.data?.message?.toLowerCase().includes("ga4") || 
          error?.response?.data?.message?.toLowerCase().includes("token")) {
        setGa4Connected(false);
        setGa4ConnectionError("GA4 connection error during refresh. Please reconnect GA4.");
      }
    } finally {
      setRefreshingDashboard(false);
    }
  }, [clientId, buildDashboardUrl, dateRange, customStartDate, customEndDate]);

  const handleRefreshTopPages = useCallback(async () => {
    if (!clientId) return;
    try {
      setRefreshingTopPages(true);
      const refreshRes = await api.post(`/seo/top-pages/${clientId}/refresh`);
      const skipped = Boolean(refreshRes?.data?.skipped);
      const message = String(refreshRes?.data?.message || "").trim();

      if (skipped) {
        toast(message || "Using cached top pages data (refresh limited to every 48 hours).");
      } else {
        toast.success(message || "Top pages refreshed successfully!");
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
      toast.error(error.response?.data?.message || "Failed to refresh top pages");
    } finally {
      setRefreshingTopPages(false);
    }
  }, [clientId]);

  const handleRefreshBacklinks = useCallback(async () => {
    if (!clientId) return;
    try {
      setRefreshingBacklinks(true);
      const refreshRes = await api.post(`/seo/backlinks/${clientId}/refresh`);
      const skipped = Boolean(refreshRes?.data?.skipped);
      const message = String(refreshRes?.data?.message || "").trim();

      if (skipped) {
        toast(message || "Using cached backlinks data (refresh limited to every 48 hours).");
      } else {
        toast.success(message || "Backlinks refreshed successfully!");
      }

      // Refetch backlink timeseries (weekly UI uses last 4 weeks / 28 days)
      const res = await api.get(`/seo/backlinks/${clientId}/timeseries`, {
        params: { range: 28 },
      });
      const data = Array.isArray(res.data) ? res.data : [];
      const normalized = data
        .map((item: any) => ({
          date: item.date,
          newBacklinks: Number(item.newBacklinks ?? item.new_backlinks ?? 0),
          lostBacklinks: Number(item.lostBacklinks ?? item.lost_backlinks ?? 0),
          newReferringDomains: Number(item.newReferringDomains ?? item.new_referring_domains ?? 0),
          lostReferringDomains: Number(item.lostReferringDomains ?? item.lost_referring_domains ?? 0),
        }))
        .filter((item) => item.date)
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setBacklinkTimeseries(normalized);
      setBacklinkTimeseriesError(null);

      // Also refresh the backlinks table if it's being viewed
      try {
        const listRes = await api.get(`/seo/backlinks/${clientId}`, {
          params: { filter: backlinksFilter, days: 30, limit: 200, sortBy: "domainRating", order: "desc" },
        });
        const list = Array.isArray(listRes.data) ? (listRes.data as BacklinkRow[]) : [];
        setBacklinks(list);
        setBacklinksError(null);
      } catch (listErr: any) {
        console.warn("Failed to refresh backlinks list", listErr);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to refresh backlinks");
    } finally {
      setRefreshingBacklinks(false);
    }
  }, [backlinksFilter, clientId]);

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
          <div className={`max-w-xl w-full bg-white shadow-lg rounded-lg border border-gray-200 p-4 ${t.visible ? "animate-enter" : "animate-leave"}`}>
            <p className="text-sm font-medium text-gray-900 mb-2">Share link generated</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 underline break-all"
            >
              {url}
            </a>
            <div className="mt-3 flex items-center gap-2">
              <button
                className="px-3 py-1 text-xs rounded bg-primary-600 text-white hover:bg-primary-700"
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
                className="px-3 py-1 text-xs rounded bg-gray-100 text-gray-800 hover:bg-gray-200"
              >
                Open
              </a>
              <button
                className="ml-auto px-3 py-1 text-xs rounded bg-gray-100 text-gray-800 hover:bg-gray-200"
                onClick={() => toast.dismiss(t.id)}
              >
                Close
              </button>
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

    const fetchClient = async () => {
      try {
        setLoading(true);
        const res = await api.get("/clients");
        const found = (res.data as Client[]).find((c) => c.id === clientId);
        if (found) {
          setClient(found);
        } else {
          navigate("/agency/clients");
        }
      } catch (error: any) {
        console.error("Failed to load client", error);
        const errorMsg = error?.response?.data?.message || error?.message || "Failed to load client data";
        toast.error(errorMsg);
        navigate("/agency/clients");
      } finally {
        setLoading(false);
      }
    };

    fetchClient();
  }, [clientId, client, navigate]);

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
          const res = await api.get(buildDashboardUrl(clientId));
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

  // Set active tab from location state when component mounts or location changes
  useEffect(() => {
    const state = location.state as { tab?: "dashboard" | "report" | "backlinks" | "worklog" };
    if (state?.tab) {
      setActiveTab(state.tab);
    }
  }, [location.state]);

  useEffect(() => {
    if (!clientId) return;
    
    // If custom is selected but dates are not set, initialize them
    if (dateRange === "custom" && (!customStartDate || !customEndDate)) {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      setCustomEndDate(endDate.toISOString().split('T')[0]);
      setCustomStartDate(startDate.toISOString().split('T')[0]);
      setShowCustomDatePicker(true);
      return; // Don't fetch yet, wait for dates to be set
    }
    
    const fetchSummary = async () => {
      try {
        setFetchingSummary(true);
        setGa4ConnectionError(null);
        const fetchDashboardPayload = async () => {
          const res = await api.get(buildDashboardUrl(clientId));
          return res.data || {};
        };

        const autoRefreshKey = `${clientId}:${dateRange}:${customStartDate ?? ""}:${customEndDate ?? ""}`;

        let payload = await fetchDashboardPayload();
        let isGA4Connected = payload?.isGA4Connected || false;
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
          (dataSource !== "ga4" || looksLikeMissingGa4Metrics) &&
          !autoRefreshAttemptedRef.current[autoRefreshKey]
        ) {
          autoRefreshAttemptedRef.current[autoRefreshKey] = true;
          try {
            setAutoRefreshingGa4(true);
            await api.post(`/seo/dashboard/${clientId}/refresh`);
            payload = await fetchDashboardPayload();
            isGA4Connected = payload?.isGA4Connected || false;
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
              
              // Clear GA4-specific metrics from dashboard summary
              const summary = formatDashboardSummary(payload);
              summary.activeUsers = null;
              summary.eventCount = null;
              summary.newUsers = null;
              summary.keyEvents = null;
              summary.activeUsersTrend = [];
              summary.newUsersTrend = [];
              summary.totalUsers = null;
              summary.firstTimeVisitors = null;
              summary.engagedVisitors = null;
              summary.totalUsersTrend = [];
              summary.ga4Events = null;
              setDashboardSummary(summary);
              
              toast.error("GA4 connection is invalid. Please reconnect to get fresh data.", { duration: 5000 });
            } else {
              // Status is OK but data source is not GA4 - might be using cached data
              setGa4Connected(true);
              setDashboardSummary(formatDashboardSummary(payload));
            }
          } catch (statusError: any) {
            // Status check failed - connection is likely invalid
            console.error("GA4 status check failed:", statusError);
            setGa4Connected(false);
            setGa4ConnectionError("Unable to verify GA4 connection. Please reconnect GA4.");
            
            // Clear GA4-specific metrics
            const summary = formatDashboardSummary(payload);
            summary.activeUsers = null;
            summary.eventCount = null;
            summary.newUsers = null;
            summary.keyEvents = null;
            summary.activeUsersTrend = [];
            summary.newUsersTrend = [];
            summary.totalUsers = null;
            summary.firstTimeVisitors = null;
            summary.engagedVisitors = null;
            summary.totalUsersTrend = [];
            summary.ga4Events = null;
            setDashboardSummary(summary);
            
            toast.error("GA4 connection verification failed. Please reconnect GA4.", { duration: 5000 });
          }
        } else {
          // Normal case: either GA4 is connected and data is from GA4, or GA4 is not connected
          setGa4Connected(isGA4Connected);
          setDashboardSummary(formatDashboardSummary(payload));
        }
      } catch (error: any) {
        console.warn("Failed to fetch dashboard summary", error);
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
  }, [clientId, dateRange, customStartDate, customEndDate, buildDashboardUrl]);

  const fetchBacklinkTimeseries = useCallback(async () => {
    if (!clientId) return;

    try {
      setBacklinkTimeseriesLoading(true);
      const res = await api.get(`/seo/backlinks/${clientId}/timeseries`, {
        // Weekly UI uses last 4 weeks of daily data (28 days).
        params: { range: 28 },
      });
      const data = Array.isArray(res.data) ? res.data : [];
      const normalized = data
        .map((item: any) => ({
          date: item.date,
          newBacklinks: Number(item.newBacklinks ?? item.new_backlinks ?? 0),
          lostBacklinks: Number(item.lostBacklinks ?? item.lost_backlinks ?? 0),
          newReferringDomains: Number(item.newReferringDomains ?? item.new_referring_domains ?? 0),
          lostReferringDomains: Number(item.lostReferringDomains ?? item.lost_referring_domains ?? 0),
        }))
        .filter((item) => item.date);

      // Show most recent days first (matches API ordering / "New Links" intent)
      normalized.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setBacklinkTimeseries(normalized);
      setBacklinkTimeseriesError(null);

      // If DB is empty, auto-refresh once for SUPER_ADMIN to populate data (throttled server-side).
      if (
        normalized.length === 0 &&
        user?.role === "SUPER_ADMIN" &&
        !autoDataForSeoAttemptedRef.current.backlinks[clientId]
      ) {
        autoDataForSeoAttemptedRef.current.backlinks[clientId] = true;
        try {
          await api.post(`/seo/backlinks/${clientId}/refresh`);
          const res2 = await api.get(`/seo/backlinks/${clientId}/timeseries`, { params: { range: 28 } });
          const data2 = Array.isArray(res2.data) ? res2.data : [];
          const normalized2 = data2
            .map((item: any) => ({
              date: item.date,
              newBacklinks: Number(item.newBacklinks ?? item.new_backlinks ?? 0),
              lostBacklinks: Number(item.lostBacklinks ?? item.lost_backlinks ?? 0),
              newReferringDomains: Number(item.newReferringDomains ?? item.new_referring_domains ?? 0),
              lostReferringDomains: Number(item.lostReferringDomains ?? item.lost_referring_domains ?? 0),
            }))
            .filter((item) => item.date)
            .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
          setBacklinkTimeseries(normalized2);
          setBacklinkTimeseriesError(null);
        } catch (refreshError) {
          console.warn("Auto-refresh backlinks skipped/failed", refreshError);
        }
      }
    } catch (error: any) {
      console.error("Failed to fetch backlink timeseries", error);
      setBacklinkTimeseries([]);
      const errorMsg = error?.response?.data?.message || "Unable to load backlink timeseries";
      setBacklinkTimeseriesError(errorMsg);
      // Toast is already shown by API interceptor, but we can add more context if needed
    } finally {
      setBacklinkTimeseriesLoading(false);
    }
  }, [clientId, user?.role]);

  useEffect(() => {
    fetchBacklinkTimeseries();
  }, [fetchBacklinkTimeseries]);

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

    for (const item of backlinkTimeseries) {
      const dt = new Date(item.date);
      if (!Number.isFinite(dt.getTime())) continue;
      const ws = startOfWeek(dt, { weekStartsOn });
      const key = format(ws, "yyyy-MM-dd");
      const bucket = byKey.get(key);
      if (!bucket) continue;
      bucket.newBacklinks += Number(item.newBacklinks) || 0;
      bucket.lostBacklinks += Number(item.lostBacklinks) || 0;
    }

    buckets.sort((a, b) => (a.key < b.key ? 1 : -1));
    return buckets;
  }, [backlinkTimeseries]);

  const backlinksKpis = useMemo(() => {
    const totalBacklinks = Number(dashboardSummary?.backlinkStats?.total ?? 0) || 0;
    const avgDomainRating = Number(dashboardSummary?.backlinkStats?.avgDomainRating ?? 0) || 0;
    const lostCount = Number(dashboardSummary?.backlinkStats?.lost ?? 0) || 0;
    const newLast4Weeks = weeklyBacklinkTimeseries.reduce((sum, w) => sum + (Number(w.newBacklinks) || 0), 0) || 0;
    return { totalBacklinks, avgDomainRating, lostCount, newLast4Weeks };
  }, [dashboardSummary, weeklyBacklinkTimeseries]);

  const fetchBacklinksList = useCallback(async () => {
    if (!clientId) return;
    try {
      setBacklinksLoading(true);
      const res = await api.get(`/seo/backlinks/${clientId}`, {
        params: {
          filter: backlinksFilter,
          days: 30,
          limit: 200,
          sortBy: "domainRating",
          order: "desc",
        },
      });
      const data = Array.isArray(res.data) ? (res.data as BacklinkRow[]) : [];
      setBacklinks(data);
      setBacklinksError(null);
    } catch (error: any) {
      console.error("Failed to fetch backlinks", error);
      setBacklinks([]);
      setBacklinksError(error?.response?.data?.message || "Unable to load backlinks");
    } finally {
      setBacklinksLoading(false);
    }
  }, [clientId, backlinksFilter]);

  useEffect(() => {
    if (activeTab !== "backlinks") return;
    void fetchBacklinksList();
  }, [activeTab, fetchBacklinksList]);

  const openAddBacklink = useCallback(() => {
    if (reportOnly) return;
    const defaultTarget = (() => {
      const domain = (client?.domain || "").trim();
      if (!domain) return "";
      if (/^https?:\/\//i.test(domain)) return domain;
      return `https://${domain}`;
    })();
    setAddBacklinkForm({ sourceUrl: "", targetUrl: defaultTarget, anchorText: "", domainRating: "", isFollow: true });
    setAddBacklinkModalOpen(true);
  }, [client?.domain, reportOnly]);

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

  useEffect(() => {
    if (activeTab !== "dashboard") return;
    void fetchAiSearchVisibility();
  }, [activeTab, fetchAiSearchVisibility]);

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
      const res = await api.get(`/seo/traffic-sources/${clientId}`, {
        params: { limit: 100 },
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
  }, [clientId, ga4Connected, ga4DataRefreshKey]);

  useEffect(() => {
    fetchTrafficSources();
  }, [fetchTrafficSources]);

  // Load single report from server (enforced one report per client)
  const loadReport = useCallback(async () => {
    if (!clientId) return;
    try {
      setReportLoading(true);
      setReportError(null);
      const res = await api.get(`/seo/reports/${clientId}`, { params: { period: "monthly", ensureFresh: true } });
      setServerReport(res.data || null);
    } catch (error: any) {
      console.error("Failed to load report", error);
      const msg = error?.response?.data?.message || "Unable to load report";
      setReportError(msg);
      setServerReport(null);
    } finally {
      setReportLoading(false);
    }
  }, [clientId]);

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
      const period = typeof serverReport.period === "string" ? serverReport.period : "Monthly";
      const dateStr = serverReport.reportDate ? format(new Date(serverReport.reportDate), "yyyy-MM-dd") : "";
      return {
        id: serverReport.id || "report",
        clientId: clientId!,
        name: "Client SEO Report",
        type: period.charAt(0).toUpperCase() + period.slice(1),
        lastGenerated: dateStr,
        status: serverReport.status === "sent" ? "Sent" : serverReport.status === "draft" ? "Draft" : "Scheduled",
        recipients: Array.isArray(serverReport.recipients) && serverReport.recipients.length > 0
          ? serverReport.recipients
          : Array.isArray(serverReport.scheduleRecipients)
          ? serverReport.scheduleRecipients
          : [],
        metrics: {
          keywords: Number(serverReport.totalClicks ?? 0),
          avgPosition: Number(serverReport.averagePosition ?? 0),
          traffic: Number(serverReport.totalImpressions ?? 0),
        },
      };
    }
    // No report exists for this client yet
    return null;
  }, [serverReport, clientId]);

  const handleCreateReportClick = useCallback(() => {
    if (!clientId) {
      toast.error("Client ID is missing");
      return;
    }
    // Open the client-specific report creation modal
    setShowClientReportModal(true);
  }, [clientId]);

  const handleSubmitClientReport = useCallback(async () => {
    if (!clientId) {
      toast.error("Client ID is missing");
      return;
    }

    const recipientsList = clientReportRecipients
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

      // 1) Create or update schedule for this client
      await api.post(`/seo/reports/${clientId}/schedule`, {
        frequency: clientReportFrequency,
        dayOfWeek: clientReportFrequency !== "monthly" ? clientReportDayOfWeek : undefined,
        dayOfMonth: clientReportFrequency === "monthly" ? clientReportDayOfMonth : undefined,
        timeOfDay: clientReportTimeOfDay,
        recipients: recipientsList,
        emailSubject: clientReportEmailSubject || undefined,
        isActive: true,
      });

      // 2) Generate initial report immediately using the chosen frequency as period
      await api.post(`/seo/reports/${clientId}/generate`, {
        period: clientReportFrequency,
      });

      toast.success("Report created and schedule saved successfully");

      // Reload report data from server so UI reflects DB state
      await loadReport();

      // Close modal
      setShowClientReportModal(false);
    } catch (error: any) {
      console.error("Failed to create report and schedule", error);
      const msg = error?.response?.data?.message || "Failed to create report and schedule";
      toast.error(msg);
    } finally {
      setClientReportSubmitting(false);
    }
  }, [
    clientId,
    clientReportDayOfMonth,
    clientReportDayOfWeek,
    clientReportEmailSubject,
    clientReportFrequency,
    clientReportRecipients,
    clientReportTimeOfDay,
    loadReport,
  ]);

  const handleViewReport = (report: ClientReport) => {
    setSelectedReport(report);
    setViewReportModalOpen(true);
  };

  const handleSendReport = useCallback(async () => {
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
  }, [singleReportForClient, loadReport]);

  const handleDeleteReport = useCallback(async () => {
    if (!singleReportForClient) {
      toast.error("No report to delete for this client");
      return;
    }

    if (!window.confirm("Are you sure you want to delete this report? This action cannot be undone.")) {
      return;
    }

    try {
      setReportLoading(true);
      await api.delete(`/seo/reports/${singleReportForClient.id}`);
      toast.success("Report deleted successfully");
      // Reload from server so UI reflects DB (no mock data)
      await loadReport();
    } catch (error: any) {
      console.error("Failed to delete report", error);
      const msg = error?.response?.data?.message || "Failed to delete report";
      toast.error(msg);
    } finally {
      setReportLoading(false);
    }
  }, [singleReportForClient, loadReport]);

  const handleCloseViewModal = () => {
    setViewReportModalOpen(false);
    setSelectedReport(null);
  };

  const resolvedTopPages = useMemo<TopPageItem[]>(() => {
    // Return actual data only, no sample data fallback
    return topPages;
  }, [topPages]);

  const resolvedTrafficSources = useMemo<TrafficSourceSlice[]>(() => {
    // Return actual data only, no sample data fallback
    return trafficSources;
  }, [trafficSources]);

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
            closePopupSafely();
            toast.success('OAuth successful! Loading your GA4 properties...');
            setGa4Connecting(false);
            setGa4ConnectionError(null); // Clear any previous connection errors
            // Fetch properties list
            handleFetchGA4Properties();
          } else if (event.data.type === 'GA4_OAUTH_ERROR') {
            cleanupPopup();
            closePopupSafely();
            toast.error(`GA4 connection failed: ${event.data.error || 'Unknown error'}`);
            setGa4Connecting(false);
          }
        };
        let manualCloseTimeout: number | null = null;

        const closePopupSafely = () => {
          try {
            popup.close();
          } catch (err) {
            // Ignore COOP restrictions when closing
          }
        };

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

        // Set a maximum timeout (5 minutes) to prevent infinite waiting
        // If no message is received, assume user closed the popup or connection failed
        manualCloseTimeout = window.setTimeout(() => {
          cleanupPopup();
          closePopupSafely();
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

  const handleFetchGA4Properties = async () => {
    if (!clientId) return;
    try {
      setLoadingProperties(true);
      const res = await api.get(`/clients/${clientId}/ga4/properties`);
      const properties = res.data?.properties || [];
      
      if (properties.length === 0) {
        toast.error("No GA4 properties found. Please make sure you have access to at least one GA4 property.");
        return;
      }
      
      setGa4Properties(properties);
      setShowGA4Modal(true);
    } catch (error: any) {
      console.error("Failed to fetch GA4 properties:", error);
      toast.error(error.response?.data?.message || "Failed to fetch GA4 properties");
    } finally {
      setLoadingProperties(false);
    }
  };

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
      const res = await api.get(buildDashboardUrl(clientId));
      const payload = res.data || {};
      setDashboardSummary(formatDashboardSummary(payload));
    } catch (error: any) {
      console.error("Failed to connect GA4 property:", error);
      toast.error(error.response?.data?.message || "Failed to connect GA4 property");
    } finally {
      setGa4Connecting(false);
    }
  };

  // Web Visitors (same as Active Users / Total Users)
  const websiteVisitorsDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (ga4Connected !== true) return "—";
    const value = dashboardSummary?.totalUsers ?? dashboardSummary?.activeUsers;
    if (value !== null && value !== undefined) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "—";
  }, [dashboardSummary?.totalUsers, dashboardSummary?.activeUsers, fetchingSummary, ga4Connected]);

  // Organic Traffic (from organicSessions)
  const organicTrafficDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (ga4Connected !== true) return "—";
    if (dashboardSummary?.organicSessions !== null && dashboardSummary?.organicSessions !== undefined) {
      const numeric = Number(dashboardSummary.organicSessions);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "—";
  }, [dashboardSummary?.organicSessions, fetchingSummary, ga4Connected]);

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

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-3">
            {!reportOnly ? (
              <button
                onClick={() => navigate(-1)}
                className="inline-flex items-center space-x-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Clients</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleBackToLogin}
                className="inline-flex items-center space-x-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Login</span>
              </button>
            )}
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mt-2">{client?.name || "Client Dashboard"}</h1>
          {client && (
            <div className="mt-2 text-gray-500 text-sm space-y-1">
              <div>
                <span className="font-medium text-gray-700">Domain:</span>{" "}
                <a
                  href={client.domain.startsWith("http") ? client.domain : `https://${client.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:underline"
                >
                  {client.domain}
                </a>
              </div>
              {client.industry && (
                <div>
                  <span className="font-medium text-gray-700">Industry:</span> {client.industry}
                </div>
              )}
            </div>
          )}
        </div>

        {!reportOnly && <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <select
              value={dateRange}
              onChange={(e) => {
                const newValue = e.target.value;
                setDateRange(newValue);
                if (newValue === "custom") {
                  setShowCustomDatePicker(true);
                  // Set default dates: last 30 days
                  const endDate = new Date();
                  const startDate = new Date();
                  startDate.setDate(startDate.getDate() - 30);
                  setCustomEndDate(endDate.toISOString().split('T')[0]);
                  setCustomStartDate(startDate.toISOString().split('T')[0]);
                } else {
                  setShowCustomDatePicker(false);
                }
              }}
              className="border border-gray-300 rounded-lg px-4 pr-10 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
              <option value="custom">Custom</option>
            </select>
            {showCustomDatePicker && (
              <div className="flex items-center space-x-2">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  max={customEndDate || new Date().toISOString().split('T')[0]}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <span className="text-gray-500">to</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  min={customStartDate || undefined}
                  max={new Date().toISOString().split('T')[0]}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (customStartDate && customEndDate) {
                      try {
                        setFetchingSummary(true);
                        const res = await api.get(buildDashboardUrl(clientId!));
                        const payload = res.data || {};
                        setDashboardSummary(formatDashboardSummary(payload));
                      } catch (error: any) {
                        console.error("Failed to fetch dashboard summary", error);
                        setDashboardSummary(null);
                      } finally {
                        setFetchingSummary(false);
                      }
                    } else {
                      toast.error("Please select both start and end dates");
                    }
                  }}
                  className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors text-sm"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
          {user?.role === "SUPER_ADMIN" && (
            <button
              type="button"
              onClick={handleRefreshDashboard}
              disabled={refreshingDashboard}
              data-pdf-hide="true"
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Refresh dashboard data from DataForSEO and GA4"
            >
              {refreshingDashboard ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Refreshing...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  <span>Refresh</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={exportingPdf}
            className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {exportingPdf ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span>Export</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {sharing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <>
            <Share2 className="h-4 w-4" />
            <span>Share</span>
              </>
            )}
          </button>
        </div>}
      </div>

      {!reportOnly && (
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            {[
              { id: "dashboard", label: "Dashboard", icon: Users },
              { id: "report", label: "Report", icon: FileText },
              { id: "backlinks", label: "Backlinks", icon: Search },
              { id: "worklog", label: "Work Log", icon: Clock },
            ].map((tab) => (
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
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">Loading client data...</div>
      ) : (
        <>
          {!reportOnly && activeTab === "dashboard" && (
            <div ref={dashboardContentRef} className="space-y-8">
              {/* GA4 connection UI (hidden in PDF export) */}
              <div data-pdf-hide="true">
                {/* GA4 Connection Status - Show loading skeleton while checking */}
                {ga4StatusLoading ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 animate-pulse">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="h-6 bg-gray-200 rounded w-48 mb-3"></div>
                        <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
                        <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
                        <div className="h-10 bg-gray-200 rounded w-32"></div>
                      </div>
                      <div className="h-5 w-5 bg-gray-200 rounded"></div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* GA4 Connection Error Banner - Show when connection is invalid */}
                    {ga4ConnectionError && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-red-900 mb-2 flex items-center gap-2">
                              <AlertTriangle className="h-5 w-5" />
                              GA4 Connection Invalid
                            </h3>
                            <p className="text-sm text-red-800 mb-4">
                              {ga4ConnectionError} GA4 data has been cleared to prevent displaying stale information.
                            </p>
                            <button
                              onClick={handleConnectGA4}
                              disabled={ga4Connecting}
                              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {ga4Connecting ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  <span>Connecting...</span>
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="h-4 w-4" />
                                  <span>Reconnect GA4</span>
                                </>
                              )}
                            </button>
                          </div>
                          <button
                            onClick={() => setGa4ConnectionError(null)}
                            className="text-red-600 hover:text-red-800"
                            title="Dismiss warning"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* One-time GA4 auto-refresh indicator */}
                    {autoRefreshingGa4 && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                        <div className="flex items-center gap-3 text-emerald-900">
                          <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                          <div className="text-sm">
                            <span className="font-medium">Refreshing GA4 data…</span>{" "}
                            <span className="text-emerald-800">Just a moment while we pull the latest numbers.</span>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* GA4 Connection Banner */}
                    {/* Show banner when GA4 is not connected (false = confirmed not connected) */}
                    {ga4Connected === false && !ga4ConnectionError && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-yellow-900 mb-2">
                              Connect Google Analytics 4
                            </h3>
                            <p className="text-sm text-yellow-800 mb-4">
                              To view real traffic and analytics data, please connect your Google Analytics 4 account. 
                              Without GA4 connection, traffic metrics cannot be displayed.
                            </p>
                            <button
                              onClick={handleConnectGA4}
                              disabled={ga4Connecting}
                              className="bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {ga4Connecting ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  <span>Connecting...</span>
                                </>
                              ) : (
                                <>
                                  <Search className="h-4 w-4" />
                                  <span>Connect GA4</span>
                                </>
                              )}
                            </button>
                          </div>
                          <button
                            onClick={() => setGa4Connected(null)}
                            className="text-yellow-600 hover:text-yellow-800 ml-4"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    )}
                    {/* GA4 Connected Banner with Disconnect button */}
                    {ga4Connected === true && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center">
                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-emerald-900">
                          GA4 is connected
                        </p>
                        <p className="text-xs text-emerald-800">
                          You can disconnect and connect a different GA4 property at any time.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleDisconnectGA4}
                      disabled={ga4Connecting}
                      className="bg-white border border-emerald-300 text-emerald-800 px-3 py-1.5 rounded-lg text-sm hover:bg-emerald-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {ga4Connecting ? "Disconnecting..." : "Disconnect GA4"}
                    </button>
                  </div>
                    )}
                  </>
                )}
              </div>
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

              <TargetKeywordsOverview
                clientId={clientId}
                clientName={client?.name}
                title="Target Keywords"
                subtitle="Keywords relevant to this client's website based on DataForSEO analysis."
              />

              <RankedKeywordsOverview
                clientId={clientId}
                clientName={client?.name}
                title="Total Keywords Ranked"
                subtitle="Monitor how many organic keywords this client ranks for and how that total changes month-to-month."
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
                    ) : resolvedTrafficSources.length === 0 ? (
                      <div className="flex items-center justify-center h-full">
                        <p className="text-sm text-gray-500">No traffic sources data available.</p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={resolvedTrafficSources as any}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={70}
                            label
                          >
                            {resolvedTrafficSources.map((entry, index) => (
                              <Cell
                                key={`traffic-source-${entry.name}-${index}`}
                                fill={entry.color || TRAFFIC_SOURCE_COLORS.Other}
                              />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
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

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-xl border border-gray-200">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Visitor Sources</h3>
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
                      visitorSources.map((source, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <p className="font-medium text-gray-900">{source.source}</p>
                          <p className="text-sm text-gray-500">{source.users.toLocaleString()} users</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-white p-6 rounded-xl border border-gray-200">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Conversions</h3>
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

              <div className="bg-white rounded-xl border border-gray-200">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                   <div>
                   <h3 className="text-lg font-semibold text-gray-900">Top Pages</h3>
                   {topPagesError && (
                     <p className="mt-2 text-sm text-rose-600">
                       {topPagesError}
                     </p>
                     )}
                   </div>
                  {user?.role === "SUPER_ADMIN" && (
                    <button
                      type="button"
                      onClick={handleRefreshTopPages}
                      disabled={refreshingTopPages}
                      data-pdf-hide="true"
                      className="bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                      title="Refresh top pages from DataForSEO"
                    >
                      {refreshingTopPages ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Refreshing...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3 w-3" />
                          <span>Refresh</span>
                        </>
                      )}
                    </button>
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

          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">New Links</h3>
                <p className="text-sm text-gray-500">Weekly backlinks acquired (last 4 weeks)</p>
              </div>
              {user?.role === "SUPER_ADMIN" && (
              <button
                type="button"
                  onClick={handleRefreshBacklinks}
                  disabled={refreshingBacklinks}
                  data-pdf-hide="true"
                  className="bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                  title="Refresh backlinks from DataForSEO"
                >
                  {refreshingBacklinks ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Refreshing...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3 w-3" />
                <span>Refresh</span>
                    </>
                  )}
              </button>
              )}
            </div>
            <div className="p-6 space-y-4">
              {backlinkTimeseriesLoading ? (
                <p className="text-sm text-gray-500">Loading backlink trends...</p>
              ) : backlinkTimeseriesError ? (
                <p className="text-sm text-red-600">{backlinkTimeseriesError}</p>
              ) : backlinkTimeseries.length === 0 ? (
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
                        <span className="font-medium text-gray-600">
                          {backlinkTimeseriesLoading ? "..." : `${item.newBacklinks} new`}
                        </span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full"
                            style={{ width: `${widthPercent}%` }}
                          />
                        </div>
                        <span className="text-xs text-rose-500 whitespace-nowrap">
                          {backlinkTimeseriesLoading ? "..." : `-${item.lostBacklinks} lost`}
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

          {(reportOnly || activeTab === "report") && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Reports</h2>
                {!reportOnly && (
                  <button
                    onClick={handleCreateReportClick}
                    className="flex items-center justify-center px-3 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700"
                    title="Create report"
                  >
                    Create Report
                  </button>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Generated</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recipients</th>
                        <th className="px-6 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {reportLoading ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">Loading report...</td>
                        </tr>
                      ) : reportError ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-8 text-center text-sm text-rose-600">{reportError}</td>
                        </tr>
                      ) : !singleReportForClient ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                            No reports yet for this client.
                          </td>
                        </tr>
                      ) : (
                        <tr key={singleReportForClient.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{singleReportForClient.name}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{singleReportForClient.type}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{singleReportForClient.lastGenerated}</td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                singleReportForClient.status === "Sent"
                                    ? "bg-green-100 text-green-800"
                                  : singleReportForClient.status === "Draft"
                                    ? "bg-yellow-100 text-yellow-800"
                                    : "bg-blue-100 text-blue-800"
                                }`}
                              >
                              {singleReportForClient.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {singleReportForClient.recipients.join(", ")}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                              <button 
                                onClick={() => handleViewReport(singleReportForClient)}
                                className="text-primary-600 hover:text-primary-800 inline-flex items-center justify-center mr-2"
                                title="View report"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                              <button
                                onClick={handleShare}
                                className="text-gray-500 hover:text-gray-700 inline-flex items-center justify-center mr-2"
                                title="Share dashboard"
                              >
                                <Share2 className="h-4 w-4" />
                              </button>
                              {singleReportForClient.status !== "Sent" && (
                                <button
                                  onClick={handleSendReport}
                                  disabled={sendingReport}
                                  className="text-secondary-600 hover:text-secondary-800 inline-flex items-center justify-center mr-2 disabled:opacity-60 disabled:cursor-not-allowed"
                                  title="Send report via email"
                                >
                                  <Send className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                onClick={handleDeleteReport}
                                className="text-red-600 hover:text-red-800 inline-flex items-center justify-center"
                                title="Delete report"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Client-specific Create Report & Schedule Modal */}
          {showClientReportModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">Create Report & Schedule</h2>
                  <button
                    onClick={() => setShowClientReportModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Configure how often this client's report should be generated and who should receive it.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Frequency</label>
                    <select
                      value={clientReportFrequency}
                      onChange={(e) =>
                        setClientReportFrequency(e.target.value as "weekly" | "biweekly" | "monthly")
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Biweekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  {clientReportFrequency !== "monthly" ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Day of Week</label>
                      <select
                        value={clientReportDayOfWeek}
                        onChange={(e) => setClientReportDayOfWeek(Number(e.target.value))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
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
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Day of Month</label>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={clientReportDayOfMonth}
                        onChange={(e) => setClientReportDayOfMonth(Number(e.target.value))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Time of Day</label>
                    <input
                      type="time"
                      value={clientReportTimeOfDay}
                      onChange={(e) => setClientReportTimeOfDay(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Recipients (comma-separated emails)
                    </label>
                    <input
                      type="text"
                      value={clientReportRecipients}
                      onChange={(e) => setClientReportRecipients(e.target.value)}
                      placeholder="email1@example.com, email2@example.com"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email Subject (optional)</label>
                    <input
                      type="text"
                      value={clientReportEmailSubject}
                      onChange={(e) => setClientReportEmailSubject(e.target.value)}
                      placeholder="Custom email subject"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div className="flex justify-end space-x-3 mt-6">
                    <button
                      type="button"
                      onClick={() => setShowClientReportModal(false)}
                      className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={clientReportSubmitting}
                      onClick={handleSubmitClientReport}
                      className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                    >
                      {clientReportSubmitting ? "Saving..." : "Create Report"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "backlinks" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Backlinks Overview</h2>
                {!reportOnly && (
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => setImportBacklinksModalOpen(true)}
                      className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2"
                    >
                      <Upload className="h-4 w-4" />
                      <span>Import Backlink</span>
                    </button>
                    <button
                      type="button"
                      onClick={openAddBacklink}
                      className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add Backlink</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-xl border border-gray-200">
                  <p className="text-sm font-medium text-gray-600">Total Backlinks</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">{backlinksKpis.totalBacklinks}</p>
                  <div className="mt-3 flex items-center space-x-2 text-sm text-green-600">
                    <TrendingUp className="h-4 w-4" />
                    <span>+{backlinksKpis.newLast4Weeks} new (last 4 weeks)</span>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-xl border border-gray-200">
                  <p className="text-sm font-medium text-gray-600">Average Domain Rating</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">{backlinksKpis.avgDomainRating ? backlinksKpis.avgDomainRating.toFixed(0) : "—"}</p>
                  <div className="mt-3 flex items-center space-x-2 text-sm text-green-600">
                    <TrendingUp className="h-4 w-4" />
                    <span>Calculated from tracked backlinks</span>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-xl border border-gray-200">
                  <p className="text-sm font-medium text-gray-600">Lost Backlinks</p>
                  <p className="text-2xl font-bold text-gray-900 mt-2">{backlinksKpis.lostCount}</p>
                  <div className="mt-3 flex items-center space-x-2 text-sm text-red-600">
                    <TrendingDown className="h-4 w-4" />
                    <span>Tracked lost backlinks</span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200">
                <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Backlinks</h3>
                    <p className="text-sm text-gray-500 mt-1">Monitor follow vs nofollow backlinks and their quality.</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setBacklinksFilter("all")}
                      className={`px-3 py-1 text-sm rounded-lg border hover:bg-gray-50 ${
                        backlinksFilter === "all" ? "border-primary-200 text-primary-700 bg-primary-50" : "border-gray-200 text-gray-700"
                      }`}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setBacklinksFilter("new")}
                      className={`px-3 py-1 text-sm rounded-lg border hover:bg-gray-50 ${
                        backlinksFilter === "new" ? "border-primary-200 text-primary-700 bg-primary-50" : "border-gray-200 text-gray-700"
                      }`}
                    >
                      New
                    </button>
                    <button
                      type="button"
                      onClick={() => setBacklinksFilter("lost")}
                      className={`px-3 py-1 text-sm rounded-lg border hover:bg-gray-50 ${
                        backlinksFilter === "lost" ? "border-primary-200 text-primary-700 bg-primary-50" : "border-gray-200 text-gray-700"
                      }`}
                    >
                      Lost
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Anchor Text</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Domain Rating</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Publish Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                        <th className="px-6 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {backlinksLoading ? (
                        <tr>
                          <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                            Loading backlinks...
                          </td>
                        </tr>
                      ) : backlinksError ? (
                        <tr>
                          <td className="px-6 py-6 text-sm text-rose-600" colSpan={6}>
                            {backlinksError}
                          </td>
                        </tr>
                      ) : backlinks.length === 0 ? (
                        <tr>
                          <td className="px-6 py-6 text-sm text-gray-500" colSpan={6}>
                            No backlinks found yet. If you’re a Super Admin, hit the top “Refresh” button to pull from DataForSEO.
                          </td>
                        </tr>
                      ) : (
                        backlinks.map((link) => {
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
                            <tr key={link.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{source}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{link.anchorText || "—"}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {typeof link.domainRating === "number" ? link.domainRating : "—"}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{publishDate || "—"}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm">
                                <span
                                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                    isManual ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-600"
                                  }`}
                                >
                                  {isManual ? "Manual" : link.isLost ? "Lost" : "Natural"}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <div className="inline-flex items-center gap-3">
                                  <button
                                    type="button"
                                    className="text-primary-600 hover:text-primary-800"
                                    onClick={() => window.open(link.sourceUrl, "_blank", "noopener,noreferrer")}
                                  >
                                    View
                                  </button>
                                  {!reportOnly && (
                                    <button
                                      type="button"
                                      className="text-red-600 hover:text-red-800 inline-flex items-center gap-1"
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
              </div>
            </div>
          )}

          {activeTab === "worklog" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Work Log</h2>
                {!reportOnly && (
                  <button
                    type="button"
                    onClick={openWorkLogCreate}
                    className="bg-primary-600 text-white px-3 py-2 rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center"
                    title="Add entry"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Work Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {workLogLoading ? (
                        <tr>
                          <td className="px-6 py-6 text-sm text-gray-500" colSpan={5}>
                            Loading work log...
                          </td>
                        </tr>
                      ) : workLogError ? (
                        <tr>
                          <td className="px-6 py-6 text-sm text-rose-600" colSpan={5}>
                            {workLogError}
                          </td>
                        </tr>
                      ) : workLogTasks.length === 0 ? (
                        <tr>
                          <td className="px-6 py-6 text-sm text-gray-500" colSpan={5}>
                            No work logged yet.
                          </td>
                        </tr>
                      ) : (
                        workLogTasks.map((task) => {
                          const dateRaw = task.updatedAt || task.createdAt;
                          const date = (() => {
                            try {
                              return new Date(dateRaw).toISOString().slice(0, 10);
                            } catch {
                              return "";
                            }
                          })();
                          const workType = (task.category || "General").trim() || "General";
                          const description = (task.description || task.title || "").trim();
                          return (
                            <tr key={task.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{date}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{workType}</td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{description}</td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${taskStatusClass(task.status)}`}>
                                  {taskStatusLabel(task.status)}
                                </span>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                                <button
                                  type="button"
                                  className="text-primary-600 hover:text-primary-800 inline-flex items-center justify-center mr-2"
                                  title="View entry"
                                  onClick={() => openWorkLogView(task.id)}
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                                {!reportOnly && (
                                  <>
                                    <button
                                      type="button"
                                      className="text-gray-500 hover:text-gray-700 inline-flex items-center justify-center mr-2"
                                      title="Edit entry"
                                      onClick={() => openWorkLogEdit(task.id)}
                                    >
                                      <Edit className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      className="text-red-600 hover:text-red-800 inline-flex items-center justify-center"
                                      title="Delete entry"
                                      onClick={() => handleDeleteWorkLog(task.id, task.title)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </>
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
            </div>
          )}

          {workLogModalOpen && createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div
                className="absolute inset-0 bg-black/50"
                onClick={() => setWorkLogModalOpen(false)}
              />
              <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-gray-200">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {workLogModalMode === "create"
                      ? "Add Work Log Entry"
                      : workLogModalMode === "edit"
                      ? "Edit Work Log Entry"
                      : "Work Log Entry"}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setWorkLogModalOpen(false)}
                    className="p-2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="px-6 py-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                    <input
                      type="text"
                      value={workLogForm.title}
                      onChange={(e) => setWorkLogForm({ ...workLogForm, title: e.target.value })}
                      disabled={workLogModalMode === "view"}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-50"
                      placeholder="e.g. Optimized homepage title tags"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Work Type</label>
                    <input
                      type="text"
                      value={workLogForm.category}
                      onChange={(e) => setWorkLogForm({ ...workLogForm, category: e.target.value })}
                      disabled={workLogModalMode === "view"}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-50"
                      placeholder="e.g. Technical, Content, Link Building"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <textarea
                      value={workLogForm.description}
                      onChange={(e) => setWorkLogForm({ ...workLogForm, description: e.target.value })}
                      disabled={workLogModalMode === "view"}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-50"
                      rows={4}
                      placeholder="Details about the work performed..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select
                      value={workLogForm.status}
                      onChange={(e) => setWorkLogForm({ ...workLogForm, status: e.target.value as TaskStatus })}
                      disabled={workLogModalMode === "view"}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-50"
                    >
                      <option value="TODO">Pending</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="REVIEW">In Review</option>
                      <option value="DONE">Completed</option>
                    </select>
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
                  {!reportOnly && workLogModalMode !== "create" && selectedWorkLogTaskId && (
                    <button
                      type="button"
                      onClick={() => handleDeleteWorkLog(selectedWorkLogTaskId, workLogForm.title)}
                      className="mr-auto px-4 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setWorkLogModalOpen(false)}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    Close
                  </button>
                  {workLogModalMode !== "view" && (
                    <button
                      type="button"
                      onClick={handleSaveWorkLog}
                      className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700"
                    >
                      Save
                    </button>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}
        </>
      )}

      {/* Add Backlink Modal */}
      {!reportOnly &&
        addBacklinkModalOpen &&
        createPortal(
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Add Backlink</h3>
                <button
                  type="button"
                  onClick={() => setAddBacklinkModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Source URL</label>
                  <input
                    type="text"
                    value={addBacklinkForm.sourceUrl}
                    onChange={(e) => setAddBacklinkForm((p) => ({ ...p, sourceUrl: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="https://example.com/page"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target URL</label>
                  <input
                    type="text"
                    value={addBacklinkForm.targetUrl}
                    onChange={(e) => setAddBacklinkForm((p) => ({ ...p, targetUrl: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="https://your-site.com/"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Anchor Text (optional)</label>
                  <input
                    type="text"
                    value={addBacklinkForm.anchorText}
                    onChange={(e) => setAddBacklinkForm((p) => ({ ...p, anchorText: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="e.g. best seo services"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Domain Rating (optional)</label>
                    <input
                      type="number"
                      value={addBacklinkForm.domainRating}
                      onChange={(e) => setAddBacklinkForm((p) => ({ ...p, domainRating: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="e.g. 65"
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={addBacklinkForm.isFollow}
                        onChange={(e) => setAddBacklinkForm((p) => ({ ...p, isFollow: e.target.checked }))}
                      />
                      Follow link
                    </label>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAddBacklinkModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={addingBacklink}
                  onClick={() => void submitAddBacklink()}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {addingBacklink ? "Saving..." : "Add"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Import Backlinks Modal */}
      {!reportOnly &&
        importBacklinksModalOpen &&
        createPortal(
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl rounded-xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Import Backlinks</h3>
                  <p className="text-sm text-gray-500 mt-1">Paste source URLs (one per line). Target URL defaults to this client.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setImportBacklinksModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="px-6 py-4 space-y-3">
                <textarea
                  value={importBacklinksText}
                  onChange={(e) => setImportBacklinksText(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  rows={10}
                  placeholder={"https://example.com/page-1\nhttps://example.com/page-2"}
                />
                <p className="text-xs text-gray-500">
                  Tip: after importing, you can click the top “Refresh” button (Super Admin) to pull live/lost backlink data from DataForSEO.
                </p>
              </div>

              <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setImportBacklinksModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={importingBacklinks}
                  onClick={() => void submitImportBacklinks()}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {importingBacklinks ? "Importing..." : "Import"}
                </button>
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
        isOpen={backlinkDeleteConfirm.isOpen}
        onClose={() => setBacklinkDeleteConfirm({ isOpen: false, backlinkId: null, label: null, isLost: false })}
        onConfirm={() => void confirmRemoveBacklink()}
        title="Remove backlink"
        message={`Remove backlink from "${backlinkDeleteConfirm.label || "this source"}"? This will delete the backlink row from this client.`}
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
      />

      {/* View Report Modal */}
      {viewReportModalOpen && selectedReport && createPortal(
        <div className="fixed top-0 left-0 right-0 bottom-0 bg-black bg-opacity-50 z-50 m-0 p-0">
          <div className="bg-white w-full h-full overflow-hidden flex flex-col m-0 p-0">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{selectedReport.name}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {selectedReport.type} Report • Last Generated: {selectedReport.lastGenerated}
                </p>
              </div>
              <button
                onClick={handleCloseViewModal}
                className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Modal Content - Dashboard View */}
            <div className="flex-1 overflow-y-auto p-6">
              <div ref={modalDashboardContentRef} className="space-y-8">
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

                <RankedKeywordsOverview
                  clientId={clientId || ""}
                  clientName={client?.name}
                  title="Total Keywords Ranked"
                  subtitle="Monitor how many organic keywords this client ranks for and how that total changes month-to-month."
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
                      ) : resolvedTrafficSources.length === 0 ? (
                        <div className="flex items-center justify-center h-full">
                          <p className="text-sm text-gray-500">No traffic sources data available.</p>
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={resolvedTrafficSources as any}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              outerRadius={70}
                              label
                            >
                              {resolvedTrafficSources.map((entry, index) => (
                                <Cell
                                  key={`traffic-source-${entry.name}-${index}`}
                                  fill={entry.color || TRAFFIC_SOURCE_COLORS.Other}
                                />
                              ))}
                            </Pie>
                            <Tooltip />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-semibold text-gray-900">AI Search Visibility</h3>
                      <span className="text-xs text-gray-500">Subscription active</span>
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
                    {user?.role === "SUPER_ADMIN" && (
                      <button
                        type="button"
                        onClick={handleRefreshBacklinks}
                        disabled={refreshingBacklinks}
                        data-pdf-hide="true"
                        className="bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                        title="Refresh backlinks from DataForSEO"
                      >
                        {refreshingBacklinks ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>Refreshing...</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-3 w-3" />
                            <span>Refresh</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  <div className="p-6 space-y-4">
                    {backlinkTimeseriesLoading ? (
                      <p className="text-sm text-gray-500">Loading backlink trends...</p>
                    ) : backlinkTimeseriesError ? (
                      <p className="text-sm text-red-600">{backlinkTimeseriesError}</p>
                    ) : backlinkTimeseries.length === 0 ? (
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
                              <span className="font-medium text-gray-600">
                                {backlinkTimeseriesLoading ? "..." : `${item.newBacklinks} new`}
                              </span>
                            </div>
                            <div className="flex items-center space-x-3">
                              <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary-500 rounded-full"
                                  style={{ width: `${widthPercent}%` }}
                                />
                              </div>
                              <span className="text-xs text-rose-500 whitespace-nowrap">
                                {backlinkTimeseriesLoading ? "..." : `-${item.lostBacklinks} lost`}
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
                   
                   // Find the scrollable container
                   const scrollableContainer = element.closest('.overflow-y-auto') as HTMLElement;
                   const originalScrollTop = scrollableContainer?.scrollTop || 0;
                   
                   try {
                     setExportingPdf(true);
                     document.body.style.overflow = "hidden";
                     
                     // Scroll to top to capture all content
                     if (scrollableContainer) {
                       scrollableContainer.scrollTop = 0;
                       // Wait for scroll to complete
                       await new Promise(resolve => setTimeout(resolve, 200));
                     }
                     
                     const canvas = await html2canvas(element, {
                       scale: 2,
                       useCORS: true,
                       logging: false,
                       backgroundColor: "#FFFFFF",
                       width: element.scrollWidth,
                       height: element.scrollHeight,
                       scrollX: 0,
                       scrollY: 0,
                     });
                     
                     const imgData = canvas.toDataURL("image/png", 1.0);
                     const pdf = new jsPDF("p", "mm", "a4");
                     const pageWidth = pdf.internal.pageSize.getWidth();
                     const pageHeight = pdf.internal.pageSize.getHeight();
                     const imgWidth = pageWidth;
                     const imgHeight = (canvas.height * imgWidth) / canvas.width;
                     
                     let heightLeft = imgHeight;
                     let position = 0;
                     
                     pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
                     heightLeft -= pageHeight;
                     
                     while (heightLeft > 0) {
                       position -= pageHeight;
                       pdf.addPage();
                       pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
                       heightLeft -= pageHeight;
                     }
                     
                     const sanitizedName = selectedReport?.name 
                       ? selectedReport.name.replace(/[^a-z0-9]/gi, "-").toLowerCase() 
                       : "report";
                     const fileName = `${sanitizedName}-${format(new Date(), "yyyyMMdd")}.pdf`;
                     pdf.save(fileName);
                     toast.success("Report exported successfully!");
                     
                     // Restore scroll position
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
            <p className="text-sm text-gray-600 mb-4">
              Select a Google Analytics 4 property to connect. These are all the properties accessible with your Google account.
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
    </div>
  );
};

export default ClientDashboardPage;



