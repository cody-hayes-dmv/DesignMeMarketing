import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { RootState } from "@/store";
import api from "@/lib/api";
import {
  Loader2,
  FolderPlus,
  Eye,
  Building2,
  Search,
  Table,
  List,
  Share2,
  Globe,
  Calendar,
  ArrowUp,
  ArrowDown,
  X,
  Copy,
  ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";

type InclusionRow = {
  id: string;
  clientId: string;
  agencyId: string;
  client: {
    id: string;
    name: string;
    domain: string;
    status: string;
    industry?: string | null;
    createdAt?: string;
    keywords?: number;
    avgPosition?: number;
    topRankings?: number;
    traffic?: number;
    traffic30d?: number | null;
    agencyNames?: string[];
  };
  agency: { id: string; name: string };
};

const getStatusBadge = (status: string) => {
  if (status === "ACTIVE") return "bg-green-100 text-green-800";
  if (status === "PENDING") return "bg-amber-100 text-amber-800";
  if (status === "DASHBOARD_ONLY") return "bg-blue-100 text-blue-800";
  if (status === "CANCELED") return "bg-orange-100 text-orange-800";
  if (status === "SUSPENDED") return "bg-red-100 text-red-800";
  if (status === "ARCHIVED") return "bg-gray-100 text-gray-800";
  return "bg-gray-100 text-gray-800";
};

const getStatusLabel = (status: string) => {
  if (status === "ACTIVE") return "Active";
  if (status === "PENDING") return "Pending";
  if (status === "DASHBOARD_ONLY") return "Dashboard Only";
  if (status === "CANCELED") return "Canceled";
  if (status === "SUSPENDED") return "Suspended";
  if (status === "ARCHIVED") return "Archived";
  return status;
};

const IncludedPage = () => {
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);
  const [inclusions, setInclusions] = useState<InclusionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [enabled, setEnabled] = useState(false); // false = table, true = cards
  const [sortField, setSortField] = useState<"name" | "domain" | "industry">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLink, setShareLink] = useState("");

  useEffect(() => {
    api
      .get<InclusionRow[]>("/agencies/included-clients")
      .then((r) => setInclusions(Array.isArray(r.data) ? r.data : []))
      .catch(() => setInclusions([]))
      .finally(() => setLoading(false));
  }, []);

  const handleSort = (field: "name" | "domain" | "industry") => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const filteredInclusions = inclusions
    .filter((row) => {
      if (!searchTerm) return true;
      const s = searchTerm.toLowerCase();
      const name = (row.client?.name ?? "").toLowerCase();
      const domain = (row.client?.domain ?? "").toLowerCase();
      const agencyName = (row.agency?.name ?? "").toLowerCase();
      return name.includes(s) || domain.includes(s) || agencyName.includes(s);
    })
    .sort((a, b) => {
      let av: string;
      let bv: string;
      if (sortField === "name") {
        av = (a.client?.name ?? "").toLowerCase();
        bv = (b.client?.name ?? "").toLowerCase();
      } else if (sortField === "domain") {
        av = (a.client?.domain ?? "").toLowerCase();
        bv = (b.client?.domain ?? "").toLowerCase();
      } else {
        av = (a.client?.industry ?? "").toLowerCase();
        bv = (b.client?.industry ?? "").toLowerCase();
      }
      const cmp = av.localeCompare(bv);
      return sortDirection === "asc" ? cmp : -cmp;
    });

  const handleViewClient = (row: InclusionRow) => {
    navigate(`/agency/clients/${row.clientId}`, { state: { client: row.client } });
  };

  const handleViewReportClick = (row: InclusionRow) => {
    navigate(`/agency/clients/${row.clientId}`, { state: { client: row.client, tab: "report" } });
  };

  const handleShareClick = async (row: InclusionRow) => {
    try {
      const res = await api.post(`/seo/share-link/${row.clientId}`);
      const token = res.data?.token;
      if (!token) {
        toast.error("Failed to generate share link");
        return;
      }
      setShareLink(`${window.location.origin}/share/${encodeURIComponent(token)}`);
      setShowShareModal(true);
    } catch (error: any) {
      console.error("Share link error", error);
    }
  };

  const handleCopyLink = async () => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareLink);
      toast.success("Link copied to clipboard!");
    } else {
      prompt("Copy this shareable link:", shareLink);
    }
  };

  const handleOpenLink = () => {
    window.open(shareLink, "_blank");
  };

  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="rounded-xl border-l-4 border-primary-500 bg-primary-50/60 px-8 py-6 flex items-center gap-3 shadow-sm">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          <span className="text-sm font-medium text-primary-800">Loading included clients…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-teal-50/30 p-8">
      {/* Header */}
      <div className="relative mb-10 overflow-hidden rounded-2xl bg-gradient-to-r from-teal-600 via-secondary-600 to-emerald-500 p-8 shadow-lg">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNnKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative">
          <h1 className="text-2xl font-bold text-white md:text-3xl">Included Clients</h1>
          <p className="mt-2 text-teal-100 text-sm md:text-base">
            Clients marked as &quot;Included&quot; — free and do not count toward your dashboard tier limit.
          </p>
        </div>
      </div>

      {inclusions.length === 0 ? (
        <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50/60 p-12 text-center shadow-sm">
          <FolderPlus className="h-12 w-12 mx-auto mb-4 text-amber-600" />
          <p className="font-semibold text-amber-900">No included clients yet</p>
          <p className="text-sm mt-1 text-amber-800/90">
            Go to Clients or Vendasta, click Assign to Agency, expand an agency, and check &quot;Included&quot; to add clients here.
          </p>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm mb-8">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search name, domain, agency ..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex flex-row items-center">
                <button
                  onClick={() => setEnabled((prev) => !prev)}
                  className={`relative w-16 h-9 rounded-full transition-colors duration-300 ${enabled ? "bg-blue-500" : "bg-gray-400"}`}
                >
                  <span
                    className={`absolute top-1 left-1 w-7 h-7 rounded-full flex items-center justify-center bg-white shadow-md transform transition-transform duration-300 ${enabled ? "translate-x-7" : "translate-x-0"}`}
                  >
                    {enabled ? <List className="w-4 h-4 text-yellow-500" /> : <Table className="w-4 h-4 text-indigo-600" />}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Table View */}
          {!enabled && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                      <th
                        className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider cursor-pointer select-none border-l-4 border-primary-400"
                        onClick={() => handleSort("name")}
                      >
                        <div className="flex items-center gap-2">
                          Client Name
                          {sortField === "name" && (sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-primary-600" /> : <ArrowDown className="h-3.5 w-3.5 text-primary-600" />)}
                        </div>
                      </th>
                      <th
                        className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider cursor-pointer select-none border-l-4 border-emerald-300"
                        onClick={() => handleSort("domain")}
                      >
                        <div className="flex items-center gap-2">
                          Domain
                          {sortField === "domain" && (sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-emerald-600" /> : <ArrowDown className="h-3.5 w-3.5 text-emerald-600" />)}
                        </div>
                      </th>
                      {isSuperAdmin && (
                        <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Agency</th>
                      )}
                      <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Status</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Created Date</th>
                      <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredInclusions.map((row, index) => (
                      <tr key={row.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}>
                        <td className="px-6 py-4 whitespace-nowrap text-xs">
                          <div className="flex items-center gap-2 font-semibold text-gray-900">
                            <Building2 className="h-4 w-4 text-primary-500 shrink-0" />
                            {row.client.name}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-xs">
                          <a
                            className="text-sm font-medium text-primary-600 hover:text-primary-700 underline underline-offset-1 decoration-primary-300"
                            href={row.client.domain?.startsWith("http") ? row.client.domain : `https://${row.client.domain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {row.client.domain}
                          </a>
                        </td>
                        {isSuperAdmin && (
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-amber-800/90">
                            {row.agency.name}
                          </td>
                        )}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-bold rounded-full ${getStatusBadge(row.client.status)}`}>
                            {getStatusLabel(row.client.status)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">
                          {row.client.createdAt ? format(new Date(row.client.createdAt), "yyyy-MM-dd") : "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-xs">
                          <div className="flex items-center gap-1">
                            <button
                              className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              onClick={() => handleViewClient(row)}
                              title="View"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              className="p-2 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                              onClick={() => handleShareClick(row)}
                              title="Share"
                            >
                              <Share2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Card View */}
          {enabled && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredInclusions.map((row) => (
                <div
                  key={row.id}
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-lg hover:border-primary-200 transition-all flex flex-col"
                >
                  <div className="h-1.5 bg-gradient-to-r from-primary-500 via-blue-500 to-indigo-500" />
                  <div className="p-6 flex-1">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary-100 to-blue-100 text-primary-600 shrink-0">
                          <Globe className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-gray-900 truncate">{row.client.name}</h3>
                          <a
                            className="text-sm text-primary-600 hover:text-primary-700 underline underline-offset-1 decoration-primary-300 truncate block"
                            href={row.client.domain?.startsWith("http") ? row.client.domain : `https://${row.client.domain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {row.client.domain}
                          </a>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`px-4 py-1.5 text-xs font-semibold rounded-full ${getStatusBadge(row.client.status)}`}>
                          {getStatusLabel(row.client.status)}
                        </span>
                        <button
                          className="p-2 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                          onClick={(e) => { e.stopPropagation(); handleShareClick(row); }}
                          title="Share"
                        >
                          <Share2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="text-center p-4 rounded-xl border-l-4 border-blue-500 bg-blue-50/60">
                        <p className="text-xl font-bold text-blue-900">
                          {typeof row.client.keywords === "number" ? row.client.keywords : 0}
                        </p>
                        <p className="text-xs font-medium text-blue-700">Keywords</p>
                      </div>
                      <div className="text-center p-4 rounded-xl border-l-4 border-emerald-500 bg-emerald-50/60">
                        <p className="text-xl font-bold text-emerald-900">
                          {row.client.avgPosition ?? 0}
                        </p>
                        <p className="text-xs font-medium text-emerald-700">Avg Position</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="text-center p-4 rounded-xl border-l-4 border-amber-500 bg-amber-50/60">
                        <p className="text-xl font-bold text-amber-900">
                          {row.client.topRankings ?? 0}
                        </p>
                        <p className="text-xs font-medium text-amber-700">Top 10</p>
                      </div>
                      <div className="text-center p-4 rounded-xl border-l-4 border-violet-500 bg-violet-50/60">
                        <p className="text-xl font-bold text-violet-900">
                          {Math.round(Number(row.client.traffic30d ?? row.client.traffic ?? 0)).toLocaleString()}
                        </p>
                        <p className="text-xs font-medium text-violet-700">Traffic (30d)</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-sm pt-3 border-t border-gray-100">
                      <div className="flex items-center gap-2 text-slate-600">
                        <Calendar className="h-4 w-4 text-slate-400" />
                        <span>
                          Created {row.client.createdAt ? format(new Date(row.client.createdAt), "yyyy-MM-dd") : "—"}
                        </span>
                      </div>
                      <button
                        className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-sm hover:shadow transition-all"
                        onClick={() => handleViewReportClick(row)}
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Share Link Modal - same as Share Client Dashboard (Clients page) */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden ring-2 ring-blue-200/80 max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 border-b-2 border-indigo-500/50">
              <h3 className="text-lg font-bold text-white drop-shadow-sm">Share Client Dashboard</h3>
              <button
                onClick={() => {
                  setShowShareModal(false);
                  setShareLink("");
                }}
                className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 bg-gradient-to-b from-slate-50/80 to-white space-y-4">
              <p className="text-sm text-gray-600 rounded-xl border-l-4 border-blue-500 bg-blue-50/60 px-4 py-3">
                Share this link to give others access to view the client dashboard. The link does not expire.
              </p>
              <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/60 p-3">
                <label className="block text-sm font-semibold text-emerald-800 mb-2">Share link</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={shareLink}
                    readOnly
                    className="flex-1 px-4 py-2.5 border-2 border-emerald-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="p-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                    title="Copy link"
                  >
                    <Copy className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t-2 border-gray-200 flex items-center gap-3 bg-gradient-to-r from-gray-50 to-slate-50">
              <button
                onClick={() => {
                  setShowShareModal(false);
                  setShareLink("");
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleOpenLink}
                className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md flex items-center justify-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Open Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IncludedPage;
