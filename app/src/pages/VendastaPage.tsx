import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../store";
import { fetchClients, updateClient, deleteClient, Client } from "../store/slices/clientSlice";
import {
  Search,
  Table,
  List,
  Trash2,
  Edit,
  Building2,
  Eye,
  Share2,
  ArrowUp,
  ArrowDown,
  Store,
  ArrowLeft,
  X,
  Copy,
  ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "@/lib/api";
import ConfirmDialog from "../components/ConfirmDialog";

const VendastaPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { clients } = useSelector((state: RootState) => state.client);
  const { user } = useSelector((state: RootState) => state.auth);
  const [searchTerm, setSearchTerm] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [sortField, setSortField] = useState<"name" | "domain" | "industry">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; clientId: string | null }>({
    isOpen: false,
    clientId: null,
  });
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [openStatusId, setOpenStatusId] = useState("");
  const statusButtonRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    dispatch(fetchClients() as any);
  }, [dispatch]);

  // Close status dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
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

  const handleMoveBackToClients = async (client: Client) => {
    try {
      await dispatch(updateClient({ id: client.id, data: { vendasta: false } }) as any);
      toast.success(`${client.name} moved back to Clients successfully!`);
      dispatch(fetchClients() as any);
    } catch (error: any) {
      console.error("Failed to move client back:", error);
      toast.error(error?.response?.data?.message || "Failed to move client back");
    }
  };

  const handleViewClick = (client: Client) => {
    navigate(`/agency/clients/${client.id}`, { state: { client } });
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
      // Toast is handled by interceptor
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

  const handleEditClick = (client: Client) => {
    navigate(`/agency/clients/${client.id}`, { state: { client, edit: true } });
  };

  const isArchivedStatus = (status: string) => status !== "ACTIVE";
  const getStatusBadge = (status: string) =>
    isArchivedStatus(status) ? "bg-gray-100 text-gray-800" : "bg-green-100 text-green-800";
  const getStatusLabel = (status: string) => (isArchivedStatus(status) ? "Archived" : "Active");

  // Filter for vendasta clients only
  const vendastaClients = clients.filter((client) => client.vendasta === true);

  const handleSort = (field: "name" | "domain" | "industry") => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const filteredClients = vendastaClients
    .filter((client) => {
      if (!searchTerm) return true;
      const searchLower = searchTerm.toLowerCase();
      return (
        client.name.toLowerCase().includes(searchLower) ||
        client.domain.toLowerCase().includes(searchLower) ||
        (client.industry && client.industry.toLowerCase().includes(searchLower))
      );
    })
    .sort((a, b) => {
      let aValue: string;
      let bValue: string;

      if (sortField === "name") {
        aValue = a.name.toLowerCase();
        bValue = b.name.toLowerCase();
      } else if (sortField === "domain") {
        aValue = a.domain.toLowerCase();
        bValue = b.domain.toLowerCase();
      } else {
        // industry
        aValue = (a.industry || "").toLowerCase();
        bValue = (b.industry || "").toLowerCase();
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

  const totalCount = vendastaClients.length;
  const activeCount = vendastaClients.filter((m) => m.status === "ACTIVE").length;
  const archivedCount = vendastaClients.filter((m) => isArchivedStatus(m.status)).length;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Vendasta</h1>
          <p className="text-gray-600 mt-2">
            Manage your Vendasta clients and view their details
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Vendasta Clients</p>
              <p className="text-2xl font-bold text-primary-600">{totalCount}</p>
            </div>
            <Store className="h-8 w-8 text-primary-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Clients</p>
              <p className="text-2xl font-bold text-secondary-600">{activeCount}</p>
            </div>
            <Building2 className="h-8 w-8 text-secondary-600" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Archived Clients</p>
              <p className="text-2xl font-bold text-gray-900">{archivedCount}</p>
            </div>
            <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-semibold">
              A
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 mb-8">
        <div className="flex flex-row items-center justify-between gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search name, domain, industry..."
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
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort("name")}
                  >
                    <div className="flex items-center gap-2">
                      Name
                      {sortField === "name" && (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort("domain")}
                  >
                    <div className="flex items-center gap-2">
                      Domain
                      {sortField === "domain" && (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort("industry")}
                  >
                    <div className="flex items-center gap-2">
                      Industry
                      {sortField === "industry" && (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                      {searchTerm ? "No Vendasta clients found matching your search." : "No Vendasta clients yet. Move clients from the Clients page."}
                    </td>
                  </tr>
                ) : (
                  filteredClients.map((client) => (
                    <tr key={client.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-xs flex items-center gap-1">
                        <Store className="text-orange-600" size={18} />
                        {client.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        <a
                          className="text-sm text-gray-600 underline"
                          href={client.domain.startsWith("http") ? client.domain : `https://${client.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {client.domain}
                        </a>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs">{client.industry ?? "-"}</td>
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
                              {getStatusLabel(client.status)}
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
                                {[
                                  { label: "Active", value: "ACTIVE" },
                                  { label: "Archived", value: "REJECTED" },
                                ].map(({ label, value }) => (
                                  <div
                                    key={value}
                                    className="px-4 py-2 text-xs hover:bg-gray-100 cursor-pointer first:rounded-t-md last:rounded-b-md"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      await dispatch(updateClient({ id: client.id, data: { status: value } }) as any);
                                      setOpenStatusId("");
                                      toast.success("Client updated successfully!");
                                      dispatch(fetchClients() as any);
                                    }}
                                  >
                                    {label}
                                  </div>
                                ))}
                              </div>,
                              document.body
                            )}
                          </div>
                        ) : (
                          <span className={`px-2 py-1 text-xs font-bold rounded-full ${getStatusBadge(client.status)}`}>
                            {getStatusLabel(client.status)}
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
                          {user?.role === "SUPER_ADMIN" && (
                            <button
                              className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                              onClick={() => handleMoveBackToClients(client)}
                              title="Move Back to Clients"
                            >
                              <ArrowLeft className="h-4 w-4" />
                            </button>
                          )}
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredClients.length === 0 ? (
            <div className="col-span-full text-center py-12 text-gray-500">
              {searchTerm ? "No Vendasta clients found matching your search." : "No Vendasta clients yet. Move clients from the Clients page."}
            </div>
          ) : (
            filteredClients.map((client) => (
              <div
                key={client.id}
                className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Store className="text-orange-600" size={24} />
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{client.name}</h3>
                      <a
                        className="text-sm text-gray-600 underline"
                        href={client.domain.startsWith("http") ? client.domain : `https://${client.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {client.domain}
                      </a>
                    </div>
                  </div>
                </div>
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Industry:</span>
                    <span className="text-sm font-medium text-gray-900">{client.industry ?? "-"}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Status:</span>
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
                          {getStatusLabel(client.status)}
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
                            {[
                              { label: "Active", value: "ACTIVE" },
                              { label: "Archived", value: "REJECTED" },
                            ].map(({ label, value }) => (
                              <div
                                key={value}
                                className="px-4 py-2 text-xs hover:bg-gray-100 cursor-pointer first:rounded-t-md last:rounded-b-md"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await dispatch(updateClient({ id: client.id, data: { status: value } }) as any);
                                  setOpenStatusId("");
                                  toast.success("Client updated successfully!");
                                  dispatch(fetchClients() as any);
                                }}
                              >
                                {label}
                              </div>
                            ))}
                          </div>,
                          document.body
                        )}
                      </div>
                    ) : (
                      <span className={`px-2 py-1 text-xs font-bold rounded-full ${getStatusBadge(client.status)}`}>
                        {getStatusLabel(client.status)}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Created:</span>
                    <span className="text-sm font-medium text-gray-900">
                      {client.createdAt ? format(new Date(client.createdAt), "yyyy-MM-dd") : "-"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 pt-4 border-t border-gray-200">
                  <button
                    className="p-2 text-gray-400 hover:text-primary-600 transition-colors"
                    onClick={() => handleViewClick(client)}
                    title="View"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    className="p-2 text-gray-400 hover:text-primary-600 transition-colors"
                    onClick={() => handleShareClick(client)}
                    title="Share"
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                  {user?.role === "SUPER_ADMIN" && (
                    <button
                      className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                      onClick={() => handleMoveBackToClients(client)}
                      title="Move Back to Clients"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    className="p-2 text-gray-400 hover:text-primary-600 transition-colors"
                    onClick={() => handleEditClick(client)}
                    title="Edit"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                    onClick={() => handleDeleteClient(client.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, clientId: null })}
        onConfirm={confirmDeleteClient}
        title="Delete Client"
        message="Are you sure you want to delete this client? This action cannot be undone and all associated data will be permanently removed."
        confirmText="Delete"
        requireConfirmText="DELETE"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Share Client Dashboard</h3>
              <button
                onClick={() => setShowShareModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Share this link to give others access to view the client dashboard. The link will expire in 7 days.
            </p>
            <div className="flex items-center gap-2 mb-4">
              <input
                type="text"
                value={shareLink}
                readOnly
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
              />
              <button
                onClick={handleCopyLink}
                className="p-2 text-gray-600 hover:text-primary-600 transition-colors"
                title="Copy link"
              >
                <Copy className="h-5 w-5" />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowShareModal(false)}
                className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleOpenLink}
                className="flex-1 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Open Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendastaPage;
