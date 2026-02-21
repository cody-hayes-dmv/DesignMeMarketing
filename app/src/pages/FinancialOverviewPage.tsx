import React, { useEffect, useMemo, useState } from "react";
import {
  DollarSign,
  Loader2,
  RefreshCw,
  TrendingUp,
  X,
  AlertCircle,
  BarChart3,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { createNonOverlappingPieValueLabel } from "@/utils/recharts";
import api from "@/lib/api";

interface MrrAccount {
  customerId: string;
  customerEmail: string;
  mrr: number;
  productName: string;
}

interface MrrSegment {
  category: string;
  label: string;
  mrr: number;
  count: number;
  color: string;
  accounts: MrrAccount[];
}

interface MrrBreakdownResponse {
  totalMrr: number;
  segments: MrrSegment[];
  configured: boolean;
  message?: string;
}

interface DailyActivity {
  date: string;
  newMrr: number;
  churnedMrr: number;
}

interface SubscriptionActivityResponse {
  configured: boolean;
  dailyData: DailyActivity[];
  newMrrAdded: number;
  churnedMrr: number;
  netChange: number;
  message?: string;
}

interface DataForSeoDailyExpense {
  date: string;
  total: number;
  byApi: Record<string, number>;
}

interface DataForSeoUsageResponse {
  configured: boolean;
  message?: string;
  balance?: number;
  totalDeposited?: number;
  backlinksSubscriptionExpiry?: string | null;
  llmMentionsSubscriptionExpiry?: string | null;
  dailyExpenses: DataForSeoDailyExpense[];
}

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(n);

const FinancialOverviewPage: React.FC = () => {
  const [mrrLoading, setMrrLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [dataForSeoLoading, setDataForSeoLoading] = useState(false);
  const [mrrData, setMrrData] = useState<MrrBreakdownResponse | null>(null);
  const [activityData, setActivityData] = useState<SubscriptionActivityResponse | null>(null);
  const [dataForSeoData, setDataForSeoData] = useState<DataForSeoUsageResponse | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<MrrSegment | null>(null);
  const [dataForSeoDateStart, setDataForSeoDateStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dataForSeoDateEnd, setDataForSeoDateEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [dataForSeoSort, setDataForSeoSort] = useState<"date_asc" | "date_desc" | "total_asc" | "total_desc">("date_desc");

  const fetchMrrBreakdown = async () => {
    setMrrLoading(true);
    try {
      const res = await api.get<MrrBreakdownResponse>("/financial/mrr-breakdown");
      setMrrData(res.data);
    } catch {
      setMrrData(null);
    } finally {
      setMrrLoading(false);
    }
  };

  const fetchActivity = async () => {
    setActivityLoading(true);
    try {
      const res = await api.get<SubscriptionActivityResponse>("/financial/subscription-activity");
      setActivityData(res.data);
    } catch {
      setActivityData(null);
    } finally {
      setActivityLoading(false);
    }
  };

  const fetchDataForSeoUsage = async () => {
    setDataForSeoLoading(true);
    try {
      const res = await api.get<DataForSeoUsageResponse>("/financial/dataforseo-usage");
      setDataForSeoData(res.data);
    } catch {
      setDataForSeoData(null);
    } finally {
      setDataForSeoLoading(false);
    }
  };

  useEffect(() => {
    fetchMrrBreakdown();
    fetchActivity();
    fetchDataForSeoUsage();
  }, []);

  const handleRefresh = () => {
    fetchMrrBreakdown();
    fetchActivity();
    fetchDataForSeoUsage();
  };

  const pieData = (mrrData?.segments || []).map((s) => ({
    name: s.label,
    value: s.mrr,
    ...s,
  }));

  const activityChartData = (activityData?.dailyData || []).map((d) => ({
    ...d,
    dateShort: d.date.slice(5),
  }));

  const dataForSeoFilteredAndSorted = useMemo(() => {
    const list = dataForSeoData?.dailyExpenses ?? [];
    const start = dataForSeoDateStart || "";
    const end = dataForSeoDateEnd || "";
    let filtered = list;
    if (start) filtered = filtered.filter((d) => d.date >= start);
    if (end) filtered = filtered.filter((d) => d.date <= end);
    const sorted = [...filtered].sort((a, b) => {
      if (dataForSeoSort === "date_asc") return a.date.localeCompare(b.date);
      if (dataForSeoSort === "date_desc") return b.date.localeCompare(a.date);
      if (dataForSeoSort === "total_asc") return a.total - b.total;
      return b.total - a.total;
    });
    return sorted;
  }, [dataForSeoData?.dailyExpenses, dataForSeoDateStart, dataForSeoDateEnd, dataForSeoSort]);

  const dataForSeoChartData = useMemo(
    () =>
      dataForSeoFilteredAndSorted.map((d) => ({
        ...d,
        dateShort: d.date.slice(5).replace(/-/, "/"),
      })),
    [dataForSeoFilteredAndSorted]
  );

  const todayStr = new Date().toISOString().slice(0, 10);
  const dataForSeoSummaries = useMemo(() => {
    const list = dataForSeoData?.dailyExpenses ?? [];
    const today = list.find((d) => d.date === todayStr)?.total ?? 0;
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const thisWeek = list.filter((d) => d.date >= weekStartStr && d.date <= todayStr).reduce((s, d) => s + d.total, 0);
    const monthStart = new Date();
    monthStart.setDate(monthStart.getDate() - 30);
    const monthStartStr = monthStart.toISOString().slice(0, 10);
    const thisMonth = list.filter((d) => d.date >= monthStartStr && d.date <= todayStr).reduce((s, d) => s + d.total, 0);
    const rangeTotal = dataForSeoFilteredAndSorted.reduce((s, d) => s + d.total, 0);
    return { today, thisWeek, thisMonth, rangeTotal };
  }, [dataForSeoData?.dailyExpenses, dataForSeoFilteredAndSorted, todayStr]);

  const notConfigured = !mrrData?.configured && !activityData?.configured;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-primary-50/30 p-8">
      <div className="relative rounded-2xl bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-500 p-8 shadow-lg overflow-hidden mb-8">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEuNSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4xIi8+PC9zdmc+')] opacity-50" />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white">Financial Overview</h2>
            <p className="text-blue-100 mt-1 text-sm">Revenue breakdown, subscription activity, and API spending</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={mrrLoading || activityLoading || dataForSeoLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-white/20 backdrop-blur-sm px-4 py-2 text-sm font-medium text-white hover:bg-white/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${mrrLoading || activityLoading || dataForSeoLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {notConfigured && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 p-4 text-amber-800">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">
            Stripe is not configured. Set <code className="rounded bg-amber-100 px-1">STRIPE_SECRET_KEY</code>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left Panel - MRR Breakdown */}
        <div className="rounded-xl border border-gray-200 border-l-4 border-l-primary-500 bg-white shadow-sm overflow-hidden hover:shadow-lg hover:shadow-primary-100/50 transition-all duration-200">
          <div className="px-6 py-4 bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600">
            <h3 className="text-lg font-semibold text-white">Monthly Recurring Revenue Breakdown</h3>
            <p className="mt-1 text-sm text-white/90">
              Platform subscriptions by tier • Managed services by package • Add-ons. Click a segment to see accounts.
            </p>
          </div>
          <div className="p-6 bg-primary-50/20">

          {mrrLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : mrrData?.configured && mrrData.segments.length > 0 ? (
            <>
              <div className="mb-6 flex items-center justify-center rounded-xl bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 py-6 shadow-md">
                <div className="text-center">
                  <p className="text-sm font-medium text-white/90">Total MRR</p>
                  <p className="text-4xl font-bold tracking-tight text-white">{formatCurrency(mrrData.totalMrr)}</p>
                </div>
              </div>

              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      label={createNonOverlappingPieValueLabel({ formatValue: (v) => formatCurrency(v) })}
                      onClick={(e: any) => {
                        const seg = e?.payload as MrrSegment;
                        if (seg) setSelectedSegment(seg);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="#fff" strokeWidth={1} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload as MrrSegment & { value: number };
                        const pct = mrrData?.totalMrr ? ((p.mrr / mrrData.totalMrr) * 100).toFixed(1) : "0";
                        return (
                          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
                            <p className="font-medium text-gray-900">{p.label}</p>
                            <p className="text-gray-600">{formatCurrency(p.mrr)} ({pct}%)</p>
                            <p className="text-xs text-gray-500">{p.count} account(s) • Click to view</p>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {mrrData.segments.map((s) => (
                  <button
                    key={s.category}
                    onClick={() => setSelectedSegment(s)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50/60 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-primary-100 hover:border-primary-300"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.label}: {formatCurrency(s.mrr)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center text-center text-gray-500 rounded-lg border border-gray-200 border-l-4 border-l-amber-500 bg-amber-50/40">
              <DollarSign className="mb-2 h-12 w-12 text-amber-400" />
              <p className="text-sm">
                {mrrData?.configured ? "No subscription data yet." : mrrData?.message || "Configure Stripe to view MRR."}
              </p>
            </div>
          )}
          </div>
        </div>

        {/* Right Panel - Subscription Activity */}
        <div className="rounded-xl border border-gray-200 border-l-4 border-l-emerald-500 bg-white shadow-sm overflow-hidden hover:shadow-lg hover:shadow-emerald-100/50 transition-all duration-200">
          <div className="px-6 py-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600">
            <h3 className="text-lg font-semibold text-white">Subscription Activity (Last 30 Days)</h3>
            <p className="mt-1 text-sm text-white/90">
              Green: new subscriptions / upgrades. Red: cancellations / downgrades.
            </p>
          </div>
          <div className="p-6 bg-emerald-50/20">

          {activityLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : activityData?.configured ? (
            <>
              <div className="h-64">
                {activityChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={activityChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="dateShort" tick={{ fontSize: 11 }} />
                      <YAxis
                        tickFormatter={(v) => `$${v}`}
                        tick={{ fontSize: 11 }}
                        width={50}
                      />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        labelFormatter={(label, payload) =>
                          payload?.[0]?.payload?.date ? `${payload[0].payload.date}` : label
                        }
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="newMrr"
                        name="New / Upgrades"
                        stroke="#22c55e"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="churnedMrr"
                        name="Cancellations / Downgrades"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-gray-500">
                    No subscription activity in the last 30 days.
                  </div>
                )}
              </div>

              <div className="mt-6 grid grid-cols-3 gap-4">
                <div className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-emerald-400/20 to-emerald-600/20 rounded-full -mr-6 -mt-6 group-hover:scale-150 transition-transform duration-500" />
                  <div className="flex items-center gap-2 mb-1">
                    <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-1.5 rounded-lg"><ArrowUp className="h-3.5 w-3.5 text-white" /></div>
                    <p className="text-xs font-medium uppercase tracking-wider text-gray-600">New MRR added</p>
                  </div>
                  <p className="mt-1 text-xl font-bold text-emerald-600">+{formatCurrency(activityData.newMrrAdded)}</p>
                </div>
                <div className="rounded-xl border border-red-100 bg-white p-4 shadow-sm hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-red-400/20 to-red-600/20 rounded-full -mr-6 -mt-6 group-hover:scale-150 transition-transform duration-500" />
                  <div className="flex items-center gap-2 mb-1">
                    <div className="bg-gradient-to-br from-red-500 to-red-700 p-1.5 rounded-lg"><ArrowDown className="h-3.5 w-3.5 text-white" /></div>
                    <p className="text-xs font-medium uppercase tracking-wider text-gray-600">Churned MRR</p>
                  </div>
                  <p className="mt-1 text-xl font-bold text-red-600">-{formatCurrency(activityData.churnedMrr)}</p>
                </div>
                <div className={`rounded-xl border bg-white p-4 shadow-sm hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 relative overflow-hidden group ${activityData.netChange >= 0 ? "border-teal-100" : "border-amber-100"}`}>
                  <div className={`absolute top-0 right-0 w-16 h-16 rounded-full -mr-6 -mt-6 group-hover:scale-150 transition-transform duration-500 ${activityData.netChange >= 0 ? "bg-gradient-to-br from-teal-400/20 to-teal-600/20" : "bg-gradient-to-br from-amber-400/20 to-amber-600/20"}`} />
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`p-1.5 rounded-lg ${activityData.netChange >= 0 ? "bg-gradient-to-br from-teal-500 to-teal-700" : "bg-gradient-to-br from-amber-500 to-amber-700"}`}><TrendingUp className="h-3.5 w-3.5 text-white" /></div>
                    <p className="text-xs font-medium uppercase tracking-wider text-gray-600">Net change</p>
                  </div>
                  <p className={`mt-1 text-xl font-bold ${activityData.netChange >= 0 ? "text-teal-600" : "text-amber-600"}`}>
                    {activityData.netChange >= 0 ? "+" : ""}{formatCurrency(activityData.netChange)}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center text-center text-gray-500 rounded-lg border border-gray-200 border-l-4 border-l-amber-500 bg-amber-50/40">
              <TrendingUp className="mb-2 h-12 w-12 text-amber-400" />
              <p className="text-sm">{activityData?.message || "Configure Stripe to view activity."}</p>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* DataForSEO Spending (Super Admin) */}
      <div className="mt-8 rounded-xl border border-gray-200 border-l-4 border-l-slate-600 bg-white shadow-sm overflow-hidden hover:shadow-lg hover:shadow-slate-100/50 transition-all duration-200">
        <div className="px-6 py-4 bg-gradient-to-r from-slate-600 via-slate-700 to-slate-800">
          <h3 className="text-lg font-semibold text-white">DataForSEO Spending</h3>
          <p className="mt-1 text-sm text-white/90">
            Balance, usage, and daily spend from your DataForSEO account. Change dates to compare periods (e.g. last month vs this month). Sort by date or amount.
          </p>
        </div>
        <div className="p-6 bg-slate-50/30">
          {dataForSeoLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : !dataForSeoData?.configured ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-amber-200 bg-amber-50/60 p-6 text-center text-gray-600">
              <BarChart3 className="mb-2 h-12 w-12 text-amber-500" />
              <p className="text-sm">{dataForSeoData?.message ?? "DataForSEO usage is available to Super Admins. Configure DATAFORSEO_BASE64 to see balance and spending."}</p>
            </div>
          ) : (
            <>
              <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {typeof dataForSeoData.balance === "number" && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-slate-400/20 to-slate-600/20 rounded-full -mr-6 -mt-6 group-hover:scale-150 transition-transform duration-500" />
                    <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Balance</p>
                    <p className="mt-1 text-xl font-bold text-slate-700">{formatCurrency(dataForSeoData.balance)}</p>
                  </div>
                )}
                {typeof dataForSeoData.totalDeposited === "number" && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-slate-400/20 to-slate-600/20 rounded-full -mr-6 -mt-6 group-hover:scale-150 transition-transform duration-500" />
                    <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Total deposited</p>
                    <p className="mt-1 text-xl font-bold text-slate-700">{formatCurrency(dataForSeoData.totalDeposited)}</p>
                  </div>
                )}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-blue-400/20 to-blue-600/20 rounded-full -mr-6 -mt-6 group-hover:scale-150 transition-transform duration-500" />
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Today</p>
                  <p className="mt-1 text-xl font-bold text-blue-700">{formatCurrency(dataForSeoSummaries.today)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-indigo-400/20 to-indigo-600/20 rounded-full -mr-6 -mt-6 group-hover:scale-150 transition-transform duration-500" />
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">This week</p>
                  <p className="mt-1 text-xl font-bold text-indigo-700">{formatCurrency(dataForSeoSummaries.thisWeek)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-emerald-400/20 to-emerald-600/20 rounded-full -mr-6 -mt-6 group-hover:scale-150 transition-transform duration-500" />
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Last 30 days</p>
                  <p className="mt-1 text-xl font-bold text-emerald-700">{formatCurrency(dataForSeoSummaries.thisMonth)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-amber-400/20 to-amber-600/20 rounded-full -mr-6 -mt-6 group-hover:scale-150 transition-transform duration-500" />
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Selected range</p>
                  <p className="mt-1 text-xl font-bold text-amber-700">{formatCurrency(dataForSeoSummaries.rangeTotal)}</p>
                </div>
              </div>
              {dataForSeoData.backlinksSubscriptionExpiry != null && (
                <p className="mb-2 text-xs text-gray-600">
                  Backlinks API expires: {new Date(dataForSeoData.backlinksSubscriptionExpiry).toLocaleDateString()}
                  {dataForSeoData.llmMentionsSubscriptionExpiry != null && (
                    <> · LLM Mentions API expires: {new Date(dataForSeoData.llmMentionsSubscriptionExpiry).toLocaleDateString()}</>
                  )}
                </p>
              )}
              <div className="mb-4 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">From</label>
                  <input
                    type="date"
                    value={dataForSeoDateStart}
                    onChange={(e) => setDataForSeoDateStart(e.target.value)}
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">To</label>
                  <input
                    type="date"
                    value={dataForSeoDateEnd}
                    onChange={(e) => setDataForSeoDateEnd(e.target.value)}
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <span className="text-sm text-gray-500">Sort:</span>
                <div className="flex gap-1">
                  {[
                    { id: "date_desc" as const, label: "Date ↓", icon: ArrowDown },
                    { id: "date_asc" as const, label: "Date ↑", icon: ArrowUp },
                    { id: "total_desc" as const, label: "Amount ↓", icon: ArrowDown },
                    { id: "total_asc" as const, label: "Amount ↑", icon: ArrowUp },
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => setDataForSeoSort(id)}
                      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${dataForSeoSort === id ? "border-slate-500 bg-slate-100 text-slate-800" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"}`}
                    >
                      <Icon className="h-3 w-3" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {dataForSeoChartData.length > 0 ? (
                <div className="mb-6 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dataForSeoChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="dateShort" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} width={50} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""} />
                      <Legend />
                      <Area type="monotone" dataKey="total" name="Total spend" stroke="#475569" fill="#64748b" fillOpacity={0.5} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : null}
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase text-gray-600">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3">By API</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataForSeoFilteredAndSorted.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                          No daily data in selected range. DataForSEO returns spending per day when available.
                        </td>
                      </tr>
                    ) : (
                      dataForSeoFilteredAndSorted.map((row) => (
                        <tr key={row.date} className="border-b border-gray-100 hover:bg-slate-50/50">
                          <td className="px-4 py-2 font-medium text-gray-900">{row.date}</td>
                          <td className="px-4 py-2 text-right font-medium">{formatCurrency(row.total)}</td>
                          <td className="px-4 py-2 text-gray-600">
                            {Object.entries(row.byApi)
                              .filter(([, v]) => v > 0)
                              .map(([api, val]) => `${api}: ${formatCurrency(val)}`)
                              .join(" · ") || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal: Accounts in selected segment */}
      {selectedSegment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl border-l-4 border-l-primary-500">
            <div className="flex items-center justify-between bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 px-6 py-4">
              <h4 className="font-semibold text-white">
                {selectedSegment.label} — {selectedSegment.count} account(s)
              </h4>
              <button
                onClick={() => setSelectedSegment(null)}
                className="rounded-lg p-1 text-white/90 hover:bg-white/20 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-6 bg-gray-50/50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase text-gray-700 bg-gradient-to-r from-primary-50 to-blue-50">
                    <th className="px-1 pb-2 pt-1">Account</th>
                    <th className="px-1 pb-2 pt-1 text-right">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSegment.accounts.map((acc, i) => (
                    <tr key={`${acc.customerId}-${i}`} className="border-b border-gray-100">
                      <td className="py-2">
                        <div>
                          <p className="font-medium text-gray-900">{acc.customerEmail || acc.customerId || "—"}</p>
                          <p className="text-xs text-gray-500">{acc.productName}</p>
                        </div>
                      </td>
                      <td className="py-2 text-right font-medium">{formatCurrency(acc.mrr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialOverviewPage;
