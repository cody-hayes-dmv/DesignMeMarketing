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
  Cell,
  PieChart,
  Pie,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
} from "recharts";
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
  }>;
  positionDistribution: {
    top3: number;
    top10: number;
    page2: number;
    pos21_30: number;
    pos31_50: number;
    pos51Plus: number;
    top3Pct: number;
    top10Pct: number;
    page2Pct: number;
    pos21_30Pct: number;
    pos31_50Pct: number;
    pos51PlusPct: number;
  };
  topOrganicKeywords: Array<{
    keyword: string;
    position: number;
    trafficPercent: number | null;
    traffic: number | null;
    volume: number | null;
    url: string | null;
  }>;
  referringDomains: Array<{ domain: string; backlinks: number; referringDomains: number }>;
  backlinksByType: Array<{ type: string; count: number; pct: number }>;
  topAnchors: Array<{ anchor: string; type: string; refDomains: number; domains?: number }>;
  followNofollow: { follow: number; nofollow: number };
  indexedPages: Array<{ url: string; refDomains: number }>;
  referringDomainsByTld: Array<{ tld: string; refDomains: number }>;
  referringDomainsByCountry?: Array<{ country: string; refDomains: number }>;
  organicCompetitors?: Array<{ competitor: string; comLevel: number; comKeywords: number; seKeywords: number }>;
  keywordsByIntent?: Array<{ intent: string; pct: number; keywords: number; traffic: number }>;
}

export interface AiSearchVisibilityData {
  kpis: {
    aiVisibilityScore: number;
    totalAiMentions: number;
    aiSearchVolume: number;
  };
  platforms?: Array<{ platform: string; mentions: number; aiSearchVol: number; impressions?: number }>;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const POSITION_COLORS = ["#22C55E", "#3B82F6", "#FACC15", "#F97316", "#EF4444", "#8B5CF6"];

interface DomainResearchViewProps {
  clients: Client[];
  clientsError: string | null;
}

const DomainResearchView: React.FC<DomainResearchViewProps> = ({ clients, clientsError }) => {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [overview, setOverview] = useState<DomainOverviewData | null>(null);
  const [aiSearch, setAiSearch] = useState<AiSearchVisibilityData | null>(null);
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

  const selectedClient = clients.find((c) => c.id === selectedClientId) || null;

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const filteredClients = searchQuery.trim()
    ? clients.filter((c) => {
        const q = searchQuery.toLowerCase().trim();
        const name = (c.name || "").toLowerCase();
        const domain = (c.domain || "").toLowerCase();
        return name.includes(q) || domain.includes(q) || name.startsWith(q) || domain.startsWith(q);
      })
    : clients;

  // Auto-select when exactly one client matches the search (debounced)
  useEffect(() => {
    if (selectedClientId || !searchQuery.trim()) return;
    const timer = setTimeout(() => {
      if (filteredClients.length === 1) {
        setSelectedClientId(filteredClients[0].id);
        setSearchQuery("");
        setSearchOpen(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, filteredClients, selectedClientId]);

  const fetchOverview = useCallback(async (clientId: string) => {
    setLoading(true);
    setError(null);
    setAiSearch(null);
    try {
      const [overviewRes, aiRes] = await Promise.allSettled([
        api.get<DomainOverviewData>(`/seo/domain-overview/${clientId}`),
        api.get<AiSearchVisibilityData>(`/seo/ai-search-visibility/${clientId}`, { params: { period: "30" }, timeout: 30000 }),
      ]);
      if (overviewRes.status === "fulfilled") setOverview(overviewRes.value.data);
      else {
        setOverview(null);
        setError((overviewRes.reason as any)?.response?.data?.message || "Failed to load domain overview");
      }
      if (aiRes.status === "fulfilled") setAiSearch(aiRes.value.data);
    } catch (err: any) {
      setOverview(null);
      setError(err?.response?.data?.message || "Failed to load domain overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClientId) {
      fetchOverview(selectedClientId);
    } else {
      setOverview(null);
      setAiSearch(null);
      setError(null);
    }
  }, [selectedClientId, fetchOverview]);

  const positionBarDataOrganic = overview?.positionDistribution
    ? [
        { name: "1-3", value: overview.positionDistribution.top3, pct: overview.positionDistribution.top3Pct, fill: "#3B82F6" },
        { name: "4-10", value: overview.positionDistribution.top10, pct: overview.positionDistribution.top10Pct, fill: "#3B82F6" },
        { name: "11-20", value: overview.positionDistribution.page2, pct: overview.positionDistribution.page2Pct, fill: "#3B82F6" },
        { name: "21-50", value: (overview.positionDistribution.pos21_30 ?? 0) + (overview.positionDistribution.pos31_50 ?? 0), pct: (overview.positionDistribution.pos21_30Pct ?? 0) + (overview.positionDistribution.pos31_50Pct ?? 0), fill: "#3B82F6" },
        { name: "51-100", value: overview.positionDistribution.pos51Plus, pct: overview.positionDistribution.pos51PlusPct, fill: "#3B82F6" },
        { name: "SF", value: 0, pct: 0, fill: "#3B82F6" },
      ]
    : [];

  const intentColors: Record<string, string> = { Informational: "#3B82F6", Navigational: "#8B5CF6", Commercial: "#F59E0B", Transactional: "#22C55E" };
  const intentData = (overview?.keywordsByIntent ?? [
    { intent: "Informational", pct: 32, keywords: Math.round((overview?.metrics.organicSearch.keywords ?? 0) * 0.32), traffic: Math.round((overview?.metrics.organicSearch.traffic ?? 0) * 0.38) },
    { intent: "Navigational", pct: 2, keywords: Math.round((overview?.metrics.organicSearch.keywords ?? 0) * 0.02), traffic: Math.round((overview?.metrics.organicSearch.traffic ?? 0) * 0.01) },
    { intent: "Commercial", pct: 63, keywords: Math.round((overview?.metrics.organicSearch.keywords ?? 0) * 0.63), traffic: Math.round((overview?.metrics.organicSearch.traffic ?? 0) * 0.35) },
    { intent: "Transactional", pct: 3, keywords: Math.round((overview?.metrics.organicSearch.keywords ?? 0) * 0.03), traffic: Math.round((overview?.metrics.organicSearch.traffic ?? 0) * 0.02) },
  ]).map((d) => ({ ...d, fill: intentColors[d.intent] ?? "#3B82F6" }));

  const competitorMapData = (() => {
    const clientKw = overview?.metrics.organicSearch.keywords ?? 0;
    const clientTraffic = overview?.metrics.organicSearch.traffic ?? 0;
    const clientPoint = { name: (overview?.client?.domain ?? "designmemarketing").replace(/\./g, "").slice(0, 14), keywords: clientKw, traffic: clientTraffic, fill: "#8B5CF6" };
    const competitors = overview?.organicCompetitors ?? [];
    const colors = ["#3B82F6", "#22C55E", "#F97316", "#EC4899", "#FACC15"];
    const competitorPoints = competitors.slice(0, 5).map((c, i) => ({
      name: c.competitor.replace(/\./g, "").slice(0, 14),
      keywords: c.seKeywords,
      traffic: c.comKeywords,
      fill: colors[i % colors.length],
    }));
    return [clientPoint, ...competitorPoints];
  })();

  const trafficChartData = (overview?.organicTrafficOverTime ?? []).map((m) => ({
    ...m,
    trafficPaid: 0,
    trafficBranded: 0,
  }));
  const keywordsStackData =
    overview?.organicPositionsOverTime?.map((m) => {
      const top3 = m.top3 ?? 0;
      const top10 = (m.top10 ?? 0) - top3;
      const top20 = (m.top20 ?? 0) - (m.top10 ?? 0);
      return {
        month: `${MONTH_NAMES[(m.month ?? 1) - 1]} ${m.year}`,
        monthKey: `${m.year}-${String(m.month).padStart(2, "0")}`,
        "Top 3": top3,
        "4-10": Math.max(0, top10),
        "11-20": Math.max(0, top20),
        "21-50": 0,
        "51-100": 0,
        "AI Overviews": aiSearch?.kpis?.totalAiMentions ? Math.round((aiSearch.kpis.totalAiMentions || 0) / 12) : 0,
        "Other SERP Features": 0,
      };
    }) ?? [];

  const followNofollowData =
    overview?.followNofollow && (overview.followNofollow.follow + overview.followNofollow.nofollow > 0)
      ? [
          { name: "Follow", value: overview.followNofollow.follow, fill: "#8B5CF6" },
          { name: "Nofollow", value: overview.followNofollow.nofollow, fill: "#3B82F6" },
        ]
      : [];

  return (
    <div className="space-y-6">
      {/* Search / client selector - Semrush-style */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b border-gray-200 bg-gray-50/50">
          <div ref={searchContainerRef} className="relative flex-1 max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={selectedClient ? `${selectedClient.domain || selectedClient.name} /` : searchQuery}
              onChange={(e) => {
                if (!selectedClient) {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearchOpen(false);
                if (e.key === "Enter" && !selectedClient && filteredClients.length === 1) {
                  setSelectedClientId(filteredClients[0].id);
                  setSearchQuery("");
                  setSearchOpen(false);
                }
              }}
              placeholder="Search client name or domain (e.g. Design ME)"
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
            {searchOpen && !selectedClient && (
              <div className="absolute z-30 mt-1 left-0 right-0 rounded-lg border border-gray-200 bg-white shadow-xl max-h-60 overflow-y-auto">
                {filteredClients.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500">
                    {searchQuery.trim() ? `No client matching "${searchQuery}". Try a different search.` : "Type to search clients."}
                  </div>
                ) : (
                  filteredClients.slice(0, 20).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedClientId(c.id);
                        setSearchQuery("");
                        setSearchOpen(false);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 flex items-center justify-between"
                    >
                      <span className="font-medium text-gray-900">{c.name || c.domain || c.id}</span>
                      <span className="text-gray-500 text-xs">{c.domain}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {selectedClient && (
            <button
              type="button"
              onClick={() => {
                setSelectedClientId(null);
                setOverview(null);
              }}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              Change client
            </button>
          )}
        </div>

        {selectedClient && (
          <div className="px-4 py-4 flex flex-wrap items-center justify-between gap-3 bg-white border-b border-gray-100">
            <h2 className="text-xl font-semibold text-gray-900">
              Domain Overview for {selectedClient.domain || selectedClient.name} /
            </h2>
            <div className="flex items-center gap-2">
              <a
                href={`/clients/${selectedClient.id}`}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <TrendingUp className="h-4 w-4" />
                Start Tracking
              </a>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => window.print()}
              >
                <Download className="h-4 w-4" />
                Export PDF
              </button>
            </div>
          </div>
        )}
      </div>

      {clientsError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {clientsError}
        </div>
      )}

      {!selectedClientId && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
          <Search className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-4 text-gray-600">
            {searchQuery.trim()
              ? filteredClients.length === 0
                ? `No client matching "${searchQuery}". Try a different name or domain.`
                : "Select a client from the dropdown above to view domain overview."
              : "Type a client name or domain (e.g. Design ME) and select from the dropdown to view domain overview."}
          </p>
        </div>
      )}

      {selectedClientId && loading && !overview && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      )}

      {selectedClientId && error && !overview && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {error}
        </div>
      )}

      {overview && (
        <div className="space-y-8">
          {/* Screenshot 2: AI Search + SEO summary cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 bg-purple-600 text-white rounded-t-xl">
                <h3 className="text-base font-semibold">AI Search</h3>
                <span className="text-sm font-medium text-purple-100">Today</span>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-3 gap-6">
                  <div className="flex items-start gap-3">
                    <div className="relative w-14 h-7 flex-shrink-0">
                      <svg viewBox="0 0 100 50" className="w-full h-full -rotate-90">
                        <path d="M 10 40 A 40 40 0 0 1 90 40" fill="none" stroke="#E5E7EB" strokeWidth="8" strokeLinecap="round" />
                        <path
                          d="M 10 40 A 40 40 0 0 1 90 40"
                          fill="none"
                          stroke="#F97316"
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={Math.PI * 40}
                          strokeDashoffset={Math.PI * 40 * (1 - Math.min(1, (aiSearch?.kpis?.aiVisibilityScore ?? 0) / 99))}
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">AI Visibility</p>
                      <p className="mt-0.5 text-2xl font-bold text-blue-600">
                        {aiSearch?.kpis?.aiVisibilityScore ?? 0}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Mentions</p>
                    <p className="mt-1 text-2xl font-bold text-blue-600">
                      {aiSearch?.kpis?.totalAiMentions ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Cited Pages</p>
                    <p className="mt-1 text-2xl font-bold text-blue-600">
                      {aiSearch?.platforms ? aiSearch.platforms.reduce((s, p) => s + (p.aiSearchVol ?? p.impressions ?? 0), 0) : 0}
                    </p>
                  </div>
                </div>
                {aiSearch?.platforms && aiSearch.platforms.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-gray-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 font-medium">
                          <th className="pb-2"></th>
                          <th className="pb-2">Mentions</th>
                          <th className="pb-2">Cited Pages</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {aiSearch.platforms.map((p, i) => (
                          <tr key={i}>
                            <td className="py-1.5 font-medium text-gray-900">{p.platform}</td>
                            <td className="py-1.5 text-gray-900 tabular-nums">{p.mentions}</td>
                            <td className="py-1.5 text-blue-600 font-medium tabular-nums">{p.aiSearchVol ?? p.impressions ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <h3 className="px-6 py-4 border-b border-gray-200 text-base font-semibold text-gray-900 bg-blue-50/50 text-blue-900">
                SEO
              </h3>
              <div className="p-6 grid grid-cols-4 gap-3">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Authority Score</p>
                  <p className="mt-1 text-xl font-bold text-blue-600">
                    {overview.metrics.authorityScore ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Organic Traffic</p>
                  <p className="mt-1 text-xl font-bold text-blue-600">
                    {overview.metrics.organicSearch.traffic.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Paid Traffic</p>
                  <p className="mt-1 text-xl font-bold text-blue-600">
                    {overview.metrics.paidSearch.traffic.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Ref. Domains</p>
                  <p className="mt-1 text-xl font-bold text-blue-600">
                    {overview.metrics.backlinks.referringDomains.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Traffic Share</p>
                  <p className="mt-1 text-xl font-bold text-blue-600">
                    {overview.metrics.trafficShare != null ? `${overview.metrics.trafficShare}%` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Organic Keywords</p>
                  <p className="mt-1 text-xl font-bold text-blue-600">
                    {overview.metrics.organicSearch.keywords.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Paid Keywords</p>
                  <p className="mt-1 text-xl font-bold text-blue-600">
                    {overview.metrics.paidSearch.keywords.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Backlinks</p>
                  <p className="mt-1 text-xl font-bold text-blue-600">
                    {overview.metrics.backlinks.totalBacklinks.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* AI Search detail - match reference: tabs, time range, Distribution by Country, Traffic, Top Cited Sources, Keywords, SERP */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-gray-200 bg-gray-50/50">
              <div className="flex items-center gap-1">
                <button type="button" className="px-4 py-2 rounded-t-lg bg-blue-600 text-white text-sm font-medium">
                  AI Search
                </button>
                <button type="button" className="px-4 py-2 rounded-t-lg text-gray-600 hover:bg-gray-100 text-sm font-medium">
                  Google Search
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
                <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
                  <Upload className="h-4 w-4" />
                  Export
                </button>
              </div>
            </div>
            <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                        <td className="px-4 py-2 text-gray-900">{aiSearch?.kpis?.aiVisibilityScore ?? 0}</td>
                        <td className="px-4 py-2 text-blue-600 font-medium">{aiSearch?.kpis?.totalAiMentions ?? 0}</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-900 flex items-center gap-1.5"><Globe className="h-4 w-4 text-gray-400" /> US</td>
                        <td className="px-4 py-2 text-gray-900">{aiSearch?.kpis?.aiVisibilityScore ?? 0}</td>
                        <td className="px-4 py-2 text-blue-600 font-medium">{aiSearch?.kpis?.totalAiMentions ?? 0}</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-900">AU</td>
                        <td className="px-4 py-2 text-gray-900">0</td>
                        <td className="px-4 py-2 text-blue-600 font-medium">0</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-900">FR</td>
                        <td className="px-4 py-2 text-gray-900">0</td>
                        <td className="px-4 py-2 text-blue-600 font-medium">0</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {(!aiSearch?.kpis?.aiVisibilityScore && !aiSearch?.kpis?.totalAiMentions) && (
                  <p className="mt-2 text-xs text-gray-500">Run AI Search visibility on the client dashboard to see AI metrics.</p>
                )}
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-3">Traffic</h4>
                <div className="flex flex-wrap gap-4 mb-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={trafficOrganic} onChange={(e) => setTrafficOrganic(e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm text-blue-600 font-medium">Organic Traffic</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={trafficPaid} onChange={(e) => setTrafficPaid(e.target.checked)} className="rounded border-gray-300 text-orange-500 focus:ring-orange-500" />
                    <span className="text-sm text-orange-500 font-medium">Paid Traffic</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={trafficBranded} onChange={(e) => setTrafficBranded(e.target.checked)} className="rounded border-gray-300 text-green-600 focus:ring-green-500" />
                    <span className="text-sm text-green-600 font-medium">Branded Traffic</span>
                  </label>
                  <select className="ml-auto text-sm border border-gray-200 rounded px-2 py-1 text-gray-600 bg-white">
                    <option>Notes</option>
                  </select>
                </div>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trafficChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
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
                <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-1.5">
                  Top Cited Sources
                  <Globe className="h-4 w-4 text-gray-400" />
                </h4>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Domain</th>
                        <th className="px-4 py-2 text-left font-medium text-gray-700">Mentions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {aiSearch?.platforms?.map((p, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-900">{p.platform}</td>
                          <td className="px-4 py-2 text-blue-600 font-medium">{p.mentions}</td>
                        </tr>
                      ))}
                      {(!aiSearch?.platforms?.length) && (
                        <tr><td colSpan={2} className="px-4 py-2 text-gray-500">No data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {(!aiSearch?.platforms?.length) && (
                  <p className="mt-2 text-xs text-gray-500">Run AI Search visibility on the client dashboard for cited sources.</p>
                )}
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-3">Google SERP Positions Distribution</h4>
                <div className="h-52 flex items-center justify-center">
                  {(() => {
                    const organic = (overview.positionDistribution?.top3 ?? 0) + (overview.positionDistribution?.top10 ?? 0) + (overview.positionDistribution?.page2 ?? 0) + (overview.positionDistribution?.pos21_30 ?? 0) + (overview.positionDistribution?.pos31_50 ?? 0) + (overview.positionDistribution?.pos51Plus ?? 0);
                    const ai = aiSearch?.kpis?.totalAiMentions ?? 0;
                    if (organic === 0 && ai === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center text-gray-500 text-sm">
                          <span>No data</span>
                          <span className="text-xs mt-1">Refresh ranked keywords on the client dashboard</span>
                        </div>
                      );
                    }
                    const serpPieData = [
                      { name: "Organic", value: organic || 1, fill: "#3B82F6" },
                      { name: "AI Overviews", value: ai, fill: "#8B5CF6" },
                      { name: "Other SERP Features", value: Math.max(1, Math.round(organic * 0.003)), fill: "#22C55E" },
                    ].filter((d) => d.value > 0);
                    const serpData = serpPieData.length ? serpPieData : [{ name: "Organic", value: 1, fill: "#3B82F6" }];
                    return (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={serpData}
                            cx="50%"
                            cy="50%"
                            innerRadius={40}
                            outerRadius={60}
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
            <div className="px-6 pb-6">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Keywords</h4>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  <button type="button" onClick={() => setKeywordsTab("Organic")} className={`px-3 py-1.5 text-sm font-medium ${keywordsTab === "Organic" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>Organic</button>
                  <button type="button" onClick={() => setKeywordsTab("Paid")} className={`px-3 py-1.5 text-sm font-medium ${keywordsTab === "Paid" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>Paid</button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {(["top3", "4-10", "11-20", "21-50", "51-100", "aiOverviews", "otherSerp"] as const).map((key) => (
                    <label key={key} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={keywordRanges[key]} onChange={(e) => setKeywordRanges((prev) => ({ ...prev, [key]: e.target.checked }))} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="text-xs text-gray-700">{key === "top3" ? "Top 3" : key === "4-10" ? "4-10" : key === "11-20" ? "11-20" : key === "21-50" ? "21-50" : key === "51-100" ? "51-100" : key === "aiOverviews" ? "AI Overviews" : "Other SERP Features"}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="h-56">
                {keywordsStackData.length > 0 && keywordsStackData.some((m) => ((m["Top 3"] ?? 0) + (m["4-10"] ?? 0) + (m["11-20"] ?? 0) + (m["21-50"] ?? 0) + (m["51-100"] ?? 0)) > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={keywordsStackData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
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
                )}
              </div>
            </div>
          </div>

          {/* Screenshot 4: Market Trends and Channels */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <h3 className="px-6 py-4 border-b border-gray-200 text-base font-semibold text-gray-900">
              Market Trends and Channels
            </h3>
            <div className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
                {(overview.marketTrendsChannels ?? [
                  { name: "Direct", value: 0, pct: 0 },
                  { name: "AI traffic", value: 0, pct: 0 },
                  { name: "Referral", value: 0, pct: 0 },
                  { name: "Organic Search", value: 0, pct: 0 },
                  { name: "Google AI Mode", value: 0, pct: 0 },
                  { name: "Paid Search", value: 0, pct: 0 },
                  { name: "Other", value: 0, pct: 0 },
                ]).map((ch) => (
                  <div key={ch.name} className="text-center">
                    <p className="text-sm font-medium text-gray-900">{ch.pct}%</p>
                    <p className="text-xs text-gray-500 mt-0.5">{ch.name}</p>
                    <div className="mt-2 h-2 rounded-full bg-gray-200 overflow-hidden">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${ch.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Organic Research - match reference: header US, Top Organic Keywords, Key Topics, Keywords by Intent, Position Distribution, Competitors, Map */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">Organic Research</h3>
              <Globe className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-600">US</span>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gray-50 flex items-center justify-between">
                    Top Organic Keywords {overview.topOrganicKeywords.length}
                  </h4>
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Keyword</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">
                            <span className="inline-flex items-center gap-0.5">Intent <ChevronUp className="h-3 w-3" /><ChevronDown className="h-3 w-3" /></span>
                          </th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Pos.</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Volume</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">CPC (U...)</th>
                          <th className="px-4 py-2 text-left font-medium text-gray-700">Traffic %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {overview.topOrganicKeywords.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No keywords yet</td></tr>
                        ) : (
                          overview.topOrganicKeywords.slice(0, 10).map((k, i) => (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="px-4 py-2 font-medium text-gray-900 truncate max-w-[200px]" title={k.keyword}>{k.keyword}</td>
                              <td className="px-4 py-2">
                                <span className="inline-flex w-6 h-6 items-center justify-center rounded bg-gray-100 text-xs text-gray-500">—</span>
                              </td>
                              <td className="px-4 py-2 text-gray-600">{k.position}</td>
                              <td className="px-4 py-2 text-gray-600">{k.volume != null ? k.volume.toLocaleString() : "—"}</td>
                              <td className="px-4 py-2 text-gray-600">—</td>
                              <td className="px-4 py-2 text-gray-600">{k.trafficPercent != null ? k.trafficPercent.toFixed(2) : "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 border-t border-gray-100">
                    <button type="button" className="text-sm font-medium text-blue-600 hover:text-blue-700">View details</button>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-6 bg-gradient-to-b from-purple-50/50 to-white flex flex-col items-center justify-center min-h-[280px] relative overflow-hidden">
                  <div className="absolute inset-0 opacity-30 pointer-events-none">
                    <div className="absolute top-8 left-8 w-24 h-8 rounded bg-purple-200/60 blur" />
                    <div className="absolute bottom-12 right-12 w-32 h-6 rounded bg-purple-200/40 blur" />
                  </div>
                  <p className="text-sm font-medium text-gray-800 relative z-10">View {overview.client?.domain ?? "this domain"} key topics</p>
                  <button type="button" className="mt-4 px-5 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 relative z-10">
                    Get topics
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gray-50">Keywords by Intent</h4>
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
                              <a href="#" className="text-blue-600 hover:underline">{d.pct}%</a>
                            </td>
                            <td className="py-2 text-gray-900">{d.keywords} Keywords</td>
                            <td className="py-2 text-gray-900">{d.traffic} Traffic</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="px-4 py-3 border-t border-gray-100">
                    <button type="button" className="text-sm font-medium text-blue-600 hover:text-blue-700">View details</button>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gray-50">Organic Position Distribution</h4>
                  <p className="text-xs text-gray-500 px-4 pt-2">Positions on Google SERP</p>
                  <div className="p-4 h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={positionBarDataOrganic} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(value: number, _name: string, props: any) => [`${props.payload.pct}%`, props.payload.name]} />
                        <Bar dataKey="pct" radius={[4, 4, 0, 0]} fill="#3B82F6" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gray-50">
                    Main Organic Competitors {(overview.organicCompetitors?.length ?? 0) || "—"}
                  </h4>
                  {(overview.organicCompetitors?.length ?? 0) > 0 ? (
                    <>
                      <div className="overflow-x-auto max-h-64 overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200 text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-4 py-2 text-left font-medium text-gray-700">Competitor</th>
                              <th className="px-4 py-2 text-left font-medium text-gray-700">Com. Level</th>
                              <th className="px-4 py-2 text-left font-medium text-gray-700">Com. Keywords</th>
                              <th className="px-4 py-2 text-left font-medium text-gray-700">SE Keywords</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {overview.organicCompetitors!.map((c, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-4 py-2">
                                  <a href={`https://${c.competitor}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                                    {c.competitor}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </td>
                                <td className="px-4 py-2">
                                  <div className="w-20 h-2 bg-gray-200 rounded overflow-hidden">
                                    <div className="h-full bg-blue-500 rounded" style={{ width: `${c.comLevel}%` }} />
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-gray-600">{c.comKeywords.toLocaleString()}</td>
                                <td className="px-4 py-2 text-blue-600">{c.seKeywords.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="px-4 py-3 border-t border-gray-100">
                        <button type="button" className="text-sm font-medium text-blue-600 hover:text-blue-700">View details</button>
                      </div>
                    </>
                  ) : (
                    <div className="p-8 text-center text-gray-500 text-sm">Find your direct competitors</div>
                  )}
                </div>
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <h4 className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900 bg-gray-50">Competitive Positioning Map</h4>
                  <div className="p-4">
                    <div className="flex flex-wrap gap-2 mb-2 text-xs">
                      {competitorMapData.map((d, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                          <span className="text-gray-600 truncate max-w-[80px]">{d.name}</span>
                        </span>
                      ))}
                    </div>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
                          <XAxis type="number" dataKey="keywords" name="Organic Keywords" domain={[0, "auto"]} tick={{ fontSize: 10 }} />
                          <YAxis type="number" dataKey="traffic" name="Organic Search Traffic" domain={[0, "auto"]} tick={{ fontSize: 10 }} />
                          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                          {competitorMapData.map((entry, index) => (
                            <Scatter key={index} data={[entry]} fill={entry.fill} />
                          ))}
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Screenshot 7-8: Advertising Research - placeholders */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <h3 className="px-6 py-4 border-b border-gray-200 text-base font-semibold text-gray-900">
              Advertising Research
            </h3>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {["Top Paid Keywords", "Paid Position Distribution", "Main Paid Competitors", "Competitive Positioning Map", "Sample Text Ads"].map((title) => (
                <div key={title} className="rounded-lg border border-gray-200 p-8 flex flex-col items-center justify-center min-h-[160px] bg-gray-50/30">
                  <p className="text-base font-medium text-gray-700">{title}</p>
                  <p className="text-sm text-gray-500 mt-1">Nothing found</p>
                  <p className="text-xs text-gray-400 mt-0.5">Try changing your filters.</p>
                </div>
              ))}
            </div>
          </div>

          {/* Backlinks - match reference: filters, Export, Follow/Nofollow labels, Backlink Types bars, Top Anchors, Referring Domains, Title & URL */}
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                Backlinks
              </h3>
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-purple-600 border-b-2 border-purple-600 pb-0.5">Worldwide</span>
                <span className="text-sm font-medium text-purple-600 border-b-2 border-purple-600 pb-0.5">All time</span>
                <Calendar className="h-4 w-4 text-gray-500" />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">Backlinks</h4>
                  <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
                    <Upload className="h-4 w-4" />
                    Export
                  </button>
                </div>
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Referring Page Title / Referring Page URL</th>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Anchor Text / Link URL</th>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {(overview.backlinksList ?? []).slice(0, 20).map((b, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-6 py-3 text-gray-900">
                            <a href={b.referringPageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block max-w-[220px]" title={b.referringPageUrl}>
                              {b.referringPageTitle || b.referringPageUrl}
                            </a>
                          </td>
                          <td className="px-6 py-3">
                            <span className="text-gray-900">{b.anchorText || "(empty)"}</span>
                            {" — "}
                            <a href={b.linkUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate inline-block max-w-[160px]" title={b.linkUrl}>{b.linkUrl}</a>
                          </td>
                          <td className="px-6 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${b.type === "follow" ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-600"}`}>
                              {b.type}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {(!overview.backlinksList?.length) && (
                        <tr><td colSpan={3} className="px-6 py-4 text-gray-500">No backlinks data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-6 py-3 border-t border-gray-100">
                  <button type="button" className="text-sm font-medium text-blue-600 hover:text-blue-700">View details</button>
                </div>
              </div>
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h4 className="font-medium text-gray-900 mb-4">Follow vs Nofollow</h4>
                  {followNofollowData.length > 0 ? (
                    <>
                      <div className="h-40">
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
                      <div className="mt-2 flex flex-wrap gap-4 justify-center text-sm">
                        <span className="text-purple-700 font-medium">Follow links {(overview.followNofollow.follow >= 1000 ? (overview.followNofollow.follow / 1000).toFixed(2) + "K" : overview.followNofollow.follow.toLocaleString())}</span>
                        <span className="text-gray-600">Nofollow links {(overview.followNofollow.nofollow >= 1000 ? (overview.followNofollow.nofollow / 1000).toFixed(2) + "K" : overview.followNofollow.nofollow.toLocaleString())}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">No data</p>
                  )}
                  <div className="mt-4">
                    <button type="button" className="text-sm font-medium text-blue-600 hover:text-blue-700">View details</button>
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
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-700">{bt.type}</span>
                            <span className="font-medium text-blue-600">{bt.pct}% ({bt.count >= 1000 ? (bt.count / 1000).toFixed(1) + "K" : bt.count.toLocaleString()})</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-500 rounded-full" style={{ width: `${bt.pct}%` }} />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                  <div className="mt-4">
                    <button type="button" className="text-sm font-medium text-blue-600 hover:text-blue-700">View full report</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">Top Anchors</h4>
                  <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
                    <Upload className="h-4 w-4" />
                    Export
                  </button>
                </div>
                <div className="overflow-x-auto max-h-48 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Anchor</th>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Domains</th>
                        <th className="px-6 py-3 text-left font-medium text-gray-700">Backlinks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {overview.topAnchors.slice(0, 10).map((a, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-6 py-3 text-gray-900 truncate max-w-[200px]" title={a.anchor}>{a.anchor === "(empty)" ? "<EmptyAnchor>" : a.anchor}</td>
                          <td className="px-6 py-3 text-gray-600">{a.domains != null ? a.domains.toLocaleString() : "—"}</td>
                          <td className="px-6 py-3 text-blue-600 font-medium">{a.refDomains.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h4 className="font-medium text-gray-900">Referring Domains</h4>
                  <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
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
                      {overview.referringDomains.slice(0, 15).map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-6 py-3">
                            <a href={`https://${r.domain}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                              {r.domain}
                              <ExternalLink className="h-3 w-3 flex-shrink-0" />
                            </a>
                          </td>
                          <td className="px-6 py-3 text-gray-600">—</td>
                          <td className="px-6 py-3 text-gray-900">{r.backlinks.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <h4 className="px-6 py-4 border-b border-gray-200 font-medium text-gray-900">Title & URL</h4>
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
                    {overview.indexedPages.slice(0, 10).map((p, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-6 py-3">
                          <span className="text-gray-500">—</span>
                          {" "}
                          <a href={`https://${overview.client?.domain ?? ""}${p.url}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate inline-block max-w-[320px]" title={`https://${overview.client?.domain ?? ""}${p.url}`}>
                            https://{overview.client?.domain ?? ""}{p.url}
                          </a>
                        </td>
                        <td className="px-6 py-3 text-gray-900">{p.refDomains.toLocaleString()}</td>
                        <td className="px-6 py-3 text-gray-900">{p.refDomains.toLocaleString()}</td>
                      </tr>
                    ))}
                    {(!overview.indexedPages?.length) && (
                      <tr><td colSpan={3} className="px-6 py-4 text-gray-500">No data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DomainResearchView;
