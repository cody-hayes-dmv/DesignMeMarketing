import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { loadStripe } from "@/lib/stripe";

interface ActiveAddOn {
  id: string;
  addOnType: string;
  addOnOption: string;
  displayName: string;
  details: string | null;
  priceCents: number;
  billingInterval: string;
  createdAt: string;
}

const EXTRA_DASHBOARDS = [
  { option: "5_slots", label: "+5 client dashboards", priceLabel: "$99/month" },
  { option: "10_slots", label: "+10 client dashboards", priceLabel: "$179/month" },
  { option: "25_slots", label: "+25 client dashboards", priceLabel: "$399/month" },
];
const EXTRA_DASHBOARDS_AVAILABLE = "Solo, Starter, Growth, Pro, Enterprise";

const EXTRA_KEYWORDS_TRACKED = [
  { option: "50", label: "+50 keywords tracked", priceLabel: "$29/month" },
  { option: "100", label: "+100 keywords tracked", priceLabel: "$49/month" },
  { option: "250", label: "+250 keywords tracked", priceLabel: "$89/month" },
];
const EXTRA_KEYWORDS_TRACKED_AVAILABLE = "All tiers (Business Lite, Business Pro, Solo, Starter, Growth, Pro, Enterprise)";

const EXTRA_RESEARCH_CREDITS = [
  { option: "50", label: "+50 research credits/month", priceLabel: "$29/month" },
  { option: "150", label: "+150 research credits/month", priceLabel: "$69/month" },
  { option: "300", label: "+300 research credits/month", priceLabel: "$119/month" },
];
const EXTRA_RESEARCH_CREDITS_AVAILABLE = "All tiers";

const EXTRA_GRID_KEYWORDS = [
  {
    option: "5",
    label: "+5 Grid Keywords",
    priceLabel: "$29/mo",
    apiCostLabel: "~$7.85/mo",
    marginLabel: "~73%",
  },
  {
    option: "15",
    label: "+15 Grid Keywords",
    priceLabel: "$69/mo",
    apiCostLabel: "~$23.55/mo",
    marginLabel: "~66%",
  },
];
const EXTRA_GRID_KEYWORDS_AVAILABLE = "Solo, Starter, Growth, Pro, Enterprise";

const EXTRA_SNAPSHOTS = [
  {
    pack: "5",
    label: "5 Snapshots",
    priceLabel: "$19 one-time",
    creditsLabel: "5",
    apiCostLabel: "~$3.90",
    marginLabel: "~79%",
  },
  {
    pack: "10",
    label: "10 Snapshots",
    priceLabel: "$34 one-time",
    creditsLabel: "10",
    apiCostLabel: "~$7.80",
    marginLabel: "~77%",
  },
  {
    pack: "25",
    label: "25 Snapshots",
    priceLabel: "$74 one-time",
    creditsLabel: "25",
    apiCostLabel: "~$19.50",
    marginLabel: "~74%",
  },
] as const;
const EXTRA_SNAPSHOTS_AVAILABLE = "All paid tiers";

const TIER_LABELS: Record<string, string> = {
  business_lite: "Business Lite",
  business_pro: "Business Pro",
  solo: "Solo",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  enterprise: "Enterprise",
};

const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
let addOnsStripePromise: ReturnType<typeof loadStripe> | null = null;
const getAddOnsStripePromise = () => {
  if (!stripePk) return null;
  if (!addOnsStripePromise) addOnsStripePromise = loadStripe(stripePk, { advancedFraudSignals: false } as any);
  return addOnsStripePromise;
};

interface AllowedAddOns {
  extra_dashboards: string[];
  extra_keywords_tracked: string[];
  extra_keyword_lookups: string[];
  local_map_rankings_extra_keywords: string[];
}

interface AgencyMe {
  tierId: string | null;
  allowedAddOns: AllowedAddOns;
  basePriceMonthlyUsd: number | null;
  accountActivated?: boolean;
  trialActive?: boolean;
}

const AddOnsPage = () => {
  const location = useLocation();
  const [activeAddOns, setActiveAddOns] = useState<ActiveAddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [agencyMe, setAgencyMe] = useState<AgencyMe | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeModalAddOn, setRemoveModalAddOn] = useState<ActiveAddOn | null>(null);
  const [showTierBreakdown, setShowTierBreakdown] = useState(false);
  const [snapshotCheckoutPack, setSnapshotCheckoutPack] = useState<string | null>(null);
  const [snapshotCheckoutOpen, setSnapshotCheckoutOpen] = useState(false);
  const [snapshotCheckoutClientSecret, setSnapshotCheckoutClientSecret] = useState<string | null>(null);
  const [snapshotCheckoutSessionId, setSnapshotCheckoutSessionId] = useState<string | null>(null);
  const [snapshotCheckoutSessionUrl, setSnapshotCheckoutSessionUrl] = useState<string | null>(null);
  const snapshotCheckoutMountRef = useRef<HTMLDivElement | null>(null);
  const snapshotCheckoutInstanceRef = useRef<any>(null);
  const snapshotPurchaseHandledRef = useRef(false);

  const fetchAddOns = useCallback(async () => {
    try {
      const res = await api.get<ActiveAddOn[]>("/agencies/add-ons");
      setActiveAddOns(Array.isArray(res.data) ? res.data : []);
    } catch {
      setActiveAddOns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAgencyMe = useCallback(async () => {
    try {
      const res = await api.get("/agencies/me");
      setAgencyMe({
        tierId: res.data?.tierId ?? null,
        allowedAddOns: res.data?.allowedAddOns ?? {
          extra_dashboards: [],
          extra_keywords_tracked: [],
          extra_keyword_lookups: [],
          local_map_rankings_extra_keywords: [],
        },
        basePriceMonthlyUsd: res.data?.basePriceMonthlyUsd ?? null,
        accountActivated: res.data?.accountActivated !== false,
        trialActive: res.data?.trialActive === true,
      });
    } catch {
      setAgencyMe(null);
    }
  }, []);

  useEffect(() => {
    void fetchAddOns();
    void fetchAgencyMe();
  }, [fetchAddOns, fetchAgencyMe]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const params = new URLSearchParams(location.search);
    const status = params.get("snapshotCreditsPurchase");
    if (status === "success") {
      toast.success("Snapshot credits purchased successfully.");
      void fetchAgencyMe();
      void fetchAddOns();
      timeoutId = setTimeout(() => {
        void fetchAddOns();
      }, 2500);
    } else if (status === "cancelled") {
      toast.error("Snapshot credit purchase was cancelled.");
    }
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [location.search, fetchAddOns, fetchAgencyMe]);

  const addAddOn = async (
    addOnType: "extra_dashboards" | "extra_keywords_tracked" | "extra_keyword_lookups" | "local_map_rankings_extra_keywords",
    addOnOption: string
  ) => {
    const key = `${addOnType}-${addOnOption}`;
    setPurchasing(key);
    try {
      await api.post("/agencies/add-ons", { addOnType, addOnOption });
      toast.success("Add-on added to your plan. Your limits have been updated.");
      await fetchAddOns();
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Failed to add add-on.");
    } finally {
      setPurchasing(null);
    }
  };

  const startSnapshotCheckout = async (pack: "5" | "10" | "25") => {
    setSnapshotCheckoutPack(pack);
    try {
      const res = await api.post(
        "/agencies/add-ons/local-map-snapshot-credits/checkout",
        { pack, uiMode: "embedded" },
        { _silent: true } as any
      );
      const clientSecret = String(res?.data?.clientSecret || "");
      const url = String(res?.data?.url || "");
      const sessionId = String(res?.data?.sessionId || "");
      if (!clientSecret && !url) {
        toast.error("Could not start checkout.");
        return;
      }
      if (clientSecret) {
        snapshotPurchaseHandledRef.current = false;
        setSnapshotCheckoutClientSecret(clientSecret);
        setSnapshotCheckoutSessionId(sessionId || null);
        setSnapshotCheckoutSessionUrl(url || null);
        setSnapshotCheckoutOpen(true);
        return;
      }
      window.location.href = url;
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Failed to start checkout.");
    } finally {
      setSnapshotCheckoutPack(null);
    }
  };

  const closeSnapshotCheckoutModal = () => {
    const checkout = snapshotCheckoutInstanceRef.current;
    snapshotCheckoutInstanceRef.current = null;
    if (checkout && typeof checkout.destroy === "function") {
      void checkout.destroy();
    }
    setSnapshotCheckoutOpen(false);
    setSnapshotCheckoutClientSecret(null);
    setSnapshotCheckoutSessionId(null);
    setSnapshotCheckoutSessionUrl(null);
  };

  const waitMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const confirmSnapshotCheckoutWithRetry = useCallback(async (sessionId: string) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await api.post(
          "/agencies/add-ons/local-map-snapshot-credits/confirm",
          { sessionId },
          { _silent: true } as any
        );
        return true;
      } catch (e: any) {
        const status = Number(e?.response?.status || 0);
        // 409 = Stripe payment not finalized yet. Retry shortly.
        // 400 can happen transiently if metadata propagation is delayed.
        if (status !== 409 && status !== 400) {
          return false;
        }
      }
      await waitMs(900);
    }
    return false;
  }, []);

  const refreshAfterSnapshotPackPurchase = useCallback(async () => {
    // Webhook processing can be slightly delayed; poll briefly so Active Add-Ons updates reliably.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await fetchAgencyMe();
      await fetchAddOns();
      if (attempt < 5) {
        await waitMs(1200);
      }
    }
  }, [fetchAddOns, fetchAgencyMe]);

  const handleSnapshotPurchaseApplied = useCallback(async () => {
    if (snapshotPurchaseHandledRef.current) return;
    snapshotPurchaseHandledRef.current = true;
    closeSnapshotCheckoutModal();
    toast.success("Snapshot credits purchased successfully.");
    await refreshAfterSnapshotPackPurchase();
  }, [refreshAfterSnapshotPackPurchase]);

  useEffect(() => {
    if (!snapshotCheckoutOpen || !snapshotCheckoutClientSecret) return;
    if (!snapshotCheckoutMountRef.current) return;
    let disposed = false;

    (async () => {
      try {
        const stripe = await getAddOnsStripePromise();
        if (!stripe || typeof (stripe as any).initEmbeddedCheckout !== "function") {
          throw new Error("Embedded checkout is unavailable. Please try again.");
        }
        const checkout = await (stripe as any).initEmbeddedCheckout({
          fetchClientSecret: async () => snapshotCheckoutClientSecret,
          onComplete: async () => {
            const completedSessionId = snapshotCheckoutSessionId;
            if (completedSessionId) {
              await confirmSnapshotCheckoutWithRetry(completedSessionId);
            }
            await handleSnapshotPurchaseApplied();
          },
        });
        if (disposed) {
          if (typeof checkout.destroy === "function") await checkout.destroy();
          return;
        }
        snapshotCheckoutInstanceRef.current = checkout;
        checkout.mount(snapshotCheckoutMountRef.current);
      } catch (e: any) {
        toast.error(e?.message || "Could not open checkout modal.");
        const checkout = snapshotCheckoutInstanceRef.current;
        snapshotCheckoutInstanceRef.current = null;
        if (checkout && typeof checkout.destroy === "function") {
          void checkout.destroy();
        }
        setSnapshotCheckoutOpen(false);
        setSnapshotCheckoutClientSecret(null);
        setSnapshotCheckoutSessionUrl(null);
      }
    })();

    return () => {
      disposed = true;
      const checkout = snapshotCheckoutInstanceRef.current;
      snapshotCheckoutInstanceRef.current = null;
      if (checkout && typeof checkout.destroy === "function") {
        void checkout.destroy();
      }
    };
  }, [
    snapshotCheckoutOpen,
    snapshotCheckoutClientSecret,
    snapshotCheckoutSessionId,
    confirmSnapshotCheckoutWithRetry,
    handleSnapshotPurchaseApplied,
  ]);

  useEffect(() => {
    if (!snapshotCheckoutOpen || !snapshotCheckoutSessionId) return;
    let cancelled = false;
    let polling = false;
    const timer = setInterval(() => {
      if (cancelled || polling || snapshotPurchaseHandledRef.current) return;
      polling = true;
      void (async () => {
        try {
          await api.post(
            "/agencies/add-ons/local-map-snapshot-credits/confirm",
            { sessionId: snapshotCheckoutSessionId },
            { _silent: true } as any
          );
          if (!cancelled) {
            await handleSnapshotPurchaseApplied();
          }
        } catch {
          // Keep polling until payment completes or modal closes.
        } finally {
          polling = false;
        }
      })();
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [snapshotCheckoutOpen, snapshotCheckoutSessionId, handleSnapshotPurchaseApplied]);

  const openRemoveModal = (addOn: ActiveAddOn) => {
    setRemoveModalAddOn(addOn);
  };

  const closeRemoveModal = () => {
    if (!removing) setRemoveModalAddOn(null);
  };

  const handleConfirmRemove = async () => {
    if (!removeModalAddOn) return;
    setRemoving(removeModalAddOn.id);
    try {
      await api.delete(`/agencies/add-ons/${removeModalAddOn.id}`);
      toast.success("Add-on removed.");
      setActiveAddOns((prev) => prev.filter((a) => a.id !== removeModalAddOn.id));
      setRemoveModalAddOn(null);
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Failed to remove add-on.");
    } finally {
      setRemoving(null);
    }
  };

  const priceDisplay = (addOn: ActiveAddOn) => {
    if (addOn.billingInterval === "one_time") return `$${(addOn.priceCents / 100).toFixed(2)} one-time`;
    return `$${(addOn.priceCents / 100).toFixed(2)}/month`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50/30 p-8">
      {/* Top Section - Header */}
      <div className="relative mb-10 overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-500 p-8 shadow-lg">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNnKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-50" />
        <div className="relative">
          <h1 className="text-2xl font-bold text-white md:text-3xl">Add-Ons & Upgrades</h1>
          <p className="mt-2 text-indigo-100 text-sm md:text-base">Expand your capabilities without changing your plan</p>
        </div>
      </div>

      {agencyMe && (agencyMe.accountActivated === false || agencyMe.trialActive) && (
        <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-amber-800 text-sm">
            {agencyMe.trialActive ? (
              <>
                <strong>Add-ons are not available during your 7-day free trial.</strong> The trial is for reporting only. Subscribe to a plan in{" "}
                <Link to="/agency/subscription" className="font-medium text-amber-700 underline hover:text-amber-900">
                  Subscription & Billing
                </Link>{" "}
                or wait until your trial ends to add add-ons.
              </>
            ) : (
              <>
                <strong>Activate your account first.</strong> Add a payment method in{" "}
                <Link to="/agency/subscription" className="font-medium text-amber-700 underline hover:text-amber-900">
                  Subscription & Billing
                </Link>{" "}
                to add add-ons.
              </>
            )}
          </p>
        </section>
      )}

      {/* Your plan & overview */}
      <section className="mb-8 rounded-xl border border-gray-200 bg-gray-50 p-6">
        {agencyMe?.tierId ? (
          <p className="text-gray-800 font-medium">
            Your plan: <strong>{TIER_LABELS[agencyMe.tierId] ?? agencyMe.tierId}</strong>
            {agencyMe.basePriceMonthlyUsd != null ? (
              <> (${agencyMe.basePriceMonthlyUsd.toLocaleString()}/month base)</>
            ) : agencyMe.tierId === "enterprise" ? (
              " (Custom, starts ~$1,997/month)"
            ) : null}
          </p>
        ) : null}
        <h2 className="text-lg font-semibold text-gray-900 mt-4 mb-2">Add-Ons by tier</h2>
        <p className="text-gray-700 text-sm">
          Add-ons include recurring Stripe subscription items and one-time snapshot credit packs. Limits (dashboards, keywords tracked, research lookups) = base tier + active add-ons.
        </p>
        <button
          type="button"
          onClick={() => setShowTierBreakdown((v) => !v)}
          className="mt-3 text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          {showTierBreakdown ? "Hide" : "Show"} by-tier breakdown
        </button>
        {showTierBreakdown && (
          <div className="mt-4 pt-4 border-t border-gray-200 space-y-4 text-sm text-gray-700">
            {[
              { tier: "Business Lite", price: "$79/month base", note: "Cannot add: Extra Dashboards (only tracks 1 business). Keywords +50/100/250; Research Credits +50/150/300." },
              { tier: "Business Pro", price: "$197/month base", note: "Cannot add: Extra Dashboards (only tracks 1 business). Keywords +50/100/250; Research Credits +50/150/300." },
              { tier: "Solo", price: "$147/month base", note: "Extra Dashboards +5; Keywords +50/100/250; Research Credits +50/150/300; Grid Keywords +5/+15." },
              { tier: "Starter", price: "$297/month base", note: "Extra Dashboards +5, +10; Keywords +50/100/250; Research Credits +50/150/300; Grid Keywords +5/+15." },
              { tier: "Growth", price: "$597/month base", note: "Extra Dashboards +5, +10, +25; Keywords +50/100/250; Research Credits +50/150/300; Grid Keywords +5/+15." },
              { tier: "Pro", price: "$997/month base", note: "Extra Dashboards +5, +10, +25; Keywords +50/100/250; Research Credits +50/150/300; Grid Keywords +5/+15." },
              { tier: "Enterprise", price: "Custom (~$1,997+/month)", note: "All add-ons available; pricing negotiated case-by-case." },
            ].map((row) => (
              <div key={row.tier}>
                <strong>{row.tier}</strong> ({row.price}) — {row.note}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Available Add-Ons (filtered by tier) */}
      <section className="mb-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Add-Ons for your tier</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {/* Card 1 - Extra Client Dashboards */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <h3 className="text-lg font-bold text-gray-900">Add-On #1: Extra Client Dashboards</h3>
            {agencyMe && agencyMe.allowedAddOns.extra_dashboards.length === 0 ? (
              <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Cannot add: Extra Dashboards (only tracks 1 business).
              </p>
            ) : (
              <ul className="mt-4 space-y-2 text-sm text-gray-700">
                {EXTRA_DASHBOARDS.filter((pack) => !agencyMe || agencyMe.allowedAddOns.extra_dashboards.includes(pack.option)).map((pack) => (
                  <li key={pack.option} className="flex items-center justify-between gap-2">
                    <span>{pack.label}: {pack.priceLabel}</span>
                    <button
                      type="button"
                      onClick={() => addAddOn("extra_dashboards", pack.option)}
                      disabled={!!purchasing || agencyMe?.accountActivated === false || agencyMe?.trialActive === true}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 flex items-center gap-1"
                    >
                      {purchasing === `extra_dashboards-${pack.option}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Add to Plan
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-gray-500">Available to: {EXTRA_DASHBOARDS_AVAILABLE}</p>
          </div>

          {/* Card 2 - Extra Keywords Tracked (Account-Wide) */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <h3 className="text-lg font-bold text-gray-900">Add-On #2: Extra Keywords Tracked (Account-Wide)</h3>
            <ul className="mt-4 space-y-2 text-sm text-gray-700">
              {EXTRA_KEYWORDS_TRACKED.filter((pack) => !agencyMe || agencyMe.allowedAddOns.extra_keywords_tracked.includes(pack.option)).map((pack) => (
                <li key={pack.option} className="flex items-center justify-between gap-2">
                  <span>{pack.label}: {pack.priceLabel}</span>
                  <button
                    type="button"
                    onClick={() => addAddOn("extra_keywords_tracked", pack.option)}
                    disabled={!!purchasing || agencyMe?.accountActivated === false || agencyMe?.trialActive === true}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 flex items-center gap-1"
                  >
                    {purchasing === `extra_keywords_tracked-${pack.option}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Add to Plan
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-gray-500">Available to: {EXTRA_KEYWORDS_TRACKED_AVAILABLE}</p>
          </div>

          {/* Card 3 - Extra Research Credits */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <h3 className="text-lg font-bold text-gray-900">Add-On #3: Extra Research Credits</h3>
            <ul className="mt-4 space-y-2 text-sm text-gray-700">
              {EXTRA_RESEARCH_CREDITS.filter((pack) => !agencyMe || agencyMe.allowedAddOns.extra_keyword_lookups.includes(pack.option)).map((pack) => (
                <li key={pack.option} className="flex items-center justify-between gap-2">
                  <span>{pack.label}: {pack.priceLabel}</span>
                  <button
                    type="button"
                    onClick={() => addAddOn("extra_keyword_lookups", pack.option)}
                    disabled={!!purchasing || agencyMe?.accountActivated === false || agencyMe?.trialActive === true}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 flex items-center gap-1"
                  >
                    {purchasing === `extra_keyword_lookups-${pack.option}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Add to Plan
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-gray-500">Available to: {EXTRA_RESEARCH_CREDITS_AVAILABLE}</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 4 - Extra Grid Keywords */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <h3 className="text-lg font-bold text-gray-900">Add-On #4: Extra Grid Keywords</h3>
            {agencyMe && agencyMe.allowedAddOns.local_map_rankings_extra_keywords.length === 0 ? (
              <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Not available on your current tier.
              </p>
            ) : (
              <ul className="mt-4 space-y-2 text-sm text-gray-700">
                {EXTRA_GRID_KEYWORDS.filter(
                  (pack) => !agencyMe || agencyMe.allowedAddOns.local_map_rankings_extra_keywords.includes(pack.option)
                ).map((pack) => (
                  <li key={pack.option} className="flex items-center justify-between gap-2">
                    <span>
                      {pack.label}: {pack.priceLabel} (API Cost {pack.apiCostLabel}, Margin {pack.marginLabel})
                    </span>
                    <button
                      type="button"
                      onClick={() => addAddOn("local_map_rankings_extra_keywords", pack.option)}
                      disabled={!!purchasing || agencyMe?.accountActivated === false || agencyMe?.trialActive === true}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 flex items-center gap-1"
                    >
                      {purchasing === `local_map_rankings_extra_keywords-${pack.option}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Add to Plan
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-gray-500">Available to: {EXTRA_GRID_KEYWORDS_AVAILABLE}</p>
          </div>

          {/* Card 5 - Extra Snapshots */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <h3 className="text-lg font-bold text-gray-900">Add-On #5: Extra Snapshots</h3>
            <ul className="mt-4 space-y-2 text-sm text-gray-700">
              {EXTRA_SNAPSHOTS.map((pack) => (
                <li key={pack.pack} className="flex items-center justify-between gap-2">
                  <span>
                    {pack.label}: {pack.priceLabel} ({pack.creditsLabel} credits, API Cost {pack.apiCostLabel}, Margin {pack.marginLabel})
                  </span>
                  <button
                    type="button"
                    onClick={() => void startSnapshotCheckout(pack.pack)}
                    disabled={!!snapshotCheckoutPack || agencyMe?.accountActivated === false || agencyMe?.trialActive === true}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 flex items-center gap-1"
                  >
                    {snapshotCheckoutPack === pack.pack ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Buy One-Time Pack
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-gray-500">Available to: {EXTRA_SNAPSHOTS_AVAILABLE}</p>
          </div>
        </div>
      </section>

      {/* Bottom Section - Active Add-Ons */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Add-Ons</h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : activeAddOns.length === 0 ? (
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            You don&apos;t have any active add-ons. Add one above to expand your plan.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Add-on & details</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date added</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {activeAddOns.map((addOn) => (
                  <tr key={addOn.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">{addOn.displayName}</p>
                      {addOn.details ? (
                        <p className="text-xs text-gray-500 mt-0.5">{addOn.details}</p>
                      ) : null}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{priceDisplay(addOn)}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(addOn.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => openRemoveModal(addOn)}
                        disabled={!!removing}
                        className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Remove Add-On confirmation modal */}
      {snapshotCheckoutOpen && (
        <div
          className="fixed inset-0 z-[120] bg-gradient-to-br from-indigo-950/70 via-violet-900/60 to-cyan-900/60 p-4 backdrop-blur-sm"
          onClick={closeSnapshotCheckoutModal}
        >
          <div
            className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-indigo-200/70 bg-white shadow-[0_18px_60px_-22px_rgba(79,70,229,0.55)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative overflow-hidden border-b border-indigo-100 bg-gradient-to-r from-indigo-600 via-violet-600 to-cyan-500 px-5 py-4 text-white">
              <div className="pointer-events-none absolute -right-14 -top-14 h-36 w-36 rounded-full bg-white/20 blur-xl" />
              <div className="pointer-events-none absolute -left-10 -bottom-16 h-32 w-32 rounded-full bg-fuchsia-300/30 blur-xl" />
              <div className="relative flex items-center justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide">
                    <Sparkles className="h-3.5 w-3.5" />
                    Secure Stripe Checkout
                  </div>
                  <h3 className="mt-2 text-lg font-bold">Complete Purchase</h3>
                  <p className="text-sm text-indigo-100">Checkout stays in this modal with encrypted payment processing.</p>
                </div>
                <button
                  type="button"
                  onClick={closeSnapshotCheckoutModal}
                  className="rounded-lg border border-white/40 bg-white/15 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-white/25"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-gradient-to-b from-indigo-50/60 via-violet-50/30 to-cyan-50/40 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-indigo-200 bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700">Fast checkout</span>
                <span className="rounded-full border border-violet-200 bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700">One-time charge</span>
                <span className="rounded-full border border-cyan-200 bg-cyan-100 px-3 py-1 text-xs font-medium text-cyan-700">Credits added instantly</span>
              </div>
              <div
                ref={snapshotCheckoutMountRef}
                className="min-h-[620px] rounded-xl border border-indigo-100 bg-white p-3 shadow-sm"
              />
              {snapshotCheckoutSessionUrl ? (
                <div className="mt-3 text-right">
                  <a
                    href={snapshotCheckoutSessionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-violet-700 hover:text-violet-800"
                  >
                    Open Stripe checkout in new tab
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {removeModalAddOn && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={closeRemoveModal}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900">Remove Add-On</h3>
            <p className="mt-3 text-gray-600">
              Are you sure you want to remove <strong>{removeModalAddOn.displayName}</strong> from your plan?
            </p>
            {removeModalAddOn.details && (
              <p className="mt-1 text-sm text-gray-500">{removeModalAddOn.details}</p>
            )}
            <p className="mt-2 text-sm text-gray-500">
              Billing will be updated accordingly.
            </p>
            <div className="mt-6 flex gap-3 justify-end">
              <button
                type="button"
                onClick={closeRemoveModal}
                disabled={!!removing}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                Keep Add-On
              </button>
              <button
                type="button"
                onClick={handleConfirmRemove}
                disabled={!!removing}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 flex items-center gap-2"
              >
                {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AddOnsPage;
