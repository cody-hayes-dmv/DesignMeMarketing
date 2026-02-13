import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Loader2, RefreshCw, Info } from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { RootState } from "@/store";

type ChartType = "line" | "bar";

interface RankedKeywordsSummary {
  current: {
    totalKeywords: number;
    month: number;
    year: number;
    updatedAt?: string | null;
  } | null;
  previous: {
    totalKeywords: number;
    month: number;
    year: number;
  } | null;
  change: number | null;
  changePercent: string | number | null;
}

interface RankedKeywordsHistoryPoint {
  month: number;
  year: number;
  totalKeywords: number;
  top3?: number;
  top10?: number;
  page2?: number;
  pos21_30?: number;
  pos31_50?: number;
  pos51Plus?: number;
}

interface ChartDatum {
  month: string;
  total: number;
  top3: number;
  top10: number;
  page2: number;
  pos21_30: number;
  pos31_50: number;
  pos51Plus: number;
}

interface RankedKeywordsOverviewProps {
  clientId?: string | null;
  clientName?: string;
  className?: string;
  title?: string;
  subtitle?: string;
  titleTooltip?: string;
  lastUpdatedLabel?: string | null;
  showHeader?: boolean;
  headerActions?: React.ReactNode;
  shareToken?: string | null; // For share dashboard mode
  enableRefresh?: boolean; // Control showing the internal refresh button
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatHistory = (history: RankedKeywordsHistoryPoint[]): ChartDatum[] => {
  return history
    .map((item) => ({
      month: `${monthNames[item.month - 1]} ${item.year}`,
      total: Number(item.totalKeywords ?? 0),
      top3: Number(item.top3 ?? 0),
      top10: Number(item.top10 ?? 0),
      page2: Number(item.page2 ?? 0),
      pos21_30: Number(item.pos21_30 ?? 0),
      pos31_50: Number(item.pos31_50 ?? 0),
      pos51Plus: Number(item.pos51Plus ?? 0),
      sortKey: item.year * 100 + item.month,
    }))
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ sortKey, ...rest }) => rest);
};

// Shorten "Feb 2026" to "Feb '26" for X-axis so month and year are visible without clipping
const formatAxisMonth = (value: string) =>
  typeof value === "string" && value.length >= 8
    ? value.replace(/\s+(\d{4})$/, (_, y) => " '" + y.slice(-2))
    : value;

const SERIES = [
  { key: "top3" as const, name: "1–3 (Top 3)", color: "#FACC15" }, // yellow
  { key: "top10" as const, name: "4–10 (Top 10)", color: "#1E40AF" }, // dark blue
  { key: "page2" as const, name: "11–20", color: "#3B82F6" }, // blue
  { key: "pos21_30" as const, name: "21–30", color: "#166534" }, // dark green
  { key: "pos31_50" as const, name: "31–50", color: "#22C55E" }, // green
  { key: "pos51Plus" as const, name: "51+", color: "#8B5CF6" }, // any color (purple)
] as const;

// For stacked bars, the order of <Bar> controls bottom-to-top stacking.
// We want Top 3 (yellow) on top, so render it last.
const BAR_STACK_SERIES = [...SERIES].reverse();

const RankedKeywordsLegend = () => {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-2 text-xs font-medium text-gray-700">
          <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-gray-300/80" style={{ backgroundColor: s.color }} />
          <span>{s.name}</span>
        </li>
      ))}
    </ul>
  );
};

const RankedKeywordsTooltip = ({ active, label, payload }: any) => {
  if (!active || !payload || payload.length === 0) return null;
  const orderIndex = new Map<string, number>(SERIES.map((s, idx) => [s.key as string, idx]));
  const sortedPayload = [...payload].sort((a: any, b: any) => {
    const ai = orderIndex.get(String(a?.dataKey)) ?? 999;
    const bi = orderIndex.get(String(b?.dataKey)) ?? 999;
    return ai - bi;
  });

  const total = sortedPayload.reduce((sum: number, p: any) => sum + (Number(p?.value) || 0), 0);
  return (
    <div className="rounded-xl border border-indigo-200 bg-white px-3 py-2 shadow-lg ring-1 ring-indigo-100">
      <p className="text-xs font-semibold text-indigo-900">{label}</p>
      <p className="mt-1 text-sm font-bold text-gray-900">Total: {total.toLocaleString()}</p>
      <div className="mt-2 space-y-1">
        {sortedPayload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: p.color }} />
              <span className="text-gray-700 truncate font-medium">{p.name}</span>
            </div>
            <span className="font-semibold text-gray-900">{(Number(p.value) || 0).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const RankedKeywordsOverview: React.FC<RankedKeywordsOverviewProps> = ({
  clientId,
  clientName,
  className = "",
  title = "Total Keywords Ranked",
  subtitle = "Track how many keywords this client is ranking for and how it is trending over time.",
  titleTooltip,
  lastUpdatedLabel,
  showHeader = true,
  headerActions,
  shareToken,
  enableRefresh = true,
}) => {
  const { user } = useSelector((state: RootState) => state.auth);
  const [summary, setSummary] = useState<RankedKeywordsSummary | null>(null);
  const [history, setHistory] = useState<ChartDatum[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>("line");
  const [refreshing, setRefreshing] = useState(false);
  const autoRefreshAttemptedRef = useRef<Record<string, boolean>>({});

  const hasData = Boolean(summary?.current);

  const fetchSummary = useCallback(
    async () => {
      if (!clientId) return;
      try {
        setSummaryLoading(true);
        setSummaryError(null);
        // Use share endpoint if shareToken is provided, otherwise use regular endpoint
        const endpoint = shareToken 
          ? `/seo/share/${encodeURIComponent(shareToken)}/ranked-keywords`
          : `/seo/ranked-keywords/${clientId}`;
        const res = await api.get(endpoint);
        const data: RankedKeywordsSummary = res.data || null;
        if (data) {
          setSummary({
            ...data,
            changePercent:
              data?.changePercent !== null && data?.changePercent !== undefined
                ? Number(data.changePercent)
                : null,
          });
        } else {
          setSummary(null);
        }
      } catch (error: any) {
        console.error("Failed to load ranked keywords summary", error);
        const errorMsg = error?.response?.data?.message || "Unable to load ranked keywords summary";
        setSummaryError(errorMsg);
        // Toast is already shown by API interceptor
      } finally {
        setSummaryLoading(false);
      }
    },
    [clientId, shareToken]
  );

  const fetchHistory = useCallback(async () => {
    if (!clientId) return;
    try {
      setHistoryLoading(true);
      setHistoryError(null);
      // Use share endpoint if shareToken is provided, otherwise use regular endpoint
      const endpoint = shareToken
        ? `/seo/share/${encodeURIComponent(shareToken)}/ranked-keywords/history`
        : `/seo/ranked-keywords/${clientId}/history`;
      const res = await api.get(endpoint);
      const data: RankedKeywordsHistoryPoint[] = res.data || [];
      setHistory(formatHistory(data));
    } catch (error: any) {
      console.error("Failed to load ranked keywords history", error);
      const errorMsg = error?.response?.data?.message || "Unable to load ranked keywords history";
      setHistoryError(errorMsg);
      // Toast is already shown by API interceptor
    } finally {
      setHistoryLoading(false);
    }
  }, [clientId, shareToken]);

  useEffect(() => {
    if (!clientId) return;
    fetchSummary();
    fetchHistory();
  }, [clientId, fetchSummary, fetchHistory]);

  const handleRefresh = useCallback(async () => {
    if (!clientId || user?.role !== "SUPER_ADMIN") return;
    try {
      setRefreshing(true);
      // Refresh ranked keywords summary (current month)
      await api.post(`/seo/dashboard/${clientId}/refresh`);
      // Refresh ranked keywords history
      await api.post(`/seo/ranked-keywords/${clientId}/history/refresh`);
      toast.success("Ranked keywords data refreshed successfully!");
      // Refetch data from DB
      await fetchSummary();
      await fetchHistory();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to refresh ranked keywords data");
    } finally {
      setRefreshing(false);
    }
  }, [clientId, user?.role, fetchSummary, fetchHistory]);

  // If the widget has no ranked-keywords data on first load, auto-refresh once for SUPER_ADMIN.
  // This makes the initial open behave like clicking Refresh (server-side throttling still applies).
  useEffect(() => {
    if (!clientId) return;
    if (user?.role !== "SUPER_ADMIN" || !enableRefresh) return;
    if (summaryLoading || historyLoading || refreshing) return;
    if (summaryError || historyError) return;
    if (summary?.current) return; // already have data
    if (autoRefreshAttemptedRef.current[clientId]) return;

    // Cross-navigation TTL guard: don't keep calling refresh endpoints on every visit.
    const ttlMs = 48 * 60 * 60 * 1000;
    const key = `rk_auto_refresh_${clientId}`;
    try {
      const last = Number(localStorage.getItem(key) || "0");
      if (Number.isFinite(last) && last > 0 && Date.now() - last < ttlMs) {
        return;
      }
      localStorage.setItem(key, String(Date.now()));
    } catch {
      // ignore storage failures; server-side throttling still protects charges
    }

    autoRefreshAttemptedRef.current[clientId] = true;
    void handleRefresh();
  }, [
    clientId,
    enableRefresh,
    handleRefresh,
    historyError,
    historyLoading,
    refreshing,
    summary,
    summaryError,
    summaryLoading,
    user?.role,
  ]);

  const changeBadge = useMemo(() => {
    if (!summary || summary.change === null || summary.change === undefined || summary.change === 0) {
      return null;
    }
    const isPositive = summary.change > 0;
    const changePercent =
      summary.changePercent !== null && summary.changePercent !== undefined && !isNaN(Number(summary.changePercent))
        ? Number(summary.changePercent)
        : null;
    return (
      <div className={`flex items-center space-x-1 text-sm font-semibold ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
        {isPositive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
        <span>
          {isPositive ? "+" : ""}
          {summary.change.toLocaleString()} vs last month
        </span>
        {changePercent !== null && (
          <span className={`text-xs ${isPositive ? "text-emerald-700/80" : "text-rose-700/80"}`}>
            ({isPositive ? "+" : ""}
            {changePercent}
            %)
          </span>
        )}
      </div>
    );
  }, [summary]);

  const lastUpdated = useMemo(() => {
    if (!summary?.current?.updatedAt) return null;
    try {
      return new Date(summary.current.updatedAt).toLocaleString();
    } catch {
      return summary.current.updatedAt;
    }
  }, [summary?.current?.updatedAt]);

  const isHistoryInitialLoading = historyLoading && history.length === 0;

  if (!clientId) {
    return (
      <div className={`rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-6 shadow-sm ${className}`}>
        <p className="text-sm text-emerald-800">Select a client to view ranked keyword trends.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border-l-4 border-emerald-500 bg-white shadow-sm ring-1 ring-gray-200/80 overflow-hidden ${className}`}>
      {showHeader && (
        <div className="py-4 px-5 border-b-2 border-gray-100 bg-gradient-to-r from-emerald-50/80 via-teal-50/60 to-green-50/50 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-emerald-900 inline-flex items-center gap-1.5">
              {title}
              {titleTooltip && (
                <span title={titleTooltip}>
                  <Info className="h-4 w-4 text-emerald-600 cursor-help" aria-hidden />
                </span>
              )}
            </h3>
            <p className="text-sm text-emerald-800/80">
              {subtitle}
              {clientName ? ` Client: ${clientName}` : ""}
            </p>
            {lastUpdatedLabel && <p className="text-xs text-emerald-700/70 mt-0.5">{lastUpdatedLabel}</p>}
          </div>
          <div className="flex items-center space-x-2">
            {headerActions}
            {user?.role === "SUPER_ADMIN" && enableRefresh && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || summaryLoading || historyLoading}
                data-pdf-hide="true"
                className="bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                title="Refresh ranked keywords data"
              >
                {refreshing || summaryLoading || historyLoading ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Refreshing...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3" />
                    <span>Refresh</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`space-y-4 ${showHeader ? "py-4 px-5 pt-3" : "py-4 px-5"} bg-gradient-to-b from-white to-slate-50/20`}>
        {summaryError && (
          <div className="rounded-xl border-l-4 border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-800 font-medium shadow-sm">
            {summaryError}
          </div>
        )}

        <div className="rounded-xl border-l-4 border-emerald-500 bg-gradient-to-r from-emerald-50/80 via-teal-50/60 to-green-50/50 py-4 px-5 flex flex-col gap-2 shadow-sm">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-emerald-900">Current total keywords ranked</p>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-3xl font-bold text-gray-900">
                  {summaryLoading && !hasData ? (
                    <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                  ) : summary?.current?.totalKeywords !== undefined && summary?.current?.totalKeywords !== null ? (
                    summary.current.totalKeywords.toLocaleString()
                  ) : (
                    "—"
                  )}
                </span>
                {changeBadge}
              </div>
              <div className="mt-2 space-y-1 text-xs text-emerald-800/90">
                {summary?.previous && (
                  <p>
                    Last month:{" "}
                    <span className="font-semibold text-emerald-900">
                      {summary.previous.totalKeywords.toLocaleString()} keywords
                    </span>
                  </p>
                )}
                {lastUpdated && <p className="text-emerald-700/80">Last updated {lastUpdated}</p>}
              </div>
            </div>
            {!showHeader && user?.role === "SUPER_ADMIN" && enableRefresh && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || summaryLoading || historyLoading}
                data-pdf-hide="true"
                className="bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed text-sm self-start"
                title="Refresh ranked keywords data"
              >
                {refreshing || summaryLoading || historyLoading ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Refreshing...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3" />
                    <span>Refresh</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-xl border-l-4 border-indigo-500 bg-white border border-indigo-200/60 px-4 pt-3 pb-2 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-indigo-900">
                Total Keywords Ranked Over Time
              </h4>
              <p className="text-xs text-indigo-800/80 mt-0.5">
                Total keywords per month (12 months) with breakdown by rank: 1–3, 4–10, 11–20, 21–30, 31–50, 51+. Data from DataForSEO.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center space-x-1 rounded-xl bg-indigo-100/80 p-1 border border-indigo-200/60">
                <button
                  type="button"
                  onClick={() => setChartType("line")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    chartType === "line"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-indigo-700 hover:bg-indigo-100"
                  }`}
                >
                  Line
                </button>
                <button
                  type="button"
                  onClick={() => setChartType("bar")}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    chartType === "bar"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-indigo-700 hover:bg-indigo-100"
                  }`}
                >
                  Bar
                </button>
              </div>
            </div>
          </div>

          {historyError && (
            <div className="rounded-xl border-l-4 border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-800 font-medium">
              {historyError}
            </div>
          )}

          {isHistoryInitialLoading ? (
            <div className="flex h-64 items-center justify-center rounded-lg bg-indigo-50/40">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-indigo-800">
                <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                Loading history…
              </span>
            </div>
          ) : history.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-center rounded-lg bg-amber-50/50 py-8">
              <p className="text-sm font-medium text-amber-900">No historical data available yet.</p>
              <p className="text-xs text-amber-800/80 mt-1">
                Fetch ranked keywords at least once per month to build up a trendline.
              </p>
            </div>
          ) : (
            <div className="relative flex flex-col">
              {historyLoading && (
                <div className="absolute right-2 top-2 z-10 inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/95 px-3 py-1.5 text-xs font-medium text-indigo-800 shadow-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                  Updating…
                </div>
              )}
              {/* 1. Chart area (first in column) */}
              <div className="h-[19rem] w-full min-h-[17.5rem] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === "line" ? (
                    <LineChart
                      data={history}
                      margin={{ top: 16, right: 32, left: 16, bottom: 30 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis
                        dataKey="month"
                        stroke="#6B7280"
                        tick={{ fontSize: 11, fill: "#374151" }}
                        tickFormatter={formatAxisMonth}
                        angle={-35}
                        textAnchor="end"
                        height={30}
                        interval={0}
                        dy={4}
                      />
                      <YAxis
                        stroke="#6B7280"
                        tick={{ fontSize: 11 }}
                        label={{ value: "Keywords", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                        allowDecimals={false}
                      />
                      <Tooltip content={<RankedKeywordsTooltip />} />
                      {SERIES.map((s) => (
                        <Line
                          key={s.key}
                          type="monotone"
                          dataKey={s.key}
                          stroke={s.color}
                          strokeWidth={2.5}
                          dot={{ r: 3, strokeWidth: 0, fill: s.color }}
                          activeDot={{ r: 5, fill: s.color }}
                          name={s.name}
                        />
                      ))}
                    </LineChart>
                  ) : (
                    <BarChart
                      data={history}
                      margin={{ top: 16, right: 32, left: 16, bottom: 30 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis
                        dataKey="month"
                        stroke="#6B7280"
                        tick={{ fontSize: 11, fill: "#374151" }}
                        tickFormatter={formatAxisMonth}
                        angle={-35}
                        textAnchor="end"
                        height={30}
                        interval={0}
                        dy={4}
                      />
                      <YAxis
                        stroke="#6B7280"
                        tick={{ fontSize: 11 }}
                        label={{ value: "Keywords", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                        allowDecimals={false}
                      />
                      <Tooltip content={<RankedKeywordsTooltip />} />
                      {BAR_STACK_SERIES.map((s, idx, arr) => (
                        <Bar
                          key={s.key}
                          dataKey={s.key}
                          name={s.name}
                          fill={s.color}
                          stroke={s.color}
                          strokeWidth={1}
                          stackId="a"
                          radius={idx === arr.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                          isAnimationActive={true}
                        />
                      ))}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
              {/* 2. Legend directly under chart (minimal gap) */}
              <div className="mt-0.5 pt-2 border-t border-indigo-100 bg-indigo-50/30 rounded-b-lg px-2 pb-2 shrink-0">
                <RankedKeywordsLegend />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RankedKeywordsOverview;

