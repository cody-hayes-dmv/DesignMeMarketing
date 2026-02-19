import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchAgencies } from "@/store/slices/agencySlice";
import { fetchClients } from "@/store/slices/clientSlice";
import Layout from "@/components/Layout";
import { Building2, Users, Activity, Globe, CheckCircle, AlertCircle, Loader2, RefreshCw, ListTodo, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import toast from "react-hot-toast";

interface PendingManagedService {
  id: string;
  clientId: string;
  clientName: string;
  agencyId: string;
  agencyName: string;
  packageId: string;
  packageName: string;
  monthlyPrice: number;
  startDate: string;
}

const SuperAdminDashboard = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { agencies, loading: agenciesLoading } = useSelector((state: RootState) => state.agency);
  const { clients, loading: clientsLoading } = useSelector((state: RootState) => state.client);
  const [pendingManagedServices, setPendingManagedServices] = useState<PendingManagedService[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [mrrData, setMrrData] = useState<{ totalMrr: number; segments: Array<{ label: string; mrr: number; color?: string }> } | null>(null);
  const [activityData, setActivityData] = useState<{ newMrrAdded: number; churnedMrr: number; netChange: number } | null>(null);
  const [financialLoading, setFinancialLoading] = useState(true);
  const [upcomingTasks, setUpcomingTasks] = useState<Array<{
    id: string;
    title: string;
    status: string;
    dueDate?: string | null;
    client?: { id: string; name: string; domain?: string } | null;
  }>>([]);
  const [upcomingTasksLoading, setUpcomingTasksLoading] = useState(true);

  const fetchFinancial = async () => {
    setFinancialLoading(true);
    try {
      const [mrrRes, activityRes] = await Promise.all([
        api.get("/financial/mrr-breakdown").catch(() => ({ data: null })),
        api.get("/financial/subscription-activity").catch(() => ({ data: null })),
      ]);
      if (mrrRes.data?.segments) {
        setMrrData({
          totalMrr: mrrRes.data.totalMrr ?? 0,
          segments: (mrrRes.data.segments ?? []).map((s: any) => ({ label: s.label, mrr: s.mrr, color: s.color })),
        });
      } else {
        setMrrData(null);
      }
      if (activityRes.data && typeof activityRes.data.newMrrAdded === "number") {
        setActivityData({
          newMrrAdded: activityRes.data.newMrrAdded,
          churnedMrr: activityRes.data.churnedMrr ?? 0,
          netChange: activityRes.data.netChange ?? 0,
        });
      } else {
        setActivityData(null);
      }
    } catch {
      setMrrData(null);
      setActivityData(null);
    } finally {
      setFinancialLoading(false);
    }
  };

  useEffect(() => {
    fetchFinancial();
  }, []);

  useEffect(() => {
    dispatch(fetchAgencies() as any);
    dispatch(fetchClients() as any);
  }, [dispatch]);

  useEffect(() => {
    const fetchPending = async () => {
      try {
        const res = await api.get<PendingManagedService[]>("/agencies/managed-services?pendingOnly=true");
        setPendingManagedServices(Array.isArray(res.data) ? res.data : []);
      } catch {
        setPendingManagedServices([]);
      } finally {
        setLoadingPending(false);
      }
    };
    fetchPending();
  }, []);

  useEffect(() => {
    const fetchUpcoming = async () => {
      setUpcomingTasksLoading(true);
      try {
        const res = await api.get("/tasks?assigneeMe=true");
        const list = Array.isArray(res.data) ? res.data : [];
        const notDone = list.filter((t: any) => t.status !== "DONE");
        const sorted = [...notDone].sort((a: any, b: any) => {
          const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
          return aDue - bDue;
        });
        setUpcomingTasks(sorted.slice(0, 7));
      } catch {
        setUpcomingTasks([]);
      } finally {
        setUpcomingTasksLoading(false);
      }
    };
    fetchUpcoming();
  }, []);

  const safeParseObject = (raw: any): Record<string, any> => {
    if (!raw) return {};
    if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, any>;
    if (typeof raw !== "string") return {};
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
    } catch {
      return {};
    }
  };

  const isManagedServiceClient = (client: (typeof clients)[number]) => {
    const info = safeParseObject((client as any)?.accountInfo);
    return Boolean(
      info.seoRoadmapStartMonth ||
      info.pagesPerMonth ||
      info.technicalHoursPerMonth ||
      info.campaignDurationMonths
    );
  };

  // Dashboard metrics: prefer API (SUPER_ADMIN) for correct definitions
  const [stats, setStats] = useState<{
    totalAgencies: number;
    activeAgencies: number;
    activeManagedClients: number;
    totalDashboards: number;
    pendingRequests: number;
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get("/seo/super-admin/dashboard");
        setStats(res.data);
      } catch {
        setStats(null);
      } finally {
        setStatsLoading(false);
      }
    };
    load();
  }, []);

  const totalAgencies = stats?.totalAgencies ?? agencies.length;
  const totalClients = clients.length;
  const totalDashboards = stats?.totalDashboards ?? totalClients;
  const activeAgencies = stats?.activeAgencies ?? agencies.filter((a) => (a.clientCount ?? 0) > 0).length;
  const activeManagedClients =
    stats?.activeManagedClients ??
    clients.filter((c) => c.status === "ACTIVE").length;
  const pendingRequests = stats?.pendingRequests ?? pendingManagedServices.length;

  // Recent agencies (last 5)
  const recentAgencies = [...agencies]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  // Recent clients (last 5)
  const recentClients = [...clients]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  // Calculate growth metrics (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const newAgenciesLast30Days = agencies.filter(
    agency => new Date(agency.createdAt) >= thirtyDaysAgo
  ).length;
  
  const newClientsLast30Days = clients.filter(
    (client) => new Date(client.createdAt) >= thirtyDaysAgo
  ).length;

  return (
    <Layout title="Super Admin Dashboard">
      <div className="space-y-10">
        {/* Header */}
        <div className="pb-2 border-b border-gray-100">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
            Super Admin Dashboard
          </h1>
          <p className="text-gray-500 mt-2 text-base">
            Overview of agencies, clients, and platform activity
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6 lg:gap-8">
          {/* Total Agencies */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow hover:border-gray-200 transition-all duration-200 overflow-hidden group">
            <div className="h-1 w-full bg-primary-500" aria-hidden />
            <div className="p-6 lg:p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Total Agencies</p>
                  <p className="text-4xl font-extrabold text-gray-900 tabular-nums tracking-tight">
                    {statsLoading ? "—" : totalAgencies}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">agencies</p>
                  {!statsLoading && (
                    <p className="text-sm text-gray-500 mt-4 leading-relaxed border-t border-gray-100 pt-4">
                      {newAgenciesLast30Days} new in last 30 days
                    </p>
                  )}
                </div>
                <div className="bg-primary-50 p-3.5 rounded-xl shrink-0 group-hover:bg-primary-100 transition-colors" aria-hidden>
                  <Building2 className="h-7 w-7 text-primary-600" />
                </div>
              </div>
            </div>
          </div>

          {/* Active Agencies */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow hover:border-gray-200 transition-all duration-200 overflow-hidden group">
            <div className="h-1 w-full bg-green-500" aria-hidden />
            <div className="p-6 lg:p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Active Agencies</p>
                  <p className="text-4xl font-extrabold text-gray-900 tabular-nums tracking-tight">
                    {statsLoading ? "—" : activeAgencies}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">active</p>
                  {!statsLoading && (
                    <p className="text-sm text-gray-500 mt-4 leading-relaxed border-t border-gray-100 pt-4">
                      {totalAgencies > 0 ? Math.round((activeAgencies / totalAgencies) * 100) : 0}% of total
                    </p>
                  )}
                </div>
                <div className="bg-green-50 p-3.5 rounded-xl shrink-0 group-hover:bg-green-100 transition-colors" aria-hidden>
                  <CheckCircle className="h-7 w-7 text-green-600" />
                </div>
              </div>
            </div>
          </div>

          {/* Active Clients */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow hover:border-gray-200 transition-all duration-200 overflow-hidden group">
            <div className="h-1 w-full bg-indigo-500" aria-hidden />
            <div className="p-6 lg:p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Active Clients</p>
                  <p className="text-4xl font-extrabold text-gray-900 tabular-nums tracking-tight">
                    {statsLoading ? "—" : activeManagedClients}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">active clients</p>
                  {!statsLoading && (
                    <p className="text-sm text-gray-500 mt-4 leading-relaxed border-t border-gray-100 pt-4">
                      Clients with active status
                    </p>
                  )}
                </div>
                <div className="bg-indigo-50 p-3.5 rounded-xl shrink-0 group-hover:bg-indigo-100 transition-colors" aria-hidden>
                  <Users className="h-7 w-7 text-indigo-600" />
                </div>
              </div>
            </div>
          </div>

          {/* Total Dashboards */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow hover:border-gray-200 transition-all duration-200 overflow-hidden group">
            <div className="h-1 w-full bg-blue-500" aria-hidden />
            <div className="p-6 lg:p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Total Dashboards</p>
                  <p className="text-4xl font-extrabold text-gray-900 tabular-nums tracking-tight">
                    {statsLoading ? "—" : totalDashboards}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">dashboards</p>
                  {!statsLoading && (
                    <p className="text-sm text-gray-500 mt-4 leading-relaxed border-t border-gray-100 pt-4">
                      {newClientsLast30Days} new in last 30 days
                    </p>
                  )}
                </div>
                <div className="bg-blue-50 p-3.5 rounded-xl shrink-0 group-hover:bg-blue-100 transition-colors" aria-hidden>
                  <Activity className="h-7 w-7 text-blue-600" />
                </div>
              </div>
            </div>
          </div>

          {/* Pending Requests */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow hover:border-gray-200 transition-all duration-200 overflow-hidden group">
            <div className="h-1 w-full bg-rose-500" aria-hidden />
            <div className="p-6 lg:p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">Pending Requests</p>
                  <p className="text-4xl font-extrabold text-gray-900 tabular-nums tracking-tight">
                    {statsLoading ? "—" : pendingRequests}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">pending</p>
                  {!statsLoading && (
                    <p className="text-sm text-gray-500 mt-4 leading-relaxed border-t border-gray-100 pt-4">
                      Managed service activations
                    </p>
                  )}
                </div>
                <div className="relative bg-rose-50 p-3.5 rounded-xl shrink-0 group-hover:bg-rose-100 transition-colors" aria-hidden>
                  <AlertCircle className="h-7 w-7 text-rose-600" />
                  {pendingRequests > 0 && (
                    <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-600 px-1 text-xs font-bold text-white ring-2 ring-white">
                      {pendingRequests}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pending managed service approvals */}
        {(loadingPending || pendingManagedServices.length > 0) && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Pending Managed Service Requests ({pendingManagedServices.length})
              </h2>
              <p className="text-sm text-gray-500 mt-1">Approve to activate and start billing; reject to keep client as Dashboard Only. Agency will be notified.</p>
            </div>
            <div className="p-6">
              {loadingPending ? (
                <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading…
                </div>
              ) : pendingManagedServices.length === 0 ? (
                <div className="text-center py-6 text-gray-500">No pending requests</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-200">
                        <th className="pb-3 pr-4">Agency</th>
                        <th className="pb-3 pr-4">Client</th>
                        <th className="pb-3 pr-4">Package</th>
                        <th className="pb-3 pr-4">Price</th>
                        <th className="pb-3 pr-4">Start date</th>
                        <th className="pb-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pendingManagedServices.map((ms) => (
                        <tr key={ms.id} className="hover:bg-gray-50">
                          <td className="py-3 pr-4 font-medium text-gray-900">{ms.agencyName}</td>
                          <td className="py-3 pr-4 text-gray-700">{ms.clientName}</td>
                          <td className="py-3 pr-4 text-gray-700">{ms.packageName}</td>
                          <td className="py-3 pr-4 text-gray-700">${(ms.monthlyPrice / 100).toFixed(2)}/mo</td>
                          <td className="py-3 pr-4 text-gray-600">{format(new Date(ms.startDate), "MMM d, yyyy")}</td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  setApprovingId(ms.id);
                                  try {
                                    await api.patch(`/agencies/managed-services/${ms.id}/approve`);
                                    toast.success(`${ms.clientName} approved; agency notified, billing started.`);
                                    setPendingManagedServices((prev) => prev.filter((s) => s.id !== ms.id));
                                    dispatch(fetchClients() as any);
                                    const res = await api.get("/seo/super-admin/dashboard");
                                    setStats(res.data);
                                  } catch (e: any) {
                                    toast.error(e?.response?.data?.message || "Failed to approve");
                                  } finally {
                                    setApprovingId(null);
                                  }
                                }}
                                disabled={approvingId !== null || rejectingId !== null}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-60"
                              >
                                {approvingId === ms.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  setRejectingId(ms.id);
                                  try {
                                    await api.patch(`/agencies/managed-services/${ms.id}/reject`);
                                    toast.success(`Request rejected; agency notified.`);
                                    setPendingManagedServices((prev) => prev.filter((s) => s.id !== ms.id));
                                    dispatch(fetchClients() as any);
                                    const res = await api.get("/seo/super-admin/dashboard");
                                    setStats(res.data);
                                  } catch (e: any) {
                                    toast.error(e?.response?.data?.message || "Failed to reject");
                                  } finally {
                                    setRejectingId(null);
                                  }
                                }}
                                disabled={approvingId !== null || rejectingId !== null}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
                              >
                                {rejectingId === ms.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Upcoming tasks */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Upcoming tasks</h2>
            <button
              type="button"
              onClick={() => navigate("/agency/tasks")}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium inline-flex items-center gap-1"
            >
              View all
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="p-6">
            {upcomingTasksLoading ? (
              <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading…
              </div>
            ) : upcomingTasks.length === 0 ? (
              <div className="text-center py-6 text-gray-500">No upcoming tasks</div>
            ) : (
              <ul className="space-y-3">
                {upcomingTasks.map((task) => {
                  const dueStr = task.dueDate
                    ? format(new Date(task.dueDate), "MMM d, yyyy")
                    : "—";
                  const statusLabel =
                    task.status === "TODO"
                      ? "Pending"
                      : task.status === "IN_PROGRESS"
                        ? "In progress"
                        : task.status === "REVIEW"
                          ? "In review"
                          : task.status === "NEEDS_APPROVAL"
                            ? "Needs Approval"
                            : task.status === "DONE"
                              ? "Completed"
                              : task.status;
                  const statusClass =
                    task.status === "DONE"
                      ? "bg-gray-100 text-gray-800"
                      : task.status === "IN_PROGRESS"
                        ? "bg-blue-100 text-blue-800"
                        : task.status === "REVIEW"
                          ? "bg-amber-100 text-amber-800"
                          : task.status === "NEEDS_APPROVAL"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-gray-100 text-gray-700";
                  return (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => navigate("/agency/tasks")}
                        className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                      >
                        <div className="min-w-0 flex-1 flex items-center gap-3">
                          <div className="bg-primary-50 p-2 rounded-lg shrink-0">
                            <ListTodo className="h-4 w-4 text-primary-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">
                              {task.title || "Untitled"}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {task.client?.name || task.client?.domain || "No client"}
                              {dueStr !== "—" ? ` · Due ${dueStr}` : ""}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 px-2 py-0.5 text-xs font-medium rounded-full ${statusClass}`}
                        >
                          {statusLabel}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Financial Overview */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-6 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Financial Overview</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchFinancial()}
                disabled={financialLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${financialLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => navigate("/superadmin/financial-overview")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700"
              >
                View full report
              </button>
            </div>
          </div>
          <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Monthly Recurring Revenue</h3>
              {financialLoading ? (
                <div className="flex items-center gap-2 text-gray-500 py-8">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading…
                </div>
              ) : mrrData ? (
                <>
                  <p className="text-3xl font-bold text-gray-900 mb-4">
                    {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(mrrData.totalMrr)}
                  </p>
                  <ul className="space-y-2">
                    {mrrData.segments.slice(0, 8).map((seg, i) => (
                      <li key={i} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">{seg.label}</span>
                        <span className="font-medium text-gray-900">
                          {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(seg.mrr)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-gray-500 py-4">Stripe not configured or no data.</p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Subscription Activity (Last 30 Days)</h3>
              {financialLoading ? (
                <div className="flex items-center gap-2 text-gray-500 py-8">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading…
                </div>
              ) : activityData ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                    <span className="text-sm text-gray-700">New MRR added</span>
                    <span className="font-semibold text-green-700">
                      +{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(activityData.newMrrAdded)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                    <span className="text-sm text-gray-700">Churned MRR</span>
                    <span className="font-semibold text-red-700">
                      -{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(activityData.churnedMrr)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-100 rounded-lg">
                    <span className="text-sm text-gray-700">Net change</span>
                    <span className={`font-semibold ${activityData.netChange >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {activityData.netChange >= 0 ? "+" : ""}
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(activityData.netChange)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500 py-4">Stripe not configured or no data.</p>
              )}
            </div>
          </div>
        </div>

        {/* Recent Agencies and Clients */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Agencies */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Recent Agencies</h2>
                <button
                  onClick={() => navigate("/agency/agencies")}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  View All
                </button>
              </div>
            </div>
            <div className="p-6">
              {agenciesLoading ? (
                <div className="text-center py-8 text-gray-500">Loading agencies...</div>
              ) : recentAgencies.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No agencies yet</div>
              ) : (
                <div className="space-y-4">
                  {recentAgencies.map((agency) => (
                    <div
                      key={agency.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                      onClick={() => navigate("/agency/agencies")}
                    >
                      <div className="flex items-center space-x-3">
                        <div className="bg-primary-100 p-2 rounded-lg">
                          <Building2 className="h-4 w-4 text-primary-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{agency.name}</p>
                          <p className="text-sm text-gray-500">
                            {agency.clientCount ?? 0} client{(agency.clientCount ?? 0) !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">
                          {format(new Date(agency.createdAt), "MMM dd, yyyy")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Clients */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Recent Clients</h2>
                <button
                  onClick={() => navigate("/agency/clients")}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  View All
                </button>
              </div>
            </div>
            <div className="p-6">
              {clientsLoading ? (
                <div className="text-center py-8 text-gray-500">Loading clients...</div>
              ) : recentClients.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No clients yet</div>
              ) : (
                <div className="space-y-4">
                  {recentClients.map((client) => {
                    const isArchived = client.status !== "ACTIVE";
                    const statusLabel = isArchived ? "Archived" : "Active";
                    const statusClass = isArchived
                      ? "bg-gray-100 text-gray-800"
                      : "bg-green-100 text-green-800";

                    return (
                    <div
                      key={client.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                      onClick={() => navigate("/agency/clients")}
                    >
                      <div className="flex items-center space-x-3">
                        <div className="bg-secondary-100 p-2 rounded-lg">
                          <Globe className="h-4 w-4 text-secondary-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{client.name}</p>
                          <p className="text-sm text-gray-500">{client.domain}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span
                          className={`px-2.5 py-1 text-xs font-semibold rounded-full ${statusClass}`}
                        >
                          {statusLabel}
                        </span>
                        <p className="text-xs text-gray-500 mt-1">
                          {format(new Date(client.createdAt), "MMM dd, yyyy")}
                        </p>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => navigate("/agency/agencies")}
              className="flex items-center space-x-3 p-4 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors text-left"
            >
              <Building2 className="h-5 w-5 text-primary-600" />
              <div>
                <p className="font-medium text-gray-900">Manage Agencies</p>
                <p className="text-sm text-gray-500">View and manage all agencies</p>
              </div>
            </button>
            <button
              onClick={() => navigate("/agency/clients")}
              className="flex items-center space-x-3 p-4 bg-secondary-50 rounded-lg hover:bg-secondary-100 transition-colors text-left"
            >
              <Users className="h-5 w-5 text-secondary-600" />
              <div>
                <p className="font-medium text-gray-900">Manage Clients</p>
                <p className="text-sm text-gray-500">View and manage all clients</p>
              </div>
            </button>
            <button
              onClick={() => navigate("/agency/team")}
              className="flex items-center space-x-3 p-4 bg-accent-50 rounded-lg hover:bg-accent-100 transition-colors text-left"
            >
              <Activity className="h-5 w-5 text-accent-600" />
              <div>
                <p className="font-medium text-gray-900">Manage Team</p>
                <p className="text-sm text-gray-500">View and manage team members</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default SuperAdminDashboard;
