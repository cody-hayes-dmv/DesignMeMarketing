import React, { useEffect, useState, useRef, useImperativeHandle, forwardRef } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { RootState } from "@/store";
import { fetchAgencies, createAgency, updateAgency, deleteAgency, assignClientToAgency, removeClientFromAgency } from "@/store/slices/agencySlice";
import { updateClient, deleteClient } from "@/store/slices/clientSlice";
import { Plus, Users, X, Eye, Building2 as BuildingIcon, Share2, Edit, Trash2, ChevronDown, ChevronRight, ChevronLeft, Archive, UserMinus, ArrowUp, ArrowDown, Search, AlertCircle, FileText, Copy, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import toast from "react-hot-toast";
import api from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";

const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = stripePk ? loadStripe(stripePk) : null;

const CREATE_AGENCY_DRAFT_KEY = "createAgencyDraft";

type StripePaymentHandle = { confirmAndGetPaymentMethod: () => Promise<string | null> };

const StripePaymentSection = forwardRef<StripePaymentHandle, { clientSecret: string }>(function StripePaymentSection({ clientSecret }, ref) {
  const stripe = useStripe();
  const elements = useElements();
  useImperativeHandle(ref, () => ({
    async confirmAndGetPaymentMethod() {
      if (!stripe || !elements) return null;
      // Stripe requires elements.submit() before confirmSetup() (validates Payment Element first)
      const { error: submitError } = await elements.submit();
      if (submitError) throw new Error(submitError.message ?? "Please complete the card details.");
      const result = await stripe.confirmSetup({
        elements,
        clientSecret,
        confirmParams: { return_url: window.location.href },
      });
      if (result.error) throw new Error(result.error.message ?? "Payment failed");
      const setupIntent = (result as { setupIntent?: { payment_method?: string | { id?: string } } }).setupIntent;
      const pm = setupIntent?.payment_method;
      return typeof pm === "string" ? pm : (pm as { id?: string } | null)?.id ?? null;
    },
  }));
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <PaymentElement
        options={{
          layout: "tabs",
          paymentMethodOrder: ["card"],
          wallets: { applePay: "never", googlePay: "never" },
        }}
      />
    </div>
  );
});

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

// Client status values for managed service display
const CLIENT_STATUS = {
  DASHBOARD_ONLY: "DASHBOARD_ONLY",
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  CANCELED: "CANCELED",
  SUSPENDED: "SUSPENDED",
  ARCHIVED: "ARCHIVED",
  REJECTED: "REJECTED", // legacy, treat as Archived
} as const;

interface AgencyClient {
  id: string;
  name: string;
  domain: string;
  industry: string | null;
  status: string;
  canceledEndDate?: string | null;
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
    const [createModalStep, setCreateModalStep] = useState(1);
    useEffect(() => {
        if (showCreateModal) setCreateModalStep(1);
    }, [showCreateModal]);
    const [showEditAgencyModal, setShowEditAgencyModal] = useState(false);
    const [editModalStep, setEditModalStep] = useState(1);
    useEffect(() => {
        if (showEditAgencyModal) setEditModalStep(1);
    }, [showEditAgencyModal]);
    const [editingAgency, setEditingAgency] = useState<{ id: string; name: string } | null>(null);
    const [editingAgencyHasStripeCustomer, setEditingAgencyHasStripeCustomer] = useState(false);
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
    const [deleteAgencyConfirm, setDeleteAgencyConfirm] = useState<{ isOpen: boolean; agencyId: string | null; agencyName: string | null }>({
        isOpen: false,
        agencyId: null,
        agencyName: null,
    });
    const [assignClientModal, setAssignClientModal] = useState<{ isOpen: boolean; clientId: string | null; clientName: string | null }>({
        isOpen: false,
        clientId: null,
        clientName: null,
    });
    const [removeClientConfirm, setRemoveClientConfirm] = useState<{ isOpen: boolean; agencyId: string | null; clientId: string | null; clientName: string | null }>({
        isOpen: false,
        agencyId: null,
        clientId: null,
        clientName: null,
    });
    const [allClients, setAllClients] = useState<Array<{ id: string; name: string; domain: string }>>([]);
    const [loadingAllClients, setLoadingAllClients] = useState(false);
    const statusButtonRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const navigate = useNavigate();
    const [sortField, setSortField] = useState<"agency" | "subdomain" | "clients">("agency");
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
    const [agenciesSearch, setAgenciesSearch] = useState("");
    const initialCreateForm = {
        name: "",
        website: "",
        industry: "",
        agencySize: "",
        numberOfClients: "" as string | number,
        contactName: "",
        contactEmail: "",
        contactPhone: "",
        contactJobTitle: "",
        streetAddress: "",
        city: "",
        state: "",
        zip: "",
        country: "United States",
        subdomain: "",
        billingOption: "" as "" | "free_account" | "charge" | "no_charge" | "manual_invoice",
        tier: "" as "" | "solo" | "starter" | "growth" | "pro" | "enterprise" | "business_lite" | "business_pro",
        customPricing: "" as string | number,
        internalNotes: "",
        referralSource: "",
        referralSourceOther: "",
        primaryGoals: [] as string[],
        primaryGoalsOther: "",
        currentTools: "",
    };
    const [createForm, setCreateForm] = useState(initialCreateForm);
    const initialEditForm = {
        name: "",
        website: "",
        industry: "",
        agencySize: "",
        numberOfClients: "" as string | number,
        contactName: "",
        contactEmail: "",
        contactPhone: "",
        contactJobTitle: "",
        streetAddress: "",
        city: "",
        state: "",
        zip: "",
        country: "United States",
        subdomain: "",
        billingType: "" as "" | "paid" | "free" | "trial" | "custom",
        subscriptionTier: "" as string,
        customPricing: "" as string | number,
        internalNotes: "",
    };
    const [editForm, setEditForm] = useState(initialEditForm);
    const [loadingEditAgency, setLoadingEditAgency] = useState(false);
    const [setupIntentClientSecret, setSetupIntentClientSecret] = useState<string | null>(null);
    const [editSetupIntentClientSecret, setEditSetupIntentClientSecret] = useState<string | null>(null);
    const stripePaymentRef = useRef<StripePaymentHandle>(null);
    const editStripePaymentRef = useRef<StripePaymentHandle>(null);

    useEffect(() => {
        dispatch(fetchAgencies() as any);
    }, [dispatch]);

    const handledStripeRedirect = useRef(false);
    // When Stripe redirects back after 3DS etc., get payment method from server and complete agency creation
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const setupIntentId = params.get("setup_intent");
        const redirectStatus = params.get("redirect_status");
        if (redirectStatus !== "succeeded" || !setupIntentId || !setupIntentId.startsWith("seti_")) return;
        if (handledStripeRedirect.current) return;
        handledStripeRedirect.current = true;

        const raw = sessionStorage.getItem(CREATE_AGENCY_DRAFT_KEY);
        const cleanUrl = () => {
            params.delete("setup_intent");
            params.delete("setup_intent_client_secret");
            params.delete("redirect_status");
            const q = params.toString();
            window.history.replaceState({}, "", window.location.pathname + (q ? "?" + q : ""));
        };

        if (!raw) {
            cleanUrl();
            toast.error("Session expired. Please fill the form and try again.");
            return;
        }

        let draft: { createForm: typeof initialCreateForm };
        try {
            draft = JSON.parse(raw);
        } catch {
            sessionStorage.removeItem(CREATE_AGENCY_DRAFT_KEY);
            cleanUrl();
            toast.error("Invalid session. Please try again.");
            return;
        }

        api
            .post("/agencies/setup-intent/retrieve", { setupIntentId })
            .then((res) => {
                const paymentMethodId = res.data?.paymentMethodId;
                if (!paymentMethodId) {
                    sessionStorage.removeItem(CREATE_AGENCY_DRAFT_KEY);
                    cleanUrl();
                    toast.error("Could not retrieve payment method. Please try again.");
                    return;
                }
                const f = draft.createForm;
                const website = f.website.trim().startsWith("http") ? f.website.trim() : `https://${f.website.trim()}`;
                return dispatch(
                    createAgency({
                        name: f.name.trim(),
                        website,
                        industry: f.industry || undefined,
                        agencySize: f.agencySize || undefined,
                        numberOfClients: f.numberOfClients === "" ? undefined : Number(f.numberOfClients),
                        contactName: f.contactName.trim(),
                        contactEmail: f.contactEmail.trim(),
                        contactPhone: f.contactPhone || undefined,
                        contactJobTitle: f.contactJobTitle || undefined,
                        streetAddress: f.streetAddress || undefined,
                        city: f.city || undefined,
                        state: f.state || undefined,
                        zip: f.zip || undefined,
                        country: f.country || undefined,
                        subdomain: f.subdomain?.trim() || undefined,
                        billingOption: f.billingOption as "free_account" | "charge" | "no_charge" | "manual_invoice",
                        paymentMethodId,
                        tier: f.tier || undefined,
                        customPricing: f.billingOption === "manual_invoice" && f.customPricing !== "" ? Number(f.customPricing) : undefined,
                        internalNotes: f.internalNotes || undefined,
                        referralSource: f.referralSource || undefined,
                        referralSourceOther: f.referralSource === "referral" ? f.referralSourceOther : undefined,
                        primaryGoals: (f.primaryGoals?.length ? f.primaryGoals : undefined) as string[] | undefined,
                        primaryGoalsOther: f.primaryGoalsOther || undefined,
                        currentTools: f.currentTools || undefined,
                    }) as any
                )
                    .unwrap()
                    .then(() => {
                        sessionStorage.removeItem(CREATE_AGENCY_DRAFT_KEY);
                        cleanUrl();
                        toast.success("Agency created. Set-password email sent to contact.");
                        dispatch(fetchAgencies() as any);
                        window.dispatchEvent(new CustomEvent("agency-created"));
                    });
            })
            .catch((err: any) => {
                sessionStorage.removeItem(CREATE_AGENCY_DRAFT_KEY);
                cleanUrl();
                const msg = err?.response?.data?.message ?? err?.message ?? "Could not verify payment. Please try again.";
                toast.error(msg);
            });
    }, [dispatch]);

    useEffect(() => {
        const needsCard = createForm.billingOption === "charge" || createForm.billingOption === "manual_invoice";
        if (!showCreateModal || !needsCard) {
            setSetupIntentClientSecret(null);
            return;
        }
        if (!stripePk) return;
        let cancelled = false;
        api.post("/agencies/setup-intent")
            .then((res) => {
                if (!cancelled && res.data?.clientSecret) setSetupIntentClientSecret(res.data.clientSecret);
            })
            .catch(() => {
                if (!cancelled) toast.error("Could not load payment form.");
            });
        return () => { cancelled = true; };
    }, [showCreateModal, createForm.billingOption]);

    const editNeedsCard = (editForm.billingType === "paid" || editForm.billingType === "custom");
    useEffect(() => {
        if (!showEditAgencyModal || !editNeedsCard) {
            setEditSetupIntentClientSecret(null);
            return;
        }
        if (!stripePk) return;
        let cancelled = false;
        api.post("/agencies/setup-intent")
            .then((res) => {
                if (!cancelled && res.data?.clientSecret) setEditSetupIntentClientSecret(res.data.clientSecret);
            })
            .catch(() => {
                if (!cancelled) toast.error("Could not load payment form.");
            });
        return () => { cancelled = true; };
    }, [showEditAgencyModal, editNeedsCard]);

    const handleCreateAgency = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!createForm.name.trim()) {
            toast.error("Agency name is required.");
            return;
        }
        if (!createForm.website.trim()) {
            toast.error("Agency website is required.");
            return;
        }
        if (!createForm.contactName.trim()) {
            toast.error("Primary contact name is required.");
            return;
        }
        if (!createForm.contactEmail.trim()) {
            toast.error("Contact email is required.");
            return;
        }
        if (!createForm.billingOption) {
            toast.error("Please select a billing type.");
            return;
        }
        if (createForm.billingOption === "charge" && !createForm.tier) {
            toast.error("Please select a subscription tier.");
            return;
        }
        const needsCard = createForm.billingOption === "charge" || createForm.billingOption === "manual_invoice";
        if (needsCard && (!stripePk || !setupIntentClientSecret)) {
            toast.error("Payment form is not ready. Add VITE_STRIPE_PUBLISHABLE_KEY or try again.");
            return;
        }
        let paymentMethodId: string | undefined;
        if (needsCard) {
            if (!stripePaymentRef.current) {
                toast.error("Payment form is still loading. Please wait a moment and try again.");
                return;
            }
            try {
                sessionStorage.setItem(CREATE_AGENCY_DRAFT_KEY, JSON.stringify({ createForm }));
                const id = await stripePaymentRef.current.confirmAndGetPaymentMethod();
                if (!id) {
                    toast.error("Please complete the card details.");
                    return;
                }
                paymentMethodId = id;
            } catch (err: any) {
                toast.error(err?.message ?? "Payment failed. Please check card details.");
                return;
            }
        }
        const website = createForm.website.trim().startsWith("http") ? createForm.website.trim() : `https://${createForm.website.trim()}`;
        try {
            console.log("[Create Agency] Sending request to API...");
            await dispatch(createAgency({
                name: createForm.name.trim(),
                website,
                industry: createForm.industry || undefined,
                agencySize: createForm.agencySize || undefined,
                numberOfClients: createForm.numberOfClients === "" ? undefined : Number(createForm.numberOfClients),
                contactName: createForm.contactName.trim(),
                contactEmail: createForm.contactEmail.trim(),
                contactPhone: createForm.contactPhone || undefined,
                contactJobTitle: createForm.contactJobTitle || undefined,
                streetAddress: createForm.streetAddress || undefined,
                city: createForm.city || undefined,
                state: createForm.state || undefined,
                zip: createForm.zip || undefined,
                country: createForm.country || undefined,
                subdomain: createForm.subdomain?.trim() || undefined,
                billingOption: createForm.billingOption,
                paymentMethodId,
                tier: (createForm.billingOption === "no_charge" || createForm.billingOption === "free_account") ? undefined : (createForm.tier || undefined),
                customPricing: createForm.billingOption === "manual_invoice" && createForm.customPricing !== "" ? Number(createForm.customPricing) : undefined,
                internalNotes: createForm.internalNotes || undefined,
                referralSource: createForm.referralSource || undefined,
                referralSourceOther: createForm.referralSource === "referral" ? createForm.referralSourceOther : undefined,
                primaryGoals: createForm.primaryGoals.length ? createForm.primaryGoals : undefined,
                primaryGoalsOther: createForm.primaryGoalsOther || undefined,
                currentTools: createForm.currentTools || undefined,
            }) as any).unwrap();
            setCreateForm(initialCreateForm);
            setShowCreateModal(false);
            sessionStorage.removeItem(CREATE_AGENCY_DRAFT_KEY);
            toast.success("Agency created. Set-password email sent to contact.");
            dispatch(fetchAgencies() as any);
            window.dispatchEvent(new CustomEvent("agency-created"));
        } catch (error: any) {
            const msg = error?.message ?? error?.response?.data?.message ?? "Failed to create agency.";
            toast.error(msg);
        }
    };

    const handleDeleteAgency = (agencyId: string, agencyName: string) => {
        setDeleteAgencyConfirm({ isOpen: true, agencyId, agencyName });
    };

    const handleEditAgencyClick = async (agencyId: string, agencyName: string) => {
        setEditingAgency({ id: agencyId, name: agencyName });
        setShowEditAgencyModal(true);
        setLoadingEditAgency(true);
        try {
            const res = await api.get(`/agencies/${agencyId}`);
            const a = res.data;
            setEditingAgencyHasStripeCustomer(!!a.hasStripeCustomer);
            setEditForm({
                name: a.name ?? "",
                website: a.website ?? "",
                industry: a.industry ?? "",
                agencySize: a.agencySize ?? "",
                numberOfClients: a.numberOfClients ?? "",
                contactName: a.contactName ?? "",
                contactEmail: a.contactEmail ?? "",
                contactPhone: a.contactPhone ?? "",
                contactJobTitle: a.contactJobTitle ?? "",
                streetAddress: a.streetAddress ?? "",
                city: a.city ?? "",
                state: a.state ?? "",
                zip: a.zip ?? "",
                country: a.country ?? "United States",
                subdomain: a.subdomain ?? "",
                billingType: (a.billingType ?? "") as "" | "paid" | "free" | "trial" | "custom",
                subscriptionTier: a.subscriptionTier ?? "",
                customPricing: a.customPricing ?? "",
                internalNotes: a.internalNotes ?? "",
            });
        } catch (err: any) {
            toast.error(err?.response?.data?.message ?? "Failed to load agency");
            setShowEditAgencyModal(false);
            setEditingAgency(null);
        } finally {
            setLoadingEditAgency(false);
        }
    };

    const handleUpdateAgency = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!editingAgency) return;
        if (!editForm.name.trim()) {
            toast.error("Agency name is required.");
            return;
        }
        if (!editForm.website.trim()) {
            toast.error("Agency website is required.");
            return;
        }
        if (!editForm.contactName.trim()) {
            toast.error("Primary contact name is required.");
            return;
        }
        if (!editForm.contactEmail.trim()) {
            toast.error("Contact email is required.");
            return;
        }
        const editNeedsCardNow = editForm.billingType === "paid" || editForm.billingType === "custom";
        const cardRequired = editNeedsCardNow && !editingAgencyHasStripeCustomer;
        if (cardRequired && (!stripePk || !editSetupIntentClientSecret)) {
            toast.error("Payment form is not ready. Add VITE_STRIPE_PUBLISHABLE_KEY or try again.");
            return;
        }
        let paymentMethodId: string | undefined;
        if (editNeedsCardNow && !editingAgencyHasStripeCustomer) {
            if (!editStripePaymentRef.current) {
                toast.error("Payment form is still loading. Please wait a moment and try again.");
                return;
            }
            try {
                const id = await editStripePaymentRef.current.confirmAndGetPaymentMethod();
                if (!id) {
                    toast.error("Please complete the card details.");
                    return;
                }
                paymentMethodId = id;
            } catch (err: any) {
                toast.error(err?.message ?? "Payment failed. Please check card details.");
                return;
            }
        }
        const website = editForm.website.trim().startsWith("http") ? editForm.website.trim() : `https://${editForm.website.trim()}`;
        try {
            const updatePayload: Record<string, unknown> = {
                name: editForm.name.trim(),
                website,
                industry: editForm.industry || undefined,
                agencySize: editForm.agencySize || undefined,
                numberOfClients: editForm.numberOfClients === "" ? undefined : Number(editForm.numberOfClients),
                contactName: editForm.contactName.trim(),
                contactEmail: editForm.contactEmail.trim(),
                contactPhone: editForm.contactPhone || undefined,
                contactJobTitle: editForm.contactJobTitle || undefined,
                streetAddress: editForm.streetAddress || undefined,
                city: editForm.city || undefined,
                state: editForm.state || undefined,
                zip: editForm.zip || undefined,
                country: editForm.country || undefined,
                // Send empty string when blank so backend clears agency subdomain (converts "" to null)
                subdomain: editForm.subdomain != null && editForm.subdomain.trim() !== "" ? editForm.subdomain.trim() : "",
                billingType: editForm.billingType || undefined,
                subscriptionTier: editForm.subscriptionTier || undefined,
                customPricing: editForm.billingType === "custom" && editForm.customPricing !== "" ? Number(editForm.customPricing) : undefined,
                internalNotes: editForm.internalNotes || undefined,
            };
            if (paymentMethodId) updatePayload.paymentMethodId = paymentMethodId;
            await dispatch(updateAgency({ agencyId: editingAgency.id, data: updatePayload as any }) as any).unwrap();
            setShowEditAgencyModal(false);
            setEditingAgency(null);
            setEditForm(initialEditForm);
            toast.success("Agency updated successfully!");
            dispatch(fetchAgencies() as any);
        } catch (error: any) {
            toast.error(error?.message ?? error?.response?.data?.message ?? "Failed to update agency");
        }
    };

    const confirmDeleteAgency = async () => {
        if (!deleteAgencyConfirm.agencyId) return;
        try {
            await dispatch(deleteAgency(deleteAgencyConfirm.agencyId) as any);
            toast.success("Agency deleted successfully!");
            setDeleteAgencyConfirm({ isOpen: false, agencyId: null, agencyName: null });
            dispatch(fetchAgencies() as any);
            // Notify Team page so it refetches and removes the agency from members' lists
            window.dispatchEvent(new CustomEvent("agency-deleted"));
        } catch (error: any) {
            console.error("Failed to delete agency:", error);
            setDeleteAgencyConfirm({ isOpen: false, agencyId: null, agencyName: null });
        }
    };

    const handleAssignClientToAgency = async (agencyId: string, clientId: string) => {
        try {
            await dispatch(assignClientToAgency({ agencyId, clientId }) as any);
            toast.success("Client assigned to agency successfully!");
            if (expandedAgencyId === agencyId) {
                await refreshAgencyClientsCache(agencyId);
            }
            if (selectedAgencyId === agencyId) {
                handleViewClients(agencyId, selectedAgencyName);
            }
            setAssignClientModal({ isOpen: false, clientId: null, clientName: null });
        } catch (error: any) {
            console.error("Failed to assign client:", error);
        }
    };

    const handleRemoveClientFromAgency = (agencyId: string, clientId: string, clientName: string) => {
        setRemoveClientConfirm({
            isOpen: true,
            agencyId,
            clientId,
            clientName,
        });
    };

    const confirmRemoveClientFromAgency = async () => {
        if (!removeClientConfirm.agencyId || !removeClientConfirm.clientId) return;
        const agencyId = removeClientConfirm.agencyId;
        const clientId = removeClientConfirm.clientId;
        try {
            await dispatch(removeClientFromAgency({ 
                agencyId, 
                clientId 
            }) as any);
            toast.success("Client removed from agency successfully!");
            
            // Immediately remove from cache to update UI
            setAgencyClientsByAgencyId((prev) => {
                const updated = { ...prev };
                if (updated[agencyId]) {
                    updated[agencyId] = updated[agencyId].filter(client => client.id !== clientId);
                }
                return updated;
            });
            
            // Also remove from clients modal state if open
            if (selectedAgencyId === agencyId) {
                setClients((prev) => prev.filter(client => client.id !== clientId));
            }
            
            // Refresh the clients cache for the expanded agency to ensure consistency
            if (expandedAgencyId === agencyId) {
                await refreshAgencyClientsCache(agencyId);
            }
            
            // Refresh the clients modal if open
            if (selectedAgencyId === agencyId) {
                handleViewClients(agencyId, selectedAgencyName);
            }
            
            // Refresh the agencies list to update client count
            dispatch(fetchAgencies() as any);
            
            setRemoveClientConfirm({ isOpen: false, agencyId: null, clientId: null, clientName: null });
        } catch (error: any) {
            console.error("Failed to remove client from agency:", error);
            toast.error(error?.response?.data?.message || "Failed to remove client from agency");
            setRemoveClientConfirm({ isOpen: false, agencyId: null, clientId: null, clientName: null });
        }
    };

    const loadAllClients = async () => {
        setLoadingAllClients(true);
        try {
            const response = await api.get("/clients");
            setAllClients(response.data || []);
        } catch (error: any) {
            console.error("Failed to fetch clients:", error);
            toast.error(error.response?.data?.message || "Failed to fetch clients");
        } finally {
            setLoadingAllClients(false);
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
            SPECIALIST: "bg-secondary-100 text-secondary-800",
            ADMIN: "bg-accent-100 text-accent-800",
            SUPER_ADMIN: "bg-purple-100 text-purple-800",
        };
        return styles[role as keyof typeof styles] || "bg-gray-100 text-gray-800";
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case CLIENT_STATUS.ACTIVE:
                return "bg-green-100 text-green-800";
            case CLIENT_STATUS.PENDING:
                return "bg-amber-100 text-amber-800";
            case CLIENT_STATUS.CANCELED:
            case CLIENT_STATUS.SUSPENDED:
                return "bg-red-100 text-red-800";
            case CLIENT_STATUS.ARCHIVED:
            case CLIENT_STATUS.REJECTED:
                return "bg-gray-100 text-gray-600 line-through";
            case CLIENT_STATUS.DASHBOARD_ONLY:
            default:
                return "bg-gray-100 text-gray-700";
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case CLIENT_STATUS.DASHBOARD_ONLY:
                return "Dashboard Only";
            case CLIENT_STATUS.PENDING:
                return "Pending";
            case CLIENT_STATUS.ACTIVE:
                return "Active";
            case CLIENT_STATUS.CANCELED:
                return "Canceled";
            case CLIENT_STATUS.SUSPENDED:
                return "Suspended";
            case CLIENT_STATUS.ARCHIVED:
            case CLIENT_STATUS.REJECTED:
                return "Archived";
            default:
                return "Dashboard Only";
        }
    };

    const showStatusAlertIcon = (status: string) => status === CLIENT_STATUS.PENDING;

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

    const handleViewReportClick = (client: AgencyClient) => {
        navigate(`/agency/clients/${client.id}`, { state: { client, tab: "report" } });
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
        navigate("/agency/clients", { state: { openEditClientId: client.id } });
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

    const handleSort = (field: "agency" | "subdomain" | "clients") => {
        if (sortField === field) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDirection("asc");
        }
    };

    const sortedAgencies = [...agencies].sort((a, b) => {
        let aValue: string | number;
        let bValue: string | number;

        if (sortField === "agency") {
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
        } else if (sortField === "subdomain") {
            aValue = (a.subdomain || "").toLowerCase();
            bValue = (b.subdomain || "").toLowerCase();
        } else {
            // clients
            aValue = (a as any).clientCount || 0;
            bValue = (b as any).clientCount || 0;
        }

        if (typeof aValue === "string" && typeof bValue === "string") {
            if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
            if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
        } else {
            if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
            if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
        }
        return 0;
    });

    const filteredAgencies = agenciesSearch.trim()
        ? sortedAgencies.filter((agency) => {
            const q = agenciesSearch.trim().toLowerCase();
            const name = (agency.name || "").toLowerCase();
            const subdomain = (agency.subdomain || "").toLowerCase();
            return name.includes(q) || subdomain.includes(q);
          })
        : sortedAgencies;

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

            {/* Search */}
            <div className="mb-4">
                <div className="relative max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search by agency name or subdomain..."
                        value={agenciesSearch}
                        onChange={(e) => setAgenciesSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Agencies Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                                <th
                                    className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider cursor-pointer hover:from-primary-100 hover:via-blue-100 hover:to-indigo-100 select-none transition-colors border-l-4 border-transparent border-l-primary-400 first:border-l-0"
                                    onClick={() => handleSort("agency")}
                                >
                                    <div className="flex items-center gap-2">
                                        Name
                                        {sortField === "agency" && (
                                            sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-primary-600" /> : <ArrowDown className="h-3.5 w-3.5 text-primary-600" />
                                        )}
                                    </div>
                                </th>
                                <th
                                    className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider cursor-pointer hover:from-primary-100 hover:via-blue-100 select-none transition-colors border-l-4 border-emerald-300"
                                    onClick={() => handleSort("subdomain")}
                                >
                                    <div className="flex items-center gap-2">
                                        Subdomain
                                        {sortField === "subdomain" && (
                                            sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-emerald-600" /> : <ArrowDown className="h-3.5 w-3.5 text-emerald-600" />
                                        )}
                                    </div>
                                </th>
                                <th
                                    className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider cursor-pointer hover:from-primary-100 hover:via-blue-100 select-none transition-colors border-l-4 border-amber-300"
                                    onClick={() => handleSort("clients")}
                                >
                                    <div className="flex items-center gap-2">
                                        Clients
                                        {sortField === "clients" && (
                                            sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-amber-600" /> : <ArrowDown className="h-3.5 w-3.5 text-amber-600" />
                                        )}
                                    </div>
                                </th>
                                <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">
                                    Created
                                </th>
                                <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500 bg-gray-50/50">
                                        Loading agencies...
                                    </td>
                                </tr>
                            ) : filteredAgencies.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500 bg-amber-50/50">
                                        {agenciesSearch.trim() ? "No agencies match your search." : "No agencies found. Create your first agency."}
                                    </td>
                                </tr>
                            ) : (
                                filteredAgencies.map((agency, index) => (
                                <React.Fragment key={agency.id}>
                                    <tr
                                        className={`cursor-pointer transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}
                                        onClick={() => toggleAgencyClientsDropdown(agency.id, agency.name)}
                                        aria-expanded={expandedAgencyId === agency.id}
                                    >
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                                {expandedAgencyId === agency.id ? (
                                                    <ChevronDown className="h-4 w-4 text-primary-500 shrink-0" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                                                )}
                                                <span className="text-gray-900">{agency.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {(() => {
                                                const sd = agency.subdomain != null ? String(agency.subdomain).trim() : "";
                                                const isBlank = !sd || sd.toLowerCase() === "null";
                                                return isBlank ? (
                                                    <span className="text-sm text-gray-500">-</span>
                                                ) : (
                                                    <a
                                                        className="text-sm font-medium text-primary-600 hover:text-primary-700 underline underline-offset-1 decoration-primary-300 hover:decoration-primary-500 transition-colors"
                                                        href={`https://${sd}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        {sd}
                                                    </a>
                                                );
                                            })()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="inline-flex items-center justify-center min-w-[2rem] px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                                                {(agency as any).clientCount ?? 0}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm text-slate-600">
                                                {new Date(agency.createdAt).toLocaleDateString()}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleEditAgencyClick(agency.id, agency.name);
                                                    }}
                                                    className="p-2 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                                                    title="Edit Agency"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleViewMembers(agency.id, agency.name);
                                                    }}
                                                    className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                                    title="View Members"
                                                >
                                                    <Users className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleViewClients(agency.id, agency.name);
                                                    }}
                                                    className="p-2 rounded-lg text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                                                    title="View Clients"
                                                >
                                                    <BuildingIcon className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteAgency(agency.id, agency.name);
                                                    }}
                                                    className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                    title="Delete Agency"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>

                                    {expandedAgencyId === agency.id && (
                                        <tr className="bg-primary-50/30">
                                            <td colSpan={5} className="px-6 py-4">
                                                <div className="bg-white rounded-lg border border-primary-100 shadow-sm overflow-hidden">
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
                                                                <thead>
                                                                    <tr className="bg-gradient-to-r from-slate-50 to-gray-50 border-b border-slate-200">
                                                                        <th className="px-6 py-2.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Name</th>
                                                                        <th className="px-6 py-2.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Domain</th>
                                                                        <th className="px-6 py-2.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Industy</th>
                                                                        <th className="px-6 py-2.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Status</th>
                                                                        <th className="px-6 py-2.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Created Date</th>
                                                                        <th className="px-6 py-2.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Actions</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="bg-white divide-y divide-gray-100">
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
                                                                                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded-full ${getStatusBadge(client.status)}`}
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setOpenStatusId(openStatusId === client.id ? "" : client.id);
                                                                                        }}
                                                                                    >
                                                                                        {showStatusAlertIcon(client.status) && <AlertCircle className="h-3 w-3 shrink-0" />}
                                                                                        {getStatusLabel(client.status)}
                                                                                    </button>
                                                                                    {client.status === CLIENT_STATUS.CANCELED && client.canceledEndDate && (
                                                                                        <span className="ml-1 text-xs text-red-600">
                                                                                            {format(new Date(client.canceledEndDate), "MMM d, yyyy")}
                                                                                        </span>
                                                                                    )}
                                                                                    {openStatusId === client.id && statusButtonRefs.current[client.id] && createPortal(
                                                                                        <div
                                                                                            data-status-dropdown-menu
                                                                                            className="fixed bg-white border border-gray-200 rounded-md shadow-lg min-w-[160px]"
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
                                                                                                        try {
                                                                                                            const data: { status: string; canceledEndDate?: string } = { status: value };
                                                                                                            if (value === "CANCELED") {
                                                                                                                data.canceledEndDate = new Date().toISOString();
                                                                                                            }
                                                                                                            await dispatch(updateClient({ id: client.id, data }) as any);
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
                                                                                        title="Open Dashboard"
                                                                                    >
                                                                                        <Eye className="h-4 w-4" />
                                                                                    </button>
                                                                                    <button
                                                                                        className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleViewReportClick(client);
                                                                                        }}
                                                                                        title="View Report"
                                                                                    >
                                                                                        <FileText className="h-4 w-4" />
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
                                                                                        title="Edit"
                                                                                    >
                                                                                        <Edit className="h-4 w-4" />
                                                                                    </button>
                                                                                    <button
                                                                                        className="p-1 text-gray-400 hover:text-orange-600 transition-colors"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleRemoveClientFromAgency(agency.id, client.id, client.name);
                                                                                        }}
                                                                                        title="Remove from Agency"
                                                                                    >
                                                                                        <UserMinus className="h-4 w-4" />
                                                                                    </button>
                                                                                    <button
                                                                                        className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleDeleteClient(client.id);
                                                                                        }}
                                                                                        title="Delete Client"
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
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-gray-200/80 w-full max-w-5xl mx-4 h-[90vh] max-h-[720px] flex flex-col overflow-hidden">
                        <div className="flex justify-between items-center px-6 py-5 shrink-0 bg-gradient-to-r from-primary-600 via-primary-500 to-blue-600 text-white rounded-t-2xl">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20">
                                    <BuildingIcon className="h-5 w-5" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold">Create New Agency</h2>
                                    <p className="text-sm text-white/90">Add a new agency and primary contact</p>
                                </div>
                            </div>
                            <button type="button" onClick={() => { setShowCreateModal(false); setCreateModalStep(1); }} className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col flex-1 min-h-0 bg-gray-50/50 overflow-hidden">
                            {/* Step indicator */}
                            <div className="px-6 pt-4 pb-2 shrink-0 border-b border-gray-200 bg-white">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-gray-600">Step {createModalStep} of 5</span>
                                    <div className="flex gap-1.5">
                                        {[1, 2, 3, 4, 5].map((s) => (
                                            <button
                                                key={s}
                                                type="button"
                                                onClick={() => setCreateModalStep(s)}
                                                className={`h-2 rounded-full transition-all ${s === createModalStep ? "w-6 bg-primary-600" : "w-2 bg-gray-300 hover:bg-gray-400"}`}
                                                aria-label={`Go to step ${s}`}
                                            />
                                        ))}
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500">
                                    {createModalStep === 1 && "Agency Information"}
                                    {createModalStep === 2 && "Primary Contact"}
                                    {createModalStep === 3 && "Business Address & White Label Subdomain"}
                                    {createModalStep === 4 && "Billing & Subscription"}
                                    {createModalStep === 5 && "Additional Questions"}
                                </p>
                            </div>
                            <div className="p-6 overflow-y-auto flex-1 min-h-0">
                                {createModalStep === 1 && (
                                <>
                                {/* Part 1: Agency Information */}
                                <section className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5">
                                    <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                        AGENCY INFORMATION (Required)
                                    </h3>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Agency Name *</label>
                                            <input type="text" required value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. TKM Agency" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Agency Website *</label>
                                            <input type="url" required value={createForm.website} onChange={(e) => setCreateForm({ ...createForm, website: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="https://tkmdigital.com" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Industry/Specialty</label>
                                            <select value={createForm.industry} onChange={(e) => setCreateForm({ ...createForm, industry: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                                                <option value="">Select...</option>
                                                <option value="Full Service Agency">Full Service Agency</option>
                                                <option value="SEO Specialist">SEO Specialist</option>
                                                <option value="Web Design">Web Design</option>
                                                <option value="PPC Agency">PPC Agency</option>
                                                <option value="Social Media">Social Media</option>
                                                <option value="Local Marketing">Local Marketing</option>
                                                <option value="Other">Other</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Agency Size</label>
                                            <select value={createForm.agencySize} onChange={(e) => setCreateForm({ ...createForm, agencySize: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                                                <option value="">Select...</option>
                                                <option value="Solo (1 person)">Solo (1 person)</option>
                                                <option value="Small (2-5 employees)">Small (2-5 employees)</option>
                                                <option value="Medium (6-15 employees)">Medium (6-15 employees)</option>
                                                <option value="Large (16-30 employees)">Large (16-30 employees)</option>
                                                <option value="Enterprise (30+ employees)">Enterprise (30+ employees)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Number of Current Clients</label>
                                            <input type="number" min={0} value={createForm.numberOfClients} onChange={(e) => setCreateForm({ ...createForm, numberOfClients: e.target.value === "" ? "" : Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. 12" />
                                        </div>
                                    </div>
                                </section>
                                </>
                                )}
                                {createModalStep === 2 && (
                                <section className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-4 sm:p-5">
                                    <h3 className="text-sm font-semibold text-emerald-900 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                        PRIMARY CONTACT (Required)
                                    </h3>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Primary Contact Name *</label>
                                            <input type="text" required value={createForm.contactName} onChange={(e) => setCreateForm({ ...createForm, contactName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. Johnny Doe" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email * (login email)</label>
                                            <input type="email" required value={createForm.contactEmail} onChange={(e) => setCreateForm({ ...createForm, contactEmail: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="johnny@tkmdigital.com" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                                            <input type="tel" value={createForm.contactPhone} onChange={(e) => setCreateForm({ ...createForm, contactPhone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="+1 (631) 555-1234" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Job Title</label>
                                            <input type="text" value={createForm.contactJobTitle} onChange={(e) => setCreateForm({ ...createForm, contactJobTitle: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Owner, Marketing Director, SEO Manager" />
                                        </div>
                                    </div>
                                </section>
                                )}
                                {createModalStep === 3 && (
                                <>
                                {/* Part 3: Business Address & White Label Subdomain */}
                                <section className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-4 sm:p-5">
                                    <h3 className="text-sm font-semibold text-amber-900 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                        BUSINESS ADDRESS (Optional)
                                    </h3>
                                    <div className="space-y-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="sm:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Street Address</label>
                                            <input type="text" value={createForm.streetAddress} onChange={(e) => setCreateForm({ ...createForm, streetAddress: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="375 Commack Road" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                                            <input type="text" value={createForm.city} onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Deer Park" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">State/Province</label>
                                            <input type="text" value={createForm.state} onChange={(e) => setCreateForm({ ...createForm, state: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="NY" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">ZIP/Postal Code</label>
                                            <input type="text" value={createForm.zip} onChange={(e) => setCreateForm({ ...createForm, zip: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="11729" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                                            <select value={createForm.country} onChange={(e) => setCreateForm({ ...createForm, country: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                                                <option value="United States">United States</option>
                                                <option value="Canada">Canada</option>
                                                <option value="United Kingdom">United Kingdom</option>
                                                <option value="Other">Other</option>
                                            </select>
                                        </div>
                                    </div>
                                </section>

                                {/* Section D: Subdomain (still part 3) */}
                                <section className="rounded-xl border-l-4 border-violet-500 bg-violet-50/50 p-4 sm:p-5 mt-4">
                                    <h3 className="text-sm font-semibold text-violet-900 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                        WHITE LABEL SUBDOMAIN (Optional)
                                    </h3>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Custom Subdomain</label>
                                        <input type="text" value={createForm.subdomain} onChange={(e) => setCreateForm({ ...createForm, subdomain: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="tkmdigital" />
                                        <p className="mt-1 text-xs text-gray-500">e.g. tkmdigital → tkmdigital.yourplatform.com. Leave blank if not needed.</p>
                                    </div>
                                </section>
                                </>
                                )}
                                {createModalStep === 4 && (
                                <section className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50/50 p-4 sm:p-5">
                                    <h3 className="text-sm font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                        BILLING & SUBSCRIPTION
                                    </h3>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Billing Type *</label>
                                            <div className="space-y-2">
                                                <label className="flex items-center gap-2">
                                                    <input type="radio" name="billingOption" value="free_account" checked={createForm.billingOption === "free_account"} onChange={(e) => setCreateForm({ ...createForm, billingOption: "free_account", tier: "" })} className="text-primary-600" />
                                                    <span>Free Account</span>
                                                    <span className="text-xs text-gray-500">(Free tier, no payment)</span>
                                                </label>
                                                <label className="flex items-center gap-2">
                                                    <input type="radio" name="billingOption" value="charge" checked={createForm.billingOption === "charge"} onChange={(e) => setCreateForm({ ...createForm, billingOption: "charge" })} className="text-primary-600" />
                                                    <span>Charge to Card</span>
                                                    <span className="text-xs text-gray-500">(any tier, subscription immediately)</span>
                                                </label>
                                                <label className="flex items-center gap-2">
                                                    <input type="radio" name="billingOption" value="no_charge" checked={createForm.billingOption === "no_charge"} onChange={(e) => setCreateForm({ ...createForm, billingOption: "no_charge", tier: "" })} className="text-primary-600" />
                                                    <span>No Charge during 7 days trial</span>
                                                    <span className="text-xs text-gray-500">(Free tier for 7 days, then must subscribe)</span>
                                                </label>
                                                <label className="flex items-center gap-2">
                                                    <input type="radio" name="billingOption" value="manual_invoice" checked={createForm.billingOption === "manual_invoice"} onChange={(e) => setCreateForm({ ...createForm, billingOption: "manual_invoice" })} className="text-primary-600" />
                                                    <span>Enterprise</span>
                                                    <span className="text-xs text-gray-500">(manual invoice)</span>
                                                </label>
                                            </div>
                                        </div>
                                        {(createForm.billingOption === "charge" || createForm.billingOption === "manual_invoice") && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-2">Card details *</label>
                                                {!stripePk ? (
                                                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Add <code className="px-1 bg-amber-100 rounded">VITE_STRIPE_PUBLISHABLE_KEY</code> to the app environment to collect payment methods.</p>
                                                ) : setupIntentClientSecret && stripePromise ? (
                                                    <Elements stripe={stripePromise} options={{ clientSecret: setupIntentClientSecret }}>
                                                        <StripePaymentSection ref={stripePaymentRef} clientSecret={setupIntentClientSecret} />
                                                    </Elements>
                                                ) : (
                                                    <p className="text-sm text-gray-500">Loading payment form…</p>
                                                )}
                                                <p className="mt-1 text-xs text-gray-500">Agency will be integrated with Stripe for billing.</p>
                                            </div>
                                        )}
                                        {createForm.billingOption === "free_account" && (
                                            <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                                                Agency will use <strong>Free</strong> tier with no payment required.
                                            </p>
                                        )}
                                        {createForm.billingOption === "no_charge" && (
                                            <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                                                Agency will use <strong>Free</strong> tier during the 7-day trial. After the trial, they must proceed to payment.
                                            </p>
                                        )}
                                        {createForm.billingOption !== "no_charge" && createForm.billingOption !== "free_account" && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Subscription Tier *</label>
                                            <select value={createForm.tier} onChange={(e) => setCreateForm({ ...createForm, tier: e.target.value as typeof createForm.tier })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                                                <option value="">Select tier</option>
                                                <optgroup label="Agency tiers">
                                                    <option value="solo">Solo ($147/mo) – 3 dashboards</option>
                                                    <option value="starter">Starter ($297/mo) – 10 dashboards</option>
                                                    <option value="growth">Growth ($597/mo) – 25 dashboards</option>
                                                    <option value="pro">Pro ($997/mo) – 50 dashboards</option>
                                                    <option value="enterprise">Enterprise (Custom) – Unlimited</option>
                                                </optgroup>
                                                <optgroup label="Business tiers">
                                                    <option value="business_lite">Business Lite ($79/mo) – 1 dashboard</option>
                                                    <option value="business_pro">Business Pro ($197/mo) – 1 dashboard</option>
                                                </optgroup>
                                            </select>
                                        </div>
                                        )}
                                        {createForm.billingOption === "manual_invoice" && (
                                            <>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Custom pricing</label>
                                                    <input type="number" step="0.01" min={0} value={createForm.customPricing} onChange={(e) => setCreateForm({ ...createForm, customPricing: e.target.value === "" ? "" : Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="0.00" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Internal notes</label>
                                                    <textarea value={createForm.internalNotes} onChange={(e) => setCreateForm({ ...createForm, internalNotes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Notes for internal use" />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </section>
                                )}
                                {createModalStep === 5 && (
                                <>
                                <section className="rounded-xl border-l-4 border-teal-500 bg-teal-50/50 p-4 sm:p-5">
                                    <h3 className="text-sm font-semibold text-teal-900 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                                        ADDITIONAL QUESTIONS (Optional)
                                    </h3>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">How did you hear about us?</label>
                                            <select value={createForm.referralSource} onChange={(e) => setCreateForm({ ...createForm, referralSource: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                                                <option value="">Select...</option>
                                                <option value="Google Search">Google Search</option>
                                                <option value="referral">Referral</option>
                                                <option value="Social Media">Social Media</option>
                                                <option value="Industry Event">Industry Event</option>
                                                <option value="Cold Outreach">Cold Outreach</option>
                                                <option value="Other">Other</option>
                                            </select>
                                            {createForm.referralSource === "referral" && (
                                                <input type="text" value={createForm.referralSourceOther} onChange={(e) => setCreateForm({ ...createForm, referralSourceOther: e.target.value })} className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Referral from..." />
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">What's your primary goal? (select multiple)</label>
                                            <div className="space-y-1 flex flex-wrap gap-2">
                                                {["White label reporting for clients", "Outsource SEO fulfillment", "Scale my agency", "Better client retention"].map((goal) => (
                                                    <label key={goal} className="flex items-center gap-2">
                                                        <input type="checkbox" checked={createForm.primaryGoals.includes(goal)} onChange={(e) => setCreateForm({ ...createForm, primaryGoals: e.target.checked ? [...createForm.primaryGoals, goal] : createForm.primaryGoals.filter((g) => g !== goal) })} className="rounded border-gray-300 text-primary-600" />
                                                        <span className="text-sm">{goal}</span>
                                                    </label>
                                                ))}
                                                <label className="flex items-center gap-2">
                                                    <input type="checkbox" checked={createForm.primaryGoals.includes("Other")} onChange={(e) => setCreateForm({ ...createForm, primaryGoals: e.target.checked ? [...createForm.primaryGoals, "Other"] : createForm.primaryGoals.filter((g) => g !== "Other") })} className="rounded border-gray-300 text-primary-600" />
                                                    <span className="text-sm">Other</span>
                                                    {createForm.primaryGoals.includes("Other") && <input type="text" value={createForm.primaryGoalsOther} onChange={(e) => setCreateForm({ ...createForm, primaryGoalsOther: e.target.value })} className="ml-1 px-2 py-1 border rounded text-sm w-40" placeholder="Specify" />}
                                                </label>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">What tools are you currently using? (select multiple)</label>
                                            <div className="space-y-2">
                                                {["SEMrush", "Ahrefs", "AgencyAnalytics"].map((tool) => {
                                                    const toolsList = createForm.currentTools ? createForm.currentTools.split(",").map((t) => t.trim()).filter(Boolean) : [];
                                                    const isChecked = toolsList.includes(tool);
                                                    return (
                                                        <label key={tool} className="flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={isChecked}
                                                                onChange={(e) => {
                                                                    const currentToolsList = createForm.currentTools ? createForm.currentTools.split(",").map((t) => t.trim()).filter(Boolean) : [];
                                                                    if (e.target.checked) {
                                                                        setCreateForm({ ...createForm, currentTools: [...currentToolsList.filter((t) => t !== tool), tool].join(", ") });
                                                                    } else {
                                                                        setCreateForm({ ...createForm, currentTools: currentToolsList.filter((t) => t !== tool).join(", ") });
                                                                    }
                                                                }}
                                                                className="rounded border-gray-300 text-primary-600"
                                                            />
                                                            <span className="text-sm">{tool}</span>
                                                        </label>
                                                    );
                                                })}
                                                <label className="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={(() => {
                                                            if (!createForm.currentTools) return false;
                                                            const toolsList = createForm.currentTools.split(",").map((t) => t.trim()).filter(Boolean);
                                                            return toolsList.includes("Other") || toolsList.some((t) => !["SEMrush", "Ahrefs", "AgencyAnalytics"].includes(t));
                                                        })()}
                                                        onChange={(e) => {
                                                            const currentToolsList = createForm.currentTools ? createForm.currentTools.split(",").map((t) => t.trim()).filter(Boolean) : [];
                                                            const knownTools = currentToolsList.filter((t) => ["SEMrush", "Ahrefs", "AgencyAnalytics"].includes(t));
                                                            const otherTools = currentToolsList.filter((t) => !["SEMrush", "Ahrefs", "AgencyAnalytics", "Other"].includes(t));
                                                            if (e.target.checked) {
                                                                setCreateForm({ ...createForm, currentTools: [...knownTools, ...otherTools, "Other"].join(", ") });
                                                            } else {
                                                                setCreateForm({ ...createForm, currentTools: knownTools.join(", ") });
                                                            }
                                                        }}
                                                        className="rounded border-gray-300 text-primary-600"
                                                    />
                                                    <span className="text-sm">Other</span>
                                                </label>
                                            </div>
                                            {(() => {
                                                if (!createForm.currentTools) return null;
                                                const toolsList = createForm.currentTools.split(",").map((t) => t.trim()).filter(Boolean);
                                                const otherTools = toolsList.filter((t) => !["SEMrush", "Ahrefs", "AgencyAnalytics", "Other"].includes(t));
                                                if (otherTools.length === 0) return null;
                                                return (
                                                    <input
                                                        type="text"
                                                        value={otherTools.join(", ")}
                                                        onChange={(e) => {
                                                            const knownTools = createForm.currentTools ? createForm.currentTools.split(",").map((t) => t.trim()).filter((t) => ["SEMrush", "Ahrefs", "AgencyAnalytics", "Other"].includes(t)) : [];
                                                            const newOtherValue = e.target.value.trim();
                                                            setCreateForm({ ...createForm, currentTools: [...knownTools, newOtherValue].filter(Boolean).join(", ") });
                                                        }}
                                                        className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                                                        placeholder="Enter other tools"
                                                    />
                                                );
                                            })()}
                                        </div>
                                    </div>
                                </section>
                                <p className="text-xs text-gray-500 border-t border-gray-200 pt-4 mt-4">After creation, an email will be sent to the contact with a secure &quot;Set your password&quot; link (expires in 24 hours). No password is collected in this form.</p>
                                </>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-3 px-6 py-4 h-[72px] shrink-0 border-t border-gray-200 bg-gray-100/80 rounded-b-2xl items-center">
                                <button
                                    type="button"
                                    onClick={() => setCreateModalStep((s) => Math.max(1, s - 1))}
                                    disabled={createModalStep === 1}
                                    className="w-full max-w-[140px] inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 bg-white hover:bg-gray-50 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft className="h-4 w-4 shrink-0" /> Previous
                                </button>
                                <div className="flex justify-end">
                                    {createModalStep < 5 ? (
                                        <button
                                            type="button"
                                            onClick={() => setCreateModalStep((s) => s + 1)}
                                            className="w-full max-w-[140px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg transition-all"
                                        >
                                            Next <ChevronRight className="h-4 w-4 shrink-0" />
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={(e) => handleCreateAgency(e as unknown as React.FormEvent)}
                                            className="w-full max-w-[160px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg transition-all"
                                        >
                                            Create Agency
                                        </button>
                                    )}
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Agency Modal */}
            {showEditAgencyModal && editingAgency && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-gray-200/80 w-full max-w-5xl mx-4 h-[90vh] max-h-[720px] flex flex-col overflow-hidden">
                        <div className="flex justify-between items-center px-6 py-5 shrink-0 bg-gradient-to-r from-primary-600 via-primary-500 to-blue-600 text-white rounded-t-2xl">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20">
                                    <Edit className="h-5 w-5" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold">Edit Agency</h2>
                                    <p className="text-sm text-white/90">{editingAgency.name}</p>
                                </div>
                            </div>
                            <button type="button" onClick={() => { setShowEditAgencyModal(false); setEditingAgency(null); setEditModalStep(1); }} className="p-2 rounded-lg text-white/90 hover:bg-white/20 hover:text-white transition-colors">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        {loadingEditAgency ? (
                            <div className="p-12 text-center text-gray-500">Loading agency...</div>
                        ) : (
                        <form onSubmit={(e) => { e.preventDefault(); handleUpdateAgency(e); }} className="flex flex-col flex-1 min-h-0 bg-gray-50/50 overflow-hidden">
                            {/* Step indicator */}
                            <div className="px-6 pt-4 pb-2 shrink-0 border-b border-gray-200 bg-white">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-gray-600">Step {editModalStep} of 4</span>
                                    <div className="flex gap-1.5">
                                        {[1, 2, 3, 4].map((s) => (
                                            <button
                                                key={s}
                                                type="button"
                                                onClick={() => setEditModalStep(s)}
                                                className={`h-2 rounded-full transition-all ${s === editModalStep ? "w-6 bg-primary-600" : "w-2 bg-gray-300 hover:bg-gray-400"}`}
                                                aria-label={`Go to step ${s}`}
                                            />
                                        ))}
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500">
                                    {editModalStep === 1 && "Agency Information"}
                                    {editModalStep === 2 && "Primary Contact"}
                                    {editModalStep === 3 && "Business Address & White Label Subdomain"}
                                    {editModalStep === 4 && "Billing & Subscription"}
                                </p>
                            </div>
                            <div className="p-6 overflow-y-auto flex-1 min-h-0">
                                {editModalStep === 1 && (
                                <section className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5">
                                    <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                        AGENCY INFORMATION
                                    </h3>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Agency Name *</label>
                                            <input type="text" required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. TKM Agency" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Agency Website *</label>
                                            <input type="url" required value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="https://tkmdigital.com" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Industry/Specialty</label>
                                            <select value={editForm.industry} onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                                                <option value="">Select...</option>
                                                <option value="Full Service Agency">Full Service Agency</option>
                                                <option value="SEO Specialist">SEO Specialist</option>
                                                <option value="Web Design">Web Design</option>
                                                <option value="PPC Agency">PPC Agency</option>
                                                <option value="Social Media">Social Media</option>
                                                <option value="Local Marketing">Local Marketing</option>
                                                <option value="Other">Other</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Agency Size</label>
                                            <select value={editForm.agencySize} onChange={(e) => setEditForm({ ...editForm, agencySize: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                                                <option value="">Select...</option>
                                                <option value="Solo (1 person)">Solo (1 person)</option>
                                                <option value="Small (2-5 employees)">Small (2-5 employees)</option>
                                                <option value="Medium (6-15 employees)">Medium (6-15 employees)</option>
                                                <option value="Large (16-30 employees)">Large (16-30 employees)</option>
                                                <option value="Enterprise (30+ employees)">Enterprise (30+ employees)</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Number of Current Clients</label>
                                            <input type="number" min={0} value={editForm.numberOfClients} onChange={(e) => setEditForm({ ...editForm, numberOfClients: e.target.value === "" ? "" : Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. 12" />
                                        </div>
                                    </div>
                                </section>
                                )}
                                {editModalStep === 2 && (
                                <section className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-4 sm:p-5">
                                    <h3 className="text-sm font-semibold text-emerald-900 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                        PRIMARY CONTACT
                                    </h3>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Primary Contact Name *</label>
                                            <input type="text" required value={editForm.contactName} onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. Johnny Doe" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email *</label>
                                            <input type="email" required value={editForm.contactEmail} onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="johnny@tkmdigital.com" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                                            <input type="tel" value={editForm.contactPhone} onChange={(e) => setEditForm({ ...editForm, contactPhone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="+1 (631) 555-1234" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Job Title</label>
                                            <input type="text" value={editForm.contactJobTitle} onChange={(e) => setEditForm({ ...editForm, contactJobTitle: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Owner, Marketing Director" />
                                        </div>
                                    </div>
                                </section>
                                )}
                                {editModalStep === 3 && (
                                <>
                                <section className="rounded-xl border-l-4 border-amber-500 bg-amber-50/50 p-4 sm:p-5">
                                    <h3 className="text-sm font-semibold text-amber-900 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                        BUSINESS ADDRESS
                                    </h3>
                                    <div className="space-y-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="sm:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Street Address</label>
                                            <input type="text" value={editForm.streetAddress} onChange={(e) => setEditForm({ ...editForm, streetAddress: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="375 Commack Road" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                                            <input type="text" value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Deer Park" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">State/Province</label>
                                            <input type="text" value={editForm.state} onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="NY" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">ZIP/Postal Code</label>
                                            <input type="text" value={editForm.zip} onChange={(e) => setEditForm({ ...editForm, zip: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="11729" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                                            <select value={editForm.country} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                                                <option value="United States">United States</option>
                                                <option value="Canada">Canada</option>
                                                <option value="United Kingdom">United Kingdom</option>
                                                <option value="Other">Other</option>
                                            </select>
                                        </div>
                                    </div>
                                </section>

                                {/* Section D: Subdomain */}
                                <section className="rounded-xl border-l-4 border-violet-500 bg-violet-50/50 p-4 sm:p-5">
                                    <h3 className="text-sm font-semibold text-violet-900 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                        WHITE LABEL SUBDOMAIN (Optional)
                                    </h3>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Custom Subdomain</label>
                                        <input type="text" value={editForm.subdomain} onChange={(e) => setEditForm({ ...editForm, subdomain: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="tkmdigital" />
                                        <p className="mt-1 text-xs text-gray-500">e.g. tkmdigital → tkmdigital.yourplatform.com. Leave blank if not needed.</p>
                                    </div>
                                </section>
                                </>
                                )}
                                {editModalStep === 4 && (
                                <section className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50/50 p-4 sm:p-5">
                                    <h3 className="text-sm font-semibold text-indigo-900 mb-3 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                        BILLING & SUBSCRIPTION
                                    </h3>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Billing Type</label>
                                            <select value={editForm.billingType} onChange={(e) => {
                                                const newBilling = e.target.value as typeof editForm.billingType;
                                                const clearFreeTier = newBilling === "free" || newBilling === "trial" || (newBilling === "paid" && editForm.subscriptionTier === "free");
                                                setEditForm({ ...editForm, billingType: newBilling, subscriptionTier: clearFreeTier ? "" : editForm.subscriptionTier });
                                            }} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                                                <option value="">Select...</option>
                                                <option value="free">Free Account (Free tier, no payment)</option>
                                                <option value="paid">Charge to Card (any tier, subscription immediately)</option>
                                                <option value="trial">No Charge during 7 days trial (Free tier, then must subscribe)</option>
                                                <option value="custom">Enterprise (manual invoice)</option>
                                            </select>
                                        </div>
                                        {editForm.billingType === "free" && (
                                            <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                                                Agency uses <strong>Free</strong> tier with no payment required.
                                            </p>
                                        )}
                                        {editForm.billingType === "trial" && (
                                            <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                                                Agency uses <strong>Free</strong> tier during the 7-day trial. After the trial, they must proceed to payment.
                                            </p>
                                        )}
                                        {(editForm.billingType === "paid" || editForm.billingType === "custom") && !editingAgencyHasStripeCustomer && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-2">Card details *</label>
                                                {!stripePk ? (
                                                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">Add <code className="px-1 bg-amber-100 rounded">VITE_STRIPE_PUBLISHABLE_KEY</code> to the app environment to collect payment methods.</p>
                                                ) : editSetupIntentClientSecret && stripePromise ? (
                                                    <Elements stripe={stripePromise} options={{ clientSecret: editSetupIntentClientSecret }}>
                                                        <StripePaymentSection ref={editStripePaymentRef} clientSecret={editSetupIntentClientSecret} />
                                                    </Elements>
                                                ) : (
                                                    <p className="text-sm text-gray-500">Loading payment form…</p>
                                                )}
                                                <p className="mt-1 text-xs text-gray-500">Agency will be integrated with Stripe for billing.</p>
                                            </div>
                                        )}
                                        {(editForm.billingType === "paid" || editForm.billingType === "custom") && editingAgencyHasStripeCustomer && (
                                            <p className="text-sm text-green-700 bg-green-50 rounded-lg p-3">
                                                ✓ Card on file. Agency is integrated with Stripe.
                                            </p>
                                        )}
                                        {editForm.billingType && editForm.billingType !== "free" && editForm.billingType !== "trial" && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Subscription Tier</label>
                                                <select value={editForm.billingType === "paid" && editForm.subscriptionTier === "free" ? "" : editForm.subscriptionTier} onChange={(e) => setEditForm({ ...editForm, subscriptionTier: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                                                    <option value="">Select tier</option>
                                                    <optgroup label="Agency tiers">
                                                        {editForm.billingType !== "paid" && <option value="free">Free – 0 dashboards</option>}
                                                        <option value="solo">Solo ($147/mo) – 3 dashboards</option>
                                                        <option value="starter">Starter ($297/mo) – 10 dashboards</option>
                                                        <option value="growth">Growth ($597/mo) – 25 dashboards</option>
                                                        <option value="pro">Pro ($997/mo) – 50 dashboards</option>
                                                        <option value="enterprise">Enterprise (Custom) – Unlimited</option>
                                                    </optgroup>
                                                    <optgroup label="Business tiers">
                                                        <option value="business_lite">Business Lite ($79/mo) – 1 dashboard</option>
                                                        <option value="business_pro">Business Pro ($197/mo) – 1 dashboard</option>
                                                    </optgroup>
                                                </select>
                                            </div>
                                        )}
                                        {editForm.billingType === "custom" && (
                                            <>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Custom pricing</label>
                                                    <input type="number" step="0.01" min={0} value={editForm.customPricing} onChange={(e) => setEditForm({ ...editForm, customPricing: e.target.value === "" ? "" : Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="0.00" />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Internal notes</label>
                                                    <textarea value={editForm.internalNotes} onChange={(e) => setEditForm({ ...editForm, internalNotes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Notes for internal use" />
                                                </div>
                                            </>
                                        )}
                                        {editForm.billingType !== "custom" && editForm.billingType !== "free" && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Internal notes</label>
                                                <textarea value={editForm.internalNotes} onChange={(e) => setEditForm({ ...editForm, internalNotes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Notes for internal use" />
                                            </div>
                                        )}
                                    </div>
                                </section>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-3 px-6 py-4 h-[72px] shrink-0 border-t border-gray-200 bg-gray-100/80 rounded-b-2xl items-center">
                                <button
                                    type="button"
                                    onClick={() => setEditModalStep((s) => Math.max(1, s - 1))}
                                    disabled={editModalStep === 1}
                                    className="w-full max-w-[140px] inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 bg-white hover:bg-gray-50 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <ChevronLeft className="h-4 w-4 shrink-0" /> Previous
                                </button>
                                <div className="flex justify-end">
                                    {editModalStep < 4 ? (
                                        <button
                                            type="button"
                                            onClick={() => setEditModalStep((s) => s + 1)}
                                            className="w-full max-w-[140px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg transition-all"
                                        >
                                            Next <ChevronRight className="h-4 w-4 shrink-0" />
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => handleUpdateAgency()}
                                            disabled={loading}
                                            className="w-full max-w-[160px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {loading ? "Saving..." : "Save Changes"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </form>
                        )}
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
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Industry</th>
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
                                                            className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-bold rounded-full ${getStatusBadge(client.status)}`}
                                                            onClick={() => setOpenStatusId(openStatusId === client.id ? "" : client.id)}
                                                        >
                                                            {showStatusAlertIcon(client.status) && <AlertCircle className="h-3 w-3 shrink-0" />}
                                                            {getStatusLabel(client.status)}
                                                        </button>
                                                        {client.status === CLIENT_STATUS.CANCELED && client.canceledEndDate && (
                                                            <span className="ml-1 text-xs text-red-600">
                                                                {format(new Date(client.canceledEndDate), "MMM d, yyyy")}
                                                            </span>
                                                        )}
                                                        {openStatusId === client.id && statusButtonRefs.current[client.id] && createPortal(
                                                            <div 
                                                                data-status-dropdown-menu
                                                                className="fixed bg-white border border-gray-200 rounded-md shadow-lg min-w-[160px]"
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
                                                                            try {
                                                                                const data: { status: string; canceledEndDate?: string } = { status: value };
                                                                                if (value === "CANCELED") {
                                                                                    data.canceledEndDate = new Date().toISOString();
                                                                                }
                                                                                await dispatch(updateClient({ id: client.id, data }) as any);
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
                                                            title="Open Dashboard"
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            className="p-1 text-gray-400 hover:text-primary-600 transition-colors"
                                                            onClick={() => handleViewReportClick(client)}
                                                            title="View Report"
                                                        >
                                                            <FileText className="h-4 w-4" />
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
                                                            title="Edit"
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            className="p-1 text-gray-400 hover:text-orange-600 transition-colors"
                                                            onClick={() => {
                                                                if (selectedAgencyId) {
                                                                    handleRemoveClientFromAgency(selectedAgencyId, client.id, client.name);
                                                                }
                                                            }}
                                                            title="Remove from Agency"
                                                        >
                                                            <UserMinus className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                                                            onClick={() => handleDeleteClient(client.id)}
                                                            title="Delete Client"
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

            {/* Delete Agency Confirmation Dialog */}
            {deleteAgencyConfirm.isOpen && (
                <ConfirmDialog
                    isOpen={deleteAgencyConfirm.isOpen}
                    onClose={() => setDeleteAgencyConfirm({ isOpen: false, agencyId: null, agencyName: null })}
                    onConfirm={confirmDeleteAgency}
                    title="Delete Agency"
                    message={`Are you sure you want to delete "${deleteAgencyConfirm.agencyName}"? This action cannot be undone. All members and tasks will be removed.`}
                    confirmText="Delete"
                    requireConfirmText="DELETE"
                    variant="danger"
                />
            )}

            {/* Remove Client from Agency Confirmation Dialog */}
            {removeClientConfirm.isOpen && (
                <ConfirmDialog
                    isOpen={removeClientConfirm.isOpen}
                    onClose={() => setRemoveClientConfirm({ isOpen: false, agencyId: null, clientId: null, clientName: null })}
                    onConfirm={confirmRemoveClientFromAgency}
                    title="Remove Client from Agency"
                    message={`Are you sure you want to remove "${removeClientConfirm.clientName}" from this agency? The client will be unassigned but not deleted.`}
                    confirmText="Remove"
                    variant="warning"
                />
            )}

            {/* Assign Client to Agency Modal */}
            {assignClientModal.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-8 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-gray-900">
                                Assign Client to Agency
                            </h2>
                            <button
                                onClick={() => {
                                    setAssignClientModal({ isOpen: false, clientId: null, clientName: null });
                                    setAllClients([]);
                                }}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        {loadingAllClients ? (
                            <div className="text-center py-8 text-gray-500">
                                Loading clients...
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-600">
                                    Select an agency to assign "{assignClientModal.clientName}" to:
                                </p>
                                <div className="border border-gray-200 rounded-lg max-h-96 overflow-y-auto">
                                    {agencies.length === 0 ? (
                                        <div className="p-4 text-center text-gray-500">
                                            No agencies available
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-gray-200">
                                            {agencies.map((agency) => (
                                                <button
                                                    key={agency.id}
                                                    onClick={() => {
                                                        if (assignClientModal.clientId) {
                                                            handleAssignClientToAgency(agency.id, assignClientModal.clientId);
                                                        }
                                                    }}
                                                    className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                                                >
                                                    <div className="font-medium text-gray-900">{agency.name}</div>
                                                    {(() => {
                                                        const sd = agency.subdomain != null ? String(agency.subdomain).trim() : "";
                                                        const hasSubdomain = sd && sd.toLowerCase() !== "null";
                                                        return hasSubdomain ? (
                                                            <div className="text-sm text-gray-500">{sd}.yourseodashboard.com</div>
                                                        ) : null;
                                                    })()}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default AgenciesPage;
