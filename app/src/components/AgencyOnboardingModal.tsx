import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
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

const AgencyOnboardingModal: React.FC<AgencyOnboardingModalProps> = ({ open, initialData, onSaved }) => {
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

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setStepError(null);
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
  }, [open, initialData]);

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
        onboardingCompleted: true,
      });
      toast.success("Onboarding details saved.");
      onSaved();
    } catch (error: any) {
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
    return true;
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-gray-200 max-h-[92vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-xl font-bold text-gray-900">Welcome! Let&apos;s set up your agency profile</h2>
          <p className="text-sm text-gray-600 mt-1">
            This helps personalize your agency workspace and onboarding experience.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
            <span className={`px-2 py-1 rounded-full ${step === 1 ? "bg-primary-600 text-white" : "bg-gray-100"}`}>1. Agency</span>
            <span className={`px-2 py-1 rounded-full ${step === 2 ? "bg-primary-600 text-white" : "bg-gray-100"}`}>2. Contact</span>
            <span className={`px-2 py-1 rounded-full ${step === 3 ? "bg-primary-600 text-white" : "bg-gray-100"}`}>3. Goals</span>
          </div>

          {step === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input value={form.website} onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Agency website (e.g. https://example.com)" />
              <input value={form.industry} onChange={(e) => setForm((p) => ({ ...p, industry: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Industry (e.g. Marketing & Advertising)" />
              <select value={form.agencySize} onChange={(e) => setForm((p) => ({ ...p, agencySize: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Agency size</option>
                <option value="1-5">1-5</option>
                <option value="6-20">6-20</option>
                <option value="21-50">21-50</option>
                <option value="51-100">51-100</option>
                <option value="100+">100+</option>
              </select>
              <input type="number" min={0} value={form.numberOfClients} onChange={(e) => setForm((p) => ({ ...p, numberOfClients: e.target.value === "" ? "" : Number(e.target.value) }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Number of clients" />
            </div>
          )}

          {step === 2 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input value={form.contactName} onChange={(e) => setForm((p) => ({ ...p, contactName: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Contact name" />
                <input type="email" value={form.contactEmail} onChange={(e) => setForm((p) => ({ ...p, contactEmail: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Contact email" />
                <input value={form.contactPhone} onChange={(e) => setForm((p) => ({ ...p, contactPhone: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Contact phone" />
                <input value={form.contactJobTitle} onChange={(e) => setForm((p) => ({ ...p, contactJobTitle: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Job title" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input value={form.streetAddress} onChange={(e) => setForm((p) => ({ ...p, streetAddress: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg md:col-span-2" placeholder="Street address" />
                <input value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="City" />
                <input value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="State / Province" />
                <input value={form.zip} onChange={(e) => setForm((p) => ({ ...p, zip: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="ZIP / Postal code" />
                <input value={form.country} onChange={(e) => setForm((p) => ({ ...p, country: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Country" />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">How did you hear about us?</label>
                  <select value={form.referralSource} onChange={(e) => setForm((p) => ({ ...p, referralSource: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                    <option value="">Select source</option>
                    <option value="google">Google Search</option>
                    <option value="social">Social Media</option>
                    <option value="youtube">YouTube</option>
                    <option value="referral">Referral</option>
                    <option value="event">Event / Webinar</option>
                    <option value="other">Other</option>
                  </select>
                  {form.referralSource === "referral" && (
                    <input value={form.referralSourceOther} onChange={(e) => setForm((p) => ({ ...p, referralSourceOther: e.target.value }))} className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Referral from..." />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current tools (optional)</label>
                  <input value={form.currentTools} onChange={(e) => setForm((p) => ({ ...p, currentTools: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g. Ahrefs, Semrush, Data Studio" />
                </div>
              </div>

              <div>
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
                  <input value={form.primaryGoalsOther} onChange={(e) => setForm((p) => ({ ...p, primaryGoalsOther: e.target.value }))} className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Other goal..." />
                )}
              </div>
            </>
          )}

          {stepError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {stepError}
            </div>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => {
                setStepError(null);
                setStep((s) => Math.max(1, s - 1));
              }}
              disabled={step === 1 || saving}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50"
            >
              Back
            </button>
            {step < 3 ? (
              <button
                type="button"
                onClick={() => {
                  if (canGoNext()) {
                    setStepError(null);
                    setStep((s) => Math.min(3, s + 1));
                  }
                }}
                className="px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-semibold"
              >
                Next
              </button>
            ) : (
              <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-semibold disabled:opacity-60">
                {saving ? "Saving..." : "Save and Continue"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default AgencyOnboardingModal;
