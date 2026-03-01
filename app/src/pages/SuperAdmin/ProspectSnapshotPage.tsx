import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import LocalMapSnapshotRunner from "@/components/LocalMapSnapshotRunner";
import api from "@/lib/api";

type LocalMapOverview = {
  month: string;
  scheduledRuns: number;
  ondemandRuns: number;
  totalRuns: number;
  projectedApiCostUsd: number;
};

type AgencyUsageRow = {
  id: string;
  name: string;
  snapshotMonthlyAllowance: number;
  snapshotMonthlyUsed: number;
  snapshotPurchasedCredits: number;
};

type GridKeywordAdminRow = {
  id: string;
  keywordText: string;
  businessName: string;
  status: "active" | "paused" | "canceled";
  gridSize: number;
  gridSpacingMiles: string;
  agency: { name: string };
  client: { name: string };
};

const ProspectSnapshotPage: React.FC = () => {
  const [overview, setOverview] = useState<LocalMapOverview | null>(null);
  const [agencyUsage, setAgencyUsage] = useState<AgencyUsageRow[]>([]);
  const [keywords, setKeywords] = useState<GridKeywordAdminRow[]>([]);
  const [creditDrafts, setCreditDrafts] = useState<Record<string, string>>({});

  const loadAdminData = async () => {
    try {
      const [overviewRes, usageRes, keywordsRes] = await Promise.all([
        api.get("/local-map/admin/overview"),
        api.get("/local-map/admin/agencies-usage"),
        api.get("/local-map/admin/keywords"),
      ]);
      setOverview(overviewRes.data as LocalMapOverview);
      setAgencyUsage(Array.isArray(usageRes.data) ? usageRes.data : []);
      setKeywords(Array.isArray(keywordsRes.data) ? keywordsRes.data : []);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to load local map admin data");
    }
  };

  useEffect(() => {
    void loadAdminData();
  }, []);

  const issueCredits = async (agencyId: string) => {
    const amount = Number(creditDrafts[agencyId] || "0");
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid credit amount");
      return;
    }
    try {
      await api.post(`/local-map/admin/agencies/${agencyId}/snapshot-credits/issue`, { amount });
      toast.success("Credits issued");
      setCreditDrafts((prev) => ({ ...prev, [agencyId]: "" }));
      await loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to issue credits");
    }
  };

  const updateKeywordStatus = async (keywordId: string, status: "active" | "paused" | "canceled") => {
    try {
      await api.patch(`/local-map/admin/keywords/${keywordId}`, { status });
      await loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update keyword");
    }
  };

  return (
    <div className="p-6 space-y-8">
      <LocalMapSnapshotRunner
        superAdminMode
        heading="Prospect Snapshot"
        description="Run unlimited on-demand local map snapshots for prospecting and sales calls."
      />

      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-3">Local Map Operations</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-100 p-3">
            <p className="text-violet-700">Month</p>
            <p className="font-semibold text-violet-900">{overview?.month ?? "-"}</p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-100 p-3">
            <p className="text-blue-700">Scheduled Runs</p>
            <p className="font-semibold text-blue-900">{overview?.scheduledRuns ?? 0}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-100 p-3">
            <p className="text-emerald-700">On-demand Runs</p>
            <p className="font-semibold text-emerald-900">{overview?.ondemandRuns ?? 0}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-100 p-3">
            <p className="text-amber-700">Projected API Cost</p>
            <p className="font-semibold text-amber-900">${(overview?.projectedApiCostUsd ?? 0).toFixed(2)}</p>
          </div>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-3">Agency Snapshot Credit Balances</h3>
        <div className="space-y-2">
          {agencyUsage.map((agency) => (
            <div key={agency.id} className="rounded-xl border border-gray-200 bg-gradient-to-r from-slate-50 to-white p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="text-sm">
                <p className="font-semibold text-gray-900">{agency.name}</p>
                <p className="text-gray-600">
                  Monthly: {agency.snapshotMonthlyUsed}/{agency.snapshotMonthlyAllowance} used
                </p>
                <p className="text-gray-600">Purchased credits: {agency.snapshotPurchasedCredits}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={creditDrafts[agency.id] ?? ""}
                  onChange={(e) => setCreditDrafts((prev) => ({ ...prev, [agency.id]: e.target.value }))}
                  className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="+ credits"
                />
                <button
                  type="button"
                  onClick={() => void issueCredits(agency.id)}
                  className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
                >
                  Issue
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-3">Active Recurring Grid Keywords</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50">
              <tr>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Agency</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Client</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Keyword</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Business</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Grid</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {keywords.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-sm text-gray-800">{row.agency?.name ?? "-"}</td>
                  <td className="px-3 py-2 text-sm text-gray-800">{row.client?.name ?? "-"}</td>
                  <td className="px-3 py-2 text-sm font-semibold text-gray-900">{row.keywordText}</td>
                  <td className="px-3 py-2 text-sm text-gray-800">{row.businessName}</td>
                  <td className="px-3 py-2 text-sm text-gray-800">{row.gridSize}x{row.gridSize} @ {row.gridSpacingMiles}mi</td>
                  <td className="px-3 py-2">
                    <select
                      value={row.status}
                      onChange={(e) => void updateKeywordStatus(row.id, e.target.value as "active" | "paused" | "canceled")}
                      className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                    >
                      <option value="active">active</option>
                      <option value="paused">paused</option>
                      <option value="canceled">canceled</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default ProspectSnapshotPage;
