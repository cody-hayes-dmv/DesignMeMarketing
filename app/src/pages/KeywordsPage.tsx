import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Search,
  RefreshCw,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Trash2,
} from "lucide-react";
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

function parseBulkKeywords(input: string): string[] {
  const raw = input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(raw)];
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
        // Multiple keywords: add each via single-keyword API with DataForSEO so metrics populate
        let created = 0;
        let skipped = 0;
        let failed = 0;
        setAddingProgress({ current: 0, total: keywords.length });
        for (let i = 0; i < keywords.length; i++) {
          setAddingProgress({ current: i + 1, total: keywords.length });
          try {
            await api.post(
              `/seo/keywords/${selectedClientId}`,
              {
                keyword: keywords[i],
                fetchFromDataForSEO: true,
                languageCode: DEFAULT_LANGUAGE,
                locationCode,
                location_name: locationNameToSend,
                include_clickstream_data: true,
                include_serp_info: true,
              },
              { timeout: 60000 }
            );
            created++;
          } catch (err: any) {
            if (err?.response?.status === 400 && /already exists/i.test(String(err?.response?.data?.message ?? ""))) {
              skipped++;
            } else {
              failed++;
            }
          }
          if (i < keywords.length - 1) {
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
        setAddingProgress(null);
        const parts: string[] = [];
        if (created > 0) parts.push(`${created} added`);
        if (skipped > 0) parts.push(`${skipped} skipped (already tracked)`);
        if (failed > 0) parts.push(`${failed} failed`);
        const msg = parts.join(". ") || "Done.";
        toast.success(msg);
        setAddKeywordMessage(created > 0 ? `${msg} SEARCH VOLUME, KEYWORD DIFFICULTY, CPC, etc. fetched from DataForSEO.` : msg);
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
    <div className="p-8 space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Keyword Intelligence</h1>
          <p className="text-sm text-gray-600 mt-1">
            Research new keyword opportunities and track the phrases that matter for each client.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab("tracked")}
            className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium ${
              activeTab === "tracked"
                ? "bg-primary-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Manually Add Keywords
          </button>
          <button
            onClick={() => setActiveTab("research")}
            className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium ${
              activeTab === "research"
                ? "bg-primary-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
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
            className="bg-white rounded-xl border border-gray-200 p-6 space-y-4"
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
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
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
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
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
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
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
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
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
                className="inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
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

          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex flex-col gap-3 border-b border-gray-200 p-6 md:flex-row md:items-center md:justify-between">
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
                      className="h-11 w-full bg-white px-4 text-sm font-medium text-gray-900 focus:outline-none"
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
                  className="inline-flex h-11 items-center rounded-xl border-2 border-primary-300 bg-white px-4 text-sm font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-60"
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
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Keyword
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Search volume
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      CPC (USD)
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Competitive density 
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Difficulty
                    </th>
                    <th className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {researchLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                        <span className="inline-flex items-center gap-2 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                          Fetching keyword suggestions…
                        </span>
                      </td>
                    </tr>
                  ) : researchResults.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-500 text-sm">
                        Run a keyword search to see suggestions.
                      </td>
                    </tr>
                  ) : (
                    researchResults.map((result) => (
                      <tr key={result.keyword} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedSuggestions[result.keyword])}
                            onChange={() => toggleSuggestionSelection(result.keyword)}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-gray-900">{result.keyword}</p>
                            <p className="text-xs text-gray-500">
                              Seed: <span className="font-medium">{result.seed}</span>
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {formatNumber(result.searchVolume)}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {result.cpc && result.cpc > 0 ? `$${result.cpc.toFixed(2)}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {result.competitionLevel
                            ? result.competitionLevel
                            : result.competition !== null
                            ? result.competition.toFixed(2)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {result.difficulty !== null ? `${result.difficulty}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleAssignSingle(result)}
                            disabled={assigningKeywords}
                            className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-60"
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
          </div>
        </div>
      )}

      {activeTab === "tracked" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Manually add keywords</h2>
                <p className="text-sm text-gray-500">
                  Keywords that are currently being monitored for ranking performance.
                </p>
              </div>
              <div className="flex items-end gap-3">
                <div className="min-w-[240px]">
                  <div className="flex h-11 overflow-hidden rounded-xl border-2 border-primary-500 bg-white shadow-sm focus-within:ring-2 focus-within:ring-primary-200">
                    <div className="flex items-center bg-primary-600 px-3 text-[11px] font-semibold uppercase tracking-wider text-white">
                      Client
                    </div>
                    <select
                      value={selectedClientId || ""}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      className="h-11 w-full bg-white px-4 text-sm font-medium text-gray-900 focus:outline-none"
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
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={trackSearchTerm}
                    onChange={(e) => setTrackSearchTerm(e.target.value)}
                    placeholder="Search tracked keywords"
                    className="h-11 w-full rounded-xl border-2 border-gray-300 bg-white pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
              </div>
            </div>

            <form
              onSubmit={handleAddTrackedKeyword}
              className="rounded-lg border border-gray-200 bg-gray-50/60 p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Keywords
                  </label>
                  <div className="mt-1 flex flex-col sm:flex-row gap-3">
                    <textarea
                      value={newKeywordValue}
                      onChange={(e) => setNewKeywordValue(e.target.value)}
                      placeholder="e.g. best running shoes — or paste many (comma or new line separated)"
                      rows={3}
                      className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-y"
                      required
                    />
                    <div ref={locationBoxRef} className="relative w-full sm:w-72 flex-shrink-0">
                      <label className="sr-only">Location</label>
                      <input
                        type="text"
                        value={trackLocationQuery}
                        onChange={(e) => {
                          setTrackLocationQuery(e.target.value);
                          setTrackLocationOpen(true);
                        }}
                        onFocus={() => setTrackLocationOpen(true)}
                        placeholder="Search location"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
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
                                    setTrackLocationQuery(opt.location_name);
                                    setTrackLocationOpen(false);
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                                >
                                  <div className="font-medium text-gray-900">{opt.location_name}</div>
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
                      className="inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60 whitespace-nowrap"
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
                  <p className="mt-1 text-xs text-gray-500">
                    SEARCH VOLUME, KEYWORD DIFFICULTY, CPC, COMPETITIVE DENSITY and CURRENT POSITION are fetched from
                    DataForSEO for each keyword (single or multiple, comma/new line separated).
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

          <div className="bg-white rounded-xl border border-gray-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Keyword
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Search volume
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Keyword Difficulty
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      CPC
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Competitive density
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Current position
                    </th>
                    <th className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {trackedLoading || clientsLoading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                        <span className="inline-flex items-center gap-2 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                          Loading tracked keywords…
                        </span>
                      </td>
                    </tr>
                  ) : trackedError ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-sm text-rose-600">
                        {trackedError}
                      </td>
                    </tr>
                  ) : filteredTrackedKeywords.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-500">
                        {selectedClientId
                          ? "No tracked keywords yet. Use the research tab or add one manually."
                          : "Select a client to view tracked keywords."}
                      </td>
                    </tr>
                  ) : (
                    filteredTrackedKeywords.map((keyword) => (
                      <tr key={keyword.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{keyword.keyword}</p>
                          {keyword.googleUrl && (
                            <a
                              href={keyword.googleUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary-600 hover:underline"
                            >
                              View ranking URL
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {formatNumber(keyword.searchVolume)}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {keyword.difficulty !== null && keyword.difficulty !== undefined
                            ? Math.round(Number(keyword.difficulty))
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {keyword.cpc ? `$${Number(keyword.cpc).toFixed(2)}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {keyword.competition || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {keyword.currentPosition ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {user?.role === "SUPER_ADMIN" && (
                              <button
                                type="button"
                                onClick={() => handleRefreshTrackedKeyword(keyword.id)}
                                disabled={Boolean(refreshingKeywordIds[keyword.id])}
                                className="inline-flex items-center justify-center rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-60 transition-colors"
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
                              className="inline-flex items-center justify-center rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 disabled:opacity-60 transition-colors"
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
