import React, { useMemo } from "react";
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
} from "lucide-react";

const reports = [
  {
    id: "1",
    name: "Monthly SEO Report - E-commerce Store",
    type: "Monthly",
    project: "E-commerce Store",
    lastGenerated: "2024-01-15",
    status: "Sent" as const,
    recipients: ["client@ecommerce.com", "manager@agency.com"],
    metrics: { keywords: 156, avgPosition: 8.2, traffic: 12450 },
  },
  {
    id: "2",
    name: "Weekly Performance - Local Business",
    type: "Weekly",
    project: "Local Business",
    lastGenerated: "2024-01-14",
    status: "Draft" as const,
    recipients: ["owner@localbiz.com"],
    metrics: { keywords: 89, avgPosition: 15.7, traffic: 5670 },
  },
  {
    id: "3",
    name: "Quarterly Review - Tech Blog",
    type: "Quarterly",
    project: "Tech Blog",
    lastGenerated: "2024-01-01",
    status: "Scheduled" as const,
    recipients: ["editor@techblog.io", "seo@techblog.io"],
    metrics: { keywords: 234, avgPosition: 6.3, traffic: 8920 },
  },
];

type ReportStatus = (typeof reports)[number]["status"];

const getStatusBadge = (status: ReportStatus) => {
  const styles: Record<ReportStatus, string> = {
    Sent: "bg-green-100 text-green-800",
    Draft: "bg-yellow-100 text-yellow-800",
    Scheduled: "bg-blue-100 text-blue-800",
  };
  return styles[status];
};

const ReportsPage: React.FC = () => {
  const totalReports = reports.length;
  const sentReports = reports.filter((report) => report.status === "Sent").length;
  const scheduledReports = reports.filter((report) => report.status === "Scheduled").length;
  const draftReports = reports.filter((report) => report.status === "Draft").length;

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
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{report.name}</div>
                      <div className="text-xs text-gray-500">
                        {report.metrics.keywords} keywords • Avg pos: {report.metrics.avgPosition}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{report.type}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{report.project}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(report.status)}`}>
                      {report.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {new Date(report.lastGenerated).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {report.recipients.length} recipient{report.recipients.length !== 1 ? "s" : ""}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <button className="p-1 text-gray-400 hover:text-primary-600 transition-colors">
                        <Eye className="h-4 w-4" />
                      </button>
                      <button className="p-1 text-gray-400 hover:text-primary-600 transition-colors">
                        <Share2 className="h-4 w-4" />
                      </button>
                      <button className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;