import React, { useEffect, useState } from "react";
import {
  DollarSign,
  Loader2,
  RefreshCw,
  TrendingUp,
  X,
  AlertCircle,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
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

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(n);

const FinancialOverviewPage: React.FC = () => {
  const [mrrLoading, setMrrLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [mrrData, setMrrData] = useState<MrrBreakdownResponse | null>(null);
  const [activityData, setActivityData] = useState<SubscriptionActivityResponse | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<MrrSegment | null>(null);

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

  useEffect(() => {
    fetchMrrBreakdown();
    fetchActivity();
  }, []);

  const handleRefresh = () => {
    fetchMrrBreakdown();
    fetchActivity();
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

  const notConfigured = !mrrData?.configured && !activityData?.configured;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Financial Overview</h2>
        <button
          onClick={handleRefresh}
          disabled={mrrLoading || activityLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${mrrLoading || activityLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {notConfigured && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">
            Stripe is not configured. Set <code className="rounded bg-amber-100 px-1">STRIPE_SECRET_KEY</code>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left Panel - MRR Breakdown */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Monthly Recurring Revenue Breakdown</h3>

          {mrrLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : mrrData?.configured && mrrData.segments.length > 0 ? (
            <>
              <div className="mb-6 flex items-center justify-center rounded-lg bg-primary-50 py-4">
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-600">Total MRR</p>
                  <p className="text-3xl font-bold text-primary-600">{formatCurrency(mrrData.totalMrr)}</p>
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
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.label}: {formatCurrency(s.mrr)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center text-center text-gray-500">
              <DollarSign className="mb-2 h-12 w-12 text-gray-300" />
              <p className="text-sm">
                {mrrData?.configured ? "No subscription data yet." : mrrData?.message || "Configure Stripe to view MRR."}
              </p>
            </div>
          )}
        </div>

        {/* Right Panel - Subscription Activity */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">Subscription Activity (Last 30 Days)</h3>

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

              <div className="mt-6 grid grid-cols-3 gap-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
                <div>
                  <p className="text-xs font-medium text-gray-500">New MRR Added</p>
                  <p className="text-lg font-semibold text-green-600">
                    +{formatCurrency(activityData.newMrrAdded)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500">Churned MRR</p>
                  <p className="text-lg font-semibold text-red-600">
                    -{formatCurrency(activityData.churnedMrr)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500">Net Change</p>
                  <p
                    className={`text-lg font-semibold ${
                      activityData.netChange >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {activityData.netChange >= 0 ? "+" : ""}
                    {formatCurrency(activityData.netChange)}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center text-center text-gray-500">
              <TrendingUp className="mb-2 h-12 w-12 text-gray-300" />
              <p className="text-sm">{activityData?.message || "Configure Stripe to view activity."}</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Accounts in selected segment */}
      {selectedSegment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h4 className="font-semibold text-gray-900">
                {selectedSegment.label} — {selectedSegment.count} account(s)
              </h4>
              <button
                onClick={() => setSelectedSegment(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase text-gray-500">
                    <th className="pb-2">Account</th>
                    <th className="pb-2 text-right">MRR</th>
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
