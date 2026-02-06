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

const KEYWORD_PACKS = [
  { option: "100", label: "100 credits for $35", priceLabel: "$35 (one-time)" },
  { option: "500", label: "500 credits for $150", priceLabel: "$150 (one-time)" },
];

const MAP_PACKS = [
  { option: "starter", label: "Starter Pack", priceLabel: "$49/month", details: "1 keyword per client, bi-weekly updates" },
  { option: "growth", label: "Growth Pack", priceLabel: "$149/month", details: "3 keywords per client, weekly updates" },
  { option: "pro", label: "Pro Pack", priceLabel: "$249/month", details: "5 keywords per client, weekly updates" },
];

const AddOnsPage = () => {
  const [activeAddOns, setActiveAddOns] = useState<ActiveAddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeModalAddOn, setRemoveModalAddOn] = useState<ActiveAddOn | null>(null);

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

  useEffect(() => {
    fetchAddOns();
  }, []);

  const addAddOn = async (addOnType: "credit_pack" | "extra_slots" | "map_pack", addOnOption: string) => {
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

      {/* Middle Section - Available Add-Ons */}
      <section className="mb-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Add-Ons</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1 - Keyword Credit Packs */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <h3 className="text-lg font-bold text-gray-900">Keyword Credit Packs</h3>
            <p className="text-gray-600 mt-1 text-sm">Need more research credits?</p>
            <ul className="mt-4 space-y-2 text-sm text-gray-700">
              {KEYWORD_PACKS.map((pack) => (
                <li key={pack.option} className="flex items-center justify-between gap-2">
                  <span>{pack.label}</span>
                  <button
                    type="button"
                    onClick={() => addAddOn("credit_pack", pack.option)}
                    disabled={!!purchasing}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 flex items-center gap-1"
                  >
                    {purchasing === `credit_pack-${pack.option}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Purchase
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Card 2 - Extra Client Slots */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <h3 className="text-lg font-bold text-gray-900">Extra Client Slots</h3>
            <p className="text-gray-600 mt-1 text-sm">Add 5 more client dashboards without upgrading</p>
            <p className="mt-4 text-sm font-medium text-primary-600">+5 clients for $99/month</p>
            <div className="mt-6 flex-1 flex items-end">
              <button
                type="button"
                onClick={() => addAddOn("extra_slots", "5_slots")}
                disabled={!!purchasing}
                className="w-full py-2.5 rounded-lg font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {purchasing === "extra_slots-5_slots" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Add to Plan
              </button>
            </div>
          </div>

          {/* Card 3 - Local Map Pack Tracking */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col">
            <h3 className="text-lg font-bold text-gray-900">Local Map Pack Tracking</h3>
            <p className="text-gray-600 mt-1 text-sm">Heat map grid tracking for local rankings</p>
            <ul className="mt-4 space-y-3 text-sm text-gray-700">
              {MAP_PACKS.map((pack) => (
                <li key={pack.option}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{pack.label}: {pack.priceLabel}</span>
                    <button
                      type="button"
                      onClick={() => addAddOn("map_pack", pack.option)}
                      disabled={!!purchasing}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 flex items-center gap-1"
                    >
                      {purchasing === `map_pack-${pack.option}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Add to Plan
                    </button>
                  </div>
                  <p className="text-gray-500 text-xs mt-0.5">{pack.details}</p>
                </li>
              ))}
            </ul>
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
