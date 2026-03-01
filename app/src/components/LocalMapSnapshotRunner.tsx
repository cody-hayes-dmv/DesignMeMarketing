import React, { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Download, Loader2, MapPin, Play, Sparkles, Target } from "lucide-react";
import api from "@/lib/api";
import GoogleBusinessSearch, { type GoogleBusinessSelection } from "@/components/GoogleBusinessSearch";

type SnapshotSummary = {
  monthlyAllowance: number;
  monthlyUsed: number;
  monthlyRemaining: number;
  purchasedCredits: number;
  resetsAt: string | null;
};

type SnapshotPoint = {
  lat: number;
  lng: number;
  rank: number | null;
  competitors: string[];
};

type LocalMapSnapshotRunnerProps = {
  superAdminMode?: boolean;
  heading: string;
  description: string;
};

function colorForRank(rank: number | null): string {
  if (rank != null && rank >= 1 && rank <= 3) return "bg-emerald-500 text-white";
  if (rank != null && rank >= 4 && rank <= 10) return "bg-yellow-300 text-yellow-900";
  if (rank != null && rank >= 11 && rank <= 20) return "bg-orange-300 text-orange-900";
  return "bg-rose-300 text-rose-900";
}

const LocalMapSnapshotRunner: React.FC<LocalMapSnapshotRunnerProps> = ({
  superAdminMode = false,
  heading,
  description,
}) => {
  const [keyword, setKeyword] = useState("");
  const [business, setBusiness] = useState<GoogleBusinessSelection | null>(null);
  const [running, setRunning] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<SnapshotSummary | null>(null);
  const [gridData, setGridData] = useState<SnapshotPoint[]>([]);
  const [ataScore, setAtaScore] = useState<number | null>(null);

  const gridRows = useMemo(() => {
    if (gridData.length === 0) return [];
    const rows: SnapshotPoint[][] = [];
    const size = Math.sqrt(gridData.length) || 7;
    for (let i = 0; i < gridData.length; i += size) {
      rows.push(gridData.slice(i, i + size));
    }
    return rows;
  }, [gridData]);

  const loadSummary = async () => {
    if (superAdminMode) return;
    try {
      setSummaryLoading(true);
      const res = await api.get("/local-map/snapshot/summary");
      setSummary(res.data as SnapshotSummary);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  };

  React.useEffect(() => {
    void loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [superAdminMode]);

  const runSnapshot = async () => {
    if (!keyword.trim()) {
      toast.error("Enter a keyword");
      return;
    }
    if (!business) {
      toast.error("Select a business");
      return;
    }

    try {
      setRunning(true);
      const res = await api.post("/local-map/snapshot/run", {
        keyword: keyword.trim(),
        placeId: business.placeId,
        businessName: business.businessName,
        businessAddress: business.address,
        centerLat: business.lat,
        centerLng: business.lng,
        superAdminMode,
      });
      const points = Array.isArray(res?.data?.gridData) ? res.data.gridData : [];
      setGridData(points);
      setAtaScore(res?.data?.ataScore == null ? null : Number(res.data.ataScore));
      toast.success("Snapshot complete");
      await loadSummary();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to run snapshot");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="rounded-2xl border border-primary-200 bg-gradient-to-r from-primary-600 via-indigo-600 to-blue-600 p-6 text-white shadow-lg">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 shrink-0 rounded-xl bg-white/15 flex items-center justify-center">
            <MapPin className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">{heading}</h2>
            <p className="text-sm text-white/90 mt-1">{description}</p>
          </div>
        </div>
      </div>

      {!superAdminMode && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-primary-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wide text-indigo-700 font-semibold">Monthly Snapshot Allowance</p>
              <Sparkles className="h-4 w-4 text-indigo-600" />
            </div>
            {summaryLoading ? (
              <p className="mt-2 text-sm text-indigo-700">Loading...</p>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold text-indigo-900">
                  {summary?.monthlyRemaining ?? 0} remaining
                </p>
                <p className="text-xs text-indigo-700">
                  {summary?.monthlyUsed ?? 0} used of {summary?.monthlyAllowance ?? 0}
                </p>
              </>
            )}
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Purchased Credits</p>
              <Target className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-1 text-2xl font-bold text-emerald-900">{summary?.purchasedCredits ?? 0}</p>
            <p className="text-xs text-emerald-700">Never expire</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4 shadow-sm">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
          <Play className="h-3.5 w-3.5" />
          Run New Snapshot
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Keyword</label>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="e.g. emergency plumber"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <GoogleBusinessSearch value={business} onSelect={setBusiness} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={running}
            onClick={() => void runSnapshot()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-semibold hover:from-primary-700 hover:to-indigo-700 disabled:opacity-60"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "Running..." : "Run New Snapshot"}
          </button>
          <button
            type="button"
            onClick={() => toast("PDF export is connected and pending final report template")}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </button>
        </div>
      </div>

      {ataScore != null && (
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-100 p-5 shadow-sm">
          <p className="text-sm font-medium text-amber-700">Average True Rank</p>
          <p className="text-3xl font-bold text-amber-900">{ataScore.toFixed(2)}</p>
          <p className="text-xs text-amber-700 mt-1">Lower score means better local map visibility.</p>
        </div>
      )}

      {gridRows.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 overflow-x-auto shadow-sm">
          <div className="mb-3">
            <p className="text-sm font-semibold text-gray-900">Map Grid Heat View</p>
            <p className="text-xs text-gray-600">Green: 1-3, Yellow: 4-10, Orange: 11-20, Red: Not ranked / 20+</p>
          </div>
          <div className="space-y-1 min-w-[520px]">
            {gridRows.map((row, rowIdx) => (
              <div key={rowIdx} className="grid grid-cols-7 gap-1">
                {row.map((point, colIdx) => (
                  <div
                    key={`${rowIdx}-${colIdx}`}
                    className={`h-12 rounded text-[11px] font-semibold flex items-center justify-center ${colorForRank(point.rank)}`}
                    title={`Rank: ${point.rank == null ? "Not Ranked" : point.rank}`}
                  >
                    {point.rank == null ? "NR" : point.rank}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default LocalMapSnapshotRunner;
