import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchClients } from "@/store/slices/clientSlice";
import {
  TrendingUp,
  Search,
  BarChart3,
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
}

const AgencyDashboardPage = () => {
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);
  const { clients } = useSelector((state: RootState) => state.client);
  const [selectedPeriod, setSelectedPeriod] = useState("30");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({
    totalKeywords: 0,
    avgPosition: null,
    topRankings: 0,
    totalProjects: 0,
    organicTraffic: 0,
    recentRankings: [],
    topPages: [],
    rankingTrends: [],
    trafficTrends: [],
  });

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
        setStats(res.data);
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
      setStats(res.data);
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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">
                Organic Traffic
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {loading ? "..." : stats.organicTraffic.toLocaleString()}
              </p>
            </div>
            <div className="bg-primary-100 p-3 rounded-lg">
              <TrendingUp className="h-6 w-6 text-primary-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center space-x-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="text-sm text-green-600">
              +15.3% from last month
            </span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">
                Total Keywords
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {loading ? "..." : stats.totalKeywords.toLocaleString()}
              </p>
            </div>
            <div className="bg-primary-100 p-3 rounded-lg">
              <Search className="h-6 w-6 text-primary-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center space-x-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="text-sm text-green-600">+12% from last month</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Position</p>
              <p className="text-2xl font-bold text-gray-900">
                {loading ? "..." : (stats.avgPosition !== null ? stats.avgPosition.toFixed(1) : "—")}
              </p>
            </div>
            <div className="bg-secondary-100 p-3 rounded-lg">
              <Target className="h-6 w-6 text-secondary-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center space-x-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="text-sm text-green-600">+2.1 positions</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">
                Top 10 Rankings
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {loading ? "..." : stats.topRankings}
              </p>
            </div>
            <div className="bg-accent-100 p-3 rounded-lg">
              <BarChart3 className="h-6 w-6 text-accent-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center space-x-2">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="text-sm text-green-600">+7 this week</span>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Rankings Chart */}
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">
              Ranking Trends
            </h2>
            <select className="text-sm border border-gray-300 rounded-lg px-3 py-2">
              <option>Last 30 days</option>
              <option>Last 7 days</option>
              <option>Last 90 days</option>
            </select>
          </div>
          <div className="h-64">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
              </div>
            ) : stats.rankingTrends.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                No ranking data available
            </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.rankingTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis 
                    reversed
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip 
                    labelFormatter={(value) => {
                      const date = new Date(value);
                      return date.toLocaleDateString();
                    }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="avgPosition" 
                    stroke="#3B82F6" 
                    strokeWidth={2}
                    name="Avg Position"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Traffic Chart */}
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">
              Organic Traffic
            </h2>
            <select className="text-sm border border-gray-300 rounded-lg px-3 py-2">
              <option>Last 30 days</option>
              <option>Last 7 days</option>
              <option>Last 90 days</option>
            </select>
          </div>
          <div className="h-64">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
              </div>
            ) : stats.trafficTrends.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                No traffic data available
            </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.trafficTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    labelFormatter={(value) => {
                      const date = new Date(value);
                      return date.toLocaleDateString();
                    }}
                    formatter={(value: number) => Math.round(value).toLocaleString()}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="traffic" 
                    stroke="#10B981" 
                    strokeWidth={2}
                    name="Organic Traffic"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

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
