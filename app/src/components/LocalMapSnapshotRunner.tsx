import React, { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Download, Loader2, MapPin, Play, Sparkles, Target } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import api from "@/lib/api";
import GoogleBusinessSearch, { type GoogleBusinessSelection } from "@/components/GoogleBusinessSearch";

type SnapshotSummary = {
  monthlyAllowance: number;
  monthlyUsed: number;
  monthlyRemaining: number;
  purchasedCredits: number;
  purchasedPacks?: {
    pack5: number;
    pack10: number;
    pack25: number;
    totalPurchases: number;
    latestPurchaseAt: string | null;
  };
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
  const [formOpen, setFormOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<SnapshotSummary | null>(null);
  const [gridData, setGridData] = useState<SnapshotPoint[]>([]);
  const [ataScore, setAtaScore] = useState<number | null>(null);
  const [topCompetitors, setTopCompetitors] = useState<string[]>([]);
  const [debugBusinesses, setDebugBusinesses] = useState<string[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const snapshotPdfContentRef = useRef<HTMLDivElement | null>(null);

  const gridRows = useMemo(() => {
    if (gridData.length === 0) return [];
    const rows: SnapshotPoint[][] = [];
    const size = Math.sqrt(gridData.length) || 7;
    for (let i = 0; i < gridData.length; i += size) {
      rows.push(gridData.slice(i, i + size));
    }
    return rows;
  }, [gridData]);

  const snapshotAllowanceBanner = useMemo(() => {
    if (superAdminMode) return null;
    if (!summary) return null;
    const isUnlimited = Number(summary.monthlyAllowance) >= 100000;
    const totalAvailable = isUnlimited
      ? "Unlimited"
      : String(Math.max(0, Number(summary.monthlyRemaining || 0)) + Math.max(0, Number(summary.purchasedCredits || 0)));
    const remainingText = isUnlimited
      ? "Unlimited snapshots remaining this month"
      : `${Math.max(0, Number(summary.monthlyRemaining || 0))} Snapshots Remaining This Month`;
    const resetDateText = summary.resetsAt
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(summary.resetsAt))
      : "the 1st";
    const purchasedText = `${Math.max(0, Number(summary.purchasedCredits || 0))} purchased credits (never expire)`;
    return { remainingText, resetDateText, purchasedText, totalAvailable };
  }, [summary, superAdminMode]);

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

    try {
      setRunning(true);
      setRunError(null);
      if (!business) {
        toast.error("Select a business");
        return;
      }

      const res = await api.post("/local-map/snapshot/run", {
        keyword: keyword.trim(),
        placeId: business.placeId,
        businessName: business.businessName,
        businessAddress: business.address,
        centerLat: business.lat,
        centerLng: business.lng,
        superAdminMode,
      }, { timeout: 300000, _silent: true } as any);
      const rawGrid =
        res?.data?.gridData
        ?? res?.data?.snapshot?.gridData
        ?? res?.data?.data?.gridData
        ?? null;
      const parsedGrid = typeof rawGrid === "string"
        ? (() => {
            try { return JSON.parse(rawGrid); } catch { return []; }
          })()
        : rawGrid;
      const points = Array.isArray(parsedGrid) ? parsedGrid : [];
      setGridData(points as SnapshotPoint[]);

      const rawAta =
        res?.data?.ataScore
        ?? res?.data?.snapshot?.ataScore
        ?? res?.data?.data?.ataScore
        ?? null;
      setAtaScore(rawAta == null ? null : Number(rawAta));
      setTopCompetitors(
        Array.isArray(res?.data?.topCompetitorsCurrent)
          ? res.data.topCompetitorsCurrent.slice(0, 3)
          : []
      );
      setDebugBusinesses(
        Array.isArray(res?.data?.topDetectedBusinesses)
          ? res.data.topDetectedBusinesses.slice(0, 15)
          : []
      );

      if (!points.length) {
        const message = "Snapshot completed but no grid points were returned.";
        setRunError(message);
        toast.error(message);
      } else {
        toast.success("Snapshot complete");
      }
      setFormOpen(false);
      await loadSummary();
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to run snapshot";
      setRunError(message);
      setTopCompetitors([]);
      setDebugBusinesses([]);
      toast.error(message);
    } finally {
      setRunning(false);
    }
  };

  const downloadSnapshotPdf = async () => {
    if (!gridData.length) {
      toast.error("Run a snapshot first");
      return;
    }

    if (!snapshotPdfContentRef.current) {
      toast.error("Unable to capture snapshot content.");
      return;
    }

    try {
      setExportingPdf(true);
      const sections = Array.from(
        snapshotPdfContentRef.current.querySelectorAll(".local-map-snapshot-pdf-section")
      ) as HTMLElement[];
      if (!sections.length) {
        toast.error("No snapshot sections found to export.");
        return;
      }

      const sectionCanvases: HTMLCanvasElement[] = [];
      const ignoreFilter = (el: Element) => el.getAttribute?.("data-pdf-hide") === "true";
      for (const sec of sections) {
        const cvs = await html2canvas(sec, {
          scale: 2,
          useCORS: true,
          logging: false,
          scrollX: 0,
          scrollY: 0,
          backgroundColor: "#FFFFFF",
          ignoreElements: ignoreFilter,
        });
        sectionCanvases.push(cvs);
      }

      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const marginX = 12;
      const headerH = 16;
      const footerH = 10;
      const contentMarginTop = headerH + 3;
      const contentMarginBottom = footerH + 2;
      const usableWidth = pageWidth - marginX * 2;
      const usableHeight = pageHeight - contentMarginTop - contentMarginBottom;
      const generatedDate = new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date());

      // Cover page.
      pdf.setFillColor(15, 23, 42);
      pdf.rect(0, 0, pageWidth, pageHeight, "F");
      pdf.setFillColor(79, 70, 229);
      pdf.rect(0, 0, pageWidth, 3, "F");
      const labelY = pageHeight * 0.32;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(148, 163, 184);
      pdf.text("LOCAL MAP SNAPSHOT", pageWidth / 2, labelY, { align: "center" });
      pdf.setDrawColor(79, 70, 229);
      pdf.setLineWidth(0.6);
      pdf.line(pageWidth / 2 - 25, labelY + 4, pageWidth / 2 + 25, labelY + 4);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(24);
      pdf.setTextColor(255, 255, 255);
      pdf.text(keyword || "Snapshot", pageWidth / 2, labelY + 18, { align: "center", maxWidth: pageWidth - 30 });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(148, 163, 184);
      pdf.text(business?.businessName || "", pageWidth / 2, labelY + 30, { align: "center", maxWidth: pageWidth - 30 });
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(generatedDate, pageWidth / 2, labelY + 41, { align: "center", maxWidth: pageWidth - 30 });
      pdf.setFillColor(79, 70, 229);
      pdf.rect(0, pageHeight - 3, pageWidth, 3, "F");

      pdf.addPage();
      let cursorY = 0;
      const assignments: Array<{ canvas: HTMLCanvasElement; page: number; y: number; w: number; h: number }> = [];

      for (const canvas of sectionCanvases) {
        const baseW = usableWidth;
        const baseH = (canvas.height * baseW) / canvas.width;
        let drawW = baseW;
        let drawH = baseH;

        if (drawH > usableHeight) {
          const scale = usableHeight / drawH;
          drawW = drawW * scale;
          drawH = usableHeight;
        }

        if (cursorY > 0 && cursorY + drawH > usableHeight) {
          pdf.addPage();
          cursorY = 0;
        }

        assignments.push({
          canvas,
          page: pdf.getNumberOfPages(),
          y: contentMarginTop + cursorY,
          w: drawW,
          h: drawH,
        });
        cursorY += drawH + 4;
      }

      const headerLeft = keyword || "Local Map Snapshot";
      const headerRight = generatedDate;
      const drawHeader = () => {
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, pageWidth, headerH, "F");
        pdf.setFillColor(79, 70, 229);
        pdf.rect(0, headerH, pageWidth, 0.8, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.setTextColor(255, 255, 255);
        pdf.text(headerLeft, marginX, 7, { maxWidth: pageWidth * 0.6 });
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(148, 163, 184);
        pdf.text(headerRight, pageWidth - marginX, 12, { align: "right" });
      };

      const drawFooter = (pageNum: number, totalPages: number) => {
        const footerY = pageHeight - footerH / 2;
        pdf.setDrawColor(226, 232, 240);
        pdf.setLineWidth(0.3);
        pdf.line(marginX, pageHeight - footerH, pageWidth - marginX, pageHeight - footerH);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.text(`Page ${pageNum} of ${totalPages}`, pageWidth / 2, footerY, { align: "center" });
        pdf.setFontSize(7);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Generated ${generatedDate}`, marginX, footerY);
        pdf.text("Confidential", pageWidth - marginX, footerY, { align: "right" });
      };

      for (const item of assignments) {
        pdf.setPage(item.page);
        const imgData = item.canvas.toDataURL("image/png");
        const imgX = marginX + (usableWidth - item.w) / 2;
        pdf.addImage(imgData, "PNG", imgX, item.y, item.w, item.h);
      }

      const totalPages = pdf.getNumberOfPages();
      for (let p = 2; p <= totalPages; p += 1) {
        pdf.setPage(p);
        drawHeader();
        drawFooter(p, totalPages);
      }
      pdf.setPage(1);
      drawFooter(1, totalPages);

      const fileKeyword = (keyword || "snapshot").trim().toLowerCase().replace(/\s+/g, "-");
      pdf.save(`${fileKeyword}-local-map-snapshot.pdf`);
    } catch (error: any) {
      toast.error(error?.message || "Failed to export snapshot PDF.");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div ref={snapshotPdfContentRef} className="p-6 space-y-6">
      <div className="local-map-snapshot-pdf-section rounded-2xl border border-primary-200 bg-gradient-to-r from-primary-600 via-indigo-600 to-blue-600 p-6 text-white shadow-lg">
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
        <div className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50 p-4 shadow-sm">
          {summaryLoading ? (
            <p className="text-sm font-semibold text-blue-800">Loading snapshot allowance...</p>
          ) : snapshotAllowanceBanner ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-blue-900">
                {snapshotAllowanceBanner.remainingText} - Resets {snapshotAllowanceBanner.resetDateText}.
              </p>
              <p className="text-sm text-indigo-900">
                Plus {snapshotAllowanceBanner.purchasedText}.
              </p>
              <p className="text-sm font-semibold text-violet-900">
                Total available now: {snapshotAllowanceBanner.totalAvailable} snapshots.
              </p>
              <p className="text-xs text-blue-700">
                Monthly allowance is consumed first, then purchased credits are used.
              </p>
              <div className="pt-1">
                <Link
                  to="/agency/add-ons"
                  className="inline-flex items-center rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  Buy Snapshot Packs
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-blue-800">Snapshot allowance is unavailable right now.</p>
          )}
        </div>
      )}

      {!superAdminMode && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-primary-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wide text-indigo-700 font-semibold">Total Snapshot Balance</p>
              <Sparkles className="h-4 w-4 text-indigo-600" />
            </div>
            {summaryLoading ? (
              <p className="mt-2 text-sm text-indigo-700">Loading...</p>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold text-indigo-900">
                  {Number(summary?.monthlyAllowance ?? 0) >= 100000
                    ? "Unlimited"
                    : `${Math.max(0, Number(summary?.monthlyRemaining ?? 0)) + Math.max(0, Number(summary?.purchasedCredits ?? 0))} remaining`}
                </p>
                <p className="text-xs text-indigo-700">
                  Monthly: {summary?.monthlyRemaining ?? 0} remaining ({summary?.monthlyUsed ?? 0} used of {summary?.monthlyAllowance ?? 0}) · Purchased: {summary?.purchasedCredits ?? 0}
                </p>
              </>
            )}
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Purchased Snapshot Credits</p>
              <Target className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-1 text-2xl font-bold text-emerald-900">{summary?.purchasedCredits ?? 0}</p>
            <p className="text-xs text-emerald-700">Never expire</p>
            <p className="mt-1 text-xs text-emerald-800">
              Packs: 5 ({summary?.purchasedPacks?.pack5 ?? 0}) · 10 ({summary?.purchasedPacks?.pack10 ?? 0}) · 25 ({summary?.purchasedPacks?.pack25 ?? 0})
            </p>
            {summary?.purchasedPacks?.latestPurchaseAt ? (
              <p className="text-[11px] text-emerald-700">
                Latest purchase: {new Date(summary.purchasedPacks.latestPurchaseAt).toLocaleString()}
              </p>
            ) : null}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFormOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100"
          >
            <Play className="h-3.5 w-3.5" />
            {formOpen ? "Hide Snapshot Form" : "Run New Snapshot"}
          </button>
          {gridData.length > 0 ? (
            <button
              type="button"
              onClick={() => void downloadSnapshotPdf()}
              disabled={exportingPdf}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exportingPdf ? "Exporting..." : "Download PDF"}
            </button>
          ) : null}
        </div>

        {formOpen ? (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Keyword</label>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g. emergency plumber"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <GoogleBusinessSearch
              value={business}
              onSelect={setBusiness}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={running}
                onClick={() => void runSnapshot()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary-600 to-indigo-600 text-white text-sm font-semibold hover:from-primary-700 hover:to-indigo-700 disabled:opacity-60"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {running ? "Running..." : "Run"}
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-600">
            Click <span className="font-semibold">Run New Snapshot</span> to open the keyword + business form.
          </p>
        )}
        <p className="text-xs text-gray-500">
          One-time prospecting tool: runs are not saved as snapshot history. Download the PDF if you want to keep the report.
        </p>
      </div>

      {runError ? (
        <div className="local-map-snapshot-pdf-section rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {runError}
        </div>
      ) : null}

      {!runError && gridRows.length > 0 && gridData.every((p) => p.rank == null) ? (
        <div className="local-map-snapshot-pdf-section rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">Target listing is not ranking in the current scan depth for this keyword/grid.</p>
          <p className="mt-1">
            This result is valid when the selected business is outside the top map positions in this area.
          </p>
          {topCompetitors.length > 0 ? (
            <p className="mt-1">
              Top detected competitors: {topCompetitors.join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      {!runError && gridRows.length > 0 ? (
        <details className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <summary className="cursor-pointer font-semibold">Debug details (DataForSEO detected businesses)</summary>
          <p className="mt-2 text-xs text-slate-600">
            Top place titles detected across sampled grid responses:
          </p>
          {debugBusinesses.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {debugBusinesses.map((name) => (
                <span key={name} className="rounded-full border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700">
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-600">No business titles were returned in sampled responses.</p>
          )}
        </details>
      ) : null}

      {ataScore != null && (
        <div className="local-map-snapshot-pdf-section rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-100 p-5 shadow-sm">
          <p className="text-sm font-medium text-amber-700">Average True Rank</p>
          <p className="text-3xl font-bold text-amber-900">{ataScore.toFixed(2)}</p>
          <p className="text-xs text-amber-700 mt-1">Lower score means better local map visibility.</p>
        </div>
      )}

      {gridRows.length > 0 && (
        <div className="local-map-snapshot-pdf-section bg-white rounded-2xl border border-gray-200 p-5 overflow-x-auto shadow-sm">
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
