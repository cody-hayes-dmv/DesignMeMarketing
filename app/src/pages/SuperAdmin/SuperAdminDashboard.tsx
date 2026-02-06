import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchAgencies } from "@/store/slices/agencySlice";
import { fetchClients } from "@/store/slices/clientSlice";
import Layout from "@/components/Layout";
import { Building2, Users, Activity, Globe, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
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

  // Calculate metrics
  const totalAgencies = agencies.length;
  const totalClients = clients.length;
  const totalDashboards = totalClients;
  const activeAgencies = agencies.filter((agency) => (agency.clientCount ?? 0) > 0).length;
  const activeManagedClients = clients.filter(
    (client) => client.status === "ACTIVE" && isManagedServiceClient(client)
  ).length;
  const pendingRequests = clients.filter((client) => client.status === "PENDING").length;

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
    client => new Date(client.createdAt) >= thirtyDaysAgo
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
                    {agenciesLoading ? "—" : totalAgencies}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">agencies</p>
                  {!agenciesLoading && (
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
                    {agenciesLoading ? "—" : activeAgencies}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">active</p>
                  {!agenciesLoading && (
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
                    {clientsLoading ? "—" : activeManagedClients}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">active clients</p>
                  {!clientsLoading && (
                    <p className="text-sm text-gray-500 mt-4 leading-relaxed border-t border-gray-100 pt-4">
                      Managed services only
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
                    {clientsLoading ? "—" : totalDashboards}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">dashboards</p>
                  {!clientsLoading && (
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
                    {clientsLoading ? "—" : pendingRequests}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">pending</p>
                  {!clientsLoading && (
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
              <h2 className="text-lg font-semibold text-gray-900">Pending managed service approvals</h2>
              <p className="text-sm text-gray-500 mt-1">Approve to activate and start billing; agency will be notified.</p>
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
                        <th className="pb-3 text-right">Action</th>
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
                            <button
                              type="button"
                              onClick={async () => {
                                setApprovingId(ms.id);
                                try {
                                  await api.patch(`/agencies/managed-services/${ms.id}/approve`);
                                  toast.success(`${ms.clientName} approved; agency notified, billing started.`);
                                  setPendingManagedServices((prev) => prev.filter((s) => s.id !== ms.id));
                                  dispatch(fetchClients() as any);
                                } catch (e: any) {
                                  toast.error(e?.response?.data?.message || "Failed to approve");
                                } finally {
                                  setApprovingId(null);
                                }
                              }}
                              disabled={approvingId !== null}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-60"
                            >
                              {approvingId === ms.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                              Approve
                            </button>
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
