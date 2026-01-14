import React, { useEffect, useState } from "react";
import {
  Download,
  Plus,
  FileText,
  Mail,
  Calendar,
  Edit,
  Filter,
  Eye,
  Share2,
  MoreVertical,
  X,
  Copy,
  ExternalLink,
  Clock,
  Trash2,
  Send,
  Settings,
} from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { useSelector, useDispatch } from "react-redux";
import { RootState } from "@/store";
import { fetchClients } from "@/store/slices/clientSlice";
import { useNavigate } from "react-router-dom";

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
  createdAt: string;
}

type ReportStatus = "Sent" | "Draft" | "Scheduled";

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

const getStatusBadge = (status: ReportStatus) => {
  const styles: Record<ReportStatus, string> = {
    Sent: "bg-green-100 text-green-800",
    Draft: "bg-yellow-100 text-yellow-800",
    Scheduled: "bg-blue-100 text-blue-800",
  };
  return styles[status];
};

const ReportsPage: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { clients } = useSelector((state: RootState) => state.client);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [selectedReportForShare, setSelectedReportForShare] = useState<Report | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [selectedReportForSend, setSelectedReportForSend] = useState<Report | null>(null);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [filterClientId, setFilterClientId] = useState<string>("all");

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
    }
  }, [clients]);

  const fetchSchedules = async () => {
    try {
      setLoadingSchedules(true);
      const schedulePromises = clients.map((client) =>
        api.get(`/seo/reports/${client.id}/schedules`).catch(() => ({ data: [] }))
      );
      const scheduleResponses = await Promise.all(schedulePromises);
      const allSchedules: ReportSchedule[] = [];
      scheduleResponses.forEach((response, index) => {
        if (response?.data && Array.isArray(response.data)) {
          response.data.forEach((schedule: ReportSchedule) => {
            allSchedules.push(schedule);
          });
        }
      });
      setSchedules(allSchedules);
    } catch (error: any) {
      console.error("Failed to fetch schedules:", error);
    } finally {
      setLoadingSchedules(false);
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
          let displayStatus = report.status || "draft";
          if (displayStatus === "draft" && hasActiveSchedule) {
            displayStatus = "scheduled";
          }
          
          // Use client from report if available, otherwise fallback to clients array
          const client = report.client || clients[index];
          
          allReports.push({
            ...report,
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
      setSelectedReportForShare(report);
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
    // Filter reports based on selected client
    const reportsToExport = filterClientId === "all" 
      ? reports 
      : reports.filter(r => r.clientId === filterClientId);
    
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
  const sentReports = reports.filter(r => r.status === "sent" || r.status === "Sent").length;
  const scheduledReports = reports.filter(r => r.status === "scheduled" || r.status === "Scheduled").length;
  const draftReports = reports.filter(r => !r.status || r.status === "draft" || r.status === "Draft").length;

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-600 mt-2">View all generated reports across your clients.</p>
        </div>
        <div className="flex items-center space-x-4">
          <button 
            onClick={handleExportReports}
            className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2"
          >
            <Download className="h-4 w-4" />
            <span>Export</span>
          </button>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2"
          >
            <Plus className="h-5 w-5" />
            <span>Generate Report</span>
          </button>
          <button
            onClick={() => setShowScheduleModal(true)}
            className="bg-secondary-600 text-white px-6 py-3 rounded-lg hover:bg-secondary-700 transition-colors flex items-center space-x-2"
          >
            <Calendar className="h-5 w-5" />
            <span>Schedule Report</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Reports</p>
              <p className="text-2xl font-bold text-gray-900">{totalReports}</p>
            </div>
            <FileText className="h-8 w-8 text-primary-600" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Sent</p>
              <p className="text-2xl font-bold text-secondary-600">{sentReports}</p>
            </div>
            <Mail className="h-8 w-8 text-secondary-600" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Scheduled</p>
              <p className="text-2xl font-bold text-accent-600">{scheduledReports}</p>
            </div>
            <Calendar className="h-8 w-8 text-accent-600" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Drafts</p>
              <p className="text-2xl font-bold text-gray-900">{draftReports}</p>
            </div>
            <Edit className="h-8 w-8 text-gray-600" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">All Reports</h2>
          <div className="flex items-center space-x-4">
            <select 
              value={filterClientId}
              onChange={(e) => setFilterClientId(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="all">All Clients</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Report</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Generated</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Recipients</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    Loading reports...
                  </td>
                </tr>
              ) : reports.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    No reports found. Create a report for a client first.
                  </td>
                </tr>
              ) : (
                reports
                  .filter(report => filterClientId === "all" || report.clientId === filterClientId)
                  .map((report) => (
                <tr key={report.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                        <div className="text-sm font-medium text-gray-900">
                          {report.period ? report.period.charAt(0).toUpperCase() + report.period.slice(1) : "Report"} Report - {report.client?.name || "Unknown Client"}
                        </div>
                      <div className="text-xs text-gray-500">
                          {report.averagePosition !== null && report.averagePosition !== undefined 
                            ? `Avg pos: ${report.averagePosition.toFixed(1)}` 
                            : "No position data"} • {report.averageCtr !== null && report.averageCtr !== undefined
                            ? `CTR: ${(report.averageCtr * 100).toFixed(2)}%`
                            : "No CTR data"}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {report.period.charAt(0).toUpperCase() + report.period.slice(1)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {report.client?.name || "Unknown"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        report.status === "sent" 
                          ? "bg-green-100 text-green-800" 
                          : report.status === "scheduled"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-yellow-100 text-yellow-800"
                      }`}>
                        {report.status === "sent" ? "Sent" : report.status === "scheduled" ? "Scheduled" : "Draft"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {new Date(report.reportDate).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {Array.isArray(report.recipients) && report.recipients.length > 0
                        ? report.recipients.join(", ")
                        : "No recipients"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleViewClick(report)}
                          className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                          title="View report"
                        >
                        <Eye className="h-4 w-4" />
                      </button>
                        <button
                          onClick={() => handleShareClick(report)}
                          className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                          title="Share report"
                        >
                        <Share2 className="h-4 w-4" />
                      </button>
                        {report.status !== "sent" && (
                          <button
                            onClick={() => {
                              setSelectedReportForSend(report);
                              setShowSendModal(true);
                            }}
                            className="p-1 text-gray-400 hover:text-secondary-600 transition-colors"
                            title="Send report via email"
                          >
                            <Send className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteReport(report.id)}
                          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                          title="Delete report"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Generate Report</h2>
              <button onClick={() => setShowGenerateModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Client</label>
                <select
                  value={selectedClient || ""}
                  onChange={(e) => setSelectedClient(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  defaultValue="monthly"
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowGenerateModal(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
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
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
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
                            Recipients: {schedule.recipients.join(", ")}
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
  const [frequency, setFrequency] = useState<"weekly" | "biweekly" | "monthly">("weekly");
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
        frequency,
        dayOfWeek: frequency !== "monthly" ? dayOfWeek : undefined,
        dayOfMonth: frequency === "monthly" ? dayOfMonth : undefined,
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Schedule Report</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Frequency</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as "weekly" | "biweekly" | "monthly")}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              required
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          {frequency !== "monthly" ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Day of Week</label>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
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
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              required
            />
          </div>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">Email Subject (optional)</label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Custom email subject"
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
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
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Schedule"}
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