import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/store";
import { fetchClients } from "@/store/slices/clientSlice";
import { Check, Loader2, ExternalLink, RefreshCw, Star, Zap } from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

function formatCurrency(centsOrDollars: number, asCents = false): string {
  const amount = asCents ? centsOrDollars / 100 : centsOrDollars;
  return `$${Number(amount).toFixed(2)}`;
}

const PACKAGES = [
  {
    id: "foundation",
    name: "SEO Essentials + Automation",
    price: 750,
    tagline: "Your foundation for getting found online and capturing every lead",
    badge: null,
    seoWork: [
      "Site audit + full on-page SEO fixes",
      "Google Business Profile optimization",
      "Local citation building (50+ directories)",
      "Monthly backlinks to homepage",
      "Up to 2 pieces of content/month",
    ],
    platformCredits: "$25/month included",
    creditNote: "Covers calls, texts, emails, and workflows. Most small businesses never exceed this.",
    featuresLabel: "What We Set Up For You:",
    features: [
      "AI web chat bot on your website",
      "2-way text & email conversations (one inbox for everything)",
      "Missed call text-back automation",
      "Appointment booking with reminders",
      "Google review request system",
      "CRM + lead pipeline",
      "Google Business messaging connected",
      "50+ local directory listings synced",
      "Email marketing platform access",
      "Survey & form builder",
      "SMS & email templates + workflows",
      "Full SEO reporting dashboard",
      "Training video walkthrough",
    ],
    buttonLabel: "Get Started",
    buttonAction: "activate",
  },
  {
    id: "growth",
    name: "Growth & Automation",
    price: 1500,
    tagline: "More content, deeper automations, and social media control",
    badge: null,
    seoWork: [
      "Everything in Essentials",
      "4 backlinks/month",
      "Up to 4 pieces of content/month",
    ],
    platformCredits: "$60/month included",
    creditNote: "More runway for calls, texts, and campaigns.",
    featuresLabel: "Everything in Essentials, plus:",
    features: [
      "Social media planner (connect and schedule all channels)",
      "2 chatbots (web + 1 social channel)",
      "Email + SMS nurture drip sequences",
      "Reactivation campaign (text, email, voicemail drop)",
      "Trigger link automations",
      "AI-powered Google review auto-replies",
      "Full analytics & reporting suite",
      "Advanced workflow builder",
    ],
    buttonLabel: "Get Started",
    buttonAction: "activate",
  },
  {
    id: "domination",
    name: "Authority Builder",
    price: 3000,
    tagline: "AI-powered lead handling, ads management, and multi-channel domination",
    badge: "Most Popular",
    seoWork: [
      "Everything prior",
      "6 backlinks/month",
      "Up to 6 pieces of content/month",
    ],
    platformCredits: "$120/month included",
    creditNote: "Covers AI content, voice, WhatsApp, and more.",
    featuresLabel: "Everything in Growth, plus:",
    features: [
      "Google + Facebook/Instagram ads management",
      "3 chatbots (web, Facebook, Instagram)",
      "AI agent that handles inbound leads on 1 channel",
      "Multi-channel nurture campaigns (SMS, email, FB, IG)",
      "Facebook Messenger integration",
      "Google Business call tracking",
      "Text-to-pay + invoicing system",
      "Documents & contracts (e-signature)",
      "AI content generation",
      "AI conversation & voice agent",
      "WhatsApp integration",
      "Quizzes, communities & QR codes",
    ],
    buttonLabel: "Get Started",
    buttonAction: "activate",
  },
  {
    id: "market_domination",
    name: "Market Domination",
    price: 5000,
    tagline: "The full arsenal — AI voice, unlimited automation, and total market control",
    badge: null,
    seoWork: [
      "Everything prior",
      "8 backlinks/month",
      "Up to 8 pieces of content/month",
    ],
    platformCredits: "$250/month included",
    creditNote: "Maximum runway across every channel.",
    featuresLabel: "Everything in Authority Builder, plus:",
    features: [
      "AI Voice Agent (answers inbound calls & texts 24/7)",
      "Unlimited chatbot workflows",
      "Advanced automations (cart recovery, upsells, win-backs, cross-sells)",
      "Done-for-you social posting (Facebook, Instagram, LinkedIn)",
      "Full funnel builder",
      "Membership site setup",
      "Affiliate program manager",
      "Certificates & digital credentials",
      "External AI model workflows",
      "Dedicated monthly strategy & growth call",
    ],
    buttonLabel: "Let\u2019s Talk",
    buttonAction: "contact",
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
  const [accountActivated, setAccountActivated] = useState<boolean>(true);
  const [trialActive, setTrialActive] = useState<boolean>(false);
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

  useEffect(() => {
    dispatch(fetchClients() as any);
  }, [dispatch]);

  const fetchManagedServices = async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const cacheBuster = `_=${Date.now()}`;
      const [meRes, subRes, listRes] = await Promise.all([
        api.get("/agencies/me").catch(() => ({ data: null })),
        api.get("/seo/agency/subscription").catch(() => ({ data: null })),
        api.get(`/agencies/managed-services?${cacheBuster}`).catch(() => ({ data: [] })),
      ]);
      // Use /agencies/me for trial/activation (same source as AddOnsPage) so state is correct after refresh
      if (meRes?.data) {
        if (typeof meRes.data.accountActivated === "boolean") setAccountActivated(meRes.data.accountActivated);
        setTrialActive(meRes.data.trialActive === true);
      }
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
    if (pkg.buttonAction === "contact") {
      toast("Contact Design ME Marketing to discuss this package.");
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
    if (!selectedPackage || selectedPackage.buttonAction === "contact") return;
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

  const pkgPriceLabel = (pkg: (typeof PACKAGES)[0]) => {
    const formatted = pkg.price >= 1000 ? `$${pkg.price.toLocaleString()}` : formatCurrency(pkg.price);
    return `${formatted}/month`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-amber-50/30 p-8">
      {/* Top Section - Header */}
      <div className="relative mb-10 overflow-hidden rounded-2xl bg-gradient-to-r from-amber-600 via-orange-600 to-red-500 p-8 shadow-lg">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNnKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative">
          <h1 className="text-2xl font-bold text-white md:text-3xl">Managed SEO Services</h1>
          <p className="mt-2 text-amber-100 text-sm md:text-base">White-label fulfillment by Design ME Marketing</p>
        </div>
      </div>

      {(!accountActivated || trialActive) && (
        <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-amber-800 text-sm">
            {trialActive ? (
              <>
                <strong>Managed services are not available during your 7-day free trial.</strong> The trial is for reporting only. Subscribe to a plan in{" "}
                <Link to="/agency/subscription" className="font-medium text-amber-700 underline hover:text-amber-900">
                  Subscription & Billing
                </Link>{" "}
                or wait until your trial ends to request managed services.
              </>
            ) : (
              <>
                <strong>Activate your account first.</strong> Add a payment method in{" "}
                <Link to="/agency/subscription" className="font-medium text-amber-700 underline hover:text-amber-900">
                  Subscription & Billing
                </Link>{" "}
                to request managed services.
              </>
            )}
          </p>
        </section>
      )}

      {/* Overview */}
      <section className="mb-10 rounded-xl border border-gray-200 bg-gray-50 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Overview</h2>
        <p className="text-gray-700 max-w-3xl">
          Agencies can activate managed SEO and automation services for their clients through the dashboard. When activated, Design ME Marketing fulfills the work. Payment for managed services is charged when your request is approved.
        </p>
      </section>

      {/* Service Packages */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Available Managed Service Packages</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-6">
          {PACKAGES.map((pkg) => {
            const isPopular = pkg.badge === "Most Popular";
            return (
              <div
                key={pkg.id}
                className={`relative rounded-2xl flex flex-col ${
                  isPopular
                    ? "border-2 border-primary-500 shadow-xl shadow-primary-100/50 ring-1 ring-primary-200"
                    : "border border-gray-200 shadow-sm"
                } bg-white overflow-hidden`}
              >
                {isPopular && (
                  <div className="bg-primary-600 text-center py-2 text-xs font-bold uppercase tracking-wider text-white flex items-center justify-center gap-1.5">
                    <Star className="h-3.5 w-3.5 fill-current" />
                    Most Popular
                  </div>
                )}

                <div className="p-6 flex flex-col flex-1">
                  {/* Header */}
                  <h3 className="text-lg font-bold text-gray-900 leading-tight">{pkg.name}</h3>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold text-gray-900">{pkgPriceLabel(pkg).replace("/month", "")}</span>
                    <span className="text-sm font-medium text-gray-500">/month</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-600 leading-relaxed">{pkg.tagline}</p>

                  {/* SEO Work Block */}
                  <div className="mt-5 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200/80 p-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-2.5 flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      SEO Work Included
                    </h4>
                    <ul className="space-y-1.5">
                      {pkg.seoWork.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                          <Check className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Platform Credits */}
                  <div className="mt-4 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
                    <p className="text-sm font-semibold text-blue-900">Platform Credits: {pkg.platformCredits}</p>
                    <p className="text-xs text-blue-700/80 mt-1 leading-relaxed">{pkg.creditNote}</p>
                  </div>

                  {/* Features */}
                  <div className="mt-5 flex-1">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">{pkg.featuresLabel}</h4>
                    <ul className="space-y-2">
                      {pkg.features.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                          <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Setup Note */}
                  <div className="mt-5 rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
                    <p className="text-xs text-gray-600 leading-relaxed">
                      Full setup included. We build everything for you and send a training video so you know exactly what&apos;s running.
                    </p>
                  </div>

                  {/* CTA */}
                  <div className="mt-5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openActivateModal(pkg)}
                      disabled={!accountActivated || trialActive}
                      className={`w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                        isPopular
                          ? "bg-primary-600 text-white hover:bg-primary-700 shadow-md shadow-primary-200/50"
                          : "bg-gray-900 text-white hover:bg-gray-800"
                      }`}
                    >
                      {pkg.buttonLabel}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Section Footer */}
        <p className="mt-6 text-center text-sm text-gray-500 font-medium">
          No long-term contracts &middot; Cancel anytime
        </p>
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
      {modalOpen && selectedPackage && selectedPackage.buttonAction !== "contact" && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900">Activate Managed Service</h3>
            <p className="mt-2 text-gray-600">
              {selectedPackage.name} – {pkgPriceLabel(selectedPackage)}
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
