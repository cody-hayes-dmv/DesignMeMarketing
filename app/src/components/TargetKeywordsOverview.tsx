import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, Star, BarChart3, MapPin, TrendingUp, TrendingDown, ExternalLink, Edit2, Check, X } from "lucide-react";
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
  createdAt: string;
  updatedAt: string;
}

interface TargetKeywordsOverviewProps {
  clientId?: string | null;
  clientName?: string;
  className?: string;
  title?: string;
  subtitle?: string;
  showHeader?: boolean;
  headerActions?: React.ReactNode;
}

const TargetKeywordsOverview: React.FC<TargetKeywordsOverviewProps> = ({
  clientId,
  clientName,
  className = "",
  title = "Target Keywords",
  subtitle = "Keywords relevant to this client's website based on DataForSEO analysis.",
  showHeader = true,
  headerActions,
}) => {
  const { user } = useSelector((state: RootState) => state.auth);
  const [keywords, setKeywords] = useState<TargetKeyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingKeywordId, setEditingKeywordId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<"date" | "position" | null>(null);
  const [editDateValue, setEditDateValue] = useState<string>("");
  const [editPositionValue, setEditPositionValue] = useState<string>("");
  const [starredKeywordIds, setStarredKeywordIds] = useState<Set<string>>(new Set());

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
      const res = await api.get(`/seo/target-keywords/${clientId}`);
      setKeywords(res.data || []);
    } catch (error: any) {
      console.error("Failed to load target keywords", error);
      const errorMsg = error?.response?.data?.message || "Unable to load target keywords";
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

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

  const sortedKeywords = useMemo(() => {
    // Keep existing server order as the secondary ordering (stable).
    const indexMap = new Map<string, number>();
    keywords.forEach((k, idx) => indexMap.set(k.id, idx));

    return [...keywords].sort((a, b) => {
      const aStar = starredKeywordIds.has(a.id);
      const bStar = starredKeywordIds.has(b.id);
      if (aStar !== bStar) return aStar ? -1 : 1;
      return (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0);
    });
  }, [keywords, starredKeywordIds]);

  useEffect(() => {
    if (!clientId) return;
    fetchKeywords();
  }, [clientId, fetchKeywords]);

  const handleRefresh = useCallback(async () => {
    if (!clientId || user?.role !== "SUPER_ADMIN") return;
    try {
      setRefreshing(true);
      await api.post(`/seo/target-keywords/${clientId}/refresh`);
      toast.success("Target keywords refreshed successfully!");
      await fetchKeywords();
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to refresh target keywords");
    } finally {
      setRefreshing(false);
    }
  }, [clientId, user?.role, fetchKeywords]);

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

  const getSERPFeaturesIcons = (serpItemTypes: string[] | null) => {
    if (!serpItemTypes || serpItemTypes.length === 0) return null;
    
    const featureIcons: Record<string, { icon: string; color: string; label: string }> = {
      local_pack: { icon: "📍", color: "text-blue-600", label: "Google Maps" },
      featured_snippet: { icon: "📝", color: "text-green-600", label: "Featured Snippet" },
      video: { icon: "▶️", color: "text-red-600", label: "Video" },
      images: { icon: "🖼️", color: "text-purple-600", label: "Google Images" },
      people_also_ask: { icon: "❓", color: "text-yellow-600", label: "People Also Ask" },
      related_searches: { icon: "🔍", color: "text-gray-600", label: "Related Searches" },
      knowledge_graph: { icon: "📊", color: "text-indigo-600", label: "Knowledge Graph" },
      shopping: { icon: "🛒", color: "text-pink-600", label: "Shopping" },
      organic: { icon: "🔗", color: "text-gray-600", label: "Organic" },
    };
    
    return serpItemTypes
      .filter(type => featureIcons[type])
      .slice(0, 3) // Show max 3 icons
      .map(type => (
        <span 
          key={type} 
          className={`inline-block ${featureIcons[type].color} cursor-help`} 
          title={featureIcons[type].label}
        >
          {featureIcons[type].icon}
        </span>
      ));
  };

  const handleStartEdit = (keywordId: string, field: "date" | "position", keyword: TargetKeyword) => {
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
      <div className={`bg-white rounded-xl border border-gray-200 p-6 ${className}`}>
        <p className="text-sm text-gray-500">Select a client to view target keywords.</p>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl border border-gray-200 ${className}`}>
      {showHeader && (
        <div className="p-6 border-b border-gray-200 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500">
              {subtitle}
              {clientName ? ` Client: ${clientName}` : ""}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            {headerActions}
            {user?.role === "SUPER_ADMIN" && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing || loading}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing || loading ? "animate-spin text-primary-600" : ""}`} />
                <span>Refresh</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className={`space-y-6 ${showHeader ? "p-6 pt-4" : "p-6"}`}>
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <span className="inline-flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
              Loading target keywords…
            </span>
          </div>
        ) : keywords.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center text-center text-sm text-gray-500">
            <Search className="h-8 w-8 text-gray-400 mb-2" />
            <p>No target keywords available yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              {user?.role === "SUPER_ADMIN"
                ? "Click Refresh to fetch keywords from DataForSEO."
                : "Contact your administrator to refresh keyword data."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-6 pt-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <BarChart3 className="h-4 w-4" />
                <span>Showing {Math.min(50, keywords.length)} of {keywords.length} Rows</span>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto border border-gray-200 rounded-lg">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Keyword
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Location
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Date Added
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Google
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Google Change
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Google SERP Features
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Google URL
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedKeywords.slice(0, 50).map((keyword) => {
                    const isStarred = starredKeywordIds.has(keyword.id);
                    return (
                    <tr key={keyword.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleStar(keyword.id)}
                            className="inline-flex items-center"
                            title={isStarred ? "Unstar keyword" : "Star keyword (pin to top)"}
                          >
                            <Star
                              className={`h-4 w-4 cursor-pointer transition-colors ${
                                isStarred ? "text-yellow-500" : "text-gray-400 hover:text-yellow-400"
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
                            className="text-sm text-gray-600 flex items-center gap-2 group cursor-pointer hover:text-primary-600"
                            onClick={() => handleStartEdit(keyword.id, "date", keyword)}
                            title="Click to edit campaign start date"
                          >
                            <span>{keyword.createdAt ? format(new Date(keyword.createdAt), "MMM d, yyyy") : "—"}</span>
                            <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
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
                            className="text-sm text-gray-900 font-medium flex items-center gap-2 group cursor-pointer hover:text-primary-600"
                            onClick={() => handleStartEdit(keyword.id, "position", keyword)}
                            title="Click to edit Google ranking"
                          >
                            <span>{formatPosition(keyword.googlePosition)}</span>
                            <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {(() => {
                          const change = getPositionChange(keyword.googlePosition, keyword.previousPosition);
                          if (change === null || change === 0) {
                            return <div className="text-sm text-gray-600">0</div>;
                          }
                          const isPositive = change < 0; // Negative change means moved up (better position)
                          return (
                            <div className={`flex items-center gap-1 text-sm font-medium ${isPositive ? "text-green-600" : "text-red-600"}`}>
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
                          {getSERPFeaturesIcons(keyword.serpItemTypes) || <span className="text-sm text-gray-400" title="No SERP features">—</span>}
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
              <div className="px-6 pb-4 text-sm text-gray-500 text-center">
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

