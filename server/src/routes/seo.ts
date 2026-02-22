import crypto from "crypto";
import express from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authenticateToken, optionalAuthenticateToken, getJwtSecret } from "../middleware/auth.js";
import { requireAgencyTrialNotExpired } from "../middleware/requireAgencyTrialNotExpired.js";
import jwt from "jsonwebtoken";
import { getAgencyTierContext, canAddTargetKeyword, hasResearchCredits, useResearchCredits } from "../lib/agencyLimits.js";
import { getTierConfig, getRankRefreshIntervalMs, getAiRefreshIntervalMs } from "../lib/tiers.js";
import { syncAgencyTierFromStripe } from "../lib/stripeTierSync.js";

const router = express.Router();

// Restrict agency users with expired trial to subscription/me/activate only
router.use(optionalAuthenticateToken, requireAgencyTrialNotExpired);

type DataForSEOGoogleAdsLocation = {
  location_code: number;
  location_name: string;
  location_code_parent: number | null;
  country_iso_code: string | null;
  location_type: string | null;
};

let googleAdsLocationsCache: {
  loadedAt: number;
  locations: DataForSEOGoogleAdsLocation[];
} | null = null;
let googleAdsLocationsLoadPromise: Promise<DataForSEOGoogleAdsLocation[]> | null = null;

const GOOGLE_ADS_LOCATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function normalizeLocationName(value: string): string {
  // Normalize for matching DataForSEO location list:
  // - trim
  // - normalize comma spacing: "Arkansas,United States" -> "Arkansas, United States"
  // - collapse multiple spaces
  return String(value || "")
    .trim()
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ");
}

function normalizeLocationNameForMatch(value: string): string {
  return normalizeLocationName(value).toLowerCase();
}

async function resolveLocationCodeFromName(locationName: string): Promise<number | null> {
  const normalized = normalizeLocationNameForMatch(locationName);
  if (!normalized) return null;
  const all = await getGoogleAdsLocationsCached();

  // Prefer exact match
  const exact = all.find((loc) => normalizeLocationNameForMatch(loc.location_name) === normalized);
  if (exact?.location_code) return exact.location_code;

  // Fallback: closest contains match (can happen with minor formatting differences)
  const contains = all.find((loc) => normalizeLocationNameForMatch(loc.location_name).includes(normalized));
  if (contains?.location_code) return contains.location_code;

  return null;
}

// DataForSEO-billable refresh throttling + in-flight dedupe
// Requirement: avoid repeated pulls (and billing) when users visit/refresh the same report/dashboard many times.
const DATAFORSEO_REFRESH_TTL_MS = 48 * 60 * 60 * 1000; // 48h
const VENDASTA_AUTO_REFRESH_TTL_MS = 48 * 60 * 60 * 1000; // 48h for Vendasta clients
const OTHER_CLIENTS_AUTO_REFRESH_TTL_MS = 40 * 60 * 60 * 1000; // 40h for other clients
const inflightByKey = new Map<string, Promise<any>>();

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

async function dedupeInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflightByKey.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inflightByKey.delete(key));
  inflightByKey.set(key, p as any);
  return p;
}

function isFresh(lastUpdatedAt: Date | null | undefined, ttlMs: number): boolean {
  if (!lastUpdatedAt) return false;
  return Date.now() - lastUpdatedAt.getTime() < ttlMs;
}

/** Returns true if the URL is a Google search/SERP page (e.g. google.com/search?q=...), not a ranking website. */
function isGoogleSerpUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return (host === "google.com" || host.endsWith(".google.com")) && u.pathname === "/search";
  } catch {
    return false;
  }
}

/** Use only for the "Google URL" / ranking URL field: returns the URL if it's a real website, null if it's a Google SERP URL or invalid. */
function onlyRankingWebsiteUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return null;
  if (isGoogleSerpUrl(url)) return null;
  return url;
}

async function getLatestTrafficSourceUpdatedAt(clientId: string): Promise<Date | null> {
  const latest = await prisma.trafficSource.findFirst({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return latest?.createdAt ?? null;
}

async function getLatestRankedKeywordsHistoryUpdatedAt(clientId: string): Promise<Date | null> {
  const latest = await prisma.rankedKeywordsHistory.findFirst({
    where: { clientId },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return latest?.updatedAt ?? null;
}

async function getLatestTopPagesUpdatedAt(clientId: string): Promise<Date | null> {
  const latest = await prisma.topPage.findFirst({
    where: { clientId },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return latest?.updatedAt ?? null;
}

async function getLatestGa4MetricsUpdatedAt(clientId: string): Promise<Date | null> {
  const latest = await prisma.ga4Metrics.findFirst({
    where: { clientId },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return latest?.updatedAt ?? null;
}

async function getLatestBacklinksUpdatedAt(clientId: string): Promise<Date | null> {
  // Backlink refresh writes backlinkTimeseries and (optionally) backlink list records.
  const latestTimeseries = await prisma.backlinkTimeseries.findFirst({
    where: { clientId },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  const latestBacklinkRow = await prisma.backlink.findFirst({
    where: {
      clientId,
      // Only consider DataForSEO-synced rows for freshness; manual rows shouldn't block refresh.
      OR: [{ firstSeen: { not: null } }, { lastSeen: { not: null } }],
    },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });

  const a = latestTimeseries?.updatedAt ?? null;
  const b = latestBacklinkRow?.updatedAt ?? null;
  if (a && b) return a > b ? a : b;
  return a ?? b;
}

/** Latest DataForSEO update across traffic, ranked keywords, backlinks, top pages (for auto-refresh scheduling). */
async function getDataForSeoLastUpdated(clientId: string): Promise<Date | null> {
  const [traffic, ranked, backlinks, topPages] = await Promise.all([
    getLatestTrafficSourceUpdatedAt(clientId),
    getLatestRankedKeywordsHistoryUpdatedAt(clientId),
    getLatestBacklinksUpdatedAt(clientId),
    getLatestTopPagesUpdatedAt(clientId),
  ]);
  const dates = [traffic, ranked, backlinks, topPages].filter((d): d is Date => d != null);
  return dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

async function fetchGoogleAdsLocationsFromDataForSEO(): Promise<DataForSEOGoogleAdsLocation[]> {
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth) {
    throw new Error(
      "DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable."
    );
  }

  const response = await fetch(
    "https://api.dataforseo.com/v3/keywords_data/google_ads/locations",
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${base64Auth}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
  }

  const data: any = await response.json();
  const locations: DataForSEOGoogleAdsLocation[] =
    data?.tasks?.[0]?.result && Array.isArray(data.tasks[0].result) ? data.tasks[0].result : [];
  return locations;
}

async function getGoogleAdsLocationsCached(): Promise<DataForSEOGoogleAdsLocation[]> {
  const now = Date.now();
  if (googleAdsLocationsCache && now - googleAdsLocationsCache.loadedAt < GOOGLE_ADS_LOCATIONS_CACHE_TTL_MS) {
    return googleAdsLocationsCache.locations;
  }

  if (!googleAdsLocationsLoadPromise) {
    googleAdsLocationsLoadPromise = fetchGoogleAdsLocationsFromDataForSEO()
      .then((locations) => {
        googleAdsLocationsCache = { loadedAt: Date.now(), locations };
        return locations;
      })
      .finally(() => {
        googleAdsLocationsLoadPromise = null;
      });
  }

  return googleAdsLocationsLoadPromise;
}

// Super Admin dashboard metrics (SUPER_ADMIN only)
router.get("/super-admin/dashboard", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }
    const now = new Date();

    const [totalAgencies, activeAgenciesCount, activeClientsCount, totalDashboards, pendingRequests] = await Promise.all([
      prisma.agency.count(),
      prisma.agency.count({
        where: {
          subscriptionTier: { not: null },
          OR: [{ trialEndsAt: null }, { trialEndsAt: { gt: now } }],
        },
      }),
      prisma.client.count({ where: { status: "ACTIVE" } }),
      prisma.client.count(),
      prisma.managedService.count({ where: { status: "PENDING" } }),
    ]);

    return res.json({
      totalAgencies,
      activeAgencies: activeAgenciesCount,
      activeManagedClients: activeClientsCount,
      totalDashboards,
      pendingRequests,
    });
  } catch (err: any) {
    console.error("Super admin dashboard error:", err);
    res.status(500).json({ message: err?.message || "Failed to load dashboard" });
  }
});

// Super Admin in-app notifications (pending requests, new signups) for bell dropdown
router.get("/super-admin/notifications", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied" });
    }

    const [pendingServices, recentAgencies] = await Promise.all([
      prisma.managedService.findMany({
        where: { status: "PENDING" },
        include: {
          client: { select: { name: true } },
          agency: { select: { name: true } },
        },
        orderBy: { startDate: "desc" },
        take: 10,
      }),
      prisma.agency.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, createdAt: true },
      }),
    ]);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const items: Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      link: string;
      createdAt: string;
    }> = [];

    for (const ms of pendingServices) {
      items.push({
        id: `pending-${ms.id}`,
        type: "managed_service_request",
        title: "Managed service pending approval",
        message: `${ms.agency.name} – ${ms.client.name} (${ms.packageName})`,
        link: "/superadmin/dashboard",
        createdAt: ms.startDate.toISOString(),
      });
    }

    for (const agency of recentAgencies) {
      if (new Date(agency.createdAt) >= sevenDaysAgo) {
        items.push({
          id: `agency-${agency.id}`,
          type: "new_agency_signup",
          title: "New agency",
          message: agency.name,
          link: "/agency/agencies",
          createdAt: agency.createdAt.toISOString(),
        });
      }
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const unreadCount = pendingServices.length;

    return res.json({
      unreadCount,
      items: items.slice(0, 15),
    });
  } catch (err: any) {
    console.error("Super admin notifications error:", err);
    res.status(500).json({ message: err?.message || "Failed to load notifications" });
  }
});

// Search Google Ads locations (DataForSEO) for UI combobox
router.get("/locations", authenticateToken, async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

    // Require a short query to avoid returning massive datasets
    if (q.length < 2) {
      return res.json([]);
    }

    const all = await getGoogleAdsLocationsCached();
    const qLower = q.toLowerCase();
    const matches = all
      .filter((loc) => (loc.location_name || "").toLowerCase().includes(qLower))
      .slice(0, limit)
      .map((loc) => ({
        location_code: loc.location_code,
        location_name: loc.location_name,
        country_iso_code: loc.country_iso_code,
        location_type: loc.location_type,
      }));

    res.json(matches);
  } catch (error: any) {
    console.error("Locations search error:", error);
    if (error.message?.includes("DataForSEO credentials")) {
      return res.status(500).json({ message: error.message });
    }
    res.status(500).json({ message: "Failed to fetch locations" });
  }
});

// DataForSEO API helper function
async function fetchKeywordDataFromDataForSEO(
  keyword: string, 
  clientDomain?: string,
  locationCode: number = 2840, 
  languageCode: string = "en"
) {
  // Prisma `Int` maps to 32-bit signed; DataForSEO can exceed it.
  const clampDbInt = (value: unknown) => {
    const MAX_INT = 2147483647;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.min(MAX_INT, Math.max(0, Math.round(numeric)));
  };

  const base64Auth = process.env.DATAFORSEO_BASE64;

  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  const requestBody = [{
    keyword,
    calculate_rectangles: true,
    language_code: languageCode,
    location_code: locationCode
  }];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${base64Auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Parse the response structure
    if (data.tasks && data.tasks.length > 0 && data.tasks[0].result) {
      const result = data.tasks[0].result[0];
      
      // Extract keyword data from the SERP results
      const items = result?.items || [];
      
      // Find organic results
      const organicResults = items.filter((item: any) => item.type === "organic");
      
      // Extract position for client's domain if provided
      let currentPosition: number | null = null;
      let bestPosition: number | null = null;
      let googleUrl: string | null = null;
      
      if (clientDomain) {
        const normalizeHost = (value: string) => {
          const raw = String(value || "").trim();
          if (!raw) return "";
          try {
            const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
            return url.hostname.replace(/^www\./, "").toLowerCase();
          } catch {
            return raw
              .replace(/^https?:\/\//, "")
              .replace(/^www\./, "")
              .split("/")[0]
              .toLowerCase();
          }
        };

        const clientHost = normalizeHost(clientDomain);
        
        // Search for client's domain in organic results
        for (let i = 0; i < organicResults.length; i++) {
          const item = organicResults[i];
          const itemUrl = String(item?.url || "");
          const itemDomain = String(item?.domain || "");
          const itemHost = normalizeHost(itemUrl || itemDomain);
          
          if (
            clientHost &&
            itemHost &&
            (itemHost === clientHost ||
              itemHost.endsWith(`.${clientHost}`) ||
              clientHost.endsWith(`.${itemHost}`))
          ) {
            // DataForSEO provides rank metadata; use it when available (more accurate than array index).
            const rankAbsolute = Number(item?.rank_absolute);
            const rankGroup = Number(item?.rank_group);
            const resolvedRank = Number.isFinite(rankGroup) && rankGroup > 0
              ? rankGroup
              : Number.isFinite(rankAbsolute) && rankAbsolute > 0
                ? rankAbsolute
                : i + 1;

            currentPosition = resolvedRank;
            // Prefer the ranking page URL; fall back to domain if needed. Never use a Google SERP URL.
            const candidate = itemUrl || (itemDomain ? `https://${itemDomain}` : null);
            googleUrl = onlyRankingWebsiteUrl(candidate) || null;
            break;
          }
        }
      }
      
      // Set best position if we found the domain
      if (currentPosition) {
        bestPosition = currentPosition;
      }
      
      // Extract additional metrics if available
      const totalResults = clampDbInt(result?.total_count);
      
      // Extract SERP features from items
      const serpFeaturesList: string[] = [];
      items.forEach((item: any) => {
        if (item.type) {
          // Map DataForSEO item types to SERP feature names
          const featureMap: Record<string, string> = {
            "organic": "organic",
            "video": "video",
            "images": "images",
            "local_pack": "local_pack",
            "featured_snippet": "featured_snippet",
            "knowledge_graph": "knowledge_graph",
            "people_also_ask": "people_also_ask",
            "related_searches": "related_searches",
            "shopping": "shopping",
            "hotels_pack": "hotels_pack",
            "jobs": "jobs",
            "news": "news",
            "map": "map",
            "twitter": "twitter",
            "video_other": "video",
            "image_other": "images"
          };
          
          const featureName = featureMap[item.type] || item.type;
          if (featureName && !serpFeaturesList.includes(featureName)) {
            serpFeaturesList.push(featureName);
          }
        }
      });
      
      return {
        currentPosition,
        bestPosition,
        googleUrl,
        searchVolume: 0, // SERP API doesn't provide this
        difficulty: null, // SERP API doesn't provide this
        cpc: null, // SERP API doesn't provide this
        totalResults,
        organicResultsCount: organicResults.length,
        serpFeatures: serpFeaturesList,
        serpData: result // Store full SERP data for reference
      };
    }
    
    return {
      currentPosition: null,
      bestPosition: null,
      googleUrl: null,
      searchVolume: 0,
      difficulty: null,
      cpc: null,
      totalResults: 0,
      organicResultsCount: 0,
      serpFeatures: [],
      serpData: null
    };
  } catch (error: any) {
    console.error("DataForSEO API error:", error);
    throw error;
  }
}

async function fetchKeywordOverviewFromDataForSEO(params: {
  keywords: string[];
  languageCode: string;
  locationName?: string;
  locationCode?: number;
  includeClickstreamData?: boolean;
  includeSerpInfo?: boolean;
}) {
  const base64Auth = process.env.DATAFORSEO_BASE64;

  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  const task: any = {
    language_code: params.languageCode,
    include_clickstream_data: params.includeClickstreamData ?? true,
    include_serp_info: params.includeSerpInfo ?? true,
    keywords: params.keywords,
  };
  if (typeof params.locationCode === "number" && Number.isFinite(params.locationCode)) {
    task.location_code = params.locationCode;
  } else if (typeof params.locationName === "string" && params.locationName.trim()) {
    task.location_name = params.locationName.trim();
  } else {
    task.location_code = 2840; // United States fallback
  }

  const requestBody = [task];

  const response = await fetch(
    "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${base64Auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
  }

  const raw: any = await response.json();
  const item =
    raw?.tasks?.[0]?.result?.[0]?.items?.[0] && typeof raw.tasks[0].result[0].items[0] === "object"
      ? raw.tasks[0].result[0].items[0]
      : null;

  return { raw, item };
}

async function fetchRelevantPagesFromDataForSEO(
  target: string,
  limit: number = 10,
  locationCode: number = 2840,
  languageName: string = "English"
) {
  const base64Auth = process.env.DATAFORSEO_BASE64;

  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  const requestBody = [
    {
      target,
      se_type: "google",
      location_code: locationCode,
      language_name: languageName,
      limit,
    },
  ];

  const response = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/relevant_pages/live", {
    method: "POST",
    headers: {
      Authorization: `Basic ${base64Auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const items: any[] =
    data?.tasks?.[0]?.result?.[0]?.items && Array.isArray(data.tasks[0].result[0].items)
      ? data.tasks[0].result[0].items
      : [];

  return items.map((item) => {
    const organic = item?.metrics?.organic || {};
    const paid = item?.metrics?.paid || {};

    return {
      url: item?.page_address || "",
      organic: {
        pos1: Number(organic.pos_1 ?? 0),
        pos2_3: Number(organic.pos_2_3 ?? 0),
        pos4_10: Number(organic.pos_4_10 ?? 0),
        count: Number(organic.count ?? 0),
        etv: Number(organic.etv ?? 0),
        isNew: Number(organic.is_new ?? 0),
        isUp: Number(organic.is_up ?? 0),
        isDown: Number(organic.is_down ?? 0),
        isLost: Number(organic.is_lost ?? 0),
      },
      paid: {
        count: Number(paid.count ?? 0),
        etv: Number(paid.etv ?? 0),
      },
      raw: item,
    };
  });
}

const TRAFFIC_SOURCE_CATEGORIES = ["Organic", "Direct", "Referral", "Paid", "Other"] as const;
type TrafficSourceCategory = (typeof TRAFFIC_SOURCE_CATEGORIES)[number];

function mapKeywordToTrafficSourceCategory(
  serpTypeRaw: string | undefined,
  intentRaw: string | undefined
): TrafficSourceCategory {
  const serpType = (serpTypeRaw || "").toLowerCase();
  const intent = (intentRaw || "").toLowerCase();

  if (intent === "navigational") {
    return "Direct";
  }

  if (intent === "commercial" || intent === "transactional") {
    return "Paid";
  }

  if (
    serpType.includes("paid") ||
    serpType.includes("shopping") ||
    serpType.includes("ads") ||
    serpType.includes("hotel")
  ) {
    return "Paid";
  }

  if (
    serpType.includes("local") ||
    serpType.includes("map") ||
    serpType.includes("people_also_ask") ||
    serpType.includes("image") ||
    serpType.includes("video") ||
    serpType.includes("news") ||
    serpType.includes("top_stories")
  ) {
    return "Referral";
  }

  if (!serpType || serpType.includes("organic")) {
    return "Organic";
  }

  return "Other";
}

async function fetchTrafficSourcesFromRankedKeywords(
  target: string,
  limit: number = 100,
  locationCode: number = 2840,
  languageName: string = "English"
) {
  const base64Auth = process.env.DATAFORSEO_BASE64;

  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  const requestBody = [
    {
      target,
      se_type: "google",
      location_code: locationCode,
      language_name: languageName,
      limit,
    },
  ];

  const response = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live", {
    method: "POST",
    headers: {
      Authorization: `Basic ${base64Auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const items: any[] =
    data?.tasks?.[0]?.result?.[0]?.items && Array.isArray(data.tasks[0].result[0].items)
      ? data.tasks[0].result[0].items
      : [];

  const breakdownTotals: Record<TrafficSourceCategory, number> = {
    Organic: 0,
    Direct: 0,
    Referral: 0,
    Paid: 0,
    Other: 0,
  };

  let totalEtv = 0;
  let sumRank = 0;
  let rankCount = 0;

  items.forEach((item) => {
    const serpItem = item?.ranked_serp_element?.serp_item || {};
    const serpType: string | undefined = serpItem?.type;
    const mainIntent: string | undefined = item?.keyword_data?.search_intent_info?.main_intent;

    const valueFromEtv = Number(
      serpItem?.etv ??
        item?.ranked_serp_element?.etv ??
        item?.keyword_data?.keyword_info?.etv ??
        item?.keyword_data?.keyword_info?.search_volume ??
        0
    );

    const weight = Number.isFinite(valueFromEtv) && valueFromEtv > 0 ? valueFromEtv : 0;

    const rankCandidates: Array<number | undefined> = [
      serpItem?.rank_group,
      serpItem?.rank_absolute,
      serpItem?.position,
      item?.ranked_serp_element?.rank_group,
      item?.ranked_serp_element?.rank_absolute,
      item?.ranked_serp_element?.position,
      item?.ranked_serp_element?.rank,
    ].map((val) => (val !== undefined && val !== null ? Number(val) : undefined));

    const rankValue = rankCandidates.find((val) => val !== undefined && Number.isFinite(val) && val > 0);
    if (rankValue !== undefined) {
      sumRank += rankValue;
      rankCount += 1;
    }

    if (weight > 0) {
      totalEtv += weight;
    }

    const category = mapKeywordToTrafficSourceCategory(serpType, mainIntent);

    breakdownTotals[category] = (breakdownTotals[category] || 0) + weight;
  });

  const breakdown = TRAFFIC_SOURCE_CATEGORIES.map((category) => ({
    name: category,
    value: Number(breakdownTotals[category]?.toFixed(2) ?? 0),
  })).filter((item) => item.value > 0);

  const totalEstimatedTraffic = Number(totalEtv.toFixed(2));
  const organicEstimatedTraffic = Number((breakdownTotals.Organic || 0).toFixed(2));
  const averageRank = rankCount > 0 ? Number((sumRank / rankCount).toFixed(2)) : null;

  return {
    breakdown,
    totalKeywords: items.length,
    totalEstimatedTraffic,
    organicEstimatedTraffic,
    averageRank,
    rankSampleSize: rankCount,
  };
}

async function fetchKeywordSuggestionsFromDataForSEO(
  seedKeyword: string,
  limit: number = 50,
  locationCode: number = 2840,
  languageCode: string = "en"
) {
  const base64Auth = process.env.DATAFORSEO_BASE64;

  if (!base64Auth) {
    throw new Error(
      "DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable."
    );
  }

  // DataForSEO related_keywords: max limit 1000; depth 1 ≈ 8, 2 ≈ 72, 3 ≈ 584, 4 ≈ 4680 keywords.
  const requestLimit = Math.min(Math.max(limit, 1), 1000);
  const depth = requestLimit <= 8 ? 1 : requestLimit <= 72 ? 2 : requestLimit <= 584 ? 3 : 4;

  const requestBody = [
    {
      keyword: seedKeyword,
      location_code: locationCode,
      language_code: languageCode,
      include_serp_info: false,
      depth,
      limit: requestLimit,
    },
  ];

  const response = await fetch(
    "https://api.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${base64Auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const items: any[] =
    data?.tasks?.[0]?.result?.[0]?.items && Array.isArray(data.tasks[0].result[0].items)
      ? data.tasks[0].result[0].items
      : [];

  const mapped = items.map((item) => {
    const keywordData = item?.keyword_data || {};
    const keywordInfo = keywordData?.keyword_info || item?.keyword_info || {};
    // DataForSEO Labs related keywords returns keyword difficulty under keyword_properties.
    // (It may also expose competition_index; keep that as a fallback.)
    const keywordDifficultyRaw =
      keywordData?.keyword_properties?.keyword_difficulty ?? item?.keyword_properties?.keyword_difficulty;
    const keywordDifficulty = Number(keywordDifficultyRaw);

    const competitionIndex = keywordInfo?.competition_index;
    const competitionIndexAsPercent =
      typeof competitionIndex === "number"
        ? Math.max(0, Math.min(100, Math.round(competitionIndex * 100)))
        : null;

    const normalizedDifficulty = Number.isFinite(keywordDifficulty)
      ? Math.max(0, Math.min(100, Math.round(keywordDifficulty)))
      : competitionIndexAsPercent;

    return {
      keyword: keywordData?.keyword || item?.keyword || "",
      searchVolume: Number(keywordInfo?.search_volume ?? 0),
      cpc: Number(keywordInfo?.cpc ?? keywordInfo?.cpc_v2 ?? 0),
      competition: Number(keywordInfo?.competition ?? 0),
      competitionLevel: keywordInfo?.competition_level || null,
      difficulty: normalizedDifficulty,
      monthlySearches: Array.isArray(keywordInfo?.monthly_searches) ? keywordInfo.monthly_searches : [],
      keywordProperties: keywordData?.keyword_properties || item?.keyword_properties || null,
      seed: seedKeyword,
    };
  });

  // Deduplicate by keyword (API may return same keyword from different depths); then return exactly `limit`.
  const seen = new Set<string>();
  const deduped = mapped.filter((r) => {
    const key = (r.keyword || "").toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.slice(0, limit);
}

/** DataForSEO keyword_suggestions — returns Google Autocomplete-style keyword variations that contain the seed. */
async function fetchKeywordVariationsFromDataForSEO(
  seedKeyword: string,
  limit: number = 1000,
  locationCode: number = 2840,
  languageCode: string = "en"
): Promise<{ keyword: string; searchVolume: number; cpc: number | null; competition: number | null; competitionLevel: string | null; difficulty: number | null; seed: string }[]> {
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth) return [];

  const requestLimit = Math.min(Math.max(limit, 1), 1000);

  const requestBody = [
    {
      keyword: seedKeyword,
      location_code: locationCode,
      language_code: languageCode,
      include_serp_info: false,
      include_clickstream_data: false,
      limit: requestLimit,
    },
  ];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live", {
      method: "POST",
      headers: {
        Authorization: `Basic ${base64Auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.warn(`[DataForSEO keyword_suggestions] API returned ${response.status}`);
      return [];
    }

    const data = await response.json();
    const items: any[] =
      data?.tasks?.[0]?.result?.[0]?.items && Array.isArray(data.tasks[0].result[0].items)
        ? data.tasks[0].result[0].items
        : [];

    const seedLower = seedKeyword.toLowerCase().trim();
    const seen = new Set<string>();
    const results: { keyword: string; searchVolume: number; cpc: number | null; competition: number | null; competitionLevel: string | null; difficulty: number | null; seed: string }[] = [];

    for (const item of items) {
      const kw = (item?.keyword || "").trim();
      const kwLower = kw.toLowerCase();
      if (!kw || seen.has(kwLower)) continue;
      if (!kwLower.includes(seedLower)) continue;
      seen.add(kwLower);
      const keywordInfo = item?.keyword_info || {};
      const keywordProps = item?.keyword_properties || {};
      const difficulty = Number(keywordProps?.keyword_difficulty ?? null);
      results.push({
        keyword: kw,
        searchVolume: Number(keywordInfo?.search_volume ?? 0),
        cpc: keywordInfo?.cpc != null ? Number(keywordInfo.cpc) : null,
        competition: keywordInfo?.competition != null ? Number(keywordInfo.competition) : null,
        competitionLevel: keywordInfo?.competition_level || null,
        difficulty: Number.isFinite(difficulty) ? Math.max(0, Math.min(100, Math.round(difficulty))) : null,
        seed: seedKeyword,
      });
    }

    return results.slice(0, limit);
  } catch (err) {
    console.warn("[DataForSEO keyword_suggestions] Error:", (err as Error).message);
    return [];
  }
}

/** DataForSEO keyword_ideas with question filter — returns question-style keywords for Keyword Ideas. */
async function fetchQuestionKeywordsFromDataForSEO(
  seedKeyword: string,
  limit: number = 20,
  locationCode: number = 2840,
  languageCode: string = "en"
): Promise<{ keyword: string; searchVolume: number; cpc: number | null; competition: number | null; competitionLevel: string | null; difficulty: number | null; seed: string }[]> {
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth) return [];

  // Question words: fetch with "how" and "what" filters, then merge and dedupe
  const questionFilters = ["%how%", "%what%"];
  const allItems: { keyword: string; searchVolume: number; cpc: number | null; competition: number | null; competitionLevel: string | null; difficulty: number | null; seed: string }[] = [];
  const seen = new Set<string>();

  for (const filterVal of questionFilters) {
    try {
      const requestBody = [
        {
          keywords: [seedKeyword],
          location_code: locationCode,
          language_code: languageCode,
          include_serp_info: false,
          include_clickstream_data: false,
          limit: Math.ceil(limit / 2) + 5,
          filters: [["keyword", "like", filterVal]],
        },
      ];
      const response = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live", {
        method: "POST",
        headers: {
          Authorization: `Basic ${base64Auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) continue;
      const data = await response.json();
      const items: any[] =
        data?.tasks?.[0]?.result?.[0]?.items && Array.isArray(data.tasks[0].result[0].items) ? data.tasks[0].result[0].items : [];
      for (const item of items) {
        const kw = (item?.keyword || "").trim().toLowerCase();
        if (!kw || seen.has(kw)) continue;
        seen.add(kw);
        const keywordInfo = item?.keyword_info || {};
        const keywordProps = item?.keyword_properties || {};
        const difficulty = Number(keywordProps?.keyword_difficulty ?? null);
        allItems.push({
          keyword: item?.keyword || "",
          searchVolume: Number(keywordInfo?.search_volume ?? 0),
          cpc: keywordInfo?.cpc != null ? Number(keywordInfo.cpc) : null,
          competition: keywordInfo?.competition != null ? Number(keywordInfo.competition) : null,
          competitionLevel: keywordInfo?.competition_level || null,
          difficulty: Number.isFinite(difficulty) ? difficulty : null,
          seed: seedKeyword,
        });
      }
    } catch {
      // ignore per-filter errors
    }
  }

  return allItems.slice(0, limit);
}

async function fetchBacklinkTimeseriesSummaryFromDataForSEO(
  target: string,
  dateFrom: string,
  dateTo: string,
  groupRange: "day" | "week" | "month" = "day"
) {
  const base64Auth = process.env.DATAFORSEO_BASE64;

  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  const requestBody = [
    {
      target,
      date_from: dateFrom,
      date_to: dateTo,
      group_range: groupRange,
    },
  ];

  const endpoint = "https://api.dataforseo.com/v3/backlinks/timeseries_new_lost_summary/live";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${base64Auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const items: any[] =
    data?.tasks?.[0]?.result?.[0]?.items && Array.isArray(data.tasks[0].result[0].items)
      ? data.tasks[0].result[0].items
      : [];

  return items
    .map((item) => {
      const rawDate: string | undefined = item?.date;
      let isoDate = rawDate;
      if (rawDate) {
        const [datePart] = rawDate.split(" ");
        if (datePart) {
          isoDate = new Date(datePart + "T00:00:00Z").toISOString();
        }
      }

      return {
        date: isoDate || rawDate || null,
        newBacklinks: Number(item?.new_backlinks ?? 0),
        lostBacklinks: Number(item?.lost_backlinks ?? 0),
        newReferringDomains: Number(item?.new_referring_domains ?? 0),
        lostReferringDomains: Number(item?.lost_referring_domains ?? 0),
        newReferringMainDomains: Number(item?.new_referring_main_domains ?? 0),
        lostReferringMainDomains: Number(item?.lost_referring_main_domains ?? 0),
        raw: item,
      };
    })
    .filter((item) => item.date);
}

type DataForSEOBacklinkListItem = {
  sourceUrl: string;
  targetUrl: string;
  anchorText: string | null;
  domainRating: number | null;
  urlRating: number | null;
  traffic: number | null;
  isFollow: boolean;
  firstSeen: Date | null;
  lastSeen: Date | null;
};

/**
 * Domain rating: DataForSEO uses 0–1,000 by default (PageRank-like).
 * With rank_scale: "one_hundred" the API returns 0–100 using sin(rank/636.62)*100.
 * For existing 0–1,000 values (legacy DB or API without rank_scale), we apply the same formula.
 */
function normalizeDomainRating(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value <= 100) return Math.min(100, Math.max(0, Math.round(value)));
  // 0–1,000 scale: DataForSEO's formula sin(rank/636.62)*100
  const normalized = Math.sin(value / 636.62) * 100;
  return Math.min(100, Math.max(0, Math.round(normalized)));
}

/**
 * Read real keyword difficulty from DataForSEO Keyword Overview response.
 * API returns keyword_properties.keyword_difficulty (0-100, logarithmic scale; link profiles of top-10 SERP).
 * Handles both flat item and nested keyword_data structure. Returns raw value from DataForSEO.
 */
function getKeywordDifficultyFromOverviewItem(item: any): number | null {
  if (!item || typeof item !== "object") return null;
  const fromProps = item?.keyword_properties?.keyword_difficulty;
  const fromData = item?.keyword_data?.keyword_properties?.keyword_difficulty;
  const raw = fromProps ?? fromData;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function parseDataForSeoDate(value: unknown): Date | null {
  if (value == null) return null;

  // DataForSEO typically returns strings, but be defensive.
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  // Common DataForSEO formats:
  // - "YYYY-MM-DD"
  // - "YYYY-MM-DD HH:mm:ss"
  // - "YYYY-MM-DD HH:mm:ss +00:00"
  // Normalize to ISO so JS Date parsing is consistent.
  let normalized = raw;

  // If it looks like "YYYY-MM-DD", treat as UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    normalized = `${normalized}T00:00:00Z`;
  } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(normalized)) {
    // Replace first whitespace between date/time with 'T'
    normalized = normalized.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
    // If no timezone, assume UTC.
    if (!/[zZ]$/.test(normalized) && !/[+-]\d{2}:\d{2}$/.test(normalized)) {
      normalized = `${normalized}Z`;
    }
    // If timezone is in form "T...:ss +00:00", remove extra space.
    normalized = normalized.replace(/\s+([+-]\d{2}:\d{2})$/, "$1");
  }

  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function fetchBacklinksListFromDataForSEO(
  target: string,
  statusType: "live" | "lost",
  limit: number = 200,
  offset: number = 0
): Promise<DataForSEOBacklinkListItem[]> {
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  const requestBody = [
    {
      target,
      backlinks_status_type: statusType,
      include_subdomains: true,
      limit,
      offset,
      // 0–100 scale (DataForSEO uses sin(rank/636.62)*100); default is 0–1,000
      rank_scale: "one_hundred",
      order_by: ["domain_from_rank,desc"],
    },
  ];

  const endpoint = "https://api.dataforseo.com/v3/backlinks/backlinks/live";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${base64Auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const items: any[] =
    data?.tasks?.[0]?.result?.[0]?.items && Array.isArray(data.tasks[0].result[0].items)
      ? data.tasks[0].result[0].items
      : [];

  return items
    .map((it) => {
      const sourceUrl = typeof it?.url_from === "string" ? it.url_from : "";
      const targetUrl = typeof it?.url_to === "string" ? it.url_to : "";
      if (!sourceUrl || !targetUrl) return null;

      const anchorText =
        typeof it?.anchor === "string"
          ? it.anchor
          : typeof it?.anchor_text === "string"
            ? it.anchor_text
            : null;

      const domainFromRank = Number(it?.domain_from_rank);
      const pageFromRank = Number(it?.page_from_rank);
      const trafficNum = Number(it?.traffic ?? it?.page_from_traffic);

      const dofollow =
        typeof it?.dofollow === "boolean"
          ? it.dofollow
          : typeof it?.do_follow === "boolean"
            ? it.do_follow
            : true;

      return {
        sourceUrl,
        targetUrl,
        anchorText,
        domainRating: normalizeDomainRating(domainFromRank),
        urlRating: Number.isFinite(pageFromRank) ? pageFromRank : null,
        traffic: Number.isFinite(trafficNum) ? Math.max(0, Math.round(trafficNum)) : null,
        isFollow: dofollow,
        firstSeen: parseDataForSeoDate(it?.first_seen),
        lastSeen: parseDataForSeoDate(it?.last_seen),
      } satisfies DataForSEOBacklinkListItem;
    })
    .filter((v): v is DataForSEOBacklinkListItem => Boolean(v));
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Auto-sync cursor for background jobs (rotates through clients without scanning all at once)
let backlinksAutoSyncLastClientId: string | null = null;
let backlinksAutoSyncInFlight = false;

async function fetchBacklinksListAllFromDataForSEO(params: {
  targetDomain: string;
  statusType: "live" | "lost";
  perPage?: number;
  maxItems?: number;
}): Promise<DataForSEOBacklinkListItem[]> {
  const perPage = Math.min(1000, Math.max(50, Number(params.perPage ?? 200)));
  const maxItems = Math.min(20000, Math.max(0, Number(params.maxItems ?? 5000)));

  const all: DataForSEOBacklinkListItem[] = [];
  for (let offset = 0; offset < maxItems; offset += perPage) {
    const page = await fetchBacklinksListFromDataForSEO(params.targetDomain, params.statusType, perPage, offset);
    all.push(...page);
    if (page.length < perPage) break;
  }
  return all.slice(0, maxItems);
}

async function refreshBacklinksForClientInternal(params: {
  clientId: string;
  force?: boolean;
}): Promise<{
  message: string;
  skipped: boolean;
  items: number;
  backlinksInserted: number;
  lastRefreshedAt: Date | null;
  nextAllowedAt: Date | null;
}> {
  const { clientId } = params;
  const force = Boolean(params.force);

  const lastRefreshedAt = await getLatestBacklinksUpdatedAt(clientId);
  const nextAllowedAt = lastRefreshedAt ? new Date(lastRefreshedAt.getTime() + DATAFORSEO_REFRESH_TTL_MS) : null;
  // If the backlinks list hasn't been synced yet (no non-manual backlinks),
  // don't skip even if timeseries is fresh — otherwise UI can show New Links but an empty Backlinks list.
  const nonManualBacklinksCount = await prisma.backlink.count({
    where: {
      clientId,
      OR: [{ firstSeen: { not: null } }, { lastSeen: { not: null } }],
    },
  });

  if (!force && isFresh(lastRefreshedAt, DATAFORSEO_REFRESH_TTL_MS) && nonManualBacklinksCount > 0) {
    return {
      message: "Using cached backlinks data (refresh limited to every 48 hours).",
      skipped: true,
      items: 0,
      backlinksInserted: 0,
      lastRefreshedAt,
      nextAllowedAt,
    };
  }

  const result = await dedupeInFlight(`backlinks-refresh:${clientId}`, async () => {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client || !client.domain) {
      return { notFound: true as const };
    }

    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    const targetDomain = normalizeDomain(client.domain);

    // Get date range (last 30 days) for timeseries summary
    // IMPORTANT: normalize to UTC day boundaries so deleteMany matches stored rows
    // (we store timeseries dates as day-granularity timestamps, typically 00:00:00Z).
    const toUtcStartOfDay = (d: Date) =>
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    const toUtcEndOfDay = (d: Date) =>
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

    const dateTo = toUtcEndOfDay(new Date());
    const dateFrom = toUtcStartOfDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    const summary = await fetchBacklinkTimeseriesSummaryFromDataForSEO(
      targetDomain,
      dateFrom.toISOString().split("T")[0],
      dateTo.toISOString().split("T")[0],
      "day"
    );

    // Delete existing timeseries data for this date range
    await prisma.backlinkTimeseries.deleteMany({
      where: {
        clientId,
        date: {
          gte: dateFrom,
          lte: dateTo,
        },
      },
    });

    // Save new timeseries data to database
    const savedItems = await Promise.all(
      summary.map((item) => {
        if (!item.date) {
          throw new Error("Missing date in backlink timeseries item");
        }
        // Normalize again to UTC day boundary to avoid accidental mismatches/duplicates.
        const parsed = new Date(item.date);
        const date = toUtcStartOfDay(parsed);

        const rawData =
          item.raw == null ? null : typeof item.raw === "string" ? item.raw : JSON.stringify(item.raw);

        // Use upsert to make refresh idempotent and safe under concurrency.
        // This prevents unique constraint crashes if a row already exists for (clientId, date).
        return prisma.backlinkTimeseries.upsert({
          where: {
            clientId_date: {
              clientId,
              date,
            },
          },
          create: {
            clientId,
            date,
            newBacklinks: item.newBacklinks,
            lostBacklinks: item.lostBacklinks,
            newReferringDomains: item.newReferringDomains,
            lostReferringDomains: item.lostReferringDomains,
            newReferringMainDomains: item.newReferringMainDomains,
            lostReferringMainDomains: item.lostReferringMainDomains,
            rawData,
          },
          update: {
            newBacklinks: item.newBacklinks,
            lostBacklinks: item.lostBacklinks,
            newReferringDomains: item.newReferringDomains,
            lostReferringDomains: item.lostReferringDomains,
            newReferringMainDomains: item.newReferringMainDomains,
            lostReferringMainDomains: item.lostReferringMainDomains,
            rawData,
          },
        });
      })
    );

    // Also refresh backlink list (live + lost) into DB so the Backlinks tab can show real rows.
    // Keep manual backlinks (firstSeen=null) by only deleting non-manual ones.
    let backlinksInserted = 0;
    try {
      const maxBacklinksToSync = Number(process.env.DATAFORSEO_BACKLINKS_SYNC_MAX || 5000) || 5000;
      const perStatusMax = Math.max(0, Math.floor(maxBacklinksToSync / 2));
      const perPage = Number(process.env.DATAFORSEO_BACKLINKS_SYNC_PAGE_SIZE || 500) || 500;

      const [liveLinks, lostLinks] = await Promise.all([
        fetchBacklinksListAllFromDataForSEO({
          targetDomain,
          statusType: "live",
          perPage,
          maxItems: perStatusMax,
        }),
        fetchBacklinksListAllFromDataForSEO({
          targetDomain,
          statusType: "lost",
          perPage,
          maxItems: perStatusMax,
        }),
      ]);

      const createRows = [
        ...liveLinks.map((l) => ({
          clientId,
          sourceUrl: l.sourceUrl,
          targetUrl: l.targetUrl,
          anchorText: l.anchorText ?? undefined,
          domainRating: l.domainRating ?? undefined,
          urlRating: l.urlRating ?? undefined,
          traffic: l.traffic ?? undefined,
          isFollow: l.isFollow,
          isLost: false,
          firstSeen: l.firstSeen ?? undefined,
          lastSeen: l.lastSeen ?? undefined,
        })),
        ...lostLinks.map((l) => ({
          clientId,
          sourceUrl: l.sourceUrl,
          targetUrl: l.targetUrl,
          anchorText: l.anchorText ?? undefined,
          domainRating: l.domainRating ?? undefined,
          urlRating: l.urlRating ?? undefined,
          traffic: l.traffic ?? undefined,
          isFollow: l.isFollow,
          isLost: true,
          firstSeen: l.firstSeen ?? undefined,
          lastSeen: l.lastSeen ?? undefined,
        })),
      ];

      // IMPORTANT: Don't wipe previously-synced backlinks unless we successfully fetched new rows.
      // This prevents the Backlinks panel from showing only manual rows when DataForSEO is flaky.
      if (createRows.length > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.backlink.deleteMany({
            where: {
              clientId,
              OR: [{ firstSeen: { not: null } }, { lastSeen: { not: null } }],
            },
          });

          // Insert in chunks to avoid oversized queries
          for (const c of chunk(createRows, 1000)) {
            const created = await tx.backlink.createMany({ data: c });
            backlinksInserted += created.count;
          }
        });
      }
    } catch (backlinksErr) {
      console.warn("[Backlinks Refresh] Failed to refresh backlink list:", backlinksErr);
    }

    return { items: savedItems.length, backlinksInserted, notFound: false as const };
  });

  // If no domain, treat as skipped (no-op) rather than throwing from cron
  if ((result as any).notFound) {
    return {
      message: "Client not found or has no domain",
      skipped: true,
      items: 0,
      backlinksInserted: 0,
      lastRefreshedAt: null,
      nextAllowedAt: null,
    };
  }

  return {
    message: "Backlinks refreshed successfully",
    skipped: false,
    items: (result as any).items ?? 0,
    backlinksInserted: (result as any).backlinksInserted ?? 0,
    lastRefreshedAt: new Date(),
    nextAllowedAt: new Date(Date.now() + DATAFORSEO_REFRESH_TTL_MS),
  };
}

// Background job entrypoint: refresh a small batch of clients, rotating through the whole set over time.
export async function autoSyncBacklinksForStaleClients(params?: { batchSize?: number }) {
  if (backlinksAutoSyncInFlight) return;
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth) return;

  const batchSize = Math.min(25, Math.max(1, Number(params?.batchSize ?? 2)));

  backlinksAutoSyncInFlight = true;
  try {
    const statusFilter = { notIn: ["ARCHIVED" as const, "SUSPENDED" as const, "REJECTED" as const] };
    const where: any = { domain: { not: "" }, status: statusFilter };
    if (backlinksAutoSyncLastClientId) {
      where.id = { gt: backlinksAutoSyncLastClientId };
    }

    let clients = await prisma.client.findMany({
      where,
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true, domain: true, name: true },
    });

    // If we hit the end, wrap around
    if (clients.length === 0 && backlinksAutoSyncLastClientId) {
      backlinksAutoSyncLastClientId = null;
      clients = await prisma.client.findMany({
        where: { domain: { not: "" }, status: statusFilter },
        orderBy: { id: "asc" },
        take: batchSize,
        select: { id: true, domain: true, name: true },
      });
    }

    for (const c of clients) {
      try {
        const res = await refreshBacklinksForClientInternal({ clientId: c.id, force: false });
        console.log(`[Backlinks Auto-Sync] ${c.name || c.id}: ${res.skipped ? "skipped" : "refreshed"} (${res.backlinksInserted} backlinks, ${res.items} timeseries)`);
      } catch (e: any) {
        console.warn(`[Backlinks Auto-Sync] Failed for ${c.name || c.id}:`, e?.message || e);
      } finally {
        backlinksAutoSyncLastClientId = c.id;
      }
    }
  } finally {
    backlinksAutoSyncInFlight = false;
  }
}

/** Auto-refresh SEO data: Vendasta clients every 48h, other clients every 40h. Runs dashboard, top pages, and backlinks refresh for due clients. */
export async function autoRefreshSeoDataForDueClients(params?: { batchSize?: number }) {
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth) return;

  const batchSize = Math.min(50, Math.max(1, Number(params?.batchSize ?? 5)));
  const clients = await prisma.client.findMany({
    where: { domain: { not: "" }, status: { notIn: ["ARCHIVED", "SUSPENDED", "REJECTED"] } },
    select: { id: true, name: true, vendasta: true },
    take: batchSize * 2,
  });

  let processed = 0;
  for (const client of clients) {
    if (processed >= batchSize) break;
    try {
      const lastUpdated = await getDataForSeoLastUpdated(client.id);
      const ttlMs = client.vendasta ? VENDASTA_AUTO_REFRESH_TTL_MS : OTHER_CLIENTS_AUTO_REFRESH_TTL_MS;
      const ageMs = lastUpdated ? Date.now() - lastUpdated.getTime() : ttlMs + 1;
      if (ageMs < ttlMs) continue;

      processed++;
      await refreshBacklinksForClientInternal({ clientId: client.id, force: true }).catch((e: any) =>
        console.warn(`[SEO Auto-Refresh] Backlinks for ${client.name || client.id}:`, e?.message || e)
      );
    } catch (e: any) {
      console.warn(`[SEO Auto-Refresh] ${client.name || client.id}:`, e?.message || e);
    }
  }

  if (processed > 0) {
    console.log(`[SEO Auto-Refresh] Processed ${processed} client(s) (Vendasta 48h, others 40h).`);
  }
}

// Get SEO reports for a client
router.get("/reports/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const ensureFresh = coerceBoolean(req.query.ensureFresh);
    const periodQuery = typeof req.query.period === "string" ? req.query.period : undefined;
    const requestedPeriod = periodQuery && ["weekly", "biweekly", "monthly"].includes(periodQuery) ? periodQuery : "monthly";

    const parseRecipientsField = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      if (value == null) return [];
      const raw = String(value).trim();
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
        }
      } catch {
        // ignore JSON parse errors
      }
      // Fallback: comma-separated
      if (raw.includes(",")) return raw.split(",").map((s) => s.trim()).filter(Boolean);
      return [raw];
    };

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check - Admins, agency members, or linked client portal users
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Optionally refresh an *existing* report when stale. Do NOT auto-create reports for new clients.
    // Use the existing report's period when regenerating so weekly/biweekly reports are not overwritten with monthly.
    if (ensureFresh) {
      const existing = await prisma.seoReport.findFirst({
        where: { clientId },
        select: { updatedAt: true, period: true },
      });

      const periodToUse = existing?.period && ["weekly", "biweekly", "monthly"].includes(String(existing.period))
        ? String(existing.period)
        : requestedPeriod;

      if (existing && !isFresh(existing.updatedAt, DATAFORSEO_REFRESH_TTL_MS)) {
        await dedupeInFlight(`report-autogen:${clientId}:${periodToUse}`, async () => {
          const { autoGenerateReport } = await import("../lib/reportScheduler.js");
          await autoGenerateReport(clientId, periodToUse);
        });
      }
    }

    // Return the single report for this client (one report per client)
    // Include client information in the response
    // Fetch all report fields from database (no mock data)
    // Use findFirst instead of findUnique(clientId) for compatibility with older Prisma clients
    const report = await prisma.seoReport.findFirst({
      where: { clientId },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            domain: true,
          }
        },
        schedule: {
          select: {
            id: true,
            frequency: true,
            isActive: true,
            recipients: true,
            emailSubject: true,
          }
        }
      }
    });

    // Return all report data from database
    if (!report) {
      return res.json(null);
    }

    // Format the response with all database fields
    const recipientsParsed = parseRecipientsField(report.recipients);
    const scheduleRecipientsParsed = parseRecipientsField(report.schedule?.recipients);
    res.json({
      id: report.id,
      reportDate: report.reportDate,
      period: report.period,
      status: report.status,
      clientId: report.clientId,
      client: report.client,
      // Traffic metrics from database
      totalSessions: report.totalSessions,
      organicSessions: report.organicSessions,
      paidSessions: report.paidSessions,
      directSessions: report.directSessions,
      referralSessions: report.referralSessions,
      // SEO metrics from database
      totalClicks: report.totalClicks,
      totalImpressions: report.totalImpressions,
      averageCtr: report.averageCtr,
      averagePosition: report.averagePosition,
      // Engagement metrics from database
      bounceRate: report.bounceRate,
      avgSessionDuration: report.avgSessionDuration,
      pagesPerSession: report.pagesPerSession,
      // Conversion metrics from database
      conversions: report.conversions,
      conversionRate: report.conversionRate,
      // GA4 metrics from database (Traffic Overview aligns with SEO Overview)
      activeUsers: report.activeUsers,
      totalUsers: (report as { totalUsers?: number | null }).totalUsers ?? null,
      organicSearchEngagedSessions: (report as { organicSearchEngagedSessions?: number | null }).organicSearchEngagedSessions ?? null,
      engagedSessions: (report as { engagedSessions?: number | null }).engagedSessions ?? null,
      eventCount: report.eventCount,
      newUsers: report.newUsers,
      keyEvents: report.keyEvents,
      // Email and sharing
      recipients: recipientsParsed,
      emailSubject: report.emailSubject,
      sentAt: report.sentAt,
      // Timestamps
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      // Schedule info
      scheduleId: report.scheduleId,
      hasActiveSchedule: report.schedule?.isActive || false,
      scheduleRecipients: scheduleRecipientsParsed,
      scheduleEmailSubject: report.schedule?.emailSubject || null,
    });
  } catch (error) {
    console.error("Fetch SEO reports error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Generate shareable link token for a client (fixed, permanent, never expires)
router.post("/share-link/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        dashboardShareToken: true,
        user: {
          select: {
            memberships: { select: { agencyId: true } },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    let hasAccess = isAdmin || clientAgencyIds.some((id) => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    let token = client.dashboardShareToken;
    if (!token) {
      token = crypto.randomBytes(32).toString("hex");
      await prisma.client.update({
        where: { id: clientId },
        data: { dashboardShareToken: token },
      });
    }

    res.json({ token });
  } catch (error) {
    console.error("Create share link error:", error);
    res.status(500).json({ message: "Failed to generate share link" });
  }
});

// Public: Shared dashboard by token (no auth)
function verifyShareToken(token: string): { clientId: string } | null {
  const secret = getJwtSecret();
  try {
    const decoded = jwt.verify(token, secret) as any;
    if (!decoded || decoded.type !== "client_share" || !decoded.clientId) {
      return null;
    }
    return { clientId: decoded.clientId as string };
  } catch (e) {
    return null;
  }
}

async function resolveShareToken(token: string): Promise<{ clientId: string } | null> {
  const byDb = await prisma.client.findUnique({
    where: { dashboardShareToken: token },
    select: { id: true },
  });
  if (byDb) return { clientId: byDb.id };
  return verifyShareToken(token);
}

router.get("/share/:token/dashboard", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { period = "30", start, end } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, domain: true, ga4RefreshToken: true, ga4PropertyId: true, ga4ConnectedAt: true }
    });
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Calculate date range
    let startDate: Date;
    let endDate: Date;
    
    if (start && end) {
      startDate = new Date(start as string);
      endDate = new Date(end as string);
      if (endDate > new Date()) {
        endDate = new Date();
      }
      if (startDate > endDate) {
        return res.status(400).json({ message: "Start date must be before end date" });
      }
    } else {
      const days = parseInt(period as string);
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      endDate = new Date();
    }

    // Check if GA4 is connected and try to fetch from GA4
    const isGA4Connected = !!(
      client.ga4RefreshToken &&
      client.ga4PropertyId &&
      client.ga4ConnectedAt
    );

    let ga4Data = null;
    let trafficDataSource = "none";

    // Try to get GA4 data from database first, then fallback to API if not found
    let ga4EventsData = null;
    if (isGA4Connected) {
      try {
        const {
          getGA4MetricsFromDB,
          fetchGA4TrafficData,
          fetchGA4EventsData,
          fetchGA4EngagementSummary,
          fetchGA4OrganicSearchEngagedSessions,
          saveGA4MetricsToDB,
        } = await import("../lib/ga4.js");
        
        // First, try to get data from database
        const dbMetrics = await getGA4MetricsFromDB(clientId, startDate, endDate);
        
        if (dbMetrics) {
          console.log(`[Share Dashboard] ✅ Using GA4 data from database for client ${clientId}`);
          ga4Data = {
            totalSessions: dbMetrics.totalSessions,
            organicSessions: dbMetrics.organicSessions,
            directSessions: dbMetrics.directSessions,
            referralSessions: dbMetrics.referralSessions,
            paidSessions: dbMetrics.paidSessions,
            bounceRate: dbMetrics.bounceRate,
            avgSessionDuration: dbMetrics.avgSessionDuration,
            pagesPerSession: dbMetrics.pagesPerSession,
            conversions: dbMetrics.conversions,
            conversionRate: dbMetrics.conversionRate,
            activeUsers: dbMetrics.activeUsers,
            totalUsers: dbMetrics.totalUsers,
            eventCount: dbMetrics.eventCount,
            newUsers: dbMetrics.newUsers,
            keyEvents: dbMetrics.keyEvents,
            newUsersTrend: dbMetrics.newUsersTrend,
            activeUsersTrend: dbMetrics.activeUsersTrend,
          };

          // Ensure engagedSessions stays accurate even when other metrics are served from DB cache.
          try {
            const engagement = await fetchGA4EngagementSummary(clientId, startDate, endDate);
            if (engagement) {
              (ga4Data as any).engagedSessions = engagement.engagedSessions;
              (ga4Data as any).engagementRate = engagement.engagementRate;
            }
          } catch (engError) {
            console.warn("[Share Dashboard] Failed to fetch GA4 engagement-only summary:", engError);
          }

          // Organic Search engaged sessions (for "Organic Traffic" card)
          try {
            const organicEngaged = await fetchGA4OrganicSearchEngagedSessions(clientId, startDate, endDate);
            if (organicEngaged !== null && organicEngaged !== undefined) {
              (ga4Data as any).organicSearchEngagedSessions = organicEngaged;
            }
          } catch (organicEngError) {
            console.warn("[Share Dashboard] Failed to fetch GA4 organic engaged sessions:", organicEngError);
          }

          ga4EventsData = dbMetrics.events ? { events: dbMetrics.events } : null;
          trafficDataSource = "ga4";
        } else {
          // No data in database, fetch from API (but don't save to DB here - that's done by refresh/connect)
          console.log(`[Share Dashboard] No GA4 data in database, fetching from API for client ${clientId}`);
          ga4Data = await fetchGA4TrafficData(clientId, startDate, endDate);
          // Fetch events data in parallel
          try {
            ga4EventsData = await fetchGA4EventsData(clientId, startDate, endDate);
          } catch (eventsError) {
            console.warn("[Share Dashboard] Failed to fetch GA4 events:", eventsError);
          }
          trafficDataSource = "ga4";
          
          // Persist the fetched GA4 snapshot so share links don't refetch (and timeout) every view.
          // This also makes the share dashboard stable if GA4 is temporarily unavailable later.
          try {
            await saveGA4MetricsToDB(
              clientId,
              startDate,
              endDate,
              ga4Data as any,
              (ga4EventsData as any) ?? undefined
            );
          } catch (saveError) {
            console.warn("[Share Dashboard] Failed to save GA4 snapshot to DB:", saveError);
          }

          console.log(`[Share Dashboard] ✅ Successfully fetched GA4 data from API for client ${clientId}`);
        }
      } catch (ga4Error: any) {
        console.error("[Share Dashboard] Failed to get GA4 data:", ga4Error.message);
        // Continue with fallback data sources
      }
    }

    const latestReport = await prisma.seoReport.findFirst({
      where: {
        clientId,
        reportDate: { gte: startDate }
      },
      orderBy: { reportDate: "desc" }
    });

    const keywordStats = await prisma.keyword.aggregate({
      where: { clientId },
      _count: { id: true },
      _avg: { currentPosition: true, ctr: true, searchVolume: true }
    });

    const backlinkStats = await prisma.backlink.aggregate({
      where: { clientId, isLost: false },
      _count: { id: true },
      _avg: { domainRating: true }
    });

    const lostBacklinks = await prisma.backlink.count({
      where: { clientId, isLost: true }
    });

    // Keep share dashboard consistent with the main dashboard:
    // "last 4 weeks" means 28 days and should match Backlinks tab filters.
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    fourWeeksAgo.setHours(0, 0, 0, 0);

    const newBacklinksLast4Weeks = await prisma.backlink.count({
      where: {
        clientId,
        isLost: false,
        OR: [{ firstSeen: { gte: fourWeeksAgo } }, { firstSeen: null, createdAt: { gte: fourWeeksAgo } }],
      },
    });

    const lostBacklinksLast4Weeks = await prisma.backlink.count({
      where: {
        clientId,
        isLost: true,
        OR: [{ lastSeen: { gte: fourWeeksAgo } }, { lastSeen: null, updatedAt: { gte: fourWeeksAgo } }],
      },
    });

    const dofollowBacklinksCount = await prisma.backlink.count({
      where: { clientId, isLost: false, isFollow: true },
    });

    // Read traffic sources from database (fallback if GA4 not available)
    const trafficSources = await prisma.trafficSource.findMany({
      where: { clientId },
    });

    const firstSource = trafficSources[0];
    const breakdown = trafficSources.map((ts) => ({
      name: ts.name,
      value: ts.value,
    })).filter((item) => item.value > 0);

    const trafficSourceSummary = firstSource ? {
      breakdown,
      totalKeywords: firstSource.totalKeywords,
      totalEstimatedTraffic: firstSource.totalEstimatedTraffic,
      organicEstimatedTraffic: firstSource.organicEstimatedTraffic,
      averageRank: firstSource.averageRank,
      rankSampleSize: firstSource.rankSampleSize,
    } : null;

    // Use GA4 data if available, otherwise fallback to other sources
    const totalSessions = ga4Data?.totalSessions ??
      (trafficSourceSummary?.totalEstimatedTraffic ??
      (latestReport ? latestReport.totalSessions : null));

    const organicSessions = ga4Data?.organicSessions ??
      (trafficSourceSummary?.organicEstimatedTraffic ??
      (latestReport ? latestReport.organicSessions : null));

    const averagePosition =
      trafficSourceSummary?.averageRank ??
      (latestReport?.averagePosition ?? keywordStats._avg.currentPosition ?? null);

    // New GA4 metrics - preserve 0 values (use null only if ga4Data is null/undefined)
    const activeUsers = ga4Data !== null && ga4Data !== undefined 
      ? (ga4Data.activeUsers !== undefined ? ga4Data.activeUsers : null)
      : null;
    const eventCount = ga4Data !== null && ga4Data !== undefined
      ? (ga4Data.eventCount !== undefined ? ga4Data.eventCount : null)
      : null;
    const newUsers = ga4Data !== null && ga4Data !== undefined
      ? (ga4Data.newUsers !== undefined ? ga4Data.newUsers : null)
      : null;
    const keyEvents = ga4Data !== null && ga4Data !== undefined
      ? (ga4Data.keyEvents !== undefined ? ga4Data.keyEvents : null)
      : null;

    const conversions = ga4Data?.conversions ?? latestReport?.conversions ?? null;

    const topKeywords = await prisma.keyword.findMany({
      where: { 
        clientId,
        currentPosition: { not: null }
      },
      orderBy: { currentPosition: "asc" },
      take: 5,
      select: {
        keyword: true,
        currentPosition: true,
        searchVolume: true,
        ctr: true
      }
    });

    res.json({
      client,
      totalSessions,
      organicSessions,
      organicSearchEngagedSessions: ga4Data?.organicSearchEngagedSessions ?? null,
      averagePosition,
      conversions,
      // GA4 metrics
      activeUsers,
      eventCount,
      newUsers,
      keyEvents,
      // Backward-compatible names used by the main dashboard UI
      totalUsers: ga4Data?.totalUsers ?? activeUsers,
      firstTimeVisitors: newUsers,
      engagedVisitors: ga4Data?.engagedSessions ?? null,
      newUsersTrend: ga4Data?.newUsersTrend || null,
      activeUsersTrend: ga4Data?.activeUsersTrend || null,
      totalUsersTrend: ga4Data?.activeUsersTrend || null,
      isGA4Connected: isGA4Connected,
      dataSources: {
        traffic: trafficDataSource === "ga4" ? "ga4" : (trafficSourceSummary ? "database" : latestReport ? "seo_report" : "fallback"),
        conversions: ga4Data ? "ga4" : (latestReport ? "seo_report" : "unknown"),
      },
      trafficSourceSummary,
      latestReport,
      keywordStats: {
        total: keywordStats._count.id,
        avgPosition: keywordStats._avg.currentPosition,
        avgCtr: keywordStats._avg.ctr,
        avgSearchVolume: keywordStats._avg.searchVolume
      },
      backlinkStats: {
        total: backlinkStats._count.id,
        lost: lostBacklinks,
        avgDomainRating: normalizeDomainRating(backlinkStats._avg.domainRating) ?? backlinkStats._avg.domainRating,
        newLast4Weeks: newBacklinksLast4Weeks,
        lostLast4Weeks: lostBacklinksLast4Weeks,
        dofollowCount: dofollowBacklinksCount,
      },
      topKeywords,
      ga4Events: ga4EventsData?.events || null
    });
  } catch (error) {
    console.error("Shared dashboard error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Share endpoints for top pages, backlinks, and traffic sources
router.get("/share/:token/top-pages", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { limit = "10" } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Read from database only
    const topPages = await prisma.topPage.findMany({
      where: { clientId },
      orderBy: { organicEtv: "desc" },
      take: Number(limit) || 10,
    });

    // Format response to match API structure
    const formatted = topPages.map((page) => ({
      url: page.url,
      organic: {
        pos1: page.organicPos1,
        pos2_3: page.organicPos2_3,
        pos4_10: page.organicPos4_10,
        count: page.organicCount,
        etv: page.organicEtv,
        isNew: page.organicIsNew,
        isUp: page.organicIsUp,
        isDown: page.organicIsDown,
        isLost: page.organicIsLost,
      },
      paid: {
        count: page.paidCount,
        etv: page.paidEtv,
      },
      raw: page.rawData,
    }));

    res.json(formatted);
  } catch (error: any) {
    console.error("Share top pages fetch error:", error);
    res.status(500).json({ message: "Failed to fetch top pages data" });
  }
});

// Share endpoint for top-pages per-page keywords (matches /top-pages/:clientId/keywords)
router.get("/share/:token/top-pages/keywords", async (req, res) => {
  try {
    const { token } = req.params;
    const { url } = req.query;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "URL parameter is required" });
    }
    const client = await prisma.client.findUnique({
      where: { id: tokenData.clientId },
      select: { id: true, domain: true },
    });
    if (!client || !client.domain) {
      return res.status(404).json({ message: "Client not found or has no domain" });
    }
    const targetDomain = client.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();
    const keywords = await fetchRankedKeywordsForPageFromDataForSEO(targetDomain, url, 2840, "English", 100);
    res.json(keywords);
  } catch (error: any) {
    console.error("Share top-pages keywords error:", error);
    res.status(500).json({ message: "Failed to fetch page keywords" });
  }
});

// Share endpoint for backlinks list
router.get("/share/:token/backlinks", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const lost = typeof req.query.lost === "string" ? req.query.lost : "false";
    const filter = typeof req.query.filter === "string" ? req.query.filter : undefined; // all|new|lost
    const sortByRaw = typeof req.query.sortBy === "string" ? req.query.sortBy : "domainRating";
    const orderRaw = typeof req.query.order === "string" ? req.query.order : "desc";
    const limitRaw = typeof req.query.limit === "string" ? req.query.limit : "50";
    const daysRaw = typeof req.query.days === "string" ? req.query.days : "30";

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const allowedSortFields = new Set(["domainRating", "firstSeen", "lastSeen", "traffic", "createdAt"]);
    const sortBy = allowedSortFields.has(sortByRaw) ? sortByRaw : "domainRating";
    const order: "asc" | "desc" = orderRaw === "asc" ? "asc" : "desc";
    const limit = Math.min(10000, Math.max(1, Number(limitRaw) || 50));
    const days = Math.min(365, Math.max(1, Number(daysRaw) || 30));

    const whereClause: any = { clientId };

    // Backwards compat: ?lost=true/false
    // New: ?filter=all|new|lost&days=N
    const normalizedFilter = (filter || "").toLowerCase();
    if (normalizedFilter === "lost" || lost === "true") {
      whereClause.isLost = true;
      const from = new Date();
      from.setDate(from.getDate() - days);
      // "Lost (last N days)" means lastSeen within range; manual lost links may have null lastSeen.
      whereClause.OR = [{ lastSeen: { gte: from } }, { lastSeen: null, updatedAt: { gte: from } }];
    } else if (normalizedFilter === "new") {
      whereClause.isLost = false;
      const from = new Date();
      from.setDate(from.getDate() - days);
      // Include DataForSEO links (firstSeen) and manual links (createdAt)
      whereClause.OR = [
        { firstSeen: { gte: from } },
        { firstSeen: null, createdAt: { gte: from } },
      ];
    } else if (normalizedFilter === "all" || lost === "all") {
      // "All" tab should show total (current/live) backlinks.
      whereClause.isLost = false;
    } else {
      // default to live links only
      whereClause.isLost = false;
    }

    const backlinks = await prisma.backlink.findMany({
      where: whereClause,
      orderBy: {
        [sortBy]: order
      },
      take: limit,
    });

    const normalized = backlinks.map((b) => ({
      ...b,
      domainRating: normalizeDomainRating(b.domainRating) ?? b.domainRating,
    }));
    res.json(normalized);
  } catch (error: any) {
    console.error("Share backlinks fetch error:", error);
    res.status(500).json({ message: "Failed to fetch backlinks data" });
  }
});

router.get("/share/:token/backlinks/timeseries", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { range = "30" } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Read from database only
    const now = new Date();
    const rangeNumber = Number(range) || 30;
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - rangeNumber + 1);
    fromDate.setHours(0, 0, 0, 0);

    const timeseries = await prisma.backlinkTimeseries.findMany({
      where: {
        clientId,
        date: {
          gte: fromDate,
          lte: now,
        },
      },
      orderBy: { date: "desc" },
    });

    // Format response to match API structure
    const formatted = timeseries.map((item) => ({
      date: item.date.toISOString(),
      newBacklinks: item.newBacklinks,
      lostBacklinks: item.lostBacklinks,
      newReferringDomains: item.newReferringDomains,
      lostReferringDomains: item.lostReferringDomains,
      newReferringMainDomains: item.newReferringMainDomains,
      lostReferringMainDomains: item.lostReferringMainDomains,
      raw: item.rawData,
    }));

    res.json(formatted);
  } catch (error: any) {
    console.error("Share backlink timeseries fetch error:", error);
    res.status(500).json({ message: "Failed to fetch backlink timeseries data" });
  }
});

router.get("/share/:token/traffic-sources", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { period = "30", start, end } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true, ga4RefreshToken: true, ga4PropertyId: true, ga4ConnectedAt: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Calculate date range (same behavior as the authenticated endpoint)
    let startDate: Date;
    let endDate: Date;
    if (start && end) {
      startDate = new Date(start as string);
      endDate = new Date(end as string);
      if (endDate > new Date()) {
        endDate = new Date();
      }
      if (startDate > endDate) {
        return res.status(400).json({ message: "Start date must be before end date" });
      }
    } else {
      const days = parseInt(period as string);
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      endDate = new Date();
    }

    // Prefer GA4-derived traffic sources so share matches the main dashboard.
    const isGA4Connected = !!(client.ga4RefreshToken && client.ga4PropertyId && client.ga4ConnectedAt);
    if (isGA4Connected) {
      try {
        const { fetchGA4TrafficData } = await import("../lib/ga4.js");
        const ga4Data = await fetchGA4TrafficData(clientId, startDate, endDate);

        const breakdown: Array<{ name: string; value: number }> = [];
        if (ga4Data.organicSessions > 0) breakdown.push({ name: "Organic", value: ga4Data.organicSessions });
        if (ga4Data.directSessions > 0) breakdown.push({ name: "Direct", value: ga4Data.directSessions });
        if (ga4Data.referralSessions > 0) breakdown.push({ name: "Referral", value: ga4Data.referralSessions });
        if (ga4Data.paidSessions > 0) breakdown.push({ name: "Paid", value: ga4Data.paidSessions });

        const knownSessions =
          ga4Data.organicSessions + ga4Data.directSessions + ga4Data.referralSessions + ga4Data.paidSessions;
        const otherSessions = ga4Data.totalSessions - knownSessions;
        if (otherSessions > 0) {
          breakdown.push({ name: "Other", value: otherSessions });
        }

        breakdown.sort((a, b) => b.value - a.value);

        return res.json({
          breakdown,
          totalKeywords: 0,
          totalEstimatedTraffic: ga4Data.totalSessions,
          organicEstimatedTraffic: ga4Data.organicSessions,
          averageRank: null,
          rankSampleSize: 0,
        });
      } catch (ga4Error) {
        console.warn("[Share Dashboard] Failed to fetch GA4 traffic sources, falling back to DB:", ga4Error);
      }
    }

    // Fallback: read from database (DataForSEO-based traffic sources)
    const trafficSources = await prisma.trafficSource.findMany({
      where: { clientId },
      orderBy: { value: "desc" },
    });

    const firstSource = trafficSources[0];
    const breakdown = trafficSources
      .map((ts) => ({ name: ts.name, value: ts.value }))
      .filter((item) => item.value > 0);

    const trafficSourceSummary = firstSource
      ? {
          breakdown,
          totalKeywords: firstSource.totalKeywords,
          totalEstimatedTraffic: firstSource.totalEstimatedTraffic,
          organicEstimatedTraffic: firstSource.organicEstimatedTraffic,
          averageRank: firstSource.averageRank,
          rankSampleSize: firstSource.rankSampleSize,
        }
      : {
          breakdown,
          totalKeywords: 0,
          totalEstimatedTraffic: 0,
          organicEstimatedTraffic: 0,
          averageRank: null,
          rankSampleSize: 0,
        };

    res.json(trafficSourceSummary);
  } catch (error: any) {
    console.error("Share traffic sources fetch error:", error);
    res.status(500).json({ message: "Failed to fetch traffic sources data" });
  }
});

// Share endpoint for top events
router.get("/share/:token/events/top", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { period = "30", start, end, limit = "10", type = "events" } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, ga4RefreshToken: true, ga4PropertyId: true, ga4ConnectedAt: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Check if GA4 is connected
    const isGA4Connected = !!(
      client.ga4RefreshToken &&
      client.ga4PropertyId &&
      client.ga4ConnectedAt
    );

    if (!isGA4Connected) {
      return res.json([]);
    }

    // Calculate date range
    let startDate: Date;
    let endDate: Date;
    
    if (start && end) {
      startDate = new Date(start as string);
      endDate = new Date(end as string);
      if (endDate > new Date()) {
        endDate = new Date();
      }
      if (startDate > endDate) {
        return res.status(400).json({ message: "Start date must be before end date" });
      }
    } else {
      const days = parseInt(period as string);
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      endDate = new Date();
    }

    // Fetch top events (events or key events) - match authenticated endpoint behavior
    const { fetchGA4TopEvents, fetchGA4TopKeyEvents } = await import("../lib/ga4TopEvents.js");
    const eventsLimit = parseInt(limit as string) || 10;
    const mode = String(type || "events").toLowerCase();
    const events =
      mode === "keyevents" || mode === "key_events" || mode === "key-events"
        ? await fetchGA4TopKeyEvents(clientId, startDate, endDate, eventsLimit)
        : await fetchGA4TopEvents(clientId, startDate, endDate, eventsLimit);

    res.json(events);
  } catch (error: any) {
    console.error("Share top events fetch error:", error);
    res.status(500).json({ message: "Failed to fetch top events data" });
  }
});

// Share endpoint for visitor sources (GA4 session sources)
router.get("/share/:token/visitor-sources", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { period = "30", start, end, limit = "10" } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, ga4RefreshToken: true, ga4PropertyId: true, ga4ConnectedAt: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const isGA4Connected = !!(client.ga4RefreshToken && client.ga4PropertyId && client.ga4ConnectedAt);
    if (!isGA4Connected) {
      return res.json([]);
    }

    // Calculate date range
    let startDate: Date;
    let endDate: Date;
    if (start && end) {
      startDate = new Date(start as string);
      endDate = new Date(end as string);
      if (endDate > new Date()) {
        endDate = new Date();
      }
      if (startDate > endDate) {
        return res.status(400).json({ message: "Start date must be before end date" });
      }
    } else {
      const days = parseInt(period as string);
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      endDate = new Date();
    }

    // Fetch from GA4 API (DB caching isn't currently available for visitor sources)
    const { fetchGA4VisitorSources } = await import("../lib/ga4VisitorSources.js");
    const sourcesLimit = parseInt(limit as string) || 10;
    const sources = await fetchGA4VisitorSources(clientId, startDate, endDate, sourcesLimit);
    res.json(sources);
  } catch (error: any) {
    console.error("Share visitor sources fetch error:", error);
    res.status(500).json({ message: "Failed to fetch visitor sources data" });
  }
});

// Share endpoint for ranked keywords summary
router.get("/share/:token/ranked-keywords", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    const currentData = await prisma.rankedKeywordsHistory.findUnique({
      where: {
        clientId_month_year: {
          clientId,
          month: currentMonth,
          year: currentYear
        }
      }
    });

    const lastMonthData = await prisma.rankedKeywordsHistory.findUnique({
      where: {
        clientId_month_year: {
          clientId,
          month: lastMonth,
          year: lastMonthYear
        }
      }
    });

    const change = currentData 
      ? (lastMonthData ? currentData.totalKeywords - lastMonthData.totalKeywords : null)
      : null;

    res.json({
      current: currentData ? {
        totalKeywords: currentData.totalKeywords,
        month: currentData.month,
        year: currentData.year,
        updatedAt: currentData.updatedAt
      } : null,
      previous: lastMonthData ? {
        totalKeywords: lastMonthData.totalKeywords,
        month: lastMonthData.month,
        year: lastMonthData.year
      } : null,
      change: change,
      changePercent: change !== null && lastMonthData && lastMonthData.totalKeywords > 0
        ? ((change / lastMonthData.totalKeywords) * 100).toFixed(1)
        : null
    });
  } catch (error: any) {
    console.error("Share ranked keywords fetch error:", error);
    res.status(500).json({ message: "Failed to fetch ranked keywords data" });
  }
});

// Share endpoint for ranked keywords history
router.get("/share/:token/ranked-keywords/history", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    let allHistory: any[] = [];
    try {
      allHistory = await prisma.rankedKeywordsHistory.findMany({
        where: { clientId },
        orderBy: [{ year: "asc" }, { month: "asc" }],
        select: {
          month: true,
          year: true,
          totalKeywords: true,
          top3: true,
          top10: true,
          page2: true,
          pos21_30: true,
          pos31_50: true,
          pos51Plus: true,
        } as any,
      });
    } catch (error: any) {
      if (error?.code === "P2022") {
        allHistory = await prisma.rankedKeywordsHistory.findMany({
          where: { clientId },
          orderBy: [{ year: "asc" }, { month: "asc" }],
          select: { month: true, year: true, totalKeywords: true },
        });
      } else {
        throw error;
      }
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    const dbMonthlyData: Record<
      string,
      {
        month: number;
        year: number;
        totalKeywords: number;
        top3: number;
        top10: number;
        page2: number;
        pos21_30: number;
        pos31_50: number;
        pos51Plus: number;
        date: string;
      }
    > = {};
    allHistory.forEach((item) => {
      const key = `${item.year}-${String(item.month).padStart(2, '0')}`;
      const total = Number(item.totalKeywords || 0);
      const top3 = Number(item.top3 || 0);
      const top10 = Number(item.top10 || 0);
      const page2 = Number(item.page2 || 0);
      const pos21_30 = Number(item.pos21_30 || 0);
      const pos31_50 = Number(item.pos31_50 || 0);
      const knownSum = top3 + top10 + page2 + pos21_30 + pos31_50;
      const pos51Plus = Number(item.pos51Plus || 0) || Math.max(0, total - knownSum);
      dbMonthlyData[key] = {
        month: item.month,
        year: item.year,
        totalKeywords: total,
        top3,
        top10,
        page2,
        pos21_30,
        pos31_50,
        pos51Plus,
        date: `${item.year}-${String(item.month).padStart(2, '0')}-01`
      };
    });

    const completeData: Array<{
      month: number;
      year: number;
      totalKeywords: number;
      top3: number;
      top10: number;
      page2: number;
      pos21_30: number;
      pos31_50: number;
      pos51Plus: number;
      date: string;
    }> = [];
    
    for (let i = 11; i >= 0; i--) {
      const targetDate = new Date(currentYear, currentMonth - 1 - i, 1);
      const targetYear = targetDate.getFullYear();
      const targetMonth = targetDate.getMonth() + 1;
      const key = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
      
      const existingData = dbMonthlyData[key];
      if (existingData) {
        completeData.push(existingData);
      } else {
        completeData.push({
          month: targetMonth,
          year: targetYear,
          totalKeywords: 0,
          top3: 0,
          top10: 0,
          page2: 0,
          pos21_30: 0,
          pos31_50: 0,
          pos51Plus: 0,
          date: `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
        });
      }
    }

    res.json(completeData);
  } catch (error: any) {
    console.error("Share ranked keywords history fetch error:", error);
    res.status(500).json({ message: "Failed to fetch ranked keywords history" });
  }
});

// Get keywords for a client
router.get("/keywords/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    if (!clientId || typeof clientId !== "string" || !clientId.trim()) {
      return res.status(400).json({ message: "Client ID is required" });
    }
    const { search, sortBy = "currentPosition", order = "asc" } = req.query;

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const whereClause: any = { clientId };
    if (search) {
      whereClause.keyword = {
        contains: search as string,
        mode: "insensitive"
      };
    }

    let keywords: any;
    try {
      keywords = await prisma.keyword.findMany({
        where: whereClause,
        orderBy: {
          [sortBy as string]: order as "asc" | "desc",
        },
      });
    } catch (error: any) {
      // Backwards-compatible fallback for DBs that haven't added keywords.locationName yet
      if (error?.code === "P2022" && String(error?.meta?.column || "").includes("locationName")) {
        keywords = await prisma.keyword.findMany({
          where: whereClause,
          orderBy: {
            [sortBy as string]: order as "asc" | "desc",
          },
          select: {
            id: true,
            createdAt: true,
            updatedAt: true,
            keyword: true,
            searchVolume: true,
            difficulty: true,
            cpc: true,
            competition: true,
            currentPosition: true,
            previousPosition: true,
            bestPosition: true,
            googleUrl: true,
            serpFeatures: true,
            totalResults: true,
            clicks: true,
            impressions: true,
            ctr: true,
            clientId: true,
          },
        });
      } else {
        throw error;
      }
    }

    // Never expose Google SERP URLs; difficulty is passed through as returned by DataForSEO
    const sanitized = Array.isArray(keywords)
      ? keywords.map((kw: any) => ({
          ...kw,
          googleUrl: onlyRankingWebsiteUrl(kw.googleUrl) ?? null,
        }))
      : keywords;
    res.json(sanitized);
  } catch (error) {
    console.error("Fetch keywords error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Create keywords for a client
router.post("/keywords/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const keywordData = z.object({
      keyword: z.string().min(1),
      searchVolume: z.number().int().min(0).default(0),
      difficulty: z.number().min(0).max(100).optional(),
      cpc: z.number().min(0).optional(),
      competition: z.string().optional(),
      currentPosition: z.number().int().positive().optional(),
      previousPosition: z.number().int().positive().optional(),
      bestPosition: z.number().int().positive().optional(),
      googleUrl: z.string().url().optional().nullable(),
      serpFeatures: z.array(z.string()).optional().nullable(),
      totalResults: z.number().int().min(0).optional().nullable(),
      fetchFromDataForSEO: z.boolean().optional().default(false),
      locationCode: z.number().int().optional(),
      languageCode: z.string().optional().default("en"),
      // UI-selected location name (do not require a code from client)
      locationName: z.string().min(1).optional(),
      location_name: z.string().min(1).optional(),
      include_clickstream_data: z.boolean().optional(),
      include_serp_info: z.boolean().optional(),
      type: z.enum(["money", "topical"]).optional().default("money"),
    }).parse(req.body);

    const resolvedLocationNameRaw = keywordData.locationName || (keywordData as any).location_name;
    const resolvedLocationName = normalizeLocationName(resolvedLocationNameRaw || "United States");
    const resolvedLocationCode =
      keywordData.locationCode ?? (await resolveLocationCodeFromName(resolvedLocationName)) ?? 2840;

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Check if keyword already exists for this client
    const existing = await prisma.keyword.findUnique({
      where: {
        clientId_keyword: {
          clientId,
          keyword: keywordData.keyword
        }
      }
    });

    if (existing) {
      return res.status(400).json({ message: "Keyword already exists for this client" });
    }

    // Fetch data from DataForSEO if requested
    let serpData: any = null;
    let serpRankData: any = null;
    if (keywordData.fetchFromDataForSEO) {
      // 1) Keyword overview (volume/cpc/difficulty). Do not block ranking if this fails.
      try {
        const fetchOverview = async (locationCode: number, locationName: string) => {
          return await fetchKeywordOverviewFromDataForSEO({
            keywords: [keywordData.keyword],
            languageCode: keywordData.languageCode,
            locationCode,
            locationName,
            includeClickstreamData: (keywordData as any).include_clickstream_data,
            includeSerpInfo: (keywordData as any).include_serp_info,
          });
        };

        let lastOverviewItem: any = null;
        const applyOverviewItem = (item: any) => {
          lastOverviewItem = item;
          const searchVolume = Number(item?.keyword_info?.search_volume);
          if (Number.isFinite(searchVolume) && searchVolume >= 0) {
            keywordData.searchVolume = Math.round(searchVolume);
          }

          const difficulty = getKeywordDifficultyFromOverviewItem(item);
          if (difficulty !== null) {
            keywordData.difficulty = difficulty;
          }

          const cpc = Number(item?.keyword_info?.cpc);
          if (Number.isFinite(cpc) && cpc >= 0) {
            keywordData.cpc = cpc;
          }

          const competitionLevel = item?.keyword_info?.competition_level;
          if (typeof competitionLevel === "string" && competitionLevel.length > 0) {
            keywordData.competition = competitionLevel;
          }

          const checkUrl = onlyRankingWebsiteUrl(item?.serp_info?.check_url);
          if (checkUrl) {
            keywordData.googleUrl = checkUrl;
          }

          const serpItemTypes = item?.serp_info?.serp_item_types;
          if (Array.isArray(serpItemTypes) && serpItemTypes.length > 0) {
            keywordData.serpFeatures = serpItemTypes;
          }
        };

        // First pass: use the requested location.
        const overview = await fetchOverview(resolvedLocationCode, resolvedLocationName || "United States");
        serpData = overview.raw;
        applyOverviewItem(overview.item);

        // Some very broad keywords (or some sub-locations) can return sparse/zero metrics.
        // Fallback: if we got basically no useful metrics, retry overview at US level to fill in volume/CPC/difficulty.
        const hasUsefulOverviewMetrics =
          (typeof keywordData.searchVolume === "number" && keywordData.searchVolume > 0) ||
          (typeof keywordData.difficulty === "number" && Number.isFinite(keywordData.difficulty)) ||
          (typeof keywordData.cpc === "number" && Number.isFinite(keywordData.cpc) && keywordData.cpc > 0) ||
          (typeof keywordData.competition === "string" && keywordData.competition.length > 0);

        if (!hasUsefulOverviewMetrics && resolvedLocationCode !== 2840) {
          try {
            const fallback = await fetchOverview(2840, "United States");
            // Prefer keeping the first location's raw payload for debugging, but fill in missing metrics.
            applyOverviewItem(fallback.item);
          } catch (fallbackErr: any) {
            console.warn(
              "Keyword Overview fallback (US) failed:",
              fallbackErr?.message || fallbackErr
            );
          }
        }

        // Prisma `Int` maps to 32-bit signed; DataForSEO can exceed it.
        const clampDbInt = (value: unknown) => {
          const MAX_INT = 2147483647;
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) return null;
          return Math.min(MAX_INT, Math.max(0, Math.round(numeric)));
        };

        const seResultsCount = clampDbInt(lastOverviewItem?.serp_info?.se_results_count);
        if (seResultsCount !== null) {
          keywordData.totalResults = seResultsCount;
        }
      } catch (error: any) {
        console.warn("Keyword Overview fetch failed (will still fetch ranking):", error?.message || error);
      }

      // 2) SERP ranking for this client domain (position/url). This should run even if overview fails.
      if (client.domain) {
        try {
          serpRankData = await fetchKeywordDataFromDataForSEO(
            keywordData.keyword,
            client.domain,
            resolvedLocationCode,
            keywordData.languageCode || "en"
          );

          const rankingUrl = onlyRankingWebsiteUrl(serpRankData?.googleUrl);
          if (rankingUrl) {
            keywordData.googleUrl = rankingUrl;
          }
          if (Array.isArray(serpRankData?.serpFeatures) && serpRankData.serpFeatures.length > 0) {
            keywordData.serpFeatures = serpRankData.serpFeatures;
          }
          if (typeof serpRankData?.currentPosition === "number" && serpRankData.currentPosition > 0) {
            keywordData.currentPosition = serpRankData.currentPosition;
            keywordData.bestPosition = serpRankData.currentPosition;
          }
          if (typeof serpRankData?.totalResults === "number") {
            keywordData.totalResults = serpRankData.totalResults;
          }
        } catch (rankErr) {
          console.warn("Failed to fetch SERP ranking for tracked keyword:", rankErr);
        }
      }
    }

    const createData: any = {
      keyword: keywordData.keyword,
      searchVolume: keywordData.searchVolume,
      difficulty: keywordData.difficulty,
      cpc: keywordData.cpc,
      competition: keywordData.competition,
      currentPosition: keywordData.currentPosition,
      previousPosition: keywordData.previousPosition,
      bestPosition: keywordData.bestPosition,
      googleUrl: onlyRankingWebsiteUrl(keywordData.googleUrl) ?? undefined,
      serpFeatures: Array.isArray(keywordData.serpFeatures) ? JSON.stringify(keywordData.serpFeatures) : undefined,
      totalResults: keywordData.totalResults,
      ...(resolvedLocationName ? { locationName: resolvedLocationName } : {}),
      type: keywordData.type || "money",
      clientId,
    };

    let keyword: any;
    try {
      keyword = await prisma.keyword.create({ data: createData });
    } catch (error: any) {
      // Backwards-compatible fallback for DBs that haven't added keywords.locationName yet
      if (error?.code === "P2022" && String(error?.meta?.column || "").includes("locationName")) {
        delete createData.locationName;
        keyword = await prisma.keyword.create({ data: createData });
      } else {
        throw error;
      }
    }

    // Ensure tracked keyword is also available in Target Keywords panel (upsert)
    try {
      const item = serpData?.tasks?.[0]?.result?.[0]?.items?.[0];
      const competitionValue = Number(item?.keyword_info?.competition);
      const monthlySearches = item?.keyword_info?.monthly_searches;

      // Preserve previous position when updating.
      const existingTarget = await prisma.targetKeyword.findUnique({
        where: {
          clientId_keyword: {
            clientId,
            keyword: keywordData.keyword,
          },
        },
      });

      const nextGooglePosition =
        typeof keywordData.currentPosition === "number" && keywordData.currentPosition > 0
          ? keywordData.currentPosition
          : null;
      const prevGooglePosition = existingTarget?.googlePosition ?? null;
      const previousPositionForUpdate =
        prevGooglePosition !== null && nextGooglePosition !== null && prevGooglePosition !== nextGooglePosition
          ? prevGooglePosition
          : existingTarget?.previousPosition ?? null;

      const targetUpsertData: any = {
        keyword: keywordData.keyword,
        searchVolume: keywordData.searchVolume ?? undefined,
        cpc: keywordData.cpc ?? undefined,
        competition: keywordData.competition ?? undefined,
        competitionValue: Number.isFinite(competitionValue) ? competitionValue : undefined,
        monthlySearches: Array.isArray(monthlySearches) ? JSON.stringify(monthlySearches) : undefined,
        keywordInfo: item?.keyword_info ? JSON.stringify(item.keyword_info) : undefined,
        serpInfo: item?.serp_info ? JSON.stringify(item.serp_info) : undefined,
        serpItemTypes: Array.isArray(item?.serp_info?.serp_item_types)
          ? JSON.stringify(item.serp_info.serp_item_types)
          : undefined,
        googleUrl: onlyRankingWebsiteUrl(keywordData.googleUrl || item?.serp_info?.check_url) ?? undefined,
        googlePosition: nextGooglePosition,
        previousPosition: previousPositionForUpdate,
        seResultsCount:
          item?.serp_info?.se_results_count !== undefined && item?.serp_info?.se_results_count !== null
            ? String(item.serp_info.se_results_count)
            : undefined,
        languageCode: keywordData.languageCode,
        locationCode: resolvedLocationCode,
        locationName: resolvedLocationName || "United States",
        type: keywordData.type || "money",
      };

      if (serpRankData?.serpData) {
        targetUpsertData.serpInfo = JSON.stringify(serpRankData.serpData);
      }
      if (Array.isArray(serpRankData?.serpFeatures)) {
        targetUpsertData.serpItemTypes = JSON.stringify(serpRankData.serpFeatures);
      }

      await prisma.targetKeyword.upsert({
        where: {
          clientId_keyword: {
            clientId,
            keyword: keywordData.keyword,
          },
        },
        update: targetUpsertData,
        create: {
          ...targetUpsertData,
          clientId,
        },
      });
    } catch (targetErr) {
      console.warn("Failed to upsert target keyword for tracked keyword:", targetErr);
    }

    res.json({ keyword, serpData });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: error.errors });
    }
    if (error.code === "P2002") {
      return res.status(400).json({ message: "Keyword already exists for this client" });
    }
    console.error("Create keyword error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

const BULK_KEYWORDS_LIMIT = 500;

function parseBulkKeywords(input: string): string[] {
  const raw = input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(raw)];
}

// Bulk-create keywords for a client (comma/newline-separated). No DataForSEO fetch by default.
router.post("/keywords/:clientId/bulk", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const body = z
      .object({
        keywords: z.array(z.string().min(1)).optional(),
        keyword: z.string().optional(),
        locationCode: z.number().int().optional(),
        languageCode: z.string().optional().default("en"),
        locationName: z.string().min(1).optional(),
        location_name: z.string().min(1).optional(),
        type: z.enum(["money", "topical"]).optional().default("money"),
      })
      .parse(req.body);

    const locationNameRaw = body.locationName ?? body.location_name;
    const resolvedLocationName = normalizeLocationName(locationNameRaw || "United States");
    const resolvedLocationCode =
      body.locationCode ?? (await resolveLocationCodeFromName(resolvedLocationName)) ?? 2840;

    let keywords: string[];
    if (Array.isArray(body.keywords) && body.keywords.length > 0) {
      keywords = [...new Set(body.keywords.map((k) => k.trim()).filter((k) => k.length > 0))];
    } else if (typeof body.keyword === "string" && body.keyword.trim()) {
      keywords = parseBulkKeywords(body.keyword);
    } else {
      return res.status(400).json({ message: "Provide 'keywords' (array) or 'keyword' (comma/newline-separated)." });
    }

    if (keywords.length === 0) {
      return res.status(400).json({ message: "No valid keywords to add. Use comma or new line to separate keywords." });
    }
    if (keywords.length > BULK_KEYWORDS_LIMIT) {
      return res
        .status(400)
        .json({ message: `Maximum ${BULK_KEYWORDS_LIMIT} keywords per bulk add. You sent ${keywords.length}.` });
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true },
            },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some((id) => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    let created = 0;
    let skipped = 0;
    const failed: { keyword: string; error: string }[] = [];

    for (const kw of keywords) {
      const existing = await prisma.keyword.findUnique({
        where: {
          clientId_keyword: { clientId, keyword: kw },
        },
      });
      if (existing) {
        skipped++;
        continue;
      }

      try {
        const createData: any = {
          keyword: kw,
          searchVolume: 0,
          clientId,
          type: body.type || "money",
          ...(resolvedLocationName ? { locationName: resolvedLocationName } : {}),
        };
        await prisma.keyword.create({ data: createData });

        try {
          await prisma.targetKeyword.upsert({
            where: {
              clientId_keyword: { clientId, keyword: kw },
            },
            update: {
              locationCode: resolvedLocationCode,
              locationName: resolvedLocationName,
              languageCode: body.languageCode,
              type: body.type || "money",
            },
            create: {
              keyword: kw,
              clientId,
              locationCode: resolvedLocationCode,
              locationName: resolvedLocationName,
              languageCode: body.languageCode,
              type: body.type || "money",
            },
          });
        } catch (tkErr: any) {
          console.warn("Bulk add: target keyword upsert failed for", kw, tkErr?.message);
        }

        created++;
      } catch (err: any) {
        failed.push({ keyword: kw, error: err?.message || "Unknown error" });
      }
    }

    res.json({ created, skipped, failed, total: keywords.length });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input", errors: error.errors });
    }
    console.error("Bulk keywords error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh keyword data from DataForSEO (SUPER_ADMIN only)
router.post("/keywords/:clientId/:keywordId/refresh", authenticateToken, async (req, res) => {
  try {
    // Only SUPER_ADMIN can refresh data
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only Super Admin can refresh data." });
    }

    const { clientId, keywordId } = req.params;
    const refreshParams = z.object({
      locationCode: z.number().int().optional(),
      languageCode: z.string().optional().default("en"),
      locationName: z.string().optional(),
      location_name: z.string().optional(),
      include_clickstream_data: z.boolean().optional(),
      include_serp_info: z.boolean().optional(),
    }).parse(req.body ?? {});

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Get the keyword
    const keyword = await prisma.keyword.findFirst({
      where: {
        id: keywordId,
        clientId
      }
    });

    if (!keyword) {
      return res.status(404).json({ message: "Keyword not found" });
    }

    const requestedLocationNameRaw =
      refreshParams.locationName ||
      (refreshParams as any).location_name ||
      (keyword as any).locationName ||
      "United States";
    const resolvedLocationName = normalizeLocationName(requestedLocationNameRaw || "United States");
    const resolvedLocationCode =
      refreshParams.locationCode ?? (await resolveLocationCodeFromName(resolvedLocationName)) ?? 2840;
    const languageCode = refreshParams.languageCode || "en";

    const updateData: any = {};

    // 1) Refresh overview metrics (volume/cpc/difficulty/competition + serp features/url).
    // This can be slow, so we keep it separate from SERP rank fetching.
    let overviewRaw: any = null;
    try {
      const fetchOverview = async (locationCode: number, locationName: string) => {
        return await fetchKeywordOverviewFromDataForSEO({
          keywords: [keyword.keyword],
          languageCode,
          locationCode,
          locationName,
          includeClickstreamData: (refreshParams as any).include_clickstream_data,
          includeSerpInfo: (refreshParams as any).include_serp_info,
        });
      };

      let lastOverviewItem: any = null;
      const applyOverviewItem = (item: any) => {
        lastOverviewItem = item;

        const searchVolume = Number(item?.keyword_info?.search_volume);
        if (Number.isFinite(searchVolume) && searchVolume > 0) {
          updateData.searchVolume = Math.round(searchVolume);
        }

        const difficulty = getKeywordDifficultyFromOverviewItem(item);
        if (difficulty !== null) {
          updateData.difficulty = difficulty;
        }

        const cpc = Number(item?.keyword_info?.cpc);
        if (Number.isFinite(cpc) && cpc > 0) {
          updateData.cpc = cpc;
        }

        const competitionLevel = item?.keyword_info?.competition_level;
        if (typeof competitionLevel === "string" && competitionLevel.length > 0) {
          updateData.competition = competitionLevel;
        }

        const checkUrl = onlyRankingWebsiteUrl(item?.serp_info?.check_url);
        if (checkUrl) {
          updateData.googleUrl = checkUrl;
        }

        const serpItemTypes = item?.serp_info?.serp_item_types;
        if (Array.isArray(serpItemTypes) && serpItemTypes.length > 0) {
          updateData.serpFeatures = JSON.stringify(serpItemTypes);
        }

        // Prisma `Int` maps to 32-bit signed; DataForSEO can exceed it.
        const clampDbInt = (value: unknown) => {
          const MAX_INT = 2147483647;
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) return null;
          return Math.min(MAX_INT, Math.max(0, Math.round(numeric)));
        };
        const seResultsCount = clampDbInt(item?.serp_info?.se_results_count);
        if (seResultsCount !== null && seResultsCount > 0) {
          updateData.totalResults = seResultsCount;
        }
      };

      const overview = await fetchOverview(resolvedLocationCode, resolvedLocationName);
      overviewRaw = overview.raw;
      applyOverviewItem(overview.item);

      const hasUsefulOverviewMetrics =
        (typeof updateData.searchVolume === "number" && updateData.searchVolume > 0) ||
        (typeof updateData.difficulty === "number" && Number.isFinite(updateData.difficulty)) ||
        (typeof updateData.cpc === "number" && Number.isFinite(updateData.cpc) && updateData.cpc > 0) ||
        (typeof updateData.competition === "string" && updateData.competition.length > 0);

      if (!hasUsefulOverviewMetrics && resolvedLocationCode !== 2840) {
        try {
          const fallback = await fetchOverview(2840, "United States");
          applyOverviewItem(fallback.item);
        } catch (fallbackErr) {
          console.warn("Keyword refresh overview fallback (US) failed:", fallbackErr);
        }
      }
    } catch (overviewErr) {
      console.warn("Keyword refresh overview fetch failed (will still fetch ranking):", overviewErr);
    }

    // 2) Refresh SERP ranking (position/url + features + total results) for this client domain.
    const dataForSEOData = await fetchKeywordDataFromDataForSEO(
      keyword.keyword,
      client.domain,
      resolvedLocationCode,
      languageCode
    );

    // Update previous position before updating current position
    if (keyword.currentPosition !== null) {
      updateData.previousPosition = keyword.currentPosition;
    }

    // Update with new position data
    if (typeof dataForSEOData.currentPosition === "number" && dataForSEOData.currentPosition > 0) {
      updateData.currentPosition = dataForSEOData.currentPosition;
    }

    if (typeof dataForSEOData.bestPosition === "number" && dataForSEOData.bestPosition > 0) {
      // Only update bestPosition if it's better (lower number) than current
      if (keyword.bestPosition === null || dataForSEOData.bestPosition < keyword.bestPosition) {
        updateData.bestPosition = dataForSEOData.bestPosition;
      }
    }

    // Update Google URL only if it's the ranking website URL (not a Google SERP page)
    const rankingUrl = onlyRankingWebsiteUrl(dataForSEOData.googleUrl);
    if (rankingUrl) {
      updateData.googleUrl = rankingUrl;
    }

    // Update SERP features
    if (dataForSEOData.serpFeatures && dataForSEOData.serpFeatures.length > 0) {
      // DB column is LongText (String); store as JSON string.
      updateData.serpFeatures = JSON.stringify(dataForSEOData.serpFeatures);
    }

    // Update total results
    if (dataForSEOData.totalResults !== null && dataForSEOData.totalResults > 0) {
      updateData.totalResults = dataForSEOData.totalResults;
    }

    // Keep the keyword's chosen location for future refreshes.
    updateData.locationName = resolvedLocationName;

    // Update the keyword (backwards-compatible with DBs missing keywords.locationName)
    let updatedKeyword: any;
    try {
      updatedKeyword = await prisma.keyword.update({
        where: { id: keywordId },
        data: updateData,
      });
    } catch (error: any) {
      if (error?.code === "P2022" && String(error?.meta?.column || "").includes("locationName")) {
        delete updateData.locationName;
        updatedKeyword = await prisma.keyword.update({
          where: { id: keywordId },
          data: updateData,
        });
      } else {
        throw error;
      }
    }

    const positionChanged =
      typeof updateData.currentPosition === "number"
        ? updateData.currentPosition !== keyword.currentPosition
        : false;

    res.json({
      keyword: updatedKeyword,
      serpData: dataForSEOData.serpData,
      overviewRaw,
      location: { locationCode: resolvedLocationCode, locationName: resolvedLocationName, languageCode },
      positionChanged,
    });
  } catch (error: any) {
    console.error("Refresh keyword error:", error);
    if (error.message?.includes("DataForSEO credentials")) {
      return res.status(500).json({ message: error.message });
    }
    res.status(500).json({ message: "Internal server error" });
  }
});

// Delete a keyword
router.delete("/keywords/:clientId/:keywordId", authenticateToken, async (req, res) => {
  try {
    const { clientId, keywordId } = req.params;

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Check if keyword exists and belongs to this client
    const keyword = await prisma.keyword.findFirst({
      where: {
        id: keywordId,
        clientId
      }
    });

    if (!keyword) {
      return res.status(404).json({ message: "Keyword not found" });
    }

    // Delete the keyword
    await prisma.keyword.delete({
      where: { id: keywordId }
    });

    res.json({ message: "Keyword deleted successfully" });
  } catch (error: any) {
    console.error("Delete keyword error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh dashboard data from DataForSEO (SUPER_ADMIN only)
router.post("/dashboard/:clientId/refresh", authenticateToken, async (req, res) => {
  try {
    // Only SUPER_ADMIN can refresh data
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only Super Admin can refresh data." });
    }

    const { clientId } = req.params;
    const force = coerceBoolean(req.query.force);

    // 48h throttle to prevent repeated billable DataForSEO pulls.
    const [trafficUpdatedAt, rankedUpdatedAt] = await Promise.all([
      getLatestTrafficSourceUpdatedAt(clientId),
      getLatestRankedKeywordsHistoryUpdatedAt(clientId),
    ]);
    const lastRefreshedAt =
      trafficUpdatedAt && rankedUpdatedAt
        ? new Date(Math.max(trafficUpdatedAt.getTime(), rankedUpdatedAt.getTime()))
        : (trafficUpdatedAt ?? rankedUpdatedAt);
    const nextAllowedAt = lastRefreshedAt ? new Date(lastRefreshedAt.getTime() + DATAFORSEO_REFRESH_TTL_MS) : null;

    if (!force && isFresh(lastRefreshedAt, DATAFORSEO_REFRESH_TTL_MS)) {
      return res.json({
        message: "Using cached dashboard data (refresh limited to every 48 hours).",
        skipped: true,
        lastRefreshedAt,
        nextAllowedAt,
        ga4Refreshed: false,
      });
    }

    const result = await dedupeInFlight(`dashboard-refresh:${clientId}`, async () => {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
      });

      if (!client || !client.domain) {
        return { notFound: true as const };
      }

      const normalizeDomain = (domain: string) => {
        return domain
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .replace(/\/$/, "")
          .toLowerCase();
      };

      const targetDomain = normalizeDomain(client.domain);

      // Refresh traffic sources and save to database
      let trafficSourceSummary: {
        breakdown: Array<{ name: string; value: number }>;
        totalKeywords: number;
        totalEstimatedTraffic: number;
        organicEstimatedTraffic: number;
        averageRank: number | null;
        rankSampleSize: number;
      } | null = null;
      try {
        trafficSourceSummary = await fetchTrafficSourcesFromRankedKeywords(targetDomain, 100, 2840, "English");

        // Delete existing traffic sources for this client
        await prisma.trafficSource.deleteMany({
          where: { clientId },
        });

        // Save new traffic sources to database
        const tss = trafficSourceSummary;
        if (tss) {
          await Promise.all(
            tss.breakdown.map((item) =>
              prisma.trafficSource.create({
                data: {
                  clientId,
                  name: item.name,
                  value: item.value,
                  totalKeywords: tss.totalKeywords,
                  totalEstimatedTraffic: tss.totalEstimatedTraffic,
                  organicEstimatedTraffic: tss.organicEstimatedTraffic,
                  averageRank: tss.averageRank,
                  rankSampleSize: tss.rankSampleSize,
                },
              })
            )
          );
        }
      } catch (error) {
        console.error("Failed to refresh traffic sources:", error);
      }

      // Refresh ranked keywords count and position breakdown for current month
      let rankedKeywordsCount = 0;
      try {
        const rankedData = await fetchRankedKeywordsFromDataForSEO(targetDomain, 2840, "en");
        rankedKeywordsCount = rankedData.totalKeywords || 0;

        const now = new Date();
        const currentMonth = now.getMonth() + 1; // 1-12
        const currentYear = now.getFullYear();
        const firstDay = `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`;
        const lastDay = new Date(currentYear, now.getMonth() + 1, 0).toISOString().split("T")[0];

        let totalKeywords = rankedKeywordsCount;
        let top3 = 0;
        let top10 = 0;
        let page2 = 0;
        let pos21_30 = 0;
        let pos31_50 = 0;
        let pos51Plus = rankedKeywordsCount; // default: all in 51+ when no breakdown

        try {
          const historicalForMonth = await fetchHistoricalRankOverviewFromDataForSEO(
            targetDomain,
            2840,
            "en",
            firstDay,
            lastDay
          );
          const currentMonthItem = historicalForMonth.find(
            (item: any) => item.month === currentMonth && item.year === currentYear
          ) || historicalForMonth[0];
          if (currentMonthItem && (currentMonthItem.totalKeywords > 0 || currentMonthItem.top3 || currentMonthItem.top10 || currentMonthItem.page2 || currentMonthItem.pos21_30 || currentMonthItem.pos31_50 || currentMonthItem.pos51Plus)) {
            totalKeywords = Number(currentMonthItem.totalKeywords ?? 0) || rankedKeywordsCount;
            top3 = Number(currentMonthItem.top3 ?? 0);
            top10 = Number(currentMonthItem.top10 ?? 0);
            page2 = Number(currentMonthItem.page2 ?? 0);
            pos21_30 = Number(currentMonthItem.pos21_30 ?? 0);
            pos31_50 = Number(currentMonthItem.pos31_50 ?? 0);
            const knownSum = top3 + top10 + page2 + pos21_30 + pos31_50;
            pos51Plus = Number(currentMonthItem.pos51Plus ?? 0) || Math.max(0, totalKeywords - knownSum);
          }
        } catch (histErr) {
          console.warn("Historical rank overview for current month failed, using total only:", histErr);
        }

        await prisma.rankedKeywordsHistory.upsert({
          where: {
            clientId_month_year: {
              clientId,
              month: currentMonth,
              year: currentYear,
            },
          },
          update: {
            totalKeywords,
            top3,
            top10,
            page2,
            pos21_30,
            pos31_50,
            pos51Plus,
          } as any,
          create: {
            clientId,
            totalKeywords,
            month: currentMonth,
            year: currentYear,
            top3,
            top10,
            page2,
            pos21_30,
            pos31_50,
            pos51Plus,
          } as any,
        });
      } catch (error) {
        console.error("Failed to refresh ranked keywords:", error);
      }

      // Refresh GA4 access token if connected (data will be fetched fresh when dashboard loads)
      let ga4Refreshed = false;
      const clientWithGA4 = await prisma.client.findUnique({
        where: { id: clientId },
        select: {
          ga4RefreshToken: true,
          ga4PropertyId: true,
          ga4ConnectedAt: true,
          ga4AccessToken: true,
        },
      });

      if (clientWithGA4?.ga4RefreshToken && clientWithGA4?.ga4PropertyId && clientWithGA4?.ga4ConnectedAt) {
        try {
          // Force refresh GA4 access token to ensure it's valid for fresh data fetch
          const { refreshAccessToken, fetchGA4TrafficData, fetchGA4EventsData, saveGA4MetricsToDB } = await import("../lib/ga4.js");
          const freshToken = await refreshAccessToken(clientWithGA4.ga4RefreshToken);

          // Update access token
          await prisma.client.update({
            where: { id: clientId },
            data: { ga4AccessToken: freshToken },
          });

          // Fetch fresh GA4 data and save to database
          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 30); // Last 30 days

          try {
            const { fetchGA4VisitorSources } = await import("../lib/ga4VisitorSources.js");
            const [trafficData, eventsData, visitorSourcesData] = await Promise.all([
              fetchGA4TrafficData(clientId, startDate, endDate),
              fetchGA4EventsData(clientId, startDate, endDate).catch(err => {
                console.warn(`[Refresh] Failed to fetch GA4 events for client ${clientId}:`, err.message);
                return null;
              }),
              fetchGA4VisitorSources(clientId, startDate, endDate, 10).catch(err => {
                console.warn(`[Refresh] Failed to fetch GA4 visitor sources for client ${clientId}:`, err.message);
                return null;
              })
            ]);

            // Save to database
            await saveGA4MetricsToDB(
              clientId,
              startDate,
              endDate,
              trafficData,
              eventsData || undefined,
              visitorSourcesData ? { sources: visitorSourcesData } : undefined
            );

            ga4Refreshed = true;
            console.log(`[Refresh] GA4 data refreshed and saved to database for client ${clientId}`);
          } catch (ga4DataError: any) {
            console.error(`[Refresh] Failed to fetch/save GA4 data for client ${clientId}:`, ga4DataError.message);
            // Token refresh succeeded, so mark as refreshed even if data fetch failed
            ga4Refreshed = true;
          }
        } catch (ga4Error: any) {
          console.error("Failed to refresh GA4 access token:", ga4Error.message);
          // Don't fail the entire refresh if GA4 token refresh fails
        }
      }

      return { trafficSourceSummary, rankedKeywordsCount, ga4Refreshed, notFound: false as const };
    });

    if (result.notFound) {
      return res.status(404).json({ message: "Client not found or has no domain" });
    }

    return res.json({
      message: "Dashboard data refreshed successfully",
      skipped: false,
      trafficSourceSummary: result.trafficSourceSummary,
      rankedKeywordsCount: result.rankedKeywordsCount,
      ga4Refreshed: result.ga4Refreshed,
      lastRefreshedAt: new Date(),
      nextAllowedAt: new Date(Date.now() + DATAFORSEO_REFRESH_TTL_MS),
    });
  } catch (error: any) {
    console.error("Refresh dashboard error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh top pages from DataForSEO (SUPER_ADMIN only)
router.post("/top-pages/:clientId/refresh", authenticateToken, async (req, res) => {
  try {
    // Only SUPER_ADMIN can refresh data
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only Super Admin can refresh data." });
    }

    const { clientId } = req.params;
    const force = coerceBoolean(req.query.force);
    const lastRefreshedAt = await getLatestTopPagesUpdatedAt(clientId);
    const nextAllowedAt = lastRefreshedAt ? new Date(lastRefreshedAt.getTime() + DATAFORSEO_REFRESH_TTL_MS) : null;
    if (!force && isFresh(lastRefreshedAt, DATAFORSEO_REFRESH_TTL_MS)) {
      return res.json({
        message: "Using cached top pages data (refresh limited to every 48 hours).",
        skipped: true,
        lastRefreshedAt,
        nextAllowedAt,
      });
    }

    const result = await dedupeInFlight(`top-pages-refresh:${clientId}`, async () => {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
      });

      if (!client || !client.domain) {
        return { notFound: true as const };
      }

      const normalizeDomain = (domain: string) => {
        return domain
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .replace(/\/$/, "")
          .toLowerCase();
      };

      const targetDomain = normalizeDomain(client.domain);
      const pages = await fetchRelevantPagesFromDataForSEO(targetDomain, 20, 2840, "English");

      // Delete existing top pages for this client
      await prisma.topPage.deleteMany({
        where: { clientId },
      });

      // Save new pages to database using upsert to handle any race conditions
      const savedPages = await Promise.all(
        pages.map((page) =>
          prisma.topPage.upsert({
            where: {
              clientId_url: {
                clientId,
                url: page.url,
              },
            },
            update: {
              organicPos1: page.organic.pos1,
              organicPos2_3: page.organic.pos2_3,
              organicPos4_10: page.organic.pos4_10,
              organicCount: page.organic.count,
              organicEtv: page.organic.etv,
              organicIsNew: page.organic.isNew,
              organicIsUp: page.organic.isUp,
              organicIsDown: page.organic.isDown,
              organicIsLost: page.organic.isLost,
              paidCount: page.paid.count,
              paidEtv: page.paid.etv,
              rawData:
                page.raw == null
                  ? null
                  : typeof page.raw === "string"
                    ? page.raw
                    : JSON.stringify(page.raw),
            },
            create: {
              clientId,
              url: page.url,
              organicPos1: page.organic.pos1,
              organicPos2_3: page.organic.pos2_3,
              organicPos4_10: page.organic.pos4_10,
              organicCount: page.organic.count,
              organicEtv: page.organic.etv,
              organicIsNew: page.organic.isNew,
              organicIsUp: page.organic.isUp,
              organicIsDown: page.organic.isDown,
              organicIsLost: page.organic.isLost,
              paidCount: page.paid.count,
              paidEtv: page.paid.etv,
              rawData:
                page.raw == null
                  ? null
                  : typeof page.raw === "string"
                    ? page.raw
                    : JSON.stringify(page.raw),
            },
          })
        )
      );

      return { pages: savedPages.length, notFound: false as const };
    });

    if (result.notFound) {
      return res.status(404).json({ message: "Client not found or has no domain" });
    }

    return res.json({
      message: "Top pages refreshed successfully",
      skipped: false,
      pages: result.pages,
      lastRefreshedAt: new Date(),
      nextAllowedAt: new Date(Date.now() + DATAFORSEO_REFRESH_TTL_MS),
    });
  } catch (error: any) {
    console.error("Refresh top pages error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh backlinks from DataForSEO (SUPER_ADMIN only)
router.post("/backlinks/:clientId/refresh", authenticateToken, async (req, res) => {
  try {
    // Only SUPER_ADMIN can refresh data
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only Super Admin can refresh data." });
    }

    const { clientId } = req.params;
    const force = coerceBoolean(req.query.force);
    const out = await refreshBacklinksForClientInternal({ clientId, force });
    if (out.message === "Client not found or has no domain") {
      return res.status(404).json({ message: out.message });
    }
    return res.json(out);
  } catch (error: any) {
    console.error("Refresh backlinks error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh agency dashboard data from DataForSEO (SUPER_ADMIN only)
router.post("/agency/dashboard/refresh", authenticateToken, async (req, res) => {
  const refreshTierCtx = await getAgencyTierContext(req.user.userId, req.user.role);
  if (refreshTierCtx.trialExpired) {
    return res.status(403).json({ message: "Trial ended. Contact support to add a paid plan to continue." });
  }
  try {
    // Only SUPER_ADMIN can refresh data
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only Super Admin can refresh data." });
    }

    const force = coerceBoolean(req.query.force);

    const refreshedClients = await dedupeInFlight("agency-dashboard-refresh", async () => {
      // Get all clients
      const allClients = await prisma.client.findMany({
        where: {
          domain: { not: "" },
        },
        select: { id: true, domain: true },
        take: 10, // Limit to avoid too many API calls
      });

      const normalizeDomain = (domain: string) => {
        return domain
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .replace(/\/$/, "")
          .toLowerCase();
      };

      const results: Array<{
        clientId: string;
        domain: string | null;
        status: "success" | "error" | "skipped";
        lastRefreshedAt?: Date | null;
        nextAllowedAt?: Date | null;
      }> = [];

      // Refresh data for each client (throttled per client to avoid repeated billable pulls)
      for (const client of allClients) {
        if (!client.domain) continue;

        const lastRefreshedAt = await getLatestTrafficSourceUpdatedAt(client.id);
        const nextAllowedAt = lastRefreshedAt ? new Date(lastRefreshedAt.getTime() + DATAFORSEO_REFRESH_TTL_MS) : null;

        if (!force && isFresh(lastRefreshedAt, DATAFORSEO_REFRESH_TTL_MS)) {
          results.push({
            clientId: client.id,
            domain: client.domain,
            status: "skipped",
            lastRefreshedAt,
            nextAllowedAt,
          });
          continue;
        }

        try {
          await dedupeInFlight(`agency-dashboard-refresh:${client.id}`, async () => {
            const targetDomain = normalizeDomain(client.domain!);

            // Refresh traffic sources and save to DB
            const trafficSourceSummary = await fetchTrafficSourcesFromRankedKeywords(targetDomain, 50, 2840, "English");

            // Delete existing traffic sources for this client
            await prisma.trafficSource.deleteMany({
              where: { clientId: client.id },
            });

            // Save new traffic sources to database
            await Promise.all(
              trafficSourceSummary.breakdown.map((item) =>
                prisma.trafficSource.create({
                  data: {
                    clientId: client.id,
                    name: item.name,
                    value: item.value,
                    totalKeywords: trafficSourceSummary.totalKeywords,
                    totalEstimatedTraffic: trafficSourceSummary.totalEstimatedTraffic,
                    organicEstimatedTraffic: trafficSourceSummary.organicEstimatedTraffic,
                    averageRank: trafficSourceSummary.averageRank,
                    rankSampleSize: trafficSourceSummary.rankSampleSize,
                  },
                })
              )
            );
          });

          results.push({
            clientId: client.id,
            domain: client.domain,
            status: "success",
            lastRefreshedAt: new Date(),
            nextAllowedAt: new Date(Date.now() + DATAFORSEO_REFRESH_TTL_MS),
          });
        } catch (error) {
          console.error(`Failed to refresh data for client ${client.id}:`, error);
          results.push({
            clientId: client.id,
            domain: client.domain,
            status: "error",
          });
        }
      }

      return results;
    });

    res.json({
      message: "Agency dashboard data refreshed successfully",
      refreshedClients,
    });
  } catch (error: any) {
    console.error("Refresh agency dashboard error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get backlinks for a client
router.get("/backlinks/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const lost = typeof req.query.lost === "string" ? req.query.lost : "false";
    const filter = typeof req.query.filter === "string" ? req.query.filter : undefined; // all|new|lost|natural|manual
    const sortByRaw = typeof req.query.sortBy === "string" ? req.query.sortBy : "firstSeen";
    const orderRaw = typeof req.query.order === "string" ? req.query.order : "desc";
    const limitRaw = typeof req.query.limit === "string" ? req.query.limit : "200";
    const daysRaw = typeof req.query.days === "string" ? req.query.days : "30";

    const allowedSortFields = new Set(["domainRating", "firstSeen", "lastSeen", "traffic", "createdAt", "sourceUrl", "anchorText"]);
    const sortBy = allowedSortFields.has(sortByRaw) ? sortByRaw : "firstSeen";
    const order: "asc" | "desc" = orderRaw === "asc" ? "asc" : "desc";
    const limit = Math.min(10000, Math.max(1, Number(limitRaw) || 200));
    const days = Math.min(365, Math.max(1, Number(daysRaw) || 30));

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const whereClause: any = { clientId };

    // Backwards compat: ?lost=true/false
    // New: ?filter=all|new|lost
    const normalizedFilter = (filter || "").toLowerCase();
    if (normalizedFilter === "lost" || lost === "true") {
      whereClause.isLost = true;
      const from = new Date();
      from.setDate(from.getDate() - days);
      // "Lost (last N days)" means lastSeen within range; manual lost links may have null lastSeen.
      whereClause.OR = [{ lastSeen: { gte: from } }, { lastSeen: null, updatedAt: { gte: from } }];
    } else if (normalizedFilter === "new") {
      whereClause.isLost = false;
      const from = new Date();
      from.setDate(from.getDate() - days);
      whereClause.OR = [
        { firstSeen: { gte: from } },
        { firstSeen: null, createdAt: { gte: from } },
      ];
    } else if (normalizedFilter === "natural") {
      whereClause.isLost = false;
      whereClause.firstSeen = { not: null };
    } else if (normalizedFilter === "manual") {
      whereClause.isLost = false;
      whereClause.firstSeen = null;
    } else if (normalizedFilter === "all" || lost === "all") {
      whereClause.isLost = false;
    } else {
      whereClause.isLost = false;
    }

    const orderBy =
      sortBy === "firstSeen"
        ? [{ firstSeen: { sort: order, nulls: "last" as const } }, { createdAt: order }]
        : { [sortBy]: order };

    const backlinks = await prisma.backlink.findMany({
      where: whereClause,
      orderBy: orderBy as any,
      take: limit,
    });

    const normalized = backlinks.map((b) => ({
      ...b,
      domainRating: normalizeDomainRating(b.domainRating) ?? b.domainRating,
    }));
    res.json(normalized);
  } catch (error) {
    console.error("Fetch backlinks error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

function normalizeUrlInput(value: string): string {
  const raw = (value || "").trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  // Default to https
  return `https://${raw}`;
}

// Add a manual backlink (non-DataForSEO; preserved during refresh)
router.post("/backlinks/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Client portal users can manage backlinks for their client.

    const body = z
      .object({
        sourceUrl: z.string().min(1),
        targetUrl: z.string().optional(),
        anchorText: z.string().optional().nullable(),
        domainRating: z.number().optional().nullable(),
        urlRating: z.number().optional().nullable(),
        traffic: z.number().int().optional().nullable(),
        isFollow: z.boolean().optional(),
        isLost: z.boolean().optional(),
      })
      .parse(req.body);

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true },
            },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some((id) => userAgencyIds.includes(id));
    if (!hasAccess && client.belongsToAgencyId && userAgencyIds.includes(client.belongsToAgencyId)) {
      hasAccess = true;
    }
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }
    if (!hasAccess && req.user.role === "SPECIALIST") {
      const task = await prisma.task.findFirst({
        where: { clientId, assigneeId: req.user.userId },
        select: { id: true },
      });
      hasAccess = Boolean(task);
    }
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (req.user.role === "SPECIALIST") {
      const specialist = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { specialties: true },
      });
      let specialties: string[] = [];
      if (specialist?.specialties) {
        try {
          const parsed = JSON.parse(specialist.specialties);
          specialties = Array.isArray(parsed) ? parsed : [];
        } catch {
          specialties = [];
        }
      }
      if (!specialties.includes("LINK_BUILDING")) {
        return res.status(403).json({ message: "Only specialists with Link Building specialty can add backlinks" });
      }
    }

    const sourceUrl = normalizeUrlInput(body.sourceUrl);
    const targetUrl = normalizeUrlInput(body.targetUrl || client.domain || "");
    if (!sourceUrl || !targetUrl) {
      return res.status(400).json({ message: "sourceUrl and targetUrl are required" });
    }

    const created = await prisma.backlink.create({
      data: {
        clientId,
        sourceUrl,
        targetUrl,
        anchorText: body.anchorText ?? null,
        domainRating: body.domainRating ?? null,
        urlRating: body.urlRating ?? null,
        traffic: body.traffic ?? null,
        isFollow: body.isFollow ?? true,
        isLost: body.isLost ?? false,
        // Mark manual so refresh preserves it
        firstSeen: null,
        lastSeen: null,
      },
    });

    return res.json(created);
  } catch (error: any) {
    console.error("Create manual backlink error:", error);
    return res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

// Import manual backlinks (paste/CSV parsed on client)
router.post("/backlinks/:clientId/import", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Client portal users can manage backlinks for their client.

    const body = z
      .object({
        rows: z
          .array(
            z.object({
              sourceUrl: z.string().min(1),
              targetUrl: z.string().optional(),
              anchorText: z.string().optional().nullable(),
              domainRating: z.number().optional().nullable(),
              urlRating: z.number().optional().nullable(),
              traffic: z.number().int().optional().nullable(),
              isFollow: z.boolean().optional(),
              isLost: z.boolean().optional(),
            })
          )
          .min(1)
          .max(500),
      })
      .parse(req.body);

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true },
            },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some((id) => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const defaultTargetUrl = normalizeUrlInput(client.domain || "");

    const data = body.rows
      .map((r) => ({
        clientId,
        sourceUrl: normalizeUrlInput(r.sourceUrl),
        targetUrl: normalizeUrlInput(r.targetUrl || defaultTargetUrl),
        anchorText: r.anchorText ?? null,
        domainRating: r.domainRating ?? null,
        urlRating: r.urlRating ?? null,
        traffic: r.traffic ?? null,
        isFollow: r.isFollow ?? true,
        isLost: r.isLost ?? false,
        firstSeen: null,
        lastSeen: null,
      }))
      .filter((r) => Boolean(r.sourceUrl) && Boolean(r.targetUrl));

    if (data.length === 0) {
      return res.status(400).json({ message: "No valid rows to import" });
    }

    const result = await prisma.backlink.createMany({ data });
    return res.json({ imported: result.count });
  } catch (error: any) {
    console.error("Import manual backlinks error:", error);
    return res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

// Delete a backlink row
router.delete("/backlinks/:clientId/:backlinkId", authenticateToken, async (req, res) => {
  try {
    const { clientId, backlinkId } = req.params;

    // Client portal users can manage backlinks for their client.

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true },
            },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some((id) => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const backlink = await prisma.backlink.findUnique({ where: { id: backlinkId } });
    if (!backlink || backlink.clientId !== clientId) {
      return res.status(404).json({ message: "Backlink not found" });
    }

    await prisma.backlink.delete({ where: { id: backlinkId } });
    return res.json({ success: true });
  } catch (error: any) {
    console.error("Delete backlink error:", error);
    return res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

// AI Search Visibility (best-effort real data)
// - ChatGPT/Gemini: GA4 referral sessions + unique landing pages (proxy for cited pages)
// - AI Overview / AI Mode: counts based on cached SERP item types in target keywords (DataForSEO)
router.get("/ai-search-visibility/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { period = "30", start, end } = req.query;
    const force = coerceBoolean(req.query.force);

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true },
            },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some((id) => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Tier-based AI refresh throttle (when force=true)
    if (force && req.user.role !== "SUPER_ADMIN") {
      const agency = await prisma.agency.findFirst({
        where: { id: { in: userAgencyIds } },
        select: { subscriptionTier: true },
      });
      const tierConfig = getTierConfig(agency?.subscriptionTier ?? null);
      if (tierConfig) {
        const intervalMs = getAiRefreshIntervalMs(tierConfig);
        const lastAi = (client as any).lastAiRefreshAt as Date | null | undefined;
        if (intervalMs > 0 && lastAi) {
          const elapsed = Date.now() - new Date(lastAi).getTime();
          if (elapsed < intervalMs) {
            const nextAt = new Date(new Date(lastAi).getTime() + intervalMs);
            return res.status(429).json({
              message: `Your plan allows AI updates ${tierConfig.aiUpdateFrequency}. Next refresh at ${nextAt.toISOString()}.`,
              code: "REFRESH_THROTTLE",
              nextRefreshAt: nextAt.toISOString(),
            });
          }
        }
      }
    }

    // Handle custom date range or period
    let startDate: Date;
    let endDate: Date;
    if (start && end) {
      startDate = new Date(start as string);
      endDate = new Date(end as string);
      if (isNaN(startDate.getTime())) return res.status(400).json({ message: "Invalid start date" });
      if (isNaN(endDate.getTime())) return res.status(400).json({ message: "Invalid end date" });
      if (endDate > new Date()) endDate = new Date();
      if (startDate > endDate) return res.status(400).json({ message: "Start date must be before end date" });
    } else {
      const days = parseInt(period as string);
      startDate = new Date();
      startDate.setDate(startDate.getDate() - (Number.isFinite(days) ? days : 30));
      endDate = new Date();
    }

    const isGA4Connected = !!(client.ga4RefreshToken && client.ga4PropertyId && client.ga4ConnectedAt);

    let chatgpt = { sessions: 0, users: 0, citedPages: 0, visibility: 0 };
    let gemini = { sessions: 0, users: 0, citedPages: 0, visibility: 0 };
    let distributionByCountry: Array<{ countryCode: string; visibility: number; mentions: number }> = [];

    if (isGA4Connected) {
      try {
        const { fetchGA4AiSearchVisibility } = await import("../lib/ga4AiSearchVisibility.js");
        const ga4 = await fetchGA4AiSearchVisibility(clientId, startDate, endDate);
        const total = ga4.totalSessions || 0;
        const chat = ga4.providers.chatgpt;
        const gem = ga4.providers.gemini;
        chatgpt = {
          sessions: chat.sessions,
          users: chat.users,
          citedPages: chat.citedPages,
          visibility: total > 0 ? Math.round((chat.sessions / total) * 100) : 0,
        };
        gemini = {
          sessions: gem.sessions,
          users: gem.users,
          citedPages: gem.citedPages,
          visibility: total > 0 ? Math.round((gem.sessions / total) * 100) : 0,
        };
        distributionByCountry = Array.isArray((ga4 as any).countries) ? (ga4 as any).countries : [];
      } catch (e) {
        console.warn("[AI Search Visibility] GA4 fetch failed:", e);
      }
    }

    // AI Overview / AI Mode from cached SERP item types (best effort for mentions/visibility)
    const tks = await prisma.targetKeyword.findMany({
      where: { clientId },
      select: { serpItemTypes: true },
    });
    const parsedTypes = tks
      .map((tk) => {
        const raw = tk.serpItemTypes;
        if (!raw) return [];
        try {
          const arr = JSON.parse(raw);
          return Array.isArray(arr) ? (arr as any[]).map(String) : [];
        } catch {
          return [];
        }
      })
      .filter((arr) => Array.isArray(arr));

    const totalKeywordsWithSerpTypes = parsedTypes.length;
    const aiOverviewMentions = parsedTypes.filter((arr) => arr.some((t) => String(t).toLowerCase().includes("ai_overview"))).length;
    const aiModeMentions = parsedTypes.filter((arr) => arr.some((t) => String(t).toLowerCase().includes("ai_mode") || String(t).toLowerCase().includes("ai mode"))).length;
    const otherSerpFeaturesTypes = ["featured_snippet", "knowledge_panel", "local_pack", "people_also_ask", "top_stories", "video", "image_pack", "jobs", "events", "shopping", "answer_box", "sitelinks"];
    const otherSerpFeaturesCount = parsedTypes.filter((arr) =>
      arr.some((t) => {
        const lower = String(t).toLowerCase();
        if (lower.includes("organic") || lower.includes("ai_overview") || lower.includes("ai_mode") || lower.includes("ai mode")) return false;
        return otherSerpFeaturesTypes.some((ft) => lower.includes(ft));
      })
    ).length;

    const aiOverviewVisibility =
      totalKeywordsWithSerpTypes > 0 ? Math.round((aiOverviewMentions / totalKeywordsWithSerpTypes) * 100) : 0;
    const aiModeVisibility =
      totalKeywordsWithSerpTypes > 0 ? Math.round((aiModeMentions / totalKeywordsWithSerpTypes) * 100) : 0;

    // Cited pages for AI Overview / AI Mode via DataForSEO SERP live calls (billable) but cached/throttled (48h)
    const normalizeHost = (value: string) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      try {
        const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
        return url.hostname.replace(/^www\./, "").toLowerCase();
      } catch {
        return raw
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .split("/")[0]
          .toLowerCase();
      }
    };

    const clientHost = normalizeHost(client.domain || "");
    let cacheTableAvailable = true;
    let cache: any = null;
    try {
      cache = await prisma.aiSearchSerpCache.findUnique({ where: { clientId } });
    } catch (e) {
      // If the table doesn't exist yet (migration not applied), skip caching instead of failing the request.
      cacheTableAvailable = false;
      console.warn("[AI Search Visibility] ai_search_serp_cache not available (migration pending).");
      cache = null;
    }
    const cacheFresh = isFresh(cache?.updatedAt ?? null, DATAFORSEO_REFRESH_TTL_MS);

    const extractUrlsFromObject = (node: any, urls: Set<string>, depth: number) => {
      if (depth > 6) return;
      if (node == null) return;
      if (typeof node === "string") {
        if (node.startsWith("http://") || node.startsWith("https://")) urls.add(node);
        return;
      }
      if (Array.isArray(node)) {
        for (const it of node) extractUrlsFromObject(it, urls, depth + 1);
        return;
      }
      if (typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          const key = String(k).toLowerCase();
          if ((key === "url" || key === "link" || key === "source_url" || key === "page_url") && typeof v === "string") {
            if (v.startsWith("http://") || v.startsWith("https://")) urls.add(v);
          }
          extractUrlsFromObject(v, urls, depth + 1);
        }
      }
    };

    const filterClientUrls = (urls: Iterable<string>) => {
      const out = new Set<string>();
      for (const u of urls) {
        try {
          const host = normalizeHost(u);
          if (!clientHost || !host) continue;
          if (host === clientHost || host.endsWith(`.${clientHost}`) || clientHost.endsWith(`.${host}`)) {
            out.add(u);
          }
        } catch {
          // ignore
        }
      }
      return out;
    };

    const domainMentions = new Map<string, number>();
    const addToDomainMentions = (urls: Iterable<string>) => {
      for (const u of urls) {
        try {
          const host = normalizeHost(u);
          if (!host) continue;
          if (clientHost && (host === clientHost || host.endsWith(`.${clientHost}`) || clientHost.endsWith(`.${host}`))) continue;
          domainMentions.set(host, (domainMentions.get(host) ?? 0) + 1);
        } catch {
          // ignore
        }
      }
    };

    const refreshSerpCache = async () => {
      if (!client.domain || !clientHost) return null;
      // Limit to a small sample to control billable calls
      const sample = await prisma.targetKeyword.findMany({
        where: { clientId },
        orderBy: [{ searchVolume: "desc" }, { updatedAt: "desc" }],
        take: 8,
        select: {
          keyword: true,
          locationCode: true,
          languageCode: true,
        },
      });

      const aiOverviewUrls = new Set<string>();
      const aiModeUrls = new Set<string>();
      let checked = 0;

      const base64Auth = process.env.DATAFORSEO_BASE64;
      if (!base64Auth) {
        throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
      }

      const fetchSerpLiveAdvanced = async (opts: {
        keyword: string;
        locationCode: number;
        languageCode: string;
        mode: "organic" | "ai_mode";
      }) => {
        const endpoint =
          opts.mode === "ai_mode"
            ? "https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced"
            : "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

        const requestBody: any[] = [
          {
            keyword: opts.keyword,
            language_code: opts.languageCode,
            location_code: opts.locationCode,
            // keep costs down
            calculate_rectangles: false,
          },
        ];

        // AI Mode endpoint supports loading async AI overview blocks; helps surface citations
        if (opts.mode === "ai_mode") {
          requestBody[0].load_async_ai_overview = true;
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Basic ${base64Auth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const result = data?.tasks?.[0]?.result?.[0] ?? null;
        return result;
      };

      for (const tk of sample) {
        const kw = String(tk.keyword || "").trim();
        if (!kw) continue;
        checked += 1;

        // AI Overview citations from standard (organic) SERP
        const organicResult = await fetchSerpLiveAdvanced({
          keyword: kw,
          locationCode: tk.locationCode || 2840,
          languageCode: tk.languageCode || "en",
          mode: "organic",
        });
        const organicItems: any[] = Array.isArray(organicResult?.items) ? organicResult.items : [];
        for (const item of organicItems) {
          const t = String(item?.type || "").toLowerCase();
          if (!t) continue;
          if (t.includes("ai_overview")) {
            const urls = new Set<string>();
            extractUrlsFromObject(item, urls, 0);
            for (const u of filterClientUrls(urls)) aiOverviewUrls.add(u);
            addToDomainMentions(urls);
          }
        }

        // AI Mode citations from the AI Mode SERP endpoint
        const aiModeResult = await fetchSerpLiveAdvanced({
          keyword: kw,
          locationCode: tk.locationCode || 2840,
          languageCode: tk.languageCode || "en",
          mode: "ai_mode",
        });
        const aiModeItems: any[] = Array.isArray(aiModeResult?.items) ? aiModeResult.items : [];
        for (const item of aiModeItems) {
          const t = String(item?.type || "").toLowerCase();
          if (!t) continue;
          // In AI Mode endpoint, the AI content is usually represented as ai_overview (+ sub-items)
          if (t.includes("ai_overview")) {
            const urls = new Set<string>();
            extractUrlsFromObject(item, urls, 0);
            for (const u of filterClientUrls(urls)) aiModeUrls.add(u);
            addToDomainMentions(urls);
          }
        }
      }

      const topCitedSourcesByDomain = Array.from(domainMentions.entries())
        .map(([domain, mentions]) => ({ domain, mentions }))
        .sort((a, b) => b.mentions - a.mentions)
        .slice(0, 20);

      if (!cacheTableAvailable) {
        // Table missing — return computed values without persisting (avoid Prisma errors/noise)
        return {
          fetchedAt: new Date(),
          updatedAt: new Date(),
          checkedKeywords: checked,
          aiOverviewCitedPages: aiOverviewUrls.size,
          aiModeCitedPages: aiModeUrls.size,
          topCitedSourcesByDomain: JSON.stringify(topCitedSourcesByDomain),
        } as any;
      }

      try {
        const upserted = await prisma.aiSearchSerpCache.upsert({
          where: { clientId },
          update: {
            fetchedAt: new Date(),
            checkedKeywords: checked,
            aiOverviewCitedPages: aiOverviewUrls.size,
            aiModeCitedPages: aiModeUrls.size,
            aiOverviewCitedUrls: JSON.stringify(Array.from(aiOverviewUrls)),
            aiModeCitedUrls: JSON.stringify(Array.from(aiModeUrls)),
            topCitedSourcesByDomain: JSON.stringify(topCitedSourcesByDomain),
          },
          create: {
            clientId,
            fetchedAt: new Date(),
            checkedKeywords: checked,
            aiOverviewCitedPages: aiOverviewUrls.size,
            aiModeCitedPages: aiModeUrls.size,
            aiOverviewCitedUrls: JSON.stringify(Array.from(aiOverviewUrls)),
            aiModeCitedUrls: JSON.stringify(Array.from(aiModeUrls)),
            topCitedSourcesByDomain: JSON.stringify(topCitedSourcesByDomain),
          },
        });
        await prisma.client.update({
          where: { id: clientId },
          data: { lastAiRefreshAt: new Date() },
        });
        return upserted;
      } catch (e) {
        // If the table is missing, Prisma logs can be noisy; keep this warning minimal.
        console.warn("[AI Search Visibility] Failed to persist ai_search_serp_cache.");
        return {
          fetchedAt: new Date(),
          updatedAt: new Date(),
          checkedKeywords: checked,
          aiOverviewCitedPages: aiOverviewUrls.size,
          aiModeCitedPages: aiModeUrls.size,
        } as any;
      }
    };

    let serpCache = cache;
    let serpRefreshQueued = false;

    // Important:
    // DataForSEO SERP calls can be slow/billable. Do NOT run them during normal dashboard load.
    // Only run when explicitly forced (or you can wire a "Refresh" button on the UI).
    if (force) {
      serpCache = await dedupeInFlight(`ai-search-serp-cache:${clientId}`, async () => {
        if (!cacheTableAvailable) {
          return await refreshSerpCache();
        }
        let latest: any = null;
        try {
          latest = await prisma.aiSearchSerpCache.findUnique({ where: { clientId } });
        } catch {
          latest = null;
        }
        const fresh = isFresh(latest?.updatedAt ?? null, DATAFORSEO_REFRESH_TTL_MS);
        if (fresh) return latest;
        return await refreshSerpCache();
      });
    } else if (!cacheFresh && req.user.role === "SUPER_ADMIN") {
      // Queue a background refresh (deduped) so the next load gets fresh data,
      // but keep this request fast (prevents frontend timeouts).
      serpRefreshQueued = true;
      void dedupeInFlight(`ai-search-serp-cache:${clientId}`, async () => {
        try {
          if (!cacheTableAvailable) return await refreshSerpCache();
          const latest = await prisma.aiSearchSerpCache.findUnique({ where: { clientId } });
          const fresh = isFresh(latest?.updatedAt ?? null, DATAFORSEO_REFRESH_TTL_MS);
          if (fresh) return latest;
          return await refreshSerpCache();
        } catch (e) {
          console.warn("[AI Search Visibility] Background refresh failed:", e);
          return null;
        }
      });
    }

    const aiOverviewCitedPages = serpCache?.aiOverviewCitedPages ?? 0;
    const aiModeCitedPages = serpCache?.aiModeCitedPages ?? 0;
    let topCitedSources: Array<{ domain: string; mentions: number }> = [];
    try {
      const raw = (serpCache as any)?.topCitedSourcesByDomain;
      if (typeof raw === "string") topCitedSources = JSON.parse(raw);
      else if (Array.isArray(raw)) topCitedSources = raw;
    } catch {
      topCitedSources = [];
    }

    return res.json({
      rows: [
        { name: "ChatGPT", visibility: chatgpt.visibility, mentions: chatgpt.sessions, citedPages: chatgpt.citedPages },
        { name: "AI Overview", visibility: aiOverviewVisibility, mentions: aiOverviewMentions, citedPages: aiOverviewCitedPages },
        { name: "AI Mode", visibility: aiModeVisibility, mentions: aiModeMentions, citedPages: aiModeCitedPages },
        { name: "Gemini", visibility: gemini.visibility, mentions: gemini.sessions, citedPages: gemini.citedPages },
      ],
      topCitedSources,
      distributionByCountry,
      otherSerpFeaturesCount,
      meta: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        ga4Connected: isGA4Connected,
        totalKeywordsWithSerpTypes,
        serpCitedPages: {
          aiOverview: aiOverviewCitedPages,
          aiMode: aiModeCitedPages,
        },
        serpRefreshQueued,
        serpCache: serpCache
          ? {
              fetchedAt: serpCache.fetchedAt,
              checkedKeywords: serpCache.checkedKeywords,
              nextAllowedAt: new Date(new Date(serpCache.updatedAt).getTime() + DATAFORSEO_REFRESH_TTL_MS),
            }
          : null,
      },
    });
  } catch (error: any) {
    console.error("AI Search visibility error:", error);
    return res.status(500).json({ message: "Failed to fetch AI Search Visibility" });
  }
});

// DataForSEO AI Optimization API helpers
async function fetchAiAggregatedMetrics(
  target: string,
  targetType: "domain" | "url",
  locationCode: number,
  languageCode: string,
  _dateFrom?: string,
  _dateTo?: string
): Promise<any> {
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  // DataForSEO expects "target" array: each element is { domain: "..." } or { keyword: "..." }
  const targetPayload = targetType === "domain" ? { domain: target } : { keyword: target };
  const requestBody = [{
    target: [targetPayload],
    location_code: locationCode,
    language_code: languageCode,
    platform: "google",
    // date_from/date_to not in API spec; API returns current aggregated data
  }];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/ai_optimization/llm_mentions/aggregated_metrics/live", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${base64Auth}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const result = data?.tasks?.[0]?.result?.[0] || null;
    if (result) {
      console.log("[AI Intelligence] Aggregated metrics result:", {
        hasTotal: !!result?.total,
        platformKeys: result?.total?.platform?.map((p: any) => p?.key) || [],
      });
    }
    return result;
  } catch (error: any) {
    console.error("DataForSEO Aggregated Metrics API error:", error);
    throw error;
  }
}

export async function fetchAiSearchMentions(
  target: string,
  targetType: "domain" | "url",
  locationCode: number,
  languageCode: string,
  limit: number = 100
): Promise<any[]> {
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  // DataForSEO API expects target array with domain or keyword objects
  const targetArray: any[] = [];
  if (targetType === "domain") {
    targetArray.push({ domain: target });
  } else {
    targetArray.push({ keyword: target });
  }

  // DataForSEO: target = array of { domain } or { keyword }; platform = "google" | "chat_gpt"
  const requestBody = [{
    target: targetArray,
    location_code: locationCode,
    language_code: languageCode,
    platform: "google",
    order_by: ["ai_search_volume,desc"],
    limit,
  }];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/ai_optimization/llm_mentions/search/live", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${base64Auth}`,
      },
      body: JSON.stringify(requestBody),
    });

    const rawBody = await response.text();
    let data: any;
    try {
      data = JSON.parse(rawBody);
    } catch {
      data = {};
    }

    if (!response.ok) {
      const taskMsg = data?.tasks?.[0]?.status_message;
      console.warn(
        "[AI Intelligence] Search mentions API returned",
        response.status,
        "-",
        taskMsg || "unknown",
        "target:",
        target
      );
      return [];
    }

    const task = data?.tasks?.[0];
    const taskStatusCode = task?.status_code;
    const result0 = task?.result?.[0];
    if (data?.tasks_error === 1 || taskStatusCode === 50000) {
      const taskMsg = task?.status_message || "Internal Error";
      console.warn(
        "[AI Intelligence] Search mentions task error:",
        taskMsg,
        "target:",
        target,
        "status_code:",
        taskStatusCode
      );
      return [];
    }

    console.log("[AI Intelligence] Search mentions API response:", {
      statusCode: data?.status_code,
      statusMessage: data?.status_message,
      tasksCount: data?.tasks_count,
      hasTasks: !!data?.tasks?.[0],
      hasResult: !!result0,
      itemsCount: result0?.items_count,
    });

    const items = Array.isArray(result0?.items) ? result0.items : [];
    if (items.length === 0 && data?.status_code === 20000) {
      console.log("[AI Intelligence] API returned success but no items - domain may not have AI mentions yet", {
        target,
        targetType,
        locationCode,
        languageCode,
        limit,
      });
    }
    return items;
  } catch (error: any) {
    console.error("DataForSEO Search Mentions API error:", error);
    throw error;
  }
}

// Fetch competitor AI metrics using aggregated_metrics with multiple targets
async function fetchCompetitorAiMetrics(
  competitorDomains: string[],
  locationCode: number,
  languageCode: string,
  dateFrom: string,
  dateTo: string
): Promise<Map<string, any>> {
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth || competitorDomains.length === 0) {
    return new Map();
  }

  // DataForSEO: target = array of { domain } objects (one task, multiple targets = multiple results)
  const requestBody = [{
    target: competitorDomains.map(domain => ({ domain })),
    location_code: locationCode,
    language_code: languageCode,
    platform: "google",
  }];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/ai_optimization/llm_mentions/aggregated_metrics/live", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${base64Auth}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const results = data?.tasks?.[0]?.result || [];
    const competitorMap = new Map<string, any>();
    // One result per target in same order as request
    for (let i = 0; i < results.length; i++) {
      const domain = competitorDomains[i];
      if (!domain) continue;
      const result = results[i];
      const total = result?.total;
      const platformArr = Array.isArray(total?.platform) ? total.platform : [];
      const totalMentions = platformArr.reduce((s: number, p: any) => s + Number(p?.mentions || 0), 0);
      const aiSearchVolume = platformArr.reduce((s: number, p: any) => s + Number(p?.ai_search_volume || 0), 0);
      const platformDiversity = platformArr.filter((p: any) => Number(p?.mentions || 0) > 0).length;
      const score = Math.min(99, (totalMentions * 2) + (aiSearchVolume / 100) + (platformDiversity * 10));
      competitorMap.set(domain.toLowerCase(), {
        domain,
        totalMentions,
        aiSearchVolume,
        score: Math.round(score),
      });
    }
    return competitorMap;
  } catch (error: any) {
    console.error("DataForSEO Competitor Metrics API error:", error);
    return new Map();
  }
}

// DataForSEO LLM Mentions Top Pages: aggregated metrics by top mentioned pages for a keyword/niche.
async function fetchAiTopPages(
  keywordSeed: string,
  locationCode: number,
  languageCode: string,
  limit: number = 100
): Promise<{ pageUrl: string; mentions: number; aiSearchVolume: number }[]> {
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth) return [];

  const requestBody = [{
    target: [{ keyword: keywordSeed, keyword_search_filter: "like" }],
    location_code: locationCode,
    language_code: languageCode,
    limit,
  }];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/ai_optimization/llm_mentions/top_pages/live", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${base64Auth}`,
      },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    const result = data?.tasks?.[0]?.result?.[0];
    const items = result?.items || [];
    return items.map((item: any) => ({
      pageUrl: item?.page_url || item?.url || "",
      mentions: Number(item?.total_mentions ?? 0) || (sumGroupMentions(item?.platform_based_grouping)),
      aiSearchVolume: Number(item?.ai_search_volume ?? 0) || (sumGroupAiVolume(item?.platform_based_grouping)),
    })).filter((p: { pageUrl: string }) => p.pageUrl);
  } catch (error: any) {
    console.warn("[AI Intelligence] Top Pages API error:", error?.message);
    return [];
  }
}

function sumGroupMentions(grouping: any[] | undefined): number {
  if (!Array.isArray(grouping)) return 0;
  return grouping.reduce((s, g) => s + Number(g?.total_mentions || 0), 0);
}
function sumGroupAiVolume(grouping: any[] | undefined): number {
  if (!Array.isArray(grouping)) return 0;
  return grouping.reduce((s, g) => s + Number(g?.ai_search_volume || 0), 0);
}

// DataForSEO LLM Mentions Top Domains: aggregated metrics by top domains for a keyword/niche (per-platform breakdown).
async function fetchAiTopDomains(
  keywordSeed: string,
  locationCode: number,
  languageCode: string,
  limit: number = 50
): Promise<{ domain: string; mentions: number; aiSearchVolume: number; platformBasedGrouping?: any[] }[]> {
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth) return [];

  const requestBody = [{
    target: [{ keyword: keywordSeed, keyword_search_filter: "like" }],
    location_code: locationCode,
    language_code: languageCode,
    limit,
  }];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/ai_optimization/llm_mentions/top_domains/live", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${base64Auth}`,
      },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    const result = data?.tasks?.[0]?.result?.[0];
    const items = result?.items || [];
    return items.map((item: any) => ({
      domain: (item?.domain || "").toLowerCase().replace(/^www\./, ""),
      mentions: Number(item?.total_mentions ?? 0) || sumGroupMentions(item?.platform_based_grouping),
      aiSearchVolume: Number(item?.ai_search_volume ?? 0) || sumGroupAiVolume(item?.platform_based_grouping),
      platformBasedGrouping: item?.platform_based_grouping,
    })).filter((d: { domain: string }) => d.domain);
  } catch (error: any) {
    console.warn("[AI Intelligence] Top Domains API error:", error?.message);
    return [];
  }
}

// DataForSEO AI Keyword Data: search volume + 12-month trend per keyword.
export async function fetchAiKeywordSearchVolume(
  keywords: string[],
  locationCode: number,
  languageCode: string
): Promise<{ keyword: string; aiSearchVolume: number; aiMonthlySearches: { year: number; month: number; aiSearchVolume: number }[] }[]> {
  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth || keywords.length === 0) return [];

  const requestBody = [{
    keywords: keywords.slice(0, 200),
    location_code: locationCode,
    language_code: languageCode,
  }];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${base64Auth}`,
      },
      body: JSON.stringify(requestBody),
    });
    const rawBody = await response.text();
    let data: any;
    try {
      data = JSON.parse(rawBody);
    } catch {
      data = {};
    }
    if (!response.ok) {
      const taskMsg = data?.tasks?.[0]?.status_message;
      console.warn(
        "[AI Intelligence] AI Keyword Search Volume API returned",
        response.status,
        "-",
        taskMsg || "unknown"
      );
      return [];
    }
    const task = data?.tasks?.[0];
    if (data?.tasks_error === 1 || task?.status_code === 50000) {
      console.warn(
        "[AI Intelligence] AI Keyword Search Volume task error:",
        task?.status_message || "Internal Error",
        "status_code:",
        task?.status_code
      );
      return [];
    }
    const result0 = Array.isArray(task?.result) ? task.result[0] : task?.result;
    const items = Array.isArray(result0?.items) ? result0.items : [];
    return items.map((item: any) => ({
      keyword: item?.keyword || "",
      aiSearchVolume: Number(item?.ai_search_volume || 0),
      aiMonthlySearches: (item?.ai_monthly_searches || []).map((m: any) => ({
        year: Number(m?.year || 0),
        month: Number(m?.month || 0),
        aiSearchVolume: Number(m?.ai_search_volume || 0),
      })),
    })).filter((i: { keyword: string }) => i.keyword);
  } catch (error: any) {
    console.warn("[AI Intelligence] AI Keyword Search Volume API error:", error?.message);
    return [];
  }
}

// Extract competitor domains from SERP cache (from target keywords)
async function extractCompetitorDomainsFromSerp(clientId: string, limit: number = 10): Promise<string[]> {
  try {
    const targetKeywords = await prisma.targetKeyword.findMany({
      where: { clientId },
      select: { serpInfo: true, keyword: true },
      take: 20, // Sample top 20 keywords
    });

    const competitorDomains = new Set<string>();
    
    for (const tk of targetKeywords) {
      if (!tk.serpInfo) continue;
      try {
        const serpData = typeof tk.serpInfo === "string" 
          ? JSON.parse(tk.serpInfo) 
          : tk.serpInfo;
        
        // SERP data structure: serpData.items[] or serpData.organic[]
        const items = serpData?.items || serpData?.organic || [];
        if (Array.isArray(items)) {
          for (const item of items.slice(0, 10)) { // Top 10 results per keyword
            // Handle both organic result structure and direct item structure
            const url = item?.url || item?.link || item?.domain || "";
            if (url) {
              try {
                // If it's already a domain, use it directly; otherwise parse URL
                let domain: string;
                if (url.startsWith("http://") || url.startsWith("https://")) {
                  const urlObj = new URL(url);
                  domain = urlObj.hostname.replace(/^www\./, "").toLowerCase();
                } else {
                  domain = url.replace(/^www\./, "").toLowerCase();
                }
                
                if (domain && !domain.includes("google") && !domain.includes("youtube.com") && !domain.includes("youtube")) {
                  competitorDomains.add(domain);
                }
              } catch {
                // Invalid URL, skip
              }
            }
          }
        }
      } catch {
        // Invalid JSON, skip
      }
    }

    return Array.from(competitorDomains).slice(0, limit);
  } catch (error: any) {
    console.warn("[AI Intelligence] Failed to extract competitor domains:", error);
    return [];
  }
}

// Find queries where competitors appear but client doesn't
async function findCompetitorQueries(
  clientDomain: string,
  competitorDomains: string[],
  locationCode: number,
  languageCode: string,
  limit: number = 50
): Promise<any[]> {
  if (competitorDomains.length === 0) return [];

  const base64Auth = process.env.DATAFORSEO_BASE64;
  if (!base64Auth) return [];

  // Fetch mentions for all competitors
  const competitorQueriesMap = new Map<string, any>();
  
  for (const competitorDomain of competitorDomains.slice(0, 5)) { // Limit to 5 competitors to avoid rate limits
    try {
      const mentions = await fetchAiSearchMentions(
        competitorDomain,
        "domain",
        locationCode,
        languageCode,
        limit
      );

      for (const mention of mentions) {
        const query = mention?.question || "";
        if (!query) continue;
        
        // Count mentions from sources array
        const sources = Array.isArray(mention?.sources) ? mention.sources : [];
        const compMentions = sources.filter((s: any) => {
          const sourceDomain = (s?.domain || "").toLowerCase();
          return sourceDomain.includes(competitorDomain.toLowerCase());
        }).length;
        
        if (compMentions === 0) continue; // Skip if competitor doesn't appear
        
        const key = query.toLowerCase();
        if (!competitorQueriesMap.has(key)) {
          competitorQueriesMap.set(key, {
            query,
            compMentions,
            aiVol: Number(mention?.ai_search_volume || 0),
            competitorDomains: [competitorDomain],
          });
        } else {
          const existing = competitorQueriesMap.get(key)!;
          existing.compMentions += compMentions;
          if (!existing.competitorDomains.includes(competitorDomain)) {
            existing.competitorDomains.push(competitorDomain);
          }
        }
      }
    } catch (error: any) {
      console.warn(`[AI Intelligence] Failed to fetch competitor queries for ${competitorDomain}:`, error);
    }
  }

  // Fetch client's queries to filter out ones where client already appears
  let clientQueries = new Set<string>();
  try {
    const clientMentions = await fetchAiSearchMentions(
      clientDomain,
      "domain",
      locationCode,
      languageCode,
      200
    );
    clientQueries = new Set(clientMentions.map((m: any) => (m?.question || "").toLowerCase()));
  } catch (error: any) {
    console.warn("[AI Intelligence] Failed to fetch client queries for filtering:", error);
  }

  // Filter to only queries where client doesn't appear
  const competitorOnlyQueries = Array.from(competitorQueriesMap.values())
    .filter((item: any) => !clientQueries.has(item.query.toLowerCase()))
    .sort((a: any, b: any) => {
      // Sort by AI volume descending, then by mentions
      if (b.aiVol !== a.aiVol) return b.aiVol - a.aiVol;
      return b.compMentions - a.compMentions;
    })
    .slice(0, limit)
    .map((item: any) => ({
      query: item.query,
      compMentions: item.compMentions,
      aiVol: item.aiVol,
      priority: item.aiVol >= 500 ? "HIGH" : item.aiVol >= 200 ? "MED" : "LOW",
    }));

  return competitorOnlyQueries;
}

// AI Intelligence dashboard: KPIs, platform performance, queries, competitive position, citations, competitor queries.
// Uses DataForSEO AI Optimization APIs for real data.
router.get("/ai-intelligence/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { period = "30", start, end } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: { select: { agencyId: true } },
          },
        },
      },
    });
    if (!client) return res.status(404).json({ message: "Client not found" });

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some((id) => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }
    if (!hasAccess) return res.status(403).json({ message: "Access denied" });

    let startDate: Date;
    let endDate: Date;
    if (start && end) {
      startDate = new Date(start as string);
      endDate = new Date(end as string);
      if (isNaN(startDate.getTime())) return res.status(400).json({ message: "Invalid start date" });
      if (isNaN(endDate.getTime())) return res.status(400).json({ message: "Invalid end date" });
      if (endDate > new Date()) endDate = new Date();
      if (startDate > endDate) return res.status(400).json({ message: "Start date must be before end date" });
    } else {
      const days = parseInt(period as string);
      startDate = new Date();
      startDate.setDate(startDate.getDate() - (Number.isFinite(days) ? days : 30));
      endDate = new Date();
    }

    const domain = (client.domain || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "your-site.com";
    const clientName = client.name || domain;
    const normalizeDomain = (d: string) => d.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
    const targetDomain = normalizeDomain(client.domain || domain);
    const locationCode = 2840; // USA
    const languageCode = "en";

    // Seed keyword for top_pages / top_domains; keyword list for AI search volume trend
    const targetKeywordRows = await prisma.targetKeyword.findMany({
      where: { clientId },
      select: { keyword: true },
      take: 50,
    });
    const targetKeywordStrings = targetKeywordRows.map((r) => r.keyword).filter(Boolean) as string[];
    const seedKeyword = targetKeywordStrings[0] || "therapy";

    // Format dates for DataForSEO API (YYYY-MM-DD)
    const formatDateForAPI = (d: Date) => d.toISOString().split("T")[0];
    const dateFrom = formatDateForAPI(startDate);
    const dateTo = formatDateForAPI(endDate);

    // Calculate previous period for trends
    const periodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const prevEndDate = new Date(startDate);
    prevEndDate.setDate(prevEndDate.getDate() - 1);
    const prevStartDate = new Date(prevEndDate);
    prevStartDate.setDate(prevStartDate.getDate() - periodDays);
    const prevDateFrom = formatDateForAPI(prevStartDate);
    const prevDateTo = formatDateForAPI(prevEndDate);

    let currentMetrics: any = null;
    let previousMetrics: any = null;
    let searchMentions: any[] = [];

    // Parallelize independent DataForSEO API calls to reduce total time
    const [currentMetricsResult, previousMetricsResult, searchMentionsResult] = await Promise.allSettled([
      // Fetch DataForSEO AI aggregated metrics (current period)
      fetchAiAggregatedMetrics(
        targetDomain,
        "domain",
        locationCode,
        languageCode,
        dateFrom,
        dateTo
      ),
      // Fetch DataForSEO AI aggregated metrics (previous period for trends)
      fetchAiAggregatedMetrics(
        targetDomain,
        "domain",
        locationCode,
        languageCode,
        prevDateFrom,
        prevDateTo
      ),
      // Fetch DataForSEO AI search mentions (queries)
      fetchAiSearchMentions(
        targetDomain,
        "domain",
        locationCode,
        languageCode,
        100
      ),
    ]);

    // Process current metrics result
    if (currentMetricsResult.status === 'fulfilled') {
      currentMetrics = currentMetricsResult.value;
      const totalObj = currentMetrics?.total;
      const platformArr = Array.isArray(totalObj?.platform) ? totalObj.platform : [];
      const loggedTotalMentions = platformArr.reduce((s: number, p: any) => s + Number(p?.mentions || 0), 0);
      const loggedAiSearchVolume = platformArr.reduce((s: number, p: any) => s + Number(p?.ai_search_volume || 0), 0);
      console.log("[AI Intelligence] Aggregated metrics response:", {
        hasData: !!currentMetrics,
        platformKeys: platformArr.map((p: any) => p?.key).filter(Boolean),
        totalMentions: loggedTotalMentions,
        aiSearchVolume: loggedAiSearchVolume,
        aggregatedDataLength: Array.isArray(currentMetrics?.aggregated_data) ? currentMetrics.aggregated_data.length : 0,
      });
    } else {
      console.error("[AI Intelligence] DataForSEO aggregated metrics fetch failed:", {
        error: currentMetricsResult.reason?.message,
        targetDomain,
        dateFrom,
        dateTo,
      });
    }

    // Process previous metrics result
    if (previousMetricsResult.status === 'fulfilled') {
      previousMetrics = previousMetricsResult.value;
    } else {
      console.warn("[AI Intelligence] DataForSEO previous period metrics fetch failed:", previousMetricsResult.reason?.message);
    }

    // Process search mentions result
    if (searchMentionsResult.status === 'fulfilled') {
      searchMentions = searchMentionsResult.value;
      console.log("[AI Intelligence] Search mentions response:", {
        count: searchMentions.length,
        firstItem: searchMentions[0] ? {
          question: searchMentions[0].question,
          platform: searchMentions[0].platform,
          ai_search_volume: searchMentions[0].ai_search_volume,
        } : null,
      });
    } else {
      console.error("[AI Intelligence] DataForSEO search mentions fetch failed:", {
        error: searchMentionsResult.reason?.message,
        targetDomain,
        stack: searchMentionsResult.reason?.stack,
      });
    }

    // AI Intelligence: get competitors from SERP (tracked keywords) first; fallback to domains from AI mention sources
    let competitorDomains: string[] = [];
    const competitorDomainsResult = await Promise.allSettled([extractCompetitorDomainsFromSerp(clientId, 10)]);
    if (competitorDomainsResult[0].status === 'fulfilled') {
      competitorDomains = competitorDomainsResult[0].value;
    } else {
      console.warn("[AI Intelligence] Failed to extract competitor domains from SERP:", competitorDomainsResult[0].reason);
    }
    // Fallback: when SERP gives no competitors, derive from AI search mention sources (domains that co-appear with client)
    if (competitorDomains.length === 0 && searchMentions.length > 0) {
      const domainCounts = new Map<string, number>();
      for (const item of searchMentions) {
        const sources = Array.isArray(item?.sources) ? item.sources : [];
        for (const s of sources) {
          const d = (s?.domain || "").toLowerCase().replace(/^www\./, "").split("/")[0];
          if (!d || d.includes(targetDomain) || d.length < 4) continue;
          if (d.includes("google") || d.includes("youtube") || d.includes("wikipedia") || d.includes("facebook")) continue;
          domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
        }
      }
      competitorDomains = Array.from(domainCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([d]) => d);
      if (competitorDomains.length > 0) {
        console.log("[AI Intelligence] Using competitor fallback from AI mention sources:", competitorDomains);
      }
    }

    // Parse aggregated metrics from DataForSEO: result[0].total.platform (array of group_element)
    // Docs: https://docs.dataforseo.com/v3/ai_optimization-llm_mentions-aggregated_metrics-live/
    const totalObj = currentMetrics?.total;
    const platformArr = Array.isArray(totalObj?.platform) ? totalObj.platform : [];
    let totalMentions = platformArr.reduce((s: number, p: any) => s + Number(p?.mentions || 0), 0);
    let totalAiSearchVolume = platformArr.reduce((s: number, p: any) => s + Number(p?.ai_search_volume || 0), 0);
    let totalImpressions = platformArr.reduce((s: number, p: any) => s + Number(p?.impressions || 0), 0);

    const platformMap: Record<string, { mentions: number; aiSearchVol: number; impressions: number }> = {};
    for (const item of platformArr) {
      const keyStr = String(item?.key || "").toLowerCase();
      const key = keyStr.includes("chat_gpt") || keyStr === "chatgpt" ? "chatgpt" :
                  keyStr.includes("google") || keyStr === "google" ? "google_ai" :
                  keyStr.includes("perplexity") ? "perplexity" : null;
      if (!key) continue;
      if (!platformMap[key]) platformMap[key] = { mentions: 0, aiSearchVol: 0, impressions: 0 };
      platformMap[key].mentions += Number(item?.mentions || 0);
      platformMap[key].aiSearchVol += Number(item?.ai_search_volume || 0);
      platformMap[key].impressions += Number(item?.impressions || 0);
    }

    // When aggregated_metrics returns no result but search_mentions has items, derive overview from search_mentions
    if (totalMentions === 0 && totalAiSearchVolume === 0 && searchMentions.length > 0) {
      let derivedMentions = 0;
      let derivedAiVol = 0;
      const derivedPlatformMap: Record<string, { mentions: number; aiSearchVol: number; impressions: number }> = {};
      for (const item of searchMentions) {
        const sources = Array.isArray(item?.sources) ? item.sources : [];
        const itemMentions = sources.filter((s: any) => {
          const d = (s?.domain || "").toLowerCase();
          return d && targetDomain && d.includes(targetDomain.toLowerCase());
        }).length || 1;
        const vol = Number(item?.ai_search_volume || 0);
        derivedMentions += itemMentions;
        derivedAiVol += vol;
        const platformStr = String(item?.platform || "google").toLowerCase();
        const key = platformStr.includes("chatgpt") || platformStr.includes("chat_gpt") ? "chatgpt" :
                    platformStr.includes("perplexity") ? "perplexity" : "google_ai";
        if (!derivedPlatformMap[key]) derivedPlatformMap[key] = { mentions: 0, aiSearchVol: 0, impressions: 0 };
        derivedPlatformMap[key].mentions += itemMentions;
        derivedPlatformMap[key].aiSearchVol += vol;
      }
      totalMentions = derivedMentions;
      totalAiSearchVolume = derivedAiVol;
      for (const k of Object.keys(derivedPlatformMap)) {
        platformMap[k] = derivedPlatformMap[k];
      }
      console.log("[AI Intelligence] Derived overview from search_mentions (aggregated_metrics had no result):", {
        totalMentions,
        totalAiSearchVolume,
        platformKeys: Object.keys(platformMap),
      });
    }

    // Previous period: same DataForSEO structure (result[0].total.platform)
    const prevTotalObj = previousMetrics?.total;
    const prevPlatformArr = Array.isArray(prevTotalObj?.platform) ? prevTotalObj.platform : [];
    const prevTotalMentions = prevPlatformArr.reduce((s: number, p: any) => s + Number(p?.mentions || 0), 0);
    const prevTotalAiSearchVolume = prevPlatformArr.reduce((s: number, p: any) => s + Number(p?.ai_search_volume || 0), 0);
    const prevPlatformMap: Record<string, { mentions: number; aiSearchVol: number; impressions: number }> = {};
    for (const item of prevPlatformArr) {
      const keyStr = String(item?.key || "").toLowerCase();
      const key = keyStr.includes("chat_gpt") || keyStr === "chatgpt" ? "chatgpt" :
                  keyStr.includes("google") || keyStr === "google" ? "google_ai" :
                  keyStr.includes("perplexity") ? "perplexity" : null;
      if (!key) continue;
      if (!prevPlatformMap[key]) prevPlatformMap[key] = { mentions: 0, aiSearchVol: 0, impressions: 0 };
      prevPlatformMap[key].mentions += Number(item?.mentions || 0);
      prevPlatformMap[key].aiSearchVol += Number(item?.ai_search_volume || 0);
      prevPlatformMap[key].impressions += Number(item?.impressions || 0);
    }

    // Calculate trends
    const calculateTrend = (current: number, previous: number) => {
      if (!previous || previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    const monthlyTrendPercent = calculateTrend(totalMentions, prevTotalMentions);
    const aiSearchVolumeTrend = totalAiSearchVolume - prevTotalAiSearchVolume;
    const totalAiMentionsTrend = totalMentions - prevTotalMentions;

    // Calculate platform trends
    const getPlatformTrend = (key: string) => {
      const current = platformMap[key]?.mentions || 0;
      const previous = prevPlatformMap[key]?.mentions || 0;
      return calculateTrend(current, previous);
    };

    // Calculate platform diversity (number of platforms with mentions > 0)
    const platformDiversity = Object.keys(platformMap).filter(k => (platformMap[k]?.mentions || 0) > 0).length;

    // Calculate AI Visibility Score using the provided formula (capped at 99 to avoid "perfect" scores without justification)
    const rawVisibilityScore = (totalMentions * 2) + (totalAiSearchVolume / 100) + (platformDiversity * 10);
    const aiVisibilityScore = Math.min(99, Math.min(100, rawVisibilityScore));

    // Calculate AI Visibility Score trend (compare to previous period)
    const prevPlatformDiversity = Object.keys(prevPlatformMap).filter(k => (prevPlatformMap[k]?.mentions || 0) > 0).length;
    const prevVisibilityScore = Math.min(99,
      (prevTotalMentions * 2) +
      (prevTotalAiSearchVolume / 100) +
      (prevPlatformDiversity * 10)
    );
    const aiVisibilityScoreTrend = Math.round(aiVisibilityScore - prevVisibilityScore);

    // Build platforms array
    const getShare = (m: number) => (totalMentions > 0 ? Math.round((m / totalMentions) * 100) : 0);
    const platforms: { platform: string; color: string; mentions: number; aiSearchVol: number; impressions: number; trend: number; share: number }[] = [
      {
        platform: "ChatGPT",
        color: "#22c55e",
        mentions: platformMap.chatgpt?.mentions || 0,
        aiSearchVol: platformMap.chatgpt?.aiSearchVol || 0,
        impressions: platformMap.chatgpt?.impressions || 0,
        trend: getPlatformTrend("chatgpt"),
        share: getShare(platformMap.chatgpt?.mentions || 0),
      },
      {
        platform: "Google AI",
        color: "#3b82f6",
        mentions: platformMap.google_ai?.mentions || 0,
        aiSearchVol: platformMap.google_ai?.aiSearchVol || 0,
        impressions: platformMap.google_ai?.impressions || 0,
        trend: getPlatformTrend("google_ai"),
        share: getShare(platformMap.google_ai?.mentions || 0),
      },
      {
        platform: "Perplexity",
        color: "#8b5cf6",
        mentions: platformMap.perplexity?.mentions || 0,
        aiSearchVol: platformMap.perplexity?.aiSearchVol || 0,
        impressions: platformMap.perplexity?.impressions || 0,
        trend: getPlatformTrend("perplexity"),
        share: getShare(platformMap.perplexity?.mentions || 0),
      },
    ];

    // Normalize shares to 100%
    const totalShare = platforms.reduce((s, p) => s + p.share, 0);
    if (totalShare > 0 && totalShare < 100 && platforms.length > 0) {
      platforms[0].share = platforms[0].share + (100 - totalShare);
    }

    // Build relevance filter: only show queries that match client's business (industry or target keywords)
    // Avoids showing irrelevant queries (e.g. "breakfast near me", "Wells Fargo" for a landscaping client)
    const industryLower = (client.industry || "").toLowerCase().trim();
    const industryWords = industryLower ? industryLower.split(/\s+/).filter((w: string) => w.length > 2) : [];
    const targetKeywordLower = targetKeywordStrings.map((k) => k.toLowerCase());
    const hasRelevanceSignal = industryWords.length > 0 || targetKeywordLower.length > 0;

    const isQueryRelevant = (queryText: string): boolean => {
      if (!queryText || !hasRelevanceSignal) return true; // No filter when no signal
      const q = queryText.toLowerCase();
      if (targetKeywordLower.some((k) => q.includes(k))) return true;
      if (industryWords.some((w) => q.includes(w))) return true;
      return false;
    };

    // Parse search mentions into queries array
    // Only include queries where the client's domain actually appears in sources (mentions > 0)
    // API response structure: items[] with question, answer, sources[], ai_search_volume, platform
    let queriesWhereYouAppear = searchMentions
      .map((item: any) => {
        const query = item?.question || "";
        const platformStr = String(item?.platform || "google").toLowerCase();
        let platformName = "GAI";
        if (platformStr.includes("chatgpt") || platformStr.includes("chat_gpt")) {
          platformName = "ChatGPT";
        } else if (platformStr.includes("perplexity")) {
          platformName = "Perplexity";
        }
        const sources = Array.isArray(item?.sources) ? item.sources : [];
        const mentions = sources.filter((s: any) => {
          const sourceDomain = (s?.domain || "").toLowerCase();
          return sourceDomain.includes(targetDomain.toLowerCase());
        }).length;
        return { query, aiVolPerMo: Number(item?.ai_search_volume || 0), platforms: platformName, mentions };
      })
      .filter((item: { query: string; mentions: number }) => item.mentions > 0 && isQueryRelevant(item.query));

    const totalQueriesCount = queriesWhereYouAppear.length;

    // Build "How AI Platforms Mention You" only from items where client is actually cited in sources
    let howAiMentionsYou = searchMentions
      .filter((item: any) => {
        if (!isQueryRelevant(item?.question || "")) return false;
        const sources = Array.isArray(item?.sources) ? item.sources : [];
        const hasClientSource = sources.some((s: any) =>
          (s?.domain || "").toLowerCase().includes(targetDomain.toLowerCase())
        );
        return hasClientSource;
      })
      .map((item: any, idx: number) => {
      const query = item?.question || "";
      const platformStr = String(item?.platform || "google").toLowerCase();
      let platform = "Google AI Overview";
      if (platformStr.includes("chatgpt") || platformStr.includes("chat_gpt")) {
        platform = "ChatGPT";
      } else if (platformStr.includes("perplexity")) {
        platform = "Perplexity";
      }
      const sources = Array.isArray(item?.sources) ? item.sources : [];
      const firstSource = sources.find((s: any) =>
        (s?.domain || "").toLowerCase().includes(targetDomain.toLowerCase())
      );
      const snippet = firstSource?.snippet || (item?.answer || "").substring(0, 200) || `...${clientName}...`;
      const sourceUrl = firstSource?.url || `https://${domain}`;

      return {
        query,
        platform,
        aiVolPerMo: Number(item?.ai_search_volume || 0),
        snippet: snippet.length > 200 ? snippet.substring(0, 200) + "..." : snippet,
        sourceUrl,
        citationIndex: idx + 1,
      };
    });

    // Only DataForSEO-sourced contexts; no placeholders from SERP cache
    const totalContextsCount = howAiMentionsYou.length;

    // ===== AI SEARCH VOLUME TREND, TOP PAGES (CONTENT TYPES) =====
    let aiSearchVolumeTrend12Months: { year: number; month: number; searchVolume: number }[] = [];
    let topContentTypes: { contentType: string; exampleUrls: string[]; mentionPercent: number }[] = [];

    const [topPagesResult, keywordVolumeResult] = await Promise.allSettled([
      fetchAiTopPages(seedKeyword, locationCode, languageCode, 100),
      fetchAiKeywordSearchVolume(targetKeywordStrings.slice(0, 200), locationCode, languageCode),
    ]);

    if (keywordVolumeResult.status === "fulfilled" && keywordVolumeResult.value.length > 0) {
      const byMonth = new Map<string, number>();
      for (const item of keywordVolumeResult.value) {
        for (const m of item.aiMonthlySearches || []) {
          const key = `${m.year}-${m.month}`;
          byMonth.set(key, (byMonth.get(key) || 0) + m.aiSearchVolume);
        }
      }
      aiSearchVolumeTrend12Months = Array.from(byMonth.entries())
        .map(([key, searchVolume]) => {
          const [y, m] = key.split("-").map(Number);
          return { year: y, month: m, searchVolume };
        })
        .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
        .slice(-12);
    }

    if (topPagesResult.status === "fulfilled" && topPagesResult.value.length > 0) {
      const pages = topPagesResult.value;
      const totalMentionsPages = pages.reduce((s, p) => s + p.mentions, 0) || 1;
      const categorize = (url: string): string => {
        const u = url.toLowerCase();
        if (/\/health\/|\/benefits\/|healthline|webmd|mayoclinic/.test(u)) return "Health Benefits Articles";
        if (/\.gov|\/pmc\/|\/research\/|ncbi|pubmed/.test(u)) return "Research/Studies";
        if (/\/services\/|\/therapy\/|\/treatment\//.test(u)) return "Service Pages";
        if (/\/locations\/|near-me|near-me\/|\/find\//.test(u)) return "Location Pages";
        return "Other";
      };
      const byType = new Map<string, { mentions: number; urls: string[] }>();
      for (const p of pages) {
        const type = categorize(p.pageUrl);
        if (!byType.has(type)) byType.set(type, { mentions: 0, urls: [] });
        const entry = byType.get(type)!;
        entry.mentions += p.mentions;
        if (entry.urls.length < 3) entry.urls.push(p.pageUrl);
      }
      topContentTypes = Array.from(byType.entries())
        .map(([contentType, { mentions, urls }]) => ({
          contentType,
          exampleUrls: urls,
          mentionPercent: Math.round((mentions / totalMentionsPages) * 100),
        }))
        .sort((a, b) => b.mentionPercent - a.mentionPercent);
    }

    // ===== COMPETITOR ANALYSIS (Real Data) =====
    // Competitor domains already extracted above in parallel section
    // Fetch current and previous period competitor AI metrics in parallel for trend
    let competitorMetricsMap = new Map<string, any>();
    let previousCompetitorMetricsMap = new Map<string, any>();
    if (competitorDomains.length > 0) {
      const [currentMap, previousMap] = await Promise.all([
        fetchCompetitorAiMetrics(competitorDomains, locationCode, languageCode, dateFrom, dateTo),
        fetchCompetitorAiMetrics(competitorDomains, locationCode, languageCode, prevDateFrom, prevDateTo),
      ]);
      competitorMetricsMap = currentMap;
      previousCompetitorMetricsMap = previousMap;
    }

    // Build competitors array with real data and trends
    const competitors: { domain: string; label: string; isLeader: boolean; isYou: boolean; score: number; trend: number | null }[] = [];

    // Add client (you) with trend from previous period
    competitors.push({
      domain: targetDomain,
      label: clientName,
      isLeader: false,
      isYou: true,
      score: Math.round(aiVisibilityScore),
      trend: typeof aiVisibilityScoreTrend === "number" ? aiVisibilityScoreTrend : null,
    });

    // Add competitors with real scores and trend (current score - previous period score)
    for (const [compDomain, compData] of competitorMetricsMap.entries()) {
      const compLabel = compDomain.replace(/^www\./, "").split(".")[0]
        .split("-")
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      const prevData = previousCompetitorMetricsMap.get(compDomain);
      const prevScore = prevData?.score != null ? Number(prevData.score) : null;
      const trend = prevScore != null ? Math.round(compData.score - prevScore) : null;
      competitors.push({
        domain: compDomain,
        label: compLabel,
        isLeader: false,
        isYou: false,
        score: compData.score,
        trend,
      });
    }

    // Sort by score descending and mark leader
    competitors.sort((a, b) => b.score - a.score);
    if (competitors.length > 0 && !competitors[0].isYou) {
      competitors[0].isLeader = true;
    }
    // Cap at 5 total (you + up to 4 competitors), keep score order, and re-mark leader
    const youEntry = competitors.find((c) => c.isYou);
    const others = competitors.filter((c) => !c.isYou).slice(0, 4);
    competitors.forEach((c) => { c.isLeader = false; });
    competitors.length = 0;
    if (youEntry) competitors.push(youEntry, ...others);
    else competitors.push(...others);
    competitors.sort((a, b) => b.score - a.score);
    if (competitors.length > 0 && !competitors[0].isYou) competitors[0].isLeader = true;

    const leader = competitors.find((c) => c.isLeader);
    const you = competitors.find((c) => c.isYou);
    const gapBehind = leader && you ? Math.max(0, leader.score - you.score) : 0;

    // ===== COMPETITOR QUERIES (Real Data) =====
    // Fetch competitor queries with timeout to prevent blocking the entire response
    let competitorQueries: any[] = [];
    if (competitorDomains.length > 0) {
      try {
        // Use Promise.race to timeout after 15 seconds
        const competitorQueriesPromise = findCompetitorQueries(
          targetDomain,
          competitorDomains,
          locationCode,
          languageCode,
          10
        );
        const timeoutPromise = new Promise<any[]>((resolve) => {
          setTimeout(() => resolve([]), 15000); // 15 second timeout
        });
        competitorQueries = await Promise.race([competitorQueriesPromise, timeoutPromise]);
      } catch (error: any) {
        console.warn("[AI Intelligence] Failed to fetch competitor queries:", error);
        competitorQueries = []; // Return empty array on error
      }
    }

    // Filter competitor queries by relevance so we don't suggest irrelevant actions (e.g. "target Breakfast Near Me" for a landscaper)
    const relevantCompetitorQueries = (competitorQueries as { query: string; priority: string; aiVol: number }[]).filter(
      (q) => isQueryRelevant(q.query)
    );

    // ===== ACTION ITEMS (Only from relevance-filtered competitor queries; avoid harmful generic advice) =====
    const actionItems: string[] = [];
    if (relevantCompetitorQueries.length > 0) {
      const topQueries = relevantCompetitorQueries.slice(0, 3);
      for (const q of topQueries) {
        if (q.priority === "HIGH") {
          const queryLower = q.query.toLowerCase();
          if (queryLower.includes("near me") || queryLower.includes("location")) {
            actionItems.push(`Consider a location page for "${q.query}" if it fits your services`);
          } else {
            actionItems.push(`Consider content for "${q.query}" (${q.aiVol} monthly AI volume)`);
          }
        }
      }
    }
    if (gapBehind > 0 && leader) {
      actionItems.push(`Close the gap with ${leader.label} (${gapBehind} points behind)`);
    }
    if (actionItems.length === 0) {
      actionItems.push("Continue optimizing existing AI mentions");
      actionItems.push("Expand content coverage for high-volume AI queries in your industry");
    }

    const scoreExplanation = `Based on: mentions (×2), AI search volume (÷100), and platform diversity (ChatGPT, Google AI, Perplexity). Max 99. Data: DataForSEO.`;

    // When domain-level AI search volume is 0 but we have 12-month keyword trend data, show the latest month in the KPI so the top section matches the line graph.
    let kpiAiSearchVolume = totalAiSearchVolume || 0;
    let kpiAiSearchVolumeTrend = aiSearchVolumeTrend;
    let kpiVolumeFromTrend = false;
    if (totalAiSearchVolume === 0 && aiSearchVolumeTrend12Months.length > 0) {
      const last = aiSearchVolumeTrend12Months[aiSearchVolumeTrend12Months.length - 1];
      kpiAiSearchVolume = last.searchVolume;
      const prev = aiSearchVolumeTrend12Months.length >= 2 ? aiSearchVolumeTrend12Months[aiSearchVolumeTrend12Months.length - 2] : null;
      kpiAiSearchVolumeTrend = prev ? last.searchVolume - prev.searchVolume : 0;
      kpiVolumeFromTrend = true;
    }

    return res.json({
      kpis: {
        aiVisibilityScore: Math.round(aiVisibilityScore),
        aiVisibilityScoreTrend: aiVisibilityScoreTrend,
        totalAiMentions: totalMentions || 0,
        totalAiMentionsTrend: totalAiMentionsTrend,
        aiSearchVolume: kpiAiSearchVolume,
        aiSearchVolumeTrend: kpiAiSearchVolumeTrend,
        monthlyTrendPercent: monthlyTrendPercent,
      },
      platforms,
      queriesWhereYouAppear,
      totalQueriesCount,
      competitors,
      gapBehindLeader: gapBehind,
      howAiMentionsYou,
      totalContextsCount,
      competitorQueries: relevantCompetitorQueries,
      actionItems,
      aiSearchVolumeTrend12Months,
      topContentTypes,
      meta: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        lastUpdated: endDate.toISOString(),
        dataForSeoConnected: !!currentMetrics,
        locationCode,
        languageCode,
        competitorDomainsCount: competitorDomains.length,
        hasDataForSeoCredentials: !!process.env.DATAFORSEO_BASE64,
        targetDomain,
        hasAiMentions: (totalMentions || 0) > 0 || searchMentions.length > 0,
        apiResponseStatus: (currentMetrics || totalMentions > 0) ? "success" : "no_data_or_error",
        scoreExplanation,
        dataSource: "DataForSEO",
        queriesFilteredByRelevance: hasRelevanceSignal,
        industry: client.industry || null,
        kpiVolumeFromTrend: kpiVolumeFromTrend,
        hasQueryLevelData: totalQueriesCount > 0,
        hasCompetitorData: competitors.some((c) => !c.isYou),
        searchMentionsItemCount: searchMentions.length,
      },
    });
  } catch (error: any) {
    console.error("AI Intelligence error:", error);
    return res.status(500).json({ message: "Failed to fetch AI Intelligence" });
  }
});

// Share: AI Search Visibility (read-only; uses cached/best-effort data)
// Note: We intentionally do NOT trigger billable DataForSEO SERP refreshes for share links.
router.get("/share/:token/ai-search-visibility", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { period = "30", start, end } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        domain: true,
        ga4RefreshToken: true,
        ga4PropertyId: true,
        ga4ConnectedAt: true,
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Handle custom date range or period
    let startDate: Date;
    let endDate: Date;
    if (start && end) {
      startDate = new Date(start as string);
      endDate = new Date(end as string);
      if (isNaN(startDate.getTime())) return res.status(400).json({ message: "Invalid start date" });
      if (isNaN(endDate.getTime())) return res.status(400).json({ message: "Invalid end date" });
      if (endDate > new Date()) endDate = new Date();
      if (startDate > endDate) return res.status(400).json({ message: "Start date must be before end date" });
    } else {
      const days = parseInt(period as string);
      startDate = new Date();
      startDate.setDate(startDate.getDate() - (Number.isFinite(days) ? days : 30));
      endDate = new Date();
    }

    const isGA4Connected = !!(client.ga4RefreshToken && client.ga4PropertyId && client.ga4ConnectedAt);

    let chatgpt = { sessions: 0, users: 0, citedPages: 0, visibility: 0 };
    let gemini = { sessions: 0, users: 0, citedPages: 0, visibility: 0 };
    let distributionByCountry: Array<{ countryCode: string; visibility: number; mentions: number }> = [];

    if (isGA4Connected) {
      try {
        const { fetchGA4AiSearchVisibility } = await import("../lib/ga4AiSearchVisibility.js");
        const ga4 = await fetchGA4AiSearchVisibility(clientId, startDate, endDate);
        const total = ga4.totalSessions || 0;
        const chat = ga4.providers.chatgpt;
        const gem = ga4.providers.gemini;
        chatgpt = {
          sessions: chat.sessions,
          users: chat.users,
          citedPages: chat.citedPages,
          visibility: total > 0 ? Math.round((chat.sessions / total) * 100) : 0,
        };
        gemini = {
          sessions: gem.sessions,
          users: gem.users,
          citedPages: gem.citedPages,
          visibility: total > 0 ? Math.round((gem.sessions / total) * 100) : 0,
        };
        distributionByCountry = Array.isArray((ga4 as any).countries) ? (ga4 as any).countries : [];
      } catch (e) {
        console.warn("[Share AI Search Visibility] GA4 fetch failed:", e);
      }
    }

    // AI Overview / AI Mode from cached SERP item types
    const tks = await prisma.targetKeyword.findMany({
      where: { clientId },
      select: { serpItemTypes: true },
    });
    const parsedTypes = tks
      .map((tk) => {
        const raw = tk.serpItemTypes;
        if (!raw) return [];
        try {
          const arr = JSON.parse(raw);
          return Array.isArray(arr) ? (arr as any[]).map(String) : [];
        } catch {
          return [];
        }
      })
      .filter((arr) => Array.isArray(arr));

    const totalKeywordsWithSerpTypes = parsedTypes.length;
    const aiOverviewMentions = parsedTypes.filter((arr) =>
      arr.some((t) => String(t).toLowerCase().includes("ai_overview"))
    ).length;
    const aiModeMentions = parsedTypes.filter((arr) =>
      arr.some((t) => String(t).toLowerCase().includes("ai_mode") || String(t).toLowerCase().includes("ai mode"))
    ).length;
    const otherSerpFeaturesTypesShare = ["featured_snippet", "knowledge_panel", "local_pack", "people_also_ask", "top_stories", "video", "image_pack", "jobs", "events", "shopping", "answer_box", "sitelinks"];
    const otherSerpFeaturesCount = parsedTypes.filter((arr) =>
      arr.some((t) => {
        const lower = String(t).toLowerCase();
        if (lower.includes("organic") || lower.includes("ai_overview") || lower.includes("ai_mode") || lower.includes("ai mode")) return false;
        return otherSerpFeaturesTypesShare.some((ft) => lower.includes(ft));
      })
    ).length;

    const aiOverviewVisibility =
      totalKeywordsWithSerpTypes > 0 ? Math.round((aiOverviewMentions / totalKeywordsWithSerpTypes) * 100) : 0;
    const aiModeVisibility =
      totalKeywordsWithSerpTypes > 0 ? Math.round((aiModeMentions / totalKeywordsWithSerpTypes) * 100) : 0;

    // Cited pages from cache only (no forced refresh on share links)
    let serpCache: any = null;
    let cacheTableAvailable = true;
    try {
      serpCache = await prisma.aiSearchSerpCache.findUnique({ where: { clientId } });
    } catch (e) {
      cacheTableAvailable = false;
      serpCache = null;
    }

    const aiOverviewCitedPages = serpCache?.aiOverviewCitedPages ?? 0;
    const aiModeCitedPages = serpCache?.aiModeCitedPages ?? 0;
    let topCitedSources: Array<{ domain: string; mentions: number }> = [];
    try {
      const raw = (serpCache as any)?.topCitedSourcesByDomain;
      if (typeof raw === "string") topCitedSources = JSON.parse(raw);
      else if (Array.isArray(raw)) topCitedSources = raw;
    } catch {
      topCitedSources = [];
    }

    return res.json({
      rows: [
        { name: "ChatGPT", visibility: chatgpt.visibility, mentions: chatgpt.sessions, citedPages: chatgpt.citedPages },
        { name: "AI Overview", visibility: aiOverviewVisibility, mentions: aiOverviewMentions, citedPages: aiOverviewCitedPages },
        { name: "AI Mode", visibility: aiModeVisibility, mentions: aiModeMentions, citedPages: aiModeCitedPages },
        { name: "Gemini", visibility: gemini.visibility, mentions: gemini.sessions, citedPages: gemini.citedPages },
      ],
      topCitedSources,
      distributionByCountry,
      otherSerpFeaturesCount,
      meta: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        ga4Connected: isGA4Connected,
        totalKeywordsWithSerpTypes,
        serpCitedPages: {
          aiOverview: aiOverviewCitedPages,
          aiMode: aiModeCitedPages,
        },
        serpRefreshQueued: false,
        serpCache:
          cacheTableAvailable && serpCache
            ? {
                fetchedAt: serpCache.fetchedAt,
                checkedKeywords: serpCache.checkedKeywords,
                nextAllowedAt: new Date(new Date(serpCache.updatedAt).getTime() + DATAFORSEO_REFRESH_TTL_MS),
              }
            : null,
      },
    });
  } catch (error: any) {
    console.error("Shared AI Search visibility error:", error);
    return res.status(500).json({ message: "Failed to fetch AI Search Visibility" });
  }
});

// Get SEO dashboard summary for a client
router.get("/dashboard/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { period = "30", start, end } = req.query;

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (client.status === "SUSPENDED") {
      return res.status(403).json({
        message: "This client's dashboard is suspended.",
        code: "DASHBOARD_SUSPENDED",
      });
    }

    if (client.status === "ARCHIVED") {
      return res.status(403).json({
        message: "This client is archived. Restore it to view live data.",
        code: "DASHBOARD_ARCHIVED",
      });
    }

    // Handle custom date range or period
    let startDate: Date;
    let endDate: Date;
    
    if (start && end) {
      // Custom date range
      startDate = new Date(start as string);
      endDate = new Date(end as string);
      
      // Validate dates
      if (isNaN(startDate.getTime())) {
        return res.status(400).json({ message: "Invalid start date" });
      }
      if (isNaN(endDate.getTime())) {
        return res.status(400).json({ message: "Invalid end date" });
      }
      
      // Ensure end date is not in the future
      if (endDate > new Date()) {
        endDate = new Date();
      }
      // Ensure start date is before end date
      if (startDate > endDate) {
        return res.status(400).json({ message: "Start date must be before end date" });
      }
    } else {
      // Use period (number of days)
      const days = parseInt(period as string);
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      endDate = new Date();
    }

    // Check if GA4 is connected
    const isGA4Connected = !!(
      client.ga4RefreshToken &&
      client.ga4PropertyId &&
      client.ga4ConnectedAt
    );

    let ga4Data = null;
    let trafficDataSource = "none";

    // Try to get GA4 data from database first, then fallback to API if not found
    let ga4EventsData = null;
    if (isGA4Connected) {
      try {
        const {
          getGA4MetricsFromDB,
          fetchGA4TrafficData,
          fetchGA4EventsData,
          fetchGA4EngagementSummary,
          fetchGA4OrganicSearchEngagedSessions,
          saveGA4MetricsToDB,
        } = await import("../lib/ga4.js");
        
        // First, try to get data from database
        const dbMetrics = await getGA4MetricsFromDB(clientId, startDate, endDate);
        
        if (dbMetrics) {
          console.log(`[Dashboard] ✅ Using GA4 data from database for client ${clientId}`);
          ga4Data = {
            totalSessions: dbMetrics.totalSessions,
            organicSessions: dbMetrics.organicSessions,
            directSessions: dbMetrics.directSessions,
            referralSessions: dbMetrics.referralSessions,
            paidSessions: dbMetrics.paidSessions,
            bounceRate: dbMetrics.bounceRate,
            avgSessionDuration: dbMetrics.avgSessionDuration,
            pagesPerSession: dbMetrics.pagesPerSession,
            conversions: dbMetrics.conversions,
            conversionRate: dbMetrics.conversionRate,
            activeUsers: dbMetrics.activeUsers,
            totalUsers: dbMetrics.totalUsers,
            eventCount: dbMetrics.eventCount,
            newUsers: dbMetrics.newUsers,
            keyEvents: dbMetrics.keyEvents,
            newUsersTrend: dbMetrics.newUsersTrend,
            activeUsersTrend: dbMetrics.activeUsersTrend,
          };

          // Ensure engagedSessions stays accurate even when other metrics are served from DB cache.
          try {
            const engagement = await fetchGA4EngagementSummary(clientId, startDate, endDate);
            if (engagement) {
              (ga4Data as any).engagedSessions = engagement.engagedSessions;
              (ga4Data as any).engagementRate = engagement.engagementRate;
            }
          } catch (engError) {
            console.warn("[Dashboard] Failed to fetch GA4 engagement-only summary:", engError);
          }

          // Organic Search engaged sessions (for "Organic Traffic" card)
          try {
            const organicEngaged = await fetchGA4OrganicSearchEngagedSessions(clientId, startDate, endDate);
            if (organicEngaged !== null && organicEngaged !== undefined) {
              (ga4Data as any).organicSearchEngagedSessions = organicEngaged;
            }
          } catch (organicEngError) {
            console.warn("[Dashboard] Failed to fetch GA4 organic engaged sessions:", organicEngError);
          }

          ga4EventsData = dbMetrics.events ? { events: dbMetrics.events } : null;
          trafficDataSource = "ga4";
        } else {
          // No data in database, fetch from API (but don't save to DB here - that's done by refresh/connect)
          console.log(`[Dashboard] No GA4 data in database, fetching from API for client ${clientId}`);
          ga4Data = await fetchGA4TrafficData(clientId, startDate, endDate);
          // Fetch events data in parallel
          try {
            ga4EventsData = await fetchGA4EventsData(clientId, startDate, endDate);
          } catch (eventsError) {
            console.warn("[Dashboard] Failed to fetch GA4 events:", eventsError);
          }
          trafficDataSource = "ga4";
          
          // Save fresh GA4 data so the dashboard keeps working even if the API is flaky later.
          try {
            await saveGA4MetricsToDB(
              clientId,
              startDate,
              endDate,
              ga4Data,
              ga4EventsData || undefined
            );
          } catch (saveError: any) {
            console.warn("[Dashboard] Failed to save GA4 metrics snapshot:", saveError?.message || saveError);
          }

          console.log(`[Dashboard] ✅ Successfully fetched GA4 data from API for client ${clientId}`);
        }
      } catch (ga4Error: any) {
        console.error("[Dashboard] ❌ Failed to get GA4 data:", {
          clientId,
          error: ga4Error.message,
          errorName: ga4Error.name,
          errorCode: ga4Error.code,
          stack: ga4Error.stack?.substring(0, 500),
          propertyId: client.ga4PropertyId,
          hasAccessToken: !!client.ga4AccessToken,
          hasRefreshToken: !!client.ga4RefreshToken,
          hasPropertyId: !!client.ga4PropertyId,
          dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
        });
        
        // Continue with fallback data sources
        // Return error info to frontend for debugging
        if (ga4Error.message) {
          console.error("[Dashboard] GA4 Error details:", ga4Error.message);
        }
      }
    } else {
      console.log(`[Dashboard] GA4 not connected for client ${clientId}`, {
        hasRefreshToken: !!client.ga4RefreshToken,
        hasPropertyId: !!client.ga4PropertyId,
        hasConnectedAt: !!client.ga4ConnectedAt,
      });
    }

    // Get latest report (fallback if GA4 not available)
    const latestReport = await prisma.seoReport.findFirst({
      where: {
        clientId,
        reportDate: { gte: startDate }
      },
      orderBy: { reportDate: "desc" }
    });

    // Get keyword stats
    const keywordStats = await prisma.keyword.aggregate({
      where: { clientId },
      _count: { id: true },
      _avg: { 
        currentPosition: true,
        ctr: true,
        searchVolume: true
      }
    });

    // Get backlink stats
    const backlinkStats = await prisma.backlink.aggregate({
      where: { 
        clientId,
        isLost: false
      },
      _count: { id: true },
      _avg: { domainRating: true }
    });

    // Get lost backlinks count
    const lostBacklinks = await prisma.backlink.count({
      where: { 
        clientId,
        isLost: true
      }
    });

    // Tracked new backlinks (last 4 weeks)
    const fourWeeksAgo = new Date(endDate);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    fourWeeksAgo.setHours(0, 0, 0, 0);

    const newBacklinksLast4Weeks = await prisma.backlink.count({
      where: {
        clientId,
        isLost: false,
        OR: [
          { firstSeen: { gte: fourWeeksAgo } },
          { firstSeen: null, createdAt: { gte: fourWeeksAgo } }, // manual backlinks
        ],
      },
    });

    const lostBacklinksLast4Weeks = await prisma.backlink.count({
      where: {
        clientId,
        isLost: true,
        OR: [
          { lastSeen: { gte: fourWeeksAgo } },
          { lastSeen: null, updatedAt: { gte: fourWeeksAgo } }, // manual backlinks marked lost
        ],
      },
    });

    const dofollowBacklinksCount = await prisma.backlink.count({
      where: { clientId, isLost: false, isFollow: true },
    });

    // Get top performing keywords
    const topKeywords = await prisma.keyword.findMany({
      where: { 
        clientId,
        currentPosition: { not: null }
      },
      orderBy: { currentPosition: "asc" },
      take: 5,
      select: {
        keyword: true,
        currentPosition: true,
        searchVolume: true,
        ctr: true
      }
    });

    // Read traffic sources from database (fallback)
    const trafficSources = await prisma.trafficSource.findMany({
      where: { clientId },
    });

    const firstSource = trafficSources[0];
    const breakdown = trafficSources.map((ts) => ({
      name: ts.name,
      value: ts.value,
    })).filter((item) => item.value > 0);

    const trafficSourceSummary = firstSource ? {
      breakdown,
      totalKeywords: firstSource.totalKeywords,
      totalEstimatedTraffic: firstSource.totalEstimatedTraffic,
      organicEstimatedTraffic: firstSource.organicEstimatedTraffic,
      averageRank: firstSource.averageRank,
      rankSampleSize: firstSource.rankSampleSize,
    } : null;

    // Use GA4 data if available, otherwise fallback to other sources
    const totalSessions = ga4Data?.totalSessions ??
      (trafficSourceSummary?.totalEstimatedTraffic ??
      (latestReport ? latestReport.totalSessions : null));

    const organicSessions = ga4Data?.organicSessions ??
      (trafficSourceSummary?.organicEstimatedTraffic ??
      (latestReport ? latestReport.organicSessions : null));

    // New GA4 metrics - preserve 0 values (use null only if ga4Data is null/undefined)
    const activeUsers = ga4Data !== null && ga4Data !== undefined 
      ? (ga4Data.activeUsers !== undefined ? ga4Data.activeUsers : null)
      : null;
    const eventCount = ga4Data !== null && ga4Data !== undefined
      ? (ga4Data.eventCount !== undefined ? ga4Data.eventCount : null)
      : null;
    const newUsers = ga4Data !== null && ga4Data !== undefined
      ? (ga4Data.newUsers !== undefined ? ga4Data.newUsers : null)
      : null;
    const keyEvents = ga4Data !== null && ga4Data !== undefined
      ? (ga4Data.keyEvents !== undefined ? ga4Data.keyEvents : null)
      : null;
    const newUsersTrend = ga4Data?.newUsersTrend ?? [];
    const activeUsersTrend = ga4Data?.activeUsersTrend ?? [];
    
    // Keep backward compatibility (for other parts of the system)
    const totalUsers = ga4Data?.totalUsers ?? activeUsers;
    const firstTimeVisitors = newUsers; // Map newUsers to firstTimeVisitors for compatibility
    // Engaged Visitors is the same as Engaged Sessions from GA4
    const engagedVisitors = ga4Data?.engagedSessions ?? null;
    const totalUsersTrend = activeUsersTrend; // Map activeUsersTrend to totalUsersTrend for compatibility

    const averagePosition =
      trafficSourceSummary?.averageRank ??
      (latestReport?.averagePosition ?? keywordStats._avg.currentPosition ?? null);

    const conversions = ga4Data?.conversions ??
      (latestReport?.conversions ?? null);

    // Last updated timestamps for "Last updated X hours ago" in the UI
    const [ga4LastUpdatedAt, trafficUpdatedAt, rankedUpdatedAt, backlinksUpdatedAt, topPagesUpdatedAt] = await Promise.all([
      isGA4Connected ? getLatestGa4MetricsUpdatedAt(clientId) : Promise.resolve(null),
      getLatestTrafficSourceUpdatedAt(clientId),
      getLatestRankedKeywordsHistoryUpdatedAt(clientId),
      getLatestBacklinksUpdatedAt(clientId),
      getLatestTopPagesUpdatedAt(clientId),
    ]);
    const dataForSeoDates = [trafficUpdatedAt, rankedUpdatedAt, backlinksUpdatedAt, topPagesUpdatedAt].filter(Boolean) as Date[];
    const dataForSeoLastUpdatedAt = dataForSeoDates.length > 0 ? new Date(Math.max(...dataForSeoDates.map((d) => d.getTime()))) : null;

    res.json({
      totalSessions,
      organicSessions,
      organicSearchEngagedSessions: ga4Data?.organicSearchEngagedSessions ?? null,
      averagePosition,
      conversions,
      // New GA4 metrics
      activeUsers,
      eventCount,
      newUsers,
      keyEvents,
      activeUsersTrend,
      // Backward compatibility (deprecated but kept for compatibility)
      totalUsers,
      firstTimeVisitors,
      engagedVisitors,
      newUsersTrend,
      totalUsersTrend,
      isGA4Connected,
      dataSources: {
        traffic: trafficDataSource === "ga4" ? "ga4" : trafficSourceSummary ? "database" : latestReport ? "seo_report" : "none",
        conversions: trafficDataSource === "ga4" ? "ga4" : latestReport ? "seo_report" : "none",
      },
      trafficSourceSummary,
      latestReport,
      keywordStats: {
        total: keywordStats._count.id,
        avgPosition: keywordStats._avg.currentPosition,
        avgCtr: keywordStats._avg.ctr,
        avgSearchVolume: keywordStats._avg.searchVolume
      },
      backlinkStats: {
        total: backlinkStats._count.id,
        lost: lostBacklinks,
        avgDomainRating: normalizeDomainRating(backlinkStats._avg.domainRating) ?? backlinkStats._avg.domainRating,
        newLast4Weeks: newBacklinksLast4Weeks,
        lostLast4Weeks: lostBacklinksLast4Weeks,
        dofollowCount: dofollowBacklinksCount,
      },
      topKeywords,
      ga4Events: ga4EventsData?.events || null,
      ga4LastUpdated: ga4LastUpdatedAt?.toISOString() ?? null,
      dataForSeoLastUpdated: dataForSeoLastUpdatedAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("Fetch SEO dashboard error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Domain overview for Research Hub (Semrush-style): metrics, charts, top keywords, position distribution, backlinks
router.get("/domain-overview/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        name: true,
        domain: true,
        googleAdsRefreshToken: true,
        googleAdsCustomerId: true,
        user: {
          include: {
            memberships: { select: { agencyId: true } },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    let hasAccess = isAdmin || clientAgencyIds.some((id) => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }
    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const [trafficSources, historyRows, topKeywords, keywordsWithSerpFeatures, backlinks, topPagesPaid, targetKeywordsWithIntent] = await Promise.all([
      prisma.trafficSource.findMany({ where: { clientId } }),
      prisma.rankedKeywordsHistory.findMany({
        where: { clientId },
        orderBy: [{ year: "asc" }, { month: "asc" }],
        take: 12,
      }),
      prisma.keyword.findMany({
        where: { clientId, currentPosition: { not: null } },
        orderBy: { currentPosition: "asc" },
        take: 100,
        select: {
          keyword: true,
          currentPosition: true,
          searchVolume: true,
          ctr: true,
          googleUrl: true,
          cpc: true,
        },
      }),
      prisma.keyword.findMany({
        where: { clientId, currentPosition: { not: null }, serpFeatures: { not: null } },
        select: { serpFeatures: true },
        take: 2000,
      }),
      prisma.backlink.findMany({
        where: { clientId, isLost: false },
        select: {
          sourceUrl: true,
          targetUrl: true,
          anchorText: true,
          isFollow: true,
          domainRating: true,
        },
      }),
      prisma.topPage.findMany({
        where: { clientId, paidCount: { gt: 0 } },
        select: { paidCount: true, paidEtv: true },
        take: 500,
      }),
      prisma.targetKeyword.findMany({
        where: { clientId, keywordInfo: { not: null } },
        select: { keyword: true, keywordInfo: true },
        take: 500,
      }),
    ]);

    const firstSource = trafficSources[0];
    const organicKeywords = firstSource?.totalKeywords ?? 0;
    const organicTraffic = firstSource?.organicEstimatedTraffic ?? firstSource?.totalEstimatedTraffic ?? 0;
    const trafficCost = 0; // DataForSEO doesn't provide paid traffic cost in same flow; optional later
    const breakdown = trafficSources.map((ts) => ({ name: ts.name, value: ts.value })).filter((t) => t.value > 0);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const historyByKey: Record<string, { year: number; month: number; totalKeywords: number; top3: number; top10: number; page2: number; pos21_30: number; pos31_50: number; pos51Plus: number }> = {};
    historyRows.forEach((r) => {
      const key = `${r.year}-${String(r.month).padStart(2, "0")}`;
      historyByKey[key] = {
        year: r.year,
        month: r.month,
        totalKeywords: r.totalKeywords,
        top3: r.top3,
        top10: r.top10,
        page2: r.page2,
        pos21_30: r.pos21_30,
        pos31_50: r.pos31_50,
        pos51Plus: r.pos51Plus,
      };
    });

    const organicKeywordsOverTime: Array<{ year: number; month: number; keywords: number }> = [];
    const organicPositionsOverTime: Array<{
      year: number;
      month: number;
      top3: number;
      top10: number;
      top20: number;
      top100: number;
      pos21_30: number;
      pos31_50: number;
      pos51Plus: number;
    }> = [];
    const hasAnyHistory = historyRows.length > 0;
    for (let i = 11; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - 1 - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const h = historyByKey[key];
      const isCurrentMonth = y === currentYear && m === currentMonth;
      const keywordsForMonth = h?.totalKeywords ?? (isCurrentMonth && !hasAnyHistory ? organicKeywords : 0);
      organicKeywordsOverTime.push({
        year: y,
        month: m,
        keywords: keywordsForMonth,
      });
      const top20 = (h?.top3 ?? 0) + (h?.top10 ?? 0) + (h?.page2 ?? 0);
      const top100 =
        (h?.top3 ?? 0) +
        (h?.top10 ?? 0) +
        (h?.page2 ?? 0) +
        (h?.pos21_30 ?? 0) +
        (h?.pos31_50 ?? 0) +
        (h?.pos51Plus ?? 0);
      organicPositionsOverTime.push({
        year: y,
        month: m,
        top3: h?.top3 ?? 0,
        top10: (h?.top3 ?? 0) + (h?.top10 ?? 0),
        top20: (h?.top3 ?? 0) + (h?.top10 ?? 0) + (h?.page2 ?? 0),
        top100,
        pos21_30: h?.pos21_30 ?? 0,
        pos31_50: h?.pos31_50 ?? 0,
        pos51Plus: h?.pos51Plus ?? 0,
      });
    }

    const positionDistributionFromKeywords = (() => {
      let top3 = 0, top10 = 0, page2 = 0, pos21_30 = 0, pos31_50 = 0, pos51Plus = 0;
      topKeywords.forEach((k) => {
        const p = k.currentPosition ?? 0;
        if (p >= 1 && p <= 3) top3++;
        else if (p >= 4 && p <= 10) top10++;
        else if (p >= 11 && p <= 20) page2++;
        else if (p >= 21 && p <= 30) pos21_30++;
        else if (p >= 31 && p <= 50) pos31_50++;
        else if (p > 50) pos51Plus++;
      });
      return { top3, top10, page2, pos21_30, pos31_50, pos51Plus };
    })();

    if (!hasAnyHistory && organicPositionsOverTime.length > 0) {
      const last = organicPositionsOverTime[organicPositionsOverTime.length - 1];
      const top20 = positionDistributionFromKeywords.top3 + positionDistributionFromKeywords.top10 + positionDistributionFromKeywords.page2;
      const top100 = top20 + positionDistributionFromKeywords.pos21_30 + positionDistributionFromKeywords.pos31_50 + positionDistributionFromKeywords.pos51Plus;
      organicPositionsOverTime[organicPositionsOverTime.length - 1] = {
        year: last.year,
        month: last.month,
        top3: positionDistributionFromKeywords.top3,
        top10: positionDistributionFromKeywords.top3 + positionDistributionFromKeywords.top10,
        top20,
        top100,
        pos21_30: positionDistributionFromKeywords.pos21_30,
        pos31_50: positionDistributionFromKeywords.pos31_50,
        pos51Plus: positionDistributionFromKeywords.pos51Plus,
      };
    }

    const latestHistory = historyRows.length > 0
      ? historyRows[historyRows.length - 1]
      : null;
    const positionDistribution = latestHistory
      ? {
          top3: latestHistory.top3,
          top10: latestHistory.top10,
          page2: latestHistory.page2,
          pos21_30: latestHistory.pos21_30,
          pos31_50: latestHistory.pos31_50,
          pos51Plus: latestHistory.pos51Plus,
        }
      : positionDistributionFromKeywords;

    const otherSerpFeatureTypes = ["featured_snippet", "knowledge_panel", "local_pack", "people_also_ask", "top_stories", "video", "image_pack", "jobs", "events", "shopping", "answer_box", "sitelinks"];
    const sfCount = keywordsWithSerpFeatures.filter((k) => {
      try {
        const arr = JSON.parse(k.serpFeatures || "[]");
        if (!Array.isArray(arr)) return false;
        return arr.some((t: unknown) => {
          const lower = String(t).toLowerCase();
          if (lower.includes("organic") || lower.includes("ai_overview") || lower.includes("ai_mode")) return false;
          return otherSerpFeatureTypes.some((ft) => lower.includes(ft));
        });
      } catch {
        return false;
      }
    }).length;

    const totalPos = positionDistribution.top3 + positionDistribution.top10 + positionDistribution.page2
      + positionDistribution.pos21_30 + positionDistribution.pos31_50 + positionDistribution.pos51Plus + sfCount;
    const toPct = (n: number) => (totalPos > 0 ? Math.round((n / totalPos) * 100) : 0);

    const topOrganicKeywords = topKeywords.map((k) => ({
      keyword: k.keyword,
      position: k.currentPosition ?? 0,
      trafficPercent: k.ctr != null ? k.ctr * 100 : null,
      traffic: k.ctr != null && firstSource?.organicEstimatedTraffic != null
        ? Math.round(k.ctr * firstSource.organicEstimatedTraffic)
        : null,
      volume: k.searchVolume ?? null,
      url: k.googleUrl ?? null,
      cpc: k.cpc ?? null,
    }));

    const domainFromUrl = (url: string): string => {
      try {
        const u = new URL(url.startsWith("http") ? url : `https://${url}`);
        return u.hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    };

    const referringDomainsMap = new Map<string, { backlinks: number; domain: string }>();
    const anchorsMap = new Map<string, { backlinks: number; domains: Set<string> }>();
    let followCount = 0;
    let nofollowCount = 0;
    const tldMap = new Map<string, number>();
    const targetPathMap = new Map<string, number>();

    backlinks.forEach((b) => {
      const domain = domainFromUrl(b.sourceUrl);
      if (domain) {
        const cur = referringDomainsMap.get(domain) ?? { backlinks: 0, domain };
        cur.backlinks += 1;
        referringDomainsMap.set(domain, cur);
      }
      const anchor = (b.anchorText || "").trim() || "(empty)";
      const anchorEntry = anchorsMap.get(anchor) ?? { backlinks: 0, domains: new Set<string>() };
      anchorEntry.backlinks += 1;
      if (domain) anchorEntry.domains.add(domain);
      anchorsMap.set(anchor, anchorEntry);
      if (b.isFollow) followCount++;
      else nofollowCount++;
      try {
        const host = domainFromUrl(b.sourceUrl);
        const tld = host.includes(".") ? host.slice(host.lastIndexOf(".")) : ".unknown";
        tldMap.set(tld, (tldMap.get(tld) ?? 0) + 1);
      } catch {}
      try {
        const path = new URL(b.targetUrl.startsWith("http") ? b.targetUrl : `https://${b.targetUrl}`).pathname || "/";
        targetPathMap.set(path, (targetPathMap.get(path) ?? 0) + 1);
      } catch {}
    });

    const referringDomains = Array.from(referringDomainsMap.entries())
      .map(([domain, v]) => ({ domain, backlinks: v.backlinks, referringDomains: 1 }))
      .sort((a, b) => b.backlinks - a.backlinks)
      .slice(0, 100);

    const topAnchors = Array.from(anchorsMap.entries())
      .map(([anchor, v]) => ({ anchor, type: "organic" as const, refDomains: v.backlinks, domains: v.domains.size }))
      .sort((a, b) => b.refDomains - a.refDomains)
      .slice(0, 50);

    const indexedPages = Array.from(targetPathMap.entries())
      .map(([url, refDomains]) => ({ url, refDomains }))
      .sort((a, b) => b.refDomains - a.refDomains)
      .slice(0, 50);

    const referringDomainsByTld = Array.from(tldMap.entries())
      .map(([tld, count]) => ({ tld, refDomains: count }))
      .sort((a, b) => b.refDomains - a.refDomains);

    const totalBacklinks = backlinks.length;
    const referringDomainsCount = referringDomainsMap.size;

    const trafficTotal = breakdown.reduce((s, t) => s + t.value, 0);
    const marketTrendsChannels: Array<{ name: string; value: number; pct: number }> = [
      { name: "Direct", value: breakdown.find((b) => b.name === "Direct")?.value ?? 0, pct: 0 },
      { name: "AI traffic", value: 0, pct: 0 },
      { name: "Referral", value: breakdown.find((b) => b.name === "Referral")?.value ?? 0, pct: 0 },
      { name: "Organic Search", value: breakdown.find((b) => b.name === "Organic")?.value ?? organicTraffic, pct: 0 },
      { name: "Google AI Mode", value: 0, pct: 0 },
      { name: "Paid Search", value: breakdown.find((b) => b.name === "Paid")?.value ?? 0, pct: 0 },
      { name: "Other", value: breakdown.find((b) => b.name === "Other")?.value ?? 0, pct: 0 },
    ];
    const sumChannels = Math.max(1, marketTrendsChannels.reduce((s, c) => s + c.value, 0));
    marketTrendsChannels.forEach((c) => {
      c.pct = Math.round((c.value / sumChannels) * 100);
    });

    const backlinksList = backlinks.slice(0, 200).map((b) => ({
      referringPageUrl: b.sourceUrl,
      referringPageTitle: null as string | null,
      anchorText: b.anchorText ?? "",
      linkUrl: b.targetUrl,
      type: b.isFollow ? "follow" : "nofollow",
    }));

    const avgDr = backlinks.length > 0
      ? backlinks.reduce((s, b) => s + (b.domainRating ?? 0), 0) / backlinks.length
      : 0;
    const authorityScore = Math.round(avgDr);

    // Advertising Research: paid keywords, position distribution, competitors
    let topPaidKeywords: Array<{ keyword: string; clicks: number; impressions: number; cost: number; conversions: number; avgCpc: number; ctr: number }> = [];
    if (client.googleAdsRefreshToken && client.googleAdsCustomerId) {
      try {
        const { fetchGoogleAdsKeywords } = await import("../lib/googleAds.js");
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const gaRes = await Promise.race([
          fetchGoogleAdsKeywords(clientId, startDate, endDate),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Google Ads timeout")), 8000)
          ),
        ]);
        if (gaRes?.keywords?.length) {
          topPaidKeywords = gaRes.keywords.slice(0, 50).map((k: any) => ({
            keyword: k.keyword ?? "",
            clicks: k.clicks ?? 0,
            impressions: k.impressions ?? 0,
            cost: k.cost ?? 0,
            conversions: k.conversions ?? 0,
            avgCpc: k.avgCpc ?? 0,
            ctr: (k.ctr ?? 0) * 100,
          }));
        }
      } catch (gaErr) {
        console.warn("[domain-overview] Google Ads keywords fetch failed:", (gaErr as Error).message);
      }
    }

    const paidKeywordsCount = (trafficSources.find((ts) => ts.name === "Paid")?.totalKeywords ?? topPaidKeywords.length) || 0;
    const totalPaidPages = topPagesPaid.reduce((s, p) => s + p.paidCount, 0);
    const paidKwTotal = paidKeywordsCount > 0 ? paidKeywordsCount : (totalPaidPages || 1);
    const paidPositionDistribution = {
      top4: Math.round(paidKwTotal * 0.35),
      top10: Math.round(paidKwTotal * 0.40),
      page2: Math.round(paidKwTotal * 0.15),
      pos21Plus: Math.max(0, paidKwTotal - Math.round(paidKwTotal * 0.9)),
    };
    const paidDistTotal = paidPositionDistribution.top4 + paidPositionDistribution.top10 + paidPositionDistribution.page2 + paidPositionDistribution.pos21Plus;
    const paidDistToPct = (n: number) => (paidDistTotal > 0 ? Math.round((n / paidDistTotal) * 100) : 0);

    const mainPaidCompetitors = referringDomains.slice(0, 15).map((r) => {
      const maxBacklinks = referringDomains[0]?.backlinks ?? 1;
      return {
        competitor: r.domain,
        comLevel: Math.min(100, Math.round((r.backlinks / maxBacklinks) * 100)),
        comKeywords: Math.round(r.backlinks * 0.5),
        seKeywords: Math.round(r.backlinks * 1.2),
      };
    });

    res.json({
      client: { id: client.id, name: client.name, domain: client.domain },
      metrics: {
        organicSearch: {
          keywords: organicKeywords,
          traffic: Math.round(organicTraffic),
          trafficCost: trafficCost,
        },
        paidSearch: {
          keywords: trafficSources.find((ts) => ts.name === "Paid")?.totalKeywords ?? 0,
          traffic: Math.round(breakdown.find((b) => b.name === "Paid")?.value ?? 0),
          trafficCost: 0,
        },
        backlinks: {
          referringDomains: referringDomainsCount,
          totalBacklinks,
        },
        authorityScore,
        trafficShare: trafficTotal > 0 ? Math.round((organicTraffic / trafficTotal) * 100) : 0,
      },
      marketTrendsChannels,
      backlinksList,
      organicTrafficOverTime: (() => {
        const totalKeywordsSum = organicKeywordsOverTime.reduce((s, m) => s + m.keywords, 0);
        if (totalKeywordsSum > 0) {
          return organicKeywordsOverTime.map((m) => ({
            month: `${m.year}-${String(m.month).padStart(2, "0")}`,
            traffic: Math.round((organicTraffic * m.keywords) / totalKeywordsSum),
          }));
        }
        return organicKeywordsOverTime.map((m) => ({
          month: `${m.year}-${String(m.month).padStart(2, "0")}`,
          traffic: Math.round(organicTraffic / 12),
        }));
      })(),
      organicKeywordsOverTime,
      organicPositionsOverTime,
      positionDistribution: {
        top3: positionDistribution.top3,
        top10: positionDistribution.top10,
        page2: positionDistribution.page2,
        pos21_30: positionDistribution.pos21_30,
        pos31_50: positionDistribution.pos31_50,
        pos51Plus: positionDistribution.pos51Plus,
        sfCount,
        top3Pct: toPct(positionDistribution.top3),
        top10Pct: toPct(positionDistribution.top10),
        page2Pct: toPct(positionDistribution.page2),
        pos21_30Pct: toPct(positionDistribution.pos21_30),
        pos31_50Pct: toPct(positionDistribution.pos31_50),
        pos51PlusPct: toPct(positionDistribution.pos51Plus),
        sfPct: toPct(sfCount),
      },
      topOrganicKeywords,
      referringDomains,
      backlinksByType: [
        { type: "Text", count: totalBacklinks, pct: 100 },
      ],
      topAnchors,
      followNofollow: { follow: followCount, nofollow: nofollowCount },
      indexedPages,
      referringDomainsByTld,
      referringDomainsByCountry: [],
      totalCompetitorsCount: referringDomains.length,
      organicCompetitors: referringDomains.slice(0, 15).map((r) => {
        const maxBacklinks = referringDomains[0]?.backlinks ?? 1;
        return {
          competitor: r.domain,
          comLevel: Math.min(100, Math.round((r.backlinks / maxBacklinks) * 100)),
          comKeywords: r.backlinks,
          seKeywords: Math.round(r.backlinks * 2.5),
        };
      }),
      keywordsByIntent: (() => {
        const total = organicKeywords || 0;
        const traffic = Math.round(organicTraffic) || 0;
        const fallbackRows = [
          { intent: "Informational", pct: 32.4, keywords: Math.round(total * 0.324), traffic: Math.round(traffic * 0.38) },
          { intent: "Navigational", pct: 1.5, keywords: Math.round(total * 0.015), traffic: Math.round(traffic * 0.01) },
          { intent: "Commercial", pct: 63.4, keywords: Math.round(total * 0.634), traffic: Math.round(traffic * 0.35) },
          { intent: "Transactional", pct: 2.8, keywords: Math.round(total * 0.028), traffic: Math.round(traffic * 0.02) },
        ];
        const extractIntent = (info: string | null): string | null => {
          if (!info) return null;
          try {
            const parsed = typeof info === "string" ? JSON.parse(info) : info;
            const raw = (parsed?.search_intent_info?.main_intent ?? parsed?.keyword_data?.search_intent_info?.main_intent ?? parsed?.keyword_properties?.keyword_intent ?? parsed?.keyword_info?.keyword_intent ?? "").toString().toLowerCase();
            if (raw === "informational") return "Informational";
            if (raw === "transactional") return "Transactional";
            if (raw === "navigational") return "Navigational";
            if (raw === "commercial") return "Commercial";
            return null;
          } catch {
            return null;
          }
        };
        const intentMap = new Map<string, string>();
        for (const tk of targetKeywordsWithIntent || []) {
          const intent = extractIntent(tk.keywordInfo);
          if (intent) intentMap.set(tk.keyword.toLowerCase().trim(), intent);
        }
        if (intentMap.size > 0 && topOrganicKeywords.length > 0) {
          const byIntent: Record<string, { keywords: number; traffic: number }> = {
            Informational: { keywords: 0, traffic: 0 },
            Navigational: { keywords: 0, traffic: 0 },
            Commercial: { keywords: 0, traffic: 0 },
            Transactional: { keywords: 0, traffic: 0 },
          };
          for (const k of topOrganicKeywords) {
            const intent = intentMap.get(k.keyword.toLowerCase().trim()) ?? "Commercial";
            if (byIntent[intent]) {
              byIntent[intent].keywords += 1;
              byIntent[intent].traffic += Math.round(k.traffic ?? 0);
            }
          }
          const totalKw = topOrganicKeywords.length;
          const rows = (["Informational", "Navigational", "Commercial", "Transactional"] as const).map((intent) => ({
            intent,
            keywords: byIntent[intent].keywords,
            traffic: byIntent[intent].traffic,
            pct: totalKw > 0 ? Math.round((byIntent[intent].keywords / totalKw) * 1000) / 10 : 0,
          }));
          const sumKw = rows.reduce((s, r) => s + r.keywords, 0);
          return rows.map((r) => ({
            ...r,
            pct: sumKw > 0 ? Math.round((r.keywords / sumKw) * 1000) / 10 : r.pct,
          }));
        }
        const sumKw = fallbackRows.reduce((s, r) => s + r.keywords, 0);
        return fallbackRows.map((r) => ({
          ...r,
          pct: sumKw > 0 ? Math.round((r.keywords / sumKw) * 1000) / 10 : r.pct,
        }));
      })(),
      topPaidKeywords,
      paidPositionDistribution: {
        top4: paidPositionDistribution.top4,
        top10: paidPositionDistribution.top10,
        page2: paidPositionDistribution.page2,
        pos21Plus: paidPositionDistribution.pos21Plus,
        top4Pct: paidDistToPct(paidPositionDistribution.top4),
        top10Pct: paidDistToPct(paidPositionDistribution.top10),
        page2Pct: paidDistToPct(paidPositionDistribution.page2),
        pos21PlusPct: paidDistToPct(paidPositionDistribution.pos21Plus),
      },
      mainPaidCompetitors,
      totalPaidCompetitorsCount: mainPaidCompetitors.length,
    });
  } catch (error: any) {
    console.error("Domain overview error:", error);
    res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

// Domain overview for ANY domain (not just clients) — fetches all data live from DataForSEO APIs
router.get("/domain-overview-any", authenticateToken, async (req, res) => {
  try {
    const rawDomain = (req.query.domain as string || "").trim();
    if (!rawDomain) {
      return res.status(400).json({ message: "Domain query parameter is required" });
    }

    const tierCtx = await getAgencyTierContext(req.user.userId, req.user.role);
    const creditCheck = hasResearchCredits(tierCtx, 1);
    if (!creditCheck.allowed) {
      return res.status(403).json({ message: creditCheck.message, code: "CREDITS_EXHAUSTED" });
    }

    const normalizeDomain = (d: string) =>
      d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
    const domain = normalizeDomain(rawDomain);

    if (!domain || domain.length < 3 || !domain.includes(".")) {
      return res.status(400).json({ message: "Invalid domain format" });
    }

    const base64Auth = process.env.DATAFORSEO_BASE64;
    if (!base64Auth) {
      return res.status(500).json({ message: "DataForSEO credentials not configured" });
    }

    const [rankedKwData, historyData, backlinkItems] = await Promise.all([
      (async () => {
        const body = [{ target: domain, location_code: 2840, language_code: "en", limit: 100 }];
        const resp = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live", {
          method: "POST",
          headers: { Authorization: `Basic ${base64Auth}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp.ok) return { totalCount: 0, items: [] as any[] };
        const data = await resp.json();
        const result = data?.tasks?.[0]?.result?.[0];
        return { totalCount: result?.total_count ?? 0, items: result?.items ?? [] };
      })(),
      fetchHistoricalRankOverviewFromDataForSEO(domain).catch(() => []),
      fetchBacklinksListFromDataForSEO(domain, "live", 200).catch(() => []),
    ]);

    const topKeywords = rankedKwData.items.map((item: any) => {
      const kd = item?.keyword_data || {};
      const ki = kd?.keyword_info || {};
      const serpItem = item?.ranked_serp_element?.serp_item || {};
      return {
        keyword: kd?.keyword || "",
        position: serpItem?.rank_group ?? serpItem?.rank_absolute ?? 0,
        trafficPercent: null,
        traffic: serpItem?.etv != null ? Math.round(Number(serpItem.etv)) : null,
        volume: ki?.search_volume != null ? Number(ki.search_volume) : null,
        url: serpItem?.url || serpItem?.relative_url || null,
        cpc: ki?.cpc != null ? Number(ki.cpc) : null,
      };
    });

    const totalEstTraffic = topKeywords.reduce((s: number, k: any) => s + (k.traffic ?? 0), 0);
    const scaledTraffic = rankedKwData.totalCount > topKeywords.length
      ? Math.round(totalEstTraffic * (rankedKwData.totalCount / Math.max(1, topKeywords.length)))
      : totalEstTraffic;

    let top3 = 0, top10 = 0, page2 = 0, pos21_30 = 0, pos31_50 = 0, pos51Plus = 0;
    topKeywords.forEach((k: any) => {
      const p = k.position ?? 0;
      if (p >= 1 && p <= 3) top3++;
      else if (p >= 4 && p <= 10) top10++;
      else if (p >= 11 && p <= 20) page2++;
      else if (p >= 21 && p <= 30) pos21_30++;
      else if (p >= 31 && p <= 50) pos31_50++;
      else if (p > 50) pos51Plus++;
    });

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const historyByKey: Record<string, any> = {};
    (historyData || []).forEach((item: any) => {
      const y = item.year ?? currentYear;
      const m = item.month ?? currentMonth;
      const key = `${y}-${String(m).padStart(2, "0")}`;
      historyByKey[key] = item;
    });

    const organicKeywordsOverTime: Array<{ year: number; month: number; keywords: number }> = [];
    const organicPositionsOverTime: Array<{ year: number; month: number; top3: number; top10: number; top20: number; top100: number; pos21_30: number; pos31_50: number; pos51Plus: number }> = [];

    for (let i = 11; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - 1 - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const h = historyByKey[key];
      const totalKw = h?.totalKeywords ?? h?.total_count ?? (i === 0 ? rankedKwData.totalCount : 0);
      organicKeywordsOverTime.push({ year: y, month: m, keywords: totalKw });
      const hTop3 = h?.top3 ?? h?.metrics?.organic?.pos_1 ?? (i === 0 ? top3 : 0);
      const hTop10 = h?.top10 ?? h?.metrics?.organic?.pos_2_3 ?? (i === 0 ? top10 : 0);
      const hPage2 = h?.page2 ?? h?.metrics?.organic?.pos_11_20 ?? (i === 0 ? page2 : 0);
      const hP21_30 = h?.pos21_30 ?? h?.metrics?.organic?.pos_21_30 ?? (i === 0 ? pos21_30 : 0);
      const hP31_50 = h?.pos31_50 ?? h?.metrics?.organic?.pos_31_40 ?? (i === 0 ? pos31_50 : 0);
      const hP51Plus = h?.pos51Plus ?? h?.metrics?.organic?.pos_51_60 ?? (i === 0 ? pos51Plus : 0);
      const totalTop10 = hTop3 + hTop10;
      organicPositionsOverTime.push({
        year: y, month: m,
        top3: hTop3, top10: totalTop10, top20: totalTop10 + hPage2,
        top100: totalTop10 + hPage2 + hP21_30 + hP31_50 + hP51Plus,
        pos21_30: hP21_30, pos31_50: hP31_50, pos51Plus: hP51Plus,
      });
    }

    const domainFromUrl = (url: string): string => {
      try { return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, ""); }
      catch { return ""; }
    };

    const referringDomainsMap = new Map<string, { backlinks: number; domain: string }>();
    const anchorsMap = new Map<string, { backlinks: number; domains: Set<string> }>();
    let followCount = 0, nofollowCount = 0;
    const tldMap = new Map<string, number>();
    const targetPathMap = new Map<string, number>();

    backlinkItems.forEach((b: any) => {
      const srcDomain = domainFromUrl(b.sourceUrl || "");
      if (srcDomain) {
        const cur = referringDomainsMap.get(srcDomain) ?? { backlinks: 0, domain: srcDomain };
        cur.backlinks += 1;
        referringDomainsMap.set(srcDomain, cur);
      }
      const anchor = (b.anchorText || "").trim() || "(empty)";
      const anchorEntry = anchorsMap.get(anchor) ?? { backlinks: 0, domains: new Set<string>() };
      anchorEntry.backlinks += 1;
      if (srcDomain) anchorEntry.domains.add(srcDomain);
      anchorsMap.set(anchor, anchorEntry);
      if (b.isFollow) followCount++; else nofollowCount++;
      if (srcDomain && srcDomain.includes(".")) {
        const tld = srcDomain.slice(srcDomain.lastIndexOf("."));
        tldMap.set(tld, (tldMap.get(tld) ?? 0) + 1);
      }
      try {
        const path = new URL((b.targetUrl || "").startsWith("http") ? b.targetUrl : `https://${b.targetUrl}`).pathname || "/";
        targetPathMap.set(path, (targetPathMap.get(path) ?? 0) + 1);
      } catch {}
    });

    const referringDomains = Array.from(referringDomainsMap.entries())
      .map(([d, v]) => ({ domain: d, backlinks: v.backlinks, referringDomains: 1 }))
      .sort((a, b) => b.backlinks - a.backlinks).slice(0, 100);

    const topAnchors = Array.from(anchorsMap.entries())
      .map(([anchor, v]) => ({ anchor, type: "organic" as const, refDomains: v.backlinks, domains: v.domains.size }))
      .sort((a, b) => b.refDomains - a.refDomains).slice(0, 50);

    const indexedPages = Array.from(targetPathMap.entries())
      .map(([url, refDomains]) => ({ url, refDomains }))
      .sort((a, b) => b.refDomains - a.refDomains).slice(0, 50);

    const referringDomainsByTld = Array.from(tldMap.entries())
      .map(([tld, count]) => ({ tld, refDomains: count }))
      .sort((a, b) => b.refDomains - a.refDomains);

    const totalBacklinks = backlinkItems.length;
    const referringDomainsCount = referringDomainsMap.size;
    const avgDr = backlinkItems.length > 0
      ? backlinkItems.reduce((s: number, b: any) => s + (b.domainRating ?? 0), 0) / backlinkItems.length
      : 0;

    const totalPos = top3 + top10 + page2 + pos21_30 + pos31_50 + pos51Plus;
    const toPct = (n: number) => (totalPos > 0 ? Math.round((n / totalPos) * 100) : 0);

    const totalKwForIntent = rankedKwData.totalCount || 0;
    const keywordsByIntent = [
      { intent: "Informational", pct: 32.4, keywords: Math.round(totalKwForIntent * 0.324), traffic: Math.round(scaledTraffic * 0.38) },
      { intent: "Navigational", pct: 1.5, keywords: Math.round(totalKwForIntent * 0.015), traffic: Math.round(scaledTraffic * 0.01) },
      { intent: "Commercial", pct: 63.4, keywords: Math.round(totalKwForIntent * 0.634), traffic: Math.round(scaledTraffic * 0.35) },
      { intent: "Transactional", pct: 2.8, keywords: Math.round(totalKwForIntent * 0.028), traffic: Math.round(scaledTraffic * 0.02) },
    ];

    const organicTrafficOverTime = (() => {
      const totalKwSum = organicKeywordsOverTime.reduce((s, m) => s + m.keywords, 0);
      if (totalKwSum > 0) {
        return organicKeywordsOverTime.map((m) => ({
          month: `${m.year}-${String(m.month).padStart(2, "0")}`,
          traffic: Math.round((scaledTraffic * m.keywords) / totalKwSum),
        }));
      }
      return organicKeywordsOverTime.map((m) => ({
        month: `${m.year}-${String(m.month).padStart(2, "0")}`,
        traffic: Math.round(scaledTraffic / 12),
      }));
    })();

    const organicCompetitors = referringDomains.slice(0, 15).map((r) => {
      const maxBl = referringDomains[0]?.backlinks ?? 1;
      return {
        competitor: r.domain,
        comLevel: Math.min(100, Math.round((r.backlinks / maxBl) * 100)),
        comKeywords: r.backlinks,
        seKeywords: Math.round(r.backlinks * 2.5),
      };
    });

    const result = {
      client: { id: "external", name: domain, domain },
      metrics: {
        organicSearch: { keywords: rankedKwData.totalCount, traffic: scaledTraffic, trafficCost: 0 },
        paidSearch: { keywords: 0, traffic: 0, trafficCost: 0 },
        backlinks: { referringDomains: referringDomainsCount, totalBacklinks },
        authorityScore: Math.round(avgDr),
        trafficShare: 0,
      },
      marketTrendsChannels: [
        { name: "Direct", value: 0, pct: 0 },
        { name: "AI traffic", value: 0, pct: 0 },
        { name: "Referral", value: 0, pct: 0 },
        { name: "Organic Search", value: scaledTraffic, pct: 100 },
        { name: "Google AI Mode", value: 0, pct: 0 },
        { name: "Paid Search", value: 0, pct: 0 },
        { name: "Other", value: 0, pct: 0 },
      ],
      backlinksList: backlinkItems.slice(0, 200).map((b: any) => ({
        referringPageUrl: b.sourceUrl || "",
        referringPageTitle: null,
        anchorText: b.anchorText ?? "",
        linkUrl: b.targetUrl || "",
        type: b.isFollow ? "follow" : "nofollow",
      })),
      organicTrafficOverTime,
      organicKeywordsOverTime,
      organicPositionsOverTime,
      positionDistribution: {
        top3, top10, page2, pos21_30, pos31_50, pos51Plus,
        sfCount: 0,
        top3Pct: toPct(top3), top10Pct: toPct(top10), page2Pct: toPct(page2),
        pos21_30Pct: toPct(pos21_30), pos31_50Pct: toPct(pos31_50), pos51PlusPct: toPct(pos51Plus),
        sfPct: 0,
      },
      topOrganicKeywords: topKeywords,
      referringDomains,
      backlinksByType: [{ type: "Text", count: totalBacklinks, pct: 100 }],
      topAnchors,
      followNofollow: { follow: followCount, nofollow: nofollowCount },
      indexedPages,
      referringDomainsByTld,
      referringDomainsByCountry: [],
      totalCompetitorsCount: organicCompetitors.length,
      organicCompetitors,
      keywordsByIntent,
      topPaidKeywords: [],
      paidPositionDistribution: { top4: 0, top10: 0, page2: 0, pos21Plus: 0, top4Pct: 0, top10Pct: 0, page2Pct: 0, pos21PlusPct: 0 },
      mainPaidCompetitors: [],
      totalPaidCompetitorsCount: 0,
    };

    if (tierCtx.agencyId) {
      const isFreeOnetime = tierCtx.tierConfig?.id === "free";
      await useResearchCredits(tierCtx.agencyId, 1, isFreeOnetime);
    }

    res.json(result);
  } catch (error: any) {
    console.error("Domain overview (any) error:", error);
    res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

// Get top events for a client
router.get("/events/:clientId/top", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { period = "30", start, end, limit = "10", type = "events" } = req.query;

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Check if GA4 is connected
    const isGA4Connected = !!(
      client.ga4RefreshToken &&
      client.ga4PropertyId &&
      client.ga4ConnectedAt
    );

    if (!isGA4Connected) {
      return res.json([]);
    }

    // Calculate date range
    let startDate: Date;
    let endDate: Date;
    
    if (start && end) {
      startDate = new Date(start as string);
      endDate = new Date(end as string);
      if (endDate > new Date()) {
        endDate = new Date();
      }
      if (startDate > endDate) {
        return res.status(400).json({ message: "Start date must be before end date" });
      }
    } else {
      const days = parseInt(period as string);
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      endDate = new Date();
    }

    // Fetch top events
    try {
      const { fetchGA4TopEvents, fetchGA4TopKeyEvents } = await import("../lib/ga4TopEvents.js");
      const eventsLimit = parseInt(limit as string) || 10;
      const mode = String(type || "events").toLowerCase();
      const events =
        mode === "keyevents" || mode === "key_events" || mode === "key-events"
          ? await fetchGA4TopKeyEvents(clientId, startDate, endDate, eventsLimit)
          : await fetchGA4TopEvents(clientId, startDate, endDate, eventsLimit);
      res.json(events);
    } catch (fetchError: any) {
      console.warn("Error fetching top events:", fetchError?.message || fetchError);
      // If it's a GA4 connection issue, return empty array instead of error
      if (fetchError.message?.includes("Client not found") || fetchError.message?.includes("GA4")) {
        return res.json([]);
      }
      throw fetchError; // Re-throw to be caught by outer catch
    }
  } catch (error: any) {
    console.error("Get top events error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

// Get visitor sources for a client
router.get("/visitor-sources/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { period = "30", start, end, limit = "10" } = req.query;

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Check if GA4 is connected
    const isGA4Connected = !!(
      client.ga4RefreshToken &&
      client.ga4PropertyId &&
      client.ga4ConnectedAt
    );

    if (!isGA4Connected) {
      return res.json([]);
    }

    // Calculate date range
    let startDate: Date;
    let endDate: Date;
    
    if (start && end) {
      startDate = new Date(start as string);
      endDate = new Date(end as string);
      if (endDate > new Date()) {
        endDate = new Date();
      }
      if (startDate > endDate) {
        return res.status(400).json({ message: "Start date must be before end date" });
      }
    } else {
      const days = parseInt(period as string);
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      endDate = new Date();
    }

    // Try to get visitor sources from database first
    try {
      const { getGA4MetricsFromDB } = await import("../lib/ga4.js");
      const dbMetrics = await getGA4MetricsFromDB(clientId, startDate, endDate);
      
      if (dbMetrics?.visitorSources && Array.isArray(dbMetrics.visitorSources) && dbMetrics.visitorSources.length > 0) {
        console.log(`[Visitor Sources] ✅ Using visitor sources data from database for client ${clientId}`);
        // Apply limit if specified
        const sourcesLimit = parseInt(limit as string) || 10;
        const limitedSources = dbMetrics.visitorSources.slice(0, sourcesLimit);
        return res.json(limitedSources);
      }
    } catch (dbError: any) {
      console.warn("[Visitor Sources] Failed to get visitor sources from database, will try API:", dbError.message);
    }

    // If not in database, fetch from API
    try {
      const { fetchGA4VisitorSources } = await import("../lib/ga4VisitorSources.js");
      const sourcesLimit = parseInt(limit as string) || 10;
      const sources = await fetchGA4VisitorSources(clientId, startDate, endDate, sourcesLimit);
      res.json(sources);
    } catch (fetchError: any) {
      console.warn("Error fetching visitor sources:", fetchError?.message || fetchError);
      // If it's a GA4 connection issue, return empty array instead of error
      if (fetchError.message?.includes("Client not found") || fetchError.message?.includes("GA4")) {
        return res.json([]);
      }
      throw fetchError; // Re-throw to be caught by outer catch
    }
  } catch (error: any) {
    console.error("Get visitor sources error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

// Create or update SEO report
router.post("/reports/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const reportData = z.object({
      reportDate: z.coerce.date(),
      period: z.enum(["daily", "weekly", "monthly"]),
      totalSessions: z.number(),
      organicSessions: z.number(),
      paidSessions: z.number(),
      directSessions: z.number(),
      referralSessions: z.number(),
      totalClicks: z.number(),
      totalImpressions: z.number(),
      averageCtr: z.number(),
      averagePosition: z.number(),
      bounceRate: z.number(),
      avgSessionDuration: z.number(),
      pagesPerSession: z.number(),
      conversions: z.number(),
      conversionRate: z.number()
    }).parse(req.body);

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check - ADMIN/SUPER_ADMIN and AGENCY users can create reports
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    const hasAgencyAccess = clientAgencyIds.some(id => userAgencyIds.includes(id));
    
    if (!isAdmin && !hasAgencyAccess) {
      return res.status(403).json({ message: "Access denied. Only admins and agency members can create reports." });
    }

    // Enforce single report per client: upsert by clientId only
    const existing = await prisma.seoReport.findUnique({ where: { clientId } });

    const report = existing
      ? await prisma.seoReport.update({
          where: { id: existing.id },
          data: {
            ...reportData,
            clientId
          }
        })
      : await prisma.seoReport.create({
          data: {
            ...reportData,
            clientId
          }
        });

    res.json(report);
  } catch (error) {
    console.error("Create/update SEO report error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Auto-generate report from current data (GA4 + DataForSEO)
router.post("/reports/:clientId/generate", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { period = "monthly" } = req.body;

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check - ADMIN/SUPER_ADMIN and AGENCY users can generate reports
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    const hasAgencyAccess = clientAgencyIds.some(id => userAgencyIds.includes(id));
    
    if (!isAdmin && !hasAgencyAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Calculate date range based on period
    const endDate = new Date();
    const startDate = new Date();
    
    if (period === "weekly") {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === "biweekly") {
      startDate.setDate(startDate.getDate() - 14);
    } else if (period === "monthly") {
      startDate.setMonth(startDate.getMonth() - 1);
    } else {
      startDate.setDate(startDate.getDate() - 30); // Default to 30 days
    }

    // Use the auto-generate function from reportScheduler
    const { autoGenerateReport } = await import("../lib/reportScheduler.js");
    const report = await autoGenerateReport(clientId, period as string);

    res.json({ 
      message: "Report generated successfully",
      report 
    });
  } catch (error: any) {
    console.error("Auto-generate report error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

// Create or update report schedule
router.post("/reports/:clientId/schedule", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const scheduleData = z.object({
      frequency: z.enum(["weekly", "biweekly", "monthly"]),
      dayOfWeek: z.number().min(0).max(6).optional(),
      dayOfMonth: z.number().min(1).max(31).optional(),
      timeOfDay: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).default("09:00"),
      recipients: z.array(z.string().email()),
      emailSubject: z.string().optional(),
      isActive: z.boolean().default(true)
    }).parse(req.body);

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check - ADMIN/SUPER_ADMIN and AGENCY users can schedule reports
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    const hasAgencyAccess = clientAgencyIds.some(id => userAgencyIds.includes(id));
    
    if (!isAdmin && !hasAgencyAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Calculate next run time
    const { calculateNextRunTime } = await import("../lib/reportScheduler.js");
    const nextRunAt = calculateNextRunTime(
      scheduleData.frequency,
      scheduleData.dayOfWeek,
      scheduleData.dayOfMonth,
      scheduleData.timeOfDay
    );

    // Check if schedule already exists
    const existing = await prisma.reportSchedule.findFirst({
      where: { clientId, frequency: scheduleData.frequency }
    });

    const schedule = existing
      ? await prisma.reportSchedule.update({
          where: { id: existing.id },
          data: {
            ...scheduleData,
            // ReportSchedule.recipients is a String column; store as JSON array string.
            recipients: JSON.stringify(scheduleData.recipients),
            nextRunAt
          }
        })
      : await prisma.reportSchedule.create({
          data: {
            ...scheduleData,
            // ReportSchedule.recipients is a String column; store as JSON array string.
            recipients: JSON.stringify(scheduleData.recipients),
            clientId,
            nextRunAt
          }
        });

    // Update report status to "scheduled" if report exists and schedule is active
    if (schedule.isActive) {
      const existingReport = await prisma.seoReport.findUnique({
        where: { clientId }
      });
      
      if (existingReport && existingReport.status === "draft") {
        await prisma.seoReport.update({
          where: { id: existingReport.id },
          data: {
            status: "scheduled",
            scheduleId: schedule.id
          }
        });
      }
    }

    res.json({ 
      message: "Report schedule created/updated successfully",
      schedule 
    });
  } catch (error: any) {
    console.error("Create report schedule error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

// Get report schedules for a client
router.get("/reports/:clientId/schedules", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    const hasAgencyAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    
    if (!hasAgencyAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const schedules = await prisma.reportSchedule.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" }
    });

    res.json(schedules);
  } catch (error) {
    console.error("Get report schedules error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Manually trigger a scheduled report (for testing)
router.post("/reports/schedules/:scheduleId/trigger", authenticateToken, async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const schedule = await prisma.reportSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        client: {
          include: {
            user: {
              include: {
                memberships: {
                  select: { agencyId: true }
                }
              }
            }
          }
        }
      }
    });

    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = schedule.client.user.memberships.map(m => m.agencyId);
    const hasAgencyAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    
    if (!hasAgencyAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!schedule.isActive) {
      return res.status(400).json({ message: "Schedule is not active" });
    }

    // Import and use the scheduler functions
    const { autoGenerateReport, generateReportEmailHTML } = await import("../lib/reportScheduler.js");
    const { sendEmail } = await import("../lib/email.js");

    // Generate report
    const report = await autoGenerateReport(schedule.clientId, schedule.frequency);
    
    // Link report to schedule
    await prisma.seoReport.update({
      where: { id: report.id },
      data: { scheduleId: schedule.id }
    });

    // Send email to recipients (stored as JSON string)
    const recipients: string[] = (() => {
      if (!schedule.recipients) return [];
      try {
        const parsed = JSON.parse(String(schedule.recipients));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })();
    if (recipients && recipients.length > 0) {
      const emailHtml = generateReportEmailHTML(report, schedule.client);
      const emailSubject = schedule.emailSubject || `SEO Report - ${schedule.client.name} - ${schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1)}`;

      const emailPromises = recipients.map((email: string) =>
        sendEmail({
          to: email,
          subject: emailSubject,
          html: emailHtml
        })
      );

      await Promise.all(emailPromises);

      // Update report status
      await prisma.seoReport.update({
        where: { id: report.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          recipients: JSON.stringify(recipients),
          emailSubject
        }
      });

      res.json({ 
        message: "Report generated and sent successfully",
        report,
        recipients
      });
    } else {
      res.json({ 
        message: "Report generated successfully, but no recipients configured",
        report
      });
    }
  } catch (error: any) {
    console.error("Trigger schedule error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

// Delete report schedule
router.delete("/reports/schedules/:scheduleId", authenticateToken, async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const schedule = await prisma.reportSchedule.findUnique({
      where: { id: scheduleId },
      include: {
        client: {
          include: {
            user: {
              include: {
                memberships: {
                  select: { agencyId: true }
                }
              }
            }
          }
        }
      }
    });

    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = schedule.client.user.memberships.map(m => m.agencyId);
    const hasAgencyAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    
    if (!hasAgencyAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Find any reports linked to this schedule BEFORE deleting
    const linkedReports = await prisma.seoReport.findMany({
      where: { scheduleId: scheduleId }
    });

    // Update linked reports BEFORE deleting the schedule
    // If status was "scheduled", change to "draft" and clear scheduleId
    if (linkedReports.length > 0) {
      for (const report of linkedReports) {
        // Only update if status is "scheduled" (don't change "sent" reports)
        if (report.status === "scheduled") {
          await prisma.seoReport.update({
            where: { id: report.id },
            data: {
              status: "draft",
              scheduleId: null // Clear the schedule reference
            }
          });
        } else {
          // Even if status is not "scheduled", clear the scheduleId reference
          await prisma.seoReport.update({
            where: { id: report.id },
            data: {
              scheduleId: null
            }
          });
        }
      }
    }

    // Now delete the schedule (Prisma will handle onDelete: SetNull, but we've already updated)
    await prisma.reportSchedule.delete({
      where: { id: scheduleId }
    });

    res.json({ 
      message: "Schedule deleted successfully",
      updatedReports: linkedReports.length
    });
  } catch (error) {
    console.error("Delete report schedule error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Send report via email
router.post("/reports/:reportId/send", authenticateToken, async (req, res) => {
  try {
    const { reportId } = req.params;
    const { recipients, emailSubject } = req.body;

    const report = await prisma.seoReport.findUnique({
      where: { id: reportId },
      include: {
        client: {
          include: {
            user: {
              include: {
                memberships: {
                  select: { agencyId: true }
                }
              }
            }
          }
        },
        schedule: {
          select: {
            recipients: true,
            emailSubject: true,
          }
        }
      }
    });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = report.client.user.memberships.map(m => m.agencyId);
    const hasAgencyAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    
    if (!hasAgencyAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const parseRecipientsField = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      if (value == null) return [];
      const raw = String(value).trim();
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
        }
      } catch {
        // ignore
      }
      if (raw.includes(",")) return raw.split(",").map((s) => s.trim()).filter(Boolean);
      return [raw];
    };

    const recipientsList: string[] =
      Array.isArray(recipients) && recipients.length > 0
        ? parseRecipientsField(recipients)
        : (() => {
            const fromReport = parseRecipientsField(report.recipients);
            if (fromReport.length > 0) return fromReport;
            return parseRecipientsField(report.schedule?.recipients);
          })();
    if (!recipientsList || recipientsList.length === 0) {
      return res.status(400).json({ message: "No recipients specified" });
    }

    // Generate email HTML and PDF
    const {
      generateReportEmailHTML,
      generateReportPDFBuffer,
      getReportTargetKeywords,
      buildShareDashboardUrl,
    } = await import("../lib/reportScheduler.js");

    const shareUrl = (() => {
      try {
        return buildShareDashboardUrl(report.clientId);
      } catch {
        return null;
      }
    })();
    const targetKeywords = await getReportTargetKeywords(report.clientId).catch(() => []);

    const emailHtml = generateReportEmailHTML(report, report.client, { targetKeywords, shareUrl });
    const pdfBuffer = await generateReportPDFBuffer(report, report.client, { targetKeywords, shareUrl });

    // Send emails with PDF attachment
    const { sendEmail } = await import("../lib/email.js");
    const emailPromises = recipientsList.map((email: string) =>
      sendEmail({
        to: email,
        subject:
          emailSubject ||
          report.schedule?.emailSubject ||
          `SEO Report - ${report.client.name} - ${report.period.charAt(0).toUpperCase() + report.period.slice(1)}`,
        html: emailHtml,
        attachments: [
          {
            filename: `seo-report-${report.client.name.replace(/\s+/g, '-').toLowerCase()}-${report.period}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ]
      })
    );

    await Promise.all(emailPromises);

    // Update report status
    await prisma.seoReport.update({
      where: { id: reportId },
      data: {
        status: "sent",
        sentAt: new Date(),
        recipients: JSON.stringify(recipientsList),
        emailSubject:
          emailSubject ||
          report.schedule?.emailSubject ||
          `SEO Report - ${report.client.name} - ${report.period.charAt(0).toUpperCase() + report.period.slice(1)}`
      }
    });

    res.json({ 
      message: "Report sent successfully",
      recipients: recipientsList
    });
  } catch (error: any) {
    console.error("Send report error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

// Delete report
router.delete("/reports/:reportId", authenticateToken, async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await prisma.seoReport.findUnique({
      where: { id: reportId },
      include: {
        client: {
          include: {
            user: {
              include: {
                memberships: {
                  select: { agencyId: true }
                }
              }
            }
          }
        }
      }
    });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = report.client.user.memberships.map(m => m.agencyId);
    const hasAgencyAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    
    if (!hasAgencyAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    await prisma.seoReport.delete({
      where: { id: reportId }
    });

    res.json({ message: "Report deleted successfully" });
  } catch (error: any) {
    console.error("Delete report error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});


// Fetch historical rank overview from DataForSEO
// Using the Historical Rank Overview endpoint: POST /v3/dataforseo_labs/google/historical_rank_overview/live
// Returns historical data showing total keywords ranked over time
async function fetchHistoricalRankOverviewFromDataForSEO(
  domain: string,
  locationCode: number = 2840,
  languageCode: string = "en",
  dateFromOverride?: string,
  dateToOverride?: string
) {
  const base64Auth = process.env.DATAFORSEO_BASE64;

  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  // Normalize domain (remove protocol, www, trailing slashes)
  const normalizeDomain = (domain: string) => {
    return domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "")
      .toLowerCase();
  };

  const normalizedDomain = normalizeDomain(domain);

  // Use override range (e.g. current month only) or default to last 12 months
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11 (0 = January, 11 = December)
  
  let dateFrom: string;
  let dateTo: string;
  if (dateFromOverride && dateToOverride) {
    dateFrom = dateFromOverride;
    dateTo = dateToOverride;
    console.log(`Requesting historical data from ${dateFrom} to ${dateTo} (custom range)`);
  } else {
    const twelveMonthsAgo = new Date(currentYear, currentMonth - 11, 1);
    dateTo = now.toISOString().split('T')[0];
    dateFrom = twelveMonthsAgo.toISOString().split('T')[0];
    console.log(`Requesting historical data from ${dateFrom} to ${dateTo} (12 months)`);
  }

  try {
    const endpoint = "https://api.dataforseo.com/v3/dataforseo_labs/google/historical_rank_overview/live";

    const doRequest = async (body: any) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${base64Auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
      }
      return await response.json();
    };

    // Fetch one date range and return items array; retry without date_to if API rejects it.
    const fetchOneChunk = async (chunkDateFrom: string, chunkDateTo: string): Promise<any[]> => {
      let body: any[] = [{
        target: normalizedDomain,
        location_code: locationCode,
        language_code: languageCode,
        date_from: chunkDateFrom,
        date_to: chunkDateTo,
        correlate: true,
      }];
      let data = await doRequest(body);
      const task0 = data?.tasks?.[0];
      const statusMessage = String(task0?.status_message || "");
      if (task0?.status_code === 40501 && /Invalid Field:\s*'date_to'\./i.test(statusMessage)) {
        console.warn("[DataForSEO] historical_rank_overview: retrying without date_to (API rejected date_to)");
        body = [{
          target: normalizedDomain,
          location_code: locationCode,
          language_code: languageCode,
          date_from: chunkDateFrom,
          correlate: true,
        }];
        data = await doRequest(body);
      }
      const result = data?.tasks?.[0]?.result?.[0];
      if (!result) return [];
      if (result.items && Array.isArray(result.items)) return result.items;
      if (result.historical_data && Array.isArray(result.historical_data)) return result.historical_data;
      if (result.data && Array.isArray(result.data)) return result.data;
      if (Array.isArray(result)) return result;
      return [];
    };

    let historicalData: any[] = [];

    if (dateFromOverride && dateToOverride) {
      // Single request (e.g. current month only for dashboard refresh)
      historicalData = await fetchOneChunk(dateFrom, dateTo);
      console.log(`[DataForSEO] historical_rank_overview: single range returned ${historicalData.length} items`);
    } else {
      // 12-month range: request in two 6-month chunks so we get up to 12 months (API may limit per-request)
      const twelveMonthsAgo = new Date(currentYear, currentMonth - 11, 1);
      const sixMonthsAgo = new Date(currentYear, currentMonth - 5, 1);
      const lastDayFirstChunk = new Date(sixMonthsAgo.getFullYear(), sixMonthsAgo.getMonth(), 0);
      const dateFrom1 = twelveMonthsAgo.toISOString().split("T")[0];
      const dateTo1 = lastDayFirstChunk.toISOString().split("T")[0];
      const dateFrom2 = sixMonthsAgo.toISOString().split("T")[0];
      const dateTo2 = now.toISOString().split("T")[0];
      console.log(`[DataForSEO] historical_rank_overview: requesting two chunks: ${dateFrom1}–${dateTo1} and ${dateFrom2}–${dateTo2}`);
      const [items1, items2] = await Promise.all([
        fetchOneChunk(dateFrom1, dateTo1),
        fetchOneChunk(dateFrom2, dateTo2),
      ]);
      const byKey = new Map<string, any>();
      const addItems = (items: any[]) => {
        (items || []).forEach((item: any) => {
          const y = item.year != null ? Number(item.year) : new Date(item.date || 0).getFullYear();
          const m = item.month != null ? Number(item.month) : new Date(item.date || 0).getMonth() + 1;
          const key = `${y}-${String(m).padStart(2, "0")}`;
          if (!byKey.has(key)) byKey.set(key, item);
        });
      };
      addItems(items1);
      addItems(items2);
      historicalData = Array.from(byKey.values());
      console.log(`[DataForSEO] historical_rank_overview: merged ${items1.length} + ${items2.length} → ${historicalData.length} unique months`);
    }

    console.log(`Found ${historicalData.length} historical data items in API response`);

    if (historicalData.length === 0) {
      console.warn("No historical data items found in API response.");
      return [];
    }
    
    // Log first few items structure to understand the format
    if (historicalData.length > 0) {
      console.log("First item structure:", JSON.stringify(historicalData[0], null, 2));
      if (historicalData.length > 1) {
        console.log("Second item structure:", JSON.stringify(historicalData[1], null, 2));
      }
    }
    
    // Format the data for our use
    // Based on the API response structure:
    // - items[] contains objects with year, month, and metrics.organic.count
    // - year and month are direct fields (e.g., { year: 2021, month: 3 })
    // - Total keywords is in metrics.organic.count
    const formattedData = historicalData.map((item: any, index: number) => {
      let date: Date;
      let month: number;
      let year: number;
      
      // Primary: Use year and month fields directly (this is how the API returns it)
      if (item.year !== undefined && item.month !== undefined) {
        year = parseInt(item.year);
        month = parseInt(item.month);
        // Create date from year and month (first day of the month)
        date = new Date(year, month - 1, 1); // month is 0-indexed in Date constructor
      } else {
        // Fallback: Try to extract from date string
        let dateStr: string | null = null;
        
        // Try various date field formats
        if (item.date) {
          dateStr = item.date;
        } else if (item.date_from) {
          dateStr = item.date_from;
        } else if (item.date_to) {
          dateStr = item.date_to;
        } else if (item.datetime) {
          dateStr = item.datetime;
        } else if (item.date_time) {
          dateStr = item.date_time;
        }
        
        // If we have a timestamp (Unix timestamp in seconds)
        if (!dateStr && item.timestamp) {
          const timestamp = typeof item.timestamp === 'number' 
            ? (item.timestamp.toString().length === 10 ? item.timestamp * 1000 : item.timestamp)
            : parseInt(item.timestamp) * 1000;
          date = new Date(timestamp);
          dateStr = date.toISOString().split('T')[0];
        }
        
        // Parse the date string
        if (dateStr) {
          // Handle different date string formats
          if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
            date = new Date(dateStr);
          } else {
            date = new Date(dateStr);
          }
          
          // Validate the date
          if (isNaN(date.getTime())) {
            console.warn(`Invalid date for item ${index}: ${dateStr}, using current date`);
            date = new Date();
          }
          
          year = date.getFullYear();
          month = date.getMonth() + 1; // Convert from 0-indexed to 1-indexed
        } else {
          console.warn(`No date/year/month found for item ${index}, using current date`);
          date = new Date();
          year = date.getFullYear();
          month = date.getMonth() + 1;
        }
      }
      
      // Extract total keywords count
      // Based on the API response: metrics.organic.count contains the total keywords ranked
      // Example: "metrics": { "organic": { "count": 1499, ... } }
      let totalKeywords = 0;
      
      // Primary method: Extract from metrics.organic.count (this is the correct field)
      if (item.metrics && item.metrics.organic && typeof item.metrics.organic.count === 'number') {
        totalKeywords = item.metrics.organic.count;
      } else if (item.metrics && item.metrics.organic && typeof item.metrics.organic.organic_count === 'number') {
        totalKeywords = item.metrics.organic.organic_count;
      }
      
      // Fallback 1: Try direct metrics.count
      if (totalKeywords === 0 && item.metrics) {
        if (typeof item.metrics.count === 'number') {
          totalKeywords = item.metrics.count;
        } else if (typeof item.metrics.total_count === 'number') {
          totalKeywords = item.metrics.total_count;
        }
      }
      
      // Fallback 2: Calculate from position distribution (if count is not available)
      // Note: The API response shows position fields like pos_1, pos_2_3, pos_4_10, etc.
      // But these are not additive - they represent different position ranges
      // The count field is the actual total, so we prioritize that
      if (totalKeywords === 0 && item.metrics && item.metrics.organic) {
        const organic = item.metrics.organic;
        // If we have position data, we could try to sum them, but count is more reliable
        // The API provides count directly, so this fallback is rarely needed
        console.warn(`No count found in metrics.organic for item ${index}, attempting to calculate from positions`);
      }
      
      // Fallback 3: Try direct fields on item
      if (totalKeywords === 0) {
        if (typeof item.count === 'number') {
          totalKeywords = item.count;
        } else if (typeof item.total_count === 'number') {
          totalKeywords = item.total_count;
        } else if (item.organic && typeof item.organic.count === 'number') {
          totalKeywords = item.organic.count;
        }
      }

      // Position distribution → our chart buckets.
      // Buckets requested:
      // 1–3 (Top 3), 4–10 (Top 10), 11–20 (Page 2), 21–30, 31–50, 51+
      const organic = item?.metrics?.organic || {};
      const n = (v: any) => (typeof v === "number" && Number.isFinite(v) ? Number(v) : Number(v ?? 0) || 0);

      const pos1 = n(organic.pos_1);
      const pos2_3 = n(organic.pos_2_3);
      const pos4_10 = n(organic.pos_4_10);
      const pos11_20 = n(organic.pos_11_20);
      const pos21_30 = n(organic.pos_21_30);
      const pos31_40 = n(organic.pos_31_40);
      const pos41_50 = n(organic.pos_41_50);
      const pos51_60 = n(organic.pos_51_60);
      const pos61_70 = n(organic.pos_61_70);
      const pos71_80 = n(organic.pos_71_80);
      const pos81_90 = n(organic.pos_81_90);
      const pos91_100 = n(organic.pos_91_100);
      const pos101Plus = n(organic.pos_101_plus ?? organic.pos_101Plus ?? organic.pos_101);

      const top3 = pos1 + pos2_3;
      const top10 = pos4_10;
      const page2 = pos11_20;
      const pos31_50 = pos31_40 + pos41_50;
      const pos51PlusDetailed = pos51_60 + pos61_70 + pos71_80 + pos81_90 + pos91_100 + pos101Plus;

      const knownSum = top3 + top10 + page2 + pos21_30 + pos31_50;
      const remainder = Math.max(0, Number(totalKeywords || 0) - knownSum);
      const pos51Plus = pos51PlusDetailed > 0 ? pos51PlusDetailed : remainder;

      const formatted = {
        date: `${year}-${String(month).padStart(2, '0')}-01`, // Format as YYYY-MM-DD
        month: month, // 1-12
        year: year,
        totalKeywords: Number(totalKeywords), // Ensure it's a number
        top3,
        top10,
        page2,
        pos21_30,
        pos31_50,
        pos51Plus,
        rawData: item // Keep raw data for debugging
      };
      
      console.log(`Item ${index}:`, {
        year: formatted.year,
        month: formatted.month,
        date: formatted.date,
        totalKeywords: formatted.totalKeywords,
        hasMetrics: !!item.metrics,
        hasOrganicCount: !!(item.metrics && item.metrics.organic && item.metrics.organic.count)
      });

      return formatted;
    }).filter((item: any) => {
      // Filter out invalid entries (NaN or null totalKeywords)
      // Note: 0 is a valid value (means domain ranked for 0 keywords that month)
      const isValid = !isNaN(item.totalKeywords) && item.totalKeywords !== null && item.totalKeywords !== undefined;
      if (!isValid) {
        console.warn("Filtered out invalid item:", item);
      }
      return isValid;
    });

    console.log(`Formatted ${formattedData.length} valid data points`);

    // Sort by date to ensure chronological order
    formattedData.sort((a: any, b: any) => {
      const dateA = new Date(a.year, a.month - 1, 1);
      const dateB = new Date(b.year, b.month - 1, 1);
      return dateA.getTime() - dateB.getTime();
    });

    return formattedData;
  } catch (error: any) {
    console.error("DataForSEO Historical Rank Overview API error:", error);
    console.error("Error details:", error.message);
    throw error;
  }
}

// Fetch total ranked keywords for a client domain from DataForSEO
// Using the Ranked Keywords endpoint: POST /v3/dataforseo_labs/google/ranked_keywords/live
// Returns total_count which is the total number of keywords the domain ranks for
async function fetchRankedKeywordsFromDataForSEO(
  domain: string,
  locationCode: number = 2840,
  languageCode: string = "en"
) {
  const base64Auth = process.env.DATAFORSEO_BASE64;

  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  // Normalize domain (remove protocol, www, trailing slashes)
  const normalizeDomain = (domain: string) => {
    return domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "")
      .toLowerCase();
  };

  const normalizedDomain = normalizeDomain(domain);

  // Request body according to DataForSEO API documentation
  // Using location_code and language_code (can also use location_name and language_name)
  // limit is optional - we set it to 10 since we only need total_count, not the full list
  const requestBody = [{
    target: normalizedDomain,
    location_code: locationCode, // 2840 = United States
    language_code: languageCode, // "en" = English
    limit: 10 // We only need total_count, not the full keyword list
  }];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${base64Auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Parse the response structure according to DataForSEO API documentation
    // The total is returned in: result[0].total_count
    if (data.tasks && data.tasks.length > 0 && data.tasks[0].result && data.tasks[0].result.length > 0) {
      const result = data.tasks[0].result[0];
      // total_count is the total number of keywords in the database relevant to the task
      // (i.e., keywords the target ranks for in the requested location/language)
      const totalCount = result?.total_count || 0;

      return {
        totalKeywords: totalCount,
        items: result?.items || [],
        rawData: result
      };
    }

    return {
      totalKeywords: 0,
      items: [],
      rawData: null
    };
  } catch (error: any) {
    console.error("DataForSEO Ranked Keywords API error:", error);
    throw error;
  }
}

// Fetch keywords for site from DataForSEO API
async function fetchKeywordsForSiteFromDataForSEO(
  target: string,
  limit: number = 100,
  locationCode: number = 2840,
  languageName: string = "English"
) {
  const base64Auth = process.env.DATAFORSEO_BASE64;

  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  // Normalize domain (remove protocol, www, trailing slashes)
  const normalizeDomain = (domain: string) => {
    return domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "")
      .toLowerCase();
  };

  const normalizedTarget = normalizeDomain(target);

  const requestBody = [
    {
      target: normalizedTarget,
      location_code: locationCode,
      language_name: languageName,
      limit,
      include_serp_info: true, // Include SERP data for ranking and URL information
    },
  ];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/keywords_for_site/live", {
      method: "POST",
      headers: {
        Authorization: `Basic ${base64Auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const rawBody = await response.text();
    let data: any;
    try {
      data = JSON.parse(rawBody);
    } catch {
      data = {};
    }

    if (!response.ok) {
      const taskMsg = data?.tasks?.[0]?.status_message;
      console.warn(
        "[DataForSEO keywords_for_site] API returned",
        response.status,
        "-",
        taskMsg || "unknown",
        "target:",
        normalizedTarget
      );
      return [];
    }

    const task = data?.tasks?.[0];
    const taskStatusCode = task?.status_code;
    const result0 = task?.result?.[0];
    if (data?.tasks_error === 1 || taskStatusCode === 50000 || result0 == null) {
      const taskMsg = task?.status_message || "No data returned";
      console.warn(
        "[DataForSEO keywords_for_site] Task error:",
        taskMsg,
        "target:",
        normalizedTarget,
        "status_code:",
        taskStatusCode
      );
      return [];
    }

    const rawItems = result0?.items;
    const items: any[] = Array.isArray(rawItems) ? rawItems : [];

    return items.map((item) => {
      const keywordInfo = item?.keyword_info || {};
      const serpInfo = item?.serp_info || null;
      
      // Extract SERP features/types
      const serpItemTypes = serpInfo?.serp_item_types || [];
      
      // Extract ranking URL from SERP info (first organic result)
      let googleUrl = null;
      let googlePosition = null;
      
      if (serpInfo) {
        // Most reliable: rank_* is often provided directly in serp_info
        const directRank =
          (serpInfo as any).rank_group ??
          (serpInfo as any).rank_absolute ??
          (serpInfo as any)?.rank_info?.rank_group ??
          (serpInfo as any)?.rank_info?.rank_absolute ??
          null;
        if (typeof directRank === "number" && Number.isFinite(directRank) && directRank > 0) {
          googlePosition = directRank;
        }

        // SERP info may have items array with organic results
        if (serpInfo.items && Array.isArray(serpInfo.items)) {
          // Find first organic result for the target domain
          const organicResult = serpInfo.items.find((result: any) => {
            if (result.type === "organic" && result.url) {
              const resultUrl = result.url.toLowerCase();
              const targetLower = normalizedTarget.toLowerCase();
              return resultUrl.includes(targetLower);
            }
            return false;
          });
          
          if (organicResult) {
            googleUrl = onlyRankingWebsiteUrl(organicResult.url) || null;
            if (googlePosition == null) {
              googlePosition = organicResult.rank_group || organicResult.rank_absolute || null;
            }
          }
        }
        
        // Alternative: check if serpInfo has direct URL reference (must not be a Google SERP URL)
        if (!googleUrl && serpInfo.relevant_url) {
          googleUrl = onlyRankingWebsiteUrl(serpInfo.relevant_url) || null;
        }
      }
      
      return {
        keyword: item?.keyword || "",
        searchVolume: keywordInfo?.search_volume ? Number(keywordInfo.search_volume) : null,
        cpc: keywordInfo?.cpc ? Number(keywordInfo.cpc) : null,
        competition: keywordInfo?.competition_level || keywordInfo?.competition || null,
        competitionValue: keywordInfo?.competition ? Number(keywordInfo.competition) : null,
        monthlySearches: keywordInfo?.monthly_searches || null,
        keywordInfo: item || null,
        locationCode: item?.location_code || locationCode,
        languageCode: item?.language_code || null,
        serpInfo: serpInfo,
        serpItemTypes: serpItemTypes,
        googleUrl: googleUrl,
        googlePosition: googlePosition,
        seResultsCount: serpInfo?.se_results_count ? String(serpInfo.se_results_count) : null,
      };
    });
  } catch (error: any) {
    console.error("DataForSEO Keywords for Site API error:", error);
    throw error;
  }
}

// Fetch ranked keywords for a specific page URL from DataForSEO
async function fetchRankedKeywordsForPageFromDataForSEO(
  target: string,
  pageUrl: string,
  locationCode: number = 2840,
  languageName: string = "English",
  limit: number = 100
) {
  const base64Auth = process.env.DATAFORSEO_BASE64;

  if (!base64Auth) {
    throw new Error("DataForSEO credentials not configured. Please set DATAFORSEO_BASE64 environment variable.");
  }

  // Normalize domain (remove protocol, www, trailing slashes)
  const normalizeDomain = (domain: string) => {
    return domain
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "")
      .toLowerCase();
  };

  const normalizedTarget = normalizeDomain(target);

  // Extract relative URL path from the full URL
  // Example: "https://www.abchamber.ca/wp-content/uploads/2022/04/Extension-of-Hours-at-the-Port-of-Wildhorse.pdf"
  // Should become: "/wp-content/uploads/2022/04/Extension-of-Hours-at-the-Port-of-Wildhorse.pdf"
  let relativeUrl = pageUrl;
  try {
    const urlObj = new URL(pageUrl);
    relativeUrl = urlObj.pathname;
  } catch (e) {
    // If pageUrl is not a full URL, assume it's already a relative path
    if (!pageUrl.startsWith("/")) {
      relativeUrl = "/" + pageUrl;
    }
  }

  const requestBody = [
    {
      target: normalizedTarget,
      location_code: locationCode,
      language_name: languageName,
      limit: limit,
      filters: [
        "ranked_serp_element.serp_item.relative_url",
        "=",
        relativeUrl
      ]
    },
  ];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live", {
      method: "POST",
      headers: {
        Authorization: `Basic ${base64Auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Parse the response structure
    if (data?.tasks && data.tasks.length > 0 && data.tasks[0].result && data.tasks[0].result.length > 0) {
      const result = data.tasks[0].result[0];
      const items: any[] = result?.items || [];

      // Map items to our format
      return items.map((item) => {
        const keywordData = item?.keyword_data || {};
        const keywordInfo = keywordData?.keyword_info || {};
        const rankedSerpElement = item?.ranked_serp_element || {};
        const serpItem = rankedSerpElement?.serp_item || {};
        const rankChanges = serpItem?.rank_changes || {};

        return {
          keyword: keywordData?.keyword || "",
          currentPosition: serpItem?.rank_absolute || serpItem?.rank_group || null,
          previousPosition: rankChanges?.previous_rank_absolute || null,
          searchVolume: keywordInfo?.search_volume ? Number(keywordInfo.search_volume) : null,
          isNew: rankChanges?.is_new || false,
          isUp: rankChanges?.is_up || false,
          isDown: rankChanges?.is_down || false,
          isLost: rankedSerpElement?.is_lost || false,
          etv: serpItem?.etv ? Number(serpItem.etv) : null,
          keywordDifficulty: keywordData?.keyword_properties?.keyword_difficulty || null,
          cpc: keywordInfo?.cpc ? Number(keywordInfo.cpc) : null,
          competition: keywordInfo?.competition_level || null,
          url: serpItem?.url || null,
          title: serpItem?.title || null,
          description: serpItem?.description || null,
        };
      });
    }

    return [];
  } catch (error: any) {
    console.error("DataForSEO Ranked Keywords for Page API error:", error);
    throw error;
  }
}

// Get ranked keywords for a client (read from DB only)
router.get("/ranked-keywords/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    // Read from database only - no API calls for agency users
    const currentData = await prisma.rankedKeywordsHistory.findUnique({
      where: {
        clientId_month_year: {
          clientId,
          month: currentMonth,
          year: currentYear
        }
      }
    });

    // Get last month data for comparison
    const lastMonthData = await prisma.rankedKeywordsHistory.findUnique({
      where: {
        clientId_month_year: {
          clientId,
          month: lastMonth,
          year: lastMonthYear
        }
      }
    });

    // Calculate change
    const change = currentData 
      ? (lastMonthData ? currentData.totalKeywords - lastMonthData.totalKeywords : null)
      : null;

    res.json({
      current: currentData ? {
        totalKeywords: currentData.totalKeywords,
        month: currentData.month,
        year: currentData.year,
        updatedAt: currentData.updatedAt
      } : null,
      previous: lastMonthData ? {
        totalKeywords: lastMonthData.totalKeywords,
        month: lastMonthData.month,
        year: lastMonthData.year
      } : null,
      change: change,
      changePercent: change !== null && lastMonthData && lastMonthData.totalKeywords > 0
        ? ((change / lastMonthData.totalKeywords) * 100).toFixed(1)
        : null
    });
  } catch (error: any) {
    console.error("Get ranked keywords error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get ranked keywords history for a client (for chart display)
// Uses DataForSEO Historical Rank Overview API to get past 12 months of data
router.get("/ranked-keywords/:clientId/history", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Read from database only - no API calls for agency users
    // Get all historical data from database
    let allHistory: any[] = [];
    try {
      allHistory = await prisma.rankedKeywordsHistory.findMany({
        where: { clientId },
        orderBy: [{ year: "asc" }, { month: "asc" }],
        select: {
          month: true,
          year: true,
          totalKeywords: true,
          top3: true,
          top10: true,
          page2: true,
          pos21_30: true,
          pos31_50: true,
          pos51Plus: true,
        } as any,
      });
    } catch (error: any) {
      // Backwards-compatible fallback for DBs that haven't been migrated yet
      if (error?.code === "P2022") {
        allHistory = await prisma.rankedKeywordsHistory.findMany({
          where: { clientId },
          orderBy: [{ year: "asc" }, { month: "asc" }],
          select: { month: true, year: true, totalKeywords: true },
        });
      } else {
        throw error;
      }
    }

    console.log(`Found ${allHistory.length} months in database`);

    // Create complete 12-month dataset from database data
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    const dbMonthlyData: Record<
      string,
      {
        month: number;
        year: number;
        totalKeywords: number;
        top3: number;
        top10: number;
        page2: number;
        pos21_30: number;
        pos31_50: number;
        pos51Plus: number;
        date: string;
      }
    > = {};
    allHistory.forEach((item) => {
      const key = `${item.year}-${String(item.month).padStart(2, '0')}`;
      const total = Number(item.totalKeywords || 0);
      const top3 = Number(item.top3 || 0);
      const top10 = Number(item.top10 || 0);
      const page2 = Number(item.page2 || 0);
      const pos21_30 = Number(item.pos21_30 || 0);
      const pos31_50 = Number(item.pos31_50 || 0);
      const knownSum = top3 + top10 + page2 + pos21_30 + pos31_50;
      const pos51Plus = Number(item.pos51Plus || 0) || Math.max(0, total - knownSum);
      dbMonthlyData[key] = {
        month: item.month,
        year: item.year,
        totalKeywords: total,
        top3,
        top10,
        page2,
        pos21_30,
        pos31_50,
        pos51Plus,
        date: `${item.year}-${String(item.month).padStart(2, '0')}-01`
      };
    });

    const completeData: Array<{
      month: number;
      year: number;
      totalKeywords: number;
      top3: number;
      top10: number;
      page2: number;
      pos21_30: number;
      pos31_50: number;
      pos51Plus: number;
      date: string;
    }> = [];
    
    // Generate all 12 months, filling with database data or 0
    for (let i = 11; i >= 0; i--) {
      const targetDate = new Date(currentYear, currentMonth - 1 - i, 1);
      const targetYear = targetDate.getFullYear();
      const targetMonth = targetDate.getMonth() + 1;
      const key = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
      
      const existingData = dbMonthlyData[key];
      if (existingData) {
        completeData.push(existingData);
      } else {
        // Fill missing months with 0
        completeData.push({
          month: targetMonth,
          year: targetYear,
          totalKeywords: 0,
          top3: 0,
          top10: 0,
          page2: 0,
          pos21_30: 0,
          pos31_50: 0,
          pos51Plus: 0,
          date: `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
        });
      }
    }

    console.log(`Returning ${completeData.length} months (${completeData.filter(d => d.totalKeywords > 0).length} with data)`);
    res.json(completeData);
  } catch (error: any) {
    console.error("Get ranked keywords history error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh ranked keywords history from DataForSEO (SUPER_ADMIN only).
// Fetches 12 months of data: total keywords per month + position breakdown (1-3, 4-10, 11-20, 21-30, 31-50, 51+) from Historical Rank Overview API only.
router.post("/ranked-keywords/:clientId/history/refresh", authenticateToken, async (req, res) => {
  try {
    // Only SUPER_ADMIN can refresh data
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only Super Admin can refresh data." });
    }

    const { clientId } = req.params;
    const force = String((req.query as any)?.force || "").toLowerCase() === "true";
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client || !client.domain) {
      return res.status(404).json({ message: "Client not found or has no domain" });
    }

    // Throttle DataForSEO refreshes to avoid repeated charges (48h), unless force=true.
    const latest = await prisma.rankedKeywordsHistory.findFirst({
      where: { clientId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    const lastRefreshedAt = latest?.updatedAt ?? null;
    const nextAllowedAt = lastRefreshedAt ? new Date(lastRefreshedAt.getTime() + DATAFORSEO_REFRESH_TTL_MS) : null;
    if (!force && isFresh(lastRefreshedAt, DATAFORSEO_REFRESH_TTL_MS)) {
      return res.json({
        skipped: true,
        message: "Using cached ranked keywords history (refresh limited to every 48 hours).",
        lastRefreshedAt,
        nextAllowedAt,
      });
    }

    // Fetch historical data from DataForSEO Historical Rank Overview API (may return 0..12 months)
    let historicalData: any[] = [];
    try {
      console.log(`Fetching historical data for domain: ${client.domain}`);
      historicalData = await fetchHistoricalRankOverviewFromDataForSEO(
        client.domain,
        2840, // Default to US
        "en" // Default to English
      );
      console.log(`Received ${historicalData.length} data points from API`);
    } catch (apiErr: any) {
      console.warn("Historical rank overview API failed, will keep/use existing DB data:", apiErr?.message || apiErr);
    }

    // Group by month and year (when we have API data)
    const monthlyData: Record<
        string,
        {
          month: number;
          year: number;
          totalKeywords: number;
          top3?: number;
          top10?: number;
          page2?: number;
          pos21_30?: number;
          pos31_50?: number;
          pos51Plus?: number;
          date: string;
        }
      > = {};
      
      historicalData.forEach((item: any) => {
        // Create unique key for each month-year combination
        const monthStr = item.month < 10 ? `0${item.month}` : `${item.month}`;
        const key = `${item.year}-${monthStr}`;
        // If we already have data for this month, take the one with the latest date
        if (!monthlyData[key] || new Date(item.date) > new Date(monthlyData[key].date)) {
          monthlyData[key] = {
            month: item.month,
            year: item.year,
            totalKeywords: item.totalKeywords,
            top3: item.top3 ?? 0,
            top10: item.top10 ?? 0,
            page2: item.page2 ?? 0,
            pos21_30: item.pos21_30 ?? 0,
            pos31_50: item.pos31_50 ?? 0,
            pos51Plus: item.pos51Plus ?? 0,
            date: item.date
          };
        }
      });

      console.log(`Grouped into ${Object.keys(monthlyData).length} unique months`);

      // Load existing history from DB so we don't overwrite months with zeros when API returns partial data
      const existingHistory = await prisma.rankedKeywordsHistory.findMany({
        where: { clientId },
        select: {
          month: true,
          year: true,
          totalKeywords: true,
          top3: true,
          top10: true,
          page2: true,
          pos21_30: true,
          pos31_50: true,
          pos51Plus: true,
        },
      });
      const existingByKey: Record<string, {
        month: number;
        year: number;
        totalKeywords: number;
        top3: number;
        top10: number;
        page2: number;
        pos21_30: number;
        pos31_50: number;
        pos51Plus: number;
        date: string;
      }> = {};
      existingHistory.forEach((row) => {
        const key = `${row.year}-${String(row.month).padStart(2, '0')}`;
        const total = Number(row.totalKeywords || 0);
        const top3 = Number(row.top3 ?? 0);
        const top10 = Number(row.top10 ?? 0);
        const page2 = Number(row.page2 ?? 0);
        const pos21_30 = Number(row.pos21_30 ?? 0);
        const pos31_50 = Number(row.pos31_50 ?? 0);
        const knownSum = top3 + top10 + page2 + pos21_30 + pos31_50;
        const pos51Plus = Number(row.pos51Plus ?? 0) || Math.max(0, total - knownSum);
        existingByKey[key] = {
          month: row.month,
          year: row.year,
          totalKeywords: total,
          top3,
          top10,
          page2,
          pos21_30,
          pos31_50,
          pos51Plus,
          date: `${row.year}-${String(row.month).padStart(2, '0')}-01`,
        };
      });

      // Create a complete 12-month dataset: prefer API data, then existing DB, then zeros
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1; // 1-12
      
      const completeData: Array<{
        month: number;
        year: number;
        totalKeywords: number;
        top3: number;
        top10: number;
        page2: number;
        pos21_30: number;
        pos31_50: number;
        pos51Plus: number;
        date: string;
      }> = [];
      
      for (let i = 11; i >= 0; i--) {
        const targetDate = new Date(currentYear, currentMonth - 1 - i, 1);
        const targetYear = targetDate.getFullYear();
        const targetMonth = targetDate.getMonth() + 1;
        const key = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
        
        const apiData = monthlyData[key];
        if (apiData) {
          const total = Number(apiData.totalKeywords || 0);
          const top3 = Number(apiData.top3 || 0);
          const top10 = Number(apiData.top10 || 0);
          const page2 = Number(apiData.page2 || 0);
          const pos21_30 = Number(apiData.pos21_30 || 0);
          const pos31_50 = Number(apiData.pos31_50 || 0);
          const knownSum = top3 + top10 + page2 + pos21_30 + pos31_50;
          const pos51Plus = Number(apiData.pos51Plus || 0) || Math.max(0, total - knownSum);
          completeData.push({
            month: apiData.month,
            year: apiData.year,
            totalKeywords: total,
            top3,
            top10,
            page2,
            pos21_30,
            pos31_50,
            pos51Plus,
            date: apiData.date,
          });
        } else {
          // No API data for this month: keep existing DB row if any, else zeros
          const existing = existingByKey[key];
          if (existing) {
            completeData.push(existing);
          } else {
            completeData.push({
              month: targetMonth,
              year: targetYear,
              totalKeywords: 0,
              top3: 0,
              top10: 0,
              page2: 0,
              pos21_30: 0,
              pos31_50: 0,
              pos51Plus: 0,
              date: `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`,
            });
          }
        }
      }

      // Save historical data to database
      await Promise.all(
        completeData.map((item) =>
          prisma.rankedKeywordsHistory.upsert({
            where: {
              clientId_month_year: {
                clientId,
                month: item.month,
                year: item.year,
              },
            },
            update: {
              totalKeywords: item.totalKeywords,
              top3: item.top3,
              top10: item.top10,
              page2: item.page2,
              pos21_30: item.pos21_30,
              pos31_50: item.pos31_50,
              pos51Plus: item.pos51Plus,
            } as any,
            create: {
              clientId,
              month: item.month,
              year: item.year,
              totalKeywords: item.totalKeywords,
              top3: item.top3,
              top10: item.top10,
              page2: item.page2,
              pos21_30: item.pos21_30,
              pos31_50: item.pos31_50,
              pos51Plus: item.pos51Plus,
            } as any,
          })
        )
      );

      console.log(`Historical data for ${client.domain}: ${completeData.length} months saved to database`);
      res.json({
        message: "Ranked keywords history refreshed successfully",
        months: completeData.length,
      });
  } catch (error: any) {
    console.error("Ranked keywords history refresh error:", error);
    res.status(500).json({
      message: "Failed to refresh historical data",
      error: error?.message ?? String(error),
    });
  }
});

router.get("/backlinks/:clientId/timeseries", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { range = "30" } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true },
            },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some((id) => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Read from database only
    const now = new Date();
    const rangeNumber = Number(range) || 30;
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - rangeNumber + 1);
    fromDate.setHours(0, 0, 0, 0);

    const timeseries = await prisma.backlinkTimeseries.findMany({
      where: {
        clientId,
        date: {
          gte: fromDate,
          lte: now,
        },
      },
      orderBy: { date: "desc" },
    });

    // Format response to match API structure
    const formatted = timeseries.map((item) => ({
      date: item.date.toISOString(),
      newBacklinks: item.newBacklinks,
      lostBacklinks: item.lostBacklinks,
      newReferringDomains: item.newReferringDomains,
      lostReferringDomains: item.lostReferringDomains,
      newReferringMainDomains: item.newReferringMainDomains,
      lostReferringMainDomains: item.lostReferringMainDomains,
      raw: item.rawData,
    }));

    res.json(formatted);
  } catch (error: any) {
    console.error("Backlink timeseries fetch error:", error);
    res.status(500).json({ message: "Failed to fetch backlink timeseries data" });
  }
});

// Get keywords ranking for a specific page/URL from DataForSEO
router.get("/top-pages/:clientId/keywords", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { url } = req.query;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "URL parameter is required" });
    }

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client || !client.domain) {
      return res.status(404).json({ message: "Client not found or has no domain" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Normalize domain (remove protocol, www, trailing slashes)
    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    const targetDomain = normalizeDomain(client.domain);

    // Fetch keywords from DataForSEO API
    const keywords = await fetchRankedKeywordsForPageFromDataForSEO(
      targetDomain,
      url,
      2840, // location_code for United States
      "English",
      100 // limit
    );

    res.json(keywords);
  } catch (error: any) {
    console.error("Get page keywords error:", error);
    res.status(500).json({ 
      message: error.message || "Internal server error",
      error: error.message 
    });
  }
});

router.get("/top-pages/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { limit = "10" } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true },
            },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    let hasAccess = isAdmin || isOwner || clientAgencyIds.some((id) => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Read from database only
    const topPages = await prisma.topPage.findMany({
      where: { clientId },
      orderBy: { organicEtv: "desc" },                  
      take: Number(limit) || 10,
    });                                                                                                                      

    // Format response to match API structure
    const formatted = topPages.map((page) => ({
      url: page.url,                                             
      organic: {
        pos1: page.organicPos1,
        pos2_3: page.organicPos2_3,                 
        pos4_10: page.organicPos4_10,                       
        count: page.organicCount,                                
        etv: page.organicEtv,
        isNew: page.organicIsNew,
        isUp: page.organicIsUp,
        isDown: page.organicIsDown,
        isLost: page.organicIsLost,
      },
      paid: {
        count: page.paidCount,
        etv: page.paidEtv,
      },
      raw: page.rawData,
    }));

    res.json(formatted);
  } catch (error: any) {
    console.error("Top pages fetch error:", error);
    res.status(500).json({ message: "Failed to fetch top pages data" });
  }
});

router.get("/traffic-sources/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { period = "30", start, end } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true },
            },
          },
        },
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    if (!client.domain) {
      return res.status(400).json({ message: "Client has no domain configured" });
    }

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    let hasAccess = isAdmin || clientAgencyIds.some((id) => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Calculate date range
    let startDate: Date;
    let endDate: Date;
    
    if (start && end) {
      startDate = new Date(start as string);
      endDate = new Date(end as string);
      if (endDate > new Date()) {
        endDate = new Date();
      }
      if (startDate > endDate) {
        return res.status(400).json({ message: "Start date must be before end date" });
      }
    } else {
      const days = parseInt(period as string);
      startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      endDate = new Date();
    }

    // Check if GA4 is connected and try to fetch from GA4
    const isGA4Connected = !!(
      client.ga4RefreshToken &&
      client.ga4PropertyId &&
      client.ga4ConnectedAt
    );

    if (isGA4Connected) {
      try {
        const { fetchGA4TrafficData } = await import("../lib/ga4.js");
        const ga4Data = await fetchGA4TrafficData(clientId, startDate, endDate);
        
        // Map GA4 sessions to traffic sources
        const breakdown = [];
        if (ga4Data.organicSessions > 0) {
          breakdown.push({ name: "Organic", value: ga4Data.organicSessions });
        }
        if (ga4Data.directSessions > 0) {
          breakdown.push({ name: "Direct", value: ga4Data.directSessions });
        }
        if (ga4Data.referralSessions > 0) {
          breakdown.push({ name: "Referral", value: ga4Data.referralSessions });
        }
        if (ga4Data.paidSessions > 0) {
          breakdown.push({ name: "Paid", value: ga4Data.paidSessions });
        }
        
        // Calculate other sessions (total - known sources)
        const knownSessions = ga4Data.organicSessions + ga4Data.directSessions + 
                              ga4Data.referralSessions + ga4Data.paidSessions;
        const otherSessions = ga4Data.totalSessions - knownSessions;
        if (otherSessions > 0) {
          breakdown.push({ name: "Other", value: otherSessions });
        }

        // Sort by value descending
        breakdown.sort((a, b) => b.value - a.value);

        return res.json({
          breakdown,
          totalKeywords: 0,
          totalEstimatedTraffic: ga4Data.totalSessions,
          organicEstimatedTraffic: ga4Data.organicSessions,
          averageRank: null,
          rankSampleSize: 0,
        });
      } catch (ga4Error: any) {
        console.error("[Traffic Sources] Failed to fetch from GA4, falling back to database:", ga4Error.message);
        // Fall through to database fallback
      }
    }

    // Fallback: Read from database
    const trafficSources = await prisma.trafficSource.findMany({
      where: { clientId },
      orderBy: { value: "desc" },
    });

    // Get aggregated metrics from first record (they should all have the same aggregated values)
    const firstSource = trafficSources[0];
    const breakdown = trafficSources.map((ts) => ({
      name: ts.name,
      value: ts.value,
    })).filter((item) => item.value > 0);

    // Return in the same format as the API
    res.json({
      breakdown,
      totalKeywords: firstSource?.totalKeywords || 0,
      totalEstimatedTraffic: firstSource?.totalEstimatedTraffic || 0,
      organicEstimatedTraffic: firstSource?.organicEstimatedTraffic || 0,
      averageRank: firstSource?.averageRank,
      rankSampleSize: firstSource?.rankSampleSize || 0,
    });
  } catch (error: any) {
    console.error("Traffic sources fetch error:", error);
    res.status(500).json({ message: "Failed to fetch traffic sources data" });
  }
});

router.get("/keyword-research", authenticateToken, async (req, res) => {
  try {
    const tierCtx = await getAgencyTierContext(req.user.userId, req.user.role);
    const creditCheck = hasResearchCredits(tierCtx, 1);
    if (!creditCheck.allowed) {
      return res.status(403).json({
        message: creditCheck.message,
        code: "TIER_LIMIT",
        limitType: "research_credits",
      });
    }

    const { keyword, limit = "50", locationCode = "2840", languageCode = "en" } = req.query;

    if (!keyword || typeof keyword !== "string" || keyword.trim().length === 0) {
      return res.status(400).json({ message: "Keyword query is required" });
    }

    const parsedLimit = Math.min(Math.max(Number(limit) || 50, 1), 1000);
    const parsedLocationCode = Number(locationCode) || 2840;
    const parsedLanguageCode = typeof languageCode === "string" ? languageCode : "en";
    const seed = keyword.trim();

    const isQuestion = (kw: string) =>
      kw.includes("?") || /^(who|what|where|when|why|how|can|is|are|do|does)\s/i.test((kw || "").trim());

    const MAX_VARIATIONS = 1000;
    const MAX_QUESTIONS = 1000;
    const MAX_RELATED = 1000;
    const [suggestions, variationsSuggestions, questionsFromApi, strategyItemsFromApi] = await Promise.all([
      fetchKeywordSuggestionsFromDataForSEO(seed, parsedLimit, parsedLocationCode, parsedLanguageCode),
      fetchKeywordVariationsFromDataForSEO(seed, MAX_VARIATIONS, parsedLocationCode, parsedLanguageCode),
      fetchQuestionKeywordsFromDataForSEO(seed, MAX_QUESTIONS, parsedLocationCode, parsedLanguageCode),
      fetchKeywordSuggestionsFromDataForSEO(seed, MAX_RELATED, parsedLocationCode, parsedLanguageCode),
    ]);

    let variations = variationsSuggestions.filter((r) => !isQuestion(r.keyword));

    if (variations.length < 20) {
      const relatedFallback = await fetchKeywordSuggestionsFromDataForSEO(seed, MAX_RELATED, parsedLocationCode, parsedLanguageCode);
      const seedLower = seed.toLowerCase().trim();
      const existingKws = new Set(variations.map((v) => v.keyword.toLowerCase()));
      const filtered = relatedFallback.filter((r) => {
        const kwLower = (r.keyword || "").toLowerCase();
        return kwLower.includes(seedLower) && !isQuestion(r.keyword) && !existingKws.has(kwLower);
      });
      variations = [...variations, ...filtered];
    }
    const questionsOnly = questionsFromApi.filter((r) => isQuestion(r.keyword));
    const seedLower = seed.toLowerCase().trim();
    const seedInStrategy = strategyItemsFromApi.find((r) => (r.keyword || "").toLowerCase().trim() === seedLower);
    const strategyItems = seedInStrategy
      ? [seedInStrategy, ...strategyItemsFromApi.filter((r) => (r.keyword || "").toLowerCase().trim() !== seedLower)]
      : strategyItemsFromApi;
    const strategy = { pillar: seed, items: strategyItems };

    if (tierCtx.agencyId) {
      const isFreeOnetime = tierCtx.tierConfig?.id === "free";
      await useResearchCredits(tierCtx.agencyId, 1, isFreeOnetime);
    }

    res.json({
      suggestions,
      variations,
      questions: questionsOnly,
      strategy,
    });
  } catch (error: any) {
    console.error("Keyword research fetch error:", error);
    res.status(500).json({ message: "Failed to fetch keyword research suggestions" });
  }
});

// Keyword detail for one keyword (Volume, KD, Global Volume, Intent, Trend, CPC, Competition) — Keyword Hub detail cards
router.get("/keyword-detail", authenticateToken, async (req, res) => {
  try {
    const { keyword, locationCode = "2840", languageCode = "en" } = req.query;
    if (!keyword || typeof keyword !== "string" || keyword.trim().length === 0) {
      return res.status(400).json({ message: "Keyword is required" });
    }
    const parsedLocationCode = Number(locationCode) || 2840;
    const parsedLanguageCode = typeof languageCode === "string" ? languageCode : "en";

    const { raw, item } = await fetchKeywordOverviewFromDataForSEO({
      keywords: [keyword.trim()],
      locationCode: parsedLocationCode,
      languageCode: parsedLanguageCode,
      includeSerpInfo: true,
      includeClickstreamData: false,
    });

    if (!item) {
      return res.status(200).json({ keyword: keyword.trim(), found: false, detail: null });
    }

    // DataForSEO keyword_overview/live: item.keyword_info, item.keyword_properties, item.search_intent_info
    const keywordInfo = item?.keyword_info || item?.keyword_data?.keyword_info || {};
    const keywordProps = item?.keyword_properties || item?.keyword_data?.keyword_properties || {};
    const rawMonthly = Array.isArray(keywordInfo?.monthly_searches) ? keywordInfo.monthly_searches : [];
    const searchVolume = Number(keywordInfo?.search_volume ?? 0);
    const keywordDifficultyRaw = keywordProps?.keyword_difficulty ?? null;
    const keywordDifficultyNum = Number(keywordDifficultyRaw);
    const keywordDifficulty = Number.isFinite(keywordDifficultyNum) ? Math.max(0, Math.min(100, Math.round(keywordDifficultyNum))) : 0;
    const cpc = Number(keywordInfo?.cpc ?? 0);
    const competition = Number(keywordInfo?.competition ?? 0);
    const competitionLevel = (keywordInfo?.competition_level || "").toString().toLowerCase();
    const intentRaw = (item?.search_intent_info?.main_intent || keywordProps?.keyword_intent || keywordInfo?.keyword_intent || "commercial").toString().toLowerCase();
    const intent = intentRaw === "informational" ? "Informational" : intentRaw === "transactional" ? "Transactional" : intentRaw === "navigational" ? "Navigational" : "Commercial";

    const countryData = item?.keyword_info?.country_data || item?.keyword_data?.keyword_info?.country_data || [];
    const countryBreakdown = Array.isArray(countryData)
      ? countryData.slice(0, 10).map((c: any) => ({
          countryCode: (c?.country_code || "").toUpperCase(),
          searchVolume: Number(c?.search_volume ?? 0),
        }))
      : [];
    const hasCountryBreakdown = countryBreakdown.length > 0;
    const globalVolume = hasCountryBreakdown
      ? countryBreakdown.reduce((sum: number, c: { searchVolume: number }) => sum + c.searchVolume, 0)
      : searchVolume;

    // Monthly trend: sort chronologically (oldest first), take last 12 months, so chart shows left-to-right correctly
    const monthlyMapped = rawMonthly
      .map((m: any) => ({
        year: Number(m?.year ?? 0),
        month: Number(m?.month ?? 0),
        searchVolume: Number(m?.search_volume ?? 0),
      }))
      .filter((m: { year: number; month: number }) => m.year > 0 && m.month > 0);
    monthlyMapped.sort((a: { year: number; month: number }, b: { year: number; month: number }) => a.year !== b.year ? a.year - b.year : a.month - b.month);
    const monthlySearches = monthlyMapped.slice(-12);

    const detailData = {
      keyword: item?.keyword || keyword.trim(),
      searchVolume,
      globalVolume,
      countryBreakdown: hasCountryBreakdown ? countryBreakdown : [{ countryCode: "US", searchVolume }],
      keywordDifficulty,
      difficultyLabel: keywordDifficulty >= 80 ? "Very hard" : keywordDifficulty >= 50 ? "Hard" : keywordDifficulty >= 25 ? "Medium" : "Easy",
      cpc,
      competition,
      competitionLevel,
      intent,
      monthlySearches,
    };

    return res.json({ keyword: keyword.trim(), found: true, detail: detailData });
  } catch (error: any) {
    console.error("Keyword detail fetch error:", error);
    return res.status(500).json({ message: "Failed to fetch keyword detail" });
  }
});

// SERP analysis for a keyword — ranking URLs table (Keyword Hub SERP Analysis)
router.get("/serp-analysis", authenticateToken, async (req, res) => {
  try {
    const { keyword, locationCode = "2840", languageCode = "en", offset = "0" } = req.query;
    if (!keyword || typeof keyword !== "string" || keyword.trim().length === 0) {
      return res.status(400).json({ message: "Keyword is required" });
    }
    const parsedLocationCode = Number(locationCode) || 2840;
    const parsedLanguageCode = typeof languageCode === "string" ? languageCode : "en";
    const parsedOffset = Math.min(20, Math.max(0, Number(offset) || 0)); // Only first 3 pages (0, 10, 20)

    const base64Auth = process.env.DATAFORSEO_BASE64;
    if (!base64Auth) {
      return res.status(503).json({ message: "DataForSEO credentials not configured" });
    }

    const requestBody = [{
      keyword: keyword.trim(),
      language_code: parsedLanguageCode,
      location_code: parsedLocationCode,
      device: "desktop",
      os: "windows",
      depth: Math.min(200, Math.max(10, parsedOffset + 10)),
    }];

    const response = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
      method: "POST",
      headers: {
        Authorization: `Basic ${base64Auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const result = data?.tasks?.[0]?.result?.[0];
    const items = result?.items || [];
    const organic = items.filter((i: any) => i.type === "organic");
    // DataForSEO returns total SERP count in se_results_count (not total_count)
    const totalCount = Number(result?.se_results_count ?? result?.total_count ?? 0) || organic.length;
    const serpFeatures: string[] = [];
    const featureMap: Record<string, string> = {
      organic: "organic",
      video: "video",
      images: "images",
      local_pack: "local_pack",
      featured_snippet: "featured_snippet",
      found_on_web: "things_to_know",
      people_also_ask: "people_also_ask",
      related_searches: "related_searches",
    };
    items.forEach((i: any) => {
      const name = featureMap[i.type] || i.type;
      if (name && !serpFeatures.includes(name)) serpFeatures.push(name);
    });

    // Extract feature details for expandable sections (Local pack, People also ask, Things to know)
    // DataForSEO: local_pack is one item per place (flat items[]); people_also_ask has items[] and optionally expanded_element; found_on_web/featured_snippet have items[].
    const localPackItems: { title?: string; link?: string; domain?: string }[] = [];
    const peopleAlsoAskItems: { title?: string; snippet?: string }[] = [];
    const thingsToKnowItems: { title?: string; snippet?: string }[] = [];
    items.forEach((i: any) => {
      // Local pack: each SERP item with type "local_pack" is one place (no nested items array)
      if (i.type === "local_pack") {
        localPackItems.push({
          title: i?.title || i?.name,
          link: (i?.url || i?.link) ?? undefined,
          domain: i?.domain ?? undefined,
        });
      }
      // People also ask: collect from items[] (initial questions) and expanded_element (expanded Q&A)
      if (i.type === "people_also_ask") {
        const fromItems = Array.isArray(i?.items) ? i.items : [];
        const fromExpanded = Array.isArray(i?.expanded_element) ? i.expanded_element : (i?.expanded_element ? [i.expanded_element] : []);
        const seen = new Set<string>();
        [...fromItems, ...fromExpanded].forEach((e: any) => {
          const title = (e?.title ?? e?.question ?? "").trim();
          if (!title || seen.has(title)) return;
          seen.add(title);
          peopleAlsoAskItems.push({
            title,
            snippet: [e?.description, e?.snippet, e?.answer, e?.text].find(Boolean) ?? undefined,
          });
        });
      }
      // Things to know: found_on_web, featured_snippet, knowledge_graph, perspectives (items have title, subtitle/description/snippet/text)
      if (i.type === "featured_snippet" || i.type === "found_on_web" || i.type === "perspectives" || (i.type === "knowledge_graph" && i?.items)) {
        const list = i?.items ? (Array.isArray(i.items) ? i.items : [i.items]) : [];
        list.forEach((e: any) => {
          const title = e?.title || e?.name || e?.featured_title;
          const snippet = e?.description || e?.snippet || e?.text || e?.subtitle;
          if (title || snippet) {
            thingsToKnowItems.push({ title: title || undefined, snippet: snippet || undefined });
          }
        });
      }
    });

    const slice = organic.slice(parsedOffset, parsedOffset + 10);
    const rows: { position: number; url: string; domain: string; title: string; pageAs: number | null; refDomains: number | null; backlinks: number | null; searchTraffic: number | null; urlKeywords: number | null }[] = slice.map((item: any, idx: number) => {
      const rank = parsedOffset + idx + 1;
      const url = item?.url || "";
      let domain = (item?.domain || "").replace(/^www\./, "");
      if (!domain && url) {
        try {
          domain = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          domain = "";
        }
      }
      return {
        position: Number(item?.rank_absolute ?? item?.rank_group ?? rank),
        url,
        domain,
        title: item?.title || "",
        pageAs: null,
        refDomains: null,
        backlinks: null,
        searchTraffic: null,
        urlKeywords: null,
      };
    });

    // Enrich rows with DataForSEO Backlinks Summary (backlinks, referring_domains, rank) per URL
    // Use bulk_pages_summary so one request returns one result per target in result[0].items
    if (rows.length > 0 && base64Auth) {
      try {
        const targets = rows.slice(0, 10).map((r) => {
          const u = r.url || r.domain;
          return u && (u.startsWith("http://") || u.startsWith("https://")) ? u : (u ? `https://${u}` : "");
        }).filter(Boolean);
        if (targets.length > 0) {
          const backlinksBody = [{ targets, rank_scale: "one_hundred" }];
          const blRes = await fetch("https://api.dataforseo.com/v3/backlinks/bulk_pages_summary/live", {
            method: "POST",
            headers: {
              Authorization: `Basic ${base64Auth}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(backlinksBody),
          });
          if (blRes.ok) {
            const blData = await blRes.json();
            const task = blData?.tasks?.[0];
            const resultBlock = task?.result?.[0];
            const items = Array.isArray(resultBlock?.items) ? resultBlock.items : [];
            rows.forEach((row, i) => {
              const item = items[i] ?? items.find((it: any) => (it?.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "") === (row.url || "").replace(/^https?:\/\//, "").replace(/\/$/, ""));
              if (row && item) {
                row.refDomains = item.referring_domains != null ? Number(item.referring_domains) : null;
                row.backlinks = item.backlinks != null ? Number(item.backlinks) : null;
                const rawRank = item.rank != null ? Number(item.rank) : null;
                row.pageAs = rawRank != null ? Math.min(100, Math.max(0, Math.round(rawRank))) : null;
              }
            });
          }
        }
      } catch {
        // keep rows with null metrics if backlinks call fails
      }
    }

    // Enrich rows with DataForSEO Ranked Keywords (search traffic ETV, keyword count) per URL
    // No bulk endpoint; one request per row so each row gets its own result
    if (rows.length > 0 && base64Auth) {
      try {
        const slice = rows.slice(0, 10);
        const rkResults = await Promise.all(slice.map(async (r) => {
          const target = r.url && (r.url.startsWith("http://") || r.url.startsWith("https://")) ? r.url : (r.url ? `https://${r.url}` : r.domain ? `https://${r.domain}` : r.domain || "");
          if (!target) return null;
          const body = [{ target, location_code: parsedLocationCode, language_code: parsedLanguageCode, limit: 1 }];
          const rkRes = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live", {
            method: "POST",
            headers: {
              Authorization: `Basic ${base64Auth}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
          if (!rkRes.ok) return null;
          const rkData = await rkRes.json();
          const task = rkData?.tasks?.[0];
          const result = Array.isArray(task?.result) ? task.result[0] : task?.result;
          return result ?? null;
        }));
        rkResults.forEach((result, i) => {
          const row = rows[i];
          if (row && result) {
            row.urlKeywords = result.total_count != null ? Number(result.total_count) : null;
            const etv = result.metrics?.organic?.etv;
            row.searchTraffic = etv != null ? Math.round(Number(etv)) : null;
          }
        });
      } catch {
        // keep rows with null searchTraffic/urlKeywords if ranked_keywords call fails
      }
    }

    return res.json({
      keyword: keyword.trim(),
      totalCount,
      serpFeatures,
      serpFeatureDetails: {
        local_pack: localPackItems,
        people_also_ask: peopleAlsoAskItems,
        things_to_know: thingsToKnowItems,
      },
      items: rows,
      offset: parsedOffset,
    });
  } catch (error: any) {
    console.error("SERP analysis fetch error:", error);
    return res.status(500).json({ message: "Failed to fetch SERP analysis" });
  }
});

// Get agency dashboard summary (aggregated data from all clients)
router.get("/agency/dashboard", authenticateToken, async (req, res) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ message: "Invalid session" });
    }
    const { period = "30" } = req.query;
    const days = parseInt(period as string) || 30;

    // Get user's accessible clients
    let accessibleClientIds: string[] = [];
    let agencyIds: string[] = [];

    if (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN") {
      // Admins see all clients
      const allClients = await prisma.client.findMany({
        select: { id: true },
      });
      accessibleClientIds = allClients.map(c => c.id);
    } else {
      // Get clients from user's agencies
      const userMemberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      agencyIds = userMemberships.map(m => m.agencyId);

      if (agencyIds.length > 0) {
        const clients = await prisma.client.findMany({
          where: {
            OR: [
              { user: { memberships: { some: { agencyId: { in: agencyIds } } } } },
              { belongsToAgencyId: { in: agencyIds } },
              { agencyInclusions: { some: { agencyId: { in: agencyIds } } } },
            ],
          },
          select: { id: true },
        });
        accessibleClientIds = [...new Set(clients.map(c => c.id))];
      }
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const endDate = new Date();

    const ga4Summary: {
      websiteVisitors: number;
      organicSessions: number;
      firstTimeVisitors: number;
      engagedVisitors: number;
      connectedClients: number;
      totalClients: number;
      newUsersTrend: Array<{ date: string; value: number }>;
      totalUsersTrend: Array<{ date: string; value: number }>;
    } = {
      websiteVisitors: 0,
      organicSessions: 0,
      firstTimeVisitors: 0,
      engagedVisitors: 0,
      connectedClients: 0,
      totalClients: accessibleClientIds.length,
      newUsersTrend: [],
      totalUsersTrend: [],
    };

    if (accessibleClientIds.length === 0) {
      return res.json({
        totalKeywords: 0,
        avgPosition: null,
        topRankings: 0,
        totalProjects: 0,
        organicTraffic: 0,
        recentRankings: [],
        topPages: [],
        rankingTrends: [],
        trafficTrends: [],
        ga4Summary,
      });
    }

    const ga4ConnectedClients = await prisma.client.findMany({
      where: {
        id: { in: accessibleClientIds },
        ga4RefreshToken: { not: null },
        ga4PropertyId: { not: null },
      },
      select: { id: true },
    });

    if (ga4ConnectedClients.length > 0) {
      try {
        const { fetchGA4TrafficData } = await import("../lib/ga4.js");
        const ga4Results = await Promise.allSettled(
          ga4ConnectedClients.map((client) =>
            fetchGA4TrafficData(client.id, startDate, endDate)
          )
        );

        const newUsersTrendMap = new Map<string, number>();
        const totalUsersTrendMap = new Map<string, number>();

        ga4Results.forEach((result) => {
          if (result.status !== "fulfilled") {
            console.warn("Failed to fetch GA4 data for a client:", result.reason);
            return;
          }

          const data = result.value;
          // Values used by the Agency dashboard cards
          ga4Summary.websiteVisitors += data.totalUsers || 0; // Website Visitors -> Total Users
          ga4Summary.organicSessions += data.organicSearchEngagedSessions || 0; // Organic Traffic -> Organic Search engaged sessions
          ga4Summary.firstTimeVisitors += data.newUsers || 0; // First Time Visitors -> New Users
          ga4Summary.engagedVisitors += data.engagedSessions || 0; // Engaged Visitors -> Engaged Sessions (total)
          ga4Summary.connectedClients += 1;

          data.newUsersTrend?.forEach((point: any) => {
            if (!point?.date) return;
            newUsersTrendMap.set(
              point.date,
              (newUsersTrendMap.get(point.date) || 0) + (point.value || 0)
            );
          });

          // Use activeUsersTrend
          data.activeUsersTrend?.forEach((point: any) => {
            if (!point?.date) return;
            totalUsersTrendMap.set(
              point.date,
              (totalUsersTrendMap.get(point.date) || 0) + (point.value || 0)
            );
          });
        });

        ga4Summary.newUsersTrend = Array.from(newUsersTrendMap.entries())
          .sort(([a], [b]) => (a > b ? 1 : -1))
          .map(([date, value]) => ({ date, value }));

        ga4Summary.totalUsersTrend = Array.from(totalUsersTrendMap.entries())
          .sort(([a], [b]) => (a > b ? 1 : -1))
          .map(([date, value]) => ({ date, value }));
      } catch (ga4Error) {
        console.warn("Failed to aggregate GA4 data for agency dashboard:", ga4Error);
      }
    }

    // Aggregate keyword stats
    const keywordStats = await prisma.keyword.aggregate({
      where: { clientId: { in: accessibleClientIds } },
      _count: { id: true },
      _avg: { currentPosition: true },
    });

    // Count keywords in top 10
    const topRankings = await prisma.keyword.count({
      where: {
        clientId: { in: accessibleClientIds },
        currentPosition: { not: null, lte: 10 },
      },
    });

    // Get recent ranking changes (keywords with position changes)
    const recentRankings = await prisma.keyword.findMany({
      where: {
        clientId: { in: accessibleClientIds },
        currentPosition: { not: null },
        previousPosition: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        keyword: true,
        currentPosition: true,
        previousPosition: true,
        searchVolume: true,
        googleUrl: true,
        client: {
          select: {
            id: true,
            name: true,
            domain: true,
          },
        },
      },
    });

    // Get top pages from database for all accessible clients
    const topPagesFromDb = await prisma.topPage.findMany({
      where: { 
        clientId: { in: accessibleClientIds }
      },
      orderBy: { organicEtv: "desc" },
      take: 5,
    });

    // Format top pages
    const topPages = topPagesFromDb.map(page => ({
      url: page.url,
      clicks: Math.round(page.organicEtv),
      impressions: page.organicCount * 100, // Estimate
      ctr: 5.0, // Default CTR
      position: page.organicPos1 > 0 ? 1 : (page.organicPos2_3 > 0 ? 2.5 : 5),
    }));

    // Calculate organic traffic from top pages
    const organicTraffic = topPagesFromDb.reduce((sum, page) => sum + page.organicEtv, 0);

    // Format recent rankings (only expose ranking website URL, not Google SERP URL)
    const formattedRecentRankings = recentRankings.map(kw => ({
      keyword: kw.keyword,
      position: kw.currentPosition!,
      change: kw.previousPosition ? kw.currentPosition! - kw.previousPosition : 0,
      url: onlyRankingWebsiteUrl(kw.googleUrl) || "",
      volume: kw.searchVolume || 0,
      clientId: (kw as any).client?.id,
      clientName: (kw as any).client?.name,
    }));

    // Quick wins: keywords in position 4-10 (easy wins) with client name
    const quickWinsKeywords = await prisma.keyword.findMany({
      where: {
        clientId: { in: accessibleClientIds },
        currentPosition: { not: null, gte: 4, lte: 10 },
      },
      orderBy: { currentPosition: "asc" },
      take: 10,
      select: {
        keyword: true,
        currentPosition: true,
        client: { select: { id: true, name: true } },
      },
    });
    const quickWins = quickWinsKeywords.map((kw) => ({
      clientId: kw.client.id,
      clientName: kw.client.name,
      keyword: kw.keyword,
      position: kw.currentPosition!,
    }));

    // Number 1 rankings: total and per client
    const numberOneTotal = await prisma.keyword.count({
      where: {
        clientId: { in: accessibleClientIds },
        currentPosition: 1,
      },
    });
    const numberOneByClient = await prisma.keyword.groupBy({
      by: ["clientId"],
      where: {
        clientId: { in: accessibleClientIds },
        currentPosition: 1,
      },
      _count: { id: true },
    });
    const clientIdsForOne = numberOneByClient.map((r) => r.clientId);
    const clientsForOne = await prisma.client.findMany({
      where: { id: { in: clientIdsForOne } },
      select: { id: true, name: true },
    });
    const clientNameMap = new Map(clientsForOne.map((c) => [c.id, c.name]));
    const numberOneRankings = {
      total: numberOneTotal,
      byClient: numberOneByClient
        .map((r) => ({ clientId: r.clientId, clientName: clientNameMap.get(r.clientId) || "Unknown", count: r._count.id }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };

    // Client performance overview: top clients by traffic (from top pages organic ETV)
    const trafficByClient = await prisma.topPage.groupBy({
      by: ["clientId"],
      where: { clientId: { in: accessibleClientIds } },
      _sum: { organicEtv: true },
    });
    const clientIdsWithTraffic = trafficByClient.map((r) => r.clientId);
    const clientsWithTraffic = await prisma.client.findMany({
      where: { id: { in: clientIdsWithTraffic } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(clientsWithTraffic.map((c) => [c.id, c.name]));
    const clientPerformance = trafficByClient
      .map((r) => ({
        clientId: r.clientId,
        clientName: nameMap.get(r.clientId) || "Unknown",
        trafficChangePercent: Math.round((Math.random() - 0.2) * 80), // Placeholder until we have historical
        trafficChangeVisits: Math.round((Math.random() - 0.2) * 2000),
        organicEtv: Math.round(r._sum.organicEtv || 0),
      }))
      .sort((a, b) => b.organicEtv - a.organicEtv)
      .slice(0, 6);

    // Limits from tier config + agency add-ons (all computed by getAgencyTierContext)
    const tierCtx = await getAgencyTierContext(req.user.userId, req.user.role);
    let tierLimit: number = tierCtx.effectiveMaxDashboards ?? tierCtx.tierConfig?.maxDashboards ?? 10;
    if (tierLimit === null) tierLimit = 999999;
    const keywordLimit = tierCtx.effectiveKeywordCap;
    let researchLimit = tierCtx.creditsLimit;
    let monthlySpendDollars = tierCtx.tierConfig?.priceMonthlyUsd ?? 0;
    if (agencyIds.length > 0) {
      const addOns = await prisma.agencyAddOn.findMany({
        where: { agencyId: { in: agencyIds } },
        select: { priceCents: true, billingInterval: true },
      });
      for (const a of addOns) {
        if (a.billingInterval === "monthly") monthlySpendDollars += a.priceCents / 100;
      }
    }
    const monthlySpend =
      monthlySpendDollars > 0
        ? monthlySpendDollars.toFixed(2)
        : tierCtx.tierConfig?.priceMonthlyUsd != null
          ? String(tierCtx.tierConfig.priceMonthlyUsd)
          : "0.00";
    const resetsInDays = tierCtx.creditsResetsAt
      ? Math.max(0, Math.ceil((tierCtx.creditsResetsAt.getTime() - Date.now()) / 86400000))
      : 30;
    const researchCredits = { used: tierCtx.creditsUsed, limit: researchLimit, resetsInDays };

    // Recent activity (placeholder: from activity log when available)
    const recentActivity = [
      { text: "New ranking data available (3 clients)", date: new Date().toISOString() },
      { text: "You created report for a client", date: new Date(Date.now() - 86400000).toISOString() },
      { text: "Task completed: Meta tags update", date: new Date(Date.now() - 172800000).toISOString() },
      { text: "Keywords added to a client", date: new Date(Date.now() - 259200000).toISOString() },
    ];

    // Generate mock trends data (in a real app, you'd fetch historical data)
    const rankingTrends = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return {
        date: date.toISOString().split("T")[0],
        avgPosition: (keywordStats._avg.currentPosition || 15) + Math.random() * 5 - 2.5,
      };
    });

    const trafficTrends = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return {
        date: date.toISOString().split("T")[0],
        traffic: organicTraffic / 30 + Math.random() * (organicTraffic / 10),
      };
    });

    res.json({
      totalKeywords: keywordStats._count.id,
      avgPosition: keywordStats._avg.currentPosition,
      topRankings,
      totalProjects: accessibleClientIds.length,
      organicTraffic: Math.round(organicTraffic),
      recentRankings: formattedRecentRankings,
      topPages,
      rankingTrends,
      trafficTrends,
      ga4Summary,
      quickWins,
      numberOneRankings,
      clientPerformance,
      researchCredits,
      recentActivity,
      tierLimit,
      keywordLimit,
      currentTier: tierCtx.tierConfig?.name ?? "Solo",
      isBusinessTier: tierCtx.tierConfig?.type === "business",
      monthlySpend,
      nextBillingDate: new Date(Date.now() + 26 * 86400000).toISOString().split("T")[0],
    });
  } catch (error: any) {
    console.error("Agency dashboard fetch error:", error);
    res.status(500).json({ message: error?.message || "Failed to fetch agency dashboard data" });
  }
});

// Get agency subscription overview (current plan, usage, next billing)
// Syncs agency.subscriptionTier from Stripe when loading so upgrades/downgrades in Stripe are reflected even if webhook didn't run.
router.get("/agency/subscription", authenticateToken, async (req, res) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ message: "Invalid session" });
    }
    let accessibleClientIds: string[] = [];
    let agencyIds: string[] = [];

    if (req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN") {
      const allClients = await prisma.client.findMany({ select: { id: true } });
      accessibleClientIds = allClients.map((c) => c.id);
    } else {
      const userMemberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      agencyIds = userMemberships.map((m) => m.agencyId);
      if (agencyIds.length > 0) {
        const clients = await prisma.client.findMany({
          where: {
            OR: [
              { user: { memberships: { some: { agencyId: { in: agencyIds } } } } },
              { belongsToAgencyId: { in: agencyIds } },
              { agencyInclusions: { some: { agencyId: { in: agencyIds } } } },
            ],
          },
          select: { id: true },
        });
        accessibleClientIds = [...new Set(clients.map((c) => c.id))];
      }
    }

    let tierCtx = await getAgencyTierContext(req.user.userId, req.user.role);
    if (tierCtx.agencyId) {
      try {
        const { updated } = await syncAgencyTierFromStripe(tierCtx.agencyId);
        if (updated) {
          tierCtx = await getAgencyTierContext(req.user.userId, req.user.role);
        }
      } catch (syncErr: any) {
        console.warn("syncAgencyTierFromStripe failed, using cached tier:", syncErr?.message);
      }
    }
    const keywordCount = tierCtx.totalKeywords;

    // Use tierCtx limits (plan + add-ons from getAgencyTierContext) so Subscription page matches rest of app
    let tierLimit: number = tierCtx.effectiveMaxDashboards ?? tierCtx.tierConfig?.maxDashboards ?? 10;
    if (tierLimit === null) tierLimit = 999999;
    const keywordLimit = tierCtx.effectiveKeywordCap;
    const researchLimit = tierCtx.creditsLimit;
    let teamMemberLimit = tierCtx.tierConfig?.maxTeamUsers ?? 10;
    if (teamMemberLimit === null) teamMemberLimit = 999999;

    let clientsWithActiveManagedServices = 0;
    if (tierCtx.agencyId) {
      const msRows = await prisma.managedService.findMany({
        where: { agencyId: tierCtx.agencyId, status: "ACTIVE" },
        select: { clientId: true },
      });
      clientsWithActiveManagedServices = new Set(msRows.map((r) => r.clientId)).size;
    }

    const nextBilling = new Date();
    nextBilling.setDate(nextBilling.getDate() + 26);

    const currentPlanPrice =
      tierCtx.tierConfig?.priceMonthlyUsd ?? (tierCtx.tierConfig?.id === "enterprise" ? null : 147);

    let trialEndsAt: string | null = null;
    let trialDaysLeft: number | null = null;
    let billingType: string | null = null;
    let trialExpired = false;
    let accountActivated = false;
    if (tierCtx.agencyId) {
      const agency = await prisma.agency.findUnique({
        where: { id: tierCtx.agencyId },
        select: { trialEndsAt: true, billingType: true, stripeCustomerId: true },
      });
      accountActivated = !!agency?.stripeCustomerId;
      if (agency?.trialEndsAt && agency.trialEndsAt > new Date()) {
        trialEndsAt = agency.trialEndsAt.toISOString();
        trialDaysLeft = Math.max(0, Math.ceil((agency.trialEndsAt.getTime() - Date.now()) / 86400000));
      }
      billingType = agency?.billingType ?? null;
      trialExpired =
        agency?.trialEndsAt != null &&
        agency.trialEndsAt <= new Date() &&
        (agency?.billingType === "free" || agency?.billingType === "trial");
    }

    res.json({
      currentPlan: tierCtx.tierConfig?.id ?? "solo",
      accountActivated,
      billingType: billingType ?? undefined,
      trialExpired: trialExpired || undefined,
      currentPlanPrice: currentPlanPrice ?? undefined,
      nextBillingDate: nextBilling.toISOString().split("T")[0],
      paymentMethod: { last4: "4242", brand: "Visa" },
      isBusinessTier: tierCtx.tierConfig?.type === "business",
      trialEndsAt,
      trialDaysLeft,
      usage: {
        clientDashboards: { used: tierCtx.dashboardCount, limit: tierLimit },
        keywordsTracked: { used: keywordCount, limit: keywordLimit },
        researchCredits: { used: tierCtx.creditsUsed, limit: researchLimit },
        teamMembers: { used: tierCtx.teamMemberCount, limit: teamMemberLimit },
        clientsWithActiveManagedServices,
      },
    });
  } catch (error: any) {
    console.error("Agency subscription fetch error:", error);
    res.status(500).json({ message: error?.message || "Failed to fetch subscription" });
  }
});

// Get target keywords for a client (read from DB only)
router.get("/target-keywords/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Check access: user must own the client or be ADMIN/SUPER_ADMIN
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const isOwner = client.userId === req.user.userId;

    // For non-admin users, check if they're in the same agency
    let hasAccess = isAdmin || isOwner;
    if (!hasAccess && req.user.role !== "ADMIN" && req.user.role !== "SUPER_ADMIN") {
      const userMemberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      const userAgencyIds = userMemberships.map(m => m.agencyId);
      const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
      hasAccess = clientAgencyIds.some(id => userAgencyIds.includes(id));
    }
    // Client portal users: allow access via client_users membership
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const normalizeKeywordKey = (value: unknown) => {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\s+/g, " ");
    };

    // Get tracked keywords (from keywords table) for this client (for filtering + rank fallback)
    const trackedKeywords = await prisma.keyword.findMany({
      where: { clientId },
      select: {
        keyword: true,
        currentPosition: true,
        previousPosition: true,
        googleUrl: true,
      },
    });

    // Create a set of tracked keyword strings for fast lookup
    const trackedKeywordSet = new Set(trackedKeywords.map((k) => normalizeKeywordKey(k.keyword)));

    // Map tracked positions by keyword for fallback in Target Keywords table
    const trackedByKeyword = new Map(
      trackedKeywords.map((k) => [
        normalizeKeywordKey(k.keyword),
        {
          currentPosition: k.currentPosition ?? null,
          previousPosition: k.previousPosition ?? null,
          googleUrl: onlyRankingWebsiteUrl(k.googleUrl) ?? null,
        },
      ])
    );

    // Get target keywords from database
    const allTargetKeywords = await prisma.targetKeyword.findMany({
      where: { clientId },
      orderBy: [
        { searchVolume: "desc" },
        { keyword: "asc" }
      ],
    });

    // Filter to only include target keywords that are also tracked
    const targetKeywords = allTargetKeywords.filter((tk) =>
      trackedKeywordSet.has(normalizeKeywordKey(tk.keyword))
    );

    // Normalize location display (comma spacing) without mutating DB
    res.json(
      targetKeywords.map((tk) => ({
        ...tk,
        locationName: tk.locationName ? normalizeLocationName(tk.locationName) : tk.locationName,
        // If TargetKeyword rank hasn't been populated yet, fall back to tracked keyword rank.
        googlePosition:
          tk.googlePosition ??
          trackedByKeyword.get(normalizeKeywordKey(tk.keyword))?.currentPosition ??
          null,
        previousPosition:
          tk.previousPosition ??
          trackedByKeyword.get(normalizeKeywordKey(tk.keyword))?.previousPosition ??
          null,
        // Also fall back googleUrl if it's missing on target keyword. Never expose Google SERP URLs.
        googleUrl: onlyRankingWebsiteUrl(tk.googleUrl ?? trackedByKeyword.get(normalizeKeywordKey(tk.keyword))?.googleUrl) ?? null,
      }))
    );
  } catch (error: any) {
    console.error("Get target keywords error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Public: Shared Target Keywords by share token (no auth)
router.get("/share/:token/target-keywords", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = await resolveShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;

    const normalizeKeywordKey = (value: unknown) => {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\s+/g, " ");
    };

    // tracked keywords for filtering + fallback rank
    const trackedKeywords = await prisma.keyword.findMany({
      where: { clientId },
      select: {
        keyword: true,
        currentPosition: true,
        previousPosition: true,
        googleUrl: true,
      },
    });
    const trackedKeywordSet = new Set(trackedKeywords.map((k) => normalizeKeywordKey(k.keyword)));
    const trackedByKeyword = new Map(
      trackedKeywords.map((k) => [
        normalizeKeywordKey(k.keyword),
        {
          currentPosition: k.currentPosition ?? null,
          previousPosition: k.previousPosition ?? null,
          googleUrl: onlyRankingWebsiteUrl(k.googleUrl) ?? null,
        },
      ])
    );

    const allTargetKeywords = await prisma.targetKeyword.findMany({
      where: { clientId },
      orderBy: [{ searchVolume: "desc" }, { keyword: "asc" }],
    });

    const targetKeywords = allTargetKeywords.filter((tk) =>
      trackedKeywordSet.has(normalizeKeywordKey(tk.keyword))
    );

    return res.json(
      targetKeywords.map((tk) => ({
        ...tk,
        locationName: tk.locationName ? normalizeLocationName(tk.locationName) : tk.locationName,
        googlePosition:
          tk.googlePosition ??
          trackedByKeyword.get(normalizeKeywordKey(tk.keyword))?.currentPosition ??
          null,
        previousPosition:
          tk.previousPosition ??
          trackedByKeyword.get(normalizeKeywordKey(tk.keyword))?.previousPosition ??
          null,
        googleUrl: onlyRankingWebsiteUrl(tk.googleUrl ?? trackedByKeyword.get(normalizeKeywordKey(tk.keyword))?.googleUrl) ?? null,
      }))
    );
  } catch (error: any) {
    console.error("Shared target keywords error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// Create target keyword for a client
router.post("/target-keywords/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const keywordData = z.object({
      keyword: z.string().min(1),
      searchVolume: z.number().int().min(0).optional(),
      cpc: z.number().min(0).optional(),
      competition: z.string().optional(),
      competitionValue: z.number().min(0).max(1).optional(),
      locationCode: z.number().int().optional().default(2840),
      locationName: z.string().optional(),
      languageCode: z.string().optional().default("en"),
      languageName: z.string().optional(),
      type: z.enum(["money", "topical"]).optional().default("money"),
    }).parse(req.body);

    // Check if user has access to this client
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: {
          include: {
            memberships: {
              select: { agencyId: true }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const tierCtx = await getAgencyTierContext(req.user.userId, req.user.role);
    const keywordLimitCheck = canAddTargetKeyword(tierCtx, clientId);
    if (!keywordLimitCheck.allowed) {
      return res.status(403).json({
        message: keywordLimitCheck.message,
        code: "TIER_LIMIT",
        limitType: "keywords",
      });
    }

    // Check if target keyword already exists
    const existing = await prisma.targetKeyword.findUnique({
      where: {
        clientId_keyword: {
          clientId,
          keyword: keywordData.keyword,
        },
      },
    });

    if (existing) {
      return res.status(400).json({ message: "Target keyword already exists for this client" });
    }

    const normalizedLocationName = keywordData.locationName
      ? normalizeLocationName(keywordData.locationName)
      : null;

    // If a non-US location name was provided but the code is default/missing, try to resolve it.
    const shouldResolveLocation =
      Boolean(normalizedLocationName) &&
      normalizeLocationNameForMatch(normalizedLocationName || "") !== normalizeLocationNameForMatch("United States");
    const resolvedLocationCode =
      shouldResolveLocation ? await resolveLocationCodeFromName(normalizedLocationName!) : null;

    // Create target keyword
    const targetKeyword = await prisma.targetKeyword.create({
      data: {
        clientId,
        keyword: keywordData.keyword,
        searchVolume: keywordData.searchVolume || null,
        cpc: keywordData.cpc || null,
        competition: keywordData.competition || null,
        competitionValue: keywordData.competitionValue || null,
        locationCode: resolvedLocationCode ?? keywordData.locationCode ?? null,
        locationName: normalizedLocationName ?? keywordData.locationName ?? null,
        languageCode: keywordData.languageCode || null,
        languageName: keywordData.languageName || null,
        type: keywordData.type || "money",
      },
    });

    res.json(targetKeyword);
  } catch (error: any) {
    if (error.name === "ZodError") {
      return res.status(400).json({ message: "Invalid input data", errors: error.errors });
    }
    console.error("Create target keyword error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Update target keyword (for editing date added and ranking)
router.patch("/target-keywords/:keywordId", authenticateToken, async (req, res) => {
  try {
    const { keywordId } = req.params;
    const updateData = z.object({
      createdAt: z.string().optional(),
      googlePosition: z.number().int().positive().optional().nullable(),
    }).parse(req.body);

    // Get the keyword to check access
    const keyword = await prisma.targetKeyword.findUnique({
      where: { id: keywordId },
      include: {
        client: {
          include: {
            user: {
              include: {
                memberships: {
                  select: { agencyId: true }
                }
              }
            }
          }
        }
      }
    });

    if (!keyword) {
      return res.status(404).json({ message: "Target keyword not found" });
    }

    // Permission check
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = keyword.client.user.memberships.map(m => m.agencyId);
    let hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));
    if (!hasAccess) {
      const cu = await prisma.clientUser.findFirst({
        where: { clientId: keyword.clientId, userId: req.user.userId, status: "ACTIVE" },
        select: { id: true },
      });
      hasAccess = Boolean(cu);
    }

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Prepare update data
    const dataToUpdate: any = {};
    if (updateData.createdAt) {
      dataToUpdate.createdAt = new Date(updateData.createdAt);
    }
    if (updateData.googlePosition !== undefined) {
      // If updating position, preserve previous position for change calculation
      if (keyword.googlePosition !== null && updateData.googlePosition !== keyword.googlePosition) {
        dataToUpdate.previousPosition = keyword.googlePosition;
      }
      dataToUpdate.googlePosition = updateData.googlePosition;
    }

    const updated = await prisma.targetKeyword.update({
      where: { id: keywordId },
      data: dataToUpdate
    });

    res.json(updated);
  } catch (error: any) {
    console.error("Update target keyword error:", error);
    if (error.name === "ZodError") {
      return res.status(400).json({ message: "Invalid request data", errors: error.errors });
    }
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh target keywords from DataForSEO (SUPER_ADMIN only)
router.post("/target-keywords/:clientId/refresh", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true, userId: true, lastRankRefreshAt: true },
    });

    if (!client || !client.domain) {
      return res.status(404).json({ message: "Client not found or has no domain" });
    }

    // Normalize domain
    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    const targetDomain = normalizeDomain(client.domain);

    // Non-super-admin refresh: update rankings for existing tracked target keywords via SERP (limited).
    // This avoids relying on the expensive Keywords-for-site endpoint and fixes "no ranking data" issues.
    if (req.user.role !== "SUPER_ADMIN") {
      // Only allow users who can already view the client's dashboard (agency/admin ownership model)
      const userMemberships = await prisma.userAgency.findMany({
        where: { userId: req.user.userId },
        select: { agencyId: true },
      });
      const userAgencyIds = userMemberships.map((m) => m.agencyId);

      const clientWithUser = await prisma.client.findUnique({
        where: { id: clientId },
        include: {
          user: {
            include: {
              memberships: {
                select: { agencyId: true },
              },
            },
          },
        },
      });
      if (!clientWithUser) return res.status(404).json({ message: "Client not found" });
      const isAdmin = req.user.role === "ADMIN";
      let hasAccess = isAdmin || clientWithUser.user.memberships.some((m) => userAgencyIds.includes(m.agencyId));
      if (!hasAccess) {
        const cu = await prisma.clientUser.findFirst({
          where: { clientId, userId: req.user.userId, status: "ACTIVE" },
          select: { id: true },
        });
        hasAccess = Boolean(cu);
      }
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      // Tier-based rank refresh throttle
      const agency = await prisma.agency.findFirst({
        where: { id: { in: userAgencyIds } },
        select: { subscriptionTier: true },
      });
      const tierConfig = getTierConfig(agency?.subscriptionTier ?? null);
      if (tierConfig) {
        const intervalMs = getRankRefreshIntervalMs(tierConfig);
        if (intervalMs > 0 && client.lastRankRefreshAt) {
          const elapsed = Date.now() - client.lastRankRefreshAt.getTime();
          if (elapsed < intervalMs) {
            const nextAt = new Date(client.lastRankRefreshAt.getTime() + intervalMs);
            return res.status(429).json({
              message: `Your plan allows rank updates ${tierConfig.rankUpdateFrequency}. Next refresh available at ${nextAt.toISOString()}.`,
              code: "REFRESH_THROTTLE",
              nextRefreshAt: nextAt.toISOString(),
            });
          }
        }
      }

      // Only refresh tracked target keywords (intersection of target_keywords + keywords)
      const trackedKeywords = await prisma.keyword.findMany({
        where: { clientId },
        select: { keyword: true },
      });
      const trackedSet = new Set(trackedKeywords.map((k) => k.keyword.toLowerCase()));
      const targetKeywords = await prisma.targetKeyword.findMany({
        where: { clientId },
        orderBy: [{ updatedAt: "asc" }],
      });

      const toRefresh = targetKeywords
        .filter((tk) => trackedSet.has(tk.keyword.toLowerCase()))
        .slice(0, 10); // safety limit per click

      const updates = await Promise.all(
        toRefresh.map(async (tk) => {
          try {
            const normalizedLocationName = tk.locationName ? normalizeLocationName(tk.locationName) : null;
            const resolvedLocationCode =
              tk.locationCode ??
              (normalizedLocationName ? await resolveLocationCodeFromName(normalizedLocationName) : null) ??
              2840;

            const serp = await fetchKeywordDataFromDataForSEO(
              tk.keyword,
              client.domain,
              resolvedLocationCode,
              tk.languageCode || "en"
            );

            const nextPos = serp.currentPosition ?? null;
            const prevPos = tk.googlePosition ?? null;
            const previousPosition =
              prevPos !== null && nextPos !== null && prevPos !== nextPos ? prevPos : tk.previousPosition ?? null;

            return prisma.targetKeyword.update({
              where: { id: tk.id },
              data: {
                locationCode: resolvedLocationCode,
                ...(normalizedLocationName ? { locationName: normalizedLocationName } : {}),
                googlePosition: nextPos,
                previousPosition,
                googleUrl: onlyRankingWebsiteUrl(serp.googleUrl) ?? onlyRankingWebsiteUrl(tk.googleUrl) ?? null,
                serpInfo: serp.serpData ? JSON.stringify(serp.serpData) : tk.serpInfo,
                serpItemTypes: Array.isArray(serp.serpFeatures) ? JSON.stringify(serp.serpFeatures) : tk.serpItemTypes,
                seResultsCount: typeof serp.totalResults === "number" ? String(serp.totalResults) : tk.seResultsCount,
              },
            });
          } catch (err) {
            console.warn(`[Target Keywords Refresh] Failed for "${tk.keyword}":`, err);
            return null;
          }
        })
      );

      await prisma.client.update({
        where: { id: clientId },
        data: { lastRankRefreshAt: new Date() },
      });

      return res.json({
        message: "Target keywords refreshed successfully",
        keywords: updates.filter(Boolean).length,
        mode: "serp",
      });
    }

    // Fetch keywords from DataForSEO API
    const keywords = await fetchKeywordsForSiteFromDataForSEO(targetDomain, 100, 2840, "English");

    // Backfill accurate ranking for tracked keywords (SERP-based) when keywords_for_site doesn't include position.
    const trackedKeywords = await prisma.keyword.findMany({
      where: { clientId },
      select: { keyword: true },
    });
    const trackedSet = new Set(trackedKeywords.map((k) => k.keyword.toLowerCase()));

    const keywordsNeedingRank = keywords
      .filter((k) => trackedSet.has((k.keyword || "").toLowerCase()))
      .filter((k) => k.googlePosition == null)
      .slice(0, 10); // safety limit per click (DataForSEO billing)

    for (const kw of keywordsNeedingRank) {
      try {
        const existingTk = await prisma.targetKeyword.findUnique({
          where: {
            clientId_keyword: {
              clientId,
              keyword: kw.keyword,
            },
          },
          select: { locationCode: true, locationName: true, languageCode: true },
        });

        const normalizedLocationName = existingTk?.locationName ? normalizeLocationName(existingTk.locationName) : null;
        const resolvedLocationCode =
          existingTk?.locationCode ??
          (normalizedLocationName ? await resolveLocationCodeFromName(normalizedLocationName) : null) ??
          2840;
        const resolvedLanguageCode = existingTk?.languageCode || "en";

        const serp = await fetchKeywordDataFromDataForSEO(
          kw.keyword,
          client.domain,
          resolvedLocationCode,
          resolvedLanguageCode
        );
        const rankingUrl = onlyRankingWebsiteUrl(serp?.googleUrl);
        if (rankingUrl) kw.googleUrl = rankingUrl;
        if (typeof serp?.currentPosition === "number" && serp.currentPosition > 0) kw.googlePosition = serp.currentPosition;
        if (serp?.serpData) kw.serpInfo = serp.serpData;
        if (Array.isArray(serp?.serpFeatures)) kw.serpItemTypes = serp.serpFeatures;
        if (typeof serp?.totalResults === "number") kw.seResultsCount = String(serp.totalResults);
      } catch (err) {
        console.warn(`[Target Keywords Refresh] SERP backfill failed for "${kw.keyword}":`, err);
      }
    }

    // Use upsert to save/update keywords
    const savedKeywords = await Promise.all(
      keywords.map(async (kw) => {
        // Get existing keyword to preserve previous position for change calculation
        const existing = await prisma.targetKeyword.findUnique({
          where: {
            clientId_keyword: {
              clientId,
              keyword: kw.keyword,
            },
          },
        });
        
        const previousPosition = existing?.googlePosition || null;
        const googleChange = kw.googlePosition && previousPosition 
          ? kw.googlePosition - previousPosition 
          : null;
        
        // Map location code to location name (default to US locations)
        const locationNameMap: Record<number, string> = {
          2840: "United States",
          2826: "United Kingdom",
          2036: "Australia",
          2124: "Canada",
        };
        const locationName = locationNameMap[kw.locationCode || 2840] || "United States";
        
        // Map language code to language name
        const languageNameMap: Record<string, string> = {
          "en": "English",
          "es": "Spanish",
          "fr": "French",
          "de": "German",
          "it": "Italian",
          "pt": "Portuguese",
          "ja": "Japanese",
          "zh": "Chinese",
          "ko": "Korean",
          "ru": "Russian",
        };
        const languageName = kw.languageCode 
          ? (languageNameMap[kw.languageCode] || kw.languageCode) 
          : "English";
        
        return prisma.targetKeyword.upsert({
          where: {
            clientId_keyword: {
              clientId,
              keyword: kw.keyword,
            },
          },
          update: {
            searchVolume: kw.searchVolume || null,
            cpc: kw.cpc,
            competition: kw.competition,
            competitionValue: kw.competitionValue,
            monthlySearches: kw.monthlySearches ? JSON.stringify(kw.monthlySearches) : null,
            keywordInfo: kw.keywordInfo ? JSON.stringify(kw.keywordInfo) : null,
            locationCode: kw.locationCode || null,
            locationName: locationName,
            languageCode: kw.languageCode || null,
            languageName: languageName,
            serpInfo: kw.serpInfo ? JSON.stringify(kw.serpInfo) : null,
            serpItemTypes: kw.serpItemTypes ? JSON.stringify(kw.serpItemTypes) : null,
            googleUrl: onlyRankingWebsiteUrl(kw.googleUrl) ?? null,
            previousPosition: previousPosition,
            googlePosition: kw.googlePosition,
            seResultsCount: kw.seResultsCount ? String(kw.seResultsCount) : null,
          },
          create: {
            clientId,
            keyword: kw.keyword,
            searchVolume: kw.searchVolume || null,
            cpc: kw.cpc,
            competition: kw.competition,
            competitionValue: kw.competitionValue,
            monthlySearches: kw.monthlySearches ? JSON.stringify(kw.monthlySearches) : null,
            keywordInfo: kw.keywordInfo ? JSON.stringify(kw.keywordInfo) : null,
            locationCode: kw.locationCode || null,
            locationName: locationName,
            languageCode: kw.languageCode || null,
            languageName: languageName,
            serpInfo: kw.serpInfo ? JSON.stringify(kw.serpInfo) : null,
            serpItemTypes: kw.serpItemTypes ? JSON.stringify(kw.serpItemTypes) : null,
            googleUrl: onlyRankingWebsiteUrl(kw.googleUrl) ?? null,
            googlePosition: kw.googlePosition,
            seResultsCount: kw.seResultsCount ? String(kw.seResultsCount) : null,
          },
        });
      })
    );

    res.json({
      message: "Target keywords refreshed successfully",
      keywords: savedKeywords.length,
    });
  } catch (error: any) {
    console.error("Refresh target keywords error:", error);
    res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

export default router;

