import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";

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
  { option: "100", label: "+100 keywords tracked", priceLabel: "$49/month" },
  { option: "250", label: "+250 keywords tracked", priceLabel: "$99/month" },
  { option: "500", label: "+500 keywords tracked", priceLabel: "$179/month" },
];
const EXTRA_KEYWORDS_TRACKED_AVAILABLE = "All tiers (Business Lite, Business Pro, Solo, Starter, Growth, Pro, Enterprise)";

const EXTRA_KEYWORD_LOOKUPS = [
  { option: "100", label: "+100 keyword lookups/month", priceLabel: "$49/month" },
  { option: "300", label: "+300 keyword lookups/month", priceLabel: "$129/month" },
  { option: "500", label: "+500 keyword lookups/month", priceLabel: "$199/month" },
];
const EXTRA_KEYWORD_LOOKUPS_AVAILABLE = "All tiers";

const TIER_LABELS: Record<string, string> = {
  business_lite: "Business Lite",
  business_pro: "Business Pro",
  solo: "Solo",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  enterprise: "Enterprise",
};

interface AllowedAddOns {
  extra_dashboards: string[];
  extra_keywords_tracked: string[];
  extra_keyword_lookups: string[];
}

interface AgencyMe {
  tierId: string | null;
  allowedAddOns: AllowedAddOns;
  basePriceMonthlyUsd: number | null;
}

const AddOnsPage = () => {
  const [activeAddOns, setActiveAddOns] = useState<ActiveAddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [agencyMe, setAgencyMe] = useState<AgencyMe | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeModalAddOn, setRemoveModalAddOn] = useState<ActiveAddOn | null>(null);
  const [showTierBreakdown, setShowTierBreakdown] = useState(false);

  const fetchAddOns = async () => {
    try {
      const res = await api.get<ActiveAddOn[]>("/agencies/add-ons");
      setActiveAddOns(Array.isArray(res.data) ? res.data : []);
    } catch {
      setActiveAddOns([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgencyMe = async () => {
    try {
      const res = await api.get("/agencies/me");
      setAgencyMe({
        tierId: res.data?.tierId ?? null,
        allowedAddOns: res.data?.allowedAddOns ?? { extra_dashboards: [], extra_keywords_tracked: [], extra_keyword_lookups: [] },
        basePriceMonthlyUsd: res.data?.basePriceMonthlyUsd ?? null,
      });
    } catch {
      setAgencyMe(null);
    }
  };

  useEffect(() => {
    fetchAddOns();
    fetchAgencyMe();
  }, []);

  const addAddOn = async (addOnType: "extra_dashboards" | "extra_keywords_tracked" | "extra_keyword_lookups", addOnOption: string) => {
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
    <div className="p-8">
      {/* Top Section - Header */}
      <header className="mb-10">
        <h1 className="text-2xl font-bold text-gray-900">Add-Ons & Upgrades</h1>
        <p className="text-gray-600 mt-1">Expand your capabilities without changing your plan</p>
      </header>

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
          Add-ons are Stripe subscription line items you can add or remove. Limits (dashboards, keywords tracked, research lookups) = base tier + active add-ons.
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
              { tier: "Business Lite", price: "$79/month base", note: "Cannot add: Extra Dashboards (only tracks 1 business). Keywords Tracked +100/250/500; Keyword Research +100/300/500." },
              { tier: "Business Pro", price: "$197/month base", note: "Cannot add: Extra Dashboards (only tracks 1 business). Keywords Tracked +100/250/500; Keyword Research +100/300/500." },
              { tier: "Solo", price: "$147/month base", note: "Extra Dashboards +5; all Keywords Tracked and Keyword Research options." },
              { tier: "Starter", price: "$297/month base", note: "Extra Dashboards +5, +10; all Keywords Tracked and Keyword Research options." },
              { tier: "Growth", price: "$597/month base", note: "Extra Dashboards +5, +10, +25; all Keywords Tracked and Keyword Research options." },
              { tier: "Pro", price: "$997/month base", note: "Extra Dashboards +5, +10, +25; all Keywords Tracked and Keyword Research options." },
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                      disabled={!!purchasing}
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
            <p className="mt-4 text-xs text-gray-500">Available to: Solo, Starter, Growth, Pro, Enterprise</p>
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
                    disabled={!!purchasing}
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
            <p className="mt-4 text-xs text-gray-500">Available to: All tiers</p>
          </div>

          {/* Card 3 - Extra Keyword Research Lookups */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <h3 className="text-lg font-bold text-gray-900">Add-On #3: Extra Keyword Research Lookups</h3>
            <ul className="mt-4 space-y-2 text-sm text-gray-700">
              {EXTRA_KEYWORD_LOOKUPS.filter((pack) => !agencyMe || agencyMe.allowedAddOns.extra_keyword_lookups.includes(pack.option)).map((pack) => (
                <li key={pack.option} className="flex items-center justify-between gap-2">
                  <span>{pack.label}: {pack.priceLabel}</span>
                  <button
                    type="button"
                    onClick={() => addAddOn("extra_keyword_lookups", pack.option)}
                    disabled={!!purchasing}
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
            <p className="mt-4 text-xs text-gray-500">Available to: All tiers</p>
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
