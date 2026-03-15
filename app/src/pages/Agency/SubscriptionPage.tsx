import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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
  Check,
  Briefcase,
  Building2,
  X,
} from "lucide-react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import api from "@/lib/api";
import { loadStripe } from "@/lib/stripe";
import toast from "react-hot-toast";

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
const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
let billingStripePromise: ReturnType<typeof loadStripe> | null = null;
const getBillingStripePromise = () => {
  if (!stripePk) return null;
  if (!billingStripePromise) billingStripePromise = loadStripe(stripePk, { advancedFraudSignals: false } as any);
  return billingStripePromise;
};

type StripePaymentHandle = { confirmAndGetPaymentMethod: () => Promise<string | null> };
const StripePaymentSection = forwardRef<StripePaymentHandle, { clientSecret: string; onReady?: () => void }>(
  function StripePaymentSection({ clientSecret, onReady }, ref) {
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
          redirect: "if_required",
        });
        if (result.error) throw new Error(result.error.message ?? "Payment setup failed.");
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
          onReady={onReady}
        />
      </div>
    );
  }
);

interface SubscriptionData {
  currentPlan: string;
  currentPlanPrice: number | null;
  nextBillingDate: string;
  cancelAtPeriodEnd?: boolean;
  cancellationEffectiveAt?: string | null;
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

interface BillingInvoice {
  id: string;
  number: string | null;
  createdAt: string;
  status: string | null;
  totalCents: number;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

const defaultSubscription: SubscriptionData = {
  currentPlan: "solo",
  currentPlanPrice: null,
  nextBillingDate: "",
  paymentMethod: null,
  usage: {
    clientDashboards: { used: 0, limit: 0 },
    keywordsTracked: { used: 0, limit: 0 },
    researchCredits: { used: 0, limit: 0 },
    teamMembers: { used: 0, limit: 0 },
  },
};

const SubscriptionPage = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SubscriptionData>(defaultSubscription);
  const [portalLoading, setPortalLoading] = useState(false);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [upgradeConfirmPlanId, setUpgradeConfirmPlanId] = useState<string | null>(null);
  const [upgradeProrationAmountLabel, setUpgradeProrationAmountLabel] = useState<string | null>(null);
  const [upgradeProrationLoading, setUpgradeProrationLoading] = useState(false);
  const [billingManageModalOpen, setBillingManageModalOpen] = useState(false);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [paymentElementReady, setPaymentElementReady] = useState(false);
  const [paymentMethodSaving, setPaymentMethodSaving] = useState(false);
  const [cancelActionLoading, setCancelActionLoading] = useState(false);
  const paymentRef = useRef<StripePaymentHandle>(null);
  const canCloseBillingManageModal = !paymentMethodSaving && !cancelActionLoading;
  const closeBillingManageModal = () => {
    if (!canCloseBillingManageModal) return;
    setBillingManageModalOpen(false);
  };

  useEffect(() => {
    if (window.location.hash === "#invoices") {
      document.getElementById("invoices")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [loading]);

  useEffect(() => {
    // Some browser extensions block Stripe telemetry (r.stripe.com), which can throw noisy
    // unhandled promise rejections even when payment flows still function.
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { message?: string } | string | undefined;
      const message = typeof reason === "string" ? reason : reason?.message ?? "";
      if (message.includes("r.stripe.com/b") && message.includes("Failed to fetch")) {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  const applySubscriptionData = (resData: Record<string, unknown>) => {
    const u = (resData.usage || {}) as Record<string, unknown>;
    const paymentMethod = (resData.paymentMethod as SubscriptionData["paymentMethod"]) ?? null;
    setData({
      currentPlan: (resData.currentPlan as string) ?? defaultSubscription.currentPlan,
      currentPlanPrice: (resData.currentPlanPrice as number | null) ?? defaultSubscription.currentPlanPrice,
      nextBillingDate: (resData.nextBillingDate as string) ?? "",
      cancelAtPeriodEnd: (resData.cancelAtPeriodEnd as boolean) ?? false,
      cancellationEffectiveAt: (resData.cancellationEffectiveAt as string | null) ?? null,
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

  useEffect(() => {
    fetchSubscription(true);
  }, []);

  const fetchInvoices = async (silent = false) => {
    setInvoicesLoading(true);
    try {
      const res = await api.get("/agencies/billing-invoices");
      const rows = Array.isArray(res?.data?.items) ? (res.data.items as BillingInvoice[]) : [];
      setInvoices(rows);
    } catch (e: any) {
      if (!silent) {
        toast.error(e.response?.data?.message || "Could not load invoices.");
      }
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices(true);
  }, []);

  const openBillingPortal = async (options?: { flow?: "subscription_update"; returnUrl?: string }) => {
    setPortalLoading(true);
    try {
      const res = await api.post("/agencies/billing-portal", {
        returnUrl: options?.returnUrl ?? window.location.href,
        ...options,
      });
      const url = res.data?.url;
      const warning = res.data?.warning;
      if (url) {
        if (warning) toast(warning, { icon: "ℹ️" });
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

  const handleManageBilling = () => setBillingManageModalOpen(true);

  const handleUpgradePlan = () => {
    openBillingPortal({ flow: "subscription_update" });
  };

  const executePlanChange = async (planId: string) => {
    setPortalLoading(true);
    try {
      const res = await api.post("/agencies/change-plan", { targetPlan: planId }, { _silent: true } as any);
      if (res.data?.success) {
        toast.success(res.data?.message ?? "Plan updated.");
        window.dispatchEvent(new Event("subscription-changed"));
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

  const handlePlanChange = async (planId: string, direction: "upgrade" | "downgrade") => {
    if (direction === "upgrade") {
      setUpgradeConfirmPlanId(planId);
      setUpgradeProrationAmountLabel(null);
      setUpgradeProrationLoading(true);
      api.post("/agencies/change-plan-preview", { targetPlan: planId }, { _silent: true } as any)
        .then((res) => {
          const cents = Number(res.data?.amountDueTodayCents ?? NaN);
          const currency = String(res.data?.currency || "usd").toUpperCase();
          if (Number.isFinite(cents)) {
            const amount = new Intl.NumberFormat("en-US", {
              style: "currency",
              currency,
            }).format(cents / 100);
            setUpgradeProrationAmountLabel(amount);
          } else {
            setUpgradeProrationAmountLabel(null);
          }
        })
        .catch(() => {
          setUpgradeProrationAmountLabel(null);
        })
        .finally(() => {
          setUpgradeProrationLoading(false);
        });
      return;
    }
    await executePlanChange(planId);
  };

  const handleConfirmUpgrade = async () => {
    if (!upgradeConfirmPlanId) return;
    const selectedPlanId = upgradeConfirmPlanId;
    setUpgradeConfirmPlanId(null);
    setUpgradeProrationAmountLabel(null);
    setUpgradeProrationLoading(false);
    await executePlanChange(selectedPlanId);
  };

  const handleViewInvoiceHistory = async () => {
    await fetchInvoices();
  };

  useEffect(() => {
    if (!billingManageModalOpen || !stripePk) {
      setSetupSecret(null);
      setSetupLoading(false);
      setPaymentElementReady(false);
      return;
    }
    let cancelled = false;
    setSetupLoading(true);
    setPaymentElementReady(false);
    api.post("/agencies/setup-intent-for-activation")
      .then((res) => {
        if (!cancelled) setSetupSecret(res.data?.clientSecret ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setSetupSecret(null);
          toast.error("Could not load payment form.");
        }
      })
      .finally(() => {
        if (!cancelled) setSetupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [billingManageModalOpen]);

  useEffect(() => {
    if (!billingManageModalOpen) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeBillingManageModal();
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [billingManageModalOpen, canCloseBillingManageModal]);

  const handleSavePaymentMethod = async () => {
    if (!paymentRef.current || !setupSecret || !paymentElementReady) {
      toast.error("Please wait for the payment form to load.");
      return;
    }
    setPaymentMethodSaving(true);
    try {
      const paymentMethodId = await paymentRef.current.confirmAndGetPaymentMethod();
      if (!paymentMethodId) {
        toast.error("Please complete the card details.");
        return;
      }
      await api.post("/agencies/subscription/payment-method", { paymentMethodId });
      toast.success("Payment method updated.");
      await fetchSubscription(true);
      await fetchInvoices(true);
      setBillingManageModalOpen(false);
    } catch (e: any) {
      toast.error(e.response?.data?.message || e?.message || "Could not update payment method.");
    } finally {
      setPaymentMethodSaving(false);
    }
  };

  const handleScheduleCancellation = async () => {
    setCancelActionLoading(true);
    try {
      const res = await api.post("/agencies/subscription/cancel");
      toast.success(res.data?.message || "Subscription cancellation scheduled.");
      await fetchSubscription(true);
      setBillingManageModalOpen(false);
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Could not schedule cancellation.");
    } finally {
      setCancelActionLoading(false);
    }
  };

  const handleReactivateSubscription = async () => {
    setCancelActionLoading(true);
    try {
      const res = await api.post("/agencies/subscription/reactivate");
      toast.success(res.data?.message || "Subscription reactivated.");
      await fetchSubscription(true);
      setBillingManageModalOpen(false);
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Could not reactivate subscription.");
    } finally {
      setCancelActionLoading(false);
    }
  };

  const formatCurrency = (n: number | null) =>
    n != null ? `$${Number(n).toFixed(2)}` : "—";
  const formatInvoiceAmount = (cents: number, currency: string) => {
    const amount = Number(cents || 0) / 100;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format(amount);
  };
  const handleDownloadInvoice = async (invoice: BillingInvoice) => {
    setDownloadingInvoiceId(invoice.id);
    try {
      const res = await api.get(`/agencies/billing-invoices/${invoice.id}/download`, {
        responseType: "blob",
      });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeNumber = String(invoice.number || invoice.id).replace(/[^a-zA-Z0-9_-]/g, "-");
      a.href = url;
      a.download = `invoice-${safeNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Could not download invoice.");
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  const currentPlanMeta = ALL_PLANS.find((p) => p.id === data.currentPlan);
  const currentPriceLabel =
    currentPlanMeta?.priceLabel ?? (data.currentPlanPrice != null ? formatCurrency(data.currentPlanPrice) : "—");
  // Before activation: free/trial accounts, no payment method, or no billing type yet → show N/A for Next Billing and Payment Method
  const hasActivatedSubscription =
    Boolean(data.paymentMethod) &&
    data.billingType != null &&
    data.billingType !== "free" &&
    data.billingType !== "trial";
  const cancellationScheduled = data.cancelAtPeriodEnd === true;
  const cancellationEffectiveFormatted = data.cancellationEffectiveAt
    ? new Date(data.cancellationEffectiveAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "N/A";
  const billingDateLabel = cancellationScheduled ? "Subscription Ends" : "Next Billing";
  const nextBillingFormatted =
    cancellationScheduled
      ? cancellationEffectiveFormatted
      : !hasActivatedSubscription
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
  const trialEndsFormatted =
    hasTrial && data.trialEndsAt
      ? new Date(data.trialEndsAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null;
  const billingManagedByAdmin = data.billingType === "custom";
  // No charge during 7-day trial or Free account: only "Activate Subscription" is allowed; all other billing buttons disabled.
  const isTrialFreeTier =
    (hasTrial && !trialExpired && data.billingType === "trial") || data.billingType === "free";
  // Only custom billing shows the admin-managed blue message.
  const showAdminManagedMessage = data.billingType === "custom";

  const agencyPlanOrder = ["solo", "starter", "growth", "pro", "enterprise"];
  const businessPlanOrder = ["business_lite", "business_pro"];
  const allPlanOrder = [...businessPlanOrder, ...agencyPlanOrder];
  const currentIndex = allPlanOrder.indexOf(data.currentPlan);
  const upgradeConfirmPlan = upgradeConfirmPlanId
    ? ALL_PLANS.find((p) => p.id === upgradeConfirmPlanId)
    : null;
  const upgradeConfirmAmount =
    upgradeProrationAmountLabel ??
    (upgradeConfirmPlan?.price != null ? formatCurrency(upgradeConfirmPlan.price) : upgradeConfirmPlan?.priceLabel ?? "N/A");
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
          {trialExpired && data.billingType !== "free" && !billingManagedByAdmin && (
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
          {cancellationScheduled && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200">
              <p className="text-sm font-medium text-red-800">
                Your subscription is canceled and will end on <strong>{cancellationEffectiveFormatted}</strong>. No future billing day is scheduled.
              </p>
            </div>
          )}
          {hasTrial && !trialExpired && data.billingType === "trial" && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-sm font-medium text-amber-800">
                You have <strong>{data.trialDaysLeft} days</strong> left in your free trial. Choose a paid plan before it ends to keep your account active.
              </p>
            </div>
          )}
          {hasTrial && !trialExpired && data.billingType !== "free" && data.billingType !== "trial" && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-sm font-medium text-amber-800">
                Your selected plan is active with a <strong>{data.trialDaysLeft} day{data.trialDaysLeft === 1 ? "" : "s"}</strong> free trial. You will be charged on the next billing date shown below unless you cancel before then.
              </p>
              <button
                type="button"
                onClick={handleManageBilling}
                disabled={portalLoading}
                className="mt-3 px-4 py-2 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60"
              >
                Manage Billing
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
                  <p className="text-sm font-medium text-gray-500">{billingDateLabel}</p>
                  <p className="text-xl font-bold text-gray-900">{nextBillingFormatted}</p>
                  {trialEndsFormatted && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      Trial ends on {trialEndsFormatted}
                    </p>
                  )}
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
                  Refresh Invoices
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
                    href="https://links.yourseodashboard.com/widget/booking/auRus7uzX9SW4C6mJncd"
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
                  const businessDashboardLimit = plan.id === "business_lite" || plan.id === "business_pro" ? 1 : null;
                  const exceedsBusinessDashboardLimit =
                    businessDashboardLimit != null && data.usage.clientDashboards.used > businessDashboardLimit;
                  const disableBusinessSwitch =
                    exceedsBusinessDashboardLimit || portalLoading || billingManagedByAdmin || isTrialFreeTier;

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
                            disabled={disableBusinessSwitch}
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
                        {exceedsBusinessDashboardLimit && !isCurrent && (
                          <p className="mt-2 text-xs font-medium text-amber-700">
                            You currently have {data.usage.clientDashboards.used} clients. {plan.name} allows 1 client dashboard.
                          </p>
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
              {billingManagedByAdmin ? "Invoices are managed by your administrator." : "Past invoices are available below."}
            </p>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <p className="text-sm font-medium text-gray-800">Invoice History</p>
                <button
                  type="button"
                  onClick={handleViewInvoiceHistory}
                  disabled={invoicesLoading || billingManagedByAdmin || isTrialFreeTier}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {invoicesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Refresh
                </button>
              </div>
              {isTrialFreeTier || billingManagedByAdmin ? (
                <div className="px-4 py-6 text-sm text-gray-500">
                  {billingManagedByAdmin
                    ? "Invoice access is managed by your administrator."
                    : "Invoices will appear once your paid subscription is active."}
                </div>
              ) : invoices.length === 0 ? (
                <div className="px-4 py-6 text-sm text-gray-500">
                  {invoicesLoading ? "Loading invoices..." : "No invoices available yet."}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Invoice</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Date</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-600">Amount</th>
                        <th className="px-4 py-2 text-right font-medium text-gray-600">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {invoices.map((inv) => (
                        <tr key={inv.id}>
                          <td className="px-4 py-2 text-gray-800">{inv.number || inv.id}</td>
                          <td className="px-4 py-2 text-gray-700">
                            {new Date(inv.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </td>
                          <td className="px-4 py-2 text-gray-700">{inv.status || "—"}</td>
                          <td className="px-4 py-2 text-gray-900 font-medium">
                            {formatInvoiceAmount(inv.totalCents, inv.currency)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {inv.invoicePdfUrl || inv.hostedInvoiceUrl ? (
                              <button
                                type="button"
                                onClick={() => handleDownloadInvoice(inv)}
                                disabled={downloadingInvoiceId === inv.id}
                                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                              >
                                <Download className="h-3.5 w-3.5" />
                                {downloadingInvoiceId === inv.id ? "Downloading..." : "Download"}
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">Unavailable</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

        </>
      )}

      {upgradeConfirmPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Confirm Upgrade</h3>
            <p className="mt-3 text-sm text-gray-700">
              You are about to upgrade to <strong>{upgradeConfirmPlan.name}</strong>.
            </p>
            <p className="mt-1 text-sm text-gray-700">
              <strong>{upgradeProrationLoading ? "Calculating..." : upgradeConfirmAmount}</strong> will be billed today.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setUpgradeConfirmPlanId(null)}
                disabled={portalLoading}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmUpgrade}
                disabled={portalLoading}
                className="inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm Upgrade"}
              </button>
            </div>
          </div>
        </div>
      )}

      {billingManageModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:items-center sm:p-4"
          onClick={closeBillingManageModal}
        >
          <div
            className="w-full max-w-2xl rounded-xl bg-white p-4 shadow-xl sm:p-6 max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Manage Billing</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Manage payment method and subscription status directly on this page.
                </p>
              </div>
              <button
                type="button"
                onClick={closeBillingManageModal}
                disabled={!canCloseBillingManageModal}
                aria-label="Close manage billing dialog"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <h4 className="text-sm font-semibold text-gray-800">Update Payment Method</h4>
                <p className="mt-1 text-xs text-gray-500">Add or replace the card used for future invoices.</p>
                <div className="mt-3">
                  {!stripePk ? (
                    <p className="text-sm text-red-600">Stripe publishable key is not configured.</p>
                  ) : setupLoading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading secure payment form...
                    </div>
                  ) : setupSecret ? (
                    <Elements
                      stripe={getBillingStripePromise()}
                      options={{
                        clientSecret: setupSecret,
                        appearance: { theme: "stripe" },
                      }}
                    >
                      <StripePaymentSection
                        ref={paymentRef}
                        clientSecret={setupSecret}
                        onReady={() => setPaymentElementReady(true)}
                      />
                    </Elements>
                  ) : (
                    <p className="text-sm text-red-600">Could not load payment form.</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSavePaymentMethod}
                  disabled={paymentMethodSaving || setupLoading || !setupSecret || !paymentElementReady}
                  className="mt-3 inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
                >
                  {paymentMethodSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Card"}
                </button>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-800">Subscription Status</h4>
                <p className="mt-1 text-xs text-gray-500">
                  {cancellationScheduled
                    ? "Your subscription is currently scheduled to end."
                    : "You can schedule cancellation at period end."}
                </p>
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                  {cancellationScheduled
                    ? `Scheduled to end on ${cancellationEffectiveFormatted}.`
                    : "Subscription is active."}
                </div>
                {cancellationScheduled ? (
                  <button
                    type="button"
                    onClick={handleReactivateSubscription}
                    disabled={cancelActionLoading}
                    className="mt-3 inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {cancelActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reactivate Subscription"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleScheduleCancellation}
                    disabled={cancelActionLoading}
                    className="mt-3 inline-flex items-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                  >
                    {cancelActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancel at Period End"}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={closeBillingManageModal}
                disabled={paymentMethodSaving || cancelActionLoading}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionPage;
