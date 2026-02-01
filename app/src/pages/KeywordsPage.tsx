import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Search,
  RefreshCw,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Trash2,
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
import ConfirmDialog from "@/components/ConfirmDialog";
import api from "@/lib/api";
import { Client, Keyword } from "@/store/slices/clientSlice";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { RootState } from "@/store";

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
  if (Math.abs(value) >= 1000) {
    return Math.round(value).toLocaleString();
  }
  return value.toString();
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

function parseBulkKeywords(input: string): string[] {
  const raw = input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(raw)];
}

// Format location name with spaces after commas for better readability
function formatLocationName(locationName: string): string {
  if (!locationName) return "";
  return locationName
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

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
  const { user } = useSelector((state: RootState) => state.auth);
  const [activeTab, setActiveTab] = useState<TabId>("tracked");

  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const [trackedKeywords, setTrackedKeywords] = useState<Keyword[]>([]);
  const [trackedLoading, setTrackedLoading] = useState(false);
  const [trackedError, setTrackedError] = useState<string | null>(null);
  const [trackSearchTerm, setTrackSearchTerm] = useState("");
  const [refreshingKeywordIds, setRefreshingKeywordIds] = useState<Record<string, boolean>>({});
  const [deletingKeywordIds, setDeletingKeywordIds] = useState<Record<string, boolean>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; keywordId: string | null; keywordText: string | null }>({
    isOpen: false,
    keywordId: null,
    keywordText: null,
  });

  const [newKeywordValue, setNewKeywordValue] = useState("");
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [addingProgress, setAddingProgress] = useState<{ current: number; total: number } | null>(null);
  const [addKeywordMessage, setAddKeywordMessage] = useState<string | null>(null);

  type LocationOption = {
    location_code?: number;
    location_name: string;
    country_iso_code?: string | null;
    location_type?: string | null;
  };

  const DEFAULT_TRACK_LOCATION: LocationOption = {
    location_code: 2840,
    location_name: "United States",
    country_iso_code: "US",
    location_type: "Country",
  };

  const [trackLocationQuery, setTrackLocationQuery] = useState<string>(DEFAULT_TRACK_LOCATION.location_name);
  const [trackLocationSelected, setTrackLocationSelected] = useState<LocationOption>(DEFAULT_TRACK_LOCATION);
  const [trackLocationOptions, setTrackLocationOptions] = useState<LocationOption[]>([]);
  const [trackLocationLoading, setTrackLocationLoading] = useState(false);
  const [trackLocationOpen, setTrackLocationOpen] = useState(false);
  const locationBoxRef = useRef<HTMLDivElement | null>(null);

  const [researchSeed, setResearchSeed] = useState("");
  const [researchLocation, setResearchLocation] = useState<number>(DEFAULT_LOCATION);
  const [researchLanguage, setResearchLanguage] = useState<string>(DEFAULT_LANGUAGE);
  const [researchLimit, setResearchLimit] = useState<number>(10);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchResults, setResearchResults] = useState<ResearchKeyword[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, boolean>>({});
  const [assignClientId, setAssignClientId] = useState<string | null>(null);
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
  const [serpFeatureExpanded, setSerpFeatureExpanded] = useState<{ local_pack: boolean; people_also_ask: boolean; things_to_know: boolean }>({ local_pack: false, people_also_ask: false, things_to_know: false });
  const [serpAnalysisLoading, setSerpAnalysisLoading] = useState(false);
  const [serpAnalysisOffset, setSerpAnalysisOffset] = useState(0);

  useEffect(() => {
    const loadClients = async () => {
      try {
        setClientsLoading(true);
        setClientsError(null);
        const res = await api.get("/clients");
        const clientList: Client[] = Array.isArray(res.data) ? res.data : [];
        setClients(clientList);
        if (clientList.length > 0) {
          setSelectedClientId(clientList[0].id);
          setAssignClientId(clientList[0].id);
        }
      } catch (error: any) {
        console.error("Failed to fetch clients", error);
        const errorMsg = error?.response?.data?.message || "Unable to load clients";
        setClientsError(errorMsg);
        // Toast is already shown by API interceptor
      } finally {
        setClientsLoading(false);
      }
    };

    loadClients();
  }, []);

  useEffect(() => {
    if (!selectedClientId) return;

    const loadTrackedKeywords = async () => {
      try {
        setTrackedLoading(true);
        setTrackedError(null);
        const res = await api.get(`/seo/keywords/${selectedClientId}`);
        const keywordList: Keyword[] = Array.isArray(res.data) ? res.data : [];
        setTrackedKeywords(keywordList);
      } catch (error: any) {
        console.error("Failed to fetch tracked keywords", error);
        setTrackedKeywords([]);
        const errorMsg = error?.response?.data?.message || "Unable to load tracked keywords";
        setTrackedError(errorMsg);
        // Toast is already shown by API interceptor
      } finally {
        setTrackedLoading(false);
      }
    };

    loadTrackedKeywords();
  }, [selectedClientId]);

  const filteredTrackedKeywords = useMemo(() => {
    if (!trackSearchTerm) return trackedKeywords;
    const term = trackSearchTerm.toLowerCase();
    return trackedKeywords.filter((keyword) => keyword.keyword.toLowerCase().includes(term));
  }, [trackSearchTerm, trackedKeywords]);

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
      const suggestions: ResearchKeyword[] = Array.isArray(res.data) ? res.data : [];
      setResearchResults(suggestions);
      if (suggestions.length === 0) {
        setResearchError("No suggestions were found for this keyword. Try a different phrase.");
      }
    } catch (error: any) {
      console.error("Keyword research error", error);
      setResearchResults([]);
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
      if (assignClientId === selectedClientId) {
        const res = await api.get(`/seo/keywords/${assignClientId}`);
        const keywordList: Keyword[] = Array.isArray(res.data) ? res.data : [];
        setTrackedKeywords(keywordList);
      }
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
      const suggestions: ResearchKeyword[] = Array.isArray(res.data) ? res.data : [];
      setResearchResults(suggestions);
      if (suggestions.length === 0) setResearchError("No suggestions found for this keyword.");
    } catch (err: any) {
      setResearchResults([]);
      setResearchError(err?.response?.data?.message || "Unable to fetch suggestions.");
    } finally {
      setResearchLoading(false);
    }
  };

  const exportSerpToCsv = () => {
    if (!serpAnalysis?.items?.length) return;
    const headers = ["Position", "URL", "Domain", "Title"];
    const rows = serpAnalysis.items.map((r) => [r.position, r.url, r.domain, r.title ?? ""]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `serp-${(serpAnalysis.keyword || "keyword").replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("SERP exported to CSV");
  };

  const handleAddTrackedKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId) return;
    const trimmed = newKeywordValue.trim();
    if (!trimmed) {
      setAddKeywordMessage("Keyword is required.");
      return;
    }

    const keywords = parseBulkKeywords(trimmed);
    if (keywords.length === 0) {
      setAddKeywordMessage("No valid keywords. Separate with commas or new lines.");
      return;
    }

    try {
      setAddingKeyword(true);
      setAddKeywordMessage(null);
      const typedLocation = trackLocationQuery.trim();
      const selectedLocationName = (trackLocationSelected?.location_name || "").trim();
      const useSelected = !!selectedLocationName && selectedLocationName.toLowerCase() === typedLocation.toLowerCase();
      const locationNameToSend = typedLocation || selectedLocationName || DEFAULT_TRACK_LOCATION.location_name;
      const locationCode = useSelected ? trackLocationSelected?.location_code : undefined;

      if (keywords.length === 1) {
        // Single keyword: fetch DataForSEO and add
        await api.post(
          `/seo/keywords/${selectedClientId}`,
          {
            keyword: keywords[0],
            fetchFromDataForSEO: true,
            languageCode: DEFAULT_LANGUAGE,
            locationCode,
            location_name: locationNameToSend,
            include_clickstream_data: true,
            include_serp_info: true,
          },
          { timeout: 60000 }
        );
        toast.success("Keyword added and data fetched successfully!");
        setAddKeywordMessage("Keyword added successfully. Ranking data will be fetched automatically.");
      } else {
        // Multiple keywords: process in larger parallel batches for maximum speed while fetching all DataForSEO data
        let created = 0;
        let skipped = 0;
        let failed = 0;
        setAddingProgress({ current: 0, total: keywords.length });
        
        // Process keywords in batches of 10 for maximum parallel execution
        const BATCH_SIZE = 10;
        for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
          const batch = keywords.slice(i, i + BATCH_SIZE);
          
          // Process batch in parallel
          const batchPromises = batch.map(async (keyword) => {
            try {
              await api.post(
                `/seo/keywords/${selectedClientId}`,
                {
                  keyword: keyword,
                  fetchFromDataForSEO: true,
                  languageCode: DEFAULT_LANGUAGE,
                  locationCode,
                  location_name: locationNameToSend,
                  include_clickstream_data: true,
                  include_serp_info: true,
                },
                { timeout: 60000 }
              );
              return { success: true, keyword };
            } catch (err: any) {
              if (err?.response?.status === 400 && /already exists/i.test(String(err?.response?.data?.message ?? ""))) {
                return { success: false, skipped: true, keyword };
              } else {
                return { success: false, failed: true, keyword };
              }
            }
          });
          
          const batchResults = await Promise.all(batchPromises);
          
          // Count results
          batchResults.forEach((result) => {
            if (result.success) {
              created++;
            } else if (result.skipped) {
              skipped++;
            } else if (result.failed) {
              failed++;
            }
          });
          
          setAddingProgress({ current: Math.min(i + BATCH_SIZE, keywords.length), total: keywords.length });
          
          // Minimal delay between batches (reduced from 500ms to 100ms) to avoid overwhelming the API
          if (i + BATCH_SIZE < keywords.length) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        
        setAddingProgress(null);
        const parts: string[] = [];
        if (created > 0) parts.push(`${created} added`);
        if (skipped > 0) parts.push(`${skipped} skipped (already tracked)`);
        if (failed > 0) parts.push(`${failed} failed`);
        const msg = parts.join(". ") || "Done.";
        toast.success(msg);
        setAddKeywordMessage(created > 0 ? `${msg} keywords` : msg);
      }

      setNewKeywordValue("");
      const res = await api.get(`/seo/keywords/${selectedClientId}`);
      const keywordList: Keyword[] = Array.isArray(res.data) ? res.data : [];
      setTrackedKeywords(keywordList);
    } catch (error: any) {
      console.error("Failed to add keyword(s)", error);
      let errorMsg = error?.response?.data?.message || "Failed to add keyword(s).";
      if (error?.code === "ECONNABORTED" || String(error?.message || "").toLowerCase().includes("timeout")) {
        errorMsg = "Request timed out. Please try again.";
      }
      setAddKeywordMessage(errorMsg);
    } finally {
      setAddingKeyword(false);
      setAddingProgress(null);
    }
  };

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!locationBoxRef.current) return;
      if (!locationBoxRef.current.contains(e.target as Node)) {
        setTrackLocationOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  useEffect(() => {
    if (!trackLocationOpen) return;

    const q = trackLocationQuery.trim();
    if (q.length < 2) {
      setTrackLocationOptions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setTrackLocationLoading(true);
        const res = await api.get("/seo/locations", {
          params: { q, limit: 10 },
        });
        const items: LocationOption[] = Array.isArray(res.data) ? res.data : [];
        if (!cancelled) {
          setTrackLocationOptions(items);
        }
      } catch (err) {
        if (!cancelled) setTrackLocationOptions([]);
      } finally {
        if (!cancelled) setTrackLocationLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trackLocationOpen, trackLocationQuery]);

  const handleRefreshTrackedKeyword = async (keywordId: string) => {
    if (!selectedClientId) return;
    try {
      setRefreshingKeywordIds((prev) => ({ ...prev, [keywordId]: true }));
      const kw = trackedKeywords.find((k) => k.id === keywordId);
      await api.post(
        `/seo/keywords/${selectedClientId}/${keywordId}/refresh`,
        {
          // Prefer the keyword's stored locationName; backend will resolve locationCode.
          locationName: kw?.locationName || undefined,
          // Keep defaults for safety if locationName is missing.
          locationCode: kw?.locationName ? undefined : DEFAULT_LOCATION,
          languageCode: DEFAULT_LANGUAGE,
          include_clickstream_data: true,
          include_serp_info: true,
        },
        { timeout: 60000 }
      );
      toast.success("Keyword data refreshed successfully!");
      const res = await api.get(`/seo/keywords/${selectedClientId}`);
      const keywordList: Keyword[] = Array.isArray(res.data) ? res.data : [];
      setTrackedKeywords(keywordList);
    } catch (error: any) {
      console.error("Failed to refresh keyword", error);
      if (error?.code === "ECONNABORTED" || String(error?.message || "").toLowerCase().includes("timeout")) {
        toast.error("Refresh timed out. Please try again (this can take ~30-60 seconds).");
      }
      // Toast is already shown by API interceptor
    } finally {
      setRefreshingKeywordIds((prev) => ({ ...prev, [keywordId]: false }));
    }
  };

  const handleDeleteTrackedKeyword = (keywordId: string, keywordText: string) => {
    setDeleteConfirm({ isOpen: true, keywordId, keywordText });
  };

  const confirmDeleteTrackedKeyword = async () => {
    if (!deleteConfirm.keywordId || !selectedClientId) return;
    
    try {
      setDeletingKeywordIds((prev) => ({ ...prev, [deleteConfirm.keywordId!]: true }));
      await api.delete(`/seo/keywords/${selectedClientId}/${deleteConfirm.keywordId}`);
      toast.success("Keyword deleted successfully!");
      
      // Refresh the keyword list
      const res = await api.get(`/seo/keywords/${selectedClientId}`);
      const keywordList: Keyword[] = Array.isArray(res.data) ? res.data : [];
      setTrackedKeywords(keywordList);
      setDeleteConfirm({ isOpen: false, keywordId: null, keywordText: null });
    } catch (error: any) {
      console.error("Failed to delete keyword", error);
      toast.error(error?.response?.data?.message || "Failed to delete keyword");
      setDeleteConfirm({ isOpen: false, keywordId: null, keywordText: null });
    } finally {
      setDeletingKeywordIds((prev) => ({ ...prev, [deleteConfirm.keywordId!]: false }));
    }
  };

  return (
    <div className="p-8 space-y-8 bg-gradient-to-br from-gray-50 via-white to-gray-50 min-h-screen">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Keyword Hub</h1>
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
            Manually Add Keywords
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
        <div className="space-y-6">
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
                <div className="min-w-[240px]">
                  <div className="flex h-11 overflow-hidden rounded-xl border-2 border-primary-500 bg-white shadow-sm focus-within:ring-2 focus-within:ring-primary-200">
                    <div className="flex items-center bg-primary-600 px-3 text-[11px] font-semibold uppercase tracking-wider text-white">
                      Client
                    </div>
                    <select
                      value={assignClientId || ""}
                      onChange={(e) => setAssignClientId(e.target.value)}
                      className="h-11 w-full bg-white pl-6 pr-4 text-sm font-medium text-gray-900 focus:outline-none"
                    >
                      <option value="" disabled>
                        Choose client
                      </option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name || client.domain}
                        </option>
                      ))}
                    </select>
                  </div>
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
                      <div className="mt-3 flex items-center gap-2">
                        <div className={`w-12 h-12 rounded-full border-4 flex items-center justify-center ${keywordDetail.keywordDifficulty >= 70 ? "border-red-200" : keywordDetail.keywordDifficulty >= 40 ? "border-amber-200" : "border-green-200"}`}>
                          <span className={`text-sm font-bold ${keywordDetail.keywordDifficulty >= 70 ? "text-red-600" : keywordDetail.keywordDifficulty >= 40 ? "text-amber-600" : "text-green-600"}`}>{keywordDetail.keywordDifficulty}%</span>
                        </div>
                        <span className="text-sm font-medium text-gray-600">{keywordDetail.difficultyLabel}</span>
                      </div>
                      <p className="mt-2 text-xs text-gray-500">{getDifficultyDescription(keywordDetail.difficultyLabel)}</p>
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
                            <BarChart data={(keywordDetail.monthlySearches || []).slice(-12).map((m) => ({ month: `${m.month}/${String(m.year).slice(2)}`, vol: m.searchVolume }))}>
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

            {/* Keyword Ideas - screenshot 2: Variations, Questions, Keyword Strategy */}
            {researchResults.length > 0 && (
              <div className="border-t border-gray-200 p-6 bg-white">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Keyword Ideas</h3>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="rounded-xl border border-gray-200 p-5 shadow-sm bg-white">
                    <h4 className="font-semibold text-gray-900">Keyword Variations</h4>
                    {(() => {
                      const variations = researchResults.filter((r) => !r.keyword.includes("?") && !/^(who|what|where|when|why|how|can|is|are|do|does)\s/i.test(r.keyword));
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
                      const questions = researchResults.filter((r) => r.keyword.includes("?") || /^(who|what|where|when|why|how|can|is|are|do|does)\s/i.test(r.keyword));
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
                      <div className="rounded-full bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-800">{researchSeed || "seed"}</div>
                      <div className="w-px h-4 bg-gray-300" />
                      <div className="flex flex-col gap-2 mt-2 w-full max-w-xs">
                        {researchResults.slice(0, 6).map((r) => {
                          const maxVol = Math.max(...researchResults.map((x) => x.searchVolume || 0), 1);
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
                    <button type="button" onClick={exportSerpToCsv} disabled={!serpAnalysis?.items?.length} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      <Download className="h-4 w-4" />
                      Export
                    </button>
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
                          {off + 1}-{off + 10}
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
                            <th className="px-6 py-3 text-left font-semibold text-gray-700 uppercase text-xs">URL</th>
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
                                type DomainRow = { domain: string; urls: string[]; title: string };
                                const byDomain = (serpAnalysis.items || []).reduce<Record<string, DomainRow>>((acc, row: { position: number; url: string; domain: string; title: string }) => {
                                  const d = row.domain || "—";
                                  if (!acc[d]) acc[d] = { domain: d, urls: [], title: row.title || "" };
                                  acc[d].urls.push(row.url);
                                  return acc;
                                }, {});
                                return Object.entries(byDomain).map(([domain, data]: [string, DomainRow]) => (
                                  <tr key={domain} className="hover:bg-gray-50">
                                    <td className="px-6 py-4">
                                      <a href={data.urls[0]} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline inline-flex items-center gap-1">{domain}<ExternalLink className="h-3 w-3" /></a>
                                      <p className="text-xs text-gray-500 mt-0.5">{data.urls.length} URL(s)</p>
                                    </td>
                                    <td className="px-6 py-4 text-right text-gray-700">—</td>
                                    <td className="px-6 py-4 text-right text-gray-700">—</td>
                                    <td className="px-6 py-4 text-right text-gray-700">—</td>
                                    <td className="px-6 py-4 text-right text-gray-700">—</td>
                                    <td className="px-6 py-4 text-right text-gray-700">—</td>
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
                                  <td className="px-6 py-4 text-right text-gray-700">{row.pageAs ?? "—"}</td>
                                  <td className="px-6 py-4 text-right text-gray-700">{row.refDomains ?? "—"}</td>
                                  <td className="px-6 py-4 text-right text-gray-700">{row.backlinks ?? "—"}</td>
                                  <td className="px-6 py-4 text-right text-gray-700">{row.searchTraffic ?? "—"}</td>
                                  <td className="px-6 py-4 text-right text-gray-700">{row.urlKeywords ?? "—"}</td>
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
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 space-y-6">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-gray-900">Manually add keywords</h2>
                <p className="text-sm text-gray-500">
                  Keywords that are currently being monitored for ranking performance.
                </p>
              </div>
              <div className="flex items-end gap-4 flex-shrink-0">
                <div className="flex-shrink-0">
                  <div className="flex h-11 overflow-hidden rounded-xl border-2 border-primary-500 bg-white shadow-sm focus-within:ring-2 focus-within:ring-primary-200">
                    <div className="flex items-center justify-center bg-primary-600 px-5 text-[11px] font-semibold uppercase tracking-wider text-white whitespace-nowrap flex-shrink-0">
                      Client
                    </div>
                    <select
                      value={selectedClientId || ""}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      className="h-11 min-w-[200px] bg-white pl-6 pr-4 py-2 text-sm font-medium text-gray-900 focus:outline-none"
                    >
                      <option value="" disabled>
                        Select client
                      </option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name || client.domain}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="relative flex-1 max-w-md">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={trackSearchTerm}
                    onChange={(e) => setTrackSearchTerm(e.target.value)}
                    placeholder="Search tracked keywords"
                    className="h-11 w-full rounded-xl border-2 border-gray-300 bg-white pl-10 pr-4 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all duration-150 shadow-sm hover:shadow"
                  />
                </div>
              </div>
            </div>

            <form
              onSubmit={handleAddTrackedKeyword}
              className="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50/80 to-white p-6 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Keywords
                  </label>
                  <div className="mt-1 flex flex-col gap-3">
                    <textarea
                      value={newKeywordValue}
                      onChange={(e) => setNewKeywordValue(e.target.value)}
                      placeholder="e.g. best running shoes — or paste many (comma or new line separated)"
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-y transition-all duration-150 shadow-sm hover:shadow"
                      required
                    />
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <div ref={locationBoxRef} className="relative flex-1">
                        <label className="sr-only">Location</label>
                        <input
                          type="text"
                          value={trackLocationQuery}
                          onChange={(e) => {
                            // Allow user to type freely without formatting
                            const rawValue = e.target.value;
                            setTrackLocationQuery(rawValue);
                            setTrackLocationOpen(true);
                          }}
                          onBlur={() => {
                            // Format on blur to ensure clean display
                            if (trackLocationQuery) {
                              setTrackLocationQuery(formatLocationName(trackLocationQuery));
                            }
                          }}
                          onFocus={() => setTrackLocationOpen(true)}
                          placeholder="Search location"
                          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all duration-150 shadow-sm hover:shadow"
                        />
                        {trackLocationOpen && (
                          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                            <div className="max-h-64 overflow-y-auto">
                              {trackLocationLoading ? (
                                <div className="px-3 py-2 text-sm text-gray-500">Searching…</div>
                              ) : trackLocationQuery.trim().length < 2 ? (
                                <div className="px-3 py-2 text-sm text-gray-500">Type 2+ characters to search.</div>
                              ) : trackLocationOptions.length === 0 ? (
                                <div className="px-3 py-2 text-sm text-gray-500">No locations found.</div>
                              ) : (
                                trackLocationOptions.map((opt) => (
                                  <button
                                    key={`${opt.location_name}-${opt.country_iso_code ?? ""}-${opt.location_type ?? ""}`}
                                    type="button"
                                    onClick={() => {
                                      setTrackLocationSelected(opt);
                                      // Format location name when selecting from dropdown
                                      setTrackLocationQuery(formatLocationName(opt.location_name));
                                      setTrackLocationOpen(false);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                                  >
                                    <div className="font-medium text-gray-900">{formatLocationName(opt.location_name)}</div>
                                    <div className="text-xs text-gray-500">
                                      {(opt.location_type || "Location")}
                                      {opt.country_iso_code ? ` • ${opt.country_iso_code}` : ""}
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        type="submit"
                        disabled={addingKeyword || !selectedClientId}
                        className="inline-flex items-center justify-center rounded-xl bg-primary-600 px-6 py-3 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60 transition-all duration-200 shadow-md hover:shadow-lg w-full sm:w-auto"
                      >
                        {addingKeyword ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            {addingProgress
                              ? `Adding ${addingProgress.current}/${addingProgress.total}…`
                              : "Tracking…"}
                          </>
                        ) : (
                          <>
                            <Plus className="h-4 w-4 mr-2" />
                            Track
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    All data is fetched from data for SEO, for each keyword 
                  </p>
                </div>
              </div>
              {addKeywordMessage && (
                <div className="absolute mt-16 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
                  {addKeywordMessage}
                </div>
              )}
            </form>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                      Keyword
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                      Search volume
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs" title="From DataForSEO (0–100). Low-volume keywords may show 0.">
                      Keyword Difficulty
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                      CPC
                    </th>
                    <th className="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider text-xs">
                      Current position
                    </th>
                    <th className="px-6 py-4">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {trackedLoading || clientsLoading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center text-gray-500">
                        <span className="inline-flex items-center gap-3 text-sm font-medium">
                          <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
                          Loading tracked keywords…
                        </span>
                      </td>
                    </tr>
                  ) : trackedError ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center text-sm text-rose-600 font-medium">
                        {trackedError}
                      </td>
                    </tr>
                  ) : filteredTrackedKeywords.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center text-sm text-gray-500 font-medium">
                        {selectedClientId
                          ? "No tracked keywords yet. Use the research tab or add one manually."
                          : "Select a client to view tracked keywords."}
                      </td>
                    </tr>
                  ) : (
                    filteredTrackedKeywords.map((keyword) => (
                      <tr key={keyword.id} className="hover:bg-gray-50 transition-colors duration-150">
                        <td className="px-6 py-4">
                          <p className="font-semibold text-gray-900">{keyword.keyword}</p>
                          {keyword.googleUrl && (
                            <a
                              href={keyword.googleUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary-600 hover:text-primary-700 hover:underline font-medium mt-1 inline-block transition-colors"
                            >
                              View ranking URL
                            </a>
                          )}
                        </td>
                        <td className="px-6 py-4 text-gray-700 font-medium">
                          {formatNumber(keyword.searchVolume)}
                        </td>
                        <td className="px-6 py-4 text-gray-700 font-medium">
                          {keyword.difficulty !== null && keyword.difficulty !== undefined
                            ? Math.round(Number(keyword.difficulty))
                            : "—"}
                        </td>
                        <td className="px-6 py-4 text-gray-700 font-medium">
                          {keyword.cpc ? `$${Number(keyword.cpc).toFixed(2)}` : "—"}
                        </td>
                        <td className="px-6 py-4 text-gray-700 font-medium">
                          {keyword.currentPosition ?? "—"}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {user?.role === "SUPER_ADMIN" && (
                              <button
                                type="button"
                                onClick={() => handleRefreshTrackedKeyword(keyword.id)}
                                disabled={Boolean(refreshingKeywordIds[keyword.id])}
                                className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-60 transition-all duration-150 shadow-sm hover:shadow"
                                title="Refresh keyword data from DataForSEO"
                              >
                                {refreshingKeywordIds[keyword.id] ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteTrackedKeyword(keyword.id, keyword.keyword)}
                              disabled={Boolean(deletingKeywordIds[keyword.id])}
                              className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white p-2 text-red-600 hover:bg-red-50 hover:border-red-300 disabled:opacity-60 transition-all duration-150 shadow-sm hover:shadow"
                              title="Delete this keyword"
                            >
                              {deletingKeywordIds[keyword.id] ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, keywordId: null, keywordText: null })}
        onConfirm={confirmDeleteTrackedKeyword}
        title="Delete Keyword"
        message={`Are you sure you want to delete the keyword "${deleteConfirm.keywordText}"? This action cannot be undone and all tracking data for this keyword will be permanently removed.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
};

export default KeywordsPage;
