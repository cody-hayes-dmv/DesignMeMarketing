import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Search, Star, BarChart3, MapPin, TrendingUp, TrendingDown, ExternalLink, Edit2, Check, X, Info, Download, DollarSign, BookOpen } from "lucide-react";
import { format } from "date-fns";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { RootState } from "@/store";

interface TargetKeyword {
  id: string;
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: string | null;
  competitionValue: number | null;
  monthlySearches: any;
  keywordInfo: any;
  locationCode: number | null;
  locationName: string | null;
  languageCode: string | null;
  languageName: string | null;
  serpInfo: any;
  serpItemTypes: string[] | null;
  googleUrl: string | null;
  googlePosition: number | null;
  previousPosition: number | null;
  seResultsCount: string | null;
  type?: "money" | "topical";
  createdAt: string;
  updatedAt: string;
}

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");

  if (typeof value === "string") {
    // Sometimes stored as JSON string like '["video","images"]'
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    } catch {
      // ignore JSON parse errors
    }

    // Sometimes stored as comma-separated string like "video,images"
    if (value.includes(",")) return value.split(",").map((s) => s.trim()).filter(Boolean);

    // single string -> treat as 1 item
    if (value.trim()) return [value.trim()];
  }

  return [];
};

interface TargetKeywordsOverviewProps {
  clientId?: string | null;
  clientName?: string;
  className?: string;
  title?: string;
  subtitle?: string;
  titleTooltip?: string;
  lastUpdatedLabel?: string | null;
  showHeader?: boolean;
  headerActions?: React.ReactNode;
  shareToken?: string;
  enableRefresh?: boolean;
}

const TargetKeywordsOverview: React.FC<TargetKeywordsOverviewProps> = ({
  clientId,
  clientName,
  className = "",
  title = "Target Keywords",
  subtitle = "Keywords relevant to this client's website based on DataForSEO analysis.",
  titleTooltip,
  lastUpdatedLabel,
  showHeader = true,
  headerActions,
  shareToken,
  enableRefresh = true,
}) => {
  const { user } = useSelector((state: RootState) => state.auth);
  const isReadOnly = Boolean(shareToken);
  const [keywords, setKeywords] = useState<TargetKeyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingKeywordId, setEditingKeywordId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<"date" | "position" | null>(null);
  const [editDateValue, setEditDateValue] = useState<string>("");
  const [editPositionValue, setEditPositionValue] = useState<string>("");
  const [starredKeywordIds, setStarredKeywordIds] = useState<Set<string>>(new Set());
  const [activeTypeTab, setActiveTypeTab] = useState<"money" | "topical">("money");
  const initialRefreshDoneRef = useRef<Record<string, boolean>>({});

  const starredStorageKey = useMemo(() => {
    // Persist per-user, per-client
    const userKey = user?.id || user?.userId || "anon";
    return clientId ? `targetKeywords:starred:${userKey}:${clientId}` : "";
  }, [user, clientId]);

  useEffect(() => {
    if (!starredStorageKey) return;
    try {
      const raw = window.localStorage.getItem(starredStorageKey);
      if (!raw) {
        setStarredKeywordIds(new Set());
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setStarredKeywordIds(new Set(parsed.filter((v) => typeof v === "string")));
      } else {
        setStarredKeywordIds(new Set());
      }
    } catch {
      setStarredKeywordIds(new Set());
    }
  }, [starredStorageKey]);

  const fetchKeywords = useCallback(async () => {
    if (!clientId) return;
    try {
      setLoading(true);
      setError(null);
      const res = shareToken
        ? await api.get(`/seo/share/${encodeURIComponent(shareToken)}/target-keywords`)
        : await api.get(`/seo/target-keywords/${clientId}`);
      const list: TargetKeyword[] = res.data || [];
      setKeywords(list);
      // On initial load, run refresh once (for ADMIN/SUPER_ADMIN) so GOOGLE/GOOGLE URL get populated (only when enableRefresh)
      if (
        enableRefresh &&
        !shareToken &&
        clientId &&
        (user?.role === "SUPER_ADMIN" || user?.role === "ADMIN") &&
        list.length > 0 &&
        !initialRefreshDoneRef.current[clientId]
      ) {
        initialRefreshDoneRef.current[clientId] = true;
        api
          .post(`/seo/target-keywords/${clientId}/refresh`, {}, { timeout: 120000 })
          .then(() => fetchKeywords())
          .catch((err: any) => {
            console.warn("Initial target keywords refresh failed:", err?.response?.data?.message || err);
          });
      }
    } catch (error: any) {
      console.error("Failed to load target keywords", error);
      const errorMsg = error?.response?.data?.message || "Unable to load target keywords";
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [clientId, shareToken, user?.role]);

  const persistStarredIds = useCallback(
    (next: Set<string>) => {
      if (!starredStorageKey) return;
      try {
        window.localStorage.setItem(starredStorageKey, JSON.stringify(Array.from(next)));
      } catch {
        // ignore storage write errors
      }
    },
    [starredStorageKey]
  );

  const handleToggleStar = useCallback(
    (keywordId: string) => {
      setStarredKeywordIds((prev) => {
        const next = new Set(prev);
        if (next.has(keywordId)) {
          next.delete(keywordId);
        } else {
          next.add(keywordId);
        }
        persistStarredIds(next);
        return next;
      });
    },
    [persistStarredIds]
  );

  const moneyCount = useMemo(() => keywords.filter((k) => (k.type || "money") === "money").length, [keywords]);
  const topicalCount = useMemo(() => keywords.filter((k) => (k.type || "money") === "topical").length, [keywords]);

  const sortedKeywords = useMemo(() => {
    const filtered = keywords.filter((k) => (k.type || "money") === activeTypeTab);
    return [...filtered].sort((a, b) => {
      const aStar = starredKeywordIds.has(a.id);
      const bStar = starredKeywordIds.has(b.id);
      
      if (aStar !== bStar) return aStar ? -1 : 1;
      
      const aPos = a.googlePosition ?? Infinity;
      const bPos = b.googlePosition ?? Infinity;
      
      if (aPos !== bPos) return aPos - bPos;
      
      return 0;
    });
  }, [keywords, starredKeywordIds, activeTypeTab]);

  useEffect(() => {
    if (!clientId) return;
    fetchKeywords();
  }, [clientId, fetchKeywords]);

  const handleRefresh = useCallback(async () => {
    if (!clientId || (user?.role !== "SUPER_ADMIN" && user?.role !== "ADMIN") || isReadOnly) return;
    try {
      setRefreshing(true);
      await api.post(`/seo/target-keywords/${clientId}/refresh`, {}, { timeout: 120000 });
      toast.success("Target keywords refreshed successfully!");
      await fetchKeywords();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to refresh target keywords");
    } finally {
      setRefreshing(false);
    }
  }, [clientId, user?.role, fetchKeywords, isReadOnly]);

  const formatNumber = (num: number | null | undefined) => {
    if (num === null || num === undefined) return "—";
    return num.toLocaleString();
  };

  const formatCurrency = (num: number | null | undefined) => {
    if (num === null || num === undefined) return "—";
    return `$${num.toFixed(2)}`;
  };

  const formatPosition = (position: number | null | undefined) => {
    if (position === null || position === undefined) return "—";
    if (position === 1) return "1st";
    if (position === 2) return "2nd";
    if (position === 3) return "3rd";
    return `${position}th`;
  };

  const getPositionChange = (current: number | null, previous: number | null) => {
    if (current === null || previous === null) return null;
    return current - previous;
  };

  const serpFeatureLabels: Record<string, string> = {
    local_pack: "Google Maps",
    featured_snippet: "Featured Snippet",
    video: "Video",
    images: "Google Images",
    people_also_ask: "People Also Ask",
    related_searches: "Related Searches",
    knowledge_graph: "Knowledge Graph",
    shopping: "Shopping",
    organic: "Organic",
  };

  const escapeCsvCell = (value: string): string => {
    const s = String(value ?? "");
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const handleExportCsv = useCallback(() => {
    const headers = ["Keyword", "Location", "Ranking", "Ranking Date", "Ranking Change", "SERP Features"];
    const rows = sortedKeywords.map((kw) => {
      const change = getPositionChange(kw.googlePosition, kw.previousPosition);
      const changeStr = change === null ? "" : String(change);
      const serpTypes = toStringArray(kw.serpItemTypes);
      const serpStr = serpTypes.map((t) => serpFeatureLabels[t] || t).filter(Boolean).join(", ");
      const rankingDate = kw.updatedAt ? format(new Date(kw.updatedAt), "MMM d, yyyy") : "";
      return [
        escapeCsvCell(kw.keyword),
        escapeCsvCell(kw.locationName || "United States"),
        kw.googlePosition != null ? String(kw.googlePosition) : "",
        escapeCsvCell(rankingDate),
        changeStr,
        escapeCsvCell(serpStr),
      ];
    });
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `target-keywords-${clientId || "export"}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Target keywords exported to CSV");
  }, [sortedKeywords, clientId]);

  const getSERPFeaturesIcons = (serpItemTypes: string[] | null, isRanking: boolean) => {
    if (!serpItemTypes || serpItemTypes.length === 0) return null;
    const items = toStringArray(serpItemTypes);
    if (items.length === 0) return null;

    // Grey when not ranking (SERP features exist but client isn't in them); green when ranking
    const colorClass = isRanking ? "text-green-600" : "text-gray-400";

    const featureIcons: Record<string, { icon: string; label: string }> = {
      local_pack: { icon: "📍", label: "Google Maps" },
      featured_snippet: { icon: "📝", label: "Featured Snippet" },
      video: { icon: "▶️", label: "Video" },
      images: { icon: "🖼️", label: "Google Images" },
      people_also_ask: { icon: "❓", label: "People Also Ask" },
      related_searches: { icon: "🔍", label: "Related Searches" },
      knowledge_graph: { icon: "📊", label: "Knowledge Graph" },
      shopping: { icon: "🛒", label: "Shopping" },
      organic: { icon: "🔗", label: "Organic" },
    };

    return items
      .filter((type) => featureIcons[type])
      .slice(0, 3) // Show max 3 icons
      .map((type) => (
        <span
          key={type}
          className={`inline-block ${colorClass} cursor-help`}
          title={isRanking ? `${featureIcons[type].label} (ranking)` : `${featureIcons[type].label} (not ranking)`}
        >
          {featureIcons[type].icon}
        </span>
      ));
  };

  const handleStartEdit = (keywordId: string, field: "date" | "position", keyword: TargetKeyword) => {
    if (isReadOnly) return;
    setEditingKeywordId(keywordId);
    setEditingField(field);
    if (field === "date") {
      setEditDateValue(keyword.createdAt ? format(new Date(keyword.createdAt), "yyyy-MM-dd") : "");
    } else {
      setEditPositionValue(keyword.googlePosition?.toString() || "");
    }
  };

  const handleCancelEdit = () => {
    setEditingKeywordId(null);
    setEditingField(null);
    setEditDateValue("");
    setEditPositionValue("");
  };

  const handleSaveEdit = async (keywordId: string) => {
    if (isReadOnly) return;
    try {
      const updateData: any = {};
      if (editingField === "date" && editDateValue) {
        updateData.createdAt = editDateValue;
      } else if (editingField === "position") {
        updateData.googlePosition = editPositionValue ? parseInt(editPositionValue) : null;
      }

      await api.patch(`/seo/target-keywords/${keywordId}`, updateData);
      toast.success("Keyword updated successfully!");
      await fetchKeywords();
      handleCancelEdit();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to update keyword");
    }
  };

  if (!clientId) {
    return (
      <div className={`rounded-xl border-l-4 border-primary-500 bg-primary-50/50 p-6 shadow-sm ${className}`}>
        <p className="text-sm text-primary-800">Select a client to view target keywords.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border-l-4 border-primary-500 bg-white shadow-sm ring-1 ring-gray-200/80 overflow-hidden ${className}`}>
      {showHeader && (
        <div className="p-6 border-b-2 border-gray-100 bg-gradient-to-r from-primary-50/80 via-blue-50/60 to-indigo-50/50 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-primary-900 inline-flex items-center gap-1.5">
              {title}
              {titleTooltip && (
                <span title={titleTooltip}>
                  <Info className="h-4 w-4 text-primary-600 cursor-help" aria-hidden />
                </span>
              )}
            </h3>
            <p className="text-sm text-primary-800/80">
              {subtitle}
              {clientName ? ` Client: ${clientName}` : ""}
            </p>
            {lastUpdatedLabel && <p className="text-xs text-primary-700/70 mt-0.5">{lastUpdatedLabel}</p>}
          </div>
          <div className="flex items-center space-x-2">
            {headerActions}
            {keywords.length > 0 && (
              <button
                type="button"
                onClick={handleExportCsv}
                data-pdf-hide="true"
                className="bg-primary-600 text-white px-3 py-1.5 rounded-lg hover:bg-primary-700 transition-colors flex items-center space-x-2 text-sm"
                title="Export target keywords to CSV"
              >
                <Download className="h-3 w-3" />
                <span>Export</span>
              </button>
            )}
            {enableRefresh && user?.role === "SUPER_ADMIN" && !isReadOnly && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || loading}
                data-pdf-hide="true"
                className="bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                title="Refresh target keywords from DataForSEO"
              >
                {refreshing || loading ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Refreshing...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3" />
                    <span>Refresh</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {!loading && keywords.length > 0 && (
        <div className="flex border-b border-gray-200">
          <button
            type="button"
            onClick={() => setActiveTypeTab("money")}
            className={`inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-colors ${
              activeTypeTab === "money"
                ? "border-b-2 border-emerald-500 text-emerald-700 bg-emerald-50/50"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            <DollarSign className="h-4 w-4" />
            Money Keywords
            <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${
              activeTypeTab === "money" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
            }`}>{moneyCount}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTypeTab("topical")}
            className={`inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-colors ${
              activeTypeTab === "topical"
                ? "border-b-2 border-blue-500 text-blue-700 bg-blue-50/50"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            <BookOpen className="h-4 w-4" />
            Topical Keywords
            <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-bold ${
              activeTypeTab === "topical" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
            }`}>{topicalCount}</span>
          </button>
        </div>
      )}

      <div className={`space-y-6 ${showHeader ? "p-6 pt-4" : "p-6"} bg-gradient-to-b from-white to-slate-50/30`}>
        {error && (
          <div className="rounded-xl border-l-4 border-rose-500 bg-rose-50 px-4 py-3 text-sm text-rose-800 font-medium shadow-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-xl border-l-4 border-blue-500 bg-blue-50/50">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-blue-900">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              Loading target keywords…
            </span>
          </div>
        ) : keywords.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center rounded-xl border-l-4 border-amber-500 bg-amber-50/50 py-8">
            <Search className="h-10 w-10 text-amber-600 mb-2" />
            <p className="text-sm font-medium text-amber-900">No target keywords available yet.</p>
            <p className="text-xs text-amber-800/80 mt-1">
              {enableRefresh && user?.role === "SUPER_ADMIN"
                ? "Click Refresh to fetch keywords from DataForSEO."
                : "Contact your administrator to refresh keyword data."}
            </p>
          </div>
        ) : sortedKeywords.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center rounded-xl border-l-4 border-amber-500 bg-amber-50/50 py-8">
            {activeTypeTab === "money" ? <DollarSign className="h-10 w-10 text-amber-600 mb-2" /> : <BookOpen className="h-10 w-10 text-amber-600 mb-2" />}
            <p className="text-sm font-medium text-amber-900">No {activeTypeTab === "money" ? "money" : "topical"} keywords yet.</p>
            <p className="text-xs text-amber-800/80 mt-1">Keywords assigned to this category will appear here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-6 pt-2">
              <div className="flex items-center gap-2 text-sm font-medium text-primary-800 rounded-lg bg-primary-50/60 px-3 py-2 border border-primary-200/60">
                <BarChart3 className="h-4 w-4 text-primary-600" />
                <span>Showing {Math.min(50, keywords.length)} of {keywords.length} Rows</span>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto rounded-xl border-2 border-primary-200/80 bg-white shadow-inner">
              <table className="w-full">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gradient-to-r from-primary-600 via-blue-600 to-indigo-600 text-white">
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                      Keyword
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                      Location
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                      Date Added
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                      Google
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                      Google Change
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                      Google SERP Features
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider">
                      Google URL
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {sortedKeywords.slice(0, 50).map((keyword, index) => {
                    const isStarred = starredKeywordIds.has(keyword.id);
                    const rowAccent = index % 2 === 0 ? "bg-white" : "bg-slate-50/50";
                    return (
                    <tr key={keyword.id} className={`hover:bg-blue-50/60 transition-colors ${rowAccent}`}>
                      <td className="px-6 py-4 whitespace-nowrap border-l-4 border-transparent">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleStar(keyword.id)}
                            className="inline-flex items-center"
                            title={isStarred ? "Unstar keyword" : "Star keyword (pin to top)"}
                          >
                            <Star
                              className={`h-4 w-4 cursor-pointer transition-colors ${
                                isStarred ? "text-amber-500" : "text-gray-400 hover:text-amber-400"
                              }`}
                              fill={isStarred ? "currentColor" : "none"}
                            />
                          </button>
                          <span className="text-sm font-medium text-gray-900 underline cursor-pointer hover:text-primary-600">
                            {keyword.keyword}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-sm text-gray-900">
                          <MapPin className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                          {keyword.locationName || "United States"}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {editingKeywordId === keyword.id && editingField === "date" ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="date"
                              value={editDateValue}
                              onChange={(e) => setEditDateValue(e.target.value)}
                              className="text-sm border border-gray-300 rounded px-2 py-1"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveEdit(keyword.id)}
                              className="text-green-600 hover:text-green-800"
                              title="Save"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="text-red-600 hover:text-red-800"
                              title="Cancel"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <div 
                            className={`text-sm text-gray-600 flex items-center gap-2 group ${isReadOnly ? "" : "cursor-pointer hover:text-primary-600"}`}
                            onClick={() => !isReadOnly && handleStartEdit(keyword.id, "date", keyword)}
                            title={isReadOnly ? undefined : "Click to edit campaign start date"}
                          >
                            <span>{keyword.createdAt ? format(new Date(keyword.createdAt), "MMM d, yyyy") : "—"}</span>
                            {!isReadOnly && <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {editingKeywordId === keyword.id && editingField === "position" ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="1"
                              value={editPositionValue}
                              onChange={(e) => setEditPositionValue(e.target.value)}
                              className="text-sm border border-gray-300 rounded px-2 py-1 w-20"
                              placeholder="Position"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveEdit(keyword.id)}
                              className="text-green-600 hover:text-green-800"
                              title="Save"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="text-red-600 hover:text-red-800"
                              title="Cancel"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <div 
                            className={`text-sm text-gray-900 font-medium flex items-center gap-2 group ${isReadOnly ? "" : "cursor-pointer hover:text-primary-600"}`}
                            onClick={() => !isReadOnly && handleStartEdit(keyword.id, "position", keyword)}
                            title={isReadOnly ? undefined : "Click to edit Google ranking"}
                          >
                            <span>{formatPosition(keyword.googlePosition)}</span>
                            {!isReadOnly && <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {(() => {
                          const change = getPositionChange(keyword.googlePosition, keyword.previousPosition);
                          // If we don't have both positions, we can't compute change.
                          if (change === null) {
                            return <div className="text-sm text-gray-400">—</div>;
                          }
                          if (change === 0) {
                            return <div className="text-sm text-gray-600">0</div>;
                          }
                          const isPositive = change < 0; // Negative change means moved up (better position)
                          return (
                            <div className={`flex items-center gap-1 text-sm font-semibold ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
                              {isPositive ? (
                                <TrendingUp className="h-4 w-4" />
                              ) : (
                                <TrendingDown className="h-4 w-4" />
                              )}
                              <span>{Math.abs(change)}</span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {getSERPFeaturesIcons(
                            keyword.serpItemTypes,
                            keyword.googlePosition != null
                          ) || <span className="text-sm text-gray-400" title="No SERP features">—</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {keyword.googleUrl ? (
                          <a
                            href={keyword.googleUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary-600 hover:text-primary-800 underline flex items-center gap-1"
                          >
                            <span className="truncate max-w-xs">{keyword.googleUrl}</span>
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </a>
                        ) : (
                          <div className="text-sm text-gray-400">—</div>
                        )}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
            {keywords.length > 50 && (
              <div className="px-6 pb-4 text-sm font-medium text-primary-700 text-center rounded-lg bg-primary-50/50 py-2 border border-primary-200/60">
                Showing top 50 of {keywords.length} keywords
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TargetKeywordsOverview;

