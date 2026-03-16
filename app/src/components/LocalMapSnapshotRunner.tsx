import React, { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Download, Loader2, MapPin, Play, Sparkles, Target, X } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import api from "@/lib/api";
import GoogleBusinessSearch, { type GoogleBusinessSelection } from "@/components/GoogleBusinessSearch";
import InfoTooltip from "@/components/InfoTooltip";

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
  serpBusinesses: SnapshotSerpBusiness[];
};

type SnapshotSerpBusiness = {
  rank: number;
  title: string;
  placeId: string | null;
  address: string | null;
  rating: number | null;
  reviewsCount: number | null;
  category: string | null;
  isTarget: boolean;
  matchedBy?: "cid" | "place_id" | "name" | null;
};

type LocalMapSnapshotRunnerProps = {
  superAdminMode?: boolean;
  heading: string;
  description: string;
};

const DEFAULT_MAP_ZOOM = 11;
const MAP_CANVAS_SIZE_PX = 560;
const EXPORT_MAP_SIZE_PX = 640;

function colorForRank(rank: number | null): string {
  if (rank != null && rank >= 1 && rank <= 3) return "bg-emerald-700 text-white shadow-emerald-800/45";
  if (rank != null && rank >= 4 && rank <= 7) return "bg-lime-600 text-white shadow-lime-800/45";
  if (rank != null && rank >= 8 && rank <= 10) return "bg-amber-500 text-white shadow-amber-700/45";
  if (rank != null && rank >= 11 && rank <= 20) return "bg-orange-600 text-white shadow-orange-800/45";
  return "bg-red-700 text-white shadow-red-900/45";
}

function rankLabel(rank: number | null): string {
  if (rank == null) return "NR";
  if (rank > 20) return "20+";
  return String(rank);
}

function fillColorForRank(rank: number): string {
  if (rank <= 3) return "#059669";
  if (rank <= 7) return "#65a30d";
  if (rank <= 10) return "#f59e0b";
  if (rank <= 20) return "#ea580c";
  return "#e11d48";
}

function legendChipSvg(label: string, circleFill: string, bgFill: string, borderStroke: string): JSX.Element {
  return (
    <svg width="58" height="22" viewBox="0 0 58 22" role="img" aria-label={label}>
      <rect x="0.5" y="0.5" width="57" height="21" rx="10.5" fill={bgFill} stroke={borderStroke} />
      <circle cx="10" cy="11" r="4" fill={circleFill} />
      <text
        x="22"
        y="11"
        textAnchor="start"
        dominantBaseline="middle"
        fontSize="9"
        fontWeight="600"
        fill="#334155"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        {label}
      </text>
    </svg>
  );
}

function normalizePlaceId(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeBusinessName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toAddressString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const parts = [
    row.address,
    row.street_address,
    row.line1,
    row.line2,
    row.city,
    row.state,
    row.zip,
    row.postal_code,
    row.country,
    row.country_code,
  ]
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return parts.length ? parts.join(", ") : null;
}

function normalizeSerpBusinesses(rawValue: unknown): SnapshotSerpBusiness[] {
  if (!Array.isArray(rawValue)) return [];
  return rawValue
    .map((entry: any, idx: number) => {
      const parsedSerpRank = Number(entry?.rank);
      const ratingSource = entry?.rating;
      const parsedRating = Number(entry?.rating ?? ratingSource?.value ?? entry?.rankings_rating);
      const parsedReviews = Number(
        entry?.reviewsCount
        ?? entry?.reviews_count
        ?? entry?.reviews
        ?? ratingSource?.votes_count
        ?? ratingSource?.votes
        ?? entry?.rating_votes
      );
      return {
        rank: Number.isFinite(parsedSerpRank) && parsedSerpRank > 0 ? parsedSerpRank : (idx + 1),
        title: String(entry?.title ?? entry?.name ?? "").trim(),
        placeId: entry?.placeId != null ? String(entry.placeId) : (entry?.place_id != null ? String(entry.place_id) : null),
        address: toAddressString(entry?.address)
          ?? toAddressString(entry?.address_info)
          ?? toAddressString(entry?.address_data)
          ?? toAddressString(entry?.formatted_address),
        rating: Number.isFinite(parsedRating) ? parsedRating : null,
        reviewsCount: Number.isFinite(parsedReviews)
          ? parsedReviews
          : null,
        category: entry?.category != null ? String(entry.category) : null,
        isTarget: Boolean(entry?.isTarget),
        matchedBy: entry?.matchedBy === "cid" || entry?.matchedBy === "place_id" || entry?.matchedBy === "name"
          ? entry.matchedBy
          : null,
      } as SnapshotSerpBusiness;
    })
    .filter((entry: SnapshotSerpBusiness) => entry.title.length > 0)
    .sort((a: SnapshotSerpBusiness, b: SnapshotSerpBusiness) => a.rank - b.rank)
    .slice(0, 10);
}

function hasSerpBusinessDetails(rows: SnapshotSerpBusiness[]): boolean {
  return rows.some((row) =>
    Boolean(
      (row.address && row.address.trim().length > 0)
    )
  );
}

const LocalMapSnapshotRunner: React.FC<LocalMapSnapshotRunnerProps> = ({
  superAdminMode = false,
  heading,
  description,
}) => {
  const [keyword, setKeyword] = useState("");
  const [business, setBusiness] = useState<GoogleBusinessSelection | null>(null);
  const [running, setRunning] = useState(false);
  const [runProgressPct, setRunProgressPct] = useState(0);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<SnapshotSummary | null>(null);
  const [gridData, setGridData] = useState<SnapshotPoint[]>([]);
  const [ataScore, setAtaScore] = useState<number | null>(null);
  const [topCompetitors, setTopCompetitors] = useState<string[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [pointSerpLoadingIndex, setPointSerpLoadingIndex] = useState<number | null>(null);
  const [pointSerpError, setPointSerpError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfMapDataUrl, setPdfMapDataUrl] = useState<string | null>(null);
  const snapshotPdfContentRef = useRef<HTMLDivElement | null>(null);
  const runProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pointSerpAttemptedRef = useRef<Set<number>>(new Set());

  const gridRows = useMemo(() => {
    if (gridData.length === 0) return [];
    const rows: SnapshotPoint[][] = [];
    const size = Math.sqrt(gridData.length) || 7;
    for (let i = 0; i < gridData.length; i += size) {
      rows.push(gridData.slice(i, i + size));
    }
    return rows;
  }, [gridData]);

  const mapCenter = useMemo(() => {
    if (gridData.length) {
      const valid = gridData.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (valid.length) {
        const minLat = Math.min(...valid.map((p) => p.lat));
        const maxLat = Math.max(...valid.map((p) => p.lat));
        const minLng = Math.min(...valid.map((p) => p.lng));
        const maxLng = Math.max(...valid.map((p) => p.lng));
        return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
      }
    }
    if (business && Number.isFinite(business.lat) && Number.isFinite(business.lng)) {
      return { lat: business.lat, lng: business.lng };
    }
    return null;
  }, [business, gridData]);

  const mapZoom = useMemo(() => {
    const valid = gridData.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (valid.length < 2) return DEFAULT_MAP_ZOOM;

    const toWorld0 = (lat: number, lng: number) => {
      const x = ((lng + 180) / 360) * 256;
      const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
      const sinLat = Math.sin((clampedLat * Math.PI) / 180);
      const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * 256;
      return { x, y };
    };

    const world = valid.map((p) => toWorld0(p.lat, p.lng));
    const minX = Math.min(...world.map((p) => p.x));
    const maxX = Math.max(...world.map((p) => p.x));
    const minY = Math.min(...world.map((p) => p.y));
    const maxY = Math.max(...world.map((p) => p.y));
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);
    const targetPx = MAP_CANVAS_SIZE_PX * 0.72;
    const zoomX = Math.log2(targetPx / spanX);
    const zoomY = Math.log2(targetPx / spanY);
    const fitted = Math.floor(Math.min(zoomX, zoomY));
    return Math.max(8, Math.min(16, Number.isFinite(fitted) ? fitted : DEFAULT_MAP_ZOOM));
  }, [gridData]);

  const embeddedMapUrl = useMemo(() => {
    if (!mapCenter) return null;
    return `https://www.google.com/maps?q=${mapCenter.lat},${mapCenter.lng}&z=${mapZoom}&output=embed`;
  }, [mapCenter, mapZoom]);

  const loadPdfMapDataUrl = useCallback(async (): Promise<string | null> => {
    if (!mapCenter) return null;
    try {
      const res = await api.get("/local-map/snapshot/static-map", {
        params: {
          centerLat: Number(mapCenter.lat.toFixed(6)),
          centerLng: Number(mapCenter.lng.toFixed(6)),
          zoom: mapZoom,
          size: EXPORT_MAP_SIZE_PX,
        },
        responseType: "blob",
        _silent: true,
      } as any);
      const blob = res.data as Blob;
      if (!(blob instanceof Blob)) return null;
      if (blob.size <= 0) return null;
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, [mapCenter, mapZoom]);

  const mapProjectedPoints = useMemo(() => {
    if (!mapCenter || !gridData.length) return [];
    const toWorld = (lat: number, lng: number, zoom: number) => {
      const scale = 256 * 2 ** zoom;
      const x = ((lng + 180) / 360) * scale;
      const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
      const sinLat = Math.sin((clampedLat * Math.PI) / 180);
      const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
      return { x, y };
    };
    const centerWorld = toWorld(mapCenter.lat, mapCenter.lng, mapZoom);
    return gridData
      .map((point, idx) => {
        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
        const world = toWorld(point.lat, point.lng, mapZoom);
        const deltaX = world.x - centerWorld.x;
        const deltaY = world.y - centerWorld.y;
        const leftPct = 50 + (deltaX / MAP_CANVAS_SIZE_PX) * 100;
        const topPct = 50 + (deltaY / MAP_CANVAS_SIZE_PX) * 100;
        return {
          id: `${idx}-${point.lat}-${point.lng}`,
          pointIndex: idx,
          rank: point.rank,
          leftPct,
          topPct,
        };
      })
      .filter((point): point is { id: string; pointIndex: number; rank: number | null; leftPct: number; topPct: number } =>
        Boolean(point && Number.isFinite(point.leftPct) && Number.isFinite(point.topPct))
      );
  }, [gridData, mapCenter, mapZoom]);

  const selectedPoint = useMemo(() => {
    if (selectedPointIndex == null) return null;
    return gridData[selectedPointIndex] ?? null;
  }, [gridData, selectedPointIndex]);

  const selectedPointSerpBusinesses = useMemo(() => {
    if (!selectedPoint) return [];
    const normalizedTargetName = normalizeBusinessName(business?.businessName ?? "");
    const normalizedTargetPlaceId = normalizePlaceId(business?.placeId ?? "");
    return selectedPoint.serpBusinesses.map((entry) => {
      const normalizedEntryName = normalizeBusinessName(entry.title);
      const normalizedEntryPlaceId = normalizePlaceId(entry.placeId ?? "");
      const isTargetByName = Boolean(normalizedTargetName && normalizedEntryName && normalizedEntryName === normalizedTargetName);
      const isTargetByPlaceId = Boolean(normalizedTargetPlaceId && normalizedEntryPlaceId && normalizedEntryPlaceId === normalizedTargetPlaceId);
      const matchedBy = entry.matchedBy
        ?? (isTargetByPlaceId ? "place_id" : (isTargetByName ? "name" : null));
      return {
        ...entry,
        isTarget: entry.isTarget || isTargetByName || isTargetByPlaceId,
        matchedBy,
      };
    });
  }, [business?.businessName, business?.placeId, selectedPoint]);

  const loadPointSerpForIndex = useCallback(async (pointIndex: number, force: boolean = false) => {
    if (!business || !keyword.trim()) return;
    const point = gridData[pointIndex];
    if (!point) return;
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    if (!force && hasSerpBusinessDetails(point.serpBusinesses)) return;
    if (!force && pointSerpAttemptedRef.current.has(pointIndex)) return;
    if (pointSerpLoadingIndex === pointIndex) return;

    pointSerpAttemptedRef.current.add(pointIndex);
    setPointSerpLoadingIndex(pointIndex);
    setPointSerpError(null);
    try {
      const res = await api.post("/local-map/snapshot/point-serp", {
      keyword: keyword.trim(),
      placeId: business.placeId,
      mapsCid: business.mapsCid ?? undefined,
      businessName: business.businessName,
      lat: point.lat,
      lng: point.lng,
      }, { timeout: 240000, _silent: true } as any);
      const serpBusinesses = normalizeSerpBusinesses(
        Array.isArray(res?.data?.serpBusinesses) ? res.data.serpBusinesses : []
      );
      const rankFromResponse = res?.data?.rank == null ? null : Number(res.data.rank);
      setGridData((prev) => prev.map((entry, idx) => {
        if (idx !== pointIndex) return entry;
        return {
          ...entry,
          rank: typeof rankFromResponse === "number" && Number.isFinite(rankFromResponse) && rankFromResponse > 0
            ? rankFromResponse
            : entry.rank,
          serpBusinesses,
        };
      }));
    } catch (error: any) {
      setPointSerpError(error?.response?.data?.message || "Unable to load point businesses.");
    } finally {
      setPointSerpLoadingIndex((current) => (current === pointIndex ? null : current));
    }
  }, [business, gridData, keyword, pointSerpLoadingIndex]);

  React.useEffect(() => {
    if (!snapshotModalOpen) return;
    if (selectedPointIndex == null) return;
    const point = gridData[selectedPointIndex];
    if (!point || hasSerpBusinessDetails(point.serpBusinesses)) return;
    void loadPointSerpForIndex(selectedPointIndex);
  }, [gridData, loadPointSerpForIndex, selectedPointIndex, snapshotModalOpen]);

  React.useEffect(() => {
    setPointSerpError(null);
  }, [selectedPointIndex]);

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
      setRunProgressPct(3);
      setRunError(null);
      setPointSerpError(null);
      pointSerpAttemptedRef.current.clear();
      if (!business) {
        toast.error("Select a business");
        return;
      }
      if (runProgressIntervalRef.current) {
        clearInterval(runProgressIntervalRef.current);
      }
      runProgressIntervalRef.current = setInterval(() => {
        setRunProgressPct((prev) => {
          if (prev >= 92) return prev;
          if (prev < 35) return Math.min(92, prev + 6);
          if (prev < 65) return Math.min(92, prev + 4);
          return Math.min(92, prev + 2);
        });
      }, 700);

      const res = await api.post("/local-map/snapshot/run", {
        keyword: keyword.trim(),
        placeId: business.placeId,
        mapsCid: business.mapsCid ?? undefined,
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
      const points = Array.isArray(parsedGrid)
        ? parsedGrid.map((item: any) => {
            const lat = Number(item?.lat);
            const lng = Number(item?.lng);
            const rawRank = item?.rank;
            const parsedRank = rawRank == null ? null : Number(rawRank);
            const rank = typeof parsedRank === "number" && Number.isFinite(parsedRank) && parsedRank > 0
              ? parsedRank
              : null;
            const rawSerp = Array.isArray(item?.serpBusinesses)
              ? item.serpBusinesses
              : Array.isArray(item?.serp)
                ? item.serp
                : [];
            const serpBusinesses = normalizeSerpBusinesses(rawSerp);
            return {
              lat: Number.isFinite(lat) ? lat : Number.NaN,
              lng: Number.isFinite(lng) ? lng : Number.NaN,
              rank,
              competitors: Array.isArray(item?.competitors)
                ? item.competitors.filter((entry: unknown): entry is string => typeof entry === "string").slice(0, 3)
                : [],
              serpBusinesses,
            } as SnapshotPoint;
          })
        : [];
      setGridData(points);
      if (points.length > 0) {
        setSelectedPointIndex(Math.floor(points.length / 2));
      } else {
        setSelectedPointIndex(null);
      }

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

      if (!points.length) {
        const message = "Snapshot completed but no grid points were returned.";
        setRunError(message);
        toast.error(message);
      } else {
        setRunProgressPct(100);
        setSnapshotModalOpen(true);
        toast.success("Snapshot complete");
      }
      await loadSummary();
    } catch (error: any) {
      const message = error?.response?.data?.message || "Failed to run snapshot";
      setRunError(message);
      setTopCompetitors([]);
      toast.error(message);
    } finally {
      if (runProgressIntervalRef.current) {
        clearInterval(runProgressIntervalRef.current);
        runProgressIntervalRef.current = null;
      }
      setRunning(false);
      setRunProgressPct(0);
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

    let mapObjectUrl: string | null = null;
    try {
      setExportingPdf(true);
      mapObjectUrl = await loadPdfMapDataUrl();
      setPdfMapDataUrl(mapObjectUrl);
      for (let i = 0; i < 3; i += 1) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      const pdfRoot = snapshotPdfContentRef.current;
      pdfRoot.classList.add("pdf-exporting");
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      let imageNodes = Array.from(
        snapshotPdfContentRef.current.querySelectorAll("img[data-pdf-map='true']")
      ) as HTMLImageElement[];
      if (mapObjectUrl && imageNodes.length === 0) {
        for (let attempt = 0; attempt < 10 && imageNodes.length === 0; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 80));
          imageNodes = Array.from(
            snapshotPdfContentRef.current.querySelectorAll("img[data-pdf-map='true']")
          ) as HTMLImageElement[];
        }
      }
      if (imageNodes.length > 0) {
        await Promise.all(
          imageNodes.map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete && img.naturalWidth > 0) return resolve();
                const done = () => resolve();
                img.addEventListener("load", done, { once: true });
                img.addEventListener("error", done, { once: true });
                window.setTimeout(done, 2500);
              })
          )
        );
      }
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
        const sectionType = sec.getAttribute("data-pdf-section");
        const captureScale = sectionType === "rank-grid"
          ? Math.max(4, Number(window.devicePixelRatio || 1))
          : Math.max(3, Number(window.devicePixelRatio || 1));
        const cvs = await html2canvas(sec, {
          scale: captureScale,
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
        const drawW = usableWidth;
        const pxPerMm = canvas.width / drawW;
        const maxChunkPx = Math.max(1, Math.floor(usableHeight * pxPerMm));
        const sectionGapMm = 4;

        const chunkCanvases: HTMLCanvasElement[] = [];
        if (canvas.height <= maxChunkPx) {
          chunkCanvases.push(canvas);
        } else {
          for (let offsetY = 0; offsetY < canvas.height; offsetY += maxChunkPx) {
            const chunkHeight = Math.min(maxChunkPx, canvas.height - offsetY);
            const chunk = document.createElement("canvas");
            chunk.width = canvas.width;
            chunk.height = chunkHeight;
            const ctx = chunk.getContext("2d");
            if (!ctx) continue;
            ctx.drawImage(
              canvas,
              0,
              offsetY,
              canvas.width,
              chunkHeight,
              0,
              0,
              canvas.width,
              chunkHeight
            );
            chunkCanvases.push(chunk);
          }
        }

        chunkCanvases.forEach((chunkCanvas, chunkIdx) => {
          const drawH = (chunkCanvas.height * drawW) / chunkCanvas.width;
          if (cursorY > 0 && cursorY + drawH > usableHeight) {
            pdf.addPage();
            cursorY = 0;
          }
          assignments.push({
            canvas: chunkCanvas,
            page: pdf.getNumberOfPages(),
            y: contentMarginTop + cursorY,
            w: drawW,
            h: drawH,
          });
          const shouldAddGap = chunkIdx === chunkCanvases.length - 1;
          cursorY += drawH + (shouldAddGap ? sectionGapMm : 0);
        });
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
      if (mapObjectUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(mapObjectUrl);
      }
      setPdfMapDataUrl(null);
      snapshotPdfContentRef.current?.classList.remove("pdf-exporting");
      setExportingPdf(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
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
          {gridData.length > 0 ? (
            <button
              type="button"
              onClick={() => setSnapshotModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              <MapPin className="h-3.5 w-3.5" />
              View Latest Snapshot
            </button>
          ) : null}
        </div>

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
          {running ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-indigo-700">
                <span className="font-medium">Running snapshot...</span>
                <span className="font-semibold">{runProgressPct}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-indigo-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary-600 to-indigo-500 transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, runProgressPct))}%` }}
                />
              </div>
            </div>
          ) : null}
        </>
        <p className="text-xs text-gray-500">
          One-time prospecting tool: runs are not saved as snapshot history. Download the PDF if you want to keep the report.
        </p>
      </div>

      {runError ? (
        <div className="local-map-snapshot-pdf-section rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {runError}
        </div>
      ) : null}

      {snapshotModalOpen && gridRows.length > 0 && (
        <div
          className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSnapshotModalOpen(false)}
        >
          <div
            className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-indigo-100 bg-gradient-to-r from-indigo-50 via-sky-50 to-cyan-50 px-4 py-4 sm:px-6">
              <div>
                <h3 className="text-base font-semibold text-indigo-900 sm:text-lg">Local Map Snapshot Result</h3>
                <p className="text-sm text-indigo-700/80">
                  {keyword.trim() || "Keyword"} · {business?.businessName || "Business"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void downloadSnapshotPdf()}
                  disabled={exportingPdf}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white/80 px-3.5 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {exportingPdf ? "Exporting..." : "Download PDF"}
                </button>
                <button
                  type="button"
                  onClick={() => setSnapshotModalOpen(false)}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white/80 px-3.5 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                >
                  <X className="h-4 w-4" />
                  Close
                </button>
              </div>
            </div>
            <div ref={snapshotPdfContentRef} className="overflow-y-auto p-4 sm:p-6 space-y-6">
              {!runError && gridData.every((p) => p.rank == null) ? (
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

              {ataScore != null && (
                <div className="local-map-snapshot-pdf-section rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-100 p-5 shadow-sm">
                  <div className="inline-flex items-center gap-1.5">
                    <p className="text-sm font-medium text-amber-700">Average True Rank</p>
                    <InfoTooltip
                      content="Average of your ranking positions across all grid points in this snapshot. Lower values mean stronger local map visibility."
                      className="inline-flex align-middle"
                      iconClassName="h-3.5 w-3.5 text-amber-700/80 cursor-help"
                    />
                  </div>
                  <p className="text-3xl font-bold text-amber-900">{ataScore.toFixed(2)}</p>
                  <p className="text-xs text-amber-700 mt-1">Lower score means better local map visibility.</p>
                </div>
              )}

              <div className="space-y-4">
                <div data-pdf-section="rank-grid" className="local-map-snapshot-pdf-section rounded-2xl border border-indigo-100 bg-gradient-to-br from-white via-indigo-50/40 to-cyan-50/40 p-5 overflow-x-auto shadow-sm">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Local Rank Grid</p>
                      <p className="text-xs text-gray-600">Styled 7x7-style heat view for prospect snapshots.</p>
                    </div>
                    <div className={`flex items-center gap-2 ${exportingPdf ? "text-xs" : "text-[11px]"} text-gray-700`}>
                      {legendChipSvg("1-3", "#047857", "#ecfdf5", "#a7f3d0")}
                      {legendChipSvg("4-7", "#65a30d", "#f7fee7", "#d9f99d")}
                      {legendChipSvg("8-10", "#f59e0b", "#fffbeb", "#fde68a")}
                      {legendChipSvg("11-20", "#ea580c", "#fff7ed", "#fdba74")}
                      {legendChipSvg("20+", "#dc2626", "#fff1f2", "#fecdd3")}
                    </div>
                  </div>
                  <div
                    className="relative rounded-2xl border border-indigo-100 p-4 overflow-hidden shadow-inner"
                    style={{
                      backgroundImage:
                        exportingPdf
                          ? "radial-gradient(circle at center, rgba(59,130,246,0.06) 0%, rgba(148,163,184,0.04) 40%, rgba(15,23,42,0.03) 100%)"
                          : "radial-gradient(circle at center, rgba(59,130,246,0.10) 0%, rgba(148,163,184,0.06) 42%, rgba(15,23,42,0.05) 100%)",
                    }}
                  >
                    <div className={`relative z-10 ${exportingPdf ? "min-w-[640px] w-[640px] h-[640px]" : "min-w-[560px] w-[560px] h-[560px]"} mx-auto rounded-xl overflow-hidden border border-gray-300`}>
                      {exportingPdf && pdfMapDataUrl ? (
                        <img
                          src={pdfMapDataUrl}
                          alt="Map background for snapshot export"
                          data-pdf-map="true"
                          className="absolute inset-0 h-full w-full object-cover"
                          loading="eager"
                          crossOrigin="anonymous"
                        />
                      ) : embeddedMapUrl ? (
                        <div className="absolute inset-0" data-pdf-hide="true" aria-hidden>
                          <iframe
                            title="Google map snapshot background"
                            src={embeddedMapUrl}
                            className="h-full w-full opacity-90 pointer-events-auto"
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        </div>
                      ) : null}
                      <div className={`absolute inset-0 ${exportingPdf ? "bg-white/8" : "bg-white/20"} pointer-events-none`} />
                      <div
                        className={`absolute inset-0 ${exportingPdf ? "opacity-20" : "opacity-30"} pointer-events-none`}
                        style={{
                          backgroundImage:
                            "linear-gradient(to right, rgba(15,23,42,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.15) 1px, transparent 1px)",
                          backgroundSize: "14.2857% 14.2857%",
                        }}
                      />
                      {mapProjectedPoints.map((point) => {
                        const isCenter = Math.abs(point.leftPct - 50) < 0.6 && Math.abs(point.topPct - 50) < 0.6;
                        const isSelected = selectedPointIndex === point.pointIndex;
                        const inFrame = point.leftPct >= -8 && point.leftPct <= 108 && point.topPct >= -8 && point.topPct <= 108;
                        if (!inFrame) return null;
                        const markerClass = `absolute ${exportingPdf ? "h-12 w-12 text-[13px] font-bold shadow-md" : "h-10 w-10 text-[11px] font-semibold"} rounded-full flex items-center justify-center p-0 leading-none tabular-nums shadow ${!exportingPdf ? "transition-transform hover:scale-105" : ""} ${colorForRank(point.rank)} ${isCenter ? "ring-2 ring-blue-400 ring-offset-1" : ""} ${isSelected ? "ring-2 ring-fuchsia-200 ring-offset-2 ring-offset-fuchsia-500" : ""} ${exportingPdf ? "ring-1 ring-white/90" : ""}`;
                        const markerStyle = { left: `${point.leftPct}%`, top: `${point.topPct}%`, transform: "translate(-50%, -50%)" };
                        if (exportingPdf) {
                          return (
                            <div
                              key={point.id}
                              className={markerClass}
                              style={markerStyle}
                              title={`Rank: ${point.rank == null ? "Not Ranked (20+)" : point.rank}`}
                            >
                              <span
                                className="absolute inset-0 grid place-items-center"
                                style={{ fontFamily: "Arial, Helvetica, sans-serif", lineHeight: 1 }}
                              >
                                {rankLabel(point.rank)}
                              </span>
                            </div>
                          );
                        }
                        return (
                          <button
                            type="button"
                            key={point.id}
                            onClick={() => setSelectedPointIndex(point.pointIndex)}
                            className={`${markerClass} focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
                            style={markerStyle}
                            title={`Rank: ${point.rank == null ? "Not Ranked (20+)" : point.rank}`}
                          >
                            <span
                              className="absolute inset-0 grid place-items-center"
                              style={{ fontFamily: "Arial, Helvetica, sans-serif", lineHeight: 1 }}
                            >
                              {rankLabel(point.rank)}
                            </span>
                          </button>
                        );
                      })}
                      <div
                        className={`absolute ${exportingPdf ? "h-5 w-5" : "h-4 w-4"} rounded-full bg-blue-600 border-2 border-white shadow pointer-events-none`}
                        style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
                        title="Business center"
                      />
                    </div>
                  </div>
                </div>
                <div data-pdf-section="keyword-results" className="local-map-snapshot-pdf-section overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
                  <div className="border-b border-violet-100 bg-gradient-to-r from-violet-50 via-fuchsia-50 to-pink-50 px-4 py-3">
                    <p className="text-[13px] font-semibold text-gray-900">
                      Results for "{keyword.trim() || "selected keyword"}"
                    </p>
                    {selectedPoint ? (
                      <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-700">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-50">
                          <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                            <path
                              d="M8 1.5a4.1 4.1 0 0 0-4.1 4.1c0 2.8 3 6.4 3.7 7.2.2.2.5.2.7 0 .7-.8 3.7-4.4 3.7-7.2A4.1 4.1 0 0 0 8 1.5Zm0 5.6a1.5 1.5 0 1 1 0-3.1 1.5 1.5 0 0 1 0 3.1Z"
                              fill="#e11d48"
                            />
                          </svg>
                        </span>
                        <span style={{ fontFamily: "Arial, Helvetica, sans-serif", lineHeight: 1 }}>
                          {selectedPoint.lat.toFixed(6)}, {selectedPoint.lng.toFixed(6)}
                        </span>
                        <span className="mx-0.5 h-3.5 w-px bg-slate-300" aria-hidden />
                        <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                          Rank {rankLabel(selectedPoint.rank)}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-gray-600">Select a grid point to view top businesses.</p>
                    )}
                  </div>

                  {!selectedPoint ? null : pointSerpLoadingIndex === selectedPointIndex ? (
                    <p className="px-4 py-4 text-sm text-gray-600">Loading top businesses for this point...</p>
                  ) : selectedPointSerpBusinesses.length === 0 ? (
                    <div className="flex items-center justify-between gap-3 px-4 py-4">
                      <p className="text-sm text-gray-600">
                        {pointSerpError || "No top-business details are available for this point in the current response."}
                      </p>
                      {pointSerpError && selectedPointIndex != null ? (
                        <button
                          type="button"
                          onClick={() => void loadPointSerpForIndex(selectedPointIndex, true)}
                          className="inline-flex shrink-0 items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                        >
                          Retry
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {selectedPointSerpBusinesses.map((entry) => {
                        const roundedRating = entry.rating == null ? 0 : Math.max(0, Math.min(5, Math.round(entry.rating)));
                        return (
                          <div
                            key={`${entry.rank}-${entry.title}`}
                            className={`flex items-start gap-3 px-4 ${exportingPdf ? "py-4" : "py-2.5"} ${entry.isTarget ? "bg-blue-50/70" : "bg-white"}`}
                          >
                            <div className="mt-0.5 h-6 w-6 shrink-0">
                              <svg viewBox="0 0 24 24" className="h-6 w-6" role="img" aria-label={`Rank ${entry.rank}`}>
                                <circle cx="12" cy="12" r="12" fill={fillColorForRank(entry.rank)} />
                                <text
                                  x="12"
                                  y="12"
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fontSize="10"
                                  fontWeight="700"
                                  fill="#ffffff"
                                  style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
                                >
                                  {entry.rank}
                                </text>
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-3">
                                <p className={`${exportingPdf ? "whitespace-normal break-words text-[14px]" : "truncate text-[13px]"} font-semibold text-gray-900`}>{entry.title}</p>
                              </div>
                              <p className={`mt-0.5 ${exportingPdf ? "whitespace-normal break-words text-[13px]" : "truncate text-[12px]"} text-gray-500`}>
                                {entry.address || "Address unavailable"}
                              </p>
                              <div className={`mt-1 flex items-center gap-2 ${exportingPdf ? "text-[12px]" : "text-[11px]"} text-gray-500`}>
                                <span className="inline-flex items-center gap-0.5 text-amber-500">
                                  {Array.from({ length: 5 }).map((_, idx) => (
                                    <span key={`${entry.rank}-star-${idx}`} className={idx < roundedRating ? "text-amber-500" : "text-gray-300"}>
                                      ★
                                    </span>
                                  ))}
                                </span>
                                {entry.rating != null ? <span>{entry.rating.toFixed(1)}</span> : null}
                                {entry.reviewsCount != null ? <span>({entry.reviewsCount})</span> : null}
                                {entry.category ? <span className="truncate italic uppercase tracking-wide text-[10px]">{entry.category}</span> : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LocalMapSnapshotRunner;
