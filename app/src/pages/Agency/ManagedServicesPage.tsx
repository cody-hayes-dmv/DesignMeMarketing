import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchClients } from "@/store/slices/clientSlice";
import { Check, Loader2, ExternalLink, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

const COMMISSION_BY_TIER: Record<string, number> = {
  solo: 20,
  starter: 25,
  growth: 30,
  pro: 35,
  enterprise: 40,
};

function formatCurrency(centsOrDollars: number, asCents = false): string {
  const amount = asCents ? centsOrDollars / 100 : centsOrDollars;
  return `$${Number(amount).toFixed(2)}`;
}

const PACKAGES = [
  {
    id: "foundation",
    name: "Foundation",
    price: 750,
    includes: [
      "On-page SEO",
      "Citations",
      "Review management",
      "Basic link building",
    ],
    buttonLabel: "Activate",
  },
  {
    id: "growth",
    name: "Growth",
    price: 1500,
    includes: [
      "Everything in Foundation",
      "Content creation",
      "Link building",
      "Reporting",
    ],
    buttonLabel: "Activate",
  },
  {
    id: "domination",
    name: "Domination",
    price: 3000,
    includes: [
      "Everything in Growth",
      "Advanced content",
      "Aggressive link building",
    ],
    buttonLabel: "Activate",
  },
  {
    id: "custom",
    name: "Custom",
    price: 5000,
    includes: ["Let's talk about your custom needs"],
    commissionLabel: "Custom",
    buttonLabel: "Contact",
  },
];

interface ActiveService {
  id: string;
  clientId: string;
  clientName: string;
  packageId: string;
  packageName: string;
  monthlyPrice: number;
  commissionPercent: number;
  monthlyCommission: number;
  startDate: string;
  status: string;
}

const ManagedServicesPage = () => {
  const dispatch = useDispatch();
  const { clients } = useSelector((state: RootState) => state.client);
  const [tier, setTier] = useState<string>("starter");
  const [activeServices, setActiveServices] = useState<ActiveService[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [activating, setActivating] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<typeof PACKAGES[0] | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [clientAgreed, setClientAgreed] = useState(false);
  const [cancelModalService, setCancelModalService] = useState<ActiveService | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const agencyClients = (clients || []).filter(
    (c) =>
      !c.vendasta &&
      !["CANCELED", "ARCHIVED", "SUSPENDED"].includes(c.status || "")
  );
  const commissionPct = COMMISSION_BY_TIER[tier.toLowerCase()] ?? 25;

  useEffect(() => {
    dispatch(fetchClients() as any);
  }, [dispatch]);

  const fetchManagedServices = async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const cacheBuster = `_=${Date.now()}`;
      const [subRes, listRes] = await Promise.all([
        api.get("/seo/agency/subscription").catch(() => ({ data: null })),
        api.get(`/agencies/managed-services?${cacheBuster}`).catch(() => ({ data: [] })),
      ]);
      if (subRes?.data?.currentPlan) setTier(subRes.data.currentPlan);
      if (Array.isArray(listRes?.data)) setActiveServices(listRes.data);
    } catch {
      // keep defaults
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchManagedServices();
  }, []);

  // Refetch when user returns to this tab (e.g. after approving in Super Admin) so status updates immediately
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") fetchManagedServices(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // When any service is Pending approval, poll so status updates to Active after Super Admin approves
  const hasPending = activeServices.some((s) => String(s.status).toUpperCase() === "PENDING");
  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(() => fetchManagedServices(false), 5000);
    return () => clearInterval(interval);
  }, [hasPending]);

  const openActivateModal = (pkg: typeof PACKAGES[0]) => {
    if (pkg.id === "custom") {
      toast("Contact Design ME Marketing for custom packages.");
      return;
    }
    setSelectedPackage(pkg);
    setSelectedClientId("");
    setClientAgreed(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedPackage(null);
    setSelectedClientId("");
    setClientAgreed(false);
  };

  const handleActivate = async () => {
    if (!selectedPackage || selectedPackage.id === "custom") return;
    if (!selectedClientId) {
      toast.error("Please select a client.");
      return;
    }
    if (!clientAgreed) {
      toast.error("Please confirm the client has agreed to this service.");
      return;
    }
    setActivating(true);
    try {
      const res = await api.post("/agencies/managed-services", {
        packageId: selectedPackage.id,
        clientId: selectedClientId,
        clientAgreed: true,
        tier,
      });
      const newService = res.data;
      setActiveServices((prev) => [
        {
          id: newService.id,
          clientId: newService.clientId,
          clientName: newService.clientName,
          packageId: newService.packageId,
          packageName: newService.packageName,
          monthlyPrice: newService.monthlyPrice,
          commissionPercent: newService.commissionPercent,
          monthlyCommission: newService.monthlyCommission,
          startDate: newService.startDate,
          status: newService.status,
        },
        ...prev,
      ]);
      toast.success("Request submitted. Pending Super Admin approval; you'll be notified when approved.");
      closeModal();
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Failed to activate service.");
    } finally {
      setActivating(false);
    }
  };

  const openCancelModal = (service: ActiveService) => {
    setCancelModalService(service);
  };

  const closeCancelModal = () => {
    if (!canceling) setCancelModalService(null);
  };

  const handleConfirmCancel = async () => {
    if (!cancelModalService) return;
    setCanceling(true);
    try {
      await api.patch(`/agencies/managed-services/${cancelModalService.id}/cancel`);
      setActiveServices((prev) => prev.filter((s) => s.id !== cancelModalService.id));
      toast.success("Service canceled.");
      setCancelModalService(null);
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Failed to cancel.");
    } finally {
      setCanceling(false);
    }
  };

  const pkgCommission = (pkg: (typeof PACKAGES)[0]) => {
    if (pkg.id === "custom") return "Custom";
    const pct = COMMISSION_BY_TIER[tier.toLowerCase()] ?? 25;
    const amount = Math.round((pkg.price * pct) / 100);
    return `${formatCurrency(amount)}/mo (${pct}% commission)`;
  };

  const pkgPriceLabel = (pkg: (typeof PACKAGES)[0]) => {
    if (pkg.id === "custom") return "$5,000+/month";
    return `${formatCurrency(pkg.price)}/month`;
  };

  return (
    <div className="p-8">
      {/* Top Section - Header */}
      <header className="mb-10">
        <h1 className="text-2xl font-bold text-gray-900">Managed SEO Services</h1>
        <p className="text-lg text-primary-600 font-medium mt-1">White-label fulfillment by Design ME Marketing</p>
        <p className="text-gray-600 mt-2 max-w-2xl">
          Choose a package, select a client, we handle the rest. You earn commission based on your plan tier.
        </p>
      </header>

      {/* Middle Section - Service Packages */}
      <section className="mb-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Service Packages</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PACKAGES.map((pkg) => (
            <div
              key={pkg.id}
              className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col"
            >
              <h3 className="text-xl font-bold text-gray-900">{pkg.name}</h3>
              <p className="text-2xl font-bold text-primary-600 mt-2">{pkgPriceLabel(pkg)}</p>
              <ul className="mt-4 space-y-2 text-sm text-gray-700">
                {pkg.includes.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-primary-500 mt-0.5">•</span>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm font-medium text-gray-700">
                You earn: {pkgCommission(pkg)}
              </p>
              <div className="mt-6 flex-1 flex items-end">
                <button
                  type="button"
                  onClick={() => openActivateModal(pkg)}
                  className="w-full py-2.5 rounded-lg font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                >
                  {pkg.buttonLabel}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom Section - Active Managed Services */}
      <section>
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Active Managed Services</h2>
          <button
            type="button"
            onClick={() => fetchManagedServices(true)}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg disabled:opacity-60"
            title="Refresh to see latest status (e.g. after Super Admin approval)"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : activeServices.length === 0 ? (
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            No active managed services yet. Activate a package above to get started.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Package & Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Your Commission</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Start Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {activeServices.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{s.clientName}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {s.packageName} ({formatCurrency(s.monthlyPrice, true)}/mo)
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {formatCurrency(s.monthlyCommission, true)}/mo ({s.commissionPercent}%)
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(s.startDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      {String(s.status).toUpperCase() === "ACTIVE" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <Check className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          Pending approval
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={`/agency/clients/${s.clientId}`}
                        className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 mr-3"
                      >
                        View Details <ExternalLink className="h-3 w-3" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => openCancelModal(s)}
                        className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
                      >
                        Cancel Service
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cancel Service confirmation modal */}
      {cancelModalService && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={closeCancelModal}>
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900">Cancel Managed Service</h3>
            <p className="mt-3 text-gray-600">
              Are you sure you want to cancel the managed service for{" "}
              <strong>{cancelModalService.clientName}</strong>?
            </p>
            <p className="mt-2 text-sm text-gray-500">
              {cancelModalService.packageName} ({formatCurrency(cancelModalService.monthlyPrice, true)}/mo) will end.
              The client will no longer receive this package.
            </p>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                type="button"
                onClick={closeCancelModal}
                disabled={canceling}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Keep Service
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={canceling}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 flex items-center gap-2"
              >
                {canceling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Cancel Service
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activation Modal */}
      {modalOpen && selectedPackage && selectedPackage.id !== "custom" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900">Activate Managed Service</h3>
            <p className="mt-2 text-gray-600">
              {selectedPackage.name} – {pkgPriceLabel(selectedPackage)}
            </p>
            <p className="mt-1 text-sm font-medium text-primary-600">
              Your commission: {pkgCommission(selectedPackage)}
            </p>

            <div className="mt-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Client</label>
              <select
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Choose a client...</option>
                {agencyClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="mt-4 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={clientAgreed}
                onChange={(e) => setClientAgreed(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Client has agreed to this service</span>
            </label>

            <div className="mt-6 flex gap-3 justify-end">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleActivate}
                disabled={activating}
                className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 flex items-center gap-2"
              >
                {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Activate Service
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagedServicesPage;
