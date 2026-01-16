import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { RootState } from "@/store";
import { fetchAgencies, createAgency } from "@/store/slices/agencySlice";
import { updateClient, deleteClient } from "@/store/slices/clientSlice";
import { Plus, Users, X, Eye, Building2 as BuildingIcon, Share2, Edit, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import api from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";

interface AgencyMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  agencyRole: string;
  verified: boolean;
  joinedAt: string;
}

interface AgencyClient {
  id: string;
  name: string;
  domain: string;
  industry: string | null;
  status: string;
  createdAt: string;
  keywords: number;
  avgPosition: number | null;
  topRankings: number;
  traffic: number;
}

const AgenciesPage = () => {
    const dispatch = useDispatch();
    const { agencies, loading } = useSelector((state: RootState) => state.agency);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showMembersModal, setShowMembersModal] = useState(false);
    const [showClientsModal, setShowClientsModal] = useState(false);
    const [selectedAgencyId, setSelectedAgencyId] = useState<string | null>(null);
    const [selectedAgencyName, setSelectedAgencyName] = useState<string>("");
    const [members, setMembers] = useState<AgencyMember[]>([]);
    const [clients, setClients] = useState<AgencyClient[]>([]);
    // Inline dropdown (accordion) per agency row
    const [expandedAgencyId, setExpandedAgencyId] = useState<string | null>(null);
    const [agencyClientsByAgencyId, setAgencyClientsByAgencyId] = useState<Record<string, AgencyClient[]>>({});
    const [loadingAgencyClientsId, setLoadingAgencyClientsId] = useState<string | null>(null);
    const [loadingMembers, setLoadingMembers] = useState(false);
    const [loadingClients, setLoadingClients] = useState(false);
    const [openStatusId, setOpenStatusId] = useState("");
    const [showShareModal, setShowShareModal] = useState(false);
    const [shareLink, setShareLink] = useState("");
    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; clientId: string | null }>({
        isOpen: false,
        clientId: null,
    });
    const statusButtonRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const navigate = useNavigate();
    const [createForm, setCreateForm] = useState({
        name: "",
        subdomain: "",
    });

    useEffect(() => {
        dispatch(fetchAgencies() as any);
    }, [dispatch]);

    const handleCreateAgency = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await dispatch(createAgency({
                name: createForm.name,
                subdomain: createForm.subdomain || undefined,
            }) as any);
            setCreateForm({ name: "", subdomain: "" });
            setShowCreateModal(false);
            toast.success("Agency created successfully!");
            dispatch(fetchAgencies() as any);
        } catch (error: any) {
            console.error("Failed to create agency:", error);
            // Toast is already shown by API interceptor
        }
    };

    const handleViewMembers = async (agencyId: string, agencyName: string) => {
        setSelectedAgencyId(agencyId);
        setSelectedAgencyName(agencyName);
        setShowMembersModal(true);
        setLoadingMembers(true);
        try {
            const response = await api.get(`/agencies/${agencyId}/members`);
            setMembers(response.data);
        } catch (error: any) {
            console.error("Failed to fetch members:", error);
            toast.error(error.response?.data?.message || "Failed to fetch members");
        } finally {
            setLoadingMembers(false);
        }
    };

    const handleViewClients = async (agencyId: string, agencyName: string) => {
        setSelectedAgencyId(agencyId);
        setSelectedAgencyName(agencyName);
        setShowClientsModal(true);
        setLoadingClients(true);
        try {
            const response = await api.get(`/agencies/${agencyId}/clients`);
            setClients(response.data);
        } catch (error: any) {
            console.error("Failed to fetch clients:", error);
            toast.error(error.response?.data?.message || "Failed to fetch clients");
        } finally {
            setLoadingClients(false);
        }
    };

    const refreshAgencyClientsCache = async (agencyId: string) => {
        const response = await api.get(`/agencies/${agencyId}/clients`);
        setAgencyClientsByAgencyId((prev) => ({ ...prev, [agencyId]: response.data }));
        return response.data as AgencyClient[];
    };

    const toggleAgencyClientsDropdown = async (agencyId: string, agencyName: string) => {
        // Collapse if already open
        if (expandedAgencyId === agencyId) {
            setExpandedAgencyId(null);
            return;
        }

        setExpandedAgencyId(agencyId);

        // If cached, don't refetch on every expand
        if (agencyClientsByAgencyId[agencyId]) return;

        setLoadingAgencyClientsId(agencyId);
        try {
            await refreshAgencyClientsCache(agencyId);
        } catch (error: any) {
            console.error("Failed to fetch clients:", error);
            toast.error(error.response?.data?.message || `Failed to fetch clients for ${agencyName}`);
        } finally {
            setLoadingAgencyClientsId(null);
        }
    };

    const getInitials = (name: string) => {
        return name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
    };

    const getRoleBadge = (role: string) => {
        const styles = {
            AGENCY: "bg-primary-100 text-primary-800",
            WORKER: "bg-secondary-100 text-secondary-800",
            ADMIN: "bg-accent-100 text-accent-800",
            SUPER_ADMIN: "bg-purple-100 text-purple-800",
        };
        return styles[role as keyof typeof styles] || "bg-gray-100 text-gray-800";
    };

    const getStatusBadge = (status: string) => {
        return status === "ACTIVE"
            ? "bg-green-100 text-green-800"
            : "bg-gray-100 text-gray-800";
    };

    const getStatusLabel = (status: string) => (status === "ACTIVE" ? "Active" : "Archived");

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

    const handleViewClick = (client: AgencyClient) => {
        navigate(`/agency/clients/${client.id}`, { state: { client } });
    };

    const handleShareClick = async (client: AgencyClient) => {
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
        }
    };

    const handleCopyLink = async () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(shareLink);
            toast.success("Link copied to clipboard!");
        } else {
            prompt("Copy this shareable link:", shareLink);
        }
    };

    const handleOpenLink = () => {
        window.open(shareLink, "_blank");
    };

    const handleEditClick = (client: AgencyClient) => {
        // Navigate to edit or open edit modal - for now just navigate to client page
        navigate(`/agency/clients/${client.id}`);
    };

    const handleDeleteClient = (id: string) => {
        setDeleteConfirm({ isOpen: true, clientId: id });
    };

    const confirmDeleteClient = async () => {
        if (!deleteConfirm.clientId) return;
        try {
            await dispatch(deleteClient(deleteConfirm.clientId) as any);
            toast.success("Client deleted successfully!");
            setDeleteConfirm({ isOpen: false, clientId: null });
            // Refresh clients list
            if (selectedAgencyId) {
                handleViewClients(selectedAgencyId, selectedAgencyName);
            }
            if (expandedAgencyId) {
                await refreshAgencyClientsCache(expandedAgencyId);
            }
        } catch (error: any) {
            console.error("Failed to delete client:", error);
            setDeleteConfirm({ isOpen: false, clientId: null });
        }
    };

    return (
        <div className="p-8">
            {/* Header */}
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Agencies</h1>
                    <p className="text-gray-600 mt-2">
                        Manage your all agencies and view their details
                    </p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2"
                >
                    <Plus className="h-5 w-5" />
                    <span>New Agency</span>
                </button>
            </div>

            {/* Agencies Table */}
            <div className="bg-white rounded-xl border border-gray-200">
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
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                                        Loading agencies...
                                    </td>
                                </tr>
                            ) : agencies.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                                        No agencies found. Create your first agency.
                                    </td>
                                </tr>
                            ) : (
                                agencies.map((agency) => (
                                <React.Fragment key={agency.id}>
                                    <tr
                                        className="hover:bg-gray-50 cursor-pointer"
                                        onClick={() => toggleAgencyClientsDropdown(agency.id, agency.name)}
                                        aria-expanded={expandedAgencyId === agency.id}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                                {expandedAgencyId === agency.id ? (
                                                    <ChevronDown className="h-4 w-4 text-gray-500" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4 text-gray-500" />
                                                )}
                                                {agency.name}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <a
                                                className="text-sm text-gray-600 underline"
                                                href={
                                                    agency.subdomain
                                                        ? `https://${agency.subdomain}.yourseodashboard.com`
                                                        : "#"
                                                }
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (!agency.subdomain) {
                                                        e.preventDefault();
                                                    }
                                                }}
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
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center space-x-2">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleViewMembers(agency.id, agency.name);
                                                    }}
                                                    className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                                    title="View Members"
                                                >
                                                    <Users className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleViewClients(agency.id, agency.name);
                                                    }}
                                                    className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                                    title="View Clients"
                                                >
                                                    <BuildingIcon className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>

                                    {expandedAgencyId === agency.id && (
                                        <tr className="bg-gray-50">
                                            <td colSpan={5} className="px-6 py-4">
                                                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                                                    {loadingAgencyClientsId === agency.id ? (
                                                        <div className="text-center py-6 text-gray-500 text-sm">
                                                            Loading clients...
                                                        </div>
                                                    ) : (agencyClientsByAgencyId[agency.id] ?? []).length === 0 ? (
                                                        <div className="text-center py-6 text-gray-500 text-sm">
                                                            No clients found for this agency.
                                                        </div>
                                                    ) : (
                                                        <div className="overflow-x-auto">
                                                            <table className="w-full">
                                                                <thead className="bg-gray-50">
                                                                    <tr>
                                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Domain</th>
                                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Industy</th>
                                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created Date</th>
                                                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="bg-white divide-y divide-gray-200">
                                                                    {(agencyClientsByAgencyId[agency.id] ?? []).map((client) => (
                                                                        <tr key={client.id} className="hover:bg-gray-50">
                                                                            <td className="px-6 py-4 whitespace-nowrap text-xs flex items-center gap-1">
                                                                                <BuildingIcon className="text-blue-600" size={18} />
                                                                                {client.name}
                                                                            </td>
                                                                            <td className="px-6 py-4 whitespace-nowrap text-xs">
                                                                                <a
                                                                                    className="text-sm text-gray-600 underline"
                                                                                    href={client.domain.startsWith("http") ? client.domain : `https://${client.domain}`}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                >
                                                                                    {client.domain}
                                                                                </a>
                                                                            </td>
                                                                            <td className="px-6 py-4 whitespace-nowrap text-xs">{client.industry ?? "-"}</td>
                                                                            <td className="px-6 py-4 whitespace-nowrap">
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
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setOpenStatusId(openStatusId === client.id ? "" : client.id);
                                                                                        }}
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
                                                                                                        try {
                                                                                                            await dispatch(updateClient({ id: client.id, data: { status: value } }) as any);
                                                                                                            setOpenStatusId("");
                                                                                                            toast.success("Status updated successfully!");
                                                                                                            await refreshAgencyClientsCache(agency.id);
                                                                                                        } catch (error: any) {
                                                                                                            console.error("Failed to update status:", error);
                                                                                                            setOpenStatusId("");
                                                                                                        }
                                                                                                    }}
                                                                                                >
                                                                                                    {label}
                                                                                                </div>
                                                                                            ))}
                                                                                        </div>,
                                                                                        document.body
                                                                                    )}
                                                                                </div>
                                                                            </td>
                                                                            <td className="px-6 py-4 whitespace-nowrap text-xs">
                                                                                {client.createdAt ? format(new Date(client.createdAt), "yyyy-MM-dd") : "-"}
                                                                            </td>
                                                                            <td className="px-6 py-4 whitespace-nowrap text-xs">
                                                                                <div className="flex items-center space-x-2">
                                                                                    <button
                                                                                        className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleViewClick(client);
                                                                                        }}
                                                                                    >
                                                                                        <Eye className="h-4 w-4" />
                                                                                    </button>
                                                                                    <button
                                                                                        className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleShareClick(client);
                                                                                        }}
                                                                                        title="Share"
                                                                                    >
                                                                                        <Share2 className="h-4 w-4" />
                                                                                    </button>
                                                                                    <button
                                                                                        className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleEditClick(client);
                                                                                        }}
                                                                                    >
                                                                                        <Edit className="h-4 w-4" />
                                                                                    </button>
                                                                                    <button
                                                                                        className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleDeleteClient(client.id);
                                                                                        }}
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
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Agency Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-gray-900">
                                Create New Agency
                            </h2>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <form onSubmit={handleCreateAgency} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Agency Name *
                                </label>
                                <input
                                    type="text"
                                    value={createForm.name}
                                    onChange={(e) =>
                                        setCreateForm({ ...createForm, name: e.target.value })
                                    }
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    required
                                    placeholder="Enter agency name"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Subdomain (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={createForm.subdomain}
                                    onChange={(e) =>
                                        setCreateForm({ ...createForm, subdomain: e.target.value })
                                    }
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    placeholder="subdomain"
                                />
                                <p className="mt-1 text-xs text-gray-500">
                                    Will be accessible at subdomain.yourseodashboard.com
                                </p>
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
                                    Create Agency
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* View Members Modal */}
            {showMembersModal && selectedAgencyId && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-8 max-w-4xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-gray-900">
                                Agency
                            </h2>
                            <button
                                onClick={() => {
                                    setShowMembersModal(false);
                                    setSelectedAgencyId(null);
                                    setSelectedAgencyName("");
                                    setMembers([]);
                                }}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        {loadingMembers ? (
                            <div className="text-center py-8 text-gray-500">
                                Loading members...
                            </div>
                        ) : members.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                No members found for this agency.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Member
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Role
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Agency Role
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Status
                                            </th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Joined
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {members.map((member) => (
                                            <tr key={member.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="flex items-center space-x-3">
                                                        <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                                                            <span className="text-sm font-medium text-primary-700">
                                                                {getInitials(member.name)}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-medium text-gray-900">
                                                                {member.name}
                                                            </div>
                                                            <div className="text-sm text-gray-500">
                                                                {member.email}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span
                                                        className={`px-2 py-1 text-xs font-medium rounded-full ${getRoleBadge(
                                                            member.role
                                                        )}`}
                                                    >
                                                        {member.role}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className="text-sm text-gray-900">
                                                        {member.agencyRole}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span
                                                        className={`px-2 py-1 text-xs font-medium rounded-full ${
                                                            member.verified
                                                                ? "bg-green-100 text-green-800"
                                                                : "bg-gray-100 text-gray-800"
                                                        }`}
                                                    >
                                                        {member.verified ? "Active" : "Inactive"}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div className="text-sm text-gray-600">
                                                        {new Date(member.joinedAt).toLocaleDateString()}
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

            {/* View Clients Modal */}
            {showClientsModal && selectedAgencyId && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-8 max-w-6xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-gray-900">
                                Agency Clients - {selectedAgencyName}
                            </h2>
                            <button
                                onClick={() => {
                                    setShowClientsModal(false);
                                    setSelectedAgencyId(null);
                                    setSelectedAgencyName("");
                                    setClients([]);
                                }}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        {loadingClients ? (
                            <div className="text-center py-8 text-gray-500">
                                Loading clients...
                            </div>
                        ) : clients.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                No clients found for this agency.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Domain</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Industy</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created Date</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {clients.map((client) => (
                                            <tr key={client.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap text-xs flex items-center gap-1">
                                                    <BuildingIcon className="text-blue-600" size={18} />
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
                                                                            try {
                                                                                await dispatch(updateClient({ id: client.id, data: { status: value } }) as any);
                                                                                setOpenStatusId("");
                                                                                toast.success("Status updated successfully!");
                                                                                if (selectedAgencyId) {
                                                                                    handleViewClients(selectedAgencyId, selectedAgencyName);
                                                                                }
                                                                            } catch (error: any) {
                                                                                console.error("Failed to update status:", error);
                                                                                setOpenStatusId("");
                                                                            }
                                                                        }}
                                                                    >
                                                                        {label}
                                                                    </div>
                                                                ))}
                                                            </div>,
                                                            document.body
                                                        )}
                                                    </div>
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
                        )}
                    </div>
                </div>
            )}

            {/* Share Modal */}
            {showShareModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-8 max-w-md w-full mx-4">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-gray-900">Share Client Dashboard</h2>
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
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Shareable Link
                                </label>
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="text"
                                        value={shareLink}
                                        readOnly
                                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm"
                                    />
                                    <button
                                        onClick={handleCopyLink}
                                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm"
                                    >
                                        Copy
                                    </button>
                                </div>
                            </div>
                            <button
                                onClick={handleOpenLink}
                                className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors text-sm"
                            >
                                Open Link
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            {deleteConfirm.isOpen && (
                <ConfirmDialog
                    isOpen={deleteConfirm.isOpen}
                    onClose={() => setDeleteConfirm({ isOpen: false, clientId: null })}
                    onConfirm={confirmDeleteClient}
                    title="Delete Client"
                    message="Are you sure you want to delete this client? This action cannot be undone."
                    confirmText="Delete"
                    requireConfirmText="DELETE"
                    variant="danger"
                />
            )}
        </div>
    )
}

export default AgenciesPage;
