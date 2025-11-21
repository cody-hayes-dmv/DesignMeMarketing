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
  createdAt: string;
}

type ReportStatus = "Sent" | "Draft" | "Scheduled";

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
    }
  }, [clients]);

  const fetchReports = async () => {
    try {
      setLoading(true);
      // Fetch reports for all clients
      const reportPromises = clients.map((client) =>
        api.get(`/seo/reports/${client.id}`).catch(() => null)
      );
      const reportResponses = await Promise.all(reportPromises);
      
      const allReports: Report[] = [];
      reportResponses.forEach((response, index) => {
        if (response?.data && Array.isArray(response.data) && response.data.length > 0) {
          const report = response.data[0]; // Get the latest report
          allReports.push({
            ...report,
            client: clients[index],
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
      setShowShareModal(true);
    } catch (error: any) {
      console.error("Share link error", error);
      // Toast is handled by interceptor
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

  const totalReports = reports.length;
  const sentReports = 0; // Reports don't have status in the current schema
  const scheduledReports = 0;
  const draftReports = 0;

  return (
    <div className="p-8 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-600 mt-2">View all generated reports across your clients.</p>
        </div>
        <div className="flex items-center space-x-4">
          <button className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2">
            <Download className="h-4 w-4" />
            <span>Export</span>
          </button>
          <button className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2">
            <Plus className="h-5 w-5" />
            <span>Create Report</span>
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
            <select className="text-sm border border-gray-300 rounded-lg px-3 py-2">
              <option>All Projects</option>
              <option>E-commerce Store</option>
              <option>Local Business</option>
              <option>Tech Blog</option>
            </select>
            <button className="text-gray-400 hover:text-gray-600">
              <Filter className="h-4 w-4" />
            </button>
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
                reports.map((report) => (
                <tr key={report.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                        <div className="text-sm font-medium text-gray-900">
                          {report.period.charAt(0).toUpperCase() + report.period.slice(1)} Report - {report.client?.name || "Unknown Client"}
                        </div>
                      <div className="text-xs text-gray-500">
                          Avg pos: {report.averagePosition.toFixed(1)} • CTR: {(report.averageCtr * 100).toFixed(2)}%
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
                      <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                        Active
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {new Date(report.reportDate).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {report.totalSessions.toLocaleString()} sessions
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
  );
};

export default ReportsPage;