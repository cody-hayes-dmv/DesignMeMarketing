import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import LocalMapSnapshotRunner from "@/components/LocalMapSnapshotRunner";
import ConfirmDialog from "@/components/ConfirmDialog";
import api from "@/lib/api";
import { Download, Eye, Loader2, MapPin, Play, Save, Send, Trash2, X } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

type LocalMapOverview = {
  month: string;
  scheduledRuns: number;
  ondemandRuns: number;
  totalRuns: number;
  costPerRunUsd?: number;
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
  gridSpacingMiles: string | number;
  snapshots?: Array<{ id: string; runDate: string; ataScore: number }>;
  agency: { name: string };
  client: { name: string };
};

type SnapshotAdminRow = {
  id: string;
  runDate: string;
  ataScore: number;
  gridKeyword: {
    id: string;
    keywordText: string;
    businessName: string;
    client?: { id: string; name: string } | null;
    agency?: { id: string; name: string } | null;
  };
};

type LocalMapSnapshotReportRow = {
  id: string;
  runDate: string;
  ataScore: number;
  isBenchmark: boolean;
  gridData: string;
};

type LocalMapKeywordReportPayload = {
  keyword: {
    id: string;
    keywordText: string;
    businessName: string;
    businessAddress: string | null;
  };
  current: LocalMapSnapshotReportRow | null;
  previousThree: LocalMapSnapshotReportRow[];
  benchmark: LocalMapSnapshotReportRow | null;
  snapshots: LocalMapSnapshotReportRow[];
  trend: Array<{ runDate: string; ataScore: number }>;
};

type LocalMapGridCell = { rank: number | null; competitors: string[] };

const parseLocalMapGridData = (raw: string): LocalMapGridCell[] => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: any) => ({
      rank: item?.rank == null ? null : Number(item.rank),
      competitors: Array.isArray(item?.competitors)
        ? item.competitors.filter((entry: unknown): entry is string => typeof entry === "string").slice(0, 3)
        : [],
    }));
  } catch {
    return [];
  }
};

const localMapCellClass = (rank: number | null): string => {
  if (rank != null && rank >= 1 && rank <= 3) return "bg-emerald-500 text-white";
  if (rank != null && rank >= 4 && rank <= 10) return "bg-yellow-300 text-yellow-900";
  if (rank != null && rank >= 11 && rank <= 20) return "bg-orange-300 text-orange-900";
  return "bg-rose-300 text-rose-900";
};

const getTopCompetitorsFromCells = (cells: LocalMapGridCell[]): string[] => {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    for (const name of cell.competitors) {
      const normalized = String(name || "").trim();
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
};

const safeFormatLocalMapDate = (
  value: string | Date | null | undefined,
  fallback: string = "N/A"
): string => {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const ProspectSnapshotPage: React.FC = () => {
  const [overview, setOverview] = useState<LocalMapOverview | null>(null);
  const [agencyUsage, setAgencyUsage] = useState<AgencyUsageRow[]>([]);
  const [keywords, setKeywords] = useState<GridKeywordAdminRow[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotAdminRow[]>([]);
  const [keywordSearch, setKeywordSearch] = useState("");
  const [keywordStatusFilter, setKeywordStatusFilter] = useState<"all" | "active" | "paused" | "canceled">("all");
  const [snapshotSearch, setSnapshotSearch] = useState("");
  const [agencyUsageSearch, setAgencyUsageSearch] = useState("");
  const [agencyUsageFilterId, setAgencyUsageFilterId] = useState("all");
  const [creditDrafts, setCreditDrafts] = useState<Record<string, string>>({});
  const [costPerRunDraft, setCostPerRunDraft] = useState("");
  const [savingCostPerRun, setSavingCostPerRun] = useState(false);
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, { gridSize: string; gridSpacingMiles: string }>>({});
  const [savingKeywordId, setSavingKeywordId] = useState<string | null>(null);
  const [triggeringKeywordId, setTriggeringKeywordId] = useState<string | null>(null);
  const [localMapReportOpen, setLocalMapReportOpen] = useState(false);
  const [localMapReportLoading, setLocalMapReportLoading] = useState(false);
  const [localMapReport, setLocalMapReport] = useState<LocalMapKeywordReportPayload | null>(null);
  const [localMapExportingPdf, setLocalMapExportingPdf] = useState(false);
  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null);
  const [agencyUsageSectionOpen, setAgencyUsageSectionOpen] = useState(true);
  const [snapshotDeleteConfirm, setSnapshotDeleteConfirm] = useState<{
    isOpen: boolean;
    snapshotId: string | null;
    label: string | null;
  }>({
    isOpen: false,
    snapshotId: null,
    label: null,
  });
  const localMapReportContentRef = useRef<HTMLDivElement | null>(null);

  const loadAdminData = async () => {
    try {
      const [overviewRes, usageRes, keywordsRes, snapshotsRes] = await Promise.all([
        api.get("/local-map/admin/overview"),
        api.get("/local-map/admin/agencies-usage"),
        api.get("/local-map/admin/keywords"),
        api.get("/local-map/admin/snapshots"),
      ]);
      setOverview(overviewRes.data as LocalMapOverview);
      const loadedCost = Number(overviewRes.data?.costPerRunUsd ?? 0);
      if (Number.isFinite(loadedCost) && loadedCost >= 0) {
        setCostPerRunDraft(String(loadedCost));
      }
      setAgencyUsage(Array.isArray(usageRes.data) ? usageRes.data : []);
      const keywordRows = Array.isArray(keywordsRes.data) ? keywordsRes.data as GridKeywordAdminRow[] : [];
      setKeywords(keywordRows);
      setSnapshots(Array.isArray(snapshotsRes.data) ? snapshotsRes.data : []);
      setKeywordDrafts((prev) => {
        const next = { ...prev };
        for (const row of keywordRows) {
          if (!next[row.id]) {
            next[row.id] = {
              gridSize: String(row.gridSize ?? 7),
              gridSpacingMiles: String(row.gridSpacingMiles ?? "0.5"),
            };
          }
        }
        return next;
      });
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to load local map admin data");
    }
  };

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

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

  const saveKeywordControls = async (keywordId: string) => {
    const draft = keywordDrafts[keywordId];
    if (!draft) return;
    const gridSize = Number(draft.gridSize);
    const gridSpacingMiles = Number(draft.gridSpacingMiles);
    if (!Number.isFinite(gridSize) || gridSize < 3 || gridSize > 21 || gridSize % 2 === 0) {
      toast.error("Grid size must be an odd number between 3 and 21.");
      return;
    }
    if (!Number.isFinite(gridSpacingMiles) || gridSpacingMiles <= 0) {
      toast.error("Grid spacing must be a positive number.");
      return;
    }
    try {
      setSavingKeywordId(keywordId);
      await api.patch(`/local-map/admin/keywords/${keywordId}`, {
        gridSize,
        gridSpacingMiles,
      });
      toast.success("Keyword controls updated");
      await loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update keyword controls");
    } finally {
      setSavingKeywordId(null);
    }
  };

  const triggerRunNow = async (keywordId: string) => {
    try {
      setTriggeringKeywordId(keywordId);
      await api.post(`/local-map/admin/trigger/${keywordId}`);
      toast.success("Grid run triggered");
      await loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to trigger run");
    } finally {
      setTriggeringKeywordId(null);
    }
  };

  const openLocalMapReport = useCallback(async (gridKeywordId: string) => {
    try {
      setLocalMapReportOpen(true);
      setLocalMapReportLoading(true);
      setLocalMapReport(null);
      const res = await api.get(`/local-map/report/${gridKeywordId}`, { _silent: true } as any);
      setLocalMapReport(res.data as LocalMapKeywordReportPayload);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to load report.");
    } finally {
      setLocalMapReportLoading(false);
    }
  }, []);

  const exportLocalMapReportPdf = useCallback(async (reportData?: LocalMapKeywordReportPayload | null) => {
    const report = reportData ?? localMapReport;
    if (!report) {
      toast.error("Report data is not ready yet.");
      return false;
    }
    if (!localMapReportContentRef.current) {
      toast.error("Unable to export report content.");
      return false;
    }

    try {
      setLocalMapExportingPdf(true);
      const sections = Array.from(
        localMapReportContentRef.current.querySelectorAll(".local-map-pdf-section")
      ) as HTMLElement[];
      if (!sections.length) {
        toast.error("No report sections found to export.");
        return false;
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

      pdf.setFillColor(15, 23, 42);
      pdf.rect(0, 0, pageWidth, pageHeight, "F");
      pdf.setFillColor(79, 70, 229);
      pdf.rect(0, 0, pageWidth, 3, "F");
      const labelY = pageHeight * 0.32;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(148, 163, 184);
      pdf.text("LOCAL MAP REPORT", pageWidth / 2, labelY, { align: "center" });
      pdf.setDrawColor(79, 70, 229);
      pdf.setLineWidth(0.6);
      pdf.line(pageWidth / 2 - 25, labelY + 4, pageWidth / 2 + 25, labelY + 4);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(24);
      pdf.setTextColor(255, 255, 255);
      pdf.text(report.keyword.keywordText || "Local Map Report", pageWidth / 2, labelY + 18, {
        align: "center",
        maxWidth: pageWidth - 30,
      });
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(148, 163, 184);
      pdf.text(report.keyword.businessName || "", pageWidth / 2, labelY + 30, { align: "center", maxWidth: pageWidth - 30 });
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.text(generatedDate, pageWidth / 2, labelY + 41, { align: "center" });
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

      const drawHeader = () => {
        pdf.setFillColor(15, 23, 42);
        pdf.rect(0, 0, pageWidth, headerH, "F");
        pdf.setFillColor(79, 70, 229);
        pdf.rect(0, headerH, pageWidth, 0.8, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.setTextColor(255, 255, 255);
        pdf.text("Local Map Report", marginX, 7);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(148, 163, 184);
        pdf.text(generatedDate, pageWidth - marginX, 12, { align: "right" });
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

      const fileStem = (report.keyword.keywordText || "local-map-report").replace(/\s+/g, "-").toLowerCase();
      pdf.save(`${fileStem}-local-map-report.pdf`);
      return true;
    } catch (error: any) {
      toast.error(error?.message || "Unable to export report.");
      return false;
    } finally {
      setLocalMapExportingPdf(false);
    }
  }, [localMapReport]);

  const handleViewSnapshotReport = useCallback(async (row: SnapshotAdminRow) => {
    const keywordId = row.gridKeyword?.id;
    if (!keywordId) {
      toast.error("Keyword context not available for this snapshot.");
      return;
    }
    await openLocalMapReport(keywordId);
  }, [openLocalMapReport]);

  const handleDownloadSnapshotReport = useCallback(async (row: SnapshotAdminRow) => {
    const keywordId = row.gridKeyword?.id;
    if (!keywordId) {
      toast.error("Keyword context not available for this snapshot.");
      return;
    }
    try {
      setLocalMapReportOpen(true);
      setLocalMapReportLoading(true);
      setLocalMapReport(null);
      const res = await api.get(`/local-map/report/${keywordId}`, { _silent: true } as any);
      const payload = res.data as LocalMapKeywordReportPayload;
      setLocalMapReport(payload);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await exportLocalMapReportPdf(payload);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Unable to download report.");
    } finally {
      setLocalMapReportLoading(false);
    }
  }, [exportLocalMapReportPdf]);

  const handleDeleteSnapshot = useCallback(async (row: SnapshotAdminRow) => {
    const snapshotId = String(row.id || "");
    if (!snapshotId) {
      toast.error("Snapshot ID is missing.");
      return;
    }
    setSnapshotDeleteConfirm({
      isOpen: true,
      snapshotId,
      label: row.gridKeyword?.keywordText || "this snapshot",
    });
  }, []);

  const confirmDeleteSnapshot = useCallback(async () => {
    const snapshotId = snapshotDeleteConfirm.snapshotId;
    if (!snapshotId) {
      setSnapshotDeleteConfirm({ isOpen: false, snapshotId: null, label: null });
      return;
    }
    try {
      setDeletingSnapshotId(snapshotId);
      await api.delete(`/local-map/admin/snapshots/${snapshotId}`);
      toast.success("Snapshot deleted");
      await loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to delete snapshot");
    } finally {
      setDeletingSnapshotId(null);
      setSnapshotDeleteConfirm({ isOpen: false, snapshotId: null, label: null });
    }
  }, [loadAdminData, snapshotDeleteConfirm.snapshotId]);

  const saveCostPerRun = async () => {
    const nextCost = Number(costPerRunDraft);
    if (!Number.isFinite(nextCost) || nextCost < 0) {
      toast.error("Enter a valid non-negative cost per run.");
      return;
    }
    try {
      setSavingCostPerRun(true);
      await api.put("/local-map/admin/config/cost-per-run", { costPerRunUsd: nextCost });
      toast.success("Cost per run updated");
      await loadAdminData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to update cost per run");
    } finally {
      setSavingCostPerRun(false);
    }
  };

  const filteredKeywords = useMemo(() => {
    const q = keywordSearch.trim().toLowerCase();
    return keywords.filter((row) => {
      if (keywordStatusFilter !== "all" && row.status !== keywordStatusFilter) return false;
      if (!q) return true;
      const haystack = [
        row.agency?.name,
        row.client?.name,
        row.keywordText,
        row.businessName,
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [keywords, keywordSearch, keywordStatusFilter]);

  const filteredSnapshots = useMemo(() => {
    const q = snapshotSearch.trim().toLowerCase();
    return snapshots.filter((row) => {
      if (!q) return true;
      const haystack = [
        row.gridKeyword?.agency?.name,
        row.gridKeyword?.client?.name,
        row.gridKeyword?.keywordText,
        row.gridKeyword?.businessName,
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [snapshots, snapshotSearch]);

  const filteredAgencyUsage = useMemo(() => {
    const q = agencyUsageSearch.trim().toLowerCase();
    return agencyUsage
      .filter((agency) => (agencyUsageFilterId === "all" ? true : agency.id === agencyUsageFilterId))
      .filter((agency) => (q ? agency.name.toLowerCase().includes(q) : true));
  }, [agencyUsage, agencyUsageFilterId, agencyUsageSearch]);

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
        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Cost Per Run (USD)</p>
            <input
              value={costPerRunDraft}
              onChange={(e) => setCostPerRunDraft(e.target.value)}
              className="mt-1 w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="0.78"
            />
          </div>
          <button
            type="button"
            onClick={() => void saveCostPerRun()}
            disabled={savingCostPerRun}
            title={savingCostPerRun ? "Saving cost" : "Save cost"}
            aria-label={savingCostPerRun ? "Saving cost" : "Save cost"}
            className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60"
          >
            {savingCostPerRun ? (
              <span className="inline-flex items-center justify-center text-xs font-semibold">...</span>
            ) : (
              <Save className="h-4 w-4" />
            )}
          </button>
          <p className="text-xs text-gray-600">
            Used to calculate projected monthly API cost.
          </p>
        </div>
        <p className="mt-3 text-xs text-gray-600">
          Includes scheduled recurring grid runs + on-demand runs for current month.
        </p>
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-3">Recurring Grid Keywords (All Agencies)</h3>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={keywordSearch}
            onChange={(e) => setKeywordSearch(e.target.value)}
            placeholder="Search agency, client, keyword, business..."
            className="w-full md:w-96 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={keywordStatusFilter}
            onChange={(e) => setKeywordStatusFilter(e.target.value as "all" | "active" | "paused" | "canceled")}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="canceled">Canceled</option>
          </select>
          <p className="text-xs text-gray-600">{filteredKeywords.length} rows</p>
        </div>
        <div
          className={`overflow-x-auto ${filteredKeywords.length > 5 ? "max-h-[280px] overflow-y-auto pr-1" : ""}`}
        >
          <table className="w-full min-w-[1120px]">
            <thead className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50">
              <tr>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Agency</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Client</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Keyword</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Business</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Grid Controls</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Status</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredKeywords.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-sm text-gray-800">{row.agency?.name ?? "-"}</td>
                  <td className="px-3 py-2 text-sm text-gray-800">{row.client?.name ?? "-"}</td>
                  <td className="px-3 py-2 text-sm font-semibold text-gray-900">{row.keywordText}</td>
                  <td className="px-3 py-2 text-sm text-gray-800">{row.businessName}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={keywordDrafts[row.id]?.gridSize ?? String(row.gridSize)}
                        onChange={(e) =>
                          setKeywordDrafts((prev) => ({
                            ...prev,
                            [row.id]: {
                              gridSize: e.target.value,
                              gridSpacingMiles: prev[row.id]?.gridSpacingMiles ?? String(row.gridSpacingMiles),
                            },
                          }))
                        }
                        className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm"
                        placeholder="size"
                      />
                      <input
                        value={keywordDrafts[row.id]?.gridSpacingMiles ?? String(row.gridSpacingMiles)}
                        onChange={(e) =>
                          setKeywordDrafts((prev) => ({
                            ...prev,
                            [row.id]: {
                              gridSize: prev[row.id]?.gridSize ?? String(row.gridSize),
                              gridSpacingMiles: e.target.value,
                            },
                          }))
                        }
                        className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm"
                        placeholder="miles"
                      />
                      <button
                        type="button"
                        onClick={() => void saveKeywordControls(row.id)}
                        disabled={savingKeywordId === row.id}
                        title={savingKeywordId === row.id ? "Saving controls" : "Save controls"}
                        aria-label={savingKeywordId === row.id ? "Saving controls" : "Save controls"}
                        className="inline-flex items-center justify-center px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        {savingKeywordId === row.id ? "..." : <Save className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
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
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void triggerRunNow(row.id)}
                        disabled={triggeringKeywordId === row.id}
                        title={triggeringKeywordId === row.id ? "Running now" : "Run now"}
                        aria-label={triggeringKeywordId === row.id ? "Running now" : "Run now"}
                        className="inline-flex items-center justify-center px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {triggeringKeywordId === row.id ? "..." : <Play className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredKeywords.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-sm text-gray-500" colSpan={7}>
                    No keywords match the current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="text-lg font-bold text-gray-900 mb-3">Recent Snapshots (Any Client)</h3>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={snapshotSearch}
            onChange={(e) => setSnapshotSearch(e.target.value)}
            placeholder="Search agency, client, keyword, business..."
            className="w-full md:w-96 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-600">{filteredSnapshots.length} rows</p>
        </div>
        <div
          className={`overflow-x-auto ${filteredSnapshots.length > 5 ? "max-h-[280px] overflow-y-auto pr-1" : ""}`}
        >
          <table className="w-full min-w-[980px]">
            <thead className="bg-gradient-to-r from-slate-50 via-blue-50 to-indigo-50">
              <tr>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Agency</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Client</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Keyword</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Run Date</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">ATA</th>
                <th className="text-left text-xs px-3 py-2 font-semibold text-gray-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredSnapshots.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-sm text-gray-800">{row.gridKeyword?.agency?.name ?? "-"}</td>
                  <td className="px-3 py-2 text-sm text-gray-800">{row.gridKeyword?.client?.name ?? "-"}</td>
                  <td className="px-3 py-2 text-sm font-semibold text-gray-900">{row.gridKeyword?.keywordText ?? "-"}</td>
                  <td className="px-3 py-2 text-sm text-gray-700">
                    {row.runDate ? new Date(row.runDate).toLocaleString() : "-"}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700">
                    {Number.isFinite(Number(row.ataScore)) ? Number(row.ataScore).toFixed(2) : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleViewSnapshotReport(row)}
                        disabled={localMapReportLoading || localMapExportingPdf}
                        title="View snapshot PDF"
                        aria-label="View snapshot PDF"
                        className="inline-flex items-center justify-center px-2.5 py-1 rounded-md border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDownloadSnapshotReport(row)}
                        disabled={localMapReportLoading || localMapExportingPdf}
                        title="Download snapshot PDF"
                        aria-label="Download snapshot PDF"
                        className="inline-flex items-center justify-center px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSnapshot(row)}
                        disabled={deletingSnapshotId === row.id}
                        title={deletingSnapshotId === row.id ? "Deleting snapshot" : "Delete snapshot"}
                        aria-label={deletingSnapshotId === row.id ? "Deleting snapshot" : "Delete snapshot"}
                        className="inline-flex items-center justify-center px-2.5 py-1 rounded-md border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {deletingSnapshotId === row.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredSnapshots.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-sm text-gray-500" colSpan={6}>
                    No snapshots match the current search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <ConfirmDialog
        isOpen={snapshotDeleteConfirm.isOpen}
        onClose={() => setSnapshotDeleteConfirm({ isOpen: false, snapshotId: null, label: null })}
        onConfirm={() => void confirmDeleteSnapshot()}
        title="Delete snapshot?"
        message={`Delete snapshot for "${snapshotDeleteConfirm.label || "this keyword"}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <button
          type="button"
          onClick={() => setAgencyUsageSectionOpen((prev) => !prev)}
          className="w-full flex items-center justify-between text-left"
          title={agencyUsageSectionOpen ? "Hide agencies" : "Show agencies"}
          aria-label={agencyUsageSectionOpen ? "Hide agencies" : "Show agencies"}
        >
          <h3 className="text-lg font-bold text-gray-900">Agency Snapshot Credit Balances</h3>
          <span className="text-sm font-semibold text-gray-600">
            {agencyUsageSectionOpen ? "Hide" : "Show"}
          </span>
        </button>
        {agencyUsageSectionOpen ? (
          <>
            <div className="mb-3 mt-3 flex flex-wrap items-center gap-2">
              <input
                value={agencyUsageSearch}
                onChange={(e) => setAgencyUsageSearch(e.target.value)}
                placeholder="Search agency..."
                className="w-full md:w-72 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <select
                value={agencyUsageFilterId}
                onChange={(e) => setAgencyUsageFilterId(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="all">All agencies</option>
                {agencyUsage.map((agency) => (
                  <option key={agency.id} value={agency.id}>
                    {agency.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-600">{filteredAgencyUsage.length} rows</p>
            </div>
            <div className={`space-y-2 ${filteredAgencyUsage.length > 5 ? "max-h-[280px] overflow-y-auto pr-1" : ""}`}>
              {filteredAgencyUsage.map((agency) => (
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
                      title="Issue credits"
                      aria-label="Issue credits"
                      className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              {filteredAgencyUsage.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                  No agencies match the current filters.
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </section>
      {localMapReportOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden rounded-2xl border border-indigo-200/80 bg-white shadow-[0_18px_60px_-22px_rgba(79,70,229,0.55)]">
            <div className="relative flex items-center justify-between overflow-hidden bg-gradient-to-r from-primary-600 via-violet-600 to-cyan-500 px-5 py-4 text-white">
              <div>
                <h3 className="text-lg font-bold">Local Map Report</h3>
                {localMapReport ? (
                  <p className="text-xs text-white/90">
                    {localMapReport.keyword.keywordText} - {localMapReport.keyword.businessName}
                  </p>
                ) : (
                  <p className="text-xs text-white/90">Loading report...</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLocalMapReportOpen(false)}
                className="rounded-md border border-white/40 bg-white/15 p-1 text-white/90 hover:bg-white/25"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {!localMapReport ? (
              <div className="overflow-y-auto bg-gradient-to-b from-indigo-50/60 via-violet-50/30 to-cyan-50/40 p-8">
                {localMapReportLoading ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading local map report...
                  </div>
                ) : (
                  <p className="text-sm text-gray-600 text-center">Unable to load this keyword report.</p>
                )}
              </div>
            ) : (
              <div ref={localMapReportContentRef} className="overflow-y-auto space-y-5 bg-gradient-to-b from-indigo-50/60 via-violet-50/20 to-cyan-50/30 p-5">
                <div className="local-map-pdf-section rounded-xl border border-gray-200 bg-gradient-to-r from-slate-50 via-blue-50 to-indigo-50 p-4">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    <div className="md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Keyword</p>
                      <p className="text-sm font-semibold text-gray-900">{localMapReport.keyword.keywordText}</p>
                      <p className="mt-2 text-xs uppercase tracking-wide text-gray-500">Business</p>
                      <p className="text-sm font-semibold text-gray-900">{localMapReport.keyword.businessName}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Location</p>
                      <p className="text-sm text-gray-800">{localMapReport.keyword.businessAddress || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Run Date</p>
                      <p className="text-sm text-gray-800">{safeFormatLocalMapDate(localMapReport.current?.runDate, "Not run yet")}</p>
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Current ATA</p>
                      <p className="text-2xl font-bold text-emerald-900">
                        {localMapReport.current?.ataScore != null ? Number(localMapReport.current.ataScore).toFixed(2) : "-"}
                      </p>
                    </div>
                  </div>
                </div>

                {localMapReport.current && (
                  <div className="local-map-pdf-section rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-white via-indigo-50/30 to-violet-50/40 p-4">
                    <h4 className="text-sm font-bold text-gray-900">CURRENT</h4>
                    <p className="mb-3 text-xs text-gray-600">
                      {safeFormatLocalMapDate(localMapReport.current.runDate)} · ATA {Number(localMapReport.current.ataScore).toFixed(2)}
                    </p>
                    {(() => {
                      const cells = parseLocalMapGridData(localMapReport.current!.gridData);
                      const size = Math.max(1, Math.round(Math.sqrt(cells.length || 1)));
                      const centerIdx = Math.floor(size / 2) * size + Math.floor(size / 2);
                      const topCompetitors = getTopCompetitorsFromCells(cells);
                      return (
                        <>
                          <div className="space-y-1 min-w-[520px] overflow-x-auto">
                            {Array.from({ length: size }).map((_, rowIdx) => (
                              <div key={`current-${rowIdx}`} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
                                {Array.from({ length: size }).map((__, colIdx) => {
                                  const pointIdx = rowIdx * size + colIdx;
                                  const point = cells[pointIdx];
                                  const rank = point?.rank ?? null;
                                  const isCenter = pointIdx === centerIdx;
                                  return (
                                    <div key={`current-${rowIdx}-${colIdx}`} className={`h-11 rounded text-[11px] font-semibold flex items-center justify-center gap-1 ${localMapCellClass(rank)}`}>
                                      {isCenter && <MapPin className="h-3.5 w-3.5" />}
                                      <span>{rank == null ? "NR" : rank}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                          <div className="mt-3">
                            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Top 3 Competitors (Current Grid)</p>
                            <div className="flex flex-wrap gap-2">
                              {topCompetitors.length ? topCompetitors.map((name) => (
                                <span key={name} className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-800">
                                  {name}
                                </span>
                              )) : <span className="text-xs text-gray-500">No competitor names captured for this run.</span>}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                <div className="local-map-pdf-section bg-white border border-gray-200 rounded-xl p-4">
                  <h4 className="text-sm font-bold text-gray-900 mb-3">PREVIOUS 3 RUNS</h4>
                  {localMapReport.previousThree.length === 0 ? (
                    <p className="text-sm text-gray-500">No previous runs yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {localMapReport.previousThree.map((snap) => {
                        const cells = parseLocalMapGridData(snap.gridData);
                        const size = Math.max(1, Math.round(Math.sqrt(cells.length || 1)));
                        const centerIdx = Math.floor(size / 2) * size + Math.floor(size / 2);
                        return (
                          <div key={snap.id} className="rounded-lg border border-violet-200 bg-gradient-to-br from-white to-violet-50/40 p-3">
                            <p className="text-xs font-semibold text-gray-900">{safeFormatLocalMapDate(snap.runDate)}</p>
                            <p className="mb-2 text-[11px] text-gray-600">ATA {Number(snap.ataScore).toFixed(2)}</p>
                            <div className="space-y-1">
                              {Array.from({ length: size }).map((_, rowIdx) => (
                                <div key={`${snap.id}-row-${rowIdx}`} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
                                  {Array.from({ length: size }).map((__, colIdx) => {
                                    const pointIdx = rowIdx * size + colIdx;
                                    const point = cells[pointIdx];
                                    const rank = point?.rank ?? null;
                                    const isCenter = pointIdx === centerIdx;
                                    return (
                                      <div key={`${snap.id}-${rowIdx}-${colIdx}`} className={`h-8 rounded text-[10px] font-semibold flex items-center justify-center gap-0.5 ${localMapCellClass(rank)}`}>
                                        {isCenter && <MapPin className="h-3 w-3" />}
                                        <span>{rank == null ? "NR" : rank}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {localMapReport.benchmark && (
                  <div className="local-map-pdf-section bg-white border border-amber-300 rounded-xl p-4">
                    <h4 className="text-sm font-bold text-amber-900">YOUR BENCHMARK</h4>
                    <p className="text-xs font-semibold text-amber-800">
                      Benchmark — {safeFormatLocalMapDate(localMapReport.benchmark.runDate)}
                    </p>
                    <p className="text-xs text-amber-700 mb-3">ATA {Number(localMapReport.benchmark.ataScore).toFixed(2)}</p>
                    {(() => {
                      const cells = parseLocalMapGridData(localMapReport.benchmark!.gridData);
                      const size = Math.max(1, Math.round(Math.sqrt(cells.length || 1)));
                      const centerIdx = Math.floor(size / 2) * size + Math.floor(size / 2);
                      return (
                        <div className="space-y-1 min-w-[360px] overflow-x-auto">
                          {Array.from({ length: size }).map((_, rowIdx) => (
                            <div key={`benchmark-row-${rowIdx}`} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
                              {Array.from({ length: size }).map((__, colIdx) => {
                                const pointIdx = rowIdx * size + colIdx;
                                const point = cells[pointIdx];
                                const rank = point?.rank ?? null;
                                const isCenter = pointIdx === centerIdx;
                                return (
                                  <div key={`benchmark-${rowIdx}-${colIdx}`} className={`h-9 rounded text-[10px] font-semibold flex items-center justify-center gap-0.5 ${localMapCellClass(rank)}`}>
                                    {isCenter && <MapPin className="h-3 w-3" />}
                                    <span>{rank == null ? "NR" : rank}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProspectSnapshotPage;
