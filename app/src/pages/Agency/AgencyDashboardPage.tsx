import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchClients } from "@/store/slices/clientSlice";
import {
  TrendingUp,
  TrendingDown,
  Search,
  FolderOpen,
  Users,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Globe,
  Eye,
  Calendar,
  Target,
} from "lucide-react";

const AgencyDashboardPage = () => {
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);
  const { clients } = useSelector((state: RootState) => state.client);
  const [selectedPeriod, setSelectedPeriod] = useState("30");

  useEffect(() => {
    dispatch(fetchClients() as any);
  }, [dispatch]);

  // Mock data for demo
  const stats = {
    totalKeywords: 1247,
    avgPosition: 12.4,
    topRankings: 89,
    totalProjects: clients.length || 5,
    totalClicks: 15420,
    totalImpressions: 234567,
    organicTraffic: 45230,
    conversionRate: 3.2,
  };

  const recentRankings = [
    {
      keyword: "seo services",
      position: 3,
      change: 2,
      url: "/seo-services",
      volume: 8100,
    },
    {
      keyword: "digital marketing",
      position: 7,
      change: -1,
      url: "/digital-marketing",
      volume: 12100,
    },
    {
      keyword: "content marketing",
      position: 12,
      change: 0,
      url: "/content-marketing",
      volume: 5400,
    },
    {
      keyword: "link building",
      position: 5,
      change: 3,
      url: "/link-building",
      volume: 2900,
    },
    {
      keyword: "local seo",
      position: 2,
      change: 1,
      url: "/local-seo",
      volume: 3600,
    },
  ];

  const topPages = [
    {
      url: "/seo-services",
      clicks: 2340,
      impressions: 45600,
      ctr: 5.1,
      position: 3.2,
    },
    {
      url: "/digital-marketing",
      clicks: 1890,
      impressions: 38200,
      ctr: 4.9,
      position: 7.1,
    },
    {
      url: "/content-strategy",
      clicks: 1560,
      impressions: 29800,
      ctr: 5.2,
      position: 5.8,
    },
    {
      url: "/local-seo",
      clicks: 1340,
      impressions: 22100,
      ctr: 6.1,
      position: 2.1,
    },
    {
      url: "/technical-seo",
      clicks: 980,
      impressions: 18900,
      ctr: 5.2,
      position: 8.4,
    },
  ];

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
                {stats.organicTraffic.toLocaleString()}
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
                {stats.totalKeywords.toLocaleString()}
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
                {stats.avgPosition}
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
                {stats.topRankings}
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
          <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Ranking trends chart</p>
              <p className="text-sm text-gray-400 mt-2">
                Chart integration needed
              </p>
            </div>
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
          <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
            <div className="text-center">
              <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Traffic analytics chart</p>
              <p className="text-sm text-gray-400 mt-2">
                Chart integration needed
              </p>
            </div>
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
                {recentRankings.map((ranking, index) => (
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
                ))}
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
            <div className="space-y-4">
              {topPages.map((page, index) => (
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgencyDashboardPage;
