import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../store";
import { fetchClients, createClient, updateClient, deleteClient, Client } from "../store/slices/clientSlice";
import { fetchAgencies } from "../store/slices/agencySlice";
import {
  Plus,
  Globe,
  Calendar,
  MoreVertical,
  Users,
  UserCheck,
  UserPlus,
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
  ArrowUp,
  ArrowDown,
  Store,
  ArrowRight,
  LayoutDashboard,
  Clock,
  XCircle,
  Archive,
  FolderPlus,
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "@/lib/api";
import ConfirmDialog from "../components/ConfirmDialog";
import AssignClientToAgencyModal from "../components/AssignClientToAgencyModal";

const INDUSTRY_OPTIONS = [
  "Automotive Services",
  "Beauty and Personal Care",
  "Cleaning and Maintenance Services",
  "Construction and Contractors",
  "Dental",
  "E-commerce",
  "Education and Training",
  "Entertainment and Events",
  "Financial Services",
  "Fitness and Wellness",
  "Healthcare",
  "Home Services",
  "Hospitality and Lodging",
  "Insurance",
  "Legal Services",
  "Local Government or Municipality",
  "Logistics and Transportation",
  "Manufacturing",
  "Marketing and Advertising",
  "Nonprofit and Religious Organizations",
  "Other",
  "Professional Services",
  "Property Management",
  "Real Estate",
  "Restaurants and Food Services",
  "Retail",
  "Security Services",
  "Technology and IT Services",
  "Trades and Skilled Labor",
  "Travel and Tourism",
] as const;

type CampaignType = "" | "Local" | "National";

type ClientFormState = {
  // Existing core fields
  name: string;
  domain: string;
  industry: string;
  industryOther: string;

  // Business Information
  businessNiche: string;
  businessNicheOther: string;
  businessDescription: string;
  businessAddress: string;
  primaryLocationCity: string;
  primaryLocationState: string;
  serviceRadius: string;
  serviceAreasServed: string;
  phoneNumber: string;
  emailAddress: string;

  // Website Info
  loginUrl: string;
  loginUsername: string;
  loginPassword: string;

  // Campaign
  campaignType: CampaignType;

  // GBP Categories
  gbpPrimaryCategory: string;
  gbpSecondaryCategories: string;

  // Services
  primaryServicesList: string;
  secondaryServicesList: string;
  servicesMarkedPrimary: string;
  targetKeywordCount: string;

  // Keywords + location
  keywords: string;
  latitude: string;
  longitude: string;

  // SEO Roadmap (SUPER_ADMIN + SPECIALIST only)
  seoRoadmapStartMonth: string;
  pagesPerMonth: string;
  technicalHoursPerMonth: string;
  campaignDurationMonths: string;

  // SUPER_ADMIN only (Edit modal)
  totalKeywordsToTarget: string;
  seoRoadmapSection: string;
  managedServicePackage: string;
  serviceStartDate: string;
  clientStatus: string;
  canceledEndDate: string;
};

const BUSINESS_NICHE_OPTIONS = [
  "Health & Wellness",
  "Emergency Locksmith",
  "Legal Services",
  "Home Services",
  "Retail",
  "Restaurants",
  "Financial Services",
  "Real Estate",
  "Professional Services",
  "Automotive",
  "Beauty & Personal Care",
  "Other",
] as const;

const SERVICE_RADIUS_OPTIONS = [
  "5 miles",
  "10 miles",
  "15 miles",
  "20 miles",
  "25 miles",
  "50 miles",
  "Statewide",
  "National",
  "Custom",
] as const;

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
];

const MANAGED_SERVICE_STATUS_OPTIONS = [
  { value: "DASHBOARD_ONLY", label: "Dashboard Only" },
  { value: "PENDING", label: "Pending" },
  { value: "ACTIVE", label: "Active" },
  { value: "CANCELED", label: "Canceled" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "ARCHIVED", label: "Archived" },
] as const;

const MANAGED_SERVICE_PACKAGE_OPTIONS = [
  { value: "foundation", label: "SEO Essentials + Automation ($750/mo)" },
  { value: "growth", label: "Growth & Automation ($1,500/mo)" },
  { value: "domination", label: "Authority Builder ($3,000/mo)" },
  { value: "market_domination", label: "Market Domination ($5,000/mo)" },
  { value: "custom", label: "Custom ($5,000+/mo)" },
] as const;

const EMPTY_CLIENT_FORM: ClientFormState = {
  name: "",
  domain: "",
  industry: "",
  industryOther: "",
  businessNiche: "",
  businessNicheOther: "",
  businessDescription: "",
  businessAddress: "",
  primaryLocationCity: "",
  primaryLocationState: "",
  serviceRadius: "",
  serviceAreasServed: "",
  phoneNumber: "",
  emailAddress: "",
  loginUrl: "",
  loginUsername: "",
  loginPassword: "",
  campaignType: "",
  gbpPrimaryCategory: "",
  gbpSecondaryCategories: "",
  primaryServicesList: "",
  secondaryServicesList: "",
  servicesMarkedPrimary: "",
  targetKeywordCount: "",
  keywords: "",
  latitude: "",
  longitude: "",
  seoRoadmapStartMonth: "",
  pagesPerMonth: "",
  technicalHoursPerMonth: "",
  campaignDurationMonths: "",
  totalKeywordsToTarget: "",
  seoRoadmapSection: "",
  managedServicePackage: "",
  serviceStartDate: "",
  clientStatus: "",
  canceledEndDate: "",
};

const ClientsPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate()
  const { clients } = useSelector(
    (state: RootState) => state.client
  );
  const { agencies } = useSelector((state: RootState) => state.agency);
  const { user } = useSelector((state: RootState) => state.auth);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [openStatusId, setOpenStatusId] = useState("")
  const [enabled, setEnabled] = useState(false);
  type ClientListFilter = "active" | "total" | "pending" | "dashboard_only" | "canceled" | "archived" | "included";
  const [statusFilter, setStatusFilter] = useState<ClientListFilter>("active");
  const [includedClientIds, setIncludedClientIds] = useState<Set<string>>(new Set());
  const [clientForm, setClientForm] = useState<ClientFormState>(EMPTY_CLIENT_FORM);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [showAssignAgencyModal, setShowAssignAgencyModal] = useState(false);
  const [selectedClientForAgency, setSelectedClientForAgency] = useState<Client | null>(null);
  const statusButtonRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cardMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [openCardMenuId, setOpenCardMenuId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<"name" | "domain" | "industry">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [agencyMe, setAgencyMe] = useState<{ isBusinessTier?: boolean; maxDashboards?: number | null } | null>(null);
  const [dashboardLimit, setDashboardLimit] = useState<{ used: number; limit: number } | null>(null);
  const [approvingClientId, setApprovingClientId] = useState<string | null>(null);
  const [rejectingClientId, setRejectingClientId] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchClients() as any);
    if (user?.role === "SUPER_ADMIN") {
      dispatch(fetchAgencies() as any);
    }
  }, [dispatch, user?.role]);

  useEffect(() => {
    if (user?.role === "AGENCY" || user?.role === "ADMIN") {
      api.get("/agencies/me").then((r) => setAgencyMe(r.data)).catch(() => setAgencyMe(null));
      api.get("/seo/agency/subscription").then((r) => {
        const u = r.data?.usage?.clientDashboards;
        if (u) setDashboardLimit({ used: u.used, limit: u.limit });
      }).catch(() => setDashboardLimit(null));
    } else {
      setAgencyMe(null);
      setDashboardLimit(null);
    }
  }, [user?.role]);

  // Fetch included clients count for SUPER_ADMIN (Included Dashboards metric)
  useEffect(() => {
    if (user?.role !== "SUPER_ADMIN") return;
    const fetchIncluded = () => {
      api
        .get<string[]>("/agencies/included-clients/ids")
        .then((r) => {
          const data = Array.isArray(r.data) ? r.data : [];
          setIncludedClientIds(new Set(data));
        })
        .catch(() => setIncludedClientIds(new Set()));
    };
    fetchIncluded();
    const handler = () => fetchIncluded();
    window.addEventListener("included-clients-changed", handler);
    return () => window.removeEventListener("included-clients-changed", handler);
  }, [user?.role]);

  const canSeeSeoRoadmapFields = user?.role === "SUPER_ADMIN" || user?.role === "SPECIALIST";
  /** Agency panel: show only Sections A–F (no keywords allocation, lat/long, roadmap, etc.) */
  const isAgencyCreateForm = user?.role === "AGENCY" || user?.role === "ADMIN";

  const parseKeywordsText = (raw: string): string[] => {
    return String(raw || "")
      .split(/\r?\n|,/g)
      .map((s) => s.trim())
      .filter(Boolean);
  };

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

      // Close card menu when clicking outside
      const isClickOnCardMenuButton = target.closest('.card-menu-button');
      const isClickOnCardMenu = target.closest('[data-card-menu]');
      if (openCardMenuId && !isClickOnCardMenuButton && !isClickOnCardMenu) {
        setOpenCardMenuId(null);
      }
    };
    if (openStatusId || openCardMenuId) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openStatusId, openCardMenuId]);

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();

    const selectedIndustry = clientForm.industry === "Other"
      ? clientForm.industryOther.trim()
      : clientForm.industry.trim();

    if (!selectedIndustry) {
      toast.error("Please select an industry.");
      return;
    }

    const selectedBusinessNiche = clientForm.businessNiche === "Other"
      ? clientForm.businessNicheOther.trim()
      : (clientForm.businessNiche || "").trim();

    if (isAgencyCreateForm && !selectedBusinessNiche) {
      toast.error("Please select or enter a business niche.");
      return;
    }

    try {
      let domain = (clientForm.domain || "").trim();
      if (domain && !/^https?:\/\//i.test(domain)) {
        domain = `https://${domain}`;
      }

      const targets = isAgencyCreateForm ? [] : parseKeywordsText(clientForm.keywords);
      const accountInfo: Record<string, any> = isAgencyCreateForm
        ? {
            businessNiche: selectedBusinessNiche,
            businessDescription: clientForm.businessDescription || "",
            businessAddress: clientForm.businessAddress || "",
            primaryLocationCity: clientForm.primaryLocationCity || "",
            primaryLocationState: clientForm.primaryLocationState || "",
            serviceRadius: clientForm.serviceRadius || "",
            serviceAreasServed: clientForm.serviceAreasServed || "",
            phoneNumber: clientForm.phoneNumber || "",
            emailAddress: clientForm.emailAddress || "",
            campaignType: clientForm.campaignType || "",
            gbpPrimaryCategory: clientForm.gbpPrimaryCategory || "",
            gbpSecondaryCategories: clientForm.gbpSecondaryCategories || "",
          }
        : {
            businessNiche: clientForm.businessNiche || "",
            businessDescription: clientForm.businessDescription || "",
            businessAddress: clientForm.businessAddress || "",
            primaryLocationCity: clientForm.primaryLocationCity || "",
            primaryLocationState: clientForm.primaryLocationState || "",
            serviceRadius: clientForm.serviceRadius || "",
            serviceAreasServed: clientForm.serviceAreasServed || "",
            phoneNumber: clientForm.phoneNumber || "",
            emailAddress: clientForm.emailAddress || "",
            campaignType: clientForm.campaignType || "",
            gbpPrimaryCategory: clientForm.gbpPrimaryCategory || "",
            gbpSecondaryCategories: clientForm.gbpSecondaryCategories || "",
            primaryServicesList: clientForm.primaryServicesList || "",
            secondaryServicesList: clientForm.secondaryServicesList || "",
            servicesMarkedPrimary: clientForm.servicesMarkedPrimary || "",
            targetKeywordCount: clientForm.targetKeywordCount || "",
            latitude: clientForm.latitude || "",
            longitude: clientForm.longitude || "",
          };

      if (!isAgencyCreateForm && canSeeSeoRoadmapFields) {
        accountInfo.seoRoadmapStartMonth = clientForm.seoRoadmapStartMonth || "";
        accountInfo.pagesPerMonth = clientForm.pagesPerMonth || "";
        accountInfo.technicalHoursPerMonth = clientForm.technicalHoursPerMonth || "";
        accountInfo.campaignDurationMonths = clientForm.campaignDurationMonths || "";
      }

      await dispatch(createClient({ data: {
        name: clientForm.name.trim(),
        domain,
        industry: selectedIndustry,
        targets,
        loginUrl: clientForm.loginUrl || undefined,
        username: clientForm.loginUsername || undefined,
        password: clientForm.loginPassword || undefined,
        accountInfo,
      } }) as any);
      setClientForm(EMPTY_CLIENT_FORM);
      setShowCreateModal(false);
      toast.success(isAgencyCreateForm ? "Client created. You can add keywords and set up tracking." : "Client created successfully! Please connect GA4 to view analytics data.");
      dispatch(fetchClients() as any);
    } catch (error: any) {
      console.error("Failed to create client:", error);
      const data = error?.response?.data;
      if (data?.code === "TIER_LIMIT" && data?.limitType === "dashboards") {
        toast.error(data?.message || "Dashboard limit reached. Upgrade to add more.", { duration: 5000 });
      } else {
        toast.error(data?.message || "Failed to create client");
      }
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

  const handleAssignToAgency = (client: Client) => {
    setSelectedClientForAgency(client);
    setShowAssignAgencyModal(true);
  };

  const handleAssignSuccess = () => {
    setSelectedClientForAgency(null);
    dispatch(fetchClients() as any);
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

  const handleViewReportClick = (client: Client) => {
    navigate(`/agency/clients/${client.id}`, { state: { client, tab: "report" } });
  };

  const handleEditClick = (client: Client) => {
    setEditingClient(client);
    const currentIndustry = (client as any)?.industry ?? "";
    const industryIsKnown = INDUSTRY_OPTIONS.includes(currentIndustry as any);

    const info = safeParseObject((client as any)?.accountInfo);
    const rawTargets = (client as any)?.targets;
    let targetsArr: string[] = [];
    if (Array.isArray(rawTargets)) {
      targetsArr = rawTargets.map((s: any) => String(s));
    } else if (typeof rawTargets === "string") {
      try {
        const parsed = JSON.parse(rawTargets);
        if (Array.isArray(parsed)) targetsArr = parsed.map((s) => String(s));
      } catch {
        targetsArr = rawTargets.split(/\r?\n|,/g).map((s) => s.trim()).filter(Boolean);
      }
    }
    setClientForm({
      ...EMPTY_CLIENT_FORM,
      name: client.name ?? "",
      domain: client.domain ?? "",
      industry: currentIndustry ? (industryIsKnown ? String(currentIndustry) : "Other") : "",
      industryOther: currentIndustry && !industryIsKnown ? String(currentIndustry) : "",
      keywords: targetsArr.join("\n"),
      loginUrl: String((client as any)?.loginUrl ?? ""),
      loginUsername: String((client as any)?.username ?? ""),
      loginPassword: String((client as any)?.password ?? ""),
      businessNiche: (BUSINESS_NICHE_OPTIONS as readonly string[]).includes(String(info.businessNiche ?? "")) ? String(info.businessNiche ?? "") : "Other",
      businessNicheOther: (BUSINESS_NICHE_OPTIONS as readonly string[]).includes(String(info.businessNiche ?? "")) ? "" : String(info.businessNiche ?? ""),
      businessDescription: String(info.businessDescription ?? ""),
      businessAddress: String(info.businessAddress ?? ""),
      primaryLocationCity: String(info.primaryLocationCity ?? ""),
      primaryLocationState: String(info.primaryLocationState ?? ""),
      serviceRadius: String(info.serviceRadius ?? ""),
      serviceAreasServed: String(info.serviceAreasServed ?? ""),
      phoneNumber: String(info.phoneNumber ?? ""),
      emailAddress: String(info.emailAddress ?? ""),
      campaignType: (String(info.campaignType ?? "") as CampaignType) || "",
      gbpPrimaryCategory: String(info.gbpPrimaryCategory ?? ""),
      gbpSecondaryCategories: String(info.gbpSecondaryCategories ?? ""),
      primaryServicesList: String(info.primaryServicesList ?? ""),
      secondaryServicesList: String(info.secondaryServicesList ?? ""),
      servicesMarkedPrimary: String(info.servicesMarkedPrimary ?? ""),
      targetKeywordCount: String(info.targetKeywordCount ?? ""),
      latitude: String(info.latitude ?? ""),
      longitude: String(info.longitude ?? ""),
      seoRoadmapStartMonth: String(info.seoRoadmapStartMonth ?? ""),
      pagesPerMonth: String(info.pagesPerMonth ?? ""),
      technicalHoursPerMonth: String(info.technicalHoursPerMonth ?? ""),
      campaignDurationMonths: String(info.campaignDurationMonths ?? ""),
      totalKeywordsToTarget: String(info.totalKeywordsToTarget ?? ""),
      seoRoadmapSection: String(info.seoRoadmapSection ?? ""),
      managedServicePackage: String(info.managedServicePackage ?? ""),
      serviceStartDate: info.serviceStartDate ? String(info.serviceStartDate).slice(0, 10) : "",
      clientStatus: String((client as any).status ?? ""),
      canceledEndDate: (client as any).canceledEndDate ? String((client as any).canceledEndDate).slice(0, 10) : "",
    });
    setShowEditModal(true);
  };

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; clientId: string | null }>({
    isOpen: false,
    clientId: null,
  });

  const handleDeleteClient = async (id: string) => {
    setDeleteConfirm({ isOpen: true, clientId: id });
  };

  const handleMoveToVendasta = async (client: Client) => {
    try {
      await dispatch(updateClient({ id: client.id, data: { vendasta: true } }) as any);
      toast.success(`${client.name} moved to Vendasta successfully!`);
      dispatch(fetchClients() as any);
    } catch (error: any) {
      console.error("Failed to move client to Vendasta:", error);
      toast.error(error?.response?.data?.message || "Failed to move client to Vendasta");
    }
  };

  const handleApproveAndActivate = async (client: Client) => {
    const msId = (client as any).pendingManagedServiceId;
    setApprovingClientId(client.id);
    try {
      if (msId) {
        await api.patch(`/agencies/managed-services/${msId}/approve`);
        toast.success(`${client.name} approved; agency notified, billing started.`);
      } else {
        await dispatch(updateClient({ id: client.id, data: { status: "ACTIVE" } }) as any);
        toast.success(`${client.name} approved and activated.`);
      }
      dispatch(fetchClients() as any);
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to approve client";
      toast.error(message);
      dispatch(fetchClients() as any);
    } finally {
      setApprovingClientId(null);
    }
  };

  const handleRejectToDashboardOnly = async (client: Client) => {
    const msId = (client as any).pendingManagedServiceId;
    setRejectingClientId(client.id);
    try {
      if (msId) {
        await api.patch(`/agencies/managed-services/${msId}/reject`);
        toast.success(`Request rejected; agency notified.`);
      } else {
        await dispatch(updateClient({ id: client.id, data: { status: "DASHBOARD_ONLY" } }) as any);
        toast.success(`${client.name} set to Dashboard Only.`);
      }
      dispatch(fetchClients() as any);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to reject client");
      dispatch(fetchClients() as any);
    } finally {
      setRejectingClientId(null);
    }
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

  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;

    const selectedIndustry = clientForm.industry === "Other"
      ? clientForm.industryOther.trim()
      : clientForm.industry.trim();

    if (!selectedIndustry) {
      toast.error("Please select an industry.");
      return;
    }

    try {
      const targets = parseKeywordsText(clientForm.keywords);
      const selectedBusinessNicheEdit = clientForm.businessNiche === "Other" ? clientForm.businessNicheOther.trim() : (clientForm.businessNiche || "").trim();
      const accountInfo: Record<string, any> = {
        businessNiche: selectedBusinessNicheEdit,
        businessDescription: clientForm.businessDescription || "",
        businessAddress: clientForm.businessAddress || "",
        primaryLocationCity: clientForm.primaryLocationCity || "",
        primaryLocationState: clientForm.primaryLocationState || "",
        serviceRadius: clientForm.serviceRadius || "",
        serviceAreasServed: clientForm.serviceAreasServed || "",
        phoneNumber: clientForm.phoneNumber || "",
        emailAddress: clientForm.emailAddress || "",
        campaignType: clientForm.campaignType || "",
        gbpPrimaryCategory: clientForm.gbpPrimaryCategory || "",
        gbpSecondaryCategories: clientForm.gbpSecondaryCategories || "",
        primaryServicesList: clientForm.primaryServicesList || "",
        secondaryServicesList: clientForm.secondaryServicesList || "",
        servicesMarkedPrimary: clientForm.servicesMarkedPrimary || "",
        targetKeywordCount: clientForm.targetKeywordCount || "",
        latitude: clientForm.latitude || "",
        longitude: clientForm.longitude || "",
      };

      if (canSeeSeoRoadmapFields) {
        accountInfo.seoRoadmapStartMonth = clientForm.seoRoadmapStartMonth || "";
        accountInfo.pagesPerMonth = clientForm.pagesPerMonth || "";
        accountInfo.technicalHoursPerMonth = clientForm.technicalHoursPerMonth || "";
        accountInfo.campaignDurationMonths = clientForm.campaignDurationMonths || "";
      }

      if (user?.role === "SUPER_ADMIN") {
        accountInfo.totalKeywordsToTarget = clientForm.totalKeywordsToTarget || "";
        accountInfo.seoRoadmapSection = clientForm.seoRoadmapSection || "";
        accountInfo.managedServicePackage = clientForm.managedServicePackage || "";
        accountInfo.serviceStartDate = clientForm.serviceStartDate || "";
      }

      const updatePayload: Record<string, any> = {
        name: clientForm.name,
        domain: clientForm.domain,
        industry: selectedIndustry,
        targets,
        loginUrl: clientForm.loginUrl,
        username: clientForm.loginUsername,
        password: clientForm.loginPassword,
        accountInfo,
      };
      if (user?.role === "SUPER_ADMIN") {
        if (clientForm.clientStatus) updatePayload.status = clientForm.clientStatus;
        if (clientForm.canceledEndDate !== undefined) updatePayload.canceledEndDate = clientForm.canceledEndDate || null;
      }

      await dispatch(updateClient({
        id: editingClient.id,
        data: updatePayload,
      }) as any);

      toast.success("Client updated successfully!");
      setShowEditModal(false);
      setEditingClient(null);
      setClientForm(EMPTY_CLIENT_FORM);
      dispatch(fetchClients() as any);
    } catch (error: any) {
      console.error("Failed to update client:", error);
      // Toast is already shown by API interceptor
    }
  };

  // Clients already have statistics from the database
  const modifiedClients = clients

  const isArchivedStatus = (status: string) => status === "ARCHIVED" || status === "REJECTED";
  const getStatusBadge = (status: string) => {
    if (status === "ACTIVE") return "bg-green-100 text-green-800";
    if (status === "PENDING") return "bg-amber-100 text-amber-800";
    if (status === "DASHBOARD_ONLY") return "bg-blue-100 text-blue-800";
    if (status === "CANCELED") return "bg-orange-100 text-orange-800";
    if (status === "SUSPENDED") return "bg-red-100 text-red-800";
    if (status === "ARCHIVED" || status === "REJECTED") return "bg-gray-100 text-gray-800";
    return "bg-gray-100 text-gray-800";
  };
  const getStatusLabel = (status: string) => {
    if (status === "ACTIVE") return "Active";
    if (status === "PENDING") return "Pending";
    if (status === "DASHBOARD_ONLY") return "Dashboard Only";
    if (status === "CANCELED") return "Canceled";
    if (status === "SUSPENDED") return "Suspended";
    if (status === "ARCHIVED" || status === "REJECTED") return "Archived";
    return status || "—";
  };

  const nonVendasta = modifiedClients.filter((c) => !c.vendasta);
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  // Active Clients = all clients with status ACTIVE (includes non-Vendasta and Vendasta active clients)
  const activeCount = modifiedClients.filter((m) => m.status === "ACTIVE").length;
  const totalCount = modifiedClients.length;
  const pendingCount = nonVendasta.filter((m) => m.status === "PENDING").length;
  const dashboardOnlyCount = nonVendasta.filter((m) => m.status === "DASHBOARD_ONLY").length;
  const canceledCount = nonVendasta.filter((m) => m.status === "CANCELED").length;
  const archivedCount = nonVendasta.filter((m) => isArchivedStatus(m.status)).length;
  const includedCount = isSuperAdmin ? includedClientIds.size : 0;

  const handleSort = (field: "name" | "domain" | "industry") => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  /** Service package label: prefer managedServicePackage from API, else accountInfo. */
  const getServicePackageLabel = (client: Client): string => {
    const pkg = (client as any).managedServicePackage;
    if (pkg && typeof pkg === "string") {
      const id = pkg.toLowerCase().replace(/\s+/g, "_");
      if (id === "foundation") return "SEO Essentials + Automation";
      if (id === "growth") return "Growth & Automation";
      if (id === "domination") return "Authority Builder";
      if (id === "market_domination") return "Market Domination";
      if (id === "custom") return "Custom";
      return pkg.charAt(0).toUpperCase() + pkg.slice(1).replace(/_/g, " ");
    }
    const raw = client.accountInfo;
    if (!raw) return "None";
    const obj = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : raw;
    const pkgAlt = (obj?.servicePackage ?? obj?.managedTier ?? obj?.stripePriceId ?? "").toString().toLowerCase();
    if (pkgAlt.includes("foundation")) return "SEO Essentials + Automation";
    if (pkgAlt.includes("growth")) return "Growth & Automation";
    if (pkgAlt.includes("market_domination") || (pkgAlt.includes("market") && pkgAlt.includes("domination"))) return "Market Domination";
    if (pkgAlt.includes("domination")) return "Authority Builder";
    if (pkgAlt.includes("custom")) return "Custom";
    return "None";
  };

  const filteredClients = modifiedClients
    .filter((client) => {
      // For "Active", "Total", and "Included", include Vendasta clients; for other filters show only non-Vendasta
      if (statusFilter !== "total" && statusFilter !== "active" && statusFilter !== "included" && client.vendasta) return false;
      if (statusFilter === "active") {
        return client.status === "ACTIVE";
      }
      if (statusFilter === "total") return true;
      if (statusFilter === "pending") return client.status === "PENDING";
      if (statusFilter === "dashboard_only") return client.status === "DASHBOARD_ONLY";
      if (statusFilter === "canceled") return client.status === "CANCELED";
      if (statusFilter === "archived") return isArchivedStatus(client.status);
      if (statusFilter === "included") return includedClientIds.has(client.id);
      return true;
    })
    .filter((client) => {
      if (!searchTerm) return true;
      const searchLower = searchTerm.toLowerCase();
      const matchesAgency = client.agencyNames?.some((name) =>
        name.toLowerCase().includes(searchLower)
      );
      return (
        client.name.toLowerCase().includes(searchLower) ||
        client.domain.toLowerCase().includes(searchLower) ||
        !!matchesAgency
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

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {agencyMe?.isBusinessTier ? "Your Business" : "Clients"}
          </h1>
          <p className="text-gray-600 mt-2">
            {agencyMe?.isBusinessTier
              ? "Manage your business dashboard"
              : "Manage your all clients and view their details"}
          </p>
        </div>
        {!(agencyMe?.isBusinessTier || (dashboardLimit && dashboardLimit.used >= dashboardLimit.limit)) && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2"
          >
            <Plus className="h-5 w-5" />
            <span>New Client</span>
          </button>
        )}
        {!agencyMe?.isBusinessTier && dashboardLimit && dashboardLimit.used >= dashboardLimit.limit && (
          <a
            href="/agency/subscription"
            className="bg-amber-500 text-white px-6 py-3 rounded-lg hover:bg-amber-600 transition-colors flex items-center space-x-2"
          >
            <span>Upgrade to add more dashboards</span>
          </a>
        )}
      </div>

      {/* Filter cards: default view = Active Clients (managed services). Super Admin: 7 metrics in 1 line. */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8 ${isSuperAdmin ? "xl:grid-cols-7" : "xl:grid-cols-6"}`}>
        <button
          type="button"
          onClick={() => setStatusFilter("active")}
          className={`bg-white p-5 rounded-xl border transition-colors text-left ${statusFilter === "active" ? "border-green-300 ring-2 ring-green-100" : "border-gray-200 hover:bg-gray-50"}`}
          title="Clients with active status"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-600">Active Clients</p>
              <p className="text-xl font-bold text-green-600">{activeCount}</p>
              <p className="text-xs text-gray-500 mt-0.5">Clients with active status</p>
            </div>
            <UserCheck className="h-8 w-8 text-green-600 shrink-0" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter("total")}
          className={`bg-white p-5 rounded-xl border transition-colors text-left ${statusFilter === "total" ? "border-primary-300 ring-2 ring-primary-100" : "border-gray-200 hover:bg-gray-50"}`}
          title="All client dashboards"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-600">Total Dashboards</p>
              <p className="text-xl font-bold text-primary-600">{totalCount}</p>
              <p className="text-xs text-gray-500 mt-0.5">All client dashboards</p>
            </div>
            <LayoutDashboard className="h-8 w-8 text-primary-600 shrink-0" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter("pending")}
          className={`relative bg-white p-5 rounded-xl border transition-colors text-left ${statusFilter === "pending" ? "border-amber-300 ring-2 ring-amber-100" : "border-gray-200 hover:bg-gray-50"}`}
          title="Awaiting approval"
        >
          {pendingCount > 0 && (
            <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
              {pendingCount}
            </span>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-600">Pending Requests</p>
              <p className="text-xl font-bold text-amber-600">{pendingCount}</p>
              <p className="text-xs text-gray-500 mt-0.5">Awaiting approval</p>
            </div>
            <Clock className="h-8 w-8 text-amber-600 shrink-0" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter("dashboard_only")}
          className={`bg-white p-5 rounded-xl border transition-colors text-left ${statusFilter === "dashboard_only" ? "border-blue-300 ring-2 ring-blue-100" : "border-gray-200 hover:bg-gray-50"}`}
          title="No managed services"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-600">Dashboard Only</p>
              <p className="text-xl font-bold text-blue-600">{dashboardOnlyCount}</p>
              <p className="text-xs text-gray-500 mt-0.5">No managed services</p>
            </div>
            <LayoutDashboard className="h-8 w-8 text-blue-600 shrink-0" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter("canceled")}
          className={`bg-white p-5 rounded-xl border transition-colors text-left ${statusFilter === "canceled" ? "border-orange-300 ring-2 ring-orange-100" : "border-gray-200 hover:bg-gray-50"}`}
          title="Services ending"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-600">Canceled</p>
              <p className="text-xl font-bold text-orange-600">{canceledCount}</p>
              <p className="text-xs text-gray-500 mt-0.5">Services ending</p>
            </div>
            <XCircle className="h-8 w-8 text-orange-600 shrink-0" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter("archived")}
          className={`bg-white p-5 rounded-xl border transition-colors text-left ${statusFilter === "archived" ? "border-gray-400 ring-2 ring-gray-100" : "border-gray-200 hover:bg-gray-50"}`}
          title="Past clients"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-600">Archived</p>
              <p className="text-xl font-bold text-gray-700">{archivedCount}</p>
              <p className="text-xs text-gray-500 mt-0.5">Past clients</p>
            </div>
            <Archive className="h-8 w-8 text-gray-500 shrink-0" />
          </div>
        </button>

        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setStatusFilter("included")}
            className={`bg-white p-5 rounded-xl border transition-colors text-left ${statusFilter === "included" ? "border-teal-300 ring-2 ring-teal-100" : "border-gray-200 hover:bg-gray-50"}`}
            title="Included dashboards (free, no tier limit)"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-600">Included Dashboards</p>
                <p className="text-xl font-bold text-teal-600">{includedCount}</p>
                <p className="text-xs text-gray-500 mt-0.5">Free, no tier limit</p>
              </div>
              <FolderPlus className="h-8 w-8 text-teal-600 shrink-0" />
            </div>
          </button>
        )}
      </div>


      {/* Filters */}
      <div className="bg-white p-6 rounded-xl border border-gray-200 mb-8">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search name, domain, agency ..."
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
                <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                  <th
                    className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider cursor-pointer hover:from-primary-100 hover:via-blue-100 select-none border-l-4 border-primary-400 first:border-l-0"
                    onClick={() => handleSort("name")}
                  >
                    <div className="flex items-center gap-2">
                      Client Name
                      {sortField === "name" && (sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-primary-600" /> : <ArrowDown className="h-3.5 w-3.5 text-primary-600" />)}
                    </div>
                  </th>
                  <th
                    className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider cursor-pointer hover:from-primary-100 select-none border-l-4 border-emerald-300"
                    onClick={() => handleSort("domain")}
                  >
                    <div className="flex items-center gap-2">
                      Domain
                      {sortField === "domain" && (sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-emerald-600" /> : <ArrowDown className="h-3.5 w-3.5 text-emerald-600" />)}
                    </div>
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Agency</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Service Package</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Status</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Created Date</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredClients.map((client, index) => (
                  <tr key={client.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}>
                    <td className="px-6 py-4 whitespace-nowrap text-xs">
                      <div className="flex items-center gap-2 font-semibold text-gray-900">
                        <Building2 className="h-4 w-4 text-primary-500 shrink-0" />
                        {client.name}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs">
                      <a
                        className="text-sm font-medium text-primary-600 hover:text-primary-700 underline underline-offset-1 decoration-primary-300 hover:decoration-primary-500 transition-colors"
                        href={client.domain.startsWith("http") ? client.domain : `https://${client.domain}`}
                        target="_blank" rel="noopener noreferrer"
                      >
                        {client.domain}
                      </a>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-amber-800/90">
                      {client.agencyNames?.length ? client.agencyNames.join(", ") : "—"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs">
                      <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-violet-100 text-violet-800">
                        {getServicePackageLabel(client)}
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
                                { label: "Dashboard Only", value: "DASHBOARD_ONLY" },
                                { label: "Pending", value: "PENDING" },
                                { label: "Active", value: "ACTIVE" },
                                { label: "Canceled", value: "CANCELED" },
                                { label: "Suspended", value: "SUSPENDED" },
                                { label: "Archived", value: "ARCHIVED" },
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
                      <div className="flex items-center flex-wrap gap-1">
                        {client.status === "PENDING" && (user?.role === "SUPER_ADMIN" || user?.role === "ADMIN") ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleApproveAndActivate(client)}
                              disabled={approvingClientId === client.id || rejectingClientId === client.id}
                              className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              Approve & Activate
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectToDashboardOnly(client)}
                              disabled={approvingClientId === client.id || rejectingClientId === client.id}
                              className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
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
                        {user?.role === "SUPER_ADMIN" && !client.vendasta && (
                          <button
                            className="p-2 rounded-lg text-gray-500 hover:text-orange-600 hover:bg-orange-50 transition-colors"
                            onClick={() => handleMoveToVendasta(client)}
                            title="Move to Vendasta"
                          >
                            <Store className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                          onClick={() => handleEditClick(client)}
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                          onClick={() => handleDeleteClient(client.id)}
                          title="Delete"
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
          {filteredClients.map((client) => (
            <div
              key={client.id}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-lg hover:border-primary-200 transition-all flex flex-col"
            >
              {/* Card header strip */}
              <div className="h-1.5 bg-gradient-to-r from-primary-500 via-blue-500 to-indigo-500" />
              <div className="p-6 flex-1">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary-100 to-blue-100 text-primary-600 shrink-0">
                      <Globe className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {client.name}
                      </h3>
                      <a
                        className="text-sm text-primary-600 hover:text-primary-700 underline underline-offset-1 decoration-primary-300 truncate block"
                        href={client.domain.startsWith("http") ? client.domain : `https://${client.domain}`}
                        target="_blank" rel="noopener noreferrer"
                      >
                        {client.domain}
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {user?.role === "SUPER_ADMIN" ? (
                      <div className="relative inline-block status-dropdown">
                          <button
                            className={`px-4 py-1.5 text-xs font-semibold rounded-full ${getStatusBadge(client.status)}`}
                          onClick={() => setOpenStatusId(openStatusId === client.id ? "" : client.id)}
                          >
                            {getStatusLabel(client.status)}
                          </button>
                          {openStatusId === client.id && (
                          <div className="absolute mt-1 left-0 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-[120px]">
                              {[
                                { label: "Dashboard Only", value: "DASHBOARD_ONLY" },
                                { label: "Pending", value: "PENDING" },
                                { label: "Active", value: "ACTIVE" },
                                { label: "Canceled", value: "CANCELED" },
                                { label: "Suspended", value: "SUSPENDED" },
                                { label: "Archived", value: "ARCHIVED" },
                              ].map(({ label, value }) => (
                                <div
                                  key={value}
                                className="px-4 py-2 text-xs hover:bg-gray-100 cursor-pointer first:rounded-t-md last:rounded-b-md"
                                  onClick={async () => {
                                    await dispatch(updateClient({ id: client.id, data: { status: value } }) as any);
                                    setOpenStatusId("");
                                  toast.success("Client updated successfully!");
                                  dispatch(fetchClients() as any);
                                  }}
                                >
                                  {label}
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
                          {getStatusLabel(client.status)}
                        </span>
                    )}
                    <button
                      className="p-2 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                      onClick={() => handleShareClick(client)}
                      title="Share"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                    <button
                      className="p-2 rounded-lg text-gray-500 hover:text-violet-600 hover:bg-violet-50 card-menu-button transition-colors"
                      ref={(el) => {
                        if (el) cardMenuButtonRefs.current[client.id] = el;
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenCardMenuId((prev) => (prev === client.id ? null : client.id));
                      }}
                      title="More"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {openCardMenuId === client.id && cardMenuButtonRefs.current[client.id] &&
                      createPortal(
                        <div
                          data-card-menu
                          className="fixed bg-white border border-gray-200 rounded-md shadow-lg min-w-[180px]"
                          style={{
                            top: `${cardMenuButtonRefs.current[client.id]!.getBoundingClientRect().bottom + 6}px`,
                            left: `${cardMenuButtonRefs.current[client.id]!.getBoundingClientRect().left - 140}px`,
                            zIndex: 9999,
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {client.status === "PENDING" && (user?.role === "SUPER_ADMIN" || user?.role === "ADMIN") && (
                            <>
                              <button
                                className="w-full text-left px-4 py-2 text-xs hover:bg-green-50 text-green-700 first:rounded-t-md"
                                onClick={() => {
                                  setOpenCardMenuId(null);
                                  handleApproveAndActivate(client);
                                }}
                                disabled={approvingClientId === client.id || rejectingClientId === client.id}
                              >
                                Approve & Activate
                              </button>
                              <button
                                className="w-full text-left px-4 py-2 text-xs hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                onClick={() => {
                                  setOpenCardMenuId(null);
                                  handleRejectToDashboardOnly(client);
                                }}
                                disabled={approvingClientId === client.id || rejectingClientId === client.id}
                              >
                                Reject
                              </button>
                            </>
                          )}
                          <button
                            className="w-full text-left px-4 py-2 text-xs hover:bg-gray-100 first:rounded-t-md"
                            onClick={() => {
                              setOpenCardMenuId(null);
                              handleViewReportClick(client);
                            }}
                          >
                            View Report
                          </button>
                          <button
                            className="w-full text-left px-4 py-2 text-xs hover:bg-gray-100"
                            onClick={() => {
                              setOpenCardMenuId(null);
                              handleViewClick(client);
                            }}
                          >
                            Open Dashboard
                          </button>
                          {user?.role === "SUPER_ADMIN" && !client.vendasta && (
                            <button
                              className="w-full text-left px-4 py-2 text-xs hover:bg-orange-50 text-orange-600 flex items-center gap-2"
                              onClick={() => {
                                setOpenCardMenuId(null);
                                handleMoveToVendasta(client);
                              }}
                            >
                              <Store className="h-3 w-3" />
                              Move to Vendasta
                            </button>
                          )}
                          <button
                            className="w-full text-left px-4 py-2 text-xs hover:bg-red-50 text-red-600 last:rounded-b-md"
                            onClick={() => {
                              setOpenCardMenuId(null);
                              handleDeleteClient(client.id);
                            }}
                          >
                            Delete Client
                          </button>
                        </div>,
                        document.body
                      )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="text-center p-4 rounded-xl border-l-4 border-blue-500 bg-blue-50/60">
                    <p className="text-xl font-bold text-blue-900">
                      {Array.isArray(client.keywords) ? client.keywords.length : (client.keywords ?? 0)}
                    </p>
                    <p className="text-xs font-medium text-blue-700">Keywords</p>
                  </div>
                  <div className="text-center p-4 rounded-xl border-l-4 border-emerald-500 bg-emerald-50/60">
                    <p className="text-xl font-bold text-emerald-900">
                      {client.avgPosition ?? 0}
                    </p>
                    <p className="text-xs font-medium text-emerald-700">Avg Position</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="text-center p-4 rounded-xl border-l-4 border-amber-500 bg-amber-50/60">
                    <p className="text-xl font-bold text-amber-900">
                      {client.topRankings ?? 0}
                    </p>
                    <p className="text-xs font-medium text-amber-700">Top 10</p>
                  </div>
                  <div className="text-center p-4 rounded-xl border-l-4 border-violet-500 bg-violet-50/60">
                    <p className="text-xl font-bold text-violet-900">
                      {Math.round(Number(client.traffic30d ?? client.traffic ?? 0)).toLocaleString()}
                    </p>
                    <p className="text-xs font-medium text-violet-700">Traffic (30d)</p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm pt-3 border-t border-gray-100">
                  <div className="flex items-center gap-2 text-slate-600">
                    <Calendar className="h-4 w-4 text-slate-400" />
                    <span>Created {new Date(client.createdAt).toLocaleDateString()}</span>
                  </div>
                  <button
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-sm hover:shadow transition-all"
                    onClick={() => handleViewReportClick(client)}
                  >
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm overflow-y-auto z-50 p-4">
          <div className="min-h-full px-4 py-8 flex items-start justify-center">
            <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-gray-200/80 w-full max-w-5xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-start justify-between px-6 py-5 shrink-0 bg-gradient-to-r from-primary-600 via-primary-500 to-blue-600 text-white rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Create New Client</h2>
                  <p className="text-sm text-white/90">Account information</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setClientForm(EMPTY_CLIENT_FORM);
                }}
                className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateClient} className="flex-1 min-h-0 flex flex-col bg-gray-50/50">
              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-5">
                {isAgencyCreateForm ? (
                  <>
                    {/* SECTION A: BUSINESS INFORMATION (Required) */}
                    <section className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-blue-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        BUSINESS INFORMATION (Required)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Name *</label>
                          <input type="text" required value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="e.g. Island Salt & Spa" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Niche *</label>
                          <select value={clientForm.businessNiche} onChange={(e) => setClientForm((prev) => ({ ...prev, businessNiche: e.target.value, businessNicheOther: e.target.value === "Other" ? prev.businessNicheOther : "" }))} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white" required>
                            <option value="">Select or enter below</option>
                            {BUSINESS_NICHE_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          {clientForm.businessNiche === "Other" && (
                            <input type="text" value={clientForm.businessNicheOther} onChange={(e) => setClientForm({ ...clientForm, businessNicheOther: e.target.value })} className="mt-2 w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Enter niche" required />
                          )}
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Description *</label>
                          <textarea required value={clientForm.businessDescription} onChange={(e) => setClientForm({ ...clientForm, businessDescription: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={3} placeholder="Brief description of what the business does" />
                          <p className="mt-1 text-xs text-gray-500">Brief description of what the business does</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Domain *</label>
                          <input type="url" required value={clientForm.domain} onChange={(e) => setClientForm({ ...clientForm, domain: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="https://islandsaltandspa.com" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Industry *</label>
                          <select value={clientForm.industry} onChange={(e) => setClientForm((prev) => ({ ...prev, industry: e.target.value, industryOther: e.target.value === "Other" ? prev.industryOther : "" }))} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white" required>
                            <option value="">Select industry</option>
                            {INDUSTRY_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          {clientForm.industry === "Other" && (
                            <input type="text" value={clientForm.industryOther} onChange={(e) => setClientForm({ ...clientForm, industryOther: e.target.value })} className="mt-2 w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Enter industry" required />
                          )}
                        </div>
                      </div>
                    </section>

                    {/* SECTION B: LOCATION INFORMATION (Required) */}
                    <section className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-emerald-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        LOCATION INFORMATION (Required)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Address *</label>
                          <input type="text" required value={clientForm.businessAddress} onChange={(e) => setClientForm({ ...clientForm, businessAddress: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="e.g. 123 Main Street" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Location City *</label>
                          <input type="text" required value={clientForm.primaryLocationCity} onChange={(e) => setClientForm({ ...clientForm, primaryLocationCity: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="e.g. Huntington" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Location State *</label>
                          <select value={clientForm.primaryLocationState} onChange={(e) => setClientForm({ ...clientForm, primaryLocationState: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white" required>
                            <option value="">Select state</option>
                            {US_STATES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Service Radius</label>
                          <select value={clientForm.serviceRadius} onChange={(e) => setClientForm({ ...clientForm, serviceRadius: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white">
                            <option value="">Select...</option>
                            {SERVICE_RADIUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-gray-500">How far do you serve from your primary location?</p>
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Areas Served</label>
                          <textarea value={clientForm.serviceAreasServed} onChange={(e) => setClientForm({ ...clientForm, serviceAreasServed: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={2} placeholder="e.g. Huntington, Northport, Centerport, Cold Spring Harbor, Dix Hills" />
                          <p className="mt-1 text-xs text-gray-500">List cities, towns, or regions you serve (comma-separated)</p>
                        </div>
                      </div>
                    </section>

                    {/* SECTION C: CONTACT INFORMATION (Required) */}
                    <section className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-amber-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        CONTACT INFORMATION (Required)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number *</label>
                          <input type="tel" required value={clientForm.phoneNumber} onChange={(e) => setClientForm({ ...clientForm, phoneNumber: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="+1 (631) 555-1234" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                          <input type="email" required value={clientForm.emailAddress} onChange={(e) => setClientForm({ ...clientForm, emailAddress: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="info@islandsaltandspa.com" />
                        </div>
                      </div>
                    </section>

                    {/* SECTION D: WEBSITE LOGIN INFO (Optional) */}
                    <section className="rounded-xl border-l-4 border-violet-500 bg-violet-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-violet-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                        WEBSITE LOGIN INFO (Optional)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Website Login URL</label>
                          <input type="url" value={clientForm.loginUrl} onChange={(e) => setClientForm({ ...clientForm, loginUrl: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="https://islandsaltandspa.com/wp-admin" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Website Username</label>
                          <input type="text" value={clientForm.loginUsername} onChange={(e) => setClientForm({ ...clientForm, loginUsername: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="admin" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Website Password</label>
                          <input type="password" value={clientForm.loginPassword} onChange={(e) => setClientForm({ ...clientForm, loginPassword: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="••••••••" />
                          <p className="mt-1 text-xs text-gray-500">Stored securely</p>
                        </div>
                      </div>
                    </section>

                    {/* SECTION E: CAMPAIGN TYPE (Required) */}
                    <section className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-indigo-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        CAMPAIGN TYPE (Required)
                      </h3>
                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Type *</label>
                        <div className="flex flex-wrap gap-4">
                          <label className="flex items-center gap-2">
                            <input type="radio" name="campaignType" value="Local" checked={clientForm.campaignType === "Local"} onChange={(e) => setClientForm({ ...clientForm, campaignType: e.target.value as CampaignType })} className="text-primary-600" required={isAgencyCreateForm} />
                            <span>Local (targeting specific geographic area)</span>
                          </label>
                          <label className="flex items-center gap-2">
                            <input type="radio" name="campaignType" value="National" checked={clientForm.campaignType === "National"} onChange={(e) => setClientForm({ ...clientForm, campaignType: e.target.value as CampaignType })} className="text-primary-600" />
                            <span>National (targeting entire country/multiple regions)</span>
                          </label>
                        </div>
                      </div>
                    </section>

                    {/* SECTION F: GOOGLE BUSINESS PROFILE (Optional) */}
                    <section className="rounded-xl border-l-4 border-teal-500 bg-teal-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-teal-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                        GOOGLE BUSINESS PROFILE (Optional)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Google Business Profile Category</label>
                          <input type="text" value={clientForm.gbpPrimaryCategory} onChange={(e) => setClientForm({ ...clientForm, gbpPrimaryCategory: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="e.g. Day Spa" />
                          <p className="mt-1 text-xs text-gray-500">Your primary GBP category (exact match)</p>
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Secondary GBP Categories</label>
                          <input type="text" value={clientForm.gbpSecondaryCategories} onChange={(e) => setClientForm({ ...clientForm, gbpSecondaryCategories: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="e.g. Massage Therapist, Wellness Center" />
                          <p className="mt-1 text-xs text-gray-500">Additional GBP categories (comma-separated)</p>
                        </div>
                      </div>
                    </section>
                  </>
                ) : (
                  <>
                    {/* Full form for Super Admin / Specialist */}
                    <section className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-blue-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        Business Information
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Name</label>
                          <input type="text" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="Company name" required />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Niche</label>
                          <input type="text" value={clientForm.businessNiche} onChange={(e) => setClientForm({ ...clientForm, businessNiche: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="e.g. Emergency locksmith" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Description</label>
                          <textarea value={clientForm.businessDescription} onChange={(e) => setClientForm({ ...clientForm, businessDescription: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={3} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Domain</label>
                          <input type="text" value={clientForm.domain} onChange={(e) => setClientForm({ ...clientForm, domain: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="example.com or https://example.com" required />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Industry</label>
                          <select value={clientForm.industry} onChange={(e) => setClientForm((prev) => ({ ...prev, industry: e.target.value, industryOther: e.target.value === "Other" ? prev.industryOther : "" }))} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white" required>
                            <option value="" disabled>Select industry</option>
                            {INDUSTRY_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          {clientForm.industry === "Other" && (
                            <input type="text" value={clientForm.industryOther} onChange={(e) => setClientForm({ ...clientForm, industryOther: e.target.value })} className="mt-3 w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Enter industry" required />
                          )}
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Address</label>
                          <input type="text" value={clientForm.businessAddress} onChange={(e) => setClientForm({ ...clientForm, businessAddress: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="Street address" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Location – City</label>
                          <input type="text" value={clientForm.primaryLocationCity} onChange={(e) => setClientForm({ ...clientForm, primaryLocationCity: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Location – State</label>
                          <input type="text" value={clientForm.primaryLocationState} onChange={(e) => setClientForm({ ...clientForm, primaryLocationState: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Service Radius / Areas Served</label>
                          <textarea value={clientForm.serviceAreasServed} onChange={(e) => setClientForm({ ...clientForm, serviceAreasServed: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={3} placeholder="List cities/areas served (comma or newline separated)" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                          <input type="tel" value={clientForm.phoneNumber} onChange={(e) => setClientForm({ ...clientForm, phoneNumber: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                          <input type="email" value={clientForm.emailAddress} onChange={(e) => setClientForm({ ...clientForm, emailAddress: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                      </div>
                    </section>
                    <section className="rounded-xl border-l-4 border-violet-500 bg-violet-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-violet-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                        Website Info
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Login URL</label>
                          <input type="url" value={clientForm.loginUrl} onChange={(e) => setClientForm({ ...clientForm, loginUrl: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Login Username</label>
                          <input type="text" value={clientForm.loginUsername} onChange={(e) => setClientForm({ ...clientForm, loginUsername: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                          <input type="password" value={clientForm.loginPassword} onChange={(e) => setClientForm({ ...clientForm, loginPassword: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                      </div>
                    </section>
                    <section className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-indigo-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        Campaign Type
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Type</label>
                          <select value={clientForm.campaignType} onChange={(e) => setClientForm({ ...clientForm, campaignType: e.target.value as CampaignType })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white">
                            <option value="">Select</option>
                            <option value="Local">Local</option>
                            <option value="National">National</option>
                          </select>
                        </div>
                      </div>
                    </section>
                    <section className="rounded-xl border-l-4 border-teal-500 bg-teal-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-teal-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                        Google Business Profile (GBP) Categories
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary GBP Category</label>
                          <input type="text" value={clientForm.gbpPrimaryCategory} onChange={(e) => setClientForm({ ...clientForm, gbpPrimaryCategory: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Secondary GBP Categories</label>
                          <textarea value={clientForm.gbpSecondaryCategories} onChange={(e) => setClientForm({ ...clientForm, gbpSecondaryCategories: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={3} />
                        </div>
                      </div>
                    </section>
                    <section className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-amber-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Google Business Profile Services
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Services List</label>
                          <textarea value={clientForm.primaryServicesList} onChange={(e) => setClientForm({ ...clientForm, primaryServicesList: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={3} />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Services Marked as Primary</label>
                          <textarea value={clientForm.servicesMarkedPrimary} onChange={(e) => setClientForm({ ...clientForm, servicesMarkedPrimary: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={2} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Target Number of Keywords for Campaign</label>
                          <input type="text" value={clientForm.targetKeywordCount} onChange={(e) => setClientForm({ ...clientForm, targetKeywordCount: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                      </div>
                    </section>
                    <section className="rounded-xl border-l-4 border-rose-500 bg-rose-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-rose-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                        Keywords
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">What are the keywords you want to target?</label>
                          <textarea value={clientForm.keywords} onChange={(e) => setClientForm({ ...clientForm, keywords: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={5} placeholder="One per line" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Latitude</label>
                          <input type="number" step="any" value={clientForm.latitude} onChange={(e) => setClientForm({ ...clientForm, latitude: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Longitude</label>
                          <input type="number" step="any" value={clientForm.longitude} onChange={(e) => setClientForm({ ...clientForm, longitude: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                      </div>
                    </section>
                    {canSeeSeoRoadmapFields && (
                      <section className="rounded-xl border-l-4 border-slate-600 bg-slate-50/50 p-4 sm:p-5">
                        <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                          SEO Roadmap
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">SEO Roadmap Start Month</label>
                            <input type="month" value={clientForm.seoRoadmapStartMonth} onChange={(e) => setClientForm({ ...clientForm, seoRoadmapStartMonth: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Pages Per Month</label>
                            <input type="number" value={clientForm.pagesPerMonth} onChange={(e) => setClientForm({ ...clientForm, pagesPerMonth: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Technical Hours Per Month</label>
                            <input type="number" value={clientForm.technicalHoursPerMonth} onChange={(e) => setClientForm({ ...clientForm, technicalHoursPerMonth: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Duration in Months</label>
                            <input type="number" value={clientForm.campaignDurationMonths} onChange={(e) => setClientForm({ ...clientForm, campaignDurationMonths: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                          </div>
                        </div>
                      </section>
                    )}
                  </>
                )}
              </div>

              <div className="border-t border-gray-200 px-6 py-4 bg-gray-100/80 flex items-center justify-end gap-3 shrink-0 rounded-b-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setClientForm(EMPTY_CLIENT_FORM);
                  }}
                  className="border border-gray-300 bg-white text-gray-700 px-5 py-2.5 rounded-xl hover:bg-gray-50 font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg transition-all"
                >
                  Create Client
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Client Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm overflow-y-auto z-50">
          <div className="min-h-full px-4 py-8 flex items-start justify-center">
            <div className="bg-white rounded-2xl shadow-2xl ring-2 ring-primary-200/80 w-full max-w-5xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-start justify-between px-6 py-4 bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 border-b-2 border-primary-500/50 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-white drop-shadow-sm">Edit Client</h2>
                <p className="text-sm text-white/90 mt-1">Account information</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const niche = clientForm.businessNiche === "Other" ? clientForm.businessNicheOther : clientForm.businessNiche;
                    const industry = clientForm.industry === "Other" ? clientForm.industryOther : clientForm.industry;
                    const lines = [
                      "--- BUSINESS INFORMATION ---",
                      `Business Name: ${clientForm.name || ""}`,
                      `Business Niche: ${niche || ""}`,
                      `Business Description: ${clientForm.businessDescription || ""}`,
                      `Primary Domain: ${clientForm.domain || ""}`,
                      `Industry: ${industry || ""}`,
                      "",
                      "--- LOCATION INFORMATION ---",
                      `Business Address: ${clientForm.businessAddress || ""}`,
                      `Primary Location City: ${clientForm.primaryLocationCity || ""}`,
                      `Primary Location State: ${clientForm.primaryLocationState || ""}`,
                      `Service Radius: ${clientForm.serviceRadius || ""}`,
                      `Areas Served: ${clientForm.serviceAreasServed || ""}`,
                      "",
                      "--- CONTACT INFORMATION ---",
                      `Phone Number: ${clientForm.phoneNumber || ""}`,
                      `Email: ${clientForm.emailAddress || ""}`,
                      "",
                      "--- WEBSITE LOGIN INFO ---",
                      `Website Login URL: ${clientForm.loginUrl || ""}`,
                      `Website Username: ${clientForm.loginUsername || ""}`,
                      `Website Password: ${clientForm.loginPassword ? "••••••••" : ""}`,
                      "",
                      "--- CAMPAIGN TYPE ---",
                      `Campaign Type: ${clientForm.campaignType || ""}`,
                      "",
                      "--- GOOGLE BUSINESS PROFILE ---",
                      `Google Business Profile Category: ${clientForm.gbpPrimaryCategory || ""}`,
                      `Secondary GBP Categories: ${clientForm.gbpSecondaryCategories || ""}`,
                    ];
                    if (user?.role === "SUPER_ADMIN" || user?.role === "ADMIN") {
                      lines.push("", "--- STATUS ---", `Status: ${clientForm.clientStatus || ""}`);
                    }
                    const text = lines.join("\n");
                    navigator.clipboard.writeText(text).then(
                      () => toast.success("Copied to clipboard"),
                      () => toast.error("Failed to copy")
                    );
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white/90 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                  title="Copy all information"
                >
                  <Copy className="h-4 w-4" />
                  Copy Text
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingClient(null);
                    setClientForm(EMPTY_CLIENT_FORM);
                  }}
                  className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleUpdateClient} className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6 bg-gradient-to-b from-slate-50/50 to-white">
                {isAgencyCreateForm ? (
                  <>
                    {/* SECTION A: BUSINESS INFORMATION (Required) */}
                    <section className="rounded-xl border-l-4 border-primary-500 bg-primary-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-primary-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                        BUSINESS INFORMATION (Required)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Name *</label>
                          <input
                            type="text"
                            value={clientForm.name}
                            onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Niche *</label>
                          <select value={clientForm.businessNiche} onChange={(e) => setClientForm((prev) => ({ ...prev, businessNiche: e.target.value, businessNicheOther: e.target.value === "Other" ? prev.businessNicheOther : "" }))} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white" required>
                            <option value="">Select or enter below</option>
                            {BUSINESS_NICHE_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          {clientForm.businessNiche === "Other" && (
                            <input type="text" value={clientForm.businessNicheOther} onChange={(e) => setClientForm({ ...clientForm, businessNicheOther: e.target.value })} className="mt-2 w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Enter niche" required />
                          )}
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Description *</label>
                          <textarea required value={clientForm.businessDescription} onChange={(e) => setClientForm({ ...clientForm, businessDescription: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={3} placeholder="Brief description of what the business does" />
                          <p className="mt-1 text-xs text-gray-500">Brief description of what the business does</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Domain *</label>
                          <input
                            type="url"
                            required
                            value={clientForm.domain}
                            onChange={(e) => setClientForm({ ...clientForm, domain: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            placeholder="https://islandsaltandspa.com"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Industry *</label>
                          <select
                            value={clientForm.industry}
                            onChange={(e) => {
                              const value = e.target.value;
                              setClientForm((prev) => ({
                                ...prev,
                                industry: value,
                                industryOther: value === "Other" ? prev.industryOther : "",
                              }));
                            }}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                            required
                          >
                            <option value="">Select industry</option>
                            {INDUSTRY_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                          {clientForm.industry === "Other" && (
                            <input
                              type="text"
                              value={clientForm.industryOther}
                              onChange={(e) => setClientForm((prev) => ({ ...prev, industryOther: e.target.value }))}
                              className="mt-2 w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                              placeholder="Enter industry"
                              required
                            />
                          )}
                        </div>
                      </div>
                    </section>

                    {/* SECTION B: LOCATION INFORMATION (Required) */}
                    <section className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-emerald-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        LOCATION INFORMATION (Required)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Address *</label>
                          <input type="text" required value={clientForm.businessAddress} onChange={(e) => setClientForm({ ...clientForm, businessAddress: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="e.g. 123 Main Street" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Location City *</label>
                          <input type="text" required value={clientForm.primaryLocationCity} onChange={(e) => setClientForm({ ...clientForm, primaryLocationCity: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="e.g. Huntington" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Location State *</label>
                          <select value={clientForm.primaryLocationState} onChange={(e) => setClientForm({ ...clientForm, primaryLocationState: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white" required>
                            <option value="">Select state</option>
                            {US_STATES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Service Radius</label>
                          <select value={clientForm.serviceRadius} onChange={(e) => setClientForm({ ...clientForm, serviceRadius: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white">
                            <option value="">Select...</option>
                            {SERVICE_RADIUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-gray-500">How far do you serve from your primary location?</p>
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Areas Served</label>
                          <textarea value={clientForm.serviceAreasServed} onChange={(e) => setClientForm({ ...clientForm, serviceAreasServed: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={2} placeholder="e.g. Huntington, Northport, Centerport, Cold Spring Harbor, Dix Hills" />
                          <p className="mt-1 text-xs text-gray-500">List cities, towns, or regions you serve (comma-separated)</p>
                        </div>
                      </div>
                    </section>

                    {/* SECTION C: CONTACT INFORMATION (Required) */}
                    <section className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-amber-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        CONTACT INFORMATION (Required)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number *</label>
                          <input type="tel" required value={clientForm.phoneNumber} onChange={(e) => setClientForm({ ...clientForm, phoneNumber: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="+1 (631) 555-1234" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Email *</label>
                          <input type="email" required value={clientForm.emailAddress} onChange={(e) => setClientForm({ ...clientForm, emailAddress: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="info@islandsaltandspa.com" />
                        </div>
                      </div>
                    </section>

                    {/* SECTION D: WEBSITE LOGIN INFO (Optional) */}
                    <section className="rounded-xl border-l-4 border-violet-500 bg-violet-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-violet-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                        WEBSITE LOGIN INFO (Optional)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Website Login URL</label>
                          <input type="url" value={clientForm.loginUrl} onChange={(e) => setClientForm({ ...clientForm, loginUrl: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="https://islandsaltandspa.com/wp-admin" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Website Username</label>
                          <input type="text" value={clientForm.loginUsername} onChange={(e) => setClientForm({ ...clientForm, loginUsername: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="admin" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Website Password</label>
                          <input type="password" value={clientForm.loginPassword} onChange={(e) => setClientForm({ ...clientForm, loginPassword: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="••••••••" />
                          <p className="mt-1 text-xs text-gray-500">Stored securely</p>
                        </div>
                      </div>
                    </section>

                    {/* SECTION E: CAMPAIGN TYPE (Required) */}
                    <section>
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">CAMPAIGN TYPE (Required)</h3>
                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Type *</label>
                        <div className="flex flex-wrap gap-4">
                          <label className="flex items-center gap-2">
                            <input type="radio" name="campaignType" value="Local" checked={clientForm.campaignType === "Local"} onChange={(e) => setClientForm({ ...clientForm, campaignType: e.target.value as CampaignType })} className="text-primary-600" required={isAgencyCreateForm} />
                            <span>Local (targeting specific geographic area)</span>
                          </label>
                          <label className="flex items-center gap-2">
                            <input type="radio" name="campaignType" value="National" checked={clientForm.campaignType === "National"} onChange={(e) => setClientForm({ ...clientForm, campaignType: e.target.value as CampaignType })} className="text-primary-600" />
                            <span>National (targeting entire country/multiple regions)</span>
                          </label>
                        </div>
                      </div>
                    </section>

                    {/* SECTION F: GOOGLE BUSINESS PROFILE (Optional) */}
                    <section className="rounded-xl border-l-4 border-teal-500 bg-teal-50/50 p-4 sm:p-5">
                      <h3 className="text-sm font-semibold text-teal-900 mb-4 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                        GOOGLE BUSINESS PROFILE (Optional)
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Google Business Profile Category</label>
                          <input type="text" value={clientForm.gbpPrimaryCategory} onChange={(e) => setClientForm({ ...clientForm, gbpPrimaryCategory: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="e.g. Day Spa" />
                          <p className="mt-1 text-xs text-gray-500">Your primary GBP category (exact match)</p>
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Secondary GBP Categories</label>
                          <input type="text" value={clientForm.gbpSecondaryCategories} onChange={(e) => setClientForm({ ...clientForm, gbpSecondaryCategories: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" placeholder="e.g. Massage Therapist, Wellness Center" />
                          <p className="mt-1 text-xs text-gray-500">Additional GBP categories (comma-separated)</p>
                        </div>
                      </div>
                    </section>
                  </>
                ) : (
                  <>
                    {/* Full form for Super Admin / Specialist - includes all agency fields plus additional fields */}
                    <section>
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">Business Information</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Name</label>
                          <input
                            type="text"
                            value={clientForm.name}
                            onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Niche</label>
                          <input
                            type="text"
                            value={clientForm.businessNiche}
                            onChange={(e) => setClientForm({ ...clientForm, businessNiche: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Description</label>
                          <textarea
                            value={clientForm.businessDescription}
                            onChange={(e) => setClientForm({ ...clientForm, businessDescription: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            rows={3}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Domain</label>
                          <input
                            type="text"
                            value={clientForm.domain}
                            onChange={(e) => setClientForm({ ...clientForm, domain: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            placeholder="example.com or https://example.com"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Industry</label>
                          <select
                            value={clientForm.industry}
                            onChange={(e) => {
                              const value = e.target.value;
                              setClientForm((prev) => ({
                                ...prev,
                                industry: value,
                                industryOther: value === "Other" ? prev.industryOther : "",
                              }));
                            }}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                            required
                          >
                            <option value="" disabled>
                              Select industry
                            </option>
                            {INDUSTRY_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                          {clientForm.industry === "Other" && (
                            <input
                              type="text"
                              value={clientForm.industryOther}
                              onChange={(e) => setClientForm((prev) => ({ ...prev, industryOther: e.target.value }))}
                              className="mt-3 w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                              placeholder="Enter industry"
                              required
                            />
                          )}
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Business Address</label>
                          <input
                            type="text"
                            value={clientForm.businessAddress}
                            onChange={(e) => setClientForm({ ...clientForm, businessAddress: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Location – City</label>
                          <input
                            type="text"
                            value={clientForm.primaryLocationCity}
                            onChange={(e) => setClientForm({ ...clientForm, primaryLocationCity: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary Location – State</label>
                          <input
                            type="text"
                            value={clientForm.primaryLocationState}
                            onChange={(e) => setClientForm({ ...clientForm, primaryLocationState: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Service Radius / Areas Served</label>
                          <textarea
                            value={clientForm.serviceAreasServed}
                            onChange={(e) => setClientForm({ ...clientForm, serviceAreasServed: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            rows={3}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                          <input
                            type="tel"
                            value={clientForm.phoneNumber}
                            onChange={(e) => setClientForm({ ...clientForm, phoneNumber: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                          <input
                            type="email"
                            value={clientForm.emailAddress}
                            onChange={(e) => setClientForm({ ...clientForm, emailAddress: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                      </div>
                    </section>

                    <section>
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">Website Info</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Login URL</label>
                          <input
                            type="url"
                            value={clientForm.loginUrl}
                            onChange={(e) => setClientForm({ ...clientForm, loginUrl: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Login Username</label>
                          <input
                            type="text"
                            value={clientForm.loginUsername}
                            onChange={(e) => setClientForm({ ...clientForm, loginUsername: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                          <input
                            type="password"
                            value={clientForm.loginPassword}
                            onChange={(e) => setClientForm({ ...clientForm, loginPassword: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                      </div>
                    </section>

                    <section>
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">Campaign Type</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Type</label>
                          <select
                            value={clientForm.campaignType}
                            onChange={(e) => setClientForm({ ...clientForm, campaignType: e.target.value as CampaignType })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                          >
                            <option value="">Select</option>
                            <option value="Local">Local</option>
                            <option value="National">National</option>
                          </select>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">Google Business Profile (GBP) Categories</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Primary GBP Category</label>
                          <input
                            type="text"
                            value={clientForm.gbpPrimaryCategory}
                            onChange={(e) => setClientForm({ ...clientForm, gbpPrimaryCategory: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Secondary GBP Categories</label>
                          <textarea
                            value={clientForm.gbpSecondaryCategories}
                            onChange={(e) => setClientForm({ ...clientForm, gbpSecondaryCategories: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            rows={3}
                          />
                        </div>
                      </div>
                    </section>

                    {canSeeSeoRoadmapFields && (
                      <section className="rounded-xl border-l-4 border-slate-600 bg-slate-50/50 p-4 sm:p-5">
                        <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                          SEO Roadmap
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">SEO Roadmap Start Month</label>
                            <input type="month" value={clientForm.seoRoadmapStartMonth} onChange={(e) => setClientForm({ ...clientForm, seoRoadmapStartMonth: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Pages Per Month</label>
                            <input type="number" value={clientForm.pagesPerMonth} onChange={(e) => setClientForm({ ...clientForm, pagesPerMonth: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Technical Hours Per Month</label>
                            <input type="number" value={clientForm.technicalHoursPerMonth} onChange={(e) => setClientForm({ ...clientForm, technicalHoursPerMonth: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Campaign Duration in Months</label>
                            <input type="number" value={clientForm.campaignDurationMonths} onChange={(e) => setClientForm({ ...clientForm, campaignDurationMonths: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                          </div>
                        </div>
                      </section>
                    )}

                    <section>
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">Keywords</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-2">What are the keywords you want to target?</label>
                          <textarea value={clientForm.keywords} onChange={(e) => setClientForm({ ...clientForm, keywords: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" rows={5} placeholder="One per line" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Latitude</label>
                          <input type="number" step="any" value={clientForm.latitude} onChange={(e) => setClientForm({ ...clientForm, latitude: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Longitude</label>
                          <input type="number" step="any" value={clientForm.longitude} onChange={(e) => setClientForm({ ...clientForm, longitude: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" />
                        </div>
                      </div>
                    </section>
                  </>
                )}

                {user?.role === "SUPER_ADMIN" && (
                  <>
                    <section className="border-t border-gray-200 pt-6">
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">KEYWORD ALLOCATION</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Number of Keywords for Campaign</label>
                          <input
                            type="number"
                            min={0}
                            value={clientForm.targetKeywordCount}
                            onChange={(e) => setClientForm({ ...clientForm, targetKeywordCount: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            placeholder="e.g. 50"
                          />
                          <p className="mt-1 text-xs text-gray-500">Sets the keyword limit for this specific client</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Total Keywords to Target</label>
                          <input
                            type="number"
                            min={0}
                            value={clientForm.totalKeywordsToTarget}
                            onChange={(e) => setClientForm({ ...clientForm, totalKeywordsToTarget: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            placeholder="e.g. 200"
                          />
                          <p className="mt-1 text-xs text-gray-500">Long-term goal/roadmap keywords</p>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">GEOLOCATION DATA</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Latitude</label>
                          <input
                            type="number"
                            step="any"
                            value={clientForm.latitude}
                            onChange={(e) => setClientForm({ ...clientForm, latitude: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            placeholder="e.g. 40.8682"
                          />
                          <p className="mt-1 text-xs text-gray-500">Used for precise local ranking tracking</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Longitude</label>
                          <input
                            type="number"
                            step="any"
                            value={clientForm.longitude}
                            onChange={(e) => setClientForm({ ...clientForm, longitude: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            placeholder="e.g. -73.4357"
                          />
                          <p className="mt-1 text-xs text-gray-500">Used for precise local ranking tracking</p>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h3 className="text-sm font-semibold text-gray-900 mb-4">MANAGED SERVICE STATUS</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Managed Service Status</label>
                          <select
                            value={clientForm.clientStatus}
                            onChange={(e) => setClientForm({ ...clientForm, clientStatus: e.target.value })}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                          >
                            {MANAGED_SERVICE_STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        {(clientForm.clientStatus === "ACTIVE" || clientForm.clientStatus === "PENDING" || clientForm.clientStatus === "CANCELED") && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Managed Service Package</label>
                            <select
                              value={clientForm.managedServicePackage}
                              onChange={(e) => setClientForm({ ...clientForm, managedServicePackage: e.target.value })}
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                            >
                              <option value="">Select...</option>
                              {MANAGED_SERVICE_PACKAGE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {clientForm.clientStatus === "ACTIVE" && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Service Start Date</label>
                            <input
                              type="date"
                              value={clientForm.serviceStartDate}
                              onChange={(e) => setClientForm({ ...clientForm, serviceStartDate: e.target.value })}
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                          </div>
                        )}
                        {clientForm.clientStatus === "CANCELED" && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Service End Date</label>
                            <input
                              type="date"
                              value={clientForm.canceledEndDate}
                              onChange={(e) => setClientForm({ ...clientForm, canceledEndDate: e.target.value })}
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            />
                          </div>
                        )}
                      </div>
                    </section>
                  </>
                )}
              </div>

              <div className="border-t-2 border-gray-200 px-6 py-4 bg-gradient-to-r from-gray-50 to-slate-50 flex items-center justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingClient(null);
                    setClientForm(EMPTY_CLIENT_FORM);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-white border-2 border-gray-200 text-gray-700 font-medium hover:bg-gray-100 hover:border-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-primary-600 to-blue-600 text-white font-semibold hover:from-primary-700 hover:to-blue-700 transition-all shadow-md"
                >
                  Save Changes
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}

      {/* Share Link Modal - same style as Share Client Dashboard (Vendasta) */}
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

      {/* Delete Confirmation Dialog */}
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
    </div>
  );
};

export default ClientsPage;
