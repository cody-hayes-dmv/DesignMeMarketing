import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchClients } from "@/store/slices/clientSlice";
import {
  BarChart3,
  Users,
  Activity,
  Target,
  Loader2,
  RefreshCw,
  CreditCard,
  ChevronRight,
} from "lucide-react";
import { Link } from "react-router-dom";
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
    clientId?: string;
    clientName?: string;
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
  quickWins?: Array<{ clientId: string; clientName: string; keyword: string; position: number }>;
  numberOneRankings?: { total: number; byClient: Array<{ clientId: string; clientName: string; count: number }> };
  clientPerformance?: Array<{
    clientId: string;
    clientName: string;
    trafficChangePercent: number;
    trafficChangeVisits: number;
    organicEtv?: number;
  }>;
  researchCredits?: { used: number; limit: number; resetsInDays: number };
  recentActivity?: Array<{ text: string; date: string }>;
  tierLimit?: number;
  keywordLimit?: number;
  currentTier?: string;
  monthlySpend?: string;
  nextBillingDate?: string;
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
  quickWins: payload?.quickWins ?? [],
  numberOneRankings: payload?.numberOneRankings ?? { total: 0, byClient: [] },
  clientPerformance: payload?.clientPerformance ?? [],
  researchCredits: payload?.researchCredits ?? { used: 0, limit: 150, resetsInDays: 30 },
  recentActivity: payload?.recentActivity ?? [],
  tierLimit: payload?.tierLimit ?? 10,
  keywordLimit: payload?.keywordLimit ?? 500,
  currentTier: payload?.currentTier ?? "Growth",
  monthlySpend: payload?.monthlySpend ?? "0",
  nextBillingDate: payload?.nextBillingDate ?? "",
});

const defaultDashboardStats: DashboardStats = mapDashboardResponse({});

const AgencyDashboardPage = () => {
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);
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

      {/* SECTION 1: Top metrics cards (same card design as Client Dashboard "Website Visitors" etc.) */}
      <section className="mb-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Card 1 - Active Clients */}
          <Link
            to="/agency/clients"
            className="bg-white p-6 rounded-xl border border-gray-200 hover:shadow-lg hover:border-primary-200 transition-all block text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Clients</p>
                <p className="text-2xl font-bold text-gray-900">
                  {stats.totalProjects} / {(stats.tierLimit ?? 10) + 1}
                </p>
                {(() => {
                  const limit = (stats.tierLimit ?? 10) + 1;
                  const used = stats.totalProjects;
                  const slotsLeft = limit - used;
                  if (slotsLeft <= 0) {
                    return (
                      <p className="mt-1 text-sm font-medium text-red-600">
                        At capacity - Upgrade
                      </p>
                    );
                  }
                  if (slotsLeft === 1) {
                    return (
                      <p className="mt-1 text-sm font-medium text-amber-600">
                        {slotsLeft} slot left
                      </p>
                    );
                  }
                  return <p className="mt-1 text-xs text-gray-500">{slotsLeft} slots left</p>;
                })()}
              </div>
              <Users className="h-8 w-8 text-primary-600" />
            </div>
            <p className="mt-3 text-xs text-primary-600 font-medium flex items-center gap-1">
              View clients <ChevronRight className="h-3 w-3" />
            </p>
          </Link>

          {/* Card 2 - Total Keywords Tracked */}
          <Link
            to="/agency/keywords"
            className="bg-white p-6 rounded-xl border border-gray-200 hover:shadow-lg hover:border-primary-200 transition-all block text-left"
          >
            {(() => {
              const limit = stats.keywordLimit ?? 500;
              const used = stats.totalKeywords;
              const pct = limit ? (used / limit) * 100 : 0;
              return (
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-600">Total Keywords Tracked</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {used.toLocaleString()} / {limit.toLocaleString()}
                    </p>
                    {pct >= 100 ? (
                      <p className="mt-1 text-sm font-medium text-red-600">At limit - Upgrade</p>
                    ) : pct >= 90 ? (
                      <p className="mt-1 text-sm font-medium text-amber-600">Approaching limit</p>
                    ) : (
                      <p className="mt-1 text-xs text-gray-500">
                        {Math.max(0, limit - used).toLocaleString()} remaining
                      </p>
                    )}
                    <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, pct)}%`,
                          backgroundColor:
                            pct >= 100 ? "rgb(220 38 38)" : pct >= 90 ? "rgb(217 119 6)" : "rgb(34 197 94)",
                        }}
                      />
                    </div>
                  </div>
                  <Target className="h-8 w-8 text-green-600 shrink-0 ml-3" />
                </div>
              );
            })()}
            <p className="mt-3 text-xs text-primary-600 font-medium flex items-center gap-1">
              Keyword breakdown <ChevronRight className="h-3 w-3" />
            </p>
          </Link>

          {/* Card 3 - Your Plan */}
          <Link
            to="/agency/subscription"
            className="bg-white p-6 rounded-xl border border-gray-200 hover:shadow-lg hover:border-primary-200 transition-all block text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Your Plan</p>
                <p className="text-2xl font-bold text-gray-900">{stats.currentTier ?? "Growth"}</p>
              </div>
              <BarChart3 className="h-8 w-8 text-amber-600" />
            </div>
            <span className="mt-3 inline-block px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors shadow-sm">
              Manage Plan
            </span>
          </Link>

          {/* Card 4 - Monthly Spend */}
          <Link
            to="/agency/subscription#invoices"
            className="bg-white p-6 rounded-xl border border-gray-200 hover:shadow-lg hover:border-primary-200 transition-all block text-left"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Monthly Spend</p>
                <p className="text-2xl font-bold text-gray-900">
                  {(() => {
                    const val = stats.monthlySpend;
                    if (val == null) return "$0.00";
                    const num = typeof val === "string" ? parseFloat(val) : Number(val);
                    return Number.isFinite(num) ? `$${num.toFixed(2)}` : `$${String(val)}`;
                  })()}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {stats.nextBillingDate
                    ? `Next billing: ${new Date(stats.nextBillingDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}`
                    : "—"}
                </p>
              </div>
              <CreditCard className="h-8 w-8 text-gray-600" />
            </div>
            <p className="mt-3 text-xs text-primary-600 font-medium flex items-center gap-1">
              Invoice history <ChevronRight className="h-3 w-3" />
            </p>
          </Link>
        </div>
      </section>

      {/* SECTION 2: Main content area - two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        {/* LEFT COLUMN - 60% (3/5) */}
        <div className="lg:col-span-3 space-y-8">
          {/* Panel 1 - Client Performance Overview */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Client Performance Overview</h2>
            </div>
            <div className="p-6">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
                </div>
              ) : (stats.clientPerformance?.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-500 py-4">No client performance data yet.</p>
              ) : (
                <ul className="space-y-3">
                  {(stats.clientPerformance ?? [])
                    .sort((a, b) => (b.trafficChangePercent ?? 0) - (a.trafficChangePercent ?? 0))
                    .slice(0, 5)
                    .map((row) => {
                      const pct = row.trafficChangePercent ?? 0;
                      const dot =
                        pct >= 10 ? "bg-green-500" : pct >= 0 ? "bg-yellow-500" : "bg-red-500";
                      return (
                        <li key={row.clientId} className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-3">
                            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${dot}`} />
                            <span className="text-sm font-medium text-gray-900">{row.clientName}</span>
                          </div>
                          <div className="text-right">
                            <span
                              className={
                                pct >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"
                              }
                            >
                              {pct >= 0 ? "+" : ""}
                              {pct}% traffic
                            </span>
                            <span className="block text-xs text-gray-500">
                              {row.trafficChangeVisits >= 0 ? "↑" : "↓"}{" "}
                              {Math.abs(row.trafficChangeVisits).toLocaleString()} visits
                            </span>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
              <Link
                to="/agency/clients"
                className="mt-4 inline-block text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                View All Clients →
              </Link>
            </div>
          </div>

          {/* Panel 2 - Quick Wins Across Clients */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Quick Wins Across Clients</h2>
              <p className="text-sm text-gray-500 mt-0.5">Keywords in Position 4-10 (easy wins)</p>
            </div>
            <div className="p-6">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
                </div>
              ) : (stats.quickWins?.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-500 py-4">No quick win keywords in position 4-10.</p>
              ) : (
                <ul className="space-y-2">
                  {(stats.quickWins ?? []).slice(0, 5).map((row, i) => (
                    <li key={i} className="text-sm text-gray-700 py-1.5">
                      <span className="font-medium text-gray-900">{row.clientName}</span>
                      {" – "}
                      <span className="text-gray-600">&apos;{row.keyword}&apos;</span>
                      <span className="text-gray-500"> (pos {row.position})</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/agency/keywords"
                className="mt-4 inline-block text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                View All Opportunities →
              </Link>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN - 40% (2/5) */}
        <div className="lg:col-span-2 space-y-8">
          {/* Panel 1 - Keyword Research Credits */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900">Keyword Research Credits</h2>
              <div className="mt-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">
                    {(stats.researchCredits?.used ?? 0)} / {(stats.researchCredits?.limit ?? 150)} used
                  </span>
                </div>
                <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        ((stats.researchCredits?.used ?? 0) / (stats.researchCredits?.limit ?? 150)) * 100
                      )}%`,
                      backgroundColor:
                        (stats.researchCredits?.used ?? 0) >= (stats.researchCredits?.limit ?? 150)
                          ? "rgb(220 38 38)"
                          : (stats.researchCredits?.used ?? 0) / (stats.researchCredits?.limit ?? 150) >= 0.9
                            ? "rgb(217 119 6)"
                            : "var(--tw-gradient-from, rgb(59 130 246))",
                    }}
                  />
                </div>
                {(() => {
                  const used = stats.researchCredits?.used ?? 0;
                  const limit = stats.researchCredits?.limit ?? 150;
                  if (used >= limit) {
                    return (
                      <p className="mt-2 text-sm font-medium text-red-600">
                        At limit — buy more credits to continue research
                      </p>
                    );
                  }
                  if (limit && used >= limit * 0.9) {
                    return (
                      <p className="mt-2 text-sm font-medium text-amber-600">
                        Approaching limit — consider buying a credit pack
                      </p>
                    );
                  }
                  return (
                    <p className="mt-2 text-xs text-gray-500">
                      Resets in {(stats.researchCredits?.resetsInDays ?? 30)} days
                    </p>
                  );
                })()}
                <Link
                  to="/agency/add-ons"
                  className="mt-3 inline-block px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors shadow-sm"
                >
                  Buy Credit Pack
                </Link>
              </div>
            </div>
          </div>

          {/* Panel 2 - Recent Activity */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
            </div>
            <div className="p-6">
              {(stats.recentActivity?.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-500">No recent activity.</p>
              ) : (
                <ul className="space-y-3">
                  {(stats.recentActivity ?? []).slice(0, 4).map((item, i) => (
                    <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                      <Activity className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/agency/settings"
                className="mt-4 inline-block text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                View All Activity →
              </Link>
            </div>
          </div>

          {/* Panel 3 - Number 1 Rankings Portfolio */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900">Number 1 Rankings Across Portfolio</h2>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                Total #1 Rankings: {(stats.numberOneRankings?.total ?? 0).toLocaleString()}
              </p>
              <ul className="mt-4 space-y-2">
                {(stats.numberOneRankings?.byClient ?? []).slice(0, 4).map((row) => (
                  <li key={row.clientId} className="flex items-center gap-2 text-sm">
                    <span className="text-lg">🏆</span>
                    <span className="font-medium text-gray-900">{row.clientName}</span>
                    <span className="text-gray-500">({row.count})</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgencyDashboardPage;
