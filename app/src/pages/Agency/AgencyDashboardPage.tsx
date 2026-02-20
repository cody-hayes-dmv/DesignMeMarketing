import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchClients } from "@/store/slices/clientSlice";
import {
  Users,
  Activity,
  Target,
  Loader2,
  RefreshCw,
  CreditCard,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Zap,
  Trophy,
  Sparkles,
  ArrowUpRight,
  Clock,
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-primary-50/30 p-8">
      {/* Header with gradient accent */}
      <div className="relative mb-10 overflow-hidden rounded-2xl bg-gradient-to-r from-primary-600 via-violet-600 to-rose-500 p-8 shadow-lg">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNnKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white md:text-3xl">
              Welcome back, {user?.name || user?.email}
            </h1>
            <p className="mt-2 text-primary-100 text-sm md:text-base">
              Here's what's happening with your SEO performance today.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="rounded-lg border-0 bg-white/20 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30 focus:ring-2 focus:ring-white/50 focus:outline-none [&>option]:text-gray-900"
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
                className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30 disabled:opacity-60 disabled:cursor-not-allowed"
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
      </div>

      {/* SECTION 1: Top metrics cards with colored gradients */}
      <section className="mb-10">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          {/* Card 1 - Active Clients (Blue) */}
          <Link
            to="/agency/clients"
            className="group relative overflow-hidden rounded-2xl border border-primary-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-primary-100/50"
          >
            <div className="absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full bg-gradient-to-br from-primary-400/20 to-primary-600/20 transition-transform group-hover:scale-150" />
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Active Clients</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {stats.totalProjects}
                  <span className="text-lg font-normal text-gray-400"> / {(stats.tierLimit ?? 10) + 1}</span>
                </p>
                {(() => {
                  const limit = (stats.tierLimit ?? 10) + 1;
                  const used = stats.totalProjects;
                  const slotsLeft = limit - used;
                  if (slotsLeft <= 0)
                    return <p className="mt-1 text-sm font-semibold text-rose-500">At capacity &mdash; Upgrade</p>;
                  if (slotsLeft === 1)
                    return <p className="mt-1 text-sm font-medium text-amber-500">{slotsLeft} slot left</p>;
                  return <p className="mt-1 text-xs text-gray-400">{slotsLeft} slots available</p>;
                })()}
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg shadow-primary-200">
                <Users className="h-6 w-6 text-white" />
              </div>
            </div>
            <p className="mt-4 flex items-center gap-1 text-xs font-semibold text-primary-600 group-hover:text-primary-700">
              View clients <ArrowUpRight className="h-3.5 w-3.5" />
            </p>
          </Link>

          {/* Card 2 - Total Keywords Tracked (Green/Teal) */}
          <Link
            to="/agency/keywords"
            className="group relative overflow-hidden rounded-2xl border border-teal-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-teal-100/50"
          >
            <div className="absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full bg-gradient-to-br from-teal-400/20 to-secondary-600/20 transition-transform group-hover:scale-150" />
            <div className="relative">
              {(() => {
                const limit = stats.keywordLimit ?? 500;
                const used = stats.totalKeywords;
                const pct = limit ? (used / limit) * 100 : 0;
                return (
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-500">Keywords Tracked</p>
                      <p className="mt-2 text-3xl font-bold text-gray-900">
                        {used.toLocaleString()}
                        <span className="text-lg font-normal text-gray-400"> / {limit.toLocaleString()}</span>
                      </p>
                      {pct >= 100 ? (
                        <p className="mt-1 text-sm font-semibold text-rose-500">At limit &mdash; Upgrade</p>
                      ) : pct >= 90 ? (
                        <p className="mt-1 text-sm font-medium text-amber-500">Approaching limit</p>
                      ) : (
                        <p className="mt-1 text-xs text-gray-400">
                          {Math.max(0, limit - used).toLocaleString()} remaining
                        </p>
                      )}
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.min(100, pct)}%`,
                            background:
                              pct >= 100
                                ? "linear-gradient(90deg, #f43f5e, #e11d48)"
                                : pct >= 90
                                  ? "linear-gradient(90deg, #f59e0b, #d97706)"
                                  : "linear-gradient(90deg, #14b8a6, #059669)",
                          }}
                        />
                      </div>
                    </div>
                    <div className="ml-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-secondary-600 shadow-lg shadow-teal-200">
                      <Target className="h-6 w-6 text-white" />
                    </div>
                  </div>
                );
              })()}
            </div>
            <p className="mt-4 flex items-center gap-1 text-xs font-semibold text-teal-600 group-hover:text-teal-700">
              Keyword breakdown <ArrowUpRight className="h-3.5 w-3.5" />
            </p>
          </Link>

          {/* Card 3 - Your Plan (Violet) */}
          <Link
            to="/agency/subscription"
            className="group relative overflow-hidden rounded-2xl border border-violet-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-100/50"
          >
            <div className="absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full bg-gradient-to-br from-violet-400/20 to-violet-600/20 transition-transform group-hover:scale-150" />
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Your Plan</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">{stats.currentTier ?? "Growth"}</p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 shadow-lg shadow-violet-200">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
            </div>
            <span className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md">
              Manage Plan <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </Link>

          {/* Card 4 - Monthly Spend (Amber/Orange) */}
          <Link
            to="/agency/subscription#invoices"
            className="group relative overflow-hidden rounded-2xl border border-amber-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-100/50"
          >
            <div className="absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full bg-gradient-to-br from-amber-400/20 to-accent-600/20 transition-transform group-hover:scale-150" />
            <div className="relative flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">Monthly Spend</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">
                  {(() => {
                    const val = stats.monthlySpend;
                    if (val == null) return "$0.00";
                    const num = typeof val === "string" ? parseFloat(val) : Number(val);
                    return Number.isFinite(num) ? `$${num.toFixed(2)}` : `$${String(val)}`;
                  })()}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {stats.nextBillingDate
                    ? `Next billing: ${new Date(stats.nextBillingDate).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}`
                    : "\u2014"}
                </p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-accent-600 shadow-lg shadow-amber-200">
                <CreditCard className="h-6 w-6 text-white" />
              </div>
            </div>
            <p className="mt-4 flex items-center gap-1 text-xs font-semibold text-amber-600 group-hover:text-amber-700">
              Invoice history <ArrowUpRight className="h-3.5 w-3.5" />
            </p>
          </Link>
        </div>
      </section>

      {/* SECTION 2: Main content area - two columns */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        {/* LEFT COLUMN - 60% (3/5) */}
        <div className="space-y-8 lg:col-span-3">
          {/* Panel 1 - Client Performance Overview */}
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-gradient-to-r from-primary-50/80 to-white px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
                  <TrendingUp className="h-5 w-5 text-primary-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Client Performance</h2>
                  <p className="text-xs text-gray-500">Traffic changes across your portfolio</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
                </div>
              ) : (stats.clientPerformance?.length ?? 0) === 0 ? (
                <p className="py-4 text-sm text-gray-400">No client performance data yet.</p>
              ) : (
                <ul className="space-y-1">
                  {(stats.clientPerformance ?? [])
                    .sort((a, b) => (b.trafficChangePercent ?? 0) - (a.trafficChangePercent ?? 0))
                    .slice(0, 5)
                    .map((row) => {
                      const pct = row.trafficChangePercent ?? 0;
                      const isPositive = pct >= 0;
                      return (
                        <li
                          key={row.clientId}
                          className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors hover:bg-gray-50"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                                pct >= 10
                                  ? "bg-secondary-100 text-secondary-600"
                                  : pct >= 0
                                    ? "bg-amber-100 text-amber-600"
                                    : "bg-rose-100 text-rose-600"
                              }`}
                            >
                              {isPositive ? (
                                <TrendingUp className="h-4 w-4" />
                              ) : (
                                <TrendingDown className="h-4 w-4" />
                              )}
                            </div>
                            <span className="text-sm font-medium text-gray-900">{row.clientName}</span>
                          </div>
                          <div className="text-right">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                isPositive
                                  ? "bg-secondary-50 text-secondary-700"
                                  : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {isPositive ? "+" : ""}
                              {pct}%
                            </span>
                            <span className="mt-0.5 block text-xs text-gray-400">
                              {row.trafficChangeVisits >= 0 ? "+" : ""}
                              {row.trafficChangeVisits.toLocaleString()} visits
                            </span>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
              <Link
                to="/agency/clients"
                className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary-600 hover:text-primary-700"
              >
                View All Clients <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Panel 2 - Quick Wins Across Clients */}
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-gradient-to-r from-secondary-50/80 to-white px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-100">
                  <Zap className="h-5 w-5 text-secondary-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Quick Wins</h2>
                  <p className="text-xs text-gray-500">Keywords in Position 4-10 (easy wins)</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-secondary-600" />
                </div>
              ) : (stats.quickWins?.length ?? 0) === 0 ? (
                <p className="py-4 text-sm text-gray-400">No quick win keywords in position 4-10.</p>
              ) : (
                <ul className="space-y-1">
                  {(stats.quickWins ?? []).slice(0, 5).map((row, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-teal-600">
                          <Target className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{row.clientName}</p>
                          <p className="text-xs text-gray-500">&apos;{row.keyword}&apos;</p>
                        </div>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        #{row.position}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/agency/keywords"
                className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-secondary-600 hover:text-secondary-700"
              >
                View All Opportunities <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN - 40% (2/5) */}
        <div className="space-y-8 lg:col-span-2">
          {/* Panel 1 - Keyword Research Credits */}
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-gradient-to-r from-violet-50/80 to-white px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100">
                  <Sparkles className="h-5 w-5 text-violet-600" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Research Credits</h2>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold text-gray-900">
                  {stats.researchCredits?.used ?? 0}
                </span>
                <span className="text-sm text-gray-400">
                  of {stats.researchCredits?.limit ?? 150} used
                </span>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      ((stats.researchCredits?.used ?? 0) / (stats.researchCredits?.limit ?? 150)) * 100
                    )}%`,
                    background:
                      (stats.researchCredits?.used ?? 0) >= (stats.researchCredits?.limit ?? 150)
                        ? "linear-gradient(90deg, #f43f5e, #e11d48)"
                        : (stats.researchCredits?.used ?? 0) / (stats.researchCredits?.limit ?? 150) >= 0.9
                          ? "linear-gradient(90deg, #f59e0b, #d97706)"
                          : "linear-gradient(90deg, #8b5cf6, #7c3aed)",
                  }}
                />
              </div>
              {(() => {
                const used = stats.researchCredits?.used ?? 0;
                const limit = stats.researchCredits?.limit ?? 150;
                if (used >= limit)
                  return (
                    <p className="mt-2 text-sm font-medium text-rose-500">
                      At limit &mdash; buy more credits to continue research
                    </p>
                  );
                if (limit && used >= limit * 0.9)
                  return (
                    <p className="mt-2 text-sm font-medium text-amber-500">
                      Approaching limit &mdash; consider buying a credit pack
                    </p>
                  );
                return (
                  <p className="mt-2 text-xs text-gray-400">
                    Resets in {stats.researchCredits?.resetsInDays ?? 30} days
                  </p>
                );
              })()}
              <Link
                to="/agency/add-ons"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md"
              >
                Buy Credit Pack <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Panel 2 - Recent Activity */}
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-gradient-to-r from-rose-50/80 to-white px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100">
                  <Clock className="h-5 w-5 text-rose-600" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
              </div>
            </div>
            <div className="p-6">
              {(stats.recentActivity?.length ?? 0) === 0 ? (
                <p className="text-sm text-gray-400">No recent activity.</p>
              ) : (
                <ul className="space-y-3">
                  {(stats.recentActivity ?? []).slice(0, 4).map((item, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-gray-50"
                    >
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-50">
                        <Activity className="h-3.5 w-3.5 text-rose-400" />
                      </div>
                      <span className="text-gray-700">{item.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/agency/settings"
                className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-rose-600 hover:text-rose-700"
              >
                View All Activity <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Panel 3 - Number 1 Rankings Portfolio */}
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-gradient-to-r from-amber-50/80 to-white px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100">
                  <Trophy className="h-5 w-5 text-amber-600" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">#1 Rankings</h2>
              </div>
            </div>
            <div className="p-6">
              <div className="mb-4 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-gray-900">
                  {(stats.numberOneRankings?.total ?? 0).toLocaleString()}
                </span>
                <span className="text-sm text-gray-400">across portfolio</span>
              </div>
              <ul className="space-y-2">
                {(stats.numberOneRankings?.byClient ?? []).slice(0, 4).map((row, i) => {
                  const medals = ["from-amber-400 to-amber-600", "from-gray-300 to-gray-500", "from-amber-600 to-amber-800", "from-primary-400 to-primary-600"];
                  return (
                    <li
                      key={row.clientId}
                      className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br text-white text-xs font-bold shadow-sm ${medals[i] ?? medals[3]}`}
                        >
                          {i + 1}
                        </div>
                        <span className="text-sm font-medium text-gray-900">{row.clientName}</span>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        {row.count} keywords
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgencyDashboardPage;
