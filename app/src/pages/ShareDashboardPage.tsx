import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Download, TrendingUp, TrendingDown, Search, MousePointer, Users, Loader2, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { format } from "date-fns";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import toast from "react-hot-toast";
import {
  sampleReports,
  trafficSourceData,
  visitorSourceData,
  topPagesData,
  eventsData,
  conversionsData,
} from "@/data/reportSamples";

interface TrafficSourceSlice {
  name: string;
  value: number;
  color: string;
}

interface BacklinkTimeseriesItem {
  date: string;
  newBacklinks: number;
  lostBacklinks: number;
  newReferringDomains: number;
  lostReferringDomains: number;
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

interface DashboardSummary {
  totalSessions: number | null;
  organicSessions: number | null;
  averagePosition: number | null;
  conversions: number | null;
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

const ShareDashboardPage: React.FC = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [fetchingSummary, setFetchingSummary] = useState(false);
  const [backlinkTimeseries, setBacklinkTimeseries] = useState<BacklinkTimeseriesItem[]>([]);
  const [backlinkTimeseriesLoading, setBacklinkTimeseriesLoading] = useState(false);
  const [backlinkTimeseriesError, setBacklinkTimeseriesError] = useState<string | null>(null);
  const [topPages, setTopPages] = useState<TopPageItem[]>([]);
  const [topPagesLoading, setTopPagesLoading] = useState(false);
  const [topPagesError, setTopPagesError] = useState<string | null>(null);
  const [trafficSources, setTrafficSources] = useState<TrafficSourceSlice[]>([]);
  const [trafficSourcesLoading, setTrafficSourcesLoading] = useState(false);
  const [trafficSourcesError, setTrafficSourcesError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const dashboardContentRef = useRef<HTMLDivElement>(null);
  const [dateRange, setDateRange] = useState("30");

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
  }, [dashboardSummary?.client?.name]);

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
        const res = await api.get(`/seo/share/${encodeURIComponent(token)}/dashboard?period=${dateRange}`);
        const payload = res.data || {};
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
        });
        setLoading(false);
      } catch (error: any) {
        console.error("Failed to fetch dashboard summary", error);
        toast.error(error?.response?.data?.message || "Invalid or expired share link");
        setLoading(false);
      } finally {
        setFetchingSummary(false);
      }
    };

    fetchSummary();
  }, [token, dateRange]);

  const fetchBacklinkTimeseries = useCallback(async () => {
    if (!token) return;

    try {
      setBacklinkTimeseriesLoading(true);
      const res = await api.get(`/seo/share/${encodeURIComponent(token)}/backlinks/timeseries`, {
        params: { range: 30, group: "day" },
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

      normalized.sort((a, b) => {
        if (b.newBacklinks !== a.newBacklinks) {
          return b.newBacklinks - a.newBacklinks;
        }
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
      setBacklinkTimeseries(normalized.slice(0, 15));
      setBacklinkTimeseriesError(null);
    } catch (error: any) {
      console.error("Failed to fetch backlink timeseries", error);
      setBacklinkTimeseries([]);
      const errorMsg = error?.response?.data?.message || "Unable to load backlink timeseries";
      setBacklinkTimeseriesError(errorMsg);
    } finally {
      setBacklinkTimeseriesLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchBacklinkTimeseries();
  }, [fetchBacklinkTimeseries]);

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
        params: { limit: 100 },
      });
      const payload = res.data;
      const breakdown = Array.isArray(payload) ? payload : [];
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
        .filter((item) => Number.isFinite(item.value) && item.value > 0);

      if (formatted.length === 0) {
        setTrafficSources([]);
        setTrafficSourcesError("No traffic sources data available from API");
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
  }, [token]);

  useEffect(() => {
    fetchTrafficSources();
  }, [fetchTrafficSources]);

  const resolvedTopPages = useMemo<TopPageItem[]>(() => {
    if (topPages.length > 0) {
      return topPages;
    }

    return topPagesData.map((item) => ({
      url: item.page,
      keywords: Number(item.totalUsers ?? 0),
      estimatedTraffic: Number(item.visitors ?? 0),
      top1: Number(item.visitors ?? 0),
      top3: Number(item.totalUsers ?? 0),
      top10: 0,
      newKeywords: 0,
      upKeywords: 0,
      downKeywords: 0,
      lostKeywords: 0,
      paidTraffic: 0,
    }));
  }, [topPages]);

  const resolvedTrafficSources = useMemo<TrafficSourceSlice[]>(() => {
    if (trafficSources.length > 0) {
      return trafficSources;
    }

    return trafficSourceData.map((item) => ({
      name: item.name,
      value: item.value,
      color: item.color ?? TRAFFIC_SOURCE_COLORS[item.name] ?? TRAFFIC_SOURCE_COLORS.Other,
    }));
  }, [trafficSources]);

  const totalVisitorsDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (dashboardSummary?.totalSessions !== null && dashboardSummary?.totalSessions !== undefined) {
      const numeric = Number(dashboardSummary.totalSessions);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "68,420";
  }, [dashboardSummary?.totalSessions, fetchingSummary]);

  const organicTrafficDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (dashboardSummary?.organicSessions !== null && dashboardSummary?.organicSessions !== undefined) {
      const numeric = Number(dashboardSummary.organicSessions);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "51,903";
  }, [dashboardSummary?.organicSessions, fetchingSummary]);

  const averagePositionDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (dashboardSummary?.averagePosition !== null && dashboardSummary?.averagePosition !== undefined) {
      const numeric = Number(dashboardSummary.averagePosition);
      if (Number.isFinite(numeric)) {
        return numeric.toFixed(1);
      }
    }
    return "8.2";
  }, [dashboardSummary?.averagePosition, fetchingSummary]);

  const conversionsDisplay = useMemo(() => {
    if (fetchingSummary) return "...";
    if (dashboardSummary?.conversions !== null && dashboardSummary?.conversions !== undefined) {
      const numeric = Number(dashboardSummary.conversions);
      if (Number.isFinite(numeric)) {
        return Math.round(numeric).toLocaleString();
      }
    }
    return "72";
  }, [dashboardSummary?.conversions, fetchingSummary]);

  if (!token) {
    return (
      <div className="p-8">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
          Invalid share link.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navbar */}
      <nav className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {dashboardSummary?.client?.name || "Shared Dashboard"}
            </h1>
            {dashboardSummary?.client?.domain && (
              <p className="text-sm text-gray-500 mt-1">
                <span className="font-medium">Domain:</span>{" "}
                <a
                  href={dashboardSummary.client.domain.startsWith("http") ? dashboardSummary.client.domain : `https://${dashboardSummary.client.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:underline"
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
              className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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
              className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed"
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

      {/* Dashboard Content */}
      <div className="p-8 space-y-8">
        {loading ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading shared dashboard...
          </div>
        ) : (
          <div ref={dashboardContentRef} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white p-6 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Total Web Visitors</p>
                    <p className="text-2xl font-bold text-gray-900">{totalVisitorsDisplay}</p>
                  </div>
                  <Users className="h-8 w-8 text-blue-500" />
                </div>
                <div className="mt-4 flex items-center space-x-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600">+15.3% from last month</span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Organic Traffic</p>
                    <p className="text-2xl font-bold text-gray-900">{organicTrafficDisplay}</p>
                  </div>
                  <Search className="h-8 w-8 text-green-500" />
                </div>
                <div className="mt-4 flex items-center space-x-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600">+8.3% from last month</span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Average Position</p>
                    <p className="text-2xl font-bold text-gray-900">{averagePositionDisplay}</p>
                  </div>
                  <MousePointer className="h-8 w-8 text-purple-500" />
                </div>
                <div className="mt-4 flex items-center space-x-2">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-red-500">-0.4 vs last month</span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Conversions</p>
                    <p className="text-2xl font-bold text-gray-900">{conversionsDisplay}</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-orange-500" />
                </div>
                <div className="mt-4 flex items-center space-x-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600">+6.1% from last month</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">New User Visitors Trending</h3>
                  {fetchingSummary && <span className="text-xs text-gray-400">Updating...</span>}
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sampleReports}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="newUsers" stroke="#3B82F6" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Total User Visitors Trending</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sampleReports}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="totalUsers" stroke="#10B981" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>


            <div className="bg-white p-6 rounded-xl border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Traffic Sources</h3>
              </div>
              {trafficSourcesError && (
                <p className="mb-4 text-sm text-rose-600">
                  {trafficSourcesError}
                  {trafficSources.length === 0 ? " Showing sample data instead." : ""}
                </p>
              )}
              <div className="h-64">
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
                        data={resolvedTrafficSources}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
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

            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Visitor Source</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Session Source</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Visitors</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sessions</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Key Events</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Event Count</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {visitorSourceData.map((source, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{source.source}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{source.visitors.toLocaleString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{source.sessions}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{source.keyEvents}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{source.eventCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-xl border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Events</h3>
                <div className="space-y-4">
                  {eventsData.map((event, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{event.name}</p>
                        <p className="text-sm text-gray-500">{event.count.toLocaleString()} events</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-green-600">{event.change}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Conversions</h3>
                <div className="space-y-4">
                  {conversionsData.map((conversion, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{conversion.name}</p>
                        <p className="text-sm text-gray-500">{conversion.count} conversions</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-green-600">{conversion.change}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Top Pages</h3>
                {topPagesError && (
                  <p className="mt-2 text-sm text-rose-600">
                    {topPagesError}
                    {topPages.length === 0 ? " Showing sample data instead." : ""}
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
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Movement</th>
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
                          <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-700">
                            {topPagesLoading ? (
                              <span>...</span>
                            ) : (
                              <div className="flex flex-col space-y-1">
                                <span className="text-green-600">
                                  +{formatNumber(page.newKeywords)} new
                                </span>
                                <span className="text-blue-600">
                                  ↑ {formatNumber(page.upKeywords)} up
                                </span>
                                <span className="text-orange-600">
                                  ↓ {formatNumber(page.downKeywords)} down
                                </span>
                                <span className="text-rose-600">
                                  -{formatNumber(page.lostKeywords)} lost
                                </span>
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
                  <p className="text-sm text-gray-500">Daily backlinks acquired (last 30 days)</p>
                </div>
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
                    backlinkTimeseries.reduce((acc, cur) => Math.max(acc, cur.newBacklinks), 0) || 1;

                  return backlinkTimeseries.map((item) => {
                    let displayDate = item.date;
                    try {
                      displayDate = format(new Date(item.date), "yyyy-MM-dd");
                    } catch {
                      // keep original date string if parsing fails
                    }

                    const widthPercent = Math.max((item.newBacklinks / maxNewBacklinks) * 100, 2);

                    return (
                      <div key={`${item.date}-${item.newBacklinks}`} className="space-y-1">
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>{displayDate}</span>
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
      </div>
    </div>
  );
};

export default ShareDashboardPage;
