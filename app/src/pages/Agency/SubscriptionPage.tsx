import React, { useEffect, useState } from "react";
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
} from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";

const PLANS = [
  { id: "solo", name: "Solo", price: 147, priceLabel: "$147", clients: 3, clientsLabel: "3 clients" },
  { id: "starter", name: "Starter", price: 297, priceLabel: "$297", clients: 10, clientsLabel: "10 clients" },
  { id: "growth", name: "Growth", price: 597, priceLabel: "$597", clients: 25, clientsLabel: "25 clients" },
  { id: "pro", name: "Pro", price: 997, priceLabel: "$997", clients: 50, clientsLabel: "50 clients" },
  { id: "enterprise", name: "Enterprise", price: null, priceLabel: "Custom", clients: null, clientsLabel: "Unlimited" },
];

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

  useEffect(() => {
    if (window.location.hash === "#invoices") {
      document.getElementById("invoices")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [loading]);

  const fetchSubscription = async () => {
    try {
      const res = await api.get("/seo/agency/subscription").catch(() => ({ data: null }));
      if (res?.data && typeof res.data === "object") {
        setData({
          currentPlan: res.data.currentPlan ?? defaultSubscription.currentPlan,
          currentPlanPrice: res.data.currentPlanPrice ?? defaultSubscription.currentPlanPrice,
          nextBillingDate: res.data.nextBillingDate ?? defaultSubscription.nextBillingDate,
          paymentMethod: res.data.paymentMethod ?? defaultSubscription.paymentMethod,
          trialEndsAt: res.data.trialEndsAt ?? null,
          trialDaysLeft: res.data.trialDaysLeft ?? null,
          billingType: res.data.billingType ?? null,
          trialExpired: res.data.trialExpired ?? false,
          usage: {
            clientDashboards: res.data.usage?.clientDashboards ?? defaultSubscription.usage.clientDashboards,
            keywordsTracked: res.data.usage?.keywordsTracked ?? defaultSubscription.usage.keywordsTracked,
            researchCredits: res.data.usage?.researchCredits ?? defaultSubscription.usage.researchCredits,
            teamMembers: res.data.usage?.teamMembers ?? defaultSubscription.usage.teamMembers,
            clientsWithActiveManagedServices: res.data.usage?.clientsWithActiveManagedServices ?? 0,
          },
        });
      }
    } catch {
      // keep default
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscription();
  }, []);

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

  const currentPlanMeta = PLANS.find((p) => p.id === data.currentPlan);
  const currentPriceLabel =
    currentPlanMeta?.priceLabel ?? (data.currentPlanPrice != null ? formatCurrency(data.currentPlanPrice) : "—");
  const nextBillingFormatted = data.nextBillingDate
    ? new Date(data.nextBillingDate).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "—";
  const paymentMethodLabel = data.paymentMethod
    ? `•••• ${data.paymentMethod.last4} (${(data.paymentMethod.brand || "").charAt(0).toUpperCase() + (data.paymentMethod.brand || "").slice(1).toLowerCase()})`
    : "—";
  const hasTrial = data.trialDaysLeft != null && data.trialDaysLeft > 0;
  const trialExpired = data.trialExpired === true;
  const billingManagedByAdmin = data.billingType === "free" || data.billingType === "custom";
  // No Charge: show admin-managed message only after trial ends. Manual Invoice: always.
  const showAdminManagedMessage =
    (data.billingType === "free" && trialExpired) || data.billingType === "custom";

  const planOrder = ["solo", "starter", "growth", "pro", "enterprise"];
  const currentIndex = planOrder.indexOf(data.currentPlan);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Subscription</h1>

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
            </div>
          )}
          {hasTrial && !trialExpired && data.billingType === "free" && (
            <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-sm font-medium text-amber-800">
                You have <strong>{data.trialDaysLeft} days</strong> left in your free trial. Your account is set up as No Charge; billing and plan changes are managed by your administrator after the trial.
              </p>
            </div>
          )}
          {hasTrial && !trialExpired && data.billingType !== "free" && (
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
                  disabled={portalLoading || billingManagedByAdmin}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60 shadow-sm"
                >
                  {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronUp className="h-4 w-4" />}
                  Upgrade Plan
                </button>
                <button
                  type="button"
                  onClick={handleManageBilling}
                  disabled={portalLoading || billingManagedByAdmin}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60 shadow-sm"
                >
                  {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  Manage Billing
                </button>
                <button
                  type="button"
                  onClick={handleViewInvoiceHistory}
                  disabled={invoicesLoading || billingManagedByAdmin}
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
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Plans</h2>
            <p className="text-sm text-gray-500 mb-6">
              {billingManagedByAdmin
                ? "Plan changes are managed by your administrator. Contact your administrator to change your plan."
                : "Plan changes use Stripe's billing portal. Upgrades are prorated and take effect immediately. Downgrades take effect at the next billing cycle."}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {PLANS.map((plan) => {
                const isCurrent = data.currentPlan === plan.id;
                const planIndex = planOrder.indexOf(plan.id);
                const isHigher = planIndex > currentIndex;
                const isLower = planIndex < currentIndex && planIndex >= 0;

                return (
                  <div
                    key={plan.id}
                    className={`relative rounded-xl border-2 p-5 ${
                      isCurrent ? "border-primary-500 bg-primary-50/50" : "border-gray-200 bg-white"
                    }`}
                  >
                    {isCurrent && (
                      <span className="absolute top-3 right-3 px-2 py-0.5 rounded text-xs font-bold bg-primary-600 text-white">
                        CURRENT
                      </span>
                    )}
                    <div className="mb-4">
                      <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                      <p className="text-2xl font-bold text-gray-900 mt-1">
                        {plan.price != null ? formatCurrency(plan.price) : plan.priceLabel}
                        {plan.price != null && "/month"}
                      </p>
                      <p className="text-sm text-gray-600 mt-0.5">{plan.clientsLabel}</p>
                    </div>
                    <div className="mt-4">
                      {isCurrent ? (
                        <span className="inline-block w-full text-center px-3 py-1.5 rounded-lg bg-gray-200 text-gray-700 text-sm font-medium">
                          Current plan
                        </span>
                      ) : isHigher ? (
                        <button
                          type="button"
                          onClick={() => handlePlanChange(plan.id, "upgrade")}
                          disabled={portalLoading || billingManagedByAdmin}
                          className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-60 shadow-sm"
                        >
                          Upgrade
                        </button>
                      ) : isLower ? (
                        <button
                          type="button"
                          onClick={() => handlePlanChange(plan.id, "downgrade")}
                          disabled={portalLoading || billingManagedByAdmin}
                          className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
                        >
                          <ChevronDown className="h-4 w-4" /> Downgrade
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleManageBilling}
                          disabled={portalLoading || billingManagedByAdmin}
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
          </section>

          <section id="invoices" className="mt-10 scroll-mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500 mb-2">
              {billingManagedByAdmin ? "Invoices are managed by your administrator." : "Past invoices are available in the billing portal."}
            </p>
            <button
              type="button"
              onClick={handleViewInvoiceHistory}
              disabled={invoicesLoading || portalLoading || billingManagedByAdmin}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-60"
            >
              {invoicesLoading || portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download Invoices
            </button>
          </section>
        </>
      )}
    </div>
  );
};

export default SubscriptionPage;
