import React, { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Search,
  RefreshCw,
  Plus,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
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

const KeywordsPage: React.FC = () => {
  const { user } = useSelector((state: RootState) => state.auth);
  const [activeTab, setActiveTab] = useState<TabId>("research");

  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const [trackedKeywords, setTrackedKeywords] = useState<Keyword[]>([]);
  const [trackedLoading, setTrackedLoading] = useState(false);
  const [trackedError, setTrackedError] = useState<string | null>(null);
  const [trackSearchTerm, setTrackSearchTerm] = useState("");
  const [refreshingKeywordIds, setRefreshingKeywordIds] = useState<Record<string, boolean>>({});

  const [newKeywordValue, setNewKeywordValue] = useState("");
  const [newKeywordVolume, setNewKeywordVolume] = useState("");
  const [newKeywordDifficulty, setNewKeywordDifficulty] = useState("");
  const [newKeywordCpc, setNewKeywordCpc] = useState("");
  const [newKeywordCompetition, setNewKeywordCompetition] = useState("");
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [addKeywordMessage, setAddKeywordMessage] = useState<string | null>(null);

  const [researchSeed, setResearchSeed] = useState("");
  const [researchLocation, setResearchLocation] = useState<number>(DEFAULT_LOCATION);
  const [researchLanguage, setResearchLanguage] = useState<string>(DEFAULT_LANGUAGE);
  const [researchLimit, setResearchLimit] = useState<number>(50);
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

      await Promise.all(
        keywords.map((item) =>
          api.post(`/seo/keywords/${assignClientId}`, {
            keyword: item.keyword,
            searchVolume: Number(item.searchVolume) || 0,
            difficulty: item.difficulty ?? undefined,
            cpc: item.cpc ?? undefined,
            competition:
              item.competitionLevel ||
              (item.competition !== null ? item.competition.toFixed(2) : undefined),
            fetchFromDataForSEO: false,
          })
        )
      );

      toast.success(`Added ${keywords.length} keyword${keywords.length > 1 ? "s" : ""} to tracking.`);
      setAssignMessage(`Added ${keywords.length} keyword${keywords.length > 1 ? "s" : ""} to tracking.`);
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
    if (!newKeywordValue.trim()) {
      setAddKeywordMessage("Keyword is required.");
      return;
    }

    try {
      setAddingKeyword(true);
      setAddKeywordMessage(null);
      await api.post(`/seo/keywords/${selectedClientId}`, {
        keyword: newKeywordValue.trim(),
        searchVolume: Number(newKeywordVolume) || 0,
        difficulty: newKeywordDifficulty ? Number(newKeywordDifficulty) : undefined,
        cpc: newKeywordCpc ? Number(newKeywordCpc) : undefined,
        competition: newKeywordCompetition || undefined,
        fetchFromDataForSEO: false,
      });

      toast.success("Keyword added successfully!");
      setAddKeywordMessage("Keyword added successfully.");
      setNewKeywordValue("{}");
      setNewKeywordVolume("{}");
      setNewKeywordDifficulty("{}");
      setNewKeywordCpc("{}");
      setNewKeywordCompetition("{}");

      const res = await api.get(`/seo/keywords/${selectedClientId}`);
      const keywordList: Keyword[] = Array.isArray(res.data) ? res.data : [];
      setTrackedKeywords(keywordList);
    } catch (error: any) {
      console.error("Failed to add keyword", error);
      const errorMsg = error?.response?.data?.message || "Failed to add keyword.";
      setAddKeywordMessage(errorMsg);
      // Toast is already shown by API interceptor
    } finally {
      setAddingKeyword(false);
    }
  };

  const handleRefreshTrackedKeyword = async (keywordId: string) => {
    if (!selectedClientId) return;
    try {
      setRefreshingKeywordIds((prev) => ({ ...prev, [keywordId]: true }));
      await api.post(`/seo/keywords/${selectedClientId}/${keywordId}/refresh`, {
        locationCode: DEFAULT_LOCATION,
        languageCode: DEFAULT_LANGUAGE,
      });
      toast.success("Keyword data refreshed successfully!");
      const res = await api.get(`/seo/keywords/${selectedClientId}`);
      const keywordList: Keyword[] = Array.isArray(res.data) ? res.data : [];
      setTrackedKeywords(keywordList);
    } catch (error: any) {
      console.error("Failed to refresh keyword", error);
      // Toast is already shown by API interceptor
    } finally {
      setRefreshingKeywordIds((prev) => ({ ...prev, [keywordId]: false }));
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
          <button
            onClick={() => setActiveTab("tracked")}
            className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium ${
              activeTab === "tracked"
                ? "bg-primary-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Tracked Keywords
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
                <select
                  value={assignClientId || ""}
                  onChange={(e) => setAssignClientId(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
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
                <button
                  type="button"
                  onClick={handleAssignSelected}
                  disabled={assigningKeywords || Object.values(selectedSuggestions).every((value) => !value)}
                  className="inline-flex items-center rounded-lg border border-primary-300 px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-60"
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
                      Competition
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
                <h2 className="text-lg font-semibold text-gray-900">Tracked keywords</h2>
                <p className="text-sm text-gray-500">
                  Keywords that are currently being monitored for ranking performance.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={selectedClientId || ""}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
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
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={trackSearchTerm}
                    onChange={(e) => setTrackSearchTerm(e.target.value)}
                    placeholder="Search tracked keywords"
                    className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                </div>
              </div>
            </div>

            <form
              onSubmit={handleAddTrackedKeyword}
              className="grid grid-cols-1 md:grid-cols-5 gap-3 rounded-lg border border-gray-200 bg-gray-50/60 p-4"
            >
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Keyword
                </label>
                <input
                  type="text"
                  value={newKeywordValue}
                  onChange={(e) => setNewKeywordValue(e.target.value)}
                  placeholder="e.g. best running shoes"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Search volume
                </label>
                <input
                  type="number"
                  min={0}
                  value={newKeywordVolume}
                  onChange={(e) => setNewKeywordVolume(e.target.value)}
                  placeholder="0"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Difficulty (0-100)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={newKeywordDifficulty}
                  onChange={(e) => setNewKeywordDifficulty(e.target.value)}
                  placeholder="—"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  CPC (USD)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={newKeywordCpc}
                  onChange={(e) => setNewKeywordCpc(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Competition
                </label>
                <input
                  type="text"
                  value={newKeywordCompetition}
                  onChange={(e) => setNewKeywordCompetition(e.target.value)}
                  placeholder="e.g. 0.45 or Medium"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
              <div className="md:col-span-5 flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  Add a keyword manually or use the research tab to discover new opportunities.
                </p>
                <button
                  type="submit"
                  disabled={addingKeyword || !selectedClientId}
                  className="inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
                >
                  {addingKeyword ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Add keyword
                    </>
                  )}
                </button>
              </div>
              {addKeywordMessage && (
                <div className="md:col-span-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
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
                      Difficulty
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      CPC
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Competition
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
                          {user?.role === "SUPER_ADMIN" && (
                          <button
                            type="button"
                            onClick={() => handleRefreshTrackedKeyword(keyword.id)}
                            disabled={Boolean(refreshingKeywordIds[keyword.id])}
                            className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-60"
                              title="Refresh keyword data from DataForSEO"
                          >
                            {refreshingKeywordIds[keyword.id] ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                                Updating…
                              </>
                            ) : (
                              <>
                                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                Refresh
                              </>
                            )}
                          </button>
                          )}
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
    </div>
  );
};

export default KeywordsPage;
