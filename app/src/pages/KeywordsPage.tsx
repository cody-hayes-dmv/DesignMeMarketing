import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Search,
  Plus,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  BarChart2,
  MessageCircle,
  List,
  MapPin,
  Download,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import api from "@/lib/api";
import { Client } from "@/store/slices/clientSlice";
import toast from "react-hot-toast";
import DomainResearchView from "@/components/DomainResearchView";

type TabId = "research" | "tracked";

interface ResearchKeyword {
  keyword: string;
  searchVolume: number;
  cpc: number | null;
  competition: number | null;
  competitionLevel: string | null;
  difficulty: number | null;
  monthlySearches: Array<{ year: number; month: number; search_volume: number }> | null;
  seed: string;
}

const DEFAULT_LOCATION = 2840; // United States
const DEFAULT_LANGUAGE = "en";

const LOCATION_OPTIONS = [
  { name: "United States", code: 2840 },
  { name: "United Kingdom", code: 2826 },
  { name: "Canada", code: 2124 },
  { name: "Australia", code: 2036 },
  { name: "Germany", code: 2276 },
];

const LANGUAGE_OPTIONS = [
  { name: "English", code: "en" },
  { name: "Spanish", code: "es" },
  { name: "French", code: "fr" },
  { name: "German", code: "de" },
  { name: "Portuguese", code: "pt" },
];

const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString();
};

// Compact format for Keyword Hub: 60.5K, 73.1K, 308.0M
const formatCompact = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
};

// Difficulty description for Keyword Detail card (screenshot 1)
function getDifficultyDescription(label: string): string {
  const lower = (label || "").toLowerCase();
  if (lower.includes("very hard")) return "The hardest keyword to compete for. It will take a lot of on-page SEO, link building, and content promotion efforts.";
  if (lower.includes("hard")) return "Competitive keyword. Focus on strong on-page SEO and quality backlinks.";
  if (lower.includes("medium")) return "Moderate competition. Balanced effort on content and links can yield results.";
  if (lower.includes("easy")) return "Easier to rank. Good opportunity for newer sites with solid content.";
  return "Keyword difficulty indicates the level of effort needed to rank.";
}

const KeywordsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>("tracked");

  const [clients, setClients] = useState<Client[]>([]);
  const [clientsError, setClientsError] = useState<string | null>(null);

  const [researchSeed, setResearchSeed] = useState("");
  const [researchLocation, setResearchLocation] = useState<number>(DEFAULT_LOCATION);
  const [researchLanguage, setResearchLanguage] = useState<string>(DEFAULT_LANGUAGE);
  const [researchLimit, setResearchLimit] = useState<number>(10);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchResults, setResearchResults] = useState<ResearchKeyword[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, boolean>>({});
  const [assignClientId, setAssignClientId] = useState<string | null>(null);
  const [assignClientSearchQuery, setAssignClientSearchQuery] = useState("");
  const [assignClientSearchOpen, setAssignClientSearchOpen] = useState(false);
  const assignClientBoxRef = useRef<HTMLDivElement | null>(null);
  const [assigningKeywords, setAssigningKeywords] = useState(false);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);

  const [keywordDetail, setKeywordDetail] = useState<{
    keyword: string;
    searchVolume: number;
    globalVolume: number;
    countryBreakdown: { countryCode: string; searchVolume: number }[];
    keywordDifficulty: number;
    difficultyLabel: string;
    cpc: number;
    competition: number;
    competitionLevel: string;
    intent: string;
    monthlySearches: { year: number; month: number; searchVolume: number }[];
  } | null>(null);
  const [keywordDetailLoading, setKeywordDetailLoading] = useState(false);
  const [serpAnalysis, setSerpAnalysis] = useState<{
    keyword: string;
    totalCount: number;
    serpFeatures: string[];
    serpFeatureDetails?: {
      local_pack: { title?: string; link?: string; domain?: string }[];
      people_also_ask: { title?: string; snippet?: string }[];
      things_to_know: { title?: string; snippet?: string }[];
    };
    items: { position: number; url: string; domain: string; title: string; pageAs: number | null; refDomains: number | null; backlinks: number | null; searchTraffic: number | null; urlKeywords: number | null }[];
    offset: number;
  } | null>(null);
  const [serpViewMode, setSerpViewMode] = useState<"url" | "domain">("url");
  const [keywordIdeasExpanded, setKeywordIdeasExpanded] = useState<{ variations: boolean; questions: boolean }>({ variations: false, questions: false });
  const [keywordIdeas, setKeywordIdeas] = useState<{
    variations: ResearchKeyword[];
    questions: ResearchKeyword[];
    strategy: { pillar: string; items: ResearchKeyword[] };
  }>({ variations: [], questions: [], strategy: { pillar: "", items: [] } });
  const [serpFeatureExpanded, setSerpFeatureExpanded] = useState<{ local_pack: boolean; people_also_ask: boolean; things_to_know: boolean }>({ local_pack: false, people_also_ask: false, things_to_know: false });
  const [serpAnalysisLoading, setSerpAnalysisLoading] = useState(false);
  const [serpAnalysisOffset, setSerpAnalysisOffset] = useState(0);

  useEffect(() => {
    const loadClients = async () => {
      try {
        setClientsError(null);
        const res = await api.get("/clients");
        const raw: Client[] = Array.isArray(res.data) ? res.data : [];
        const activeOnly = raw.filter((c) => c.status === "ACTIVE");
        const sorted = [...activeOnly].sort((a, b) =>
          (a.name || a.domain || "").localeCompare(b.name || b.domain || "", undefined, { sensitivity: "base" })
        );
        setClients(sorted);
        if (sorted.length > 0) {
          const first = sorted[0];
          setAssignClientId(first.id);
          setAssignClientSearchQuery(first.name || first.domain || "");
        }
      } catch (error: any) {
        console.error("Failed to fetch clients", error);
        const errorMsg = error?.response?.data?.message || "Unable to load clients";
        setClientsError(errorMsg);
        // Toast is already shown by API interceptor
      } finally {
        // clients loaded
      }
    };

    loadClients();
  }, []);

  const filteredClientsForAssign = useMemo(() => {
    const q = assignClientSearchQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) || (c.domain || "").toLowerCase().includes(q)
    );
  }, [clients, assignClientSearchQuery]);

  const handleResearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!researchSeed.trim()) {
      setResearchError("Enter a keyword or phrase to research.");
      return;
    }

    try {
      setResearchLoading(true);
      setResearchError(null);
      setResearchResults([]);
      setKeywordIdeas({ variations: [], questions: [], strategy: { pillar: "", items: [] } });
      setSelectedSuggestions({});
      const res = await api.get("/seo/keyword-research", {
        params: {
          keyword: researchSeed.trim(),
          limit: researchLimit,
          locationCode: researchLocation,
          languageCode: researchLanguage,
        },
        timeout: 60000, // 60 seconds timeout for keyword research (can take longer)
      });
      const data = res.data as
        | { suggestions?: ResearchKeyword[]; variations?: ResearchKeyword[]; questions?: ResearchKeyword[]; strategy?: { pillar: string; items: ResearchKeyword[] } }
        | ResearchKeyword[];
      const suggestions: ResearchKeyword[] = Array.isArray(data) ? data : (data?.suggestions ?? []);
      setResearchResults(suggestions);
      if (data && !Array.isArray(data) && data.suggestions) {
        setKeywordIdeas({
          variations: data.variations ?? [],
          questions: data.questions ?? [],
          strategy: data.strategy ?? { pillar: researchSeed.trim(), items: suggestions },
        });
      }
      if (suggestions.length === 0) {
        setResearchError("No suggestions were found for this keyword. Try a different phrase.");
      }
    } catch (error: any) {
      console.error("Keyword research error", error);
      setResearchResults([]);
      setKeywordIdeas({ variations: [], questions: [], strategy: { pillar: "", items: [] } });
      let errorMsg = "Unable to fetch keyword suggestions. Please try again.";
      if (error?.code === "ECONNABORTED" || error?.message?.includes("timeout")) {
        errorMsg = "Request timed out. The keyword research is taking longer than expected. Please try again.";
      } else if (error?.response?.data?.message) {
        errorMsg = error.response.data.message;
      }
      setResearchError(errorMsg);
      // Toast is already shown by API interceptor
    } finally {
      setResearchLoading(false);
    }
  };

  const toggleSuggestionSelection = (keyword: string) => {
    setSelectedSuggestions((prev) => ({
      ...prev,
      [keyword]: !prev[keyword],
    }));
  };

  const handleAssignKeywords = async (keywords: ResearchKeyword[]) => {
    if (!assignClientId) {
      setAssignMessage("Select a client before assigning keywords.");
      return;
    }
    if (keywords.length === 0) {
      setAssignMessage("Select at least one keyword.");
      return;
    }

    try {
      setAssigningKeywords(true);
      setAssignMessage(null);

      // Add as tracked keywords - auto-fetch data from DataForSEO
      await Promise.all(
        keywords.map((item) =>
          api.post(
            `/seo/keywords/${assignClientId}`,
            {
              keyword: item.keyword,
              searchVolume: Number(item.searchVolume) || 0,
              difficulty: item.difficulty ?? undefined,
              cpc: item.cpc ?? undefined,
              competition:
                item.competitionLevel ||
                (item.competition !== null ? item.competition.toFixed(2) : undefined),
              fetchFromDataForSEO: true, // Auto-fetch ranking data
              locationCode: researchLocation,
              languageCode: researchLanguage,
            },
            { timeout: 60000 }
          )
        )
      );

      // Note: the server already upserts Target Keywords when creating tracked keywords,
      // so we don't need a second /target-keywords call here (avoids duplicate errors/toasts).

      const successMessage = `Added ${keywords.length} keyword${keywords.length > 1 ? "s" : ""} to tracking.`;
      toast.success(successMessage);
      setAssignMessage(successMessage);
      setSelectedSuggestions({});
    } catch (error: any) {
      console.error("Failed to assign keywords", error);
      const errorMsg = error?.response?.data?.message || "Failed to assign keywords. Please try again.";
      setAssignMessage(errorMsg);
      // Toast is already shown by API interceptor
    } finally {
      setAssigningKeywords(false);
    }
  };

  const handleAssignSelected = async () => {
    const chosen = researchResults.filter((item) => selectedSuggestions[item.keyword]);
    await handleAssignKeywords(chosen);
  };

  const handleAssignSingle = async (keyword: ResearchKeyword) => {
    await handleAssignKeywords([keyword]);
  };

  useEffect(() => {
    if (activeTab !== "research" || !researchSeed.trim() || researchResults.length === 0) {
      if (researchResults.length === 0) {
        setKeywordDetail(null);
        setSerpAnalysis(null);
      }
      return;
    }
    let cancelled = false;
    setKeywordDetailLoading(true);
    (async () => {
      try {
        const [detailRes, serpRes] = await Promise.all([
          api.get("/seo/keyword-detail", {
            params: { keyword: researchSeed.trim(), locationCode: researchLocation, languageCode: researchLanguage },
            timeout: 30000,
          }),
          api.get("/seo/serp-analysis", {
            params: { keyword: researchSeed.trim(), locationCode: researchLocation, languageCode: researchLanguage, offset: 0 },
            timeout: 30000,
          }),
        ]);
        if (cancelled) return;
        if (detailRes.data?.found && detailRes.data?.detail) {
          setKeywordDetail(detailRes.data.detail);
        } else {
          setKeywordDetail(null);
        }
        if (serpRes.data?.items) {
          setSerpAnalysis({ ...serpRes.data, offset: 0 });
          setSerpAnalysisOffset(0);
          setSerpFeatureExpanded({ local_pack: false, people_also_ask: false, things_to_know: false });
        } else {
          setSerpAnalysis(null);
        }
      } catch (err) {
        if (!cancelled) {
          setKeywordDetail(null);
          setSerpAnalysis(null);
        }
      } finally {
        if (!cancelled) setKeywordDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, researchSeed, researchResults.length, researchLocation, researchLanguage]);

  const loadSerpPage = (offset: number) => {
    if (!researchSeed.trim()) return;
    setSerpAnalysisLoading(true);
    api
      .get("/seo/serp-analysis", {
        params: { keyword: researchSeed.trim(), locationCode: researchLocation, languageCode: researchLanguage, offset },
        timeout: 30000,
      })
      .then((res) => {
        if (res.data?.items) {
          setSerpAnalysis({ ...res.data, offset });
          setSerpAnalysisOffset(offset);
        }
      })
      .finally(() => setSerpAnalysisLoading(false));
  };

  // Click keyword in Keyword Ideas: run research for that keyword (same as Get suggestions)
  const handleKeywordIdeaClick = async (keyword: string) => {
    if (!keyword?.trim()) return;
    setResearchSeed(keyword.trim());
    setResearchError(null);
    setResearchResults([]);
    setKeywordIdeas({ variations: [], questions: [], strategy: { pillar: "", items: [] } });
    try {
      setResearchLoading(true);
      const res = await api.get("/seo/keyword-research", {
        params: {
          keyword: keyword.trim(),
          limit: researchLimit,
          locationCode: researchLocation,
          languageCode: researchLanguage,
        },
        timeout: 60000,
      });
      const data = res.data as
        | { suggestions?: ResearchKeyword[]; variations?: ResearchKeyword[]; questions?: ResearchKeyword[]; strategy?: { pillar: string; items: ResearchKeyword[] } }
        | ResearchKeyword[];
      const suggestions: ResearchKeyword[] = Array.isArray(data) ? data : (data?.suggestions ?? []);
      setResearchResults(suggestions);
      if (data && !Array.isArray(data) && data.suggestions) {
        setKeywordIdeas({
          variations: data.variations ?? [],
          questions: data.questions ?? [],
          strategy: data.strategy ?? { pillar: keyword.trim(), items: suggestions },
        });
      }
      if (suggestions.length === 0) setResearchError("No suggestions found for this keyword.");
    } catch (err: any) {
      setResearchResults([]);
      setKeywordIdeas({ variations: [], questions: [], strategy: { pillar: "", items: [] } });
      setResearchError(err?.response?.data?.message || "Unable to fetch suggestions.");
    } finally {
      setResearchLoading(false);
    }
  };

  const keywordResearchPdfRef = useRef<HTMLDivElement>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const handleExportKeywordResearchPdf = useCallback(async () => {
    const element = keywordResearchPdfRef.current;
    if (!element) return;
    const previousOverflow = document.body.style.overflow;
    try {
      setExportingPdf(true);
      document.body.style.overflow = "hidden";
      element.classList.add("pdf-exporting");
      await new Promise((r) => setTimeout(r, 200));
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        width: element.scrollWidth,
        height: element.scrollHeight,
        scrollX: 0,
        scrollY: 0,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      const seed = (researchSeed || "keyword-research").replace(/\s+/g, "-").toLowerCase();
      const date = new Date();
      const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
      pdf.save(`keyword-research-${seed}-${dateStr}.pdf`);
      toast.success("Keyword Research page exported as PDF.");
    } catch (err: any) {
      console.error("PDF export error", err);
      toast.error(err?.message || "Failed to export PDF.");
    } finally {
      document.body.style.overflow = previousOverflow;
      element.classList.remove("pdf-exporting");
      setExportingPdf(false);
    }
  }, [researchSeed]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (assignClientBoxRef.current && !assignClientBoxRef.current.contains(e.target as Node)) {
        setAssignClientSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  return (
    <div className="p-8 space-y-8 bg-gradient-to-br from-gray-50 via-white to-gray-50 min-h-screen">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Research Hub</h1>
          <p className="text-base text-gray-600 leading-relaxed">
            Research new keyword opportunities and track the phrases that matter for each client.
          </p>
        </div>
        <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-1.5 shadow-sm">
          <button
            onClick={() => setActiveTab("tracked")}
            className={`inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-semibold transition-all duration-200 ${
              activeTab === "tracked"
                ? "bg-primary-600 text-white shadow-md"
                : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Domain Research
          </button>
          <button
            onClick={() => setActiveTab("research")}
            className={`inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-semibold transition-all duration-200 ${
              activeTab === "research"
                ? "bg-primary-600 text-white shadow-md"
                : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <Search className="h-4 w-4 mr-2" />
            Keyword Research
          </button>
        </div>
      </div>

      {clientsError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {clientsError}
        </div>
      )}

      {activeTab === "research" && (
        <div ref={keywordResearchPdfRef} className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-2" data-pdf-hide="true">
            <span />
            <button
              type="button"
              onClick={handleExportKeywordResearchPdf}
              disabled={exportingPdf}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export as PDF
            </button>
          </div>
          <form
            onSubmit={handleResearchSubmit}
            className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 space-y-6"
          >
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-2">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Seed keyword or phrase
                </label>
                  <input
                    type="text"
                    value={researchSeed}
                    onChange={(e) => setResearchSeed(e.target.value)}
                    placeholder="e.g. buy running shoes"
                    className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all duration-150 shadow-sm hover:shadow"
                    required
                  />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Location
                </label>
                  <select
                    value={researchLocation}
                    onChange={(e) => setResearchLocation(Number(e.target.value))}
                    className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all duration-150 shadow-sm hover:shadow"
                  >
                  {LOCATION_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Language
                </label>
                  <select
                    value={researchLanguage}
                    onChange={(e) => setResearchLanguage(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all duration-150 shadow-sm hover:shadow"
                  >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Suggestions
                </label>
                  <input
                    type="number"
                    min={5}
                    max={100}
                    value={researchLimit}
                    onChange={(e) => setResearchLimit(Number(e.target.value))}
                    className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all duration-150 shadow-sm hover:shadow"
                  />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">
                Powered by DataForSEO Labs — we fetch live suggestions with search volume, CPC, and competition metrics.
              </p>
              <button
                type="submit"
                disabled={researchLoading}
                className="inline-flex items-center rounded-xl bg-primary-600 px-6 py-3 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60 shadow-md hover:shadow-lg transition-all duration-200"
              >
                {researchLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Fetching…
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Get suggestions
                  </>
                )}
              </button>
            </div>
          </form>

          {researchError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <span>{researchError}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white p-6 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Keyword Suggestions</h2>
                <p className="text-sm text-gray-500">
                  Select keywords and assign them to a client to start tracking their rankings.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div ref={assignClientBoxRef} className="min-w-[240px] relative">
                  <div className="flex h-11 overflow-hidden rounded-xl border-2 border-primary-500 bg-white shadow-sm focus-within:ring-2 focus-within:ring-primary-200">
                    <div className="flex items-center bg-primary-600 px-3 text-[11px] font-semibold uppercase tracking-wider text-white">
                      Client
                    </div>
                    <input
                      type="text"
                      value={assignClientSearchQuery}
                      onChange={(e) => {
                        setAssignClientSearchQuery(e.target.value);
                        setAssignClientSearchOpen(true);
                        if (assignClientId) {
                          const c = clients.find((x) => x.id === assignClientId);
                          const name = c ? (c.name || c.domain || "") : "";
                          if (e.target.value !== name) setAssignClientId(null);
                        }
                      }}
                      onFocus={() => setAssignClientSearchOpen(true)}
                      placeholder="Type client name"
                      className="h-11 w-full min-w-0 bg-white pl-4 pr-4 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none"
                    />
                  </div>
                  {assignClientSearchOpen && (
                    <div className="absolute z-20 mt-1 left-0 right-0 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg max-h-56 overflow-y-auto">
                      {filteredClientsForAssign.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-500">No clients match.</div>
                      ) : (
                        filteredClientsForAssign.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            onClick={() => {
                              setAssignClientId(client.id);
                              setAssignClientSearchQuery(client.name || client.domain || "");
                              setAssignClientSearchOpen(false);
                            }}
                            className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                              assignClientId === client.id ? "bg-primary-50 text-primary-800" : ""
                            }`}
                          >
                            {client.name || client.domain}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleAssignSelected}
                  disabled={assigningKeywords || Object.values(selectedSuggestions).every((value) => !value)}
                  className="inline-flex h-11 items-center rounded-xl border-2 border-primary-300 bg-white px-5 text-sm font-semibold text-primary-700 hover:bg-primary-50 hover:border-primary-400 disabled:opacity-60 shadow-sm hover:shadow transition-all duration-200"
                >
                  {assigningKeywords ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Assigning…
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Track selected
                    </>
                  )}
                </button>
              </div>
            </div>

            {assignMessage && (
              <div className="mx-6 mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                {assignMessage}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                  <tr>
                    <th className="px-6 py-4">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                      Keyword
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                      Search volume
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                      CPC (USD)
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                      Difficulty
                    </th>
                    <th className="px-6 py-4">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {researchLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                        <span className="inline-flex items-center gap-2 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                          Fetching keyword suggestions…
                        </span>
                      </td>
                    </tr>
                  ) : researchResults.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-500 text-sm">
                        Run a keyword search to see suggestions.
                      </td>
                    </tr>
                  ) : (
                    researchResults.map((result) => (
                      <tr key={result.keyword} className="hover:bg-gray-50 transition-colors duration-150">
                        <td className="px-6 py-4">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedSuggestions[result.keyword])}
                            onChange={() => toggleSuggestionSelection(result.keyword)}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 cursor-pointer"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <div>
                            <p className="font-semibold text-gray-900">{result.keyword}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Seed: <span className="font-medium text-gray-600">{result.seed}</span>
                            </p>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-700 font-medium">
                          {formatNumber(result.searchVolume)}
                        </td>
                        <td className="px-6 py-4 text-gray-700 font-medium">
                          {result.cpc && result.cpc > 0 ? `$${result.cpc.toFixed(2)}` : "—"}
                        </td>
                        <td className="px-6 py-4 text-gray-700 font-medium">
                          {result.difficulty !== null ? `${result.difficulty}` : "—"}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleAssignSingle(result)}
                            disabled={assigningKeywords}
                            className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-60 transition-all duration-150 shadow-sm hover:shadow"
                          >
                            Track
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Keyword Detail (4 cards) - screenshot 1: Volume & KD, Global Volume, Intent & Trend, CPC & Competitive Density */}
            {researchResults.length > 0 && (keywordDetail || keywordDetailLoading) && (
              <div className="border-t border-gray-200 p-6 bg-white">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Keyword: {researchSeed || keywordDetail?.keyword}</h3>
                {keywordDetailLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
                  </div>
                ) : keywordDetail ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Volume & Keyword Difficulty</p>
                      <p className="mt-2 text-2xl font-bold text-gray-900 inline-flex items-center gap-1.5">
                        {formatCompact(keywordDetail.searchVolume)}
                        <span className="text-base font-normal" title="United States">🇺🇸</span>
                      </p>
                      {(() => {
                        const kd = typeof keywordDetail.keywordDifficulty === "number" && Number.isFinite(keywordDetail.keywordDifficulty) ? keywordDetail.keywordDifficulty : null;
                        const label = keywordDetail.difficultyLabel || (kd != null ? (kd >= 80 ? "Very hard" : kd >= 50 ? "Hard" : kd >= 25 ? "Medium" : "Easy") : "—");
                        return (
                          <>
                            <div className="mt-3 flex items-center gap-2">
                              <div className={`w-12 h-12 rounded-full border-4 flex items-center justify-center ${kd == null ? "border-gray-200" : kd >= 70 ? "border-red-200" : kd >= 40 ? "border-amber-200" : "border-green-200"}`}>
                                <span className={`text-sm font-bold ${kd == null ? "text-gray-500" : kd >= 70 ? "text-red-600" : kd >= 40 ? "text-amber-600" : "text-green-600"}`}>
                                  {kd != null ? `${kd}%` : "—"}
                                </span>
                              </div>
                              <span className="text-sm font-medium text-gray-600">
                                {kd != null ? `${label}` : `Difficulty: ${label}`}
                              </span>
                            </div>
                            <p className="mt-2 text-xs text-gray-500">{getDifficultyDescription(label)}</p>
                          </>
                        );
                      })()}
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Global Volume</p>
                      <p className="mt-2 text-2xl font-bold text-gray-900">{formatCompact(keywordDetail.globalVolume)}</p>
                      <div className="mt-3 space-y-2">
                        {(() => {
                          const breakdown = keywordDetail.countryBreakdown || [];
                          const maxVol = Math.max(...breakdown.map((x) => x.searchVolume), 1);
                          const showCount = 6;
                          const shown = breakdown.slice(0, showCount);
                          const otherSum = breakdown.length > showCount ? breakdown.slice(showCount).reduce((s, c) => s + c.searchVolume, 0) : 0;
                          return (
                            <>
                              {shown.map((c) => (
                                <div key={c.countryCode} className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-gray-600 w-8 uppercase">{c.countryCode}</span>
                                  <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                                    <div className="h-full bg-primary-500 rounded" style={{ width: `${(c.searchVolume / maxVol) * 100}%` }} />
                                  </div>
                                  <span className="text-xs font-medium text-gray-700 w-14 text-right">{formatCompact(c.searchVolume)}</span>
                                </div>
                              ))}
                              {otherSum > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-gray-600 w-8">Other</span>
                                  <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                                    <div className="h-full bg-primary-500 rounded" style={{ width: `${(otherSum / maxVol) * 100}%` }} />
                                  </div>
                                  <span className="text-xs font-medium text-gray-700 w-14 text-right">{formatCompact(otherSum)}</span>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Intent & Trend</p>
                      <span className="mt-2 inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-sm font-medium">{keywordDetail.intent}</span>
                      <div className="mt-3 h-24">
                        {(keywordDetail.monthlySearches || []).length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={(keywordDetail.monthlySearches || []).slice(-12).map((m) => ({ month: `${m.month}/${String(m.year).slice(-2)}`, vol: m.searchVolume }))}>
                              <XAxis dataKey="month" tick={{ fontSize: 9 }} />
                              <YAxis tick={{ fontSize: 9 }} />
                              <Tooltip />
                              <Bar dataKey="vol" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : (
                          <p className="text-xs text-gray-400">No trend data</p>
                        )}
                      </div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">CPC & Competitive Density</p>
                      <p className="mt-2 text-2xl font-bold text-gray-900">${keywordDetail.cpc?.toFixed(2) ?? "0.00"}</p>
                      <p className="mt-1 text-sm text-gray-600">Competitive density: {keywordDetail.competition?.toFixed(2) ?? "—"}</p>
                      <p className="mt-2 text-xs text-gray-500">PLA: n/a · Ads: —</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No detail data for this keyword.</p>
                )}
              </div>
            )}

            {/* Keyword Ideas — all data from DataForSEO (variations, questions, strategy) */}
            {researchResults.length > 0 && (
              <div className="border-t border-gray-200 p-6 bg-white">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Keyword Ideas</h3>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="rounded-xl border border-gray-200 p-5 shadow-sm bg-white">
                    <h4 className="font-semibold text-gray-900">Keyword Variations</h4>
                    {(() => {
                      const variations = keywordIdeas.variations;
                      const totalVol = variations.reduce((s, r) => s + (r.searchVolume || 0), 0);
                      const showCount = keywordIdeasExpanded.variations ? variations.length : 5;
                      return (
                        <>
                          <p className="mt-1 text-2xl font-bold text-primary-600">{variations.length.toLocaleString()}</p>
                          <p className="text-sm font-semibold text-gray-700">Total Volume: {formatCompact(totalVol)}</p>
                          <div className="mt-3 overflow-x-auto">
                            <table className="min-w-full text-sm">
                              <thead>
                                <tr className="border-b border-gray-200">
                                  <th className="text-left py-2 font-semibold text-gray-700">Keywords</th>
                                  <th className="text-right py-2 font-semibold text-gray-700">Volume</th>
                                  <th className="text-right py-2 font-semibold text-gray-700">KD %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {variations.slice(0, showCount).map((r) => (
                                  <tr key={r.keyword} className="border-b border-gray-100">
                                    <td className="py-2">
                                      <button type="button" onClick={() => handleKeywordIdeaClick(r.keyword)} className="text-primary-600 hover:underline text-left font-medium">
                                        {r.keyword}
                                      </button>
                                    </td>
                                    <td className="py-2 text-right text-gray-700">{formatCompact(r.searchVolume)}</td>
                                    <td className="py-2 text-right">
                                      <span className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${(r.difficulty ?? 0) >= 70 ? "bg-red-500" : (r.difficulty ?? 0) >= 40 ? "bg-amber-500" : "bg-green-500"}`} />
                                      {r.difficulty ?? "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <button type="button" onClick={() => setKeywordIdeasExpanded((p) => ({ ...p, variations: !p.variations }))} className="mt-3 w-full rounded-lg border border-gray-200 bg-gray-100 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors">
                            {keywordIdeasExpanded.variations ? "Show less" : `View all ${variations.length.toLocaleString()} keywords`}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                  <div className="rounded-xl border border-gray-200 p-5 shadow-sm bg-white">
                    <h4 className="font-semibold text-gray-900">Questions</h4>
                    {(() => {
                      const questions = keywordIdeas.questions;
                      const totalVol = questions.reduce((s, r) => s + (r.searchVolume || 0), 0);
                      const showCount = keywordIdeasExpanded.questions ? questions.length : 5;
                      return (
                        <>
                          <p className="mt-1 text-2xl font-bold text-primary-600">{questions.length.toLocaleString()}</p>
                          <p className="text-sm font-semibold text-gray-700">Total Volume: {formatCompact(totalVol)}</p>
                          <div className="mt-3 overflow-x-auto">
                            <table className="min-w-full text-sm">
                              <thead>
                                <tr className="border-b border-gray-200">
                                  <th className="text-left py-2 font-semibold text-gray-700">Keywords</th>
                                  <th className="text-right py-2 font-semibold text-gray-700">Volume</th>
                                  <th className="text-right py-2 font-semibold text-gray-700">KD %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {questions.slice(0, showCount).map((r) => (
                                  <tr key={r.keyword} className="border-b border-gray-100">
                                    <td className="py-2">
                                      <button type="button" onClick={() => handleKeywordIdeaClick(r.keyword)} className="text-primary-600 hover:underline text-left font-medium">
                                        {r.keyword}
                                      </button>
                                    </td>
                                    <td className="py-2 text-right text-gray-700">{formatCompact(r.searchVolume)}</td>
                                    <td className="py-2 text-right">
                                      <span className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${(r.difficulty ?? 0) >= 70 ? "bg-red-500" : (r.difficulty ?? 0) >= 40 ? "bg-amber-500" : "bg-green-500"}`} />
                                      {r.difficulty ?? "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <button type="button" onClick={() => setKeywordIdeasExpanded((p) => ({ ...p, questions: !p.questions }))} className="mt-3 w-full rounded-lg border border-gray-200 bg-gray-100 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors">
                            {keywordIdeasExpanded.questions ? "Show less" : `View all ${questions.length.toLocaleString()} keywords`}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                  <div className="rounded-xl border border-gray-200 p-5 shadow-sm bg-white">
                    <h4 className="font-semibold text-gray-900">Keyword Strategy</h4>
                    <p className="mt-1 text-sm text-gray-600">Get topics, pillar and subpages <strong>automatically</strong></p>
                    <div className="mt-4 flex flex-col items-center">
                      <div className="rounded-full bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-800">{keywordIdeas.strategy.pillar || researchSeed || "seed"}</div>
                      <div className="w-px h-4 bg-gray-300" />
                      <div className="flex flex-col gap-2 mt-2 w-full max-w-xs">
                        {(keywordIdeas.strategy.items || []).slice(0, 6).map((r) => {
                          const items = keywordIdeas.strategy.items || [];
                          const maxVol = Math.max(...items.map((x) => x.searchVolume || 0), 1);
                          const pct = ((r.searchVolume || 0) / maxVol) * 100;
                          return (
                            <div key={r.keyword} className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
                                <div className="h-full bg-primary-500 rounded" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs font-medium text-gray-700 truncate max-w-[140px]" title={r.keyword}>{r.keyword}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <button type="button" className="mt-4 w-full rounded-lg border border-gray-200 bg-gray-100 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors">
                      View all clusters
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* SERP Analysis - screenshot 3: Domain/URL tabs, Results, SERP Features, pagination, expandable sections, Export */}
            {researchResults.length > 0 && (serpAnalysis || serpAnalysisLoading) && (
              <div className="border-t border-gray-200 p-6 bg-white">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">SERP Analysis</h3>
                  <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                      <button type="button" onClick={() => setSerpViewMode("domain")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${serpViewMode === "domain" ? "bg-primary-600 text-white" : "text-gray-700 hover:bg-gray-200"}`}>Domain</button>
                      <button type="button" onClick={() => setSerpViewMode("url")} className={`rounded-md px-3 py-1.5 text-sm font-medium ${serpViewMode === "url" ? "bg-primary-600 text-white" : "text-gray-700 hover:bg-gray-200"}`}>URL</button>
                    </div>
                    <a href={`https://www.google.com/search?q=${encodeURIComponent(researchSeed || serpAnalysis?.keyword || "")}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      <Search className="h-4 w-4" />
                      View SERP
                    </a>
                  </div>
                </div>
                {serpAnalysisLoading && !serpAnalysis ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
                  </div>
                ) : serpAnalysis ? (
                  <>
                    <div className="flex flex-wrap items-center gap-4 mb-4">
                      <span className="text-sm font-semibold text-gray-900">Results</span>
                      <span className="text-2xl font-bold text-gray-900">{formatCompact(serpAnalysis.totalCount)}</span>
                      <span className="text-sm text-gray-600 ml-2">SERP Features</span>
                      <div className="flex items-center gap-1">
                        {(serpAnalysis.serpFeatures || []).map((f) => (
                          <span key={f} className="rounded bg-gray-100 px-2 py-1 text-gray-600" title={f.replace(/_/g, " ")}>
                            {f === "people_also_ask" ? <MessageCircle className="h-4 w-4" /> : f === "local_pack" ? <MapPin className="h-4 w-4" /> : f === "featured_snippet" ? <List className="h-4 w-4" /> : <BarChart2 className="h-4 w-4" />}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((off) => (
                        <button key={off} type="button" onClick={() => loadSerpPage(off)} disabled={serpAnalysisLoading} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${serpAnalysisOffset === off ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
                          page {off / 10 + 1}
                        </button>
                      ))}
                    </div>
                    {/* Expandable SERP feature sections */}
                    {serpAnalysis.serpFeatureDetails && (
                      <div className="mb-4 space-y-1 border border-gray-200 rounded-xl overflow-hidden">
                        <button type="button" onClick={() => setSerpFeatureExpanded((p) => ({ ...p, local_pack: !p.local_pack }))} className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left text-sm font-medium text-gray-700">
                          {serpFeatureExpanded.local_pack ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <MapPin className="h-4 w-4" />
                          Local pack
                        </button>
                        {serpFeatureExpanded.local_pack && (serpAnalysis.serpFeatureDetails.local_pack?.length ? (
                          <div className="px-4 py-3 bg-white border-t border-gray-100 text-sm text-gray-600 space-y-2">
                            {serpAnalysis.serpFeatureDetails.local_pack.map((item, i) => (
                              <div key={i}>
                                {item.title && <p className="font-medium text-gray-900">{item.title}</p>}
                                {item.link && <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">{item.link}</a>}
                              </div>
                            ))}
                          </div>
                        ) : <div className="px-4 py-3 bg-white border-t border-gray-100 text-sm text-gray-500">No local pack data</div>)}
                        <button type="button" onClick={() => setSerpFeatureExpanded((p) => ({ ...p, people_also_ask: !p.people_also_ask }))} className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left text-sm font-medium text-gray-700">
                          {serpFeatureExpanded.people_also_ask ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <MessageCircle className="h-4 w-4" />
                          People also ask
                        </button>
                        {serpFeatureExpanded.people_also_ask && (serpAnalysis.serpFeatureDetails.people_also_ask?.length ? (
                          <div className="px-4 py-3 bg-white border-t border-gray-100 text-sm text-gray-600 space-y-3">
                            {serpAnalysis.serpFeatureDetails.people_also_ask.map((item, i) => (
                              <div key={i}>
                                {item.title && <p className="font-medium text-gray-900">{item.title}</p>}
                                {item.snippet && <p className="text-gray-600">{item.snippet}</p>}
                              </div>
                            ))}
                          </div>
                        ) : <div className="px-4 py-3 bg-white border-t border-gray-100 text-sm text-gray-500">No people also ask data</div>)}
                        <button type="button" onClick={() => setSerpFeatureExpanded((p) => ({ ...p, things_to_know: !p.things_to_know }))} className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left text-sm font-medium text-gray-700">
                          {serpFeatureExpanded.things_to_know ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <List className="h-4 w-4" />
                          Things to know
                        </button>
                        {serpFeatureExpanded.things_to_know && (serpAnalysis.serpFeatureDetails.things_to_know?.length ? (
                          <div className="px-4 py-3 bg-white border-t border-gray-100 text-sm text-gray-600 space-y-3">
                            {serpAnalysis.serpFeatureDetails.things_to_know.map((item, i) => (
                              <div key={i}>
                                {item.title && <p className="font-medium text-gray-900">{item.title}</p>}
                                {item.snippet && <p className="text-gray-600">{item.snippet}</p>}
                              </div>
                            ))}
                          </div>
                        ) : <div className="px-4 py-3 bg-white border-t border-gray-100 text-sm text-gray-500">No things to know data</div>)}
                      </div>
                    )}
                    <div className="overflow-x-auto rounded-xl border border-gray-200">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase text-xs">{serpViewMode === "domain" ? "Domain" : "URL"}</th>
                            <th className="px-6 py-3 text-right font-semibold text-gray-700 uppercase text-xs">Page AS</th>
                            <th className="px-6 py-3 text-right font-semibold text-gray-700 uppercase text-xs">Ref. Domains</th>
                            <th className="px-6 py-3 text-right font-semibold text-gray-700 uppercase text-xs">Backlinks</th>
                            <th className="px-6 py-3 text-right font-semibold text-gray-700 uppercase text-xs">Search Traffic</th>
                            <th className="px-6 py-3 text-right font-semibold text-gray-700 uppercase text-xs">URL Keywords</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                          {(serpViewMode === "domain"
                            ? (() => {
                                type DomainRow = {
                                  domain: string;
                                  urls: string[];
                                  title: string;
                                  pageAs: number | null;
                                  refDomains: number | null;
                                  backlinks: number | null;
                                  searchTraffic: number | null;
                                  urlKeywords: number | null;
                                };
                                const byDomain = (serpAnalysis.items || []).reduce<Record<string, DomainRow>>((acc, row: { position: number; url: string; domain: string; title: string; pageAs: number | null; refDomains: number | null; backlinks: number | null; searchTraffic: number | null; urlKeywords: number | null }) => {
                                  const d = row.domain || "—";
                                  if (!acc[d]) {
                                    acc[d] = {
                                      domain: d,
                                      urls: [row.url],
                                      title: row.title || "",
                                      pageAs: row.pageAs,
                                      refDomains: row.refDomains,
                                      backlinks: row.backlinks,
                                      searchTraffic: row.searchTraffic,
                                      urlKeywords: row.urlKeywords,
                                    };
                                  } else {
                                    acc[d].urls.push(row.url);
                                  }
                                  return acc;
                                }, {});
                                return Object.entries(byDomain).map(([domain, data]: [string, DomainRow]) => (
                                  <tr key={domain} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                      <a href={data.urls[0]} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline inline-flex items-center gap-1">{domain}<ExternalLink className="h-3 w-3" /></a>
                                      <p className="text-xs text-gray-500 mt-0.5">{data.urls.length} URL(s)</p>
                                    </td>
                                    <td className="px-6 py-4 text-right text-gray-700">{formatNumber(data.pageAs)}</td>
                                    <td className="px-6 py-4 text-right text-gray-700">{formatNumber(data.refDomains)}</td>
                                    <td className="px-6 py-4 text-right text-gray-700">{formatNumber(data.backlinks)}</td>
                                    <td className="px-6 py-4 text-right text-gray-700">{formatNumber(data.searchTraffic)}</td>
                                    <td className="px-6 py-4 text-right text-gray-700">{formatNumber(data.urlKeywords)}</td>
                                  </tr>
                                ));
                              })()
                            : serpAnalysis.items?.map((row) => (
                                <tr key={row.position} className="hover:bg-gray-50">
                                  <td className="px-6 py-4">
                                    <a href={row.url} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline inline-flex items-center gap-1">
                                      {row.url?.replace(/^https?:\/\//, "").slice(0, 50)}{(row.url?.length ?? 0) > 50 ? "…" : ""}
                                      <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                    </a>
                                    <p className="text-xs text-gray-500 mt-0.5">{row.domain}</p>
                                  </td>
                                  <td className="px-6 py-4 text-right text-gray-700">{formatNumber(row.pageAs)}</td>
                                  <td className="px-6 py-4 text-right text-gray-700">{formatNumber(row.refDomains)}</td>
                                  <td className="px-6 py-4 text-right text-gray-700">{formatNumber(row.backlinks)}</td>
                                  <td className="px-6 py-4 text-right text-gray-700">{formatNumber(row.searchTraffic)}</td>
                                  <td className="px-6 py-4 text-right text-gray-700">{formatNumber(row.urlKeywords)}</td>
                                </tr>
                              )))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">SERP data will load after you run a keyword search.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "tracked" && (
        <DomainResearchView clients={clients} clientsError={clientsError} />
      )}

    </div>
  );
};

export default KeywordsPage;
