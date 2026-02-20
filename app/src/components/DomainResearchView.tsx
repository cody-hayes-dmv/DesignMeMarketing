import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Search,
  TrendingUp,
  ExternalLink,
  Link2,
  Download,
  Upload,
  Globe,
  ChevronUp,
  ChevronDown,
  Calendar,
  Info,
  PieChart as PieChartIcon,
  Sparkles,
  FileText,
  X,
  Filter,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
} from "recharts";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import api from "@/lib/api";
import { Client } from "@/store/slices/clientSlice";

export interface DomainOverviewData {
  client: { id: string; name: string; domain: string };
  metrics: {
    organicSearch: { keywords: number; traffic: number; trafficCost: number };
    paidSearch: { keywords: number; traffic: number; trafficCost: number };
    backlinks: { referringDomains: number; totalBacklinks: number };
    authorityScore?: number;
    trafficShare?: number;
  };
  marketTrendsChannels?: Array<{ name: string; value: number; pct: number }>;
  backlinksList?: Array<{
    referringPageUrl: string;
    referringPageTitle: string | null;
    anchorText: string;
    linkUrl: string;
    type: "follow" | "nofollow";
  }>;
  organicTrafficOverTime: Array<{ month: string; traffic: number }>;
  organicKeywordsOverTime: Array<{ year: number; month: number; keywords: number }>;
  organicPositionsOverTime?: Array<{
    year: number;
    month: number;
    top3: number;
    top10: number;
    top20: number;
    top100: number;
    pos21_30?: number;
    pos31_50?: number;
    pos51Plus?: number;
  }>;
  positionDistribution: {
    top3: number;
    top10: number;
    page2: number;
    pos21_30: number;
    pos31_50: number;
    pos51Plus: number;
    sfCount?: number;
    top3Pct: number;
    top10Pct: number;
    page2Pct: number;
    pos21_30Pct: number;
    pos31_50Pct: number;
    pos51PlusPct: number;
    sfPct?: number;
  };
  topOrganicKeywords: Array<{
    keyword: string;
    position: number;
    trafficPercent: number | null;
    traffic: number | null;
    volume: number | null;
    url: string | null;
    cpc: number | null;
  }>;
  referringDomains: Array<{ domain: string; backlinks: number; referringDomains: number }>;
  backlinksByType: Array<{ type: string; count: number; pct: number }>;
  topAnchors: Array<{ anchor: string; type: string; refDomains: number; domains?: number }>;
  followNofollow: { follow: number; nofollow: number };
  indexedPages: Array<{ url: string; refDomains: number }>;
  referringDomainsByTld: Array<{ tld: string; refDomains: number }>;
  referringDomainsByCountry?: Array<{ country: string; refDomains: number }>;
  totalCompetitorsCount?: number;
  organicCompetitors?: Array<{ competitor: string; comLevel: number; comKeywords: number; seKeywords: number }>;
  keywordsByIntent?: Array<{ intent: string; pct: number; keywords: number; traffic: number }>;
  topPaidKeywords?: Array<{ keyword: string; clicks: number; impressions: number; cost: number; conversions: number; avgCpc: number; ctr: number }>;
  paidPositionDistribution?: {
    top4: number;
    top10: number;
    page2: number;
    pos21Plus: number;
    top4Pct: number;
    top10Pct: number;
    page2Pct: number;
    pos21PlusPct: number;
  };
  mainPaidCompetitors?: Array<{ competitor: string; comLevel: number; comKeywords: number; seKeywords: number }>;
  totalPaidCompetitorsCount?: number;
}

export type AiSearchVisibilityRow = {
  name: string;
  visibility: number;
  mentions: number;
  citedPages: number;
};

export interface AiSearchVisibilityData {
  rows?: AiSearchVisibilityRow[];
  topCitedSources?: Array<{ domain: string; mentions: number }>;
  distributionByCountry?: Array<{ countryCode: string; visibility: number; mentions: number }>;
  otherSerpFeaturesCount?: number;
  meta?: { serpCache?: { updatedAt?: string; fetchedAt?: string } };
  kpis?: { aiVisibilityScore: number; totalAiMentions: number; aiSearchVolume: number };
  platforms?: Array<{ platform: string; mentions: number; aiSearchVol: number; impressions?: number }>;
}

const formatLastUpdatedHours = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "Last updated less than 1 hour ago";
  if (hours === 1) return "Last updated 1 hour ago";
  if (hours < 24) return `Last updated ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Last updated 1 day ago" : `Last updated ${days} days ago`;
};

const formatCompactNumber = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
};

const getDomainFromUrl = (url: string): string => {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const exportToCsv = (headers: string[], rows: string[][], filename: string) => {
  const csvContent = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

const exportBacklinksToCsv = (backlinks: Array<{ referringPageUrl: string; referringPageTitle?: string | null; anchorText: string; linkUrl: string; type: string }>, domain: string) => {
  const headers = ["Referring Page URL", "Referring Page Title", "Anchor Text", "Link URL", "Type"];
  const rows = backlinks.map((b) => [
    b.referringPageUrl ?? "",
    b.referringPageTitle ?? "",
    b.anchorText ?? "",
    b.linkUrl ?? "",
    b.type ?? "",
  ]);
  exportToCsv(headers, rows, `backlinks-${domain || "export"}-${new Date().toISOString().slice(0, 10)}.csv`);
};

const exportTopAnchorsToCsv = (anchors: Array<{ anchor: string; refDomains: number; domains?: number }>, domain: string) => {
  const headers = ["Anchor", "Domains", "Backlinks"];
  const rows = anchors.map((a) => [
    a.anchor === "(empty)" ? "<EmptyAnchor>" : a.anchor,
    String(a.domains ?? a.refDomains),
    String(a.refDomains),
  ]);
  exportToCsv(headers, rows, `top-anchors-${domain || "export"}-${new Date().toISOString().slice(0, 10)}.csv`);
};

const exportReferringDomainsToCsv = (domains: Array<{ domain: string; backlinks: number }>, domain: string) => {
  const headers = ["Root Domain", "Backlinks"];
  const rows = domains.map((r) => [r.domain, String(r.backlinks)]);
  exportToCsv(headers, rows, `referring-domains-${domain || "export"}-${new Date().toISOString().slice(0, 10)}.csv`);
};

const exportIndexedPagesToCsv = (pages: Array<{ url: string; refDomains: number }>, domain: string) => {
  const baseUrl = `https://${domain || "example.com"}`;
  const headers = ["Title & URL", "Domains", "Backlinks"];
  const rows = pages.map((p) => [
    baseUrl + (p.url.startsWith("/") ? p.url : `/${p.url}`),
    String(p.refDomains),
    String(p.refDomains),
  ]);
  exportToCsv(headers, rows, `title-url-${domain || "export"}-${new Date().toISOString().slice(0, 10)}.csv`);
};

const AI_SEARCH_PERIOD_DAYS: Record<"1M" | "6M" | "1Y" | "2Y" | "All", number> = {
  "1M": 30,
  "6M": 180,
  "1Y": 365,
  "2Y": 730,
  All: 730,
};

const AI_SEARCH_MONTHS_LIMIT: Record<"1M" | "6M" | "1Y" | "2Y" | "All", number> = {
  "1M": 1,
  "6M": 6,
  "1Y": 12,
  "2Y": 24,
  All: 999,
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const POSITION_COLORS = ["#22C55E", "#3B82F6", "#FACC15", "#F97316", "#EF4444", "#8B5CF6"];

interface DomainResearchViewProps {
  clients: Client[];
  clientsError: string | null;
  onGetTopics?: (domain: string) => void;
}

const DomainResearchView: React.FC<DomainResearchViewProps> = ({ clients, clientsError, onGetTopics }) => {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [directDomain, setDirectDomain] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [overview, setOverview] = useState<DomainOverviewData | null>(null);
  const [aiSearch, setAiSearch] = useState<AiSearchVisibilityData | null>(null);
  const [aiSearchError, setAiSearchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [aiSearchTimeRange, setAiSearchTimeRange] = useState<"1M" | "6M" | "1Y" | "2Y" | "All">("1Y");
  const [aiSearchGranularity, setAiSearchGranularity] = useState<"Days" | "Months">("Months");
  const [trafficOrganic, setTrafficOrganic] = useState(true);
  const [trafficPaid, setTrafficPaid] = useState(true);
  const [trafficBranded, setTrafficBranded] = useState(true);
  const [keywordsTab, setKeywordsTab] = useState<"Organic" | "Paid">("Organic");
  const [keywordRanges, setKeywordRanges] = useState({ top3: true, "4-10": true, "11-20": true, "21-50": true, "51-100": true, aiOverviews: true, otherSerp: true });
  const [keywordRangesPaid, setKeywordRangesPaid] = useState({ "1-4": true, "5-10": true, "11-20": true, "21+": true });
  const [topKeywordsModalOpen, setTopKeywordsModalOpen] = useState(false);
  const [intentModalOpen, setIntentModalOpen] = useState(false);
  const [competitorsModalOpen, setCompetitorsModalOpen] = useState(false);
  const [backlinksModalOpen, setBacklinksModalOpen] = useState(false);
  const [citedSourcesLoading, setCitedSourcesLoading] = useState(false);
  const [aiSearchExportingPdf, setAiSearchExportingPdf] = useState(false);
  const aiSearchSectionRef = useRef<HTMLDivElement>(null);

  const selectedClient = clients.find((c) => c.id === selectedClientId) || null;
  const activeDomain = selectedClient?.domain || directDomain || null;

  // Derive kpis and platforms from rows for detail sections (API returns rows)
  const aiSearchKpis = React.useMemo(() => {
    const rows = aiSearch?.rows ?? [];
    const totalAiMentions = rows.reduce((s, r) => s + (r.mentions ?? 0), 0);
    const visSum = rows.reduce((s, r) => s + (r.visibility ?? 0), 0);
    const aiVisibilityScore = rows.length > 0 ? Math.round(visSum / rows.length) : 0;
    return { aiVisibilityScore, totalAiMentions };
  }, [aiSearch?.rows]);

  const aiSearchPlatforms = React.useMemo(() => {
    return (aiSearch?.rows ?? []).map((r) => ({
      platform: r.name,
      mentions: r.mentions ?? 0,
      aiSearchVol: r.citedPages ?? 0,
    }));
  }, [aiSearch?.rows]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Normalize URL input to domain for matching (e.g. https://ablelockshop.com/ -> ablelockshop.com)
  const searchNormalized = (() => {
    const raw = searchQuery.trim();
    if (!raw) return "";
    try {
      const domain = getDomainFromUrl(raw);
      if (domain && domain !== raw) return domain.toLowerCase();
    } catch {
      // not a URL
    }
    return raw.toLowerCase();
  })();

  const filteredClients = searchNormalized
    ? clients.filter((c) => {
        const name = (c.name || "").toLowerCase();
        const domain = (c.domain || "").toLowerCase();
        return name.includes(searchNormalized) || domain.includes(searchNormalized) || domain === searchNormalized || name.startsWith(searchNormalized) || domain.startsWith(searchNormalized);
      })
    : clients;

  const handleDomainSearch = useCallback(() => {
    const raw = searchQuery.trim();
    if (!raw) return;
    const domain = getDomainFromUrl(raw);
    const matchedClient = clients.find((c) => {
      const cd = (c.domain || "").toLowerCase();
      return cd === domain.toLowerCase() || cd === raw.toLowerCase();
    });
    if (matchedClient) {
      setSelectedClientId(matchedClient.id);
      setDirectDomain(null);
    } else {
      setSelectedClientId(null);
      setDirectDomain(domain);
    }
    setSearchQuery("");
    setSearchOpen(false);
  }, [searchQuery, clients]);

  const fetchOverview = useCallback(async (clientIdOrDomain: string, isDirect: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      let overviewRes;
      if (isDirect) {
        overviewRes = await api.get<DomainOverviewData>(`/seo/domain-overview-any`, { params: { domain: clientIdOrDomain } });
      } else {
        overviewRes = await api.get<DomainOverviewData>(`/seo/domain-overview/${clientIdOrDomain}`);
      }
      setOverview(overviewRes.data);
    } catch (err: any) {
      setOverview(null);
      setError(err?.response?.data?.message || "Failed to load domain overview");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAiSearch = useCallback(async (clientId: string, timeRange: "1M" | "6M" | "1Y" | "2Y" | "All") => {
    if (directDomain && !selectedClientId) return;
    setAiSearchError(null);
    try {
      const period = AI_SEARCH_PERIOD_DAYS[timeRange];
      const aiRes = await api.get<AiSearchVisibilityData>(`/seo/ai-search-visibility/${clientId}`, {
        params: { period: String(period) },
        timeout: 30000,
      });
      setAiSearch(aiRes.data);
    } catch (err: any) {
      setAiSearch(null);
      setAiSearchError(err?.response?.data?.message || "Unable to load AI Search Visibility");
    }
  }, [directDomain, selectedClientId]);

  const fetchCitedSources = useCallback(async () => {
    if (!selectedClientId) return;
    setCitedSourcesLoading(true);
    setAiSearchError(null);
    try {
      const period = AI_SEARCH_PERIOD_DAYS[aiSearchTimeRange];
      const aiRes = await api.get<AiSearchVisibilityData>(`/seo/ai-search-visibility/${selectedClientId}`, {
        params: { period: String(period), force: "true" },
        timeout: 60000,
      });
      setAiSearch(aiRes.data);
    } catch (err: any) {
      setAiSearchError((err as any)?.response?.data?.message || "Failed to load cited sources");
    } finally {
      setCitedSourcesLoading(false);
    }
  }, [selectedClientId, aiSearchTimeRange]);

  const exportAiSearchToPdf = useCallback(async () => {
    const element = aiSearchSectionRef.current;
    if (!element) return;
    const previousOverflow = document.body.style.overflow;
    const prevOverflow = element.style.overflow;
    const prevWidth = element.style.width;
    const prevMinWidth = element.style.minWidth;
    const prevMinHeight = element.style.minHeight;
    try {
      setAiSearchExportingPdf(true);
      document.body.style.overflow = "hidden";
      element.classList.add("pdf-exporting");
      element.style.background = "#ffffff";
      element.style.padding = "24px";
      element.style.boxSizing = "border-box";
      element.style.overflow = "visible";
      element.scrollIntoView({ behavior: "auto", block: "start" });
      await new Promise((r) => setTimeout(r, 200));
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => setTimeout(r, 450));
      const rect = element.getBoundingClientRect();
      const w = Math.max(element.scrollWidth, element.offsetWidth, Math.ceil(rect.width));
      const h = Math.max(element.scrollHeight, element.offsetHeight, Math.ceil(rect.height));
      element.style.width = `${w}px`;
      element.style.minWidth = `${w}px`;
      element.style.minHeight = `${h}px`;
      await new Promise((r) => requestAnimationFrame(r));
      const captureW = element.scrollWidth;
      const captureH = element.scrollHeight;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        width: captureW,
        height: captureH,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        windowWidth: captureW,
        windowHeight: captureH,
        backgroundColor: "#ffffff",
        onclone: (clonedDoc, clonedNode) => {
          const root = clonedNode as HTMLElement;
          root.style.backgroundColor = "#ffffff";
          clonedDoc.body.style.backgroundColor = "#ffffff";
          root.querySelectorAll("[class*='gradient'], .bg-gray-50").forEach((el) => {
            (el as HTMLElement).style.background = "#ffffff";
          });
        },
      });
      element.classList.remove("pdf-exporting");
      element.style.background = "";
      element.style.padding = "";
      element.style.overflow = prevOverflow;
      element.style.width = prevWidth;
      element.style.minWidth = prevMinWidth;
      element.style.minHeight = prevMinHeight;
      const imgData = canvas.toDataURL("image/png", 1.0);
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 14;
      const headerHeightMm = 14;
      const contentHeightMm = pageHeight - margin * 2 - headerHeightMm;
      const contentWidthMm = pageWidth - margin * 2;
      let imgWidth = contentWidthMm;
      let imgHeight = (canvas.height * contentWidthMm) / canvas.width;
      let x = margin;
      let y = margin + headerHeightMm;
      if (imgHeight > contentHeightMm) {
        const scale = contentHeightMm / imgHeight;
        imgWidth = contentWidthMm * scale;
        imgHeight = contentHeightMm;
        x = margin + (contentWidthMm - imgWidth) / 2;
      }
      const websiteName = overview?.client?.name || overview?.client?.domain || "AI Search";
      pdf.setFontSize(16);
      pdf.setTextColor(30, 30, 30);
      pdf.text(websiteName, pageWidth / 2, margin + headerHeightMm / 2 + 4, { align: "center" });
      pdf.addImage(imgData, "PNG", x, y, imgWidth, imgHeight);
      const domain = overview?.client?.domain ?? "ai-search";
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      pdf.save(`ai-search-${domain}-${dateStr}.pdf`);
    } catch (err: any) {
      console.error("AI Search PDF export error", err);
    } finally {
      document.body.style.overflow = previousOverflow;
      element.classList.remove("pdf-exporting");
      element.style.background = "";
      element.style.padding = "";
      element.style.overflow = prevOverflow;
      element.style.width = prevWidth;
      element.style.minWidth = prevMinWidth;
      element.style.minHeight = prevMinHeight;
      setAiSearchExportingPdf(false);
    }
  }, [overview?.client?.domain]);

  useEffect(() => {
    if (selectedClientId) {
      setAiSearch(null);
      fetchOverview(selectedClientId, false);
    } else if (directDomain) {
      setAiSearch(null);
      fetchOverview(directDomain, true);
    } else {
      setOverview(null);
      setAiSearch(null);
      setError(null);
    }
  }, [selectedClientId, directDomain, fetchOverview]);

  useEffect(() => {
    if (selectedClientId) {
      fetchAiSearch(selectedClientId, aiSearchTimeRange);
    }
  }, [selectedClientId, aiSearchTimeRange, fetchAiSearch]);

  const positionBarDataOrganic = overview?.positionDistribution
    ? [
        { name: "1-3", value: overview.positionDistribution.top3, pct: overview.positionDistribution.top3Pct, fill: "#3B82F6" },
        { name: "4-10", value: overview.positionDistribution.top10, pct: overview.positionDistribution.top10Pct, fill: "#3B82F6" },
        { name: "11-20", value: overview.positionDistribution.page2, pct: overview.positionDistribution.page2Pct, fill: "#3B82F6" },
        { name: "21-50", value: (overview.positionDistribution.pos21_30 ?? 0) + (overview.positionDistribution.pos31_50 ?? 0), pct: (overview.positionDistribution.pos21_30Pct ?? 0) + (overview.positionDistribution.pos31_50Pct ?? 0), fill: "#3B82F6" },
        { name: "51-100", value: overview.positionDistribution.pos51Plus, pct: overview.positionDistribution.pos51PlusPct, fill: "#3B82F6" },
        { name: "SF", value: overview.positionDistribution.sfCount ?? 0, pct: overview.positionDistribution.sfPct ?? 0, fill: "#3B82F6" },
      ]
    : [];
  const positionBarYMax = positionBarDataOrganic.length
    ? Math.min(100, Math.max(20, Math.ceil(Math.max(...positionBarDataOrganic.map((d) => d.pct)) / 10) * 10 + 10))
    : 100;

  const intentColors: Record<string, string> = { Informational: "#3B82F6", Navigational: "#8B5CF6", Commercial: "#F59E0B", Transactional: "#22C55E" };
  const intentData = (overview?.keywordsByIntent ?? [
    { intent: "Informational", pct: 32.4, keywords: Math.round((overview?.metrics.organicSearch.keywords ?? 0) * 0.324), traffic: Math.round((overview?.metrics.organicSearch.traffic ?? 0) * 0.38) },
    { intent: "Navigational", pct: 1.5, keywords: Math.round((overview?.metrics.organicSearch.keywords ?? 0) * 0.015), traffic: Math.round((overview?.metrics.organicSearch.traffic ?? 0) * 0.01) },
    { intent: "Commercial", pct: 63.4, keywords: Math.round((overview?.metrics.organicSearch.keywords ?? 0) * 0.634), traffic: Math.round((overview?.metrics.organicSearch.traffic ?? 0) * 0.35) },
    { intent: "Transactional", pct: 2.8, keywords: Math.round((overview?.metrics.organicSearch.keywords ?? 0) * 0.028), traffic: Math.round((overview?.metrics.organicSearch.traffic ?? 0) * 0.02) },
  ]).map((d) => ({ ...d, fill: intentColors[d.intent] ?? "#3B82F6" }));

  const competitorMapData = (() => {
    const clientKw = overview?.metrics.organicSearch.keywords ?? 0;
    const clientTraffic = overview?.metrics.organicSearch.traffic ?? 0;
    const clientDomain = overview?.client?.domain ?? "designmemarketing";
    const clientPoint = { name: clientDomain, displayName: clientDomain.replace(/\./g, "").slice(0, 16), keywords: clientKw, traffic: clientTraffic, fill: "#8B5CF6" };
    const competitors = overview?.organicCompetitors ?? [];
    const colors = ["#3B82F6", "#22C55E", "#F97316", "#EC4899", "#FACC15"];
    const competitorPoints = competitors.slice(0, 5).map((c, i) => ({
      name: c.competitor,
      displayName: c.competitor.replace(/\./g, "").slice(0, 16),
      keywords: c.seKeywords,
      traffic: Math.round(c.comKeywords * 15),
      fill: colors[i % colors.length],
    }));
    return [...competitorPoints, clientPoint];
  })();

  const monthsLimit = AI_SEARCH_MONTHS_LIMIT[aiSearchTimeRange];
  const trafficChartDataRaw = (overview?.organicTrafficOverTime ?? []).map((m) => {
    const parts = (m.month || "").split("-");
    const year = parseInt(parts[0] || "", 10) || new Date().getFullYear();
    const monthNum = Math.min(12, Math.max(1, parseInt(parts[1] || "1", 10)));
    return {
      ...m,
      monthFull: `${FULL_MONTH_NAMES[monthNum - 1]} ${year}`,
      monthShort: `${MONTH_NAMES[monthNum - 1]} ${year}`,
      dayLabel: `1 ${MONTH_NAMES[monthNum - 1]}`,
      trafficPaid: 0,
      trafficBranded: 0,
    };
  });
  const trafficChartData = trafficChartDataRaw.slice(-monthsLimit);

  const keywordsStackDataRaw =
    overview?.organicPositionsOverTime?.map((m) => {
      const top3 = m.top3 ?? 0;
      const top10 = (m.top10 ?? 0) - top3;
      const top20 = (m.top20 ?? 0) - (m.top10 ?? 0);
      const pos21_30 = m.pos21_30 ?? 0;
      const pos31_50 = m.pos31_50 ?? 0;
      const pos51Plus = m.pos51Plus ?? 0;
      return {
        month: `${MONTH_NAMES[(m.month ?? 1) - 1]} ${m.year}`,
        monthKey: `${m.year}-${String(m.month).padStart(2, "0")}`,
        monthFull: `${MONTH_NAMES[(m.month ?? 1) - 1]} ${m.year}`,
        dayLabel: `1 ${MONTH_NAMES[(m.month ?? 1) - 1]}`,
        "Top 3": top3,
        "4-10": Math.max(0, top10),
        "11-20": Math.max(0, top20),
        "21-50": pos21_30 + pos31_50,
        "51-100": pos51Plus,
        "AI Overviews": aiSearchKpis.totalAiMentions ? Math.round(aiSearchKpis.totalAiMentions / 12) : 0,
        "Other SERP Features": 0,
      };
    }) ?? [];
  const keywordsStackData = keywordsStackDataRaw.slice(-monthsLimit);

  const paid = overview?.paidPositionDistribution;
  const organicMonths = overview?.organicPositionsOverTime ?? [];
  const monthsForPaid = organicMonths.length > 0 ? organicMonths : (() => {
    const now = new Date();
    const arr: Array<{ year: number; month: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      arr.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }
    return arr;
  })();
  const keywordsStackDataPaidRaw = monthsForPaid.map((m) => {
    const now = new Date();
    const isCurrentMonth = m.year === now.getFullYear() && m.month === now.getMonth() + 1;
    const top4 = isCurrentMonth && paid ? paid.top4 ?? 0 : 0;
    const top10 = isCurrentMonth && paid ? paid.top10 ?? 0 : 0;
    const page2 = isCurrentMonth && paid ? paid.page2 ?? 0 : 0;
    const pos21Plus = isCurrentMonth && paid ? paid.pos21Plus ?? 0 : 0;
    return {
      month: `${MONTH_NAMES[(m.month ?? 1) - 1]} ${m.year}`,
      monthKey: `${m.year}-${String(m.month).padStart(2, "0")}`,
      monthFull: `${MONTH_NAMES[(m.month ?? 1) - 1]} ${m.year}`,
      dayLabel: `1 ${MONTH_NAMES[(m.month ?? 1) - 1]}`,
      "1-4": top4,
      "5-10": top10,
      "11-20": page2,
      "21+": pos21Plus,
    };
  });
  const keywordsStackDataPaid = keywordsStackDataPaidRaw.slice(-monthsLimit);

  const followNofollowData =
    overview?.followNofollow && (overview.followNofollow.follow + overview.followNofollow.nofollow > 0)
      ? [
          { name: "Follow", value: overview.followNofollow.follow, fill: "#8B5CF6" },
          { name: "Nofollow", value: overview.followNofollow.nofollow, fill: "#3B82F6" },
        ]
      : [];

  return (
    <div className="space-y-6">
      {/* Search / domain input - Semrush-style */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600" aria-hidden />
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b border-gray-200 bg-gradient-to-r from-primary-50/60 via-blue-50/40 to-indigo-50/40">
          <div ref={searchContainerRef} className="relative flex-1 max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={(selectedClient || directDomain) ? `${activeDomain || selectedClient?.name || ""} /` : searchQuery}
              onChange={(e) => {
                if (!selectedClient && !directDomain) {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }
              }}
              onFocus={() => { if (!selectedClient && !directDomain) setSearchOpen(true); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearchOpen(false);
                if (e.key === "Enter" && !selectedClient && !directDomain) {
                  handleDomainSearch();
                }
              }}
              placeholder="Enter any domain or URL (e.g. competitor.com or https://example.com/)"
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
            {searchOpen && !selectedClient && !directDomain && searchQuery.trim() && (
              <div className="absolute z-30 mt-1 left-0 right-0 rounded-lg border border-gray-200 bg-white shadow-xl max-h-60 overflow-y-auto">
                {filteredClients.length > 0 && (
                  <>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-100">Your Clients</div>
                    {filteredClients.slice(0, 10).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedClientId(c.id);
                          setDirectDomain(null);
                          setSearchQuery("");
                          setSearchOpen(false);
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center justify-between"
                      >
                        <span className="font-medium text-gray-900">{c.name || c.domain || c.id}</span>
                        <span className="text-gray-500 text-xs">{c.domain}</span>
                      </button>
                    ))}
                    <div className="border-t border-gray-100" />
                  </>
                )}
                <button
                  type="button"
                  onClick={handleDomainSearch}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-primary-50 flex items-center gap-2 text-primary-700 font-medium"
                >
                  <Globe className="h-4 w-4" />
                  Search &quot;{searchNormalized || searchQuery.trim()}&quot; as external domain
                </button>
              </div>
            )}
          </div>
          {!selectedClient && !directDomain && (
            <button
              type="button"
              onClick={handleDomainSearch}
              disabled={!searchQuery.trim()}
              className="px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Search
            </button>
          )}
          {(selectedClient || directDomain) && (
            <button
              type="button"
              onClick={() => {
                setSelectedClientId(null);
                setDirectDomain(null);
                setOverview(null);
              }}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              New search
            </button>
          )}
        </div>

        {(selectedClient || directDomain) && (
          <div className="px-4 py-4 flex flex-wrap items-center justify-between gap-3 bg-white border-b border-gray-100 border-l-4 border-l-primary-500">
            <h2 className="text-xl font-semibold text-gray-900">
              Domain Overview for {activeDomain || selectedClient?.name || ""} /
            </h2>
          </div>
        )}
      </div>

      {clientsError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {clientsError}
        </div>
      )}

      {!selectedClientId && !directDomain && (
        <div className="bg-amber-50/60 rounded-xl border border-amber-200/80 border-l-4 border-l-amber-500 shadow-sm p-12 text-center">
          <Globe className="mx-auto h-12 w-12 text-amber-400" />
          <p className="mt-4 text-gray-600">
            Enter any domain or URL above and press Search to analyze it. Works for any website — clients, competitors, or any domain.
          </p>
        </div>
      )}

      {(selectedClientId || directDomain) && loading && !overview && (
        <div className="bg-primary-50/60 rounded-xl border border-primary-200/80 border-l-4 border-l-primary-500 shadow-sm p-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      )}

      {(selectedClientId || directDomain) && error && !overview && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      )}

      {overview && (
        <div className="flex flex-col gap-10">
          {/* Section: AI Search & SEO cards - professional layout, equal visual weight */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* AI Search card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-6 py-3.5 bg-gradient-to-r from-purple-600 to-purple-500 text-white">
                <h3 className="text-base font-semibold tracking-tight">AI Search</h3>
                <span className="text-xs font-medium text-purple-100 bg-white/10 px-2.5 py-1 rounded-md">Today</span>
              </div>
              <div className="p-5">
                {aiSearchError && <p className="mb-4 text-sm text-rose-600">{aiSearchError}</p>}

                <div className="grid grid-cols-3 gap-4 mb-5">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50/80">
                    <div className="flex-shrink-0 w-12 h-12">
                      <svg viewBox="0 0 100 50" className="w-full h-full -rotate-90">
                        <path d="M 10 40 A 40 40 0 0 1 90 40" fill="none" stroke="#E5E7EB" strokeWidth="6" strokeLinecap="round" />
                        <path
                          d="M 10 40 A 40 40 0 0 1 90 40"
                          fill="none"
                          stroke="#F97316"
                          strokeWidth="6"
                          strokeLinecap="round"
                          strokeDasharray={Math.PI * 40}
                          strokeDashoffset={Math.PI * 40 * (1 - Math.min(1, (aiSearchKpis.aiVisibilityScore ?? 0) / 100))}
                        />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">AI Visibility</p>
                      <p className="text-xl font-bold text-blue-600 tabular-nums">{aiSearchKpis.aiVisibilityScore}</p>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-gray-50/80">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Mentions</p>
                    <p className="mt-1 text-xl font-bold text-blue-600 tabular-nums">{formatCompactNumber(aiSearchKpis.totalAiMentions)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-gray-50/80">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Cited Pages</p>
                    <p className="mt-1 text-xl font-bold text-blue-600 tabular-nums">
                      {formatCompactNumber(aiSearchPlatforms.reduce((s, p) => s + p.aiSearchVol, 0))}
                    </p>
                  </div>
                </div>

                {loading ? (
                  <div className="pt-4 border-t border-gray-100 text-sm text-gray-500">Loading AI Search visibility...</div>
                ) : aiSearchPlatforms.length === 0 ? (
                  <div className="pt-4 border-t border-gray-100 text-sm text-gray-500">No AI Search visibility data available.</div>
                ) : (
                  <div className="pt-4 border-t border-gray-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 font-medium text-xs">
                          <th className="pb-2">Source</th>
                          <th className="pb-2 text-right">Mentions</th>
                          <th className="pb-2 text-right">Cited Pages</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {([
                          { name: "ChatGPT", dotClass: "bg-gray-800" },
                          { name: "AI Overview", dotClass: "bg-blue-600" },
                          { name: "AI Mode", dotClass: "bg-red-500" },
                          { name: "Gemini", dotClass: "bg-emerald-500" },
                        ] as const).map((meta) => {
                          const p = aiSearchPlatforms.find((r) => r.platform === meta.name) ?? { platform: meta.name, mentions: 0, aiSearchVol: 0 };
                          return (
                            <tr key={meta.name} className="group">
                              <td className="py-2.5 font-medium text-gray-800 flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-sm ${meta.dotClass} flex-shrink-0`} aria-hidden />
                                {meta.name}
                              </td>
                              <td className="py-2.5 text-right text-blue-600 font-semibold tabular-nums">{formatCompactNumber(p.mentions)}</td>
                              <td className="py-2.5 text-right text-blue-600 font-semibold tabular-nums">{formatCompactNumber(p.aiSearchVol)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* SEO card - compact layout, no bottom white space */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 bg-gray-50/50">
                <span className="inline-flex items-center px-4 py-1.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-400 shadow-sm">
                  SEO
                </span>
              </div>
              <div className="p-5 grid grid-cols-4 gap-4">
                {[
                  { label: "Authority Score", value: overview.metrics.authorityScore ?? "—", format: (v: number | string) => (typeof v === "number" ? String(v) : v), tooltip: "Domain authority based on backlink profile" },
                  { label: "Organic Traffic", value: overview.metrics.organicSearch.traffic, format: (v: number) => formatCompactNumber(v), tooltip: "Estimated organic search traffic" },
                  { label: "Paid Traffic", value: overview.metrics.paidSearch.traffic, format: (v: number) => formatCompactNumber(v), tooltip: "Paid search traffic" },
                  { label: "Ref. Domains", value: overview.metrics.backlinks.referringDomains, format: (v: number) => formatCompactNumber(v), tooltip: "Number of referring domains" },
                  { label: "Traffic Share", value: overview.metrics.trafficShare, format: (v: number | null | undefined) => (v != null ? `${v}%` : "—"), tooltip: "Organic traffic as % of total", icon: true },
                  { label: "Organic Keywords", value: overview.metrics.organicSearch.keywords, format: (v: number) => formatCompactNumber(v), tooltip: "Organic keywords ranking" },
                  { label: "Paid Keywords", value: overview.metrics.paidSearch.keywords, format: (v: number) => formatCompactNumber(v), tooltip: "Paid keywords" },
                  { label: "Backlinks", value: overview.metrics.backlinks.totalBacklinks, format: (v: number) => formatCompactNumber(v), tooltip: "Total backlinks" },
                ].map((m, i) => (
                  <div key={m.label} className={`flex flex-col p-3 rounded-lg bg-gray-50/80 ${i % 4 < 3 ? "border-r-0" : ""}`}>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider inline-flex items-center gap-1">
                      {m.label}
                      <span title={m.tooltip}><Info className="h-3 w-3 text-gray-400 cursor-help flex-shrink-0" aria-hidden /></span>
                      {m.icon && <PieChartIcon className="h-3 w-3 text-gray-400 flex-shrink-0" aria-hidden />}
                    </p>
                    <p className="mt-1.5 text-lg font-bold text-blue-600 tabular-nums">
                      {typeof m.value === "number" ? m.format(m.value) : m.format(m.value as string)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Section: AI Search detail - match reference: tabs, time range, Distribution by Country, Traffic, Top Cited Sources, Keywords, SERP */}
          <section>
          <div ref={aiSearchSectionRef} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-gray-200 bg-gray-50/50">
              <div className="flex items-center gap-1">
                <button type="button" className="px-4 py-2 rounded-t-lg bg-blue-600 text-white text-sm font-medium">
                  AI Search
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  {(["1M", "6M", "1Y", "2Y", "All time"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setAiSearchTimeRange(r === "All time" ? "All" : r)}
                      className={`px-3 py-1.5 text-sm font-medium ${aiSearchTimeRange === (r === "All time" ? "All" : r) ? "bg-white border-b-2 border-blue-600 text-blue-600" : "text-gray-600 hover:bg-gray-100"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setAiSearchGranularity("Days")}
                    className={`px-3 py-1.5 text-sm font-medium ${aiSearchGranularity === "Days" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}
                  >
                    Days
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiSearchGranularity("Months")}
                    className={`px-3 py-1.5 text-sm font-medium ${aiSearchGranularity === "Months" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}
                  >
                    Months
                  </button>
                </div>
                <button
                  type="button"
                  onClick={exportAiSearchToPdf}
                  disabled={aiSearchExportingPdf}
                  data-pdf-hide="true"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {aiSearchExportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Export PDF
                </button>
              </div>
            </div>
            <div className="p-6 grid grid-cols-1 lg:grid-cols-[30%_1fr] gap-6">
              {/* Left panel: 30% - Distribution by Country, Top Cited Sources, Google SERP Positions Distribution */}
              <div className="flex flex-col gap-6">
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Distribution by Country</h4>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Countries</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Visibility</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Mentions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        <tr className="bg-gray-50 hover:bg-gray-100">
                          <td className="px-4 py-2 text-gray-900">Worldwide</td>
                          <td className="px-4 py-2 text-gray-900">{aiSearchKpis.aiVisibilityScore}</td>
                          <td className="px-4 py-2 text-blue-600 font-medium">{aiSearchKpis.totalAiMentions}</td>
                        </tr>
                        {(aiSearch?.distributionByCountry ?? []).map((c, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900">{c.countryCode}</td>
                            <td className="px-4 py-2 text-gray-900">{c.visibility}</td>
                            <td className="px-4 py-2 text-blue-600 font-medium">{c.mentions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {(aiSearchKpis.aiVisibilityScore === 0 && aiSearchKpis.totalAiMentions === 0 && (aiSearch?.distributionByCountry ?? []).length === 0) && (
                    <p className="mt-2 text-xs text-gray-500">Connect GA4 and run AI Search visibility on the client dashboard to see country metrics.</p>
                  )}
                </div>
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                      Top Cited Sources
                      <span className="text-base" title="US">🇺🇸</span>
                    </h4>
                    <button
                      type="button"
                      onClick={fetchCitedSources}
                      disabled={citedSourcesLoading}
                      data-pdf-hide="true"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {citedSourcesLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {citedSourcesLoading ? "Loading…" : "Load cited sources"}
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Domain</th>
                          <th className="px-4 py-2 text-right font-medium text-gray-700">Mentions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {(aiSearch?.topCitedSources ?? []).map((s, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-900">{s.domain}</td>
                            <td className="px-4 py-2 text-right text-blue-600 font-medium">{s.mentions}</td>
                          </tr>
                        ))}
                        {(aiSearch?.topCitedSources ?? []).length === 0 && !citedSourcesLoading && (
                          <tr><td colSpan={2} className="px-4 py-2 text-gray-500">No data</td></tr>
                        )}
                        {(aiSearch?.topCitedSources ?? []).length === 0 && citedSourcesLoading && (
                          <tr><td colSpan={2} className="px-4 py-4 text-center text-gray-500">Fetching cited domains from SERP data…</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Google SERP Positions Distribution</h4>
                  <div className="h-48 flex items-center justify-center">
                    {(() => {
                      const organic = (overview.positionDistribution?.top3 ?? 0) + (overview.positionDistribution?.top10 ?? 0) + (overview.positionDistribution?.page2 ?? 0) + (overview.positionDistribution?.pos21_30 ?? 0) + (overview.positionDistribution?.pos31_50 ?? 0) + (overview.positionDistribution?.pos51Plus ?? 0);
                      const ai = aiSearchKpis.totalAiMentions;
                      const otherSerpCheck = aiSearch?.otherSerpFeaturesCount ?? 0;
                      if (organic === 0 && ai === 0 && otherSerpCheck === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center text-gray-500 text-sm">
                            <span>No data</span>
                            <span className="text-xs mt-1">Refresh ranked keywords on the client dashboard</span>
                          </div>
                        );
                      }
                      const otherSerp = aiSearch?.otherSerpFeaturesCount ?? 0;
                      const serpPieData = [
                        { name: "Organic", value: organic || 1, fill: "#3B82F6" },
                        ...(ai > 0 ? [{ name: "AI Overviews", value: ai, fill: "#8B5CF6" }] : []),
                        ...(otherSerp > 0 ? [{ name: "Other SERP Features", value: otherSerp, fill: "#22C55E" }] : []),
                      ].filter((d) => d.value > 0);
                      const serpData = serpPieData.length ? serpPieData : [{ name: "Organic", value: 1, fill: "#3B82F6" }];
                      return (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={serpData}
                              cx="50%"
                              cy="50%"
                              innerRadius={35}
                              outerRadius={55}
                              paddingAngle={2}
                              dataKey="value"
                              nameKey="name"
                              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                            >
                              {serpData.map((d, i) => (
                                <Cell key={i} fill={d.fill} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Right panel: 70% - Traffic and Keywords */}
              <div className="flex flex-col gap-6">
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Traffic</h4>
                  <div className="flex flex-wrap gap-4 mb-2">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={trafficOrganic} onChange={(e) => setTrafficOrganic(e.target.checked)} className="rounded border-gray-300 focus:ring-2 focus:ring-offset-1" style={{ accentColor: "#3B82F6" }} />
                      <span className="text-sm text-blue-600 font-medium">Organic Traffic</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={trafficPaid} onChange={(e) => setTrafficPaid(e.target.checked)} className="rounded border-gray-300 focus:ring-2 focus:ring-offset-1" style={{ accentColor: "#F97316" }} />
                      <span className="text-sm text-orange-500 font-medium">Paid Traffic</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={trafficBranded} onChange={(e) => setTrafficBranded(e.target.checked)} className="rounded border-gray-300 focus:ring-2 focus:ring-offset-1" style={{ accentColor: "#22C55E" }} />
                      <span className="text-sm text-green-600 font-medium">Branded Traffic</span>
                    </label>
                    <select className="ml-auto text-sm border border-gray-200 rounded px-2 py-1 text-gray-600 bg-white">
                      <option>Notes</option>
                    </select>
                  </div>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trafficChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <XAxis dataKey={aiSearchGranularity === "Months" ? "monthShort" : "dayLabel"} tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const row = payload[0]?.payload;
                            if (!row) return null;
                            const items = [
                              { key: "Organic Traffic", val: row.traffic ?? 0, color: "#3B82F6" },
                              { key: "Paid Traffic", val: row.trafficPaid ?? 0, color: "#F97316" },
                              { key: "Branded Traffic", val: row.trafficBranded ?? 0, color: "#22C55E" },
                            ];
                            const total = items.reduce((s, i) => s + i.val, 0);
                            return (
                              <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4 min-w-[200px]">
                                <p className="text-sm font-medium text-gray-900 mb-3">{row.monthFull ?? row.month}</p>
                                <div className="space-y-2">
                                  {items.map(({ key, val, color }) => (
                                    <div key={key} className="flex items-center justify-between gap-4">
                                      <span className="flex items-center gap-2 text-sm text-gray-700">
                                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                                        {key}
                                      </span>
                                      <span className="text-sm font-bold text-gray-900 tabular-nums">{val.toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-3 pt-2 border-t border-gray-200 flex items-center justify-between">
                                  <span className="text-sm font-medium text-gray-700">Total</span>
                                  <span className="text-sm font-bold text-gray-900 tabular-nums">{total.toLocaleString()}</span>
                                </div>
                              </div>
                            );
                          }}
                        />
                        {trafficOrganic && <Line type="monotone" dataKey="traffic" stroke="#3B82F6" strokeWidth={2} name="Organic Traffic" dot={{ r: 2 }} />}
                        {trafficPaid && <Line type="monotone" dataKey="trafficPaid" stroke="#F97316" strokeWidth={2} name="Paid Traffic" dot={{ r: 2 }} />}
                        {trafficBranded && <Line type="monotone" dataKey="trafficBranded" stroke="#22C55E" strokeWidth={2} name="Branded Traffic" dot={{ r: 2 }} />}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {trafficChartData.every((d) => (d.traffic ?? 0) === 0 && (d.trafficPaid ?? 0) === 0 && (d.trafficBranded ?? 0) === 0) && (
                    <p className="mt-2 text-xs text-gray-500">Connect traffic sources and refresh ranked keywords on the client dashboard for trends.</p>
                  )}
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Keywords</h4>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                      <button type="button" onClick={() => setKeywordsTab("Organic")} className={`px-3 py-1.5 text-sm font-medium ${keywordsTab === "Organic" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>Organic</button>
                      <button type="button" onClick={() => setKeywordsTab("Paid")} className={`px-3 py-1.5 text-sm font-medium ${keywordsTab === "Paid" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>Paid</button>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {keywordsTab === "Organic" ? (
                        (["top3", "4-10", "11-20", "21-50", "51-100", "aiOverviews", "otherSerp"] as const).map((key) => {
                          const accentColor = { top3: "#FACC15", "4-10": "#3B82F6", "11-20": "#22C55E", "21-50": "#F97316", "51-100": "#94A3B8", aiOverviews: "#8B5CF6", otherSerp: "#22C55E" }[key];
                          return (
                            <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox" checked={keywordRanges[key]} onChange={(e) => setKeywordRanges((prev) => ({ ...prev, [key]: e.target.checked }))} className="rounded border-gray-300 focus:ring-2 focus:ring-offset-1" style={{ accentColor }} />
                              <span className="text-xs text-gray-700">{key === "top3" ? "Top 3" : key === "4-10" ? "4-10" : key === "11-20" ? "11-20" : key === "21-50" ? "21-50" : key === "51-100" ? "51-100" : key === "aiOverviews" ? "AI Overviews" : "Other SERP Features"}</span>
                            </label>
                          );
                        })
                      ) : (
                        (["1-4", "5-10", "11-20", "21+"] as const).map((key) => {
                          const accentColor = { "1-4": "#FACC15", "5-10": "#3B82F6", "11-20": "#22C55E", "21+": "#F97316" }[key];
                          return (
                            <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox" checked={keywordRangesPaid[key]} onChange={(e) => setKeywordRangesPaid((prev) => ({ ...prev, [key]: e.target.checked }))} className="rounded border-gray-300 focus:ring-2 focus:ring-offset-1" style={{ accentColor }} />
                              <span className="text-xs text-gray-700">{key}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="h-56">
                  {keywordsTab === "Organic" ? (
                    keywordsStackData.length > 0 && keywordsStackData.some((m) => ((m["Top 3"] ?? 0) + (m["4-10"] ?? 0) + (m["11-20"] ?? 0) + (m["21-50"] ?? 0) + (m["51-100"] ?? 0)) > 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={keywordsStackData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <XAxis dataKey={aiSearchGranularity === "Months" ? "month" : "dayLabel"} tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length || !label) return null;
                          const row = payload[0]?.payload;
                          if (!row) return null;
                          const items = [
                            { key: "Top 3", val: row["Top 3"] ?? 0, color: "#FACC15" },
                            { key: "4-10", val: row["4-10"] ?? 0, color: "#3B82F6" },
                            { key: "11-20", val: row["11-20"] ?? 0, color: "#22C55E" },
                            { key: "21-50", val: row["21-50"] ?? 0, color: "#F97316" },
                            { key: "51-100", val: row["51-100"] ?? 0, color: "#94A3B8" },
                            { key: "AI Overviews", val: row["AI Overviews"] ?? 0, color: "#8B5CF6" },
                            { key: "Other SERP Features", val: row["Other SERP Features"] ?? 0, color: "#22C55E" },
                          ];
                          const total = items.reduce((s, i) => s + i.val, 0);
                          return (
                            <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4 min-w-[200px]">
                              <p className="text-sm font-medium text-gray-900 mb-3">{row.monthFull ?? label}</p>
                              <div className="space-y-2">
                                {items.map(({ key, val, color }) => (
                                  <div key={key} className="flex items-center justify-between gap-4">
                                    <span className="flex items-center gap-2 text-sm text-gray-700">
                                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                                      {key}
                                    </span>
                                    <span className="text-sm font-bold text-gray-900 tabular-nums">{val.toLocaleString()}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-3 pt-2 border-t border-gray-200 flex items-center justify-between">
                                <span className="text-sm font-medium text-gray-700">Total</span>
                                <span className="text-sm font-bold text-gray-900 tabular-nums">{total.toLocaleString()}</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      {keywordRanges.top3 && <Area type="monotone" dataKey="Top 3" stackId="1" stroke="#FACC15" fill="#FACC15" fillOpacity={0.8} />}
                      {keywordRanges["4-10"] && <Area type="monotone" dataKey="4-10" stackId="1" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.8} />}
                      {keywordRanges["11-20"] && <Area type="monotone" dataKey="11-20" stackId="1" stroke="#22C55E" fill="#22C55E" fillOpacity={0.8} />}
                      {keywordRanges["21-50"] && <Area type="monotone" dataKey="21-50" stackId="1" stroke="#F97316" fill="#F97316" fillOpacity={0.8} />}
                      {keywordRanges["51-100"] && <Area type="monotone" dataKey="51-100" stackId="1" stroke="#94A3B8" fill="#94A3B8" fillOpacity={0.8} />}
                      {keywordRanges.aiOverviews && <Area type="monotone" dataKey="AI Overviews" stackId="1" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.8} />}
                      {keywordRanges.otherSerp && <Area type="monotone" dataKey="Other SERP Features" stackId="1" stroke="#22C55E" fill="#22C55E" fillOpacity={0.6} />}
                    </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
                      <span>No keyword position history yet</span>
                      <span className="text-xs mt-1">Refresh ranked keywords on the client dashboard to see trends</span>
                    </div>
                  )
                  ) : (
                    keywordsStackDataPaid.length > 0 && keywordsStackDataPaid.some((m) => ((m["1-4"] ?? 0) + (m["5-10"] ?? 0) + (m["11-20"] ?? 0) + (m["21+"] ?? 0)) > 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={keywordsStackDataPaid} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <XAxis dataKey={aiSearchGranularity === "Months" ? "month" : "dayLabel"} tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length || !label) return null;
                          const row = payload[0]?.payload;
                          if (!row) return null;
                          const items = [
                            { key: "1-4", val: row["1-4"] ?? 0, color: "#FACC15" },
                            { key: "5-10", val: row["5-10"] ?? 0, color: "#3B82F6" },
                            { key: "11-20", val: row["11-20"] ?? 0, color: "#22C55E" },
                            { key: "21+", val: row["21+"] ?? 0, color: "#F97316" },
                          ];
                          const total = items.reduce((s, i) => s + i.val, 0);
                          return (
                            <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4 min-w-[200px]">
                              <p className="text-sm font-medium text-gray-900 mb-3">{row.monthFull ?? label}</p>
                              <div className="space-y-2">
                                {items.map(({ key, val, color }) => (
                                  <div key={key} className="flex items-center justify-between gap-4">
                                    <span className="flex items-center gap-2 text-sm text-gray-700">
                                      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                                      {key}
                                    </span>
                                    <span className="text-sm font-bold text-gray-900 tabular-nums">{val.toLocaleString()}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-3 pt-2 border-t border-gray-200 flex items-center justify-between">
                                <span className="text-sm font-medium text-gray-700">Total</span>
                                <span className="text-sm font-bold text-gray-900 tabular-nums">{total.toLocaleString()}</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      {keywordRangesPaid["1-4"] && <Area type="monotone" dataKey="1-4" stackId="1" stroke="#FACC15" fill="#FACC15" fillOpacity={0.8} />}
                      {keywordRangesPaid["5-10"] && <Area type="monotone" dataKey="5-10" stackId="1" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.8} />}
                      {keywordRangesPaid["11-20"] && <Area type="monotone" dataKey="11-20" stackId="1" stroke="#22C55E" fill="#22C55E" fillOpacity={0.8} />}
                      {keywordRangesPaid["21+"] && <Area type="monotone" dataKey="21+" stackId="1" stroke="#F97316" fill="#F97316" fillOpacity={0.8} />}
                    </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
                      <span>No paid keyword data yet</span>
                      <span className="text-xs mt-1">Connect Google Ads to see paid search position trends</span>
                    </div>
                  )
                  )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          </section>

          {/* Section: Organic Research - match reference: header US, Top Organic Keywords, Key Topics, Keywords by Intent, Position Distribution, Competitors, Map */}
          <section>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden border-l-4 border-l-primary-500">
            <div className="px-6 py-4 bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 flex items-center gap-2">
              <h3 className="text-base font-semibold text-white">Organic Research</h3>
              <Globe className="h-4 w-4 text-white/90" />
              <span className="text-sm font-medium text-white/90">US</span>
            </div>
            <div className="p-6 space-y-6 bg-primary-50/20">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="overflow-hidden rounded-lg border border-gray-200 border-l-4 border-l-blue-500 bg-blue-50/40">
                  <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gradient-to-r from-blue-50 to-white flex items-center justify-between">
                    Top Organic Keywords {(overview.topOrganicKeywords?.length ?? 0).toLocaleString()}
                  </h4>
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gradient-to-r from-blue-100 to-indigo-100 sticky top-0">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-800">Keyword</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-800">
                            <span className="inline-flex items-center gap-0.5">Intent <ChevronUp className="h-3 w-3" /><ChevronDown className="h-3 w-3" /></span>
                          </th>
                          <th className="px-4 py-2 text-left font-medium text-gray-800">Pos.</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-800">Volume</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-800">CPC (U...)</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-800">
                            <span className="inline-flex items-center gap-0.5">Traffic <ChevronUp className="h-3 w-3" /><ChevronDown className="h-3 w-3" /></span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white/80">
                        {(overview.topOrganicKeywords?.length ?? 0) === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No keywords yet</td></tr>
                        ) : (
                          (overview.topOrganicKeywords ?? []).slice(0, 10).map((k, i) => (
                            <tr key={i} className="hover:bg-blue-50/50">
                              <td className="px-4 py-2">
                                <a
                                  href={k.url ? (k.url.startsWith("http") ? k.url : `https://${k.url}`) : `https://www.google.com/search?q=${encodeURIComponent(k.keyword)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-blue-600 hover:text-indigo-700 hover:underline truncate max-w-[200px]"
                                  title={k.keyword}
                                >
                                  <FileText className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                                  <span className="truncate">{k.keyword}</span>
                                </a>
                              </td>
                              <td className="px-4 py-2">
                                <span className="inline-flex w-6 h-6 items-center justify-center rounded bg-gray-100 text-xs font-medium text-gray-500">—</span>
                              </td>
                              <td className="px-4 py-2 text-gray-600 tabular-nums">{k.position}</td>
                              <td className="px-4 py-2 text-gray-600 tabular-nums">{k.volume != null ? formatCompactNumber(k.volume) : "—"}</td>
                              <td className="px-4 py-2 text-gray-600 tabular-nums">{k.cpc != null ? k.cpc.toFixed(2) : "0.00"}</td>
                              <td className="px-4 py-2 text-gray-600 tabular-nums">{k.trafficPercent != null ? k.trafficPercent.toFixed(2) : "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 border-t border-gray-100">
                    <button type="button" onClick={() => setTopKeywordsModalOpen(true)} className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium hover:from-blue-700 hover:to-indigo-700 shadow-sm">
                      View details
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 border-l-4 border-l-purple-500 overflow-hidden bg-gradient-to-b from-purple-50/60 to-white">
                  <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gradient-to-r from-purple-50 to-white flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-500" />
                    Key Topics
                  </h4>
                  <div className="p-4 grid grid-cols-2 gap-3">
                    {intentData.map((d, i) => (
                      <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                          <span className="text-sm font-semibold text-gray-900">{d.intent}</span>
                        </div>
                        <div className="text-xs text-gray-600 space-y-1">
                          <p>{d.keywords.toLocaleString()} Keywords</p>
                          <p>{d.traffic.toLocaleString()} Traffic</p>
                        </div>
                        <p className="mt-2 text-xs font-medium text-blue-600">{d.pct}%</p>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                    <p className="text-xs text-gray-600">View {overview.client?.domain ?? "this domain"} key topics</p>
                    <button
                      type="button"
                      onClick={() => onGetTopics?.(overview.client?.domain ?? "")}
                      className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 shadow-sm"
                    >
                      Get topics
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-lg border border-gray-200 border-l-4 border-l-teal-500 overflow-hidden bg-teal-50/40">
                  <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gradient-to-r from-teal-50 to-white">Keywords by Intent</h4>
                  <div className="p-4">
                    <div className="h-8 w-full flex rounded overflow-hidden mb-4">
                      {intentData.map((d, i) => (
                        <div key={i} className="h-full" style={{ width: `${d.pct}%`, backgroundColor: d.fill, opacity: 0.9 }} title={`${d.intent} ${d.pct}%`} />
                      ))}
                    </div>
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 font-medium border-b border-gray-100">
                          <th className="pb-2">Intent</th>
                          <th className="pb-2">Keywords</th>
                          <th className="pb-2">Traffic</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {intentData.map((d, i) => (
                          <tr key={i}>
                            <td className="py-2 flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                              <span className="text-gray-900">{d.intent}</span>
                              <span className="text-blue-600 font-medium">{typeof d.pct === "number" ? d.pct.toFixed(1) : d.pct}%</span>
                            </td>
                            <td className="py-2 text-gray-900 tabular-nums">{d.keywords}</td>
                            <td className="py-2 text-gray-900 tabular-nums">{d.traffic}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 border-t border-gray-100">
                    <button type="button" onClick={() => setIntentModalOpen(true)} className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 shadow-sm">
                      View details
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 border-l-4 border-l-indigo-500 overflow-hidden bg-indigo-50/40">
                  <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gradient-to-r from-indigo-50 to-white">Organic Position Distribution</h4>
                  <div className="p-4 min-h-[200px] h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={positionBarDataOrganic} margin={{ top: 8, right: 24, left: 0, bottom: 24 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} label={{ value: "Positions on Google SERP", position: "bottom", offset: 0, style: { fontSize: 11, fill: "#6b7280" } }} />
                        <YAxis type="number" domain={[0, positionBarYMax]} ticks={[0, Math.round(positionBarYMax / 2), positionBarYMax]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(_value: number, _name: string, props: any) => [`${props.payload.pct}%`, props.payload.name]} />
                        <Bar dataKey="pct" radius={[4, 4, 0, 0]} fill="#3B82F6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-lg border border-gray-200 border-l-4 border-l-amber-500 overflow-hidden bg-amber-50/40">
                  <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gradient-to-r from-amber-50 to-white">
                    Main Organic Competitors {(overview.totalCompetitorsCount ?? overview.organicCompetitors?.length ?? 0).toLocaleString() || "—"}
                  </h4>
                  {(overview.organicCompetitors?.length ?? 0) > 0 ? (
                    <>
                      <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                          <thead className="bg-gradient-to-r from-amber-100 to-orange-100 sticky top-0">
                            <tr>
                              <th className="px-4 py-2 text-left font-medium text-gray-800">Competitor</th>
                              <th className="px-4 py-2 text-left font-medium text-gray-800">
                                <span className="inline-flex items-center gap-1">Com. Level <Filter className="h-3 w-3 text-gray-500" /></span>
                              </th>
                              <th className="px-4 py-2 text-right font-medium text-gray-800">Com. Keywords</th>
                              <th className="px-4 py-2 text-right font-medium text-gray-800">SE Keywords</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 bg-white/80">
                            {overview.organicCompetitors!.map((c, i) => (
                              <tr key={i} className="hover:bg-amber-50/50">
                                <td className="px-4 py-2">
                                  <a href={`https://${c.competitor}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                                    {c.competitor}
                                    <ExternalLink className="h-3 w-3 flex-shrink-0 text-gray-400" />
                                  </a>
                                </td>
                                <td className="px-4 py-2">
                                  <div className="w-20 h-2 bg-gray-200 rounded overflow-hidden">
                                    <div className="h-full bg-blue-500 rounded" style={{ width: `${c.comLevel}%` }} />
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-right">
                                  <span className="text-blue-600 tabular-nums">{c.comKeywords.toLocaleString()}</span>
                                </td>
                                <td className="px-4 py-2 text-right">
                                  <span className="text-blue-600 tabular-nums">{c.seKeywords.toLocaleString()}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="px-4 py-3 border-t border-gray-100">
                        <button type="button" onClick={() => setCompetitorsModalOpen(true)} className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 shadow-sm">
                          View details
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="p-8 text-center text-gray-500 text-sm">Find your direct competitors</div>
                  )}
                </div>
                <div className="rounded-lg border border-gray-200 border-l-4 border-l-emerald-500 overflow-hidden bg-emerald-50/40">
                  <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gradient-to-r from-emerald-50 to-white">Competitive Positioning Map</h4>
                  <div className="p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mb-3 text-xs">
                      {competitorMapData.map((d, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                          <span className="text-gray-600 truncate max-w-[100px]" title={(d as { name?: string }).name ?? ""}>{(d as { displayName?: string; name?: string }).displayName ?? (d as { name?: string }).name ?? ""}</span>
                        </span>
                      ))}
                    </div>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 8, right: 24, left: 24, bottom: 32 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis type="number" dataKey="keywords" name="Organic Keywords" domain={[0, "auto"]} tick={{ fontSize: 10 }} tickFormatter={(v) => formatCompactNumber(v)} label={{ value: "Organic Keywords", position: "bottom", offset: 20, style: { fontSize: 11, fill: "#6b7280" } }} />
                          <YAxis type="number" dataKey="traffic" name="Organic Search Traffic" domain={[0, "auto"]} tick={{ fontSize: 10 }} tickFormatter={(v) => formatCompactNumber(v)} label={{ value: "Organic Search Traffic", angle: -90, position: "insideLeft", offset: 0, style: { fontSize: 11, fill: "#6b7280" } }} />
                          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
                            if (!active || !payload?.[0]) return null;
                            const p = payload[0].payload as { name?: string; keywords?: number; traffic?: number };
                            return (
                              <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-sm">
                                <p className="font-medium text-gray-900 mb-1">{p.name ?? ""}</p>
                                <p className="text-gray-600">Organic Keywords: {formatCompactNumber(p.keywords ?? 0)}</p>
                                <p className="text-gray-600">Organic Search Traffic: {formatCompactNumber(p.traffic ?? 0)}</p>
                              </div>
                            );
                          }} />
                          {competitorMapData.map((entry, index) => (
                            <Scatter key={index} data={[entry]} fill={entry.fill} shape="circle" />
                          ))}
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </section>

          {/* Section: Advertising Research - real data */}
          <section>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden border-l-4 border-l-emerald-500">
            <div className="px-6 py-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600">
              <h3 className="text-base font-semibold text-white">
                Advertising Research
              </h3>
            </div>
            <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 bg-emerald-50/20">
              <div className="rounded-lg border border-gray-200 border-l-4 border-l-cyan-500 overflow-hidden bg-cyan-50/40">
                <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gradient-to-r from-cyan-50 to-white">
                  Top Paid Keywords {(overview.topPaidKeywords?.length ?? 0).toLocaleString()}
                </h4>
                {(overview.topPaidKeywords?.length ?? 0) > 0 ? (
                  <>
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gradient-to-r from-cyan-100 to-teal-100 sticky top-0">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium text-gray-800">Keyword</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-800">Clicks</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-800">Impr.</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-800">Cost</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-800">CTR %</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white/80">
                          {(overview.topPaidKeywords ?? []).slice(0, 10).map((k, i) => (
                            <tr key={i} className="hover:bg-cyan-50/50">
                              <td className="px-4 py-2 text-gray-900 truncate max-w-[180px]">{k.keyword}</td>
                              <td className="px-4 py-2 text-right text-gray-600 tabular-nums">{k.clicks.toLocaleString()}</td>
                              <td className="px-4 py-2 text-right text-gray-600 tabular-nums">{k.impressions.toLocaleString()}</td>
                              <td className="px-4 py-2 text-right text-gray-600 tabular-nums">${k.cost.toFixed(2)}</td>
                              <td className="px-4 py-2 text-right text-gray-600 tabular-nums">{k.ctr.toFixed(2)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-4 py-3 border-t border-gray-100">
                      <span className="text-xs text-gray-500">Data from Google Ads (last 30 days)</span>
                    </div>
                  </>
                ) : (
                  <div className="p-8 text-center text-gray-500 text-sm">
                    <p>Connect Google Ads to see paid keywords.</p>
                    <p className="text-xs mt-1">Go to Client Settings → Integrations → Google Ads</p>
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 border-l-4 border-l-teal-500 overflow-hidden bg-teal-50/40">
                <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gradient-to-r from-teal-50 to-white">Paid Position Distribution</h4>
                {overview.paidPositionDistribution && (overview.paidPositionDistribution.top4 + overview.paidPositionDistribution.top10 + overview.paidPositionDistribution.page2 + overview.paidPositionDistribution.pos21Plus) > 0 ? (
                  <div className="p-4 h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[
                          { name: "1-4", pct: overview.paidPositionDistribution.top4Pct, fill: "#F97316" },
                          { name: "5-10", pct: overview.paidPositionDistribution.top10Pct, fill: "#F97316" },
                          { name: "11-20", pct: overview.paidPositionDistribution.page2Pct, fill: "#F97316" },
                          { name: "21+", pct: overview.paidPositionDistribution.pos21PlusPct, fill: "#F97316" },
                        ]}
                        margin={{ top: 8, right: 24, left: 0, bottom: 24 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis type="number" domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(_v: number, _n: string, props: any) => [`${props.payload.pct}%`, props.payload.name]} />
                        <Bar dataKey="pct" radius={[4, 4, 0, 0]} fill="#F97316" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="p-8 text-center text-gray-500 text-sm">No paid position data yet</div>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 border-l-4 border-l-orange-500 overflow-hidden bg-orange-50/40">
                <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gradient-to-r from-orange-50 to-white">
                  Main Paid Competitors {(overview.totalPaidCompetitorsCount ?? overview.mainPaidCompetitors?.length ?? 0).toLocaleString() || "—"}
                </h4>
                {(overview.mainPaidCompetitors?.length ?? 0) > 0 ? (
                  <>
                    <div className="overflow-x-auto max-h-48 overflow-y-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gradient-to-r from-orange-100 to-amber-100 sticky top-0">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium text-gray-800">Competitor</th>
                            <th className="px-4 py-2 text-left font-medium text-gray-800">Com. Level</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-800">Com. Keywords</th>
                            <th className="px-4 py-2 text-right font-medium text-gray-800">SE Keywords</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white/80">
                          {(overview.mainPaidCompetitors ?? []).slice(0, 8).map((c, i) => (
                            <tr key={i} className="hover:bg-orange-50/50">
                              <td className="px-4 py-2">
                                <a href={`https://${c.competitor}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                                  {c.competitor}
                                  <ExternalLink className="h-3 w-3 flex-shrink-0 text-gray-400" />
                                </a>
                              </td>
                              <td className="px-4 py-2">
                                <div className="w-16 h-2 bg-gray-200 rounded overflow-hidden">
                                  <div className="h-full bg-orange-500 rounded" style={{ width: `${c.comLevel}%` }} />
                                </div>
                              </td>
                              <td className="px-4 py-2 text-right text-gray-600 tabular-nums">{c.comKeywords.toLocaleString()}</td>
                              <td className="px-4 py-2 text-right text-blue-600 tabular-nums">{c.seKeywords.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="p-8 text-center text-gray-500 text-sm">No paid competitor data</div>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 border-l-4 border-l-emerald-500 overflow-hidden bg-emerald-50/40">
                <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gradient-to-r from-emerald-50 to-white">Paid Competitive Map</h4>
                <div className="p-4">
                  <div className="h-48 flex items-center justify-center">
                    {overview.metrics.paidSearch.keywords > 0 || (overview.topPaidKeywords?.length ?? 0) > 0 ? (
                      <div className="text-center text-sm text-gray-600">
                        <p className="font-medium text-gray-900">{overview.metrics.paidSearch.keywords || overview.topPaidKeywords?.length} paid keywords</p>
                        <p className="mt-1">{formatCompactNumber(overview.metrics.paidSearch.traffic)} estimated traffic</p>
                        <p className="mt-1 text-xs text-gray-500">Connect Google Ads for full competitive data</p>
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">Connect Google Ads to see paid competitive positioning</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="lg:col-span-2 rounded-lg border border-gray-200 border-l-4 border-l-sky-500 overflow-hidden bg-sky-50/40">
                <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gradient-to-r from-sky-50 to-white">Sample Text Ads</h4>
                <div className="p-8 text-center text-gray-500 text-sm">
                  <p>Ad copy preview requires Google Ads connection.</p>
                  <p className="text-xs mt-1">Connect Google Ads in Client Settings to view your responsive search ads.</p>
                </div>
              </div>
            </div>
          </div>
          </section>

          {/* Section: Backlinks - match reference: filters, Export, Follow/Nofollow labels, Backlink Types bars, Top Anchors, Referring Domains, Title & URL */}
          <section>
          <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm bg-white">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Link2 className="h-5 w-5 text-white/90" />
                Backlinks
              </h3>
              <span className="inline-flex items-center gap-1.5 text-sm text-white/85">
                <Globe className="h-4 w-4" />
                Worldwide
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm text-white/85">
                <Calendar className="h-4 w-4" />
                All time
              </span>
            </div>
            <div className="p-6 space-y-6 bg-violet-50/20">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 rounded-lg border border-gray-200 overflow-hidden border-l-4 border-l-violet-500 bg-white">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                  <h4 className="font-medium text-gray-900">Backlinks</h4>
                  <button
                    type="button"
                    onClick={() => exportBacklinksToCsv(overview.backlinksList ?? [], overview.client?.domain ?? "export")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Upload className="h-4 w-4" />
                    Export
                  </button>
                </div>
                <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "calc(2.5rem + 7 * 3.5rem)" }}>
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Referring Page Title / Referring Page URL</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Anchor Text / Link URL</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {(overview.backlinksList ?? []).slice(0, 20).map((b, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-900">
                            <div className="flex flex-col">
                              <span className="text-gray-700 truncate max-w-[220px]">{b.referringPageTitle || getDomainFromUrl(b.referringPageUrl || "")}</span>
                              <a href={b.referringPageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[220px] text-xs mt-0.5" title={b.referringPageUrl}>
                                {b.referringPageUrl}
                              </a>
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex flex-col">
                              <span className="text-gray-900">{b.anchorText || "(empty)"}</span>
                              <a href={b.linkUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[200px] text-xs mt-0.5" title={b.linkUrl}>
                                {b.linkUrl}
                              </a>
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${b.type === "follow" ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-600"}`}>
                              {b.type}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {(!overview.backlinksList?.length) && (
                        <tr><td colSpan={3} className="px-4 py-4 text-gray-500">No backlinks data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 border-t border-gray-100">
                  <button type="button" onClick={() => setBacklinksModalOpen(true)} className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                    View details
                  </button>
                </div>
              </div>
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h4 className="font-medium text-gray-900 mb-4">Follow vs Nofollow</h4>
                  {followNofollowData.length > 0 ? (
                    <>
                      <div className="h-40 flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={followNofollowData}
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={60}
                              paddingAngle={2}
                              dataKey="value"
                              nameKey="name"
                            >
                              {followNofollowData.map((_, i) => (
                                <Cell key={i} fill={followNofollowData[i].fill} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: number, name: string) => [`${name} links: ${value >= 1000 ? (value / 1000).toFixed(2) + "K" : value.toLocaleString()}`, ""]} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-2 flex flex-col gap-1 items-center text-sm">
                        <span className="text-purple-700 font-medium">Follow links {overview.followNofollow.follow >= 1000 ? (overview.followNofollow.follow / 1000).toFixed(2) + "K" : overview.followNofollow.follow.toLocaleString()}</span>
                        <span className="text-gray-600">Nofollow links {overview.followNofollow.nofollow >= 1000 ? (overview.followNofollow.nofollow / 1000).toFixed(2) + "K" : overview.followNofollow.nofollow.toLocaleString()}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">No data</p>
                  )}
                  <div className="mt-4">
                    <button type="button" onClick={() => setBacklinksModalOpen(true)} className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                      View details
                    </button>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h4 className="font-medium text-gray-900 mb-3">Backlink Types</h4>
                  <div className="space-y-3">
                    {(() => {
                      const types = overview.backlinksByType?.length
                        ? [...overview.backlinksByType]
                        : [{ type: "Text", count: overview.metrics.backlinks.totalBacklinks, pct: 100 }];
                      if (!types.find((t) => t.type === "Frame")) types.push({ type: "Frame", count: 0, pct: 0 });
                      return types.map((bt, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-gray-700 text-sm w-14 flex-shrink-0">{bt.type}</span>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden min-w-0">
                            <div className="h-full bg-purple-500 rounded-full" style={{ width: `${bt.pct}%` }} />
                          </div>
                          <span className={`text-sm flex-shrink-0 font-medium ${bt.pct > 0 ? "text-purple-700" : "text-gray-500"}`}>
                            {bt.pct}% ({bt.count >= 1000 ? (bt.count / 1000).toFixed(1) + "K" : bt.count.toLocaleString()})
                          </span>
                        </div>
                      ));
                    })()}
                  </div>
                  <div className="mt-4">
                    <button type="button" onClick={() => setBacklinksModalOpen(true)} className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                      View full report
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">Top Anchors</h4>
                  <button
                    type="button"
                    onClick={() => exportTopAnchorsToCsv(overview.topAnchors ?? [], overview.client?.domain ?? "export")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Upload className="h-4 w-4" />
                    Export
                  </button>
                </div>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Anchor</th>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Domains</th>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Backlinks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {(overview.topAnchors ?? []).length === 0 ? (
                        <tr><td colSpan={3} className="px-6 py-4 text-gray-500">No data</td></tr>
                      ) : (
                        (overview.topAnchors ?? []).slice(0, 10).map((a, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-6 py-3 text-gray-900 truncate max-w-[200px]" title={a.anchor}>{a.anchor === "(empty)" ? "<EmptyAnchor>" : a.anchor}</td>
                            <td className="px-6 py-3 text-gray-600 tabular-nums">{a.domains != null ? a.domains.toLocaleString() : "—"}</td>
                            <td className="px-6 py-3 text-blue-600 font-medium tabular-nums">{a.refDomains.toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">Referring Domains</h4>
                  <button
                    type="button"
                    onClick={() => exportReferringDomainsToCsv(overview.referringDomains ?? [], overview.client?.domain ?? "export")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Upload className="h-4 w-4" />
                    Export
                  </button>
                </div>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Root Domain</th>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Country/IP</th>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Backlinks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {(overview.referringDomains ?? []).length === 0 ? (
                        <tr><td colSpan={3} className="px-6 py-4 text-gray-500">No data</td></tr>
                      ) : (
                        (overview.referringDomains ?? []).slice(0, 15).map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-6 py-3">
                              <a href={`https://${r.domain}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                                {r.domain}
                                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                              </a>
                            </td>
                            <td className="px-6 py-3 text-gray-600">—</td>
                            <td className="px-6 py-3 text-gray-900 tabular-nums">{r.backlinks.toLocaleString()}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h4 className="font-medium text-gray-900">Title & URL</h4>
                <button
                  type="button"
                  onClick={() => exportIndexedPagesToCsv(overview.indexedPages ?? [], overview.client?.domain ?? "export")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Upload className="h-4 w-4" />
                  Export
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left font-medium text-gray-700">Title & URL</th>
                      <th className="px-6 py-3 text-left font-medium text-gray-700">Domains</th>
                      <th className="px-6 py-3 text-left font-medium text-gray-700">Backlinks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {(overview.indexedPages ?? []).slice(0, 10).map((p, i) => {
                      const fullUrl = `https://${overview.client?.domain ?? ""}${p.url.startsWith("/") ? "" : "/"}${p.url}`;
                      return (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-6 py-3">
                            <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate inline-block max-w-[320px]" title={fullUrl}>
                              {fullUrl}
                            </a>
                          </td>
                          <td className="px-6 py-3 text-gray-900 tabular-nums">{p.refDomains.toLocaleString()}</td>
                          <td className="px-6 py-3 text-gray-900 tabular-nums">{p.refDomains.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                    {(!overview.indexedPages?.length) && (
                      <tr><td colSpan={3} className="px-6 py-4 text-gray-500">No data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            </div>
          </div>
        </section>
        </div>
      )}

      {/* Keywords by Intent modal */}
      {intentModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIntentModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Keywords by Intent</h3>
              <button type="button" onClick={() => setIntentModalOpen(false)} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <div className="h-8 w-full flex rounded overflow-hidden mb-6">
                {intentData.map((d, i) => (
                  <div key={i} className="h-full" style={{ width: `${d.pct}%`, backgroundColor: d.fill, opacity: 0.9 }} title={`${d.intent} ${d.pct}%`} />
                ))}
              </div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 font-medium border-b border-gray-200">
                    <th className="pb-3">Intent</th>
                    <th className="pb-3">Keywords</th>
                    <th className="pb-3">Traffic</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {intentData.map((d, i) => (
                    <tr key={i}>
                      <td className="py-3 flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                        <span className="text-gray-900">{d.intent}</span>
                        <span className="text-blue-600 font-medium">{typeof d.pct === "number" ? d.pct.toFixed(1) : d.pct}%</span>
                      </td>
                      <td className="py-3 text-gray-900 tabular-nums">{d.keywords}</td>
                      <td className="py-3 text-gray-900 tabular-nums">{d.traffic}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Backlinks modal */}
      {backlinksModalOpen && overview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setBacklinksModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Backlinks ({(overview.backlinksList?.length ?? 0).toLocaleString()})</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => exportBacklinksToCsv(overview.backlinksList ?? [], overview.client?.domain ?? "export")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Upload className="h-4 w-4" />
                  Export
                </button>
                <button type="button" onClick={() => setBacklinksModalOpen(false)} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {(overview.backlinksList?.length ?? 0) === 0 ? (
                <p className="text-center text-gray-500 py-8">No backlinks data</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Referring Page Title / Referring Page URL</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Anchor Text / Link URL</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {(overview.backlinksList ?? []).map((b, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <div className="flex flex-col">
                            <span className="text-gray-700 truncate max-w-[280px]">{b.referringPageTitle || getDomainFromUrl(b.referringPageUrl || "")}</span>
                            <a href={b.referringPageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[280px] text-xs mt-0.5" title={b.referringPageUrl}>
                              {b.referringPageUrl}
                            </a>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-col">
                            <span className="text-gray-900">{b.anchorText || "(empty)"}</span>
                            <a href={b.linkUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate max-w-[240px] text-xs mt-0.5" title={b.linkUrl}>
                              {b.linkUrl}
                            </a>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${b.type === "follow" ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-600"}`}>
                            {b.type}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Organic Competitors modal */}
      {competitorsModalOpen && overview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setCompetitorsModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Main Organic Competitors ({(overview.totalCompetitorsCount ?? overview.organicCompetitors?.length ?? 0).toLocaleString()})</h3>
              <button type="button" onClick={() => setCompetitorsModalOpen(false)} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {(overview.organicCompetitors?.length ?? 0) === 0 ? (
                <p className="text-center text-gray-500 py-8">Find your direct competitors</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Competitor</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Com. Level</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">Com. Keywords</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-700">SE Keywords</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {overview.organicCompetitors!.map((c, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <a href={`https://${c.competitor}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                            {c.competitor}
                            <ExternalLink className="h-3 w-3 flex-shrink-0 text-gray-400" />
                          </a>
                        </td>
                        <td className="px-4 py-2">
                          <div className="w-20 h-2 bg-gray-200 rounded overflow-hidden">
                            <div className="h-full bg-blue-500 rounded" style={{ width: `${c.comLevel}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="text-blue-600 tabular-nums">{c.comKeywords.toLocaleString()}</span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="text-blue-600 tabular-nums">{c.seKeywords.toLocaleString()}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Organic Keywords modal */}
      {topKeywordsModalOpen && overview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setTopKeywordsModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Top Organic Keywords ({overview.topOrganicKeywords.length})</h3>
              <button type="button" onClick={() => setTopKeywordsModalOpen(false)} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {overview.topOrganicKeywords.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No keywords yet</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Keyword</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Intent</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Pos.</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Volume</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">CPC (U...)</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Traffic</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {overview.topOrganicKeywords.map((k, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <a
                            href={k.url ? (k.url.startsWith("http") ? k.url : `https://${k.url}`) : `https://www.google.com/search?q=${encodeURIComponent(k.keyword)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 hover:underline truncate max-w-[280px]"
                            title={k.keyword}
                          >
                            <FileText className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                            <span className="truncate">{k.keyword}</span>
                          </a>
                        </td>
                        <td className="px-4 py-2">
                          <span className="inline-flex w-6 h-6 items-center justify-center rounded bg-gray-100 text-xs font-medium text-gray-500">—</span>
                        </td>
                        <td className="px-4 py-2 text-gray-600 tabular-nums">{k.position}</td>
                        <td className="px-4 py-2 text-gray-600 tabular-nums">{k.volume != null ? formatCompactNumber(k.volume) : "—"}</td>
                        <td className="px-4 py-2 text-gray-600 tabular-nums">{k.cpc != null ? k.cpc.toFixed(2) : "0.00"}</td>
                        <td className="px-4 py-2 text-gray-600 tabular-nums">{k.trafficPercent != null ? k.trafficPercent.toFixed(2) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DomainResearchView;
