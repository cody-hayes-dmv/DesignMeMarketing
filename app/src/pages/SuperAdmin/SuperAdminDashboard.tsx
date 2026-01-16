import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchAgencies } from "@/store/slices/agencySlice";
import { fetchClients } from "@/store/slices/clientSlice";
import Layout from "@/components/Layout";
import { Building2, Users, Activity, Globe, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

const SuperAdminDashboard = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { agencies, loading: agenciesLoading } = useSelector((state: RootState) => state.agency);
  const { clients, loading: clientsLoading } = useSelector((state: RootState) => state.client);

  useEffect(() => {
    dispatch(fetchAgencies() as any);
    dispatch(fetchClients() as any);
  }, [dispatch]);

  // Calculate metrics
  const totalAgencies = agencies.length;
  const totalClients = clients.length;
  const activeAgencies = agencies.filter(agency => agency.memberCount > 0).length;
  const activeClients = clients.filter(client => client.status === "ACTIVE").length;

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
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Super Admin Dashboard
          </h1>
          <p className="text-gray-600 mt-2">
            Overview of agencies, clients, and platform activity
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Agencies</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {agenciesLoading ? "..." : totalAgencies}
                </p>
                {!agenciesLoading && (
                  <p className="text-xs text-gray-500 mt-1">
                    {newAgenciesLast30Days} new in last 30 days
                  </p>
                )}
              </div>
              <div className="bg-primary-100 p-3 rounded-lg">
                <Building2 className="h-6 w-6 text-primary-600" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Agencies</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {agenciesLoading ? "..." : activeAgencies}
                </p>
                {!agenciesLoading && (
                  <p className="text-xs text-gray-500 mt-1">
                    {totalAgencies > 0 ? Math.round((activeAgencies / totalAgencies) * 100) : 0}% of total
                  </p>
                )}
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Clients</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {clientsLoading ? "..." : totalClients}
                </p>
                {!clientsLoading && (
                  <p className="text-xs text-gray-500 mt-1">
                    {newClientsLast30Days} new in last 30 days
                  </p>
                )}
              </div>
              <div className="bg-secondary-100 p-3 rounded-lg">
                <Users className="h-6 w-6 text-secondary-600" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Clients</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">
                  {clientsLoading ? "..." : activeClients}
                </p>
                {!clientsLoading && (
                  <p className="text-xs text-gray-500 mt-1">
                    {totalClients > 0 ? Math.round((activeClients / totalClients) * 100) : 0}% of total
                  </p>
                )}
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Activity className="h-6 w-6 text-blue-600" />
              </div>
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
                            {agency.memberCount} member{agency.memberCount !== 1 ? "s" : ""}
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
