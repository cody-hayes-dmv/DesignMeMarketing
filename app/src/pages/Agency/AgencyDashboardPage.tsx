import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchClients } from "@/store/slices/clientSlice";
import {
  TrendingUp,
  Search,
  BarChart3,
  Users,
  UserPlus,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Globe,
  Eye,
  Target,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import api from "@/lib/api";
import toast from "react-hot-toast";

interface TrendPoint {
  date: string;
  value: number;
}

interface AgencyGa4Summary {
  websiteVisitors: number;
  organicSessions: number;
  firstTimeVisitors: number;
  engagedVisitors: number;
  connectedClients: number;
  totalClients: number;
  newUsersTrend: TrendPoint[];
  totalUsersTrend: TrendPoint[];
}

interface DashboardStats {
  totalKeywords: number;
  avgPosition: number | null;
  topRankings: number;
  totalProjects: number;
  organicTraffic: number;
  recentRankings: Array<{
    keyword: string;
    position: number;
    change: number;
    url: string;
    volume: number;
  }>;
  topPages: Array<{
    url: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
  rankingTrends: Array<{
    date: string;
    avgPosition: number;
  }>;
  trafficTrends: Array<{
    date: string;
    traffic: number;
  }>;
  ga4Summary: AgencyGa4Summary;
}

const defaultGa4Summary: AgencyGa4Summary = {
  websiteVisitors: 0,
  organicSessions: 0,
  firstTimeVisitors: 0,
  engagedVisitors: 0,
  connectedClients: 0,
  totalClients: 0,
  newUsersTrend: [],
  totalUsersTrend: [],
};

const mapDashboardResponse = (payload: any): DashboardStats => ({
  totalKeywords: payload?.totalKeywords ?? 0,
  avgPosition:
    payload?.avgPosition !== undefined && payload?.avgPosition !== null
      ? Number(payload.avgPosition)
      : null,
  topRankings: payload?.topRankings ?? 0,
  totalProjects: payload?.totalProjects ?? 0,
  organicTraffic: payload?.organicTraffic ?? 0,
  recentRankings: payload?.recentRankings ?? [],
  topPages: payload?.topPages ?? [],
  rankingTrends: payload?.rankingTrends ?? [],
  trafficTrends: payload?.trafficTrends ?? [],
  ga4Summary: {
    ...defaultGa4Summary,
    ...(payload?.ga4Summary || {}),
    websiteVisitors: payload?.ga4Summary?.websiteVisitors ?? 0,
    organicSessions: payload?.ga4Summary?.organicSessions ?? 0,
    firstTimeVisitors: payload?.ga4Summary?.firstTimeVisitors ?? 0,
    engagedVisitors: payload?.ga4Summary?.engagedVisitors ?? 0,
    connectedClients: payload?.ga4Summary?.connectedClients ?? 0,
    totalClients: payload?.ga4Summary?.totalClients ?? payload?.totalProjects ?? 0,
    newUsersTrend: (payload?.ga4Summary?.newUsersTrend ?? [])
      .map((point: any) => ({
        date: point?.date || "",
        value: Number(point?.value ?? 0),
      }))
      .filter((point: TrendPoint) => Boolean(point.date)),
    totalUsersTrend: (payload?.ga4Summary?.totalUsersTrend ?? [])
      .map((point: any) => ({
        date: point?.date || "",
        value: Number(point?.value ?? 0),
      }))
      .filter((point: TrendPoint) => Boolean(point.date)),
  },
});

const defaultDashboardStats: DashboardStats = mapDashboardResponse({});

const AgencyDashboardPage = () => {
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);
  const { clients } = useSelector((state: RootState) => state.client);
  const [selectedPeriod, setSelectedPeriod] = useState("30");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats>(defaultDashboardStats);

  useEffect(() => {
    dispatch(fetchClients() as any);
  }, [dispatch]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const res = await api.get("/seo/agency/dashboard", {
          params: { period: selectedPeriod },
        });
        setStats(mapDashboardResponse(res.data));
      } catch (error: any) {
        console.error("Failed to fetch dashboard data", error);
        // Toast is already shown by API interceptor
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [selectedPeriod]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await api.post("/seo/agency/dashboard/refresh");
      toast.success("Agency dashboard data refreshed successfully!");
      // Refetch dashboard data
      const res = await api.get("/seo/agency/dashboard", {
        params: { period: selectedPeriod },
      });
      setStats(mapDashboardResponse(res.data));
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to refresh dashboard data");
    } finally {
      setRefreshing(false);
    }
  };

  const getChangeIcon = (change: number) => {
    if (change > 0) return <ArrowUpRight className="h-4 w-4 text-green-500" />;
    if (change < 0) return <ArrowDownRight className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-gray-400" />;
  };

  const getChangeColor = (change: number) => {
    if (change > 0) return "text-green-600";
    if (change < 0) return "text-red-600";
    return "text-gray-500";
  };

  const hasGa4Data = stats.ga4Summary.connectedClients > 0;
  const ga4TotalClients = stats.ga4Summary.totalClients || stats.totalProjects || 0;

  const formatGa4Value = (value: number) => {
    if (!hasGa4Data) return "—";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    return Math.round(numeric).toLocaleString();
  };

  const ga4Cards = [
    {
      key: "websiteVisitors",
      title: "Website Visitors",
      value: stats.ga4Summary.websiteVisitors,
      icon: Users,
      accent: "text-blue-500",
    },
    {
      key: "organicTraffic",
      title: "Organic Traffic",
      value: stats.ga4Summary.organicSessions,
      icon: Search,
      accent: "text-green-500",
    },
    {
      key: "firstTimeVisitors",
      title: "First Time Visitors",
      value: stats.ga4Summary.firstTimeVisitors,
      icon: UserPlus,
      accent: "text-purple-500",
    },
    {
      key: "engagedVisitors",
      title: "Engaged Visitors",
      value: stats.ga4Summary.engagedVisitors,
      icon: Activity,
      accent: "text-orange-500",
    },
  ];

  const ga4ConnectionSummary = hasGa4Data
    ? `GA4 connected for ${stats.ga4Summary.connectedClients}/${ga4TotalClients} client${
        ga4TotalClients === 1 ? "" : "s"
      }`
    : "No GA4-connected clients yet";

  const newUsersTrendData = useMemo(
    () => stats.ga4Summary.newUsersTrend.map((point) => ({ ...point })),
    [stats.ga4Summary.newUsersTrend]
  );

  const totalUsersTrendData = useMemo(
    () => stats.ga4Summary.totalUsersTrend.map((point) => ({ ...point })),
    [stats.ga4Summary.totalUsersTrend]
  );

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.name || user?.email}
          </h1>
          <p className="text-gray-600 mt-1">
            Here's what's happening with your SEO performance today.
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          {user?.role === "SUPER_ADMIN" && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Refresh dashboard data from DataForSEO"
            >
              {refreshing ? (
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
        </div>
      </div>

      {/* GA4 Overview */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">GA4 Performance Overview</h2>
          <span className="text-sm text-gray-500">{ga4ConnectionSummary}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {ga4Cards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.key}
                className="bg-white p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">{card.title}</p>
                    <p className="text-2xl font-bold text-gray-900">{formatGa4Value(card.value)}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <Icon className={`h-6 w-6 ${card.accent}`} />
                  </div>
                </div>
                {hasGa4Data ? (
                  <div className="mt-4 flex items-center space-x-2">
                    <TrendingUp className="h-4 w-4 text-green-500" />
                    <span className="text-sm text-green-600">Real-time aggregate from GA4</span>
                  </div>
                ) : (
                  <div className="mt-4">
                    <span className="text-xs text-gray-500">Connect GA4 for your clients to view data</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!hasGa4Data && (
          <div className="mt-4 text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
            Connect at least one client's GA4 property to populate this section.
          </div>
        )}
      </section>

      {/* GA4 Trends */}
      <section className="mb-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">New Users Trending</h2>
            </div>
            <div className="h-64">
              {hasGa4Data ? (
                newUsersTrendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={newUsersTrendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return Number.isNaN(date.getTime())
                            ? value
                            : `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
                        }}
                        formatter={(value: number) => Math.round(value).toLocaleString()}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#3B82F6"
                        strokeWidth={2}
                        name="New Users"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    Not enough GA4 data for this date range
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                  Connect GA4 to view this chart
                </div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Total Users Trending</h2>
            </div>
            <div className="h-64">
              {hasGa4Data ? (
                totalUsersTrendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={totalUsersTrendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return Number.isNaN(date.getTime())
                            ? value
                            : `${date.getMonth() + 1}/${date.getDate()}`;
                        }}
                      />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        labelFormatter={(value) => {
                          const date = new Date(value);
                          return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
                        }}
                        formatter={(value: number) => Math.round(value).toLocaleString()}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#10B981"
                        strokeWidth={2}
                        name="Total Users"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    Not enough GA4 data for this date range
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                  Connect GA4 to view this chart
                </div>
              )}
            </div>
          </div>
        </div>
      </section>


      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Rankings */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Recent Ranking Changes
              </h2>
              <button className="text-primary-600 hover:text-primary-700 text-sm font-medium">
                View all rankings
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Keyword
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Position
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Change
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Volume
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center">
                      <Loader2 className="h-5 w-5 animate-spin text-primary-600 mx-auto" />
                    </td>
                  </tr>
                ) : stats.recentRankings.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                      No recent ranking changes
                    </td>
                  </tr>
                ) : (
                  stats.recentRankings.map((ranking, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {ranking.keyword}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-gray-900">
                        #{ranking.position}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div
                        className={`flex items-center space-x-1 text-sm ${getChangeColor(
                          ranking.change
                        )}`}
                      >
                        {getChangeIcon(ranking.change)}
                        <span>
                          {ranking.change > 0 ? "+" : ""}
                          {ranking.change}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {ranking.volume.toLocaleString()}
                      </div>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Pages */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Top Performing Pages
              </h2>
              <button className="text-primary-600 hover:text-primary-700 text-sm font-medium">
                View all pages
              </button>
            </div>
          </div>
          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
              </div>
            ) : stats.topPages.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-500">
                No top pages data available
              </div>
            ) : (
            <div className="space-y-4">
                {stats.topPages.map((page, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <Globe className="h-4 w-4 text-gray-400" />
                      <span className="text-sm font-medium text-gray-900">
                        {page.url}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-xs text-gray-600">
                      <div>
                        <span className="font-medium">
                          {page.clicks.toLocaleString()}
                        </span>{" "}
                        clicks
                      </div>
                      <div>
                        <span className="font-medium">{page.ctr}%</span> CTR
                      </div>
                      <div>
                        <span className="font-medium">
                          #{page.position.toFixed(1)}
                        </span>{" "}
                        avg pos
                      </div>
                    </div>
                  </div>
                  <button className="p-2 text-gray-400 hover:text-primary-600 transition-colors">
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgencyDashboardPage;
