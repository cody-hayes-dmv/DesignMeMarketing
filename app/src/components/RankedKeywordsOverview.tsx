import React, { useCallback, useEffect, useMemo, useState } from "react";
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
}

interface ChartDatum {
  month: string;
  keywords: number;
}

interface RankedKeywordsOverviewProps {
  clientId?: string | null;
  clientName?: string;
  className?: string;
  title?: string;
  subtitle?: string;
  showHeader?: boolean;
  headerActions?: React.ReactNode;
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatHistory = (history: RankedKeywordsHistoryPoint[]): ChartDatum[] => {
  return history
    .map((item) => ({
      month: `${monthNames[item.month - 1]} ${item.year}`,
      keywords: Number(item.totalKeywords ?? 0),
      sortKey: item.year * 100 + item.month,
    }))
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ sortKey, ...rest }) => rest);
};

const RankedKeywordsOverview: React.FC<RankedKeywordsOverviewProps> = ({
  clientId,
  clientName,
  className = "",
  title = "Total Keywords Ranked",
  subtitle = "Track how many keywords this client is ranking for and how it is trending over time.",
  showHeader = true,
  headerActions,
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

  const hasData = Boolean(summary?.current);

  const fetchSummary = useCallback(
    async () => {
      if (!clientId) return;
      try {
        setSummaryLoading(true);
        setSummaryError(null);
        // Always read from DB - no fetch parameter
        const res = await api.get(`/seo/ranked-keywords/${clientId}`);
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
    [clientId]
  );

  const fetchHistory = useCallback(async () => {
    if (!clientId) return;
    try {
      setHistoryLoading(true);
      setHistoryError(null);
      const res = await api.get(`/seo/ranked-keywords/${clientId}/history`);
      const data: RankedKeywordsHistoryPoint[] = res.data || [];
      setHistory(formatHistory(data));
    } catch (error: any) {
      console.error("Failed to load ranked keywords history", error);
      setHistory([]);
      const errorMsg = error?.response?.data?.message || "Unable to load ranked keywords history";
      setHistoryError(errorMsg);
      // Toast is already shown by API interceptor
    } finally {
      setHistoryLoading(false);
    }
  }, [clientId]);

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
            {user?.role === "SUPER_ADMIN" && (
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

          {historyLoading ? (
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
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "line" ? (
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="month"
                      stroke="#6B7280"
                      style={{ fontSize: "12px" }}
                      angle={-35}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      stroke="#6B7280"
                      style={{ fontSize: "12px" }}
                      label={{ value: "Keywords", angle: -90, position: "insideLeft" }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid #E5E7EB",
                        borderRadius: "8px",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                      }}
                      formatter={(value: number) => [value.toLocaleString(), "Keywords"]}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="keywords"
                      stroke="#2563EB"
                      strokeWidth={3}
                      dot={{ r: 4, strokeWidth: 0, fill: "#60A5FA" }}
                      activeDot={{ r: 6, fill: "#1D4ED8" }}
                      name="Total Keywords Ranked"
                    />
                  </LineChart>
                ) : (
                  <BarChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="month"
                      stroke="#6B7280"
                      style={{ fontSize: "12px" }}
                      angle={-35}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      stroke="#6B7280"
                      style={{ fontSize: "12px" }}
                      label={{ value: "Keywords", angle: -90, position: "insideLeft" }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid #E5E7EB",
                        borderRadius: "8px",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                      }}
                      formatter={(value: number) => [value.toLocaleString(), "Keywords"]}
                    />
                    <Legend />
                    <Bar
                      dataKey="keywords"
                      name="Total Keywords Ranked"
                      fill="#3B82F6"
                      radius={[6, 6, 0, 0]}
                    />
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

