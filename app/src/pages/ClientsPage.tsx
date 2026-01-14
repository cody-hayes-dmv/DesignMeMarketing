import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../store";
import { fetchClients, createClient, updateClient, deleteClient, Client } from "../store/slices/clientSlice";
import {
  Plus,
  Globe,
  Calendar,
  MoreVertical,
  Users,
  UserCheck,
  Mail,
  Ban,
  Search,
  Table,
  List,
  Trash2,
  Edit,
  Building2,
  Eye,
  Share2,
  X,
  Copy,
  ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "@/lib/api";
import ConfirmDialog from "../components/ConfirmDialog";

const ClientsPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate()
  const { clients } = useSelector(
    (state: RootState) => state.client
  );
  const { user } = useSelector((state: RootState) => state.auth);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Number>(0);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [openStatusId, setOpenStatusId] = useState("")
  const [enabled, setEnabled] = useState(false);
  const [clientForm, setClientForm] = useState({ 
    name: "", 
    domain: "",
    industry: "",
    targets: [] as string[]
  });
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const statusButtonRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    dispatch(fetchClients() as any);
  }, [dispatch]);

  // Close status dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      // Check if click is outside status dropdown button and dropdown menu
      const isClickOnDropdownButton = target.closest('.status-dropdown');
      const isClickOnDropdownMenu = target.closest('[data-status-dropdown-menu]');
      
      if (openStatusId && !isClickOnDropdownButton && !isClickOnDropdownMenu) {
        setOpenStatusId("");
      }
    };
    if (openStatusId) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openStatusId]);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await dispatch(createClient({ data: {
        name: clientForm.name,
        domain: clientForm.domain,
        industry: clientForm.industry || undefined,
        targets: clientForm.targets.length > 0 ? clientForm.targets : undefined,
      } }) as any);
      setClientForm({ name: "", domain: "", industry: "", targets: [] });
      setShowCreateModal(false);
      toast.success("Client created successfully! Please connect GA4 to view analytics data.");
      // Refresh clients list
      dispatch(fetchClients() as any);
    } catch (error: any) {
      console.error("Failed to create client:", error);
      // Toast is already shown by API interceptor
    }
  };

  const handleShareClick = async (client: Client) => {
    try {
      const res = await api.post(`/seo/share-link/${client.id}`);
      const token = res.data?.token;
      if (!token) {
        toast.error("Failed to generate share link");
        return;
      }
      const url = `${window.location.origin}/share/${encodeURIComponent(token)}`;
      setShareLink(url);
      setShowShareModal(true);
    } catch (error: any) {
      console.error("Share link error", error);
      // Toast is handled by interceptor; provide extra context here if desired
    }
  };

  const handleCopyLink = async () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareLink);
      toast.success("Link copied to clipboard!");
    } else {
      // Fallback
      prompt("Copy this shareable link:", shareLink);
    }
  };

  const handleOpenLink = () => {
    window.open(shareLink, "_blank");
  };

  const handleViewClick = (client: Client) => {
    navigate(`/agency/clients/${client.id}`, { state: { client } });
  };

  const handleEditClick = (client: Client) => {
    setSelectedClient(client);
    setMode(1);
    setOpen(true);
  };

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; clientId: string | null }>({
    isOpen: false,
    clientId: null,
  });

  const handleDeleteClient = async (id: string) => {
    setDeleteConfirm({ isOpen: true, clientId: id });
  };

  const confirmDeleteClient = async () => {
    if (!deleteConfirm.clientId) return;
    try {
      await dispatch(deleteClient(deleteConfirm.clientId) as any);
      toast.success("Client deleted successfully!");
      setDeleteConfirm({ isOpen: false, clientId: null });
    } catch (error: any) {
      console.error("Failed to delete client:", error);
      setDeleteConfirm({ isOpen: false, clientId: null });
    }
  };

  // Clients already have statistics from the database
  const modifiedClients = clients

  const getStatusBadge = (status: string) => {
    const styles = {
      ACTIVE: "bg-green-100 text-green-800",
      PENDING: "bg-yellow-100 text-yellow-800",
      REJECTED: "bg-gray-100 text-gray-800",
    };
    return styles[status as keyof typeof styles] || styles.ACTIVE;
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
          <p className="text-gray-600 mt-2">
            Manage your all clients and view their details
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2"
        >
          <Plus className="h-5 w-5" />
          <span>New Client</span>
        </button>
      </div>

      {/* Client */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Clients</p>
              <p className="text-2xl font-bold text-primary-600">
                {modifiedClients.length}
              </p>
            </div>
            <Users className="h-8 w-8 text-primary-600" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active</p>
              <p className="text-2xl font-bold text-secondary-600">
                {modifiedClients.filter((m) => m.status === "ACTIVE").length}
              </p>
            </div>
            <UserCheck className="h-8 w-8 text-secondary-600" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Pending</p>
              <p className="text-2xl font-bold text-accent-600">
                {modifiedClients.filter((m) => m.status === "PENDING").length}
              </p>
            </div>
            <Mail className="h-8 w-8 text-accent-600" />
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Rejected</p>
              <p className="text-2xl font-bold text-gray-900">
                {modifiedClients.filter((m) => m.status === "REJECTED").length}
              </p>
            </div>
            <Ban className="h-8 w-8 text-gray-600" />
          </div>
        </div>
      </div>


      {/* Filters */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 mb-8">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search name, domain, industry, targets ..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>
          {/* Select Mode (Table | List) */}
          <div className="flex flex-row items-center">
            <button
              onClick={() => setEnabled((prev) => !prev)}
              className={`relative w-16 h-9 rounded-full transition-colors duration-300 ${enabled ? "bg-blue-500" : "bg-gray-400"}`}
            >
              <span
                className={`absolute top-1 left-1 w-7 h-7 rounded-full flex items-center justify-center bg-white shadow-md transform transition-transform duration-300 ${enabled ? "translate-x-7" : "translate-x-0"}`}
              >
                {enabled ? (
                  <List className="w-4 h-4 text-yellow-500" />
                ) : (
                  <Table className="w-4 h-4 text-indigo-600" />
                )}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Client View */}
      {(!enabled) ? (
        <div className="bg-white rounded-xl border border-gray-200">
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
                {modifiedClients
                  .filter((client) => {
                    if (!searchTerm) return true;
                    const searchLower = searchTerm.toLowerCase();
                    return (
                      client.name.toLowerCase().includes(searchLower) ||
                      client.domain.toLowerCase().includes(searchLower) ||
                      (client.industry && client.industry.toLowerCase().includes(searchLower)) ||
                      (client.targets && client.targets.some((t: string) => t.toLowerCase().includes(searchLower)))
                    );
                  })
                  .map((client) => (
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
                      {user?.role === "SUPER_ADMIN" ? (
                        <div 
                          className="relative inline-block status-dropdown"
                          ref={(el) => {
                            if (el) {
                              statusButtonRefs.current[client.id] = el;
                            }
                          }}
                        >
                          <button
                            className={`px-2 py-1 text-xs font-bold rounded-full ${getStatusBadge(client.status)}`}
                            onClick={() => setOpenStatusId(openStatusId === client.id ? "" : client.id)}
                          >
                            {client.status}
                          </button>
                          {openStatusId === client.id && statusButtonRefs.current[client.id] && createPortal(
                            <div 
                              data-status-dropdown-menu
                              className="fixed bg-white border border-gray-200 rounded-md shadow-lg min-w-[120px]"
                              style={{
                                top: `${statusButtonRefs.current[client.id]!.getBoundingClientRect().bottom + 4}px`,
                                left: `${statusButtonRefs.current[client.id]!.getBoundingClientRect().left}px`,
                                zIndex: 9999
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {["ACTIVE", "PENDING", "REJECTED"].map((status) => (
                                <div
                                  key={status}
                                  className="px-4 py-2 text-xs hover:bg-gray-100 cursor-pointer first:rounded-t-md last:rounded-b-md"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await dispatch(updateClient({ id: client.id, data: { status } }) as any);
                                    setOpenStatusId("");
                                    toast.success("Status updated successfully!");
                                    dispatch(fetchClients() as any);
                                  }}
                                >
                                  {status}
                                </div>
                              ))}
                            </div>,
                            document.body
                          )}
                        </div>
                      ) : (
                      <span className={`px-2 py-1 text-xs font-bold rounded-full ${getStatusBadge(client.status)}`}>
                        {client.status}
                      </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs">
                      {client.createdAt ? format(new Date(client.createdAt), "yyyy-MM-dd") : "-"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs">
                      <div className="flex items-center space-x-2">
                        <button
                          className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                          onClick={() => handleViewClick(client)}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                          onClick={() => handleShareClick(client)}
                          title="Share"
                        >
                          <Share2 className="h-4 w-4" />
                        </button>
                        <button
                          className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                          onClick={() => handleEditClick(client)}
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                          onClick={() => handleDeleteClient(client.id)}
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modifiedClients
            .filter((client) => {
              if (!searchTerm) return true;
              const searchLower = searchTerm.toLowerCase();
              return (
                client.name.toLowerCase().includes(searchLower) ||
                client.domain.toLowerCase().includes(searchLower) ||
                (client.industry && client.industry.toLowerCase().includes(searchLower)) ||
                (client.targets && client.targets.some((t: string) => t.toLowerCase().includes(searchLower)))
              );
            })
            .map((client) => (
            <div
              key={client.id}
              className="bg-white rounded-xl border border-gray-200 hover:shadow-lg transition-shadow"
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="bg-primary-100 p-2 rounded-lg">
                      <Globe className="h-5 w-5 text-primary-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {client.name}
                      </h3>
                      <a
                        className="text-sm text-gray-600 underline"
                        href={client.domain.startsWith("http") ? client.domain : `https://${client.domain}`}
                        target="_blank" rel="noopener noreferrer"
                      >
                        {client.domain}
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {user?.role === "SUPER_ADMIN" ? (
                      <div className="relative inline-block status-dropdown">
                          <button
                            className={`px-4 py-1 text-xs font-medium rounded-full ${getStatusBadge(client.status)}`}
                          onClick={() => setOpenStatusId(openStatusId === client.id ? "" : client.id)}
                          >
                            {client.status}
                          </button>
                          {openStatusId === client.id && (
                          <div className="absolute mt-1 left-0 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-[120px]">
                              {["ACTIVE", "PENDING", "REJECTED"].map((status) => (
                                <div
                                  key={status}
                                className="px-4 py-2 text-xs hover:bg-gray-100 cursor-pointer first:rounded-t-md last:rounded-b-md"
                                  onClick={async () => {
                                    await dispatch(updateClient({ id: client.id, data: { status } }) as any);
                                    setOpenStatusId("");
                                  toast.success("Status updated successfully!");
                                  dispatch(fetchClients() as any);
                                  }}
                                >
                                  {status}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(
                            client.status
                          )}`}
                        >
                          {client.status}
                        </span>
                    )}
                    <button
                      className="p-1 text-gray-400 hover:text-primary-600"
                      onClick={() => handleShareClick(client)}
                      title="Share"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                    <button className="p-1 text-gray-400 hover:text-gray-600">
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-lg font-bold text-gray-900">
                      {client.keywords ?? 0}
                    </p>
                    <p className="text-xs text-gray-600">Keywords</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-lg font-bold text-gray-900">
                      {client.avgPosition ?? 0}
                    </p>
                    <p className="text-xs text-gray-600">Avg Position</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-lg font-bold text-secondary-600">
                      {client.topRankings ?? 0}
                    </p>
                    <p className="text-xs text-gray-600">Top 10</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-lg font-bold text-primary-600">
                      {client.traffic?.toLocaleString() ?? "0"}
                    </p>
                    <p className="text-xs text-gray-600">Traffic</p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm text-gray-500">
                  <div className="flex items-center space-x-1">
                    <Calendar className="h-4 w-4" />
                    <span>
                      Created {new Date(client.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button className="text-primary-600 hover:text-primary-700 font-medium">
                    View Details
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Client Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-6">
              Create New Client
            </h2>
            <form onSubmit={handleCreateClient} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Client Name
                </label>
                <input
                  type="text"
                  value={clientForm.name}
                  onChange={(e) =>
                    setClientForm({ ...clientForm, name: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Enter project name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Domain
                </label>
                <input
                  type="text"
                  value={clientForm.domain}
                  onChange={(e) =>
                    setClientForm({ ...clientForm, domain: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="example.com or https://example.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Industry (Optional)
                </label>
                <input
                  type="text"
                  value={clientForm.industry}
                  onChange={(e) =>
                    setClientForm({ ...clientForm, industry: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="e.g., E-commerce, Healthcare, Finance"
                />
              </div>
              <div className="flex space-x-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-gray-200 text-gray-800 py-3 px-6 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-primary-600 text-white py-3 px-6 rounded-lg hover:bg-primary-700 transition-colors"
                >
                  Create Client
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Link Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 max-w-2xl w-full mx-4">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-900">Share link generated</h2>
              <button
                onClick={() => {
                  setShowShareModal(false);
                  setShareLink("");
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-6">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 break-all">
                <a
                  href={shareLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:text-primary-700 underline text-sm"
                >
                  {shareLink}
                </a>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-3">
              <button
                onClick={handleCopyLink}
                className="bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2"
              >
                <Copy className="h-4 w-4" />
                <span>Copy</span>
              </button>
              <button
                onClick={handleOpenLink}
                className="bg-gray-100 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2"
              >
                <ExternalLink className="h-4 w-4" />
                <span>Open</span>
              </button>
              <button
                onClick={() => {
                  setShowShareModal(false);
                  setShareLink("");
                }}
                className="bg-gray-100 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, clientId: null })}
        onConfirm={confirmDeleteClient}
        title="Delete Client"
        message="Are you sure you want to delete this client? This action cannot be undone and all associated data will be permanently removed."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
};

export default ClientsPage;
