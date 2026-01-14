import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchAgencies, inviteAgency } from "@/store/slices/agencySlice";
import { Client, fetchClients } from "@/store/slices/clientSlice";
import Layout from "@/components/Layout";
import { Plus, Users, Building2, Mail, Trash2, Edit } from "lucide-react";
import { format } from "date-fns";

const SuperAdminDashboard = () => {
  const dispatch = useDispatch();
  const { agencies, loading } = useSelector((state: RootState) => state.agency);
  const { clients } = useSelector((state: RootState) => state.client);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Number>(0);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", name: "" });

  const getStatusBadge = (status: string) => {
    const styles = {
      ACTIVE: "bg-green-100 text-green-800",
      PENDING: "bg-yellow-100 text-yellow-800",
      REJECTED: "bg-gray-100 text-gray-800",
    };
    return styles[status as keyof typeof styles] || styles.ACTIVE;
  };

  useEffect(() => {
    dispatch(fetchAgencies() as any);
    dispatch(fetchClients() as any);
  }, [dispatch]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    await dispatch(inviteAgency(inviteForm) as any);
    setInviteForm({ email: "", name: "" });
    setShowInviteModal(false);
    dispatch(fetchAgencies() as any);
  };


  const handleEditClick = (client: Client) => {
    setSelectedClient(client);
    setMode(1);
    setOpen(true);
  };

  const handleDeleteTask = (id: string) => {
  }

  return (
    <Layout title="Admin Dashboard">
      <div className="space-y-8">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Super Admin Dashboard
            </h1>
            <p className="text-gray-600 mt-2">
              Manage agencies and oversee the platform
            </p>
          </div>
          <button
            onClick={() => setShowInviteModal(true)}
            className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
            disabled={loading}
          >
            {loading && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            )}
            <Plus className="h-5 w-5" />
            <span>Invite Agency</span>
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="bg-primary-100 p-3 rounded-lg">
                <Building2 className="h-6 w-6 text-primary-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {agencies.length}
                </p>
                <p className="text-gray-600">Total Agencies</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="bg-secondary-100 p-3 rounded-lg">
                <Users className="h-6 w-6 text-secondary-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {agencies.reduce(
                    (total, agency) => total + agency.memberCount,
                    0
                  )}
                </p>
                <p className="text-gray-600">Total Users</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="bg-accent-100 p-3 rounded-lg">
                <Mail className="h-6 w-6 text-accent-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">12</p>
                <p className="text-gray-600">Pending Invites</p>
              </div>
            </div>
          </div>
        </div>

        {/* Agencies Table */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Agencies</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Agency
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Subdomain
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Members
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {agencies.map((agency) => (
                  <tr key={agency.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {agency.name}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <a
                        className="text-sm text-gray-600 underline"
                        href={
                          agency.subdomain
                            ? `https://${agency.subdomain}.yourseodashboard.com`
                            : "-"
                        }
                        target="_blank" rel="noopener noreferrer"
                      >
                        {agency.subdomain
                          ? `${agency.subdomain}.yourseodashboard.com`
                          : "-"}
                      </a>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {agency.memberCount}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-600">
                        {new Date(agency.createdAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <button className="text-primary-600 hover:text-primary-900">
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Clients Table */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Clients</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Domain</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Industy</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Targets</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-xs flex items-center gap-1">
                      <Building2 className="text-blue-600" size={18} />
                      {client.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs">
                      <a
                        className="text-sm text-gray-600 underline"
                        href={client.domain.startsWith("http") ? client.domain : `https://${client.domain}`}
                        target="_blank" rel="noopener noreferrer"
                      >
                        {client.domain}
                      </a>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs">{client.industry ?? "-"}</td>
                    <td className="flex gap-1 px-6 py-4 whitespace-nowrap text-xs">
                      {client.targets?.map((target) => (
                        <div className="py-1 px-3 bg-blue-50 text-center rounded-full text-blue-600 font-semibold">{target}</div>
                      ))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-bold rounded-full ${getStatusBadge(client.status)}`}>
                        {client.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs">
                      {client.createdAt ? format(new Date(client.createdAt), "yyyy-MM-dd") : "-"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs">
                      <div className="flex items-center space-x-2">
                        <button
                          className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                          onClick={() => handleEditClick(client)}
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                          onClick={() => handleDeleteTask(client.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Invite Modal */}
        {showInviteModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4">
              <h2 className="text-xl font-bold text-gray-900 mb-6">
                Invite New Agency
              </h2>
              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Agency Name
                  </label>
                  <input
                    type="text"
                    value={inviteForm.name}
                    onChange={(e) =>
                      setInviteForm({ ...inviteForm, name: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={inviteForm.email}
                    onChange={(e) =>
                      setInviteForm({ ...inviteForm, email: e.target.value })
                    }
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    required
                  />
                </div>
                <div className="flex space-x-4 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowInviteModal(false)}
                    className="flex-1 bg-gray-200 text-gray-800 py-3 px-6 rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-primary-600 text-white py-3 px-6 rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    Send Invite
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default SuperAdminDashboard;
