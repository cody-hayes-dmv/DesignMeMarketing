import React, { useEffect, useMemo, useState } from "react";
import {
  Download,
  Plus,
  FileText,
  Mail,
  Calendar,
  Edit,
  Eye,
  Share2,
  X,
  Copy,
  ExternalLink,
  Clock,
  Trash2,
  Send,
  Settings,
  Check,
} from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { useSelector, useDispatch } from "react-redux";
import { RootState } from "@/store";
import { fetchClients } from "@/store/slices/clientSlice";
import { useNavigate } from "react-router-dom";
import ConfirmDialog from "@/components/ConfirmDialog";
import { ReportEmptyState, ReportSection } from "@/components/report/ReportPrimitives";
import {
  formatReportPeriodLabel,
  getReportStatusBadgeClass,
  normalizeReportStatus,
  toDisplayReportStatus,
} from "@/lib/reportPresentation";

interface Report {
  id: string;
  reportDate: string;
  period: string;
  status?: string;
  clientId: string;
  client?: {
    id: string;
    name: string;
    domain: string;
  };
  totalSessions: number;
  organicSessions: number;
  totalClicks: number;
  totalImpressions: number;
  averageCtr: number;
  averagePosition: number;
  recipients?: string[];
  scheduleRecipients?: string[];
  emailSubject?: string;
  createdAt: string;
}

interface ReportSchedule {
  id: string;
  frequency: "weekly" | "biweekly" | "monthly";
  dayOfWeek?: number;
  dayOfMonth?: number;
  timeOfDay: string;
  recipients: string[];
  emailSubject?: string;
  isActive: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  clientId: string;
}

interface CampaignWinsSettings {
  enabled: boolean;
  recipients: string[];
  lastSent?: string | null;
}

const ReportsPage: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);
  const { clients } = useSelector((state: RootState) => state.client);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showCampaignWinsModal, setShowCampaignWinsModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [selectedReportForSend, setSelectedReportForSend] = useState<Report | null>(null);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [campaignWinsByClient, setCampaignWinsByClient] = useState<Record<string, CampaignWinsSettings>>({});
  const [campaignWinsDrafts, setCampaignWinsDrafts] = useState<Record<string, { enabled: boolean; recipients: string }>>({});
  const [instantSendingCampaignWins, setInstantSendingCampaignWins] = useState<Record<string, boolean>>({});
  const [previewingCampaignWins, setPreviewingCampaignWins] = useState<Record<string, boolean>>({});
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
  const [removeCampaignWinsConfirm, setRemoveCampaignWinsConfirm] = useState<{
    isOpen: boolean;
    clientId: string | null;
    clientName: string | null;
  }>({
    isOpen: false,
    clientId: null,
    clientName: null,
  });
  const [instantSendCampaignWinsConfirm, setInstantSendCampaignWinsConfirm] = useState<{
    isOpen: boolean;
    clientId: string | null;
    clientName: string | null;
  }>({
    isOpen: false,
    clientId: null,
    clientName: null,
  });
  const [filterClientId, setFilterClientId] = useState<string>("all");
  const [cardFilter, setCardFilter] = useState<"total" | "active" | "sent" | "scheduled" | "draft">("active");

  const activeClientIds = useMemo(
    () => new Set(clients.filter((c) => c.status === "ACTIVE").map((c) => c.id)),
    [clients]
  );
  const activeReports = useMemo(
    () => reports.filter((r) => activeClientIds.has(r.clientId)),
    [reports, activeClientIds]
  );

  useEffect(() => {
    // Fetch clients first if not already loaded
    if (clients.length === 0) {
      dispatch(fetchClients() as any);
    }
  }, [dispatch, clients.length]);

  useEffect(() => {
    // Fetch reports when clients are available
    if (clients.length > 0) {
      fetchReports();
      fetchSchedules();
      fetchCampaignWinsSettings();
    }
  }, [clients]);

  const fetchSchedules = async () => {
    try {
      const schedulePromises = clients.map((client) =>
        api.get(`/seo/reports/${client.id}/schedules`).catch(() => ({ data: [] }))
      );
      const scheduleResponses = await Promise.all(schedulePromises);
      const allSchedules: ReportSchedule[] = [];
      scheduleResponses.forEach((response) => {
        if (response?.data && Array.isArray(response.data)) {
          response.data.forEach((schedule: ReportSchedule) => {
            allSchedules.push(schedule);
          });
        }
      });
      setSchedules(allSchedules);
    } catch (error: any) {
      console.error("Failed to fetch schedules:", error);
    }
  };

  const fetchReports = async () => {
    try {
      setLoading(true);
      // Fetch reports for all clients (one report per client)
      const reportPromises = clients.map((client) =>
        api.get(`/seo/reports/${client.id}`).catch(() => null)
      );
      const reportResponses = await Promise.all(reportPromises);
      
      // Also fetch schedules to determine status
      const schedulePromises = clients.map((client) =>
        api.get(`/seo/reports/${client.id}/schedules`).catch(() => ({ data: [] }))
      );
      const scheduleResponses = await Promise.all(schedulePromises);
      
      const allReports: Report[] = [];
      reportResponses.forEach((response, index) => {
        // Response is a single report object or null (not an array)
        if (response?.data && typeof response.data === 'object' && response.data.id) {
          const report = response.data;
          
          // Check if there's an active schedule for this client
          const clientSchedules = scheduleResponses[index]?.data || [];
          const clientId = report.clientId || clients[index]?.id;
          const hasActiveSchedule = Array.isArray(clientSchedules) && 
            clientSchedules.some((s: ReportSchedule) => s.isActive && s.clientId === clientId);
          
          // If report is draft but has active schedule, show as scheduled
          let displayStatus = normalizeReportStatus(report.status);
          if (displayStatus === "draft" && hasActiveSchedule) {
            displayStatus = "scheduled";
          }
          
          // Use client from report if available, otherwise fallback to clients array
          const client = report.client || clients[index];
          
          allReports.push({
            ...report,
            recipients:
              Array.isArray(report.recipients) && report.recipients.length > 0
                ? report.recipients
                : Array.isArray(report.scheduleRecipients)
                  ? report.scheduleRecipients
                  : [],
            status: displayStatus,
            client: client ? {
              id: client.id,
              name: client.name,
              domain: client.domain || "",
            } : undefined,
          });
        }
      });
      
      setReports(allReports);
    } catch (error: any) {
      console.error("Failed to fetch reports:", error);
      toast.error("Failed to fetch reports");
    } finally {
      setLoading(false);
    }
  };

  const fetchCampaignWinsSettings = async () => {
    try {
      const responses = await Promise.all(
        clients.map((client) =>
          api.get(`/seo/reports/${client.id}/campaign-wins`).catch(() => ({ data: null }))
        )
      );
      const next: Record<string, CampaignWinsSettings> = {};
      responses.forEach((response, index) => {
        const clientId = clients[index]?.id;
        if (!clientId || !response?.data) return;
        next[clientId] = {
          enabled: Boolean(response.data.enabled),
          recipients: Array.isArray(response.data.recipients) ? response.data.recipients : [],
          lastSent: response.data.lastSent || null,
        };
      });
      setCampaignWinsByClient(next);
      setCampaignWinsDrafts((prev) => {
        const merged: Record<string, { enabled: boolean; recipients: string }> = { ...prev };
        Object.entries(next).forEach(([clientId, settings]) => {
          merged[clientId] = {
            enabled: settings.enabled,
            recipients: settings.recipients.join(", "),
          };
        });
        return merged;
      });
    } catch (error) {
      console.error("Failed to fetch campaign wins settings:", error);
    }
  };

  const handleShareClick = async (report: Report) => {
    if (!report.clientId) {
      toast.error("Client information not available");
      return;
    }
    
    try {
      const res = await api.post(`/seo/share-link/${report.clientId}`);
      const token = res.data?.token;
      if (!token) {
        toast.error("Failed to generate share link");
        return;
      }
      const url = `${window.location.origin}/share/${encodeURIComponent(token)}`;
      setShareLink(url);
      setShowShareModal(true);
    } catch (error: any) {
      console.error("Share link error", error);
      toast.error(error.response?.data?.message || "Failed to generate share link");
    }
  };

  const handleCopyLink = async () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareLink);
      toast.success("Link copied to clipboard!");
    } else {
      // Fallback
      prompt("Copy this shareable link:", shareLink);
    }
  };

  const handleOpenLink = () => {
    window.open(shareLink, "_blank");
  };

  const handleViewClick = (report: Report) => {
    if (report.clientId) {
      navigate(`/agency/clients/${report.clientId}`, { state: { tab: "report" } });
    }
  };

  const handleGenerateReport = async (clientId: string, period: string) => {
    try {
      await api.post(`/seo/reports/${clientId}/generate`, { period });
      toast.success("Report generated successfully!");
      setShowGenerateModal(false);
      fetchReports();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to generate report");
    }
  };

  const handleSendReport = async (reportId: string, recipients: string[], emailSubject?: string) => {
    try {
      await api.post(`/seo/reports/${reportId}/send`, { recipients, emailSubject });
      toast.success("Report sent successfully!");
      setShowSendModal(false);
      setSelectedReportForSend(null);
      fetchReports();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to send report");
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    if (!confirm("Are you sure you want to delete this report? This action cannot be undone.")) {
      return;
    }
    try {
      await api.delete(`/seo/reports/${reportId}`);
      toast.success("Report deleted successfully!");
      fetchReports();
      fetchSchedules(); // Refresh schedules in case report was linked to one
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to delete report");
    }
  };

  const handleExportReports = () => {
    // Filter reports based on view mode (active vs all) and selected client
    const reportsToExport = filterClientId === "all"
      ? reportsForView
      : reportsForView.filter((r) => r.clientId === filterClientId);
    
    if (reportsToExport.length === 0) {
      toast.error("No reports to export");
      return;
    }

    // Convert to CSV
    const headers = ["Client", "Period", "Status", "Date", "Total Sessions", "Organic Sessions", "Total Clicks", "Total Impressions", "Avg CTR", "Avg Position"];
    const rows = reportsToExport.map(report => [
      report.client?.name || "Unknown",
      report.period,
      report.status || "draft",
      new Date(report.reportDate).toLocaleDateString(),
      report.totalSessions || 0,
      report.organicSessions || 0,
      report.totalClicks || 0,
      report.totalImpressions || 0,
      ((report.averageCtr || 0) * 100).toFixed(2) + "%",
      (report.averagePosition || 0).toFixed(1)
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    // Download CSV
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `seo-reports-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast.success("Reports exported successfully!");
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!confirm("Are you sure you want to delete this schedule?")) return;
    try {
      await api.delete(`/seo/reports/schedules/${scheduleId}`);
      toast.success("Schedule deleted successfully!");
      // Refresh both schedules and reports so report status updates (e.g. Scheduled -> Draft)
      fetchSchedules();
      fetchReports();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to delete schedule");
    }
  };

  const handleSaveCampaignWins = async (clientId: string, recipientsCsv: string, enabled: boolean) => {
    const recipients = recipientsCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (enabled && recipients.length === 0) {
      toast.error("Please enter at least one recipient email");
      return;
    }
    try {
      await api.post(`/seo/reports/${clientId}/campaign-wins`, { enabled, recipients });
      toast.success("Campaign Wins settings saved");
      fetchCampaignWinsSettings();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to save Campaign Wins settings");
    }
  };

  const handleDeleteCampaignWins = async (clientId: string) => {
    try {
      await api.delete(`/seo/reports/${clientId}/campaign-wins`);
      const clientName = clients.find((c) => c.id === clientId)?.name || "Client";
      setCampaignWinsByClient((prev) => {
        const next = { ...prev };
        delete next[clientId];
        return next;
      });
      setCampaignWinsDrafts((prev) => {
        const next = { ...prev };
        delete next[clientId];
        return next;
      });
      toast.success(`Campaign Wins removed for ${clientName}`);
      fetchCampaignWinsSettings();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to disable Campaign Wins");
    }
  };

  const confirmDeleteCampaignWins = async () => {
    if (!removeCampaignWinsConfirm.clientId) return;
    await handleDeleteCampaignWins(removeCampaignWinsConfirm.clientId);
    setRemoveCampaignWinsConfirm({ isOpen: false, clientId: null, clientName: null });
  };

  const handleInstantSendCampaignWins = async (clientId: string) => {
    const draft = campaignWinsDrafts[clientId];
    const isEnabled = draft?.enabled ?? campaignWinsByClient[clientId]?.enabled ?? false;
    if (!isEnabled) {
      toast.error("Campaign Wins is inactive for this client");
      return;
    }

    setInstantSendingCampaignWins((prev) => ({ ...prev, [clientId]: true }));
    try {
      const res = await api.post(`/seo/reports/${clientId}/campaign-wins/instant-send`);
      const sentTo = Array.isArray(res?.data?.recipients) ? res.data.recipients.length : 0;
      toast.success(sentTo > 0 ? `Preview sent to ${sentTo} recipient${sentTo === 1 ? "" : "s"}` : "Campaign Wins preview sent");
      fetchCampaignWinsSettings();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to send Campaign Wins preview");
    } finally {
      setInstantSendingCampaignWins((prev) => ({ ...prev, [clientId]: false }));
    }
  };

  const openInstantSendCampaignWinsConfirm = (clientId: string, clientName: string) => {
    const draft = campaignWinsDrafts[clientId];
    const isEnabled = draft?.enabled ?? campaignWinsByClient[clientId]?.enabled ?? false;
    if (!isEnabled) {
      toast.error("Campaign Wins is inactive for this client");
      return;
    }
    setInstantSendCampaignWinsConfirm({
      isOpen: true,
      clientId,
      clientName,
    });
  };

  const confirmInstantSendCampaignWins = async () => {
    if (!instantSendCampaignWinsConfirm.clientId) return;
    const clientId = instantSendCampaignWinsConfirm.clientId;
    setInstantSendCampaignWinsConfirm({ isOpen: false, clientId: null, clientName: null });
    await handleInstantSendCampaignWins(clientId);
  };

  const handlePreviewCampaignWins = async (clientId: string, clientName: string) => {
    const draft = campaignWinsDrafts[clientId];
    const isEnabled = draft?.enabled ?? campaignWinsByClient[clientId]?.enabled ?? false;
    if (!isEnabled) {
      toast.error("Campaign Wins is inactive for this client");
      return;
    }

    setPreviewingCampaignWins((prev) => ({ ...prev, [clientId]: true }));
    try {
      const res = await api.get(`/seo/reports/${clientId}/campaign-wins/preview`);
      setCampaignWinsPreviewModal({
        open: true,
        clientName,
        subject: String(res?.data?.subject || ""),
        recipients: Array.isArray(res?.data?.recipients) ? res.data.recipients : [],
        html: String(res?.data?.html || ""),
      });
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to load Campaign Wins preview");
    } finally {
      setPreviewingCampaignWins((prev) => ({ ...prev, [clientId]: false }));
    }
  };

  const handleTriggerSchedule = async (scheduleId: string) => {
    if (!confirm("This will generate and send the report immediately. Continue?")) return;
    try {
      const res = await api.post(`/seo/reports/schedules/${scheduleId}/trigger`);
      toast.success(res.data?.message || "Report sent successfully!");
      fetchReports();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to trigger schedule");
    }
  };

  // Calculate statistics from actual database reports
  const totalReports = reports.length;
  const activeReportsCount = activeReports.length;
  const sentReports = reports.filter((r) => normalizeReportStatus(r.status) === "sent").length;
  const scheduledReports = reports.filter((r) => normalizeReportStatus(r.status) === "scheduled").length;
  const draftReports = reports.filter((r) => normalizeReportStatus(r.status) === "draft").length;
  const configuredCampaignWinsClients = clients.filter((client) => campaignWinsByClient[client.id]?.enabled);

  const reportsForView = useMemo(() => {
    switch (cardFilter) {
      case "active":
        return activeReports;
      case "sent":
        return reports.filter((r) => normalizeReportStatus(r.status) === "sent");
      case "scheduled":
        return reports.filter((r) => normalizeReportStatus(r.status) === "scheduled");
      case "draft":
        return reports.filter((r) => normalizeReportStatus(r.status) === "draft");
      default:
        return reports;
    }
  }, [cardFilter, reports, activeReports]);

  const clientsForFilter = cardFilter === "active"
    ? clients.filter((c) => c.status === "ACTIVE")
    : clients;
  const filteredReports = reportsForView.filter(
    (report) => filterClientId === "all" || report.clientId === filterClientId
  );
  const brandName = user?.agencyBranding?.brandDisplayName || "Your Marketing Dashboard";
  const brandColor = user?.agencyBranding?.primaryColor || "#e11d48";
  const brandLogo = user?.agencyBranding?.logoUrl || null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-rose-50/30 p-8 space-y-8">
      <div
        className="relative mb-2 overflow-hidden rounded-2xl p-8 shadow-lg"
        style={{ backgroundImage: `linear-gradient(to right, ${brandColor}, #db2777, #ef4444)` }}
      >
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNnKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 overflow-hidden rounded-lg bg-white/20 flex items-center justify-center">
              {brandLogo ? (
                <img src={brandLogo} alt={brandName} className="h-full w-full object-cover" />
              ) : (
                <FileText className="h-5 w-5 text-white" />
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-white/80">{brandName}</p>
            <h1 className="text-2xl font-bold text-white md:text-3xl">Reports</h1>
            <p className="mt-2 text-rose-100 text-sm md:text-base">View all generated reports across your clients.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportReports}
              className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <Download className="h-4 w-4" />
              <span>Export</span>
            </button>
            <button
              onClick={() => setShowGenerateModal(true)}
              className="flex items-center gap-2 rounded-lg bg-white/20 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <Plus className="h-5 w-5" />
              <span>Generate Report</span>
            </button>
            <button
              onClick={() => setShowScheduleModal(true)}
              className="flex items-center gap-2 rounded-lg bg-white/20 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <Calendar className="h-5 w-5" />
              <span>Schedule Report</span>
            </button>
            <button
              onClick={() => {
                setShowCampaignWinsModal(true);
              }}
              className="flex items-center gap-2 rounded-lg bg-white/20 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <Settings className="h-5 w-5" />
              <span>Campaign Wins Report</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
        <button
          type="button"
          onClick={() => { setCardFilter("total"); setFilterClientId("all"); }}
          className={`text-left bg-white p-6 rounded-xl border-2 transition-all ${
            cardFilter === "total" ? "border-primary-500 ring-2 ring-primary-200 shadow-md" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Reports</p>
              <p className="text-2xl font-bold text-gray-900">{totalReports}</p>
            </div>
            <FileText className="h-8 w-8 text-primary-600" />
          </div>
        </button>
        <button
          type="button"
          onClick={() => { setCardFilter("active"); setFilterClientId("all"); }}
          className={`text-left bg-white p-6 rounded-xl border-2 transition-all ${
            cardFilter === "active" ? "border-emerald-500 ring-2 ring-emerald-200 shadow-md" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Reports</p>
              <p className="text-2xl font-bold text-emerald-600">{activeReportsCount}</p>
            </div>
            <FileText className="h-8 w-8 text-emerald-600" />
          </div>
          <p className="text-xs text-gray-500 mt-1">Reports for active clients only</p>
        </button>
        <button
          type="button"
          onClick={() => { setCardFilter("sent"); setFilterClientId("all"); }}
          className={`text-left bg-white p-6 rounded-xl border-2 transition-all ${
            cardFilter === "sent" ? "border-secondary-500 ring-2 ring-secondary-200 shadow-md" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Sent</p>
              <p className="text-2xl font-bold text-secondary-600">{sentReports}</p>
            </div>
            <Mail className="h-8 w-8 text-secondary-600" />
          </div>
        </button>
        <button
          type="button"
          onClick={() => { setCardFilter("scheduled"); setFilterClientId("all"); }}
          className={`text-left bg-white p-6 rounded-xl border-2 transition-all ${
            cardFilter === "scheduled" ? "border-accent-500 ring-2 ring-accent-200 shadow-md" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Scheduled</p>
              <p className="text-2xl font-bold text-accent-600">{scheduledReports}</p>
            </div>
            <Calendar className="h-8 w-8 text-accent-600" />
          </div>
        </button>
        <button
          type="button"
          onClick={() => { setCardFilter("draft"); setFilterClientId("all"); }}
          className={`text-left bg-white p-6 rounded-xl border-2 transition-all ${
            cardFilter === "draft" ? "border-gray-500 ring-2 ring-gray-200 shadow-md" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Drafts</p>
              <p className="text-2xl font-bold text-gray-900">{draftReports}</p>
            </div>
            <Edit className="h-8 w-8 text-gray-600" />
          </div>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {cardFilter === "total" && "All Reports"}
            {cardFilter === "active" && "Active Reports"}
            {cardFilter === "sent" && "Sent Reports"}
            {cardFilter === "scheduled" && "Scheduled Reports"}
            {cardFilter === "draft" && "Draft Reports"}
            <span className="ml-2 text-sm font-normal text-gray-500">({filteredReports.length})</span>
          </h2>
          <select
            value={filterClientId}
            onChange={(e) => setFilterClientId(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2"
          >
            <option value="all">{cardFilter === "active" ? "All Active Clients" : "All Clients"}</option>
            {clientsForFilter.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" aria-label="Reports list">
            <thead>
              <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-400 first:border-l-0">Report</th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider border-l-4 border-emerald-300">Type</th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Project</th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Status</th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Last Generated</th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Recipients</th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500 bg-gray-50/50">
                    Loading reports...
                  </td>
                </tr>
              ) : filteredReports.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500 bg-amber-50/50">
                    {cardFilter === "active"
                      ? "No reports for active clients. Try \"Total Reports\" or create a report for an active client."
                      : `No ${cardFilter === "total" ? "" : cardFilter + " "}reports found.`}
                  </td>
                </tr>
              ) : (
                filteredReports.map((report, index) => (
                <tr key={report.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                        <div className="text-sm font-medium text-gray-900">
                          {formatReportPeriodLabel(report.period)} Report - {report.client?.name || "Unknown Client"}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatReportPeriodLabel(report.period)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {report.client?.name || "Unknown"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getReportStatusBadgeClass(report.status)}`}>
                        {toDisplayReportStatus(report.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {new Date(report.reportDate).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 max-w-sm break-words">
                      {Array.isArray(report.recipients) && report.recipients.length > 0
                        ? report.recipients.join(", ")
                        : "No recipients"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleViewClick(report)}
                          className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="View report"
                          aria-label={`View report for ${report.client?.name || "client"}`}
                        >
                        <Eye className="h-4 w-4" />
                      </button>
                        <button
                          onClick={() => handleShareClick(report)}
                          className="p-2 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                          title="Share report"
                          aria-label={`Share report for ${report.client?.name || "client"}`}
                        >
                        <Share2 className="h-4 w-4" />
                      </button>
                        {normalizeReportStatus(report.status) !== "sent" && (
                          <button
                            onClick={() => {
                              setSelectedReportForSend(report);
                              setShowSendModal(true);
                            }}
                            className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                            title="Send report via email"
                            aria-label={`Send report for ${report.client?.name || "client"}`}
                          >
                            <Send className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteReport(report.id)}
                          className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Delete report"
                          aria-label={`Delete report for ${report.client?.name || "client"}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                    </div>
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate Report Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-gray-200/80 max-w-md w-full mx-4 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 bg-gradient-to-r from-primary-600 via-primary-500 to-blue-600 text-white rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Generate Report</h2>
                  <p className="text-sm text-white/90">Choose client and period</p>
                </div>
              </div>
              <button onClick={() => setShowGenerateModal(false)} className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 bg-gray-50/50">
              <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5 space-y-4">
                <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  Client & Period
                </h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Client</label>
                  <select
                    value={selectedClient || ""}
                    onChange={(e) => setSelectedClient(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">Select a client</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Period</label>
                  <select
                    id="period"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    defaultValue="monthly"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200 bg-gray-100/80 -mx-6 -mb-6 px-6 py-4 rounded-b-2xl">
                <button
                  onClick={() => setShowGenerateModal(false)}
                  className="px-4 py-2.5 border border-gray-300 bg-white text-gray-700 rounded-xl hover:bg-gray-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const period = (document.getElementById("period") as HTMLSelectElement)?.value || "monthly";
                    if (selectedClient) {
                      handleGenerateReport(selectedClient, period);
                    } else {
                      toast.error("Please select a client");
                    }
                  }}
                  className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg transition-all"
                >
                  Generate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Report Modal */}
      {showScheduleModal && (
        <ScheduleReportModal
          clients={clients}
          onClose={() => setShowScheduleModal(false)}
          onSuccess={() => {
            setShowScheduleModal(false);
            fetchSchedules();
          }}
        />
      )}
      {showCampaignWinsModal && (
        <CampaignWinsReportModal
          clients={clients}
          onClose={() => setShowCampaignWinsModal(false)}
          onSuccess={() => {
            setShowCampaignWinsModal(false);
            fetchCampaignWinsSettings();
          }}
        />
      )}

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Share Report</h2>
              <button onClick={() => setShowShareModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Shareable Link
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={shareLink}
                    readOnly
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 bg-gray-50 text-sm"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                    title="Copy link"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Anyone with this link can view the report. The link will expire after 30 days.
              </p>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowShareModal(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Close
                </button>
                <button
                  onClick={handleOpenLink}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center space-x-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  <span>Open Link</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Send Report Modal */}
      {showSendModal && selectedReportForSend && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Send Report</h2>
              <button onClick={() => {
                setShowSendModal(false);
                setSelectedReportForSend(null);
              }} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SendReportModal
              report={selectedReportForSend}
              onSend={(recipients, emailSubject) => {
                handleSendReport(selectedReportForSend.id, recipients, emailSubject);
              }}
              onClose={() => {
                setShowSendModal(false);
                setSelectedReportForSend(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Schedules Section */}
      {schedules.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 mt-8">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Scheduled Reports</h2>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              {schedules.map((schedule) => {
                const client = clients.find((c) => c.id === schedule.clientId);
                const frequencyLabel = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);
                const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                const scheduleText = schedule.frequency === "monthly"
                  ? `Every month on day ${schedule.dayOfMonth} at ${schedule.timeOfDay}`
                  : `Every ${frequencyLabel.toLowerCase()} on ${dayNames[schedule.dayOfWeek || 0]} at ${schedule.timeOfDay}`;

                return (
                  <div key={schedule.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <Clock className="h-5 w-5 text-gray-400" />
                        <div>
                          <p className="font-medium text-gray-900">
                            {client?.name || "Unknown Client"} - {frequencyLabel} Report
                          </p>
                          <p className="text-sm text-gray-600">{scheduleText}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Recipients: {(Array.isArray(schedule.recipients) ? schedule.recipients : []).join(", ")                            }
                          </p>
                          {schedule.nextRunAt && (
                            <p className="text-xs text-gray-500">
                              Next run: {new Date(schedule.nextRunAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className={`px-2 py-1 text-xs rounded-full ${schedule.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                        {schedule.isActive ? "Active" : "Inactive"}
                      </span>
                      <button
                        onClick={() => handleTriggerSchedule(schedule.id)}
                        className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg"
                        title="Trigger now (send report immediately)"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteSchedule(schedule.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete schedule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <ReportSection
        title="Campaign Wins Report"
        subtitle="Automatically sends positive milestone updates. You can also send an instant preview email."
        className="mt-8"
      >
        <div className="space-y-4">
          {configuredCampaignWinsClients.length === 0 && (
            <ReportEmptyState message="No Campaign Wins items configured." />
          )}
          {configuredCampaignWinsClients.map((client) => {
            const settings = campaignWinsByClient[client.id] || { enabled: false, recipients: [], lastSent: null };
            const draft = campaignWinsDrafts[client.id] || { enabled: settings.enabled, recipients: settings.recipients.join(", ") };
            return (
              <div key={client.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <p className="font-medium text-gray-900">{client.name}</p>
                  <span className={`px-2 py-1 text-xs rounded-full ${draft.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
                    {draft.enabled ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <label className="text-sm">
                    <span className="block text-gray-700 mb-1">Status</span>
                    <select
                      value={draft.enabled ? "active" : "inactive"}
                      onChange={(e) =>
                        setCampaignWinsDrafts((prev) => ({
                          ...prev,
                          [client.id]: {
                            enabled: e.target.value === "active",
                            recipients: draft.recipients,
                          },
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <label className="text-sm md:col-span-2">
                    <span className="block text-gray-700 mb-1">Recipient emails</span>
                    <input
                      value={draft.recipients}
                      onChange={(e) =>
                        setCampaignWinsDrafts((prev) => ({
                          ...prev,
                          [client.id]: {
                            enabled: draft.enabled,
                            recipients: e.target.value,
                          },
                        }))
                      }
                      placeholder="email1@example.com, email2@example.com"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </label>
                  <div className="text-sm text-gray-600">
                    <div>Last sent</div>
                    <div className="font-medium text-gray-900">
                      {settings.lastSent ? new Date(settings.lastSent).toLocaleString() : "Not sent yet"}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => handlePreviewCampaignWins(client.id, client.name)}
                    disabled={Boolean(previewingCampaignWins[client.id]) || !draft.enabled}
                    className="p-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 inline-flex items-center justify-center"
                    title="View HTML"
                    aria-label="View HTML"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => openInstantSendCampaignWinsConfirm(client.id, client.name)}
                    disabled={Boolean(instantSendingCampaignWins[client.id]) || !draft.enabled}
                    className="p-2 rounded-lg border border-primary-200 text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60 inline-flex items-center justify-center"
                    title="Instant Send"
                    aria-label="Instant Send"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() =>
                      setRemoveCampaignWinsConfirm({
                        isOpen: true,
                        clientId: client.id,
                        clientName: client.name,
                      })
                    }
                    className="p-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center justify-center"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleSaveCampaignWins(client.id, draft.recipients, draft.enabled)}
                    className="p-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 inline-flex items-center justify-center"
                    title="Save"
                    aria-label="Save"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </ReportSection>
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
      <ConfirmDialog
        isOpen={instantSendCampaignWinsConfirm.isOpen}
        onClose={() => setInstantSendCampaignWinsConfirm({ isOpen: false, clientId: null, clientName: null })}
        onConfirm={confirmInstantSendCampaignWins}
        title="Instant Send Campaign Wins"
        message={`Send a Campaign Wins preview email now for "${instantSendCampaignWinsConfirm.clientName || "this client"}"?`}
        confirmText="Send now"
      />
      <ConfirmDialog
        isOpen={removeCampaignWinsConfirm.isOpen}
        onClose={() => setRemoveCampaignWinsConfirm({ isOpen: false, clientId: null, clientName: null })}
        onConfirm={confirmDeleteCampaignWins}
        title="Remove Campaign Wins"
        message={`Are you sure you want to remove Campaign Wins for "${removeCampaignWinsConfirm.clientName || "this client"}"?`}
        confirmText="Remove"
        variant="warning"
      />
    </div>
  );
};

// Schedule Report Modal Component
const ScheduleReportModal: React.FC<{
  clients: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ clients, onClose, onSuccess }) => {
  const [clientId, setClientId] = useState("");
  const [reportType, setReportType] = useState<"weekly" | "biweekly" | "monthly">("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [recipients, setRecipients] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) {
      toast.error("Please select a client");
      return;
    }

    const recipientsList = recipients.split(",").map((email) => email.trim()).filter(Boolean);
    if (recipientsList.length === 0) {
      toast.error("Please enter at least one recipient email");
      return;
    }

    setLoading(true);
    try {
      await api.post(`/seo/reports/${clientId}/schedule`, {
        frequency: reportType,
        dayOfWeek: reportType !== "monthly" ? dayOfWeek : undefined,
        dayOfMonth: reportType === "monthly" ? dayOfMonth : undefined,
        timeOfDay,
        recipients: recipientsList,
        emailSubject: emailSubject || undefined,
        isActive: true,
      });
      toast.success("Report schedule created successfully!");
      onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to create schedule");
    } finally {
      setLoading(false);
    }
  };

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-gray-200/80 max-w-lg w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 bg-gradient-to-r from-primary-600 via-primary-500 to-blue-600 text-white rounded-t-2xl shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Schedule Report</h2>
              <p className="text-sm text-white/90">Set up recurring report delivery</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50 space-y-5">
            <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                Client
              </h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Client</label>
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                >
                  <option value="">Select a client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-emerald-900 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Schedule
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Report Type</label>
                  <select
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value as "weekly" | "biweekly" | "monthly")}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                {reportType !== "monthly" ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Day of Week</label>
                    <select
                      value={dayOfWeek}
                      onChange={(e) => setDayOfWeek(Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      required
                    >
                      {dayNames.map((day, index) => (
                        <option key={index} value={index}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Day of Month</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={dayOfMonth}
                      onChange={(e) => setDayOfMonth(Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      required
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Time of Day</label>
                  <input
                    type="time"
                    value={timeOfDay}
                    onChange={(e) => setTimeOfDay(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>
            </div>
            <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-amber-900 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Recipients
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Recipients (comma-separated emails)
                  </label>
                  <input
                    type="text"
                    value={recipients}
                    onChange={(e) => setRecipients(e.target.value)}
                    placeholder="email1@example.com, email2@example.com"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email Subject (optional)</label>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Custom email subject"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-100/80 rounded-b-2xl shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 border border-gray-300 bg-white text-gray-700 rounded-xl hover:bg-gray-50 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg disabled:opacity-50 transition-all"
            >
              {loading ? "Creating..." : "Create Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const CampaignWinsReportModal: React.FC<{
  clients: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ clients, onClose, onSuccess }) => {
  const [clientId, setClientId] = useState("");
  const [recipients, setRecipients] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) {
      toast.error("Please select a client");
      return;
    }

    const recipientsList = recipients.split(",").map((email) => email.trim()).filter(Boolean);
    if (recipientsList.length === 0) {
      toast.error("Please enter at least one recipient email");
      return;
    }

    setLoading(true);
    try {
      await api.post(`/seo/reports/${clientId}/campaign-wins`, {
        enabled: true,
        recipients: recipientsList,
      });
      toast.success("Campaign Wins report enabled successfully!");
      onSuccess();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to enable Campaign Wins report");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-gray-200/80 max-w-lg w-full mx-4 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white rounded-t-2xl shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Campaign Wins Report</h2>
              <p className="text-sm text-white/90">Enable automatic milestone emails</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 bg-gray-50/50 space-y-5">
          <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-emerald-900 mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Report type
            </h3>
            <p className="text-sm font-medium text-gray-900">Campaign Wins Report</p>
            <p className="mt-2 text-sm text-emerald-900">
              Campaign Wins reports are sent automatically when meaningful milestones are reached — new page 1 rankings,
              traffic growth, work completed, and more. We&apos;ll never send the same win twice, and nothing goes out if there&apos;s nothing to celebrate.
            </p>
          </div>

          <div className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              Client
            </h3>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            >
              <option value="">Select a client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-amber-900 mb-3 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Recipient emails
            </h3>
            <input
              type="text"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="email1@example.com, email2@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 border border-gray-300 bg-white text-gray-700 rounded-xl hover:bg-gray-50 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 shadow-md hover:shadow-lg disabled:opacity-50 transition-all"
            >
              {loading ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Send Report Modal Component
const SendReportModal: React.FC<{
  report: Report;
  onSend: (recipients: string[], emailSubject?: string) => void;
  onClose: () => void;
}> = ({ report, onSend, onClose }) => {
  const [recipients, setRecipients] = useState(
    Array.isArray(report.recipients) && report.recipients.length > 0
      ? report.recipients.join(", ")
      : ""
  );
  const [emailSubject, setEmailSubject] = useState(
    report.emailSubject || `SEO Report - ${report.client?.name || "Client"} - ${report.period.charAt(0).toUpperCase() + report.period.slice(1)}`
  );
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const recipientsList = recipients.split(",").map((email) => email.trim()).filter(Boolean);
    if (recipientsList.length === 0) {
      toast.error("Please enter at least one recipient email");
      return;
    }

    // Validate emails
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = recipientsList.filter(email => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      toast.error(`Invalid email addresses: ${invalidEmails.join(", ")}`);
      return;
    }

    setLoading(true);
    try {
      onSend(recipientsList, emailSubject);
    } catch (error) {
      // Error handling is done in parent
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Recipients (comma-separated emails)
        </label>
        <input
          type="text"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder="email1@example.com, email2@example.com"
          className="w-full border border-gray-300 rounded-lg px-3 py-2"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Email Subject
        </label>
        <input
          type="text"
          value={emailSubject}
          onChange={(e) => setEmailSubject(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2"
          required
        />
      </div>
      <div className="flex justify-end space-x-3 mt-6">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-secondary-600 text-white rounded-lg hover:bg-secondary-700 disabled:opacity-50"
        >
          {loading ? "Sending..." : "Send Report"}
        </button>
      </div>
    </form>
  );
};

export default ReportsPage;