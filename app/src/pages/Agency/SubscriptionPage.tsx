import React, { useEffect, useState, useRef, useImperativeHandle, forwardRef } from "react";
import {
  CreditCard,
  Users,
  Target,
  Search,
  UserPlus,
  Loader2,
  Download,
  ChevronUp,
  ChevronDown,
  X,
  Check,
  Briefcase,
  Building2,
} from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import api from "@/lib/api";
import toast from "react-hot-toast";

const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = stripePk ? loadStripe(stripePk) : null;

type StripePaymentHandle = { confirmAndGetPaymentMethod: () => Promise<string | null> };

const StripePaymentSection = forwardRef<StripePaymentHandle, { clientSecret: string }>(function StripePaymentSection({ clientSecret }, ref) {
  const stripe = useStripe();
  const elements = useElements();
  useImperativeHandle(ref, () => ({
    async confirmAndGetPaymentMethod() {
      if (!stripe || !elements) return null;
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

const AGENCY_PLANS = [
  {
    id: "solo", name: "Solo", price: 147, priceLabel: "$147", clientsLabel: "3 clients + 1 free agency",
    features: ["75 keywords (account-wide)", "25 research credits/mo", "Weekly rank updates", "1 team user"],
  },
  {
    id: "starter", name: "Starter", price: 297, priceLabel: "$297", clientsLabel: "10 clients + 1 free agency",
    features: ["250 keywords (account-wide)", "75 research credits/mo", "Rank updates every 48h", "3 team users"],
  },
  {
    id: "growth", name: "Growth", price: 597, priceLabel: "$597", clientsLabel: "25 clients + 1 free agency",
    features: ["500 keywords (account-wide)", "200 research credits/mo", "Daily rank updates", "5 team users"],
  },
  {
    id: "pro", name: "Pro", price: 997, priceLabel: "$997", clientsLabel: "50 clients + 1 free agency",
    features: ["1,000 keywords (account-wide)", "500 research credits/mo", "Rank updates every 6h", "15 team users"],
  },
  {
    id: "enterprise", name: "Enterprise", price: null as number | null, priceLabel: "Custom", clientsLabel: "Unlimited",
    features: ["Unlimited keywords", "3,000+ research credits/mo", "Real-time rank updates", "Unlimited team users"],
  },
];

const BUSINESS_PLANS = [
  {
    id: "business_lite", name: "Business Lite", price: 79, priceLabel: "$79", clientsLabel: "1 dashboard",
    features: ["50 keywords (account-wide)", "25 research credits/mo", "Weekly rank updates", "1 team user"],
  },
  {
    id: "business_pro", name: "Business Pro", price: 197, priceLabel: "$197", clientsLabel: "1 dashboard",
    features: ["250 keywords (account-wide)", "150 research credits/mo", "Daily rank updates", "5 team users"],
  },
];

const ALL_PLANS = [...AGENCY_PLANS, ...BUSINESS_PLANS];
const PLANS = AGENCY_PLANS;
const ACTIVATE_PLANS = AGENCY_PLANS.filter((p) => p.id !== "enterprise");

interface SubscriptionData {
  currentPlan: string;
  currentPlanPrice: number | null;
  nextBillingDate: string;
  paymentMethod: { last4: string; brand: string } | null;
  trialEndsAt?: string | null;
  trialDaysLeft?: number | null;
  billingType?: string | null;
  trialExpired?: boolean;
  usage: {
    clientDashboards: { used: number; limit: number };
    keywordsTracked: { used: number; limit: number };
    researchCredits: { used: number; limit: number };
    teamMembers: { used: number; limit: number };
    clientsWithActiveManagedServices?: number;
  };
}

const defaultSubscription: SubscriptionData = {
  currentPlan: "starter",
  currentPlanPrice: 297,
  nextBillingDate: "2026-03-03",
  paymentMethod: { last4: "4242", brand: "Visa" },
  usage: {
    clientDashboards: { used: 8, limit: 10 },
    keywordsTracked: { used: 387, limit: 500 },
    researchCredits: { used: 87, limit: 150 },
    teamMembers: { used: 2, limit: 2 },
  },
};

const SubscriptionPage = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SubscriptionData>(defaultSubscription);
  const [portalLoading, setPortalLoading] = useState(false);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [activateSetupSecret, setActivateSetupSecret] = useState<string | null>(null);
  const [activateTier, setActivateTier] = useState<string>("solo");
  const [activateSubmitting, setActivateSubmitting] = useState(false);
  const activatePaymentRef = useRef<StripePaymentHandle>(null);

  useEffect(() => {
    if (window.location.hash === "#invoices") {
      document.getElementById("invoices")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [loading]);

  const applySubscriptionData = (resData: Record<string, unknown>) => {
    const u = (resData.usage || {}) as Record<string, unknown>;
    const paymentMethod = (resData.paymentMethod as SubscriptionData["paymentMethod"]) ?? null;
    setData({
      currentPlan: (resData.currentPlan as string) ?? defaultSubscription.currentPlan,
      currentPlanPrice: (resData.currentPlanPrice as number | null) ?? defaultSubscription.currentPlanPrice,
      nextBillingDate: (resData.nextBillingDate as string) ?? defaultSubscription.nextBillingDate,
      paymentMethod,
      trialEndsAt: (resData.trialEndsAt as string | null) ?? null,
      trialDaysLeft: (resData.trialDaysLeft as number | null) ?? null,
      billingType: (resData.billingType as string | null) ?? null,
      trialExpired: (resData.trialExpired as boolean) ?? false,
      usage: {
        clientDashboards: (u.clientDashboards as { used: number; limit: number }) ?? defaultSubscription.usage.clientDashboards,
        keywordsTracked: (u.keywordsTracked as { used: number; limit: number }) ?? defaultSubscription.usage.keywordsTracked,
        researchCredits: (u.researchCredits as { used: number; limit: number }) ?? defaultSubscription.usage.researchCredits,
        teamMembers: (u.teamMembers as { used: number; limit: number }) ?? defaultSubscription.usage.teamMembers,
        clientsWithActiveManagedServices: (u.clientsWithActiveManagedServices as number) ?? 0,
      },
    });
  };

  const fetchSubscription = async (silent = false) => {
    try {
      const res = await api.get("/seo/agency/subscription");
      if (res?.data && typeof res.data === "object") {
        applySubscriptionData(res.data as Record<string, unknown>);
      }
    } catch {
      if (!silent) toast.error("Could not load subscription data.");
    } finally {
      setLoading(false);
    }
  };

  const ACTIVATION_TIER_KEY = "activationTier";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const clientSecret = params.get("setup_intent_client_secret");

    if (clientSecret && stripePromise) {
      // Return from Stripe redirect (e.g. 3D Secure): complete activation then refetch
      let cancelled = false;
      setLoading(true);
      (async () => {
        try {
          const stripe = await stripePromise;
          if (!stripe || cancelled) return;
          const { setupIntent } = await stripe.retrieveSetupIntent(clientSecret);
          const pm = setupIntent?.payment_method;
          const paymentMethodId = typeof pm === "string" ? pm : (pm as { id?: string } | null)?.id;
          const tier = sessionStorage.getItem(ACTIVATION_TIER_KEY) || "solo";
          if (!paymentMethodId || setupIntent?.status !== "succeeded") {
            toast.error("Payment was not completed. Please try again.");
            return;
          }
          await api.post("/agencies/activate-trial-subscription", {
            paymentMethodId,
            tier: tier as "solo" | "starter" | "growth" | "pro" | "enterprise",
          });
          sessionStorage.removeItem(ACTIVATION_TIER_KEY);
          window.history.replaceState({}, "", window.location.pathname + window.location.hash || "");
          const res = await api.get("/seo/agency/subscription");
          if (res?.data && typeof res.data === "object") applySubscriptionData(res.data as Record<string, unknown>);
          toast.success("Subscription activated successfully!");
        } catch (e: any) {
          toast.error(e?.response?.data?.message ?? e?.message ?? "Failed to complete activation.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    fetchSubscription(true);
  }, []);

  useEffect(() => {
    if (!showActivateModal || !stripePk) {
      setActivateSetupSecret(null);
      return;
    }
    let cancelled = false;
    api.post("/agencies/setup-intent-for-activation")
      .then((res) => {
        if (!cancelled && res.data?.clientSecret) setActivateSetupSecret(res.data.clientSecret);
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load payment form.");
        setShowActivateModal(false);
      });
    return () => { cancelled = true; };
  }, [showActivateModal]);

  const handleActivateSubscription = async () => {
    if (!activatePaymentRef.current || !activateSetupSecret) {
      toast.error("Please wait for the payment form to load.");
      return;
    }
    const tierToActivate = ACTIVATE_PLANS.some((p) => p.id === activateTier) ? activateTier : "solo";
    setActivateSubmitting(true);
    sessionStorage.setItem(ACTIVATION_TIER_KEY, tierToActivate);
    try {
      const paymentMethodId = await activatePaymentRef.current.confirmAndGetPaymentMethod();
      if (!paymentMethodId) {
        toast.error("Please complete the card details.");
        return;
      }
      await api.post("/agencies/activate-trial-subscription", {
        paymentMethodId,
        tier: tierToActivate,
      });
      sessionStorage.removeItem(ACTIVATION_TIER_KEY);
      toast.success("Subscription activated successfully!");
      setShowActivateModal(false);
      setLoading(true);
      try {
        const res = await api.get("/seo/agency/subscription");
        if (res?.data && typeof res.data === "object") applySubscriptionData(res.data as Record<string, unknown>);
      } catch {
        toast("Subscription activated. Refreshing the page will show your plan.", { icon: "✅" });
      } finally {
        setLoading(false);
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? "Failed to activate subscription.";
      toast.error(msg);
    } finally {
      setActivateSubmitting(false);
    }
  };

  const openBillingPortal = async (options?: { flow?: "subscription_update" }) => {
    setPortalLoading(true);
    try {
      const res = await api.post("/agencies/billing-portal", {
        returnUrl: window.location.href,
        ...options,
      });
      const url = res.data?.url;
      const warning = res.data?.warning;
      if (url) {
        if (warning) toast.info(warning);
        window.location.href = url;
      } else {
        toast.error(res.data?.message || "Billing portal is not available.");
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Could not open billing portal.");
    } finally {
      setPortalLoading(false);
    }
  };

  const handleManageBilling = () => openBillingPortal();

  const handleUpgradePlan = () => {
    openBillingPortal({ flow: "subscription_update" });
  };

  const handlePlanChange = async (planId: string, direction: "upgrade" | "downgrade") => {
    setPortalLoading(true);
    try {
      const res = await api.post("/agencies/change-plan", { targetPlan: planId });
      if (res.data?.success) {
        toast.success(res.data?.message ?? "Plan updated.");
        await fetchSubscription();
        return;
      }
    } catch (e: any) {
      const msg = e.response?.data?.message;
      if (msg) {
        toast.error(msg);
        return;
      }
      toast.error("Could not change plan. Try opening Manage Billing to change plan in Stripe.");
      return;
    } finally {
      setPortalLoading(false);
    }
    openBillingPortal({ flow: "subscription_update" });
  };

  const handleViewInvoiceHistory = async () => {
    setInvoicesLoading(true);
    try {
      const res = await api.post("/agencies/billing-portal", {
        returnUrl: `${window.location.origin}${window.location.pathname}#invoices`,
      });
      const url = res.data?.url;
      if (url) {
        window.location.href = url;
      } else {
        toast.error(res.data?.message || "Billing portal is not available.");
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Could not open billing portal.");
    } finally {
      setInvoicesLoading(false);
    }
  };

  const formatCurrency = (n: number | null) =>
    n != null ? `$${Number(n).toFixed(2)}` : "—";

  const currentPlanMeta = ALL_PLANS.find((p) => p.id === data.currentPlan);
  const currentPriceLabel =
    currentPlanMeta?.priceLabel ?? (data.currentPlanPrice != null ? formatCurrency(data.currentPlanPrice) : "—");
  // Before activation: free/trial accounts, no payment method, or no billing type yet → show N/A for Next Billing and Payment Method
  const hasActivatedSubscription =
    Boolean(data.paymentMethod) &&
    data.billingType != null &&
    data.billingType !== "free" &&
    data.billingType !== "trial";
  const nextBillingFormatted =
    !hasActivatedSubscription
      ? "N/A"
      : data.nextBillingDate
        ? new Date(data.nextBillingDate).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })
        : "N/A";
  const paymentMethodLabel = hasActivatedSubscription
    ? `•••• ${data.paymentMethod!.last4} (${(data.paymentMethod!.brand || "").charAt(0).toUpperCase() + (data.paymentMethod!.brand || "").slice(1).toLowerCase()})`
    : "N/A";
  const hasTrial = data.trialDaysLeft != null && data.trialDaysLeft > 0;
  const trialExpired = data.trialExpired === true;
  const billingManagedByAdmin = data.billingType === "custom";
  // No charge during 7-day trial or Free account: only "Activate Subscription" is allowed; all other billing buttons disabled.
  const isTrialFreeTier =
    (hasTrial && !trialExpired && data.billingType === "trial") || data.billingType === "free";
  // No Charge (custom only) or Free account after trial ended: show admin-managed message. For "free" we also show Activate button.
  const showAdminManagedMessage =
    (data.billingType === "free" && trialExpired) || data.billingType === "custom";

  const agencyPlanOrder = ["solo", "starter", "growth", "pro", "enterprise"];
  const businessPlanOrder = ["business_lite", "business_pro"];
  const allPlanOrder = [...businessPlanOrder, ...agencyPlanOrder];
  const currentIndex = allPlanOrder.indexOf(data.currentPlan);
  const isOnBusinessPlan = businessPlanOrder.includes(data.currentPlan);
  const isOnAgencyPlan = agencyPlanOrder.includes(data.currentPlan);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-emerald-50/30 p-8">
      <div className="relative mb-10 overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-green-600 to-teal-500 p-8 shadow-lg">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNnKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative">
          <h1 className="text-2xl font-bold text-white md:text-3xl">Subscription & Billing</h1>
          <p className="mt-2 text-emerald-100 text-sm md:text-base">Manage your plan, payment method, and billing</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : (
        <>
          {showAdminManagedMessage && (
            <div className="mb-6 p-4 rounded-xl bg-blue-50 border border-blue-200">
              <p className="text-sm font-medium text-blue-800">
                Your account is set up as <strong>{data.billingType === "custom" ? "Enterprise" : "No Charge – Free Account"}</strong>. Billing and plan changes are managed by your administrator. Contact your administrator for billing or plan questions.
              </p>
            </div>
          )}
          {trialExpired && !billingManagedByAdmin && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200">
              <p className="text-sm font-medium text-red-800 mb-3">
                Your free trial has ended. Choose a paid plan below to continue using the agency panel, or contact support.
              </p>
              <button
                type="button"
                onClick={handleUpgradePlan}
                disabled={portalLoading}
                className="px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60"
              >
                Choose a paid plan
              </button>
            </div>
          )}
          {trialExpired && data.billingType === "free" && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-sm font-medium text-amber-800">
                Your free trial has ended. Contact your administrator for plan or billing questions.
              </p>
              <p className="text-sm font-medium text-amber-800 mt-2">You can also activate a paid subscription below.</p>
              <button
                type="button"
                onClick={() => setShowActivateModal(true)}
                disabled={!stripePk}
                className="mt-3 px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60"
              >
                Activate Subscription
              </button>
            </div>
          )}
          {hasTrial && !trialExpired && data.billingType === "free" && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-sm font-medium text-amber-800">
                You have <strong>{data.trialDaysLeft} days</strong> left in your free trial. Your account is set up as No Charge; billing and plan changes are managed by your administrator after the trial.
              </p>
              <p className="text-sm font-medium text-amber-800 mt-2">You can also activate a paid subscription below.</p>
              <button
                type="button"
                onClick={() => setShowActivateModal(true)}
                disabled={!stripePk}
                className="mt-3 px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60"
              >
                Activate Subscription
              </button>
            </div>
          )}
          {data.billingType === "free" && !hasTrial && !trialExpired && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-sm font-medium text-amber-800">
                Your account is set up as a <strong>Free account</strong>. You can activate a paid subscription below to get more features and higher limits.
              </p>
              <button
                type="button"
                onClick={() => setShowActivateModal(true)}
                disabled={!stripePk}
                className="mt-3 px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60"
              >
                Activate Subscription
              </button>
            </div>
          )}
          {hasTrial && !trialExpired && data.billingType === "trial" && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-sm font-medium text-amber-800">
                You have <strong>{data.trialDaysLeft} days</strong> left in your free trial. Choose a paid plan before it ends to keep your account active.
              </p>
              <button
                type="button"
                onClick={() => setShowActivateModal(true)}
                disabled={!stripePk}
                className="mt-3 px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60"
              >
                Activate Subscription
              </button>
            </div>
          )}
          {hasTrial && !trialExpired && data.billingType !== "free" && data.billingType !== "trial" && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-sm font-medium text-amber-800">
                You have <strong>{data.trialDaysLeft} days</strong> left in your free trial. Choose a paid plan before it ends to keep your account active.
              </p>
              <button
                type="button"
                onClick={handleUpgradePlan}
                disabled={portalLoading}
                className="mt-3 px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60"
              >
                Choose a plan
              </button>
            </div>
          )}

          {/* Top Section - Current Plan Overview */}
          <section className="mb-10">
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Plan Overview</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div>
                  <p className="text-sm font-medium text-gray-500">Current Plan</p>
                  <p className="text-xl font-bold text-gray-900">
                    {currentPlanMeta?.name ?? data.currentPlan} ({currentPriceLabel}
                    {currentPlanMeta?.price != null ? "/month" : ""})
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Next Billing</p>
                  <p className="text-xl font-bold text-gray-900">{nextBillingFormatted}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Payment Method</p>
                  <p className="text-xl font-bold text-gray-900">{paymentMethodLabel}</p>
                </div>
              </div>

              <h3 className="text-sm font-semibold text-gray-700 mb-3">Your Usage</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div
                  className={`flex items-center gap-3 p-4 rounded-lg ${
                    data.usage.clientDashboards.limit > 0 && data.usage.clientDashboards.used >= data.usage.clientDashboards.limit
                      ? "bg-red-50 border border-red-200"
                      : data.usage.clientDashboards.limit > 0 &&
                        data.usage.clientDashboards.used >= data.usage.clientDashboards.limit - 1
                        ? "bg-amber-50 border border-amber-200"
                        : "bg-gray-50"
                  }`}
                >
                  <Users className="h-5 w-5 text-primary-600" />
                  <div>
                    <p className="text-xs text-gray-500">Client Dashboards</p>
                    <p
                      className={`font-semibold ${
                        data.usage.clientDashboards.used >= data.usage.clientDashboards.limit
                          ? "text-red-700"
                          : data.usage.clientDashboards.used >= data.usage.clientDashboards.limit - 1
                            ? "text-amber-700"
                            : "text-gray-900"
                      }`}
                    >
                      {data.usage.clientDashboards.used} / {data.usage.clientDashboards.limit} used
                    </p>
                    {data.usage.clientDashboards.used >= data.usage.clientDashboards.limit && (
                      <p className="text-xs text-red-600 font-medium mt-0.5">Upgrade to add more</p>
                    )}
                    {(data.usage.clientsWithActiveManagedServices ?? 0) > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {data.usage.clientsWithActiveManagedServices} with managed services
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                  <Target className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-xs text-gray-500">Keywords Tracked</p>
                    <p className="font-semibold text-gray-900">
                      {data.usage.keywordsTracked.used.toLocaleString()} /{" "}
                      {data.usage.keywordsTracked.limit.toLocaleString()} used
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                  <Search className="h-5 w-5 text-amber-600" />
                  <div>
                    <p className="text-xs text-gray-500">Keyword Research Credits</p>
                    <p className="font-semibold text-gray-900">
                      {data.usage.researchCredits.used} / {data.usage.researchCredits.limit} used this month
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                  <UserPlus className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="text-xs text-gray-500">Team Members</p>
                    <p className="font-semibold text-gray-900">
                      {data.usage.teamMembers.used} / {data.usage.teamMembers.limit} used
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleUpgradePlan}
                  disabled={portalLoading || billingManagedByAdmin || isTrialFreeTier}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60 shadow-sm"
                >
                  {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronUp className="h-4 w-4" />}
                  Upgrade Plan
                </button>
                <button
                  type="button"
                  onClick={handleManageBilling}
                  disabled={portalLoading || billingManagedByAdmin || isTrialFreeTier}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60 shadow-sm"
                >
                  {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  Manage Billing
                </button>
                <button
                  type="button"
                  onClick={handleViewInvoiceHistory}
                  disabled={invoicesLoading || billingManagedByAdmin || isTrialFreeTier}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-60"
                >
                  {invoicesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Download Invoices
                </button>
              </div>
            </div>
          </section>

          {/* Middle Section - Available Plans */}
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Available Plans</h2>
            <p className="text-sm text-gray-500 mb-8">
              {billingManagedByAdmin
                ? "Plan changes are managed by your administrator. Contact your administrator to change your plan."
                : "Upgrades are prorated and take effect immediately. Downgrades take effect at the next billing cycle."}
            </p>

            {/* Agency Plans */}
            <div className="mb-10">
              <div className="mb-4 flex items-center gap-2">
                <Briefcase className="h-4.5 w-4.5 text-primary-600" />
                <h3 className="text-base font-semibold text-gray-800">Agency Plans</h3>
                <span className="ml-1 rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700">White-label + Client Portal</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {AGENCY_PLANS.filter((p) => p.id !== "enterprise").map((plan) => {
                  const isCurrent = data.currentPlan === plan.id;
                  const planIndex = allPlanOrder.indexOf(plan.id);
                  const isHigher = planIndex > currentIndex;
                  const isLower = planIndex < currentIndex && planIndex >= 0;

                  return (
                    <div
                      key={plan.id}
                      className={`relative rounded-xl border-2 p-5 flex flex-col ${
                        isCurrent ? "border-primary-500 bg-primary-50/50" : "border-gray-200 bg-white"
                      }`}
                    >
                      {isCurrent && (
                        <span className="absolute top-3 right-3 px-2 py-0.5 rounded text-xs font-bold bg-primary-600 text-white">
                          CURRENT
                        </span>
                      )}
                      <div className="mb-3">
                        <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                        <p className="text-2xl font-bold text-gray-900 mt-1">
                          {plan.price != null ? formatCurrency(plan.price) : plan.priceLabel}
                          {plan.price != null && <span className="text-sm font-normal text-gray-500">/mo</span>}
                        </p>
                        <p className="text-xs font-medium text-primary-600 mt-0.5">{plan.clientsLabel}</p>
                      </div>
                      <ul className="flex-1 space-y-1.5 mb-4">
                        {plan.features.map((f) => (
                          <li key={f} className="flex items-start gap-1.5 text-xs text-gray-600">
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary-500" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-auto">
                        {isCurrent ? (
                          <span className="inline-block w-full text-center px-3 py-2 rounded-lg bg-gray-200 text-gray-700 text-sm font-medium">
                            Current plan
                          </span>
                        ) : isHigher ? (
                          <button
                            type="button"
                            onClick={() => handlePlanChange(plan.id, "upgrade")}
                            disabled={portalLoading || billingManagedByAdmin || isTrialFreeTier}
                            className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-60 shadow-sm"
                          >
                            <ChevronUp className="h-4 w-4" /> Upgrade
                          </button>
                        ) : isLower ? (
                          <button
                            type="button"
                            onClick={() => handlePlanChange(plan.id, "downgrade")}
                            disabled={portalLoading || billingManagedByAdmin || isTrialFreeTier}
                            className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
                          >
                            <ChevronDown className="h-4 w-4" /> Downgrade
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleManageBilling}
                            disabled={portalLoading || billingManagedByAdmin || isTrialFreeTier}
                            className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
                          >
                            Select
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Enterprise CTA */}
              <div className="mt-6 rounded-xl border-2 border-dashed border-gray-300 bg-gradient-to-r from-gray-50 to-white p-6">
                <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 shadow-md">
                    <Building2 className="h-6 w-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-bold text-gray-900">Enterprise — Custom Pricing</h4>
                    <p className="mt-0.5 text-sm text-gray-500">
                      Need more than 50 clients or advanced features? Let's build a plan around your agency.
                    </p>
                  </div>
                  <a
                    href="https://calendly.com/designmemarketing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-gradient-to-r from-gray-800 to-gray-900 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:from-gray-900 hover:to-black hover:shadow-md"
                  >
                    Book a Demo
                  </a>
                </div>
              </div>
            </div>

            {/* Business Plans */}
            <div>
              <div className="mb-4 flex items-center gap-2">
                <Building2 className="h-4.5 w-4.5 text-teal-600" />
                <h3 className="text-base font-semibold text-gray-800">Business Plans</h3>
                <span className="ml-1 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700">Single Business SEO</span>
              </div>
              <p className="text-xs text-gray-500 mb-4">For businesses tracking their own SEO — no agency features, white-label, or client portal.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 max-w-2xl gap-4">
                {BUSINESS_PLANS.map((plan) => {
                  const isCurrent = data.currentPlan === plan.id;
                  const planIndex = allPlanOrder.indexOf(plan.id);
                  const isHigher = planIndex > currentIndex;
                  const isLower = planIndex < currentIndex && planIndex >= 0;

                  return (
                    <div
                      key={plan.id}
                      className={`relative rounded-xl border-2 p-5 flex flex-col ${
                        isCurrent ? "border-teal-500 bg-teal-50/50" : "border-gray-200 bg-white"
                      }`}
                    >
                      {isCurrent && (
                        <span className="absolute top-3 right-3 px-2 py-0.5 rounded text-xs font-bold bg-teal-600 text-white">
                          CURRENT
                        </span>
                      )}
                      <div className="mb-3">
                        <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                        <p className="text-2xl font-bold text-gray-900 mt-1">
                          {formatCurrency(plan.price)}
                          <span className="text-sm font-normal text-gray-500">/mo</span>
                        </p>
                        <p className="text-xs font-medium text-teal-600 mt-0.5">{plan.clientsLabel}</p>
                      </div>
                      <ul className="flex-1 space-y-1.5 mb-4">
                        {plan.features.map((f) => (
                          <li key={f} className="flex items-start gap-1.5 text-xs text-gray-600">
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-teal-500" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-auto">
                        {isCurrent ? (
                          <span className="inline-block w-full text-center px-3 py-2 rounded-lg bg-gray-200 text-gray-700 text-sm font-medium">
                            Current plan
                          </span>
                        ) : isHigher ? (
                          <button
                            type="button"
                            onClick={() => handlePlanChange(plan.id, "upgrade")}
                            disabled={portalLoading || billingManagedByAdmin || isTrialFreeTier}
                            className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-60 shadow-sm"
                          >
                            <ChevronUp className="h-4 w-4" /> Upgrade
                          </button>
                        ) : isLower ? (
                          <button
                            type="button"
                            onClick={() => handlePlanChange(plan.id, "downgrade")}
                            disabled={portalLoading || billingManagedByAdmin || isTrialFreeTier}
                            className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
                          >
                            <ChevronDown className="h-4 w-4" /> Switch
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleManageBilling}
                            disabled={portalLoading || billingManagedByAdmin || isTrialFreeTier}
                            className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
                          >
                            Select
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section id="invoices" className="mt-10 scroll-mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500 mb-2">
              {billingManagedByAdmin ? "Invoices are managed by your administrator." : "Past invoices are available in the billing portal."}
            </p>
            <button
              type="button"
              onClick={handleViewInvoiceHistory}
              disabled={invoicesLoading || portalLoading || billingManagedByAdmin || isTrialFreeTier}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-60"
            >
              {invoicesLoading || portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download Invoices
            </button>
          </section>

          {/* Activate Subscription Modal (7-day trial agencies) */}
          {showActivateModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center p-6 border-b border-gray-200">
                  <h3 className="text-lg font-bold text-gray-900">Activate Subscription</h3>
                  <button
                    type="button"
                    onClick={() => setShowActivateModal(false)}
                    className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <p className="text-sm text-gray-600">
                    Add your payment card and select a plan to activate your subscription. You will be charged immediately.
                  </p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Subscription Tier</label>
                    <select
                      value={ACTIVATE_PLANS.some((p) => p.id === activateTier) ? activateTier : "solo"}
                      onChange={(e) => setActivateTier(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    >
                      {ACTIVATE_PLANS.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} – {plan.priceLabel}
                          {plan.price != null ? "/mo" : ""} – {plan.clientsLabel}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Card details</label>
                    {!stripePk ? (
                      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                        Stripe is not configured. Contact support.
                      </p>
                    ) : activateSetupSecret && stripePromise ? (
                      <Elements stripe={stripePromise} options={{ clientSecret: activateSetupSecret }}>
                        <StripePaymentSection ref={activatePaymentRef} clientSecret={activateSetupSecret} />
                      </Elements>
                    ) : (
                      <p className="text-sm text-gray-500">Loading payment form…</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-3 p-6 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                  <button
                    type="button"
                    onClick={() => setShowActivateModal(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleActivateSubscription}
                    disabled={activateSubmitting || !activateSetupSecret}
                    className="flex-1 px-4 py-2.5 rounded-lg font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {activateSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                        Activating…
                      </>
                    ) : (
                      "Activate"
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SubscriptionPage;
