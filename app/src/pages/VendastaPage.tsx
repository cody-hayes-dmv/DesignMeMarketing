import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../store";
import { fetchClients, updateClient, deleteClient, archiveClient, restoreClient, Client } from "../store/slices/clientSlice";
import { fetchAgencies } from "../store/slices/agencySlice";
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
  Users,
  Archive,
  RotateCcw,
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import api from "@/lib/api";
import ConfirmDialog from "../components/ConfirmDialog";
import AssignClientToAgencyModal from "../components/AssignClientToAgencyModal";

const VendastaPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { clients } = useSelector((state: RootState) => state.client);
  const { agencies } = useSelector((state: RootState) => state.agency);
  const { user } = useSelector((state: RootState) => state.auth);
  const [searchTerm, setSearchTerm] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [sortField, setSortField] = useState<"name" | "domain" | "industry">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [archiveConfirm, setArchiveConfirm] = useState<{ isOpen: boolean; clientId: string | null }>({
    isOpen: false,
    clientId: null,
  });
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState<{ isOpen: boolean; clientId: string | null }>({
    isOpen: false,
    clientId: null,
  });
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [openStatusId, setOpenStatusId] = useState("");
  const statusButtonRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [showAssignAgencyModal, setShowAssignAgencyModal] = useState(false);
  const [selectedClientForAgency, setSelectedClientForAgency] = useState<Client | null>(null);

  useEffect(() => {
    dispatch(fetchClients() as any);
  }, [dispatch]);

  useEffect(() => {
    dispatch(fetchAgencies() as any);
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

  const handleArchiveClient = (id: string) => {
    setArchiveConfirm({ isOpen: true, clientId: id });
  };

  const confirmArchiveClient = async () => {
    if (!archiveConfirm.clientId) return;
    try {
      await dispatch(archiveClient(archiveConfirm.clientId) as any);
      toast.success("Client archived successfully!");
      setArchiveConfirm({ isOpen: false, clientId: null });
    } catch (error: any) {
      console.error("Failed to archive client:", error);
      toast.error(error?.message || "Failed to archive client");
      setArchiveConfirm({ isOpen: false, clientId: null });
    }
  };

  const handlePermanentDeleteClient = (id: string) => {
    setPermanentDeleteConfirm({ isOpen: true, clientId: id });
  };

  const confirmPermanentDeleteClient = async () => {
    if (!permanentDeleteConfirm.clientId) return;
    try {
      await dispatch(deleteClient(permanentDeleteConfirm.clientId) as any);
      toast.success("Client permanently deleted!");
      setPermanentDeleteConfirm({ isOpen: false, clientId: null });
    } catch (error: any) {
      console.error("Failed to delete client:", error);
      toast.error(error?.message || "Failed to delete client");
      setPermanentDeleteConfirm({ isOpen: false, clientId: null });
    }
  };

  const handleRestoreClient = async (id: string) => {
    try {
      await dispatch(restoreClient(id) as any);
      toast.success("Client restored successfully!");
    } catch (error: any) {
      console.error("Failed to restore client:", error);
      toast.error(error?.message || "Failed to restore client");
    }
  };

  const isArchivedStatus = (status: string) => status === "ARCHIVED" || status === "REJECTED";

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
    navigate("/agency/clients", { state: { openEditClientId: client.id } });
  };

  const handleAssignToAgency = (client: Client) => {
    setSelectedClientForAgency(client);
    setShowAssignAgencyModal(true);
  };

  const handleAssignSuccess = () => {
    setSelectedClientForAgency(null);
    dispatch(fetchClients() as any);
  };

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
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gradient-to-r from-orange-50 via-amber-50 to-yellow-50 border-b-2 border-orange-200">
                  <th
                    className="px-6 py-3.5 text-left text-xs font-semibold text-orange-800 uppercase tracking-wider cursor-pointer hover:from-orange-100 hover:via-amber-100 select-none border-l-4 border-orange-400 first:border-l-0"
                    onClick={() => handleSort("name")}
                  >
                    <div className="flex items-center gap-2">
                      Name
                      {sortField === "name" && (
                        sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-orange-600" /> : <ArrowDown className="h-3.5 w-3.5 text-orange-600" />
                      )}
                    </div>
                  </th>
                  <th
                    className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider cursor-pointer hover:from-orange-100 select-none border-l-4 border-emerald-300"
                    onClick={() => handleSort("domain")}
                  >
                    <div className="flex items-center gap-2">
                      Domain
                      {sortField === "domain" && (
                        sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-emerald-600" /> : <ArrowDown className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Agency</th>
                  <th
                    className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider cursor-pointer hover:from-orange-100 select-none border-l-4 border-violet-300"
                    onClick={() => handleSort("industry")}
                  >
                    <div className="flex items-center gap-2">
                      Industry
                      {sortField === "industry" && (
                        sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-violet-600" /> : <ArrowDown className="h-3.5 w-3.5 text-violet-600" />
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Status</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Created Date</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500 bg-amber-50/50">
                      {searchTerm ? "No Vendasta clients found matching your search." : "No Vendasta clients yet. Move clients from the Clients page."}
                    </td>
                  </tr>
                ) : (
                  filteredClients.map((client, index) => (
                    <tr key={client.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-orange-50/40`}>
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        <div className="flex items-center gap-2 font-semibold text-gray-900">
                          <Store className="h-4 w-4 text-orange-500 shrink-0" />
                          {client.name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        <a
                          className="text-sm font-medium text-primary-600 hover:text-primary-700 underline underline-offset-1 decoration-primary-300 hover:decoration-primary-500 transition-colors"
                          href={client.domain.startsWith("http") ? client.domain : `https://${client.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {client.domain}
                        </a>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-amber-800/90">
                        {client.agencyNames?.length ? (
                          client.agencyNames.map((name, i) => (
                            <span key={name}>
                              {i > 0 && ", "}
                              <Link
                                to="/agency/agencies"
                                className="text-primary-600 hover:text-primary-700 underline font-medium"
                              >
                                {name}
                              </Link>
                            </span>
                          ))
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-violet-100 text-violet-800">
                          {client.industry ?? "-"}
                        </span>
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
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">
                        {client.createdAt ? format(new Date(client.createdAt), "yyyy-MM-dd") : "-"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs">
                        <div className="flex items-center gap-1">
                          <button
                            className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            onClick={() => handleViewClick(client)}
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            className="p-2 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                            onClick={() => handleShareClick(client)}
                            title="Share"
                          >
                            <Share2 className="h-4 w-4" />
                          </button>
                          {user?.role === "SUPER_ADMIN" && (
                            <button
                              className="p-2 rounded-lg text-gray-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                              onClick={() => handleAssignToAgency(client)}
                              title="Assign to Agency"
                            >
                              <Users className="h-4 w-4" />
                            </button>
                          )}
                          {user?.role === "SUPER_ADMIN" && (
                            <button
                              className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                              onClick={() => handleMoveBackToClients(client)}
                              title="Move Back to Clients"
                            >
                              <ArrowLeft className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                            onClick={() => handleEditClick(client)}
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          {isArchivedStatus(client.status) ? (
                            <>
                              <button
                                className="p-2 rounded-lg text-gray-500 hover:text-green-600 hover:bg-green-50 transition-colors"
                                onClick={() => handleRestoreClient(client.id)}
                                title="Restore"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                              <button
                                className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                                onClick={() => handlePermanentDeleteClient(client.id)}
                                title="Delete Permanently"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          ) : (
                            <button
                              className="p-2 rounded-lg text-gray-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                              onClick={() => handleArchiveClient(client.id)}
                              title="Archive"
                            >
                              <Archive className="h-4 w-4" />
                            </button>
                          )}
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
                      className="p-2 text-gray-400 hover:text-primary-600 transition-colors"
                      onClick={() => handleAssignToAgency(client)}
                      title="Assign to Agency"
                    >
                      <Users className="h-4 w-4" />
                    </button>
                  )}
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
                  {isArchivedStatus(client.status) ? (
                    <>
                      <button
                        className="p-2 text-gray-400 hover:text-green-600 transition-colors"
                        onClick={() => handleRestoreClient(client.id)}
                        title="Restore"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                        onClick={() => handlePermanentDeleteClient(client.id)}
                        title="Delete Permanently"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <button
                      className="p-2 text-gray-400 hover:text-amber-600 transition-colors"
                      onClick={() => handleArchiveClient(client.id)}
                      title="Archive"
                    >
                      <Archive className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={archiveConfirm.isOpen}
        onClose={() => setArchiveConfirm({ isOpen: false, clientId: null })}
        onConfirm={confirmArchiveClient}
        title="Archive Client"
        message="This client will be moved to the archive. All data fetching and billing will stop. You can restore it later."
        confirmText="Archive"
        cancelText="Cancel"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={permanentDeleteConfirm.isOpen}
        onClose={() => setPermanentDeleteConfirm({ isOpen: false, clientId: null })}
        onConfirm={confirmPermanentDeleteClient}
        title="Permanently Delete Client"
        message="Are you sure you want to permanently delete this client? This action cannot be undone and all data will be removed forever."
        confirmText="Delete Forever"
        requireConfirmText="DELETE"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Assign to Agency Modal */}
      {showAssignAgencyModal && selectedClientForAgency && (
        <AssignClientToAgencyModal
          open={showAssignAgencyModal}
          onClose={() => {
            setShowAssignAgencyModal(false);
            setSelectedClientForAgency(null);
          }}
          client={selectedClientForAgency}
          agencies={agencies}
          onAssignSuccess={handleAssignSuccess}
        />
      )}

      {/* Share Client Dashboard modal - same as Clients page */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden ring-2 ring-blue-200/80 max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 border-b-2 border-indigo-500/50">
              <h3 className="text-lg font-bold text-white drop-shadow-sm">Share Client Dashboard</h3>
              <button
                onClick={() => {
                  setShowShareModal(false);
                  setShareLink("");
                }}
                className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 bg-gradient-to-b from-slate-50/80 to-white space-y-4">
              <p className="text-sm text-gray-600 rounded-xl border-l-4 border-blue-500 bg-blue-50/60 px-4 py-3">
                Share this link to give others access to view the client dashboard. The link does not expire.
              </p>
              <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/60 p-3">
                <label className="block text-sm font-semibold text-emerald-800 mb-2">Share link</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={shareLink}
                    readOnly
                    className="flex-1 px-4 py-2.5 border-2 border-emerald-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="p-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                    title="Copy link"
                  >
                    <Copy className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t-2 border-gray-200 flex items-center gap-3 bg-gradient-to-r from-gray-50 to-slate-50">
              <button
                onClick={() => {
                  setShowShareModal(false);
                  setShareLink("");
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleOpenLink}
                className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md flex items-center justify-center gap-2"
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
