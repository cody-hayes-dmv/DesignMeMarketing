import { useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  Filter,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  BarChart3,
} from "lucide-react";

const RankingsPage = () => {
  const [dateRange, setDateRange] = useState("30");
  const [selectedProject, setSelectedProject] = useState("all");

  // Mock ranking data
  const rankingData = [
    {
      date: "2024-01-01",
      keyword: "seo services",
      position: 5,
      project: "E-commerce Store",
    },
    {
      date: "2024-01-02",
      keyword: "seo services",
      position: 4,
      project: "E-commerce Store",
    },
    {
      date: "2024-01-03",
      keyword: "seo services",
      position: 3,
      project: "E-commerce Store",
    },
    {
      date: "2024-01-04",
      keyword: "digital marketing",
      position: 8,
      project: "E-commerce Store",
    },
    {
      date: "2024-01-05",
      keyword: "digital marketing",
      position: 7,
      project: "E-commerce Store",
    },
    {
      date: "2024-01-06",
      keyword: "local seo",
      position: 3,
      project: "Local Business",
    },
    {
      date: "2024-01-07",
      keyword: "local seo",
      position: 2,
      project: "Local Business",
    },
  ];

  const topMovers = [
    {
      keyword: "seo services",
      change: 2,
      currentPosition: 3,
      project: "E-commerce Store",
    },
    {
      keyword: "local seo",
      change: 1,
      currentPosition: 2,
      project: "Local Business",
    },
    {
      keyword: "link building",
      change: 3,
      currentPosition: 5,
      project: "Tech Blog",
    },
    {
      keyword: "technical seo",
      change: 3,
      currentPosition: 15,
      project: "Tech Blog",
    },
    {
      keyword: "digital marketing",
      change: -1,
      currentPosition: 7,
      project: "E-commerce Store",
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
          <h1 className="text-3xl font-bold text-gray-900">Rankings</h1>
          <p className="text-gray-600 mt-2">
            Monitor your keyword position changes over time
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <button className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2">
            <Download className="h-4 w-4" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Position Changes
            </h3>
            <TrendingUp className="h-6 w-6 text-secondary-600" />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Improved</span>
              <span className="text-sm font-medium text-green-600">
                {topMovers.filter((m) => m.change > 0).length} keywords
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Declined</span>
              <span className="text-sm font-medium text-red-600">
                {topMovers.filter((m) => m.change < 0).length} keywords
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">No change</span>
              <span className="text-sm font-medium text-gray-600">
                {topMovers.filter((m) => m.change === 0).length} keywords
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Top Performers
            </h3>
            <BarChart3 className="h-6 w-6 text-primary-600" />
          </div>
          <div className="space-y-3">
            {topMovers
              .filter((m) => m.change > 0)
              .slice(0, 3)
              .map((mover, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {mover.keyword}
                    </p>
                    <p className="text-xs text-gray-500">
                      #{mover.currentPosition}
                    </p>
                  </div>
                  <div className="flex items-center space-x-1 text-green-600">
                    <ArrowUpRight className="h-3 w-3" />
                    <span className="text-sm font-medium">+{mover.change}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Needs Attention
            </h3>
            <TrendingDown className="h-6 w-6 text-red-600" />
          </div>
          <div className="space-y-3">
            {topMovers
              .filter((m) => m.change < 0)
              .slice(0, 3)
              .map((mover, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {mover.keyword}
                    </p>
                    <p className="text-xs text-gray-500">
                      #{mover.currentPosition}
                    </p>
                  </div>
                  <div className="flex items-center space-x-1 text-red-600">
                    <ArrowDownRight className="h-3 w-3" />
                    <span className="text-sm font-medium">{mover.change}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Rankings Chart */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Ranking Trends
          </h2>
          <div className="flex items-center space-x-4">
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="all">All Projects</option>
              <option value="ecommerce">E-commerce Store</option>
              <option value="local">Local Business</option>
              <option value="tech">Tech Blog</option>
            </select>
          </div>
        </div>
        <div className="h-80 bg-gray-50 rounded-lg flex items-center justify-center">
          <div className="text-center">
            <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">
              Ranking trends chart would be displayed here
            </p>
            <p className="text-sm text-gray-400 mt-2">
              Integration with charting library needed
            </p>
          </div>
        </div>
      </div>

      {/* Top Movers Table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Biggest Position Changes
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Keyword
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Current Position
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Change
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Project
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {topMovers.map((mover, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {mover.keyword}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-bold text-gray-900">
                      #{mover.currentPosition}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div
                      className={`flex items-center space-x-1 text-sm ${getChangeColor(
                        mover.change
                      )}`}
                    >
                      {getChangeIcon(mover.change)}
                      <span>
                        {mover.change > 0 ? "+" : ""}
                        {mover.change}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-600">{mover.project}</div>
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

export default RankingsPage;
