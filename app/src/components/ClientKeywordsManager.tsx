import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { Keyword } from "@/store/slices/clientSlice";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { RootState } from "@/store";
import ConfirmDialog from "@/components/ConfirmDialog";

const DEFAULT_LANGUAGE = "en";
const KEYWORDS_PAGE_SIZES = [25, 50, 100, 250] as const;

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

function parseBulkKeywords(input: string): string[] {
  const raw = input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(raw)];
}

function formatLocationName(locationName: string): string {
  if (!locationName) return "";
  return locationName
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

const formatNumber = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString();
  return value.toString();
};

interface ClientKeywordsManagerProps {
  clientId: string;
  /** When true, show client selector + search bar row (for Keyword Hub). When false (e.g. Client Dashboard), hide it. */
  showClientSelector?: boolean;
  /** For Keyword Hub: clients list and selected id + onChange */
  clients?: { id: string; name?: string; domain?: string }[];
  selectedClientId?: string | null;
  onClientChange?: (clientId: string) => void;
  trackSearchTerm?: string;
  onTrackSearchTermChange?: (value: string) => void;
}

const ClientKeywordsManager: React.FC<ClientKeywordsManagerProps> = ({
  clientId,
  showClientSelector = false,
  clients = [],
  selectedClientId = null,
  onClientChange,
  trackSearchTerm: externalTrackSearchTerm,
  onTrackSearchTermChange,
}) => {
  const { user } = useSelector((state: RootState) => state.auth);
  const [newKeywordValue, setNewKeywordValue] = useState("");
  const [addingKeyword, setAddingKeyword] = useState(false);
  const [addingProgress, setAddingProgress] = useState<{ current: number; total: number } | null>(null);
  const [addKeywordMessage, setAddKeywordMessage] = useState<string | null>(null);
  const [trackedKeywords, setTrackedKeywords] = useState<Keyword[]>([]);
  const [trackedLoading, setTrackedLoading] = useState(false);
  const [trackedError, setTrackedError] = useState<string | null>(null);
  const [trackSearchTermInternal, setTrackSearchTermInternal] = useState("");
  const [trackLocationQuery, setTrackLocationQuery] = useState<string>(DEFAULT_TRACK_LOCATION.location_name);
  const [trackLocationSelected, setTrackLocationSelected] = useState<LocationOption>(DEFAULT_TRACK_LOCATION);
  const [trackLocationOptions, setTrackLocationOptions] = useState<LocationOption[]>([]);
  const [trackLocationLoading, setTrackLocationLoading] = useState(false);
  const [trackLocationOpen, setTrackLocationOpen] = useState(false);
  const locationBoxRef = useRef<HTMLDivElement | null>(null);
  const [refreshingKeywordIds, setRefreshingKeywordIds] = useState<Record<string, boolean>>({});
  const [deletingKeywordIds, setDeletingKeywordIds] = useState<Record<string, boolean>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; keywordId: string | null; keywordText: string | null }>({
    isOpen: false,
    keywordId: null,
    keywordText: null,
  });
  const [keywordsPageSize, setKeywordsPageSize] = useState<(typeof KEYWORDS_PAGE_SIZES)[number]>(25);
  const [keywordsPage, setKeywordsPage] = useState(1);

  const trackSearchTerm = externalTrackSearchTerm !== undefined ? externalTrackSearchTerm : trackSearchTermInternal;
  const setTrackSearchTerm = onTrackSearchTermChange || setTrackSearchTermInternal;

  const effectiveClientId = clientId || selectedClientId || "";
  const filteredKeywords = trackSearchTerm
    ? trackedKeywords.filter((k) => k.keyword.toLowerCase().includes(trackSearchTerm.toLowerCase()))
    : trackedKeywords;

  const keywordsPagination = useMemo(() => {
    const totalRows = filteredKeywords.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / keywordsPageSize));
    const page = Math.min(Math.max(1, keywordsPage), totalPages);
    const startIdx = (page - 1) * keywordsPageSize;
    const endIdx = Math.min(totalRows, startIdx + keywordsPageSize);
    const from = totalRows === 0 ? 0 : startIdx + 1;
    const to = endIdx;
    const rows = filteredKeywords.slice(startIdx, endIdx);
    return { totalRows, totalPages, page, from, to, rows };
  }, [filteredKeywords, keywordsPage, keywordsPageSize]);

  useEffect(() => {
    setKeywordsPage(1);
  }, [trackSearchTerm, effectiveClientId]);

  useEffect(() => {
    setKeywordsPage(1);
  }, [keywordsPageSize]);

  useEffect(() => {
    setKeywordsPage((p) => Math.min(p, keywordsPagination.totalPages));
  }, [keywordsPagination.totalPages]);

  useEffect(() => {
    const validClientId = typeof effectiveClientId === "string" && effectiveClientId.trim().length > 0;
    if (!validClientId) {
      setTrackedKeywords([]);
      setTrackedError(null);
      setTrackedLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setTrackedLoading(true);
      setTrackedError(null);
      try {
        const res = await api.get(`/seo/keywords/${effectiveClientId.trim()}`);
        if (!cancelled) {
          setTrackedKeywords(Array.isArray(res.data) ? res.data : []);
        }
      } catch (error: any) {
        if (!cancelled) {
          setTrackedError(error?.response?.data?.message || "Unable to load tracked keywords");
          setTrackedKeywords([]);
        }
      } finally {
        if (!cancelled) setTrackedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveClientId]);

  const handleAddTrackedKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveClientId) return;
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
        await api.post(
          `/seo/keywords/${effectiveClientId}`,
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
        setAddKeywordMessage("Keyword added successfully.");
      } else {
        let created = 0, skipped = 0, failed = 0;
        setAddingProgress({ current: 0, total: keywords.length });
        const BATCH_SIZE = 10;
        for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
          const batch = keywords.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async (keyword) => {
              try {
                await api.post(
                  `/seo/keywords/${effectiveClientId}`,
                  {
                    keyword,
                    fetchFromDataForSEO: true,
                    languageCode: DEFAULT_LANGUAGE,
                    locationCode,
                    location_name: locationNameToSend,
                    include_clickstream_data: true,
                    include_serp_info: true,
                  },
                  { timeout: 60000 }
                );
                return { success: true };
              } catch (err: any) {
                if (err?.response?.status === 400 && /already exists/i.test(String(err?.response?.data?.message ?? ""))) {
                  return { skipped: true };
                }
                return { failed: true };
              }
            })
          );
          results.forEach((r) => {
            if (r.success) created++;
            else if ((r as any).skipped) skipped++;
            else failed++;
          });
          setAddingProgress({ current: Math.min(i + BATCH_SIZE, keywords.length), total: keywords.length });
          if (i + BATCH_SIZE < keywords.length) await new Promise((r) => setTimeout(r, 100));
        }
        setAddingProgress(null);
        const parts: string[] = [];
        if (created > 0) parts.push(`${created} added`);
        if (skipped > 0) parts.push(`${skipped} skipped (already tracked)`);
        if (failed > 0) parts.push(`${failed} failed`);
        toast.success(parts.join(". ") || "Done.");
        setAddKeywordMessage(parts.join(". ") || "Done.");
      }
      setNewKeywordValue("");
      const res = await api.get(`/seo/keywords/${effectiveClientId}`);
      setTrackedKeywords(Array.isArray(res.data) ? res.data : []);
    } catch (error: any) {
      const msg = error?.response?.data?.message || "Failed to add keyword(s).";
      setAddKeywordMessage(error?.code === "ECONNABORTED" ? "Request timed out." : msg);
    } finally {
      setAddingKeyword(false);
      setAddingProgress(null);
    }
  };

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (locationBoxRef.current && !locationBoxRef.current.contains(e.target as Node)) {
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
    const t = setTimeout(async () => {
      try {
        setTrackLocationLoading(true);
        const res = await api.get("/seo/locations", { params: { q, limit: 10 } });
        const items: LocationOption[] = Array.isArray(res.data) ? res.data : [];
        if (!cancelled) setTrackLocationOptions(items);
      } catch {
        if (!cancelled) setTrackLocationOptions([]);
      } finally {
        if (!cancelled) setTrackLocationLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [trackLocationOpen, trackLocationQuery]);

  const handleRefreshTrackedKeyword = async (keywordId: string) => {
    if (!effectiveClientId) return;
    try {
      setRefreshingKeywordIds((p) => ({ ...p, [keywordId]: true }));
      const kw = trackedKeywords.find((k) => k.id === keywordId);
      await api.post(
        `/seo/keywords/${effectiveClientId}/${keywordId}/refresh`,
        {
          locationName: kw?.locationName,
          locationCode: kw?.locationName ? undefined : 2840,
          languageCode: DEFAULT_LANGUAGE,
          include_clickstream_data: true,
          include_serp_info: true,
        },
        { timeout: 60000 }
      );
      toast.success("Keyword data refreshed!");
      const res = await api.get(`/seo/keywords/${effectiveClientId}`);
      setTrackedKeywords(Array.isArray(res.data) ? res.data : []);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Refresh failed.");
    } finally {
      setRefreshingKeywordIds((p) => ({ ...p, [keywordId]: false }));
    }
  };

  const handleDeleteTrackedKeyword = (keywordId: string, keywordText: string) => {
    setDeleteConfirm({ isOpen: true, keywordId, keywordText });
  };

  const confirmDeleteTrackedKeyword = async () => {
    if (!deleteConfirm.keywordId || !effectiveClientId) return;
    try {
      setDeletingKeywordIds((p) => ({ ...p, [deleteConfirm.keywordId!]: true }));
      await api.delete(`/seo/keywords/${effectiveClientId}/${deleteConfirm.keywordId}`);
      toast.success("Keyword deleted.");
      const res = await api.get(`/seo/keywords/${effectiveClientId}`);
      setTrackedKeywords(Array.isArray(res.data) ? res.data : []);
      setDeleteConfirm({ isOpen: false, keywordId: null, keywordText: null });
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Delete failed.");
    } finally {
      setDeletingKeywordIds((p) => ({ ...p, [deleteConfirm.keywordId!]: false }));
    }
  };

  if (!effectiveClientId) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
        Select a client to view and add tracked keywords.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 space-y-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900">Manually add keywords</h2>
            <p className="text-sm text-gray-500">Keywords that are currently being monitored for ranking performance.</p>
          </div>
          {showClientSelector && (
            <div className="flex items-end gap-4 flex-shrink-0">
              <div className="flex h-11 overflow-hidden rounded-xl border-2 border-primary-500 bg-white shadow-sm">
                <div className="flex items-center justify-center bg-primary-600 px-5 text-[11px] font-semibold uppercase tracking-wider text-white">Client</div>
                <select
                  value={selectedClientId || ""}
                  onChange={(e) => onClientChange?.(e.target.value)}
                  className="h-11 min-w-[200px] bg-white pl-6 pr-4 py-2 text-sm font-medium text-gray-900 focus:outline-none"
                >
                  <option value="">Select client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || c.domain}</option>
                  ))}
                </select>
              </div>
              <div className="relative flex-1 max-w-md">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={trackSearchTerm}
                  onChange={(e) => setTrackSearchTerm(e.target.value)}
                  placeholder="Search tracked keywords"
                  className="h-11 w-full rounded-xl border-2 border-gray-300 bg-white pl-10 pr-4 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
            </div>
          )}
          {!showClientSelector && (
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={trackSearchTerm}
                onChange={(e) => setTrackSearchTerm(e.target.value)}
                placeholder="Search tracked keywords"
                className="h-11 w-full rounded-xl border-2 border-gray-300 bg-white pl-10 pr-4 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </div>
          )}
        </div>

        <form onSubmit={handleAddTrackedKeyword} className="rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50/80 to-white p-6 shadow-sm space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Keywords</label>
              <textarea
                value={newKeywordValue}
                onChange={(e) => setNewKeywordValue(e.target.value)}
                placeholder="e.g. best running shoes — or paste many (comma or new line separated)"
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 resize-y"
              />
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div ref={locationBoxRef} className="relative flex-1">
              <label className="sr-only">Location</label>
              <input
                type="text"
                value={trackLocationQuery}
                onChange={(e) => {
                  setTrackLocationQuery(e.target.value);
                  setTrackLocationOpen(true);
                }}
                onBlur={() => trackLocationQuery && setTrackLocationQuery(formatLocationName(trackLocationQuery))}
                onFocus={() => setTrackLocationOpen(true)}
                placeholder="Search location"
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
              {trackLocationOpen && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                  <div className="max-h-64 overflow-y-auto">
                    {trackLocationLoading ? (
                      <div className="px-3 py-2 text-sm text-gray-500">Searching…</div>
                    ) : trackLocationQuery.trim().length < 2 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">Type 2+ characters.</div>
                    ) : trackLocationOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">No locations found.</div>
                    ) : (
                      trackLocationOptions.map((opt) => (
                        <button
                          key={`${opt.location_name}-${opt.country_iso_code ?? ""}`}
                          type="button"
                          onClick={() => {
                            setTrackLocationSelected(opt);
                            setTrackLocationQuery(formatLocationName(opt.location_name));
                            setTrackLocationOpen(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          <div className="font-medium text-gray-900">{formatLocationName(opt.location_name)}</div>
                          <div className="text-xs text-gray-500">{(opt.location_type || "Location")}{opt.country_iso_code ? ` • ${opt.country_iso_code}` : ""}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={addingKeyword}
              className="inline-flex items-center justify-center rounded-xl bg-primary-600 px-6 py-3 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60 w-full sm:w-auto"
            >
              {addingKeyword ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {addingProgress ? `Adding ${addingProgress.current}/${addingProgress.total}…` : "Tracking…"}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Track
                </>
              )}
            </button>
          </div>
          <p className="text-xs text-gray-500">All data is fetched from DataForSEO for each keyword.</p>
          {addKeywordMessage && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">{addKeywordMessage}</div>
          )}
        </form>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-primary-50 via-blue-50 to-indigo-50 border-b-2 border-primary-200">
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-primary-800 uppercase tracking-wider border-l-4 border-primary-400 first:border-l-0">Keyword</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-emerald-800 uppercase tracking-wider border-l-4 border-emerald-300">Search volume</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-amber-800 uppercase tracking-wider border-l-4 border-amber-300">Keyword Difficulty</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300">CPC</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-l-4 border-slate-300">Current position</th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold text-violet-700 uppercase tracking-wider border-l-4 border-violet-300"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {trackedLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500 bg-gray-50/50">
                    <span className="inline-flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin text-primary-600" /> Loading…</span>
                  </td>
                </tr>
              ) : trackedError ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-rose-600 bg-rose-50/50">{trackedError}</td>
                </tr>
              ) : filteredKeywords.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500 bg-amber-50/50">No tracked keywords yet. Add some above.</td>
                </tr>
              ) : (
                keywordsPagination.rows.map((keyword, index) => (
                  <tr key={keyword.id} className={`transition-colors ${index % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-primary-50/50`}>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-gray-900">{keyword.keyword}</p>
                      {keyword.googleUrl && (
                        <a href={keyword.googleUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:underline mt-1 inline-block">View ranking URL</a>
                      )}
                    </td>
                    <td className="px-6 py-4 text-emerald-800/90">{formatNumber(keyword.searchVolume)}</td>
                    <td className="px-6 py-4 text-amber-800/90">
                      {keyword.difficulty != null && Number.isFinite(keyword.difficulty) ? (
                        <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">
                          {Math.round(Number(keyword.difficulty))}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-6 py-4 text-violet-800/90">{keyword.cpc != null ? `$${Number(keyword.cpc).toFixed(2)}` : "—"}</td>
                    <td className="px-6 py-4 text-slate-700">{keyword.currentPosition ?? "—"}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {user?.role === "SUPER_ADMIN" && (
                          <button
                            type="button"
                            onClick={() => handleRefreshTrackedKeyword(keyword.id)}
                            disabled={!!refreshingKeywordIds[keyword.id]}
                            className="inline-flex items-center justify-center rounded-lg p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 disabled:opacity-60 transition-colors"
                            title="Refresh keyword data"
                          >
                            {refreshingKeywordIds[keyword.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteTrackedKeyword(keyword.id, keyword.keyword)}
                          disabled={!!deletingKeywordIds[keyword.id]}
                          className="inline-flex items-center justify-center rounded-lg p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-60 transition-colors"
                          title="Delete"
                        >
                          {deletingKeywordIds[keyword.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!trackedLoading && !trackedError && filteredKeywords.length > 0 && (
          <div className="border-t border-gray-200 px-6 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                <span>Rows per page</span>
                <select
                  value={keywordsPageSize}
                  onChange={(e) =>
                    setKeywordsPageSize(Number(e.target.value) as (typeof KEYWORDS_PAGE_SIZES)[number])
                  }
                  className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  {KEYWORDS_PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-gray-500">
                  Showing {keywordsPagination.from}–{keywordsPagination.to} of {keywordsPagination.totalRows}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setKeywordsPage((p) => Math.max(1, p - 1))}
                  disabled={keywordsPagination.page <= 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </button>
                <span className="text-sm text-gray-600">
                  Page {keywordsPagination.page} of {keywordsPagination.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setKeywordsPage((p) => Math.min(keywordsPagination.totalPages, p + 1))}
                  disabled={keywordsPagination.page >= keywordsPagination.totalPages}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm({ isOpen: false, keywordId: null, keywordText: null })}
        onConfirm={confirmDeleteTrackedKeyword}
        title="Delete Keyword"
        message={`Are you sure you want to delete "${deleteConfirm.keywordText}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
};

export default ClientKeywordsManager;
