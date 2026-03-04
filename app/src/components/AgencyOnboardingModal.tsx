import React, { useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle, forwardRef } from "react";
import toast from "react-hot-toast";
import { Building2 as BuildingIcon, ChevronLeft, ChevronRight, Calendar, ExternalLink, Check, CreditCard } from "lucide-react";
import { loadStripe } from "@/lib/stripe";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import api from "@/lib/api";

interface AgencyOnboardingModalProps {
  open: boolean;
  initialData?: {
    website?: string | null;
    industry?: string | null;
    agencySize?: string | null;
    numberOfClients?: number | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    contactJobTitle?: string | null;
    streetAddress?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    country?: string | null;
    onboardingData?: {
      referralSource?: string;
      referralSourceOther?: string;
      primaryGoals?: string[];
      primaryGoalsOther?: string;
      currentTools?: string;
    } | null;
    billingType?: string | null;
  } | null;
  onSaved: () => void;
}

const goalOptions = [
  "Scale lead generation",
  "Improve client retention",
  "Increase recurring revenue",
  "Automate reporting and operations",
  "Improve SEO delivery speed",
  "Other",
];

const DEMO_BOOKING_LINK = "https://links.yourseodashboard.com/widget/booking/auRus7uzX9SW4C6mJncd";
const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
const ONBOARDING_ACTIVATION_RESUME_KEY = "agency_onboarding_activation_pending";
let onboardingStripePromise: ReturnType<typeof loadStripe> | null = null;
let stripeTelemetryFetchPatched = false;

const patchStripeTelemetryFetch = () => {
  if (stripeTelemetryFetchPatched || typeof window === "undefined" || typeof window.fetch !== "function") return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : String(input);

    // Stripe telemetry endpoint may be blocked by browser extensions (ERR_BLOCKED_BY_CLIENT).
    // Return a no-op successful response so checkout UI stays clean.
    if (url.startsWith("https://r.stripe.com/b")) {
      return Promise.resolve(new Response("", { status: 204, statusText: "No Content" }));
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof window.fetch;
  stripeTelemetryFetchPatched = true;
};

const getOnboardingStripePromise = () => {
  if (!stripePk) return null;
  patchStripeTelemetryFetch();
  if (!onboardingStripePromise) onboardingStripePromise = loadStripe(stripePk, { advancedFraudSignals: false } as any);
  return onboardingStripePromise;
};

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

const ACTIVATE_AGENCY_PLANS = AGENCY_PLANS.filter((p) => p.id !== "enterprise");
const ACTIVATE_PLANS = [...BUSINESS_PLANS, ...ACTIVATE_AGENCY_PLANS];

type StripePaymentHandle = { confirmAndGetPaymentMethod: () => Promise<string | null> };

const StripePaymentSection = forwardRef<StripePaymentHandle, { clientSecret: string; onReady?: () => void }>(function StripePaymentSection({ clientSecret, onReady }, ref) {
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
        // Avoid full-page redirects during onboarding submit; only redirect when strictly required.
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
});

const AgencyOnboardingModal: React.FC<AgencyOnboardingModalProps> = ({ open, initialData, onSaved }) => {
  const getDefaultOnboardingPath = useCallback(
    () => (initialData?.billingType === "free" ? "free_account" : "card_plan"),
    [initialData?.billingType]
  );
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const initialPrimaryGoals = useMemo(
    () => (Array.isArray(initialData?.onboardingData?.primaryGoals) ? initialData?.onboardingData?.primaryGoals : []),
    [initialData?.onboardingData?.primaryGoals]
  );
  const [form, setForm] = useState({
    website: initialData?.website ?? "",
    industry: initialData?.industry ?? "",
    agencySize: initialData?.agencySize ?? "",
    numberOfClients: initialData?.numberOfClients ?? "",
    contactName: initialData?.contactName ?? "",
    contactEmail: initialData?.contactEmail ?? "",
    contactPhone: initialData?.contactPhone ?? "",
    contactJobTitle: initialData?.contactJobTitle ?? "",
    streetAddress: initialData?.streetAddress ?? "",
    city: initialData?.city ?? "",
    state: initialData?.state ?? "",
    zip: initialData?.zip ?? "",
    country: initialData?.country ?? "United States",
    referralSource: initialData?.onboardingData?.referralSource ?? "",
    referralSourceOther: initialData?.onboardingData?.referralSourceOther ?? "",
    primaryGoals: initialPrimaryGoals,
    primaryGoalsOther: initialData?.onboardingData?.primaryGoalsOther ?? "",
    currentTools: initialData?.onboardingData?.currentTools ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [onboardingPath, setOnboardingPath] = useState<"card_plan" | "free_account">(getDefaultOnboardingPath());
  const [selectedPlan, setSelectedPlan] = useState<string>("solo");
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [paymentElementReady, setPaymentElementReady] = useState(false);
  const [resumingActivation, setResumingActivation] = useState(false);
  const paymentRef = useRef<StripePaymentHandle>(null);

  const chargeDateLabel = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setStepError(null);
    setOnboardingPath(getDefaultOnboardingPath());
    setSelectedPlan("solo");
    setSetupSecret(null);
    setForm({
      website: initialData?.website ?? "",
      industry: initialData?.industry ?? "",
      agencySize: initialData?.agencySize ?? "",
      numberOfClients: initialData?.numberOfClients ?? "",
      contactName: initialData?.contactName ?? "",
      contactEmail: initialData?.contactEmail ?? "",
      contactPhone: initialData?.contactPhone ?? "",
      contactJobTitle: initialData?.contactJobTitle ?? "",
      streetAddress: initialData?.streetAddress ?? "",
      city: initialData?.city ?? "",
      state: initialData?.state ?? "",
      zip: initialData?.zip ?? "",
      country: initialData?.country ?? "United States",
      referralSource: initialData?.onboardingData?.referralSource ?? "",
      referralSourceOther: initialData?.onboardingData?.referralSourceOther ?? "",
      primaryGoals: Array.isArray(initialData?.onboardingData?.primaryGoals) ? initialData?.onboardingData?.primaryGoals : [],
      primaryGoalsOther: initialData?.onboardingData?.primaryGoalsOther ?? "",
      currentTools: initialData?.onboardingData?.currentTools ?? "",
    });
  }, [open, initialData, getDefaultOnboardingPath]);

  useEffect(() => {
    if (!open || step !== 4 || onboardingPath !== "card_plan" || !stripePk) {
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
  }, [open, step, onboardingPath]);

  useEffect(() => {
    if (!open) return;
    const pendingRaw = sessionStorage.getItem(ONBOARDING_ACTIVATION_RESUME_KEY);
    if (!pendingRaw) return;

    const params = new URLSearchParams(window.location.search);
    const setupIntentId = params.get("setup_intent");
    const redirectStatus = params.get("redirect_status");
    if (!setupIntentId) return;

    const clearStripeReturnParams = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("setup_intent");
      url.searchParams.delete("setup_intent_client_secret");
      url.searchParams.delete("redirect_status");
      window.history.replaceState({}, "", url.toString());
    };

    let pendingPlan = "solo";
    try {
      const parsed = JSON.parse(pendingRaw) as { selectedPlan?: string };
      if (parsed?.selectedPlan) pendingPlan = parsed.selectedPlan;
    } catch {
      pendingPlan = "solo";
    }

    if (redirectStatus && redirectStatus !== "succeeded") {
      sessionStorage.removeItem(ONBOARDING_ACTIVATION_RESUME_KEY);
      clearStripeReturnParams();
      toast.error("Card verification was not completed. Please try again.");
      return;
    }

    let cancelled = false;
    const resumeActivation = async () => {
      try {
        if (cancelled) return;
        setResumingActivation(true);
        setSaving(true);

        const retrieveRes = await api.post("/agencies/setup-intent-for-activation/retrieve", { setupIntentId });
        const paymentMethodId = retrieveRes.data?.paymentMethodId as string | undefined;
        if (!paymentMethodId) throw new Error("Could not recover payment method from Stripe setup.");

        const res = await api.post("/agencies/activate-trial-subscription", {
          paymentMethodId,
          tier: pendingPlan,
        });
        const apiTrialEndsAt = res.data?.trialEndsAt
          ? new Date(res.data.trialEndsAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : chargeDateLabel;
        await api.put("/agencies/me", { onboardingCompleted: true });

        sessionStorage.removeItem(ONBOARDING_ACTIVATION_RESUME_KEY);
        clearStripeReturnParams();
        toast.success(`Plan activated. No charge today. Your card will be charged on ${apiTrialEndsAt}.`);
        window.dispatchEvent(new Event("subscription-changed"));
        onSaved();
      } catch (error: any) {
        const message = error?.response?.data?.message || error?.message || "Could not finalize subscription activation.";
        toast.error(message);
      } finally {
        if (!cancelled) {
          setResumingActivation(false);
          setSaving(false);
        }
      }
    };

    resumeActivation();
    return () => {
      cancelled = true;
    };
  }, [open, chargeDateLabel, onSaved]);

  useEffect(() => {
    // Some browser extensions block Stripe telemetry (r.stripe.com), which can throw noisy
    // unhandled promise rejections even when payments still work. Suppress only that case.
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { message?: string } | string | undefined;
      const message = typeof reason === "string" ? reason : reason?.message ?? "";
      const normalized = `${message} ${String(reason ?? "")}`;
      if (normalized.includes("r.stripe.com/b") && normalized.includes("Failed to fetch")) {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  if (!open) return null;

  const toggleGoal = (goal: string, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      primaryGoals: checked ? [...prev.primaryGoals, goal] : prev.primaryGoals.filter((g) => g !== goal),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGoNext()) return;
    if (saving) return;
    setSaving(true);
    try {
      // Save onboarding profile fields first (without completing onboarding in case billing path fails).
      await api.put("/agencies/me", {
        website: form.website.trim() || undefined,
        industry: form.industry.trim() || undefined,
        agencySize: form.agencySize || undefined,
        numberOfClients: form.numberOfClients === "" ? undefined : Number(form.numberOfClients),
        contactName: form.contactName.trim() || undefined,
        contactEmail: form.contactEmail.trim() || undefined,
        contactPhone: form.contactPhone.trim() || undefined,
        contactJobTitle: form.contactJobTitle.trim() || undefined,
        streetAddress: form.streetAddress.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        zip: form.zip.trim() || undefined,
        country: form.country.trim() || undefined,
        referralSource: form.referralSource || undefined,
        referralSourceOther: form.referralSource === "referral" ? form.referralSourceOther.trim() || undefined : undefined,
        primaryGoals: form.primaryGoals.length ? form.primaryGoals : undefined,
        primaryGoalsOther: form.primaryGoals.includes("Other") ? form.primaryGoalsOther.trim() || undefined : undefined,
        currentTools: form.currentTools.trim() || undefined,
      });

      if (onboardingPath === "card_plan") {
        if (!paymentRef.current || !setupSecret || !paymentElementReady) {
          toast.error("Please wait for the payment form to load.");
          return;
        }
        sessionStorage.setItem(
          ONBOARDING_ACTIVATION_RESUME_KEY,
          JSON.stringify({ selectedPlan })
        );
        const paymentMethodId = await paymentRef.current.confirmAndGetPaymentMethod();
        if (!paymentMethodId) {
          sessionStorage.removeItem(ONBOARDING_ACTIVATION_RESUME_KEY);
          toast.error("Please complete the card details.");
          return;
        }
        const res = await api.post("/agencies/activate-trial-subscription", {
          paymentMethodId,
          tier: selectedPlan,
        });
        sessionStorage.removeItem(ONBOARDING_ACTIVATION_RESUME_KEY);
        const apiTrialEndsAt = res.data?.trialEndsAt ? new Date(res.data.trialEndsAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        }) : chargeDateLabel;
        toast.success(`Plan activated. No charge today. Your card will be charged on ${apiTrialEndsAt}.`);
        window.dispatchEvent(new Event("subscription-changed"));
      } else {
        await api.post("/agencies/activate-free-account");
        toast.success("Free account activated with 10 research credits.");
        window.dispatchEvent(new Event("subscription-changed"));
      }

      // Mark onboarding as completed only after billing path succeeds.
      await api.put("/agencies/me", {
        onboardingCompleted: true,
      });

      onSaved();
    } catch (error: any) {
      sessionStorage.removeItem(ONBOARDING_ACTIVATION_RESUME_KEY);
      toast.error(error?.response?.data?.message || "Failed to save onboarding details.");
    } finally {
      setSaving(false);
    }
  };

  const canGoNext = () => {
    setStepError(null);
    if (step === 1) return true;
    if (step === 2) {
      const contactName = form.contactName.trim();
      const contactEmail = form.contactEmail.trim();
      if (!contactName) {
        setStepError("Contact name is required.");
        return false;
      }
      if (!contactEmail) {
        setStepError("Contact email is required.");
        return false;
      }
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(contactEmail)) {
        setStepError("Please enter a valid contact email.");
        return false;
      }
      return true;
    }
    if (step === 3 && form.primaryGoals.includes("Other") && !form.primaryGoalsOther.trim()) {
      setStepError("Please specify your other primary goal.");
      return false;
    }
    if (step === 4 && onboardingPath === "card_plan" && !stripePk) {
      setStepError("Card billing is unavailable because Stripe is not configured.");
      return false;
    }
    return true;
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-gray-200/80 w-full max-w-5xl mx-4 h-[90vh] max-h-[720px] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center px-6 py-5 shrink-0 bg-gradient-to-r from-primary-600 via-primary-500 to-blue-600 text-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/20">
              <BuildingIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Welcome! Let&apos;s set up your agency profile</h2>
              <p className="text-sm text-white/90">This helps personalize your agency workspace and onboarding experience.</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 bg-gray-50/50 overflow-hidden">
          <div className="px-6 pt-4 pb-2 shrink-0 border-b border-gray-200 bg-white">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600">Step {step} of 4</span>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4].map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled
                    className={`h-2 rounded-full transition-all disabled:cursor-default ${s === step ? "w-6 bg-primary-600" : "w-2 bg-gray-300"}`}
                    aria-label={`Go to step ${s}`}
                  />
                ))}
              </div>
            </div>
            <p className="text-xs text-gray-500">
              {step === 1 && "Agency Information"}
              {step === 2 && "Primary Contact"}
              {step === 3 && "Additional Questions"}
              {step === 4 && "Subscription Setup"}
            </p>
          </div>
          <div className="p-6 overflow-y-auto flex-1 min-h-0 space-y-4">

          {step === 1 && (
            <section className="rounded-xl border-l-4 border-blue-500 bg-blue-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                AGENCY INFORMATION
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Agency Website</label>
                  <input value={form.website} onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="https://example.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Industry / Specialty</label>
                  <input value={form.industry} onChange={(e) => setForm((p) => ({ ...p, industry: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. Marketing & Advertising" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Agency Size</label>
                  <select value={form.agencySize} onChange={(e) => setForm((p) => ({ ...p, agencySize: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                    <option value="">Select...</option>
                    <option value="1-5">1-5</option>
                    <option value="6-20">6-20</option>
                    <option value="21-50">21-50</option>
                    <option value="51-100">51-100</option>
                    <option value="100+">100+</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Number of Current Clients</label>
                  <input type="number" min={0} value={form.numberOfClients} onChange={(e) => setForm((p) => ({ ...p, numberOfClients: e.target.value === "" ? "" : Number(e.target.value) }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. 12" />
                </div>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-emerald-900 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                PRIMARY CONTACT
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name *</label>
                  <input value={form.contactName} onChange={(e) => setForm((p) => ({ ...p, contactName: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. Johnny Doe" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email *</label>
                  <input type="email" value={form.contactEmail} onChange={(e) => setForm((p) => ({ ...p, contactEmail: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="johnny@example.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                  <input value={form.contactPhone} onChange={(e) => setForm((p) => ({ ...p, contactPhone: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="+1 (555) 555-5555" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Job Title</label>
                  <input value={form.contactJobTitle} onChange={(e) => setForm((p) => ({ ...p, contactJobTitle: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Owner, Marketing Director, SEO Manager" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Street Address</label>
                    <input value={form.streetAddress} onChange={(e) => setForm((p) => ({ ...p, streetAddress: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="375 Commack Road" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                    <input value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Deer Park" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">State / Province</label>
                    <input value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="NY" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ZIP / Postal Code</label>
                    <input value={form.zip} onChange={(e) => setForm((p) => ({ ...p, zip: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="11729" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                    <input value={form.country} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="United States" />
                  </div>
                </div>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="rounded-xl border-l-4 border-teal-500 bg-teal-50/50 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-teal-900 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                ADDITIONAL QUESTIONS
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">How did you hear about us?</label>
                  <select value={form.referralSource} onChange={(e) => setForm((p) => ({ ...p, referralSource: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                    <option value="">Select source</option>
                    <option value="google">Google Search</option>
                    <option value="social">Social Media</option>
                    <option value="youtube">YouTube</option>
                    <option value="referral">Referral</option>
                    <option value="event">Event / Webinar</option>
                    <option value="other">Other</option>
                  </select>
                  {form.referralSource === "referral" && (
                    <input value={form.referralSourceOther} onChange={(e) => setForm((p) => ({ ...p, referralSourceOther: e.target.value }))} className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Referral from..." />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current tools (optional)</label>
                  <input value={form.currentTools} onChange={(e) => setForm((p) => ({ ...p, currentTools: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="e.g. Ahrefs, Semrush, Data Studio" />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Primary goals</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {goalOptions.map((goal) => (
                    <label key={goal} className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-primary-600"
                        checked={form.primaryGoals.includes(goal)}
                        onChange={(e) => toggleGoal(goal, e.target.checked)}
                      />
                      <span>{goal}</span>
                    </label>
                  ))}
                </div>
                {form.primaryGoals.includes("Other") && (
                  <input value={form.primaryGoalsOther} onChange={(e) => setForm((p) => ({ ...p, primaryGoalsOther: e.target.value }))} className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" placeholder="Other goal..." />
                )}
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="space-y-4">
              <div className="rounded-xl border-l-4 border-violet-500 bg-violet-50/50 p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-violet-900 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                  SUBSCRIPTION SETUP
                </h3>
                <div className="space-y-3">
                  <label className="flex items-start gap-3 rounded-lg border border-violet-200 bg-white px-4 py-3">
                    <input
                      type="radio"
                      name="onboardingPath"
                      checked={onboardingPath === "card_plan"}
                      onChange={() => setOnboardingPath("card_plan")}
                      className="mt-1"
                    />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Add credit card + choose a plan (7-day free trial)</p>
                      <p className="text-xs text-gray-600 mt-1">
                        No charge today. You will be charged on <strong>{chargeDateLabel}</strong>. Cancel anytime before then.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
                    <input
                      type="radio"
                      name="onboardingPath"
                      checked={onboardingPath === "free_account"}
                      onChange={() => setOnboardingPath("free_account")}
                      className="mt-1"
                    />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Continue with free account</p>
                      <p className="text-xs text-gray-600 mt-1">Get 10 research credits to test the research tool.</p>
                    </div>
                  </label>
                </div>
              </div>

              {onboardingPath === "card_plan" && (
                <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 space-y-6">
                  <label className="block text-sm font-semibold text-gray-800">Select Your Plan</label>

                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Business Plans</span>
                      <span className="text-[10px] text-gray-400">Track your own SEO</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {BUSINESS_PLANS.map((plan) => {
                        const isSelected = selectedPlan === plan.id;
                        return (
                          <button
                            key={plan.id}
                            type="button"
                            onClick={() => setSelectedPlan(plan.id)}
                            className={`relative text-left rounded-xl border-2 p-4 transition-all duration-200 ${
                              isSelected
                                ? "border-primary-500 bg-primary-50/70 shadow-md shadow-primary-100"
                                : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
                            }`}
                          >
                            {isSelected && (
                              <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 shadow-sm">
                                <Check className="h-3.5 w-3.5 text-white" />
                              </span>
                            )}
                            <p className={`text-sm font-bold ${isSelected ? "text-primary-700" : "text-gray-900"}`}>
                              {plan.name}
                            </p>
                            <p className="mt-1">
                              <span className={`text-xl font-bold ${isSelected ? "text-primary-600" : "text-gray-900"}`}>
                                {plan.priceLabel}
                              </span>
                              <span className="text-xs text-gray-500">/mo</span>
                            </p>
                            <p className={`mt-1 text-xs font-medium ${isSelected ? "text-primary-600" : "text-gray-500"}`}>
                              {plan.clientsLabel}
                            </p>
                            <ul className="mt-3 space-y-1">
                              {plan.features.map((f) => (
                                <li key={f} className="flex items-start gap-1.5 text-[11px] text-gray-500">
                                  <Check className={`mt-0.5 h-3 w-3 shrink-0 ${isSelected ? "text-primary-500" : "text-gray-400"}`} />
                                  <span>{f}</span>
                                </li>
                              ))}
                            </ul>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Agency Plans</span>
                      <span className="text-[10px] text-gray-400">White-label + Client Portal</span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {ACTIVATE_AGENCY_PLANS.map((plan) => {
                        const isSelected = selectedPlan === plan.id;
                        return (
                          <button
                            key={plan.id}
                            type="button"
                            onClick={() => setSelectedPlan(plan.id)}
                            className={`relative text-left rounded-xl border-2 p-4 transition-all duration-200 ${
                              isSelected
                                ? "border-primary-500 bg-primary-50/70 shadow-md shadow-primary-100"
                                : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
                            }`}
                          >
                            {isSelected && (
                              <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 shadow-sm">
                                <Check className="h-3.5 w-3.5 text-white" />
                              </span>
                            )}
                            <p className={`text-sm font-bold ${isSelected ? "text-primary-700" : "text-gray-900"}`}>
                              {plan.name}
                            </p>
                            <p className="mt-1">
                              <span className={`text-xl font-bold ${isSelected ? "text-primary-600" : "text-gray-900"}`}>
                                {plan.priceLabel}
                              </span>
                              <span className="text-xs text-gray-500">/mo</span>
                            </p>
                            <p className={`mt-1 text-xs font-medium ${isSelected ? "text-primary-600" : "text-gray-500"}`}>
                              {plan.clientsLabel}
                            </p>
                            <ul className="mt-3 space-y-1">
                              {plan.features.map((f) => (
                                <li key={f} className="flex items-start gap-1.5 text-[11px] text-gray-500">
                                  <Check className={`mt-0.5 h-3 w-3 shrink-0 ${isSelected ? "text-primary-500" : "text-gray-400"}`} />
                                  <span>{f}</span>
                                </li>
                              ))}
                            </ul>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {(() => {
                    const selected = ACTIVATE_PLANS.find((p) => p.id === selectedPlan);
                    if (!selected) return null;
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center gap-4 rounded-xl bg-gradient-to-r from-primary-50 to-emerald-50 border border-primary-100 p-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-600 shadow-sm">
                            <CreditCard className="h-5 w-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900">
                              {selected.name} — {selected.priceLabel}/month
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {selected.clientsLabel} · Billed monthly · Cancel anytime
                            </p>
                          </div>
                        </div>
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          <span>No charge today. Your first charge date is <strong>{chargeDateLabel}</strong>.</span>
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <label className="block text-sm font-semibold text-gray-800 mb-3">Payment Method</label>
                    {!stripePk ? (
                      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                        Stripe is not configured. Contact support.
                      </p>
                    ) : setupSecret ? (
                      <Elements stripe={getOnboardingStripePromise()} options={{ clientSecret: setupSecret }}>
                        <StripePaymentSection
                          ref={paymentRef}
                          clientSecret={setupSecret}
                          onReady={() => setPaymentElementReady(true)}
                        />
                      </Elements>
                    ) : (
                      <div className="flex items-center justify-center py-8 rounded-lg border border-gray-200 bg-gray-50">
                        {setupLoading ? (
                          <>
                            <span className="mr-2 inline-flex h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />
                            <span className="text-sm text-gray-500">Loading payment form…</span>
                          </>
                        ) : (
                          <span className="text-sm text-gray-500">Could not load secure card form. Please try again.</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-medium text-blue-900">Have questions? Don&apos;t forget to book your demo with Jason today.</p>
                <a
                  href={DEMO_BOOKING_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Book your demo
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </section>
          )}

          {stepError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {stepError}
            </div>
          )}
          </div>

          <div className="grid grid-cols-2 gap-3 px-6 py-4 h-[72px] shrink-0 border-t border-gray-200 bg-gray-100/80 rounded-b-2xl items-center">
            <button
              type="button"
              onClick={() => {
                setStepError(null);
                setStep((s) => Math.max(1, s - 1));
              }}
              disabled={step === 1 || saving}
              className="w-full max-w-[140px] inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-xl text-gray-700 bg-white hover:bg-gray-50 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4 shrink-0" />
              Previous
            </button>
            <div className="flex justify-end">
              {step < 4 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (canGoNext()) {
                      setStepError(null);
                      setStep((s) => Math.min(4, s + 1));
                    }
                  }}
                  className="w-full max-w-[140px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg transition-all"
                >
                  Next
                  <ChevronRight className="h-4 w-4 shrink-0" />
                </button>
              ) : (
                <button type="submit" disabled={saving || resumingActivation || (onboardingPath === "card_plan" && (!setupSecret || !paymentElementReady))} className="w-full max-w-[220px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-white bg-gradient-to-r from-primary-600 to-blue-600 hover:from-primary-700 hover:to-blue-700 shadow-md hover:shadow-lg transition-all disabled:opacity-60">
                  {resumingActivation
                    ? "Finalizing..."
                    : saving
                      ? "Activating..."
                      : onboardingPath === "card_plan"
                        ? "Subscribe and Activate"
                        : "Continue with Free Account"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AgencyOnboardingModal;
