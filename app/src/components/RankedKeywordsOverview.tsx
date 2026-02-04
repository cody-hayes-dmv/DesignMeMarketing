import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
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
        <li key={s.key} className="flex items-center gap-2 text-xs text-gray-600">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
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
  const only51Plus = total > 0 && sortedPayload.every((p: any) => {
    const v = Number(p?.value) || 0;
    return p?.dataKey === "pos51Plus" ? v === total : v === 0;
  });
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow">
      <p className="text-xs font-medium text-gray-700">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">Total: {total.toLocaleString()}</p>
      {only51Plus && (
        <p className="mt-1 text-xs text-amber-600">Rank breakdown not available for this month. Use Refresh to recalculate.</p>
      )}
      <div className="mt-2 space-y-1">
        {sortedPayload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
              <span className="text-gray-600 truncate">{p.name}</span>
            </div>
            <span className="font-medium text-gray-800">{(Number(p.value) || 0).toLocaleString()}</span>
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
      <div className={`flex items-center space-x-1 text-sm font-medium ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
        {isPositive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
        <span>
          {isPositive ? "+" : ""}
          {summary.change.toLocaleString()} vs last month
        </span>
        {changePercent !== null && (
          <span className="text-xs text-gray-500">
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
      <div className={`bg-white rounded-xl border border-gray-200 p-6 ${className}`}>
        <p className="text-sm text-gray-500">Select a client to view ranked keyword trends.</p>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border border-gray-200 ${className}`}>
      {showHeader && (
        <div className="p-6 border-b border-gray-200 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500">
              {subtitle}
              {clientName ? ` Client: ${clientName}` : ""}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            {headerActions}
            {user?.role === "SUPER_ADMIN" && enableRefresh && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || summaryLoading || historyLoading}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing || summaryLoading || historyLoading ? "animate-spin text-primary-600" : ""}`} />
                <span>Refresh</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`space-y-6 ${showHeader ? "p-6 pt-4" : "p-6"}`}>
        {summaryError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {summaryError}
          </div>
        )}

        <div className="bg-gradient-to-r from-primary-50 via-blue-50 to-blue-100/40 rounded-lg p-5 flex flex-col gap-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Current total keywords ranked</p>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-bold text-gray-900">
                  {summaryLoading && !hasData ? (
                    <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
                  ) : summary?.current?.totalKeywords !== undefined && summary?.current?.totalKeywords !== null ? (
                    summary.current.totalKeywords.toLocaleString()
                  ) : (
                    "—"
                  )}
                </span>
                {changeBadge}
              </div>
              <div className="mt-2 space-y-1 text-xs text-gray-600">
                {summary?.previous && (
                  <p>
                    Last month:{" "}
                    <span className="font-medium">
                      {summary.previous.totalKeywords.toLocaleString()} keywords
                    </span>
                  </p>
                )}
                {lastUpdated && <p className="text-gray-500">Last updated {lastUpdated}</p>}
              </div>
            </div>
            {!showHeader && user?.role === "SUPER_ADMIN" && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || summaryLoading || historyLoading}
                className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing || summaryLoading || historyLoading ? "animate-spin text-primary-600" : ""}`} />
                <span>Refresh</span>
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-gray-200 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">
                Total Keywords Ranked Over Time
              </h4>
              <p className="text-xs text-gray-500">Based on the last 12 monthly snapshots.</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center space-x-1 rounded-lg bg-gray-100 p-1">
                <button
                  type="button"
                  onClick={() => setChartType("line")}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    chartType === "line"
                      ? "bg-white text-primary-600 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Line
                </button>
                <button
                  type="button"
                  onClick={() => setChartType("bar")}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    chartType === "bar"
                      ? "bg-white text-primary-600 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Bar
                </button>
              </div>
            </div>
          </div>

          {historyError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {historyError}
            </div>
          )}

          {isHistoryInitialLoading ? (
            <div className="flex h-64 items-center justify-center">
              <span className="inline-flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                Loading history…
              </span>
            </div>
          ) : history.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-center text-sm text-gray-500">
              <p>No historical data available yet.</p>
              <p className="text-xs text-gray-400 mt-1">
                Fetch ranked keywords at least once per month to build up a trendline.
              </p>
            </div>
          ) : (
            <div className="relative h-72">
              {historyLoading && (
                <div className="absolute right-2 top-2 z-10 inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white/90 px-2 py-1 text-xs text-gray-600 shadow-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600" />
                  Updating…
                </div>
              )}
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "line" ? (
                  <LineChart data={history} margin={{ top: 10, right: 10, left: 10, bottom: 72 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="month"
                      stroke="#6B7280"
                      tick={{ fontSize: 12, fill: "#374151" }}
                      angle={-40}
                      textAnchor="end"
                      height={72}
                      interval={0}
                      dy={8}
                    />
                    <YAxis
                      stroke="#6B7280"
                      style={{ fontSize: "12px" }}
                      label={{ value: "Keywords", angle: -90, position: "insideLeft" }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={<RankedKeywordsTooltip />}
                    />
                    <Legend
                      content={<RankedKeywordsLegend />}
                      wrapperStyle={{ width: "100%", display: "flex", justifyContent: "center" }}
                    />
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
                  <BarChart data={history} margin={{ top: 10, right: 10, left: 10, bottom: 72 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="month"
                      stroke="#6B7280"
                      tick={{ fontSize: 12, fill: "#374151" }}
                      angle={-40}
                      textAnchor="end"
                      height={72}
                      interval={0}
                      dy={8}
                    />
                    <YAxis
                      stroke="#6B7280"
                      style={{ fontSize: "12px" }}
                      label={{ value: "Keywords", angle: -90, position: "insideLeft" }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={<RankedKeywordsTooltip />}
                    />
                    <Legend
                      content={<RankedKeywordsLegend />}
                      wrapperStyle={{ width: "100%", display: "flex", justifyContent: "center" }}
                    />
                    {/* Stacked bars: render bottom-to-top (yellow on top). Each segment uses its own fill. */}
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
          )}
        </div>
      </div>
    </div>
  );
};

export default RankedKeywordsOverview;

