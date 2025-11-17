import express from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authenticateToken } from "../middleware/auth.js";
import jwt from "jsonwebtoken";

const router = express.Router();

// DataForSEO API helper function
async function fetchKeywordDataFromDataForSEO(
  keyword: string, 
  clientDomain?: string,
  locationCode: number = 2840, 
  languageCode: string = "en"
) {
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
        // Normalize domain for comparison (remove protocol, www, trailing slashes)
        const normalizeDomain = (domain: string) => {
          return domain
            .replace(/^https?:\/\//, "")
            .replace(/^www\./, "")
            .replace(/\/$/, "")
            .toLowerCase();
        };
        
        const normalizedClientDomain = normalizeDomain(clientDomain);
        
        // Search for client's domain in organic results
        for (let i = 0; i < organicResults.length; i++) {
          const item = organicResults[i];
          const itemUrl = item.url || "";
          const normalizedItemDomain = normalizeDomain(itemUrl);
          
          if (normalizedItemDomain.includes(normalizedClientDomain) || 
              normalizedClientDomain.includes(normalizedItemDomain)) {
            currentPosition = i + 1; // Position is 1-indexed
            googleUrl = itemUrl; // Store the URL that ranks
            break;
          }
        }
      }
      
      // Set best position if we found the domain
      if (currentPosition) {
        bestPosition = currentPosition;
      }
      
      // Extract additional metrics if available
      const totalResults = result?.total_count || 0;
      
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

  const requestBody = [
    {
      keyword: seedKeyword,
      location_code: locationCode,
      language_code: languageCode,
      include_serp_info: false,
      limit,
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

  return items.map((item) => {
    const keywordData = item?.keyword_data || {};
    const keywordInfo = keywordData?.keyword_info || item?.keyword_info || {};
    const competitionIndex = keywordInfo?.competition_index;
    const normalizedDifficulty =
      typeof competitionIndex === "number" ? Math.max(0, Math.min(100, Math.round(competitionIndex * 100))) : null;

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

// Get SEO reports for a client
router.get("/reports/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { period = "monthly" } = req.query;

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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Always return only the latest report (single report per client)
    const latest = await prisma.seoReport.findFirst({
      where: { clientId, period: period as string },
      orderBy: { reportDate: "desc" }
    });

    // Best-effort: if multiple exist, soft-clean by deleting all but latest
    if (latest) {
      await prisma.seoReport.deleteMany({
        where: {
          clientId,
          id: { not: latest.id }
        }
      });
    }

    res.json(latest || null);
  } catch (error) {
    console.error("Fetch SEO reports error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Generate shareable link token for a client (valid 7 days)
router.post("/share-link/:clientId", authenticateToken, async (req, res) => {
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

    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const secret = process.env.JWT_SECRET || "change_me_secret";
    const token = jwt.sign(
      {
        type: "client_share",
        clientId,
        issuedBy: req.user.userId
      },
      secret,
      { expiresIn: "7d" }
    );

    res.json({ token, expiresInDays: 7 });
  } catch (error) {
    console.error("Create share link error:", error);
    res.status(500).json({ message: "Failed to generate share link" });
  }
});

// Public: Shared dashboard by token (no auth)
// Helper function to verify share token
function verifyShareToken(token: string): { clientId: string } | null {
  const secret = process.env.JWT_SECRET || "change_me_secret";
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

router.get("/share/:token/dashboard", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = verifyShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { period = "30" } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, domain: true }
    });
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const days = parseInt(period as string);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

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

    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    let trafficSourceSummary: Awaited<ReturnType<typeof fetchTrafficSourcesFromRankedKeywords>> | null = null;
    try {
      if (client.domain) {
        const targetDomain = normalizeDomain(client.domain);
        if (targetDomain) {
          trafficSourceSummary = await fetchTrafficSourcesFromRankedKeywords(targetDomain, 100, 2840, "English");
        }
      }
    } catch (apiError) {
      console.error("Failed to fetch traffic summary from DataForSEO:", apiError);
    }

    const totalSessionsFromApi = trafficSourceSummary?.totalEstimatedTraffic ?? null;
    const organicSessionsFromApi = trafficSourceSummary?.organicEstimatedTraffic ?? null;
    const averagePositionFromApi = trafficSourceSummary?.averageRank ?? null;

    const totalSessions =
      totalSessionsFromApi ??
      (latestReport ? latestReport.totalSessions : keywordStats._count.id ?? 0);

    const organicSessions =
      organicSessionsFromApi ??
      (latestReport ? latestReport.organicSessions : null);

    const averagePosition =
      averagePositionFromApi ??
      (latestReport?.averagePosition ?? keywordStats._avg.currentPosition ?? null);

    const conversions = latestReport?.conversions ?? null;

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
      averagePosition,
      conversions,
      dataSources: {
        traffic: trafficSourceSummary ? "dataforseo" : latestReport ? "seo_report" : "fallback",
        conversions: latestReport ? "seo_report" : "unknown",
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
        avgDomainRating: backlinkStats._avg.domainRating
      },
      topKeywords
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
    const tokenData = verifyShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { limit = "10", locationCode = "2840", language = "English" } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    const targetDomain = normalizeDomain(client.domain);

    const topPages = await fetchRelevantPagesFromDataForSEO(
      targetDomain,
      Number(limit) || 10,
      Number(locationCode) || 2840,
      String(language || "English")
    );

    res.json(topPages);
  } catch (error: any) {
    console.error("Share top pages fetch error:", error);
    res.status(500).json({ message: "Failed to fetch top pages data" });
  }
});

router.get("/share/:token/backlinks/timeseries", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = verifyShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { range = "30", group = "day" } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    const targetDomain = normalizeDomain(client.domain);

    const now = new Date();
    const rangeNumber = Number(range) || 30;
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - rangeNumber + 1);

    const dateTo = now.toISOString().split("T")[0];
    const dateFrom = fromDate.toISOString().split("T")[0];
    const summary = await fetchBacklinkTimeseriesSummaryFromDataForSEO(
      targetDomain,
      dateFrom,
      dateTo,
      (group as "day" | "week" | "month") || "day"
    );

    res.json(summary);
  } catch (error: any) {
    console.error("Share backlink timeseries fetch error:", error);
    res.status(500).json({ message: "Failed to fetch backlink timeseries data" });
  }
});

router.get("/share/:token/traffic-sources", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = verifyShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { limit = "100", locationCode = "2840", language = "English" } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    const targetDomain = normalizeDomain(client.domain);

    const result = await fetchTrafficSourcesFromRankedKeywords(
      targetDomain,
      Number(limit) || 100,
      Number(locationCode) || 2840,
      String(language || "English")
    );

    res.json(result?.breakdown || []);
  } catch (error: any) {
    console.error("Share traffic sources fetch error:", error);
    res.status(500).json({ message: "Failed to fetch traffic sources data" });
  }
});

// Get keywords for a client
router.get("/keywords/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
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
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true }
    });
    const userAgencyIds = userMemberships.map(m => m.agencyId);
    const clientAgencyIds = client.user.memberships.map(m => m.agencyId);
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

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

    const keywords = await prisma.keyword.findMany({
      where: whereClause,
      orderBy: {
        [sortBy as string]: order as "asc" | "desc"
      }
    });

    res.json(keywords);
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
      locationCode: z.number().int().optional().default(2840),
      languageCode: z.string().optional().default("en"),
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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

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
    if (keywordData.fetchFromDataForSEO) {
      try {
        const dataForSEOData = await fetchKeywordDataFromDataForSEO(
          keywordData.keyword,
          client.domain,
          keywordData.locationCode,
          keywordData.languageCode
        );
        
        // Update keyword data with DataForSEO results
        if (dataForSEOData.currentPosition !== null) {
          keywordData.currentPosition = dataForSEOData.currentPosition;
        }
        if (dataForSEOData.bestPosition !== null) {
          keywordData.bestPosition = dataForSEOData.bestPosition;
        }
        if (dataForSEOData.googleUrl) {
          keywordData.googleUrl = dataForSEOData.googleUrl;
        }
        if (dataForSEOData.serpFeatures && dataForSEOData.serpFeatures.length > 0) {
          keywordData.serpFeatures = dataForSEOData.serpFeatures;
        }
        if (dataForSEOData.totalResults !== null && dataForSEOData.totalResults > 0) {
          keywordData.totalResults = dataForSEOData.totalResults;
        }
        serpData = dataForSEOData.serpData;
      } catch (error: any) {
        console.error("Failed to fetch from DataForSEO:", error);
        // Continue with manual data if DataForSEO fails
      }
    }

    const keyword = await prisma.keyword.create({
      data: {
        keyword: keywordData.keyword,
        searchVolume: keywordData.searchVolume,
        difficulty: keywordData.difficulty,
        cpc: keywordData.cpc,
        competition: keywordData.competition,
        currentPosition: keywordData.currentPosition,
        previousPosition: keywordData.previousPosition,
        bestPosition: keywordData.bestPosition,
        googleUrl: keywordData.googleUrl,
        serpFeatures: keywordData.serpFeatures || undefined,
        totalResults: keywordData.totalResults,
        clientId
      }
    });

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

// Refresh keyword data from DataForSEO
router.post("/keywords/:clientId/:keywordId/refresh", authenticateToken, async (req, res) => {
  try {
    const { clientId, keywordId } = req.params;
    const { locationCode = 2840, languageCode = "en" } = req.body;

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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
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

    // Fetch fresh data from DataForSEO
    const dataForSEOData = await fetchKeywordDataFromDataForSEO(
      keyword.keyword,
      client.domain,
      locationCode,
      languageCode
    );

    // Update previous position before updating current position
    const updateData: any = {};
    if (keyword.currentPosition !== null) {
      updateData.previousPosition = keyword.currentPosition;
    }

    // Update with new position data
    if (dataForSEOData.currentPosition !== null) {
      updateData.currentPosition = dataForSEOData.currentPosition;
    }

    if (dataForSEOData.bestPosition !== null) {
      // Only update bestPosition if it's better (lower number) than current
      if (keyword.bestPosition === null || dataForSEOData.bestPosition < keyword.bestPosition) {
        updateData.bestPosition = dataForSEOData.bestPosition;
      }
    }

    // Update Google URL if found
    if (dataForSEOData.googleUrl) {
      updateData.googleUrl = dataForSEOData.googleUrl;
    }

    // Update SERP features
    if (dataForSEOData.serpFeatures && dataForSEOData.serpFeatures.length > 0) {
      updateData.serpFeatures = dataForSEOData.serpFeatures;
    }

    // Update total results
    if (dataForSEOData.totalResults !== null && dataForSEOData.totalResults > 0) {
      updateData.totalResults = dataForSEOData.totalResults;
    }

    // Update the keyword
    const updatedKeyword = await prisma.keyword.update({
      where: { id: keywordId },
      data: updateData
    });

    res.json({
      keyword: updatedKeyword,
      serpData: dataForSEOData.serpData,
      positionChanged: updateData.currentPosition !== keyword.currentPosition
    });
  } catch (error: any) {
    console.error("Refresh keyword error:", error);
    if (error.message?.includes("DataForSEO credentials")) {
      return res.status(500).json({ message: error.message });
    }
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get backlinks for a client
router.get("/backlinks/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { lost = "false", sortBy = "domainRating", order = "desc" } = req.query;

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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const whereClause: any = { 
      clientId,
      isLost: lost === "true"
    };

    const backlinks = await prisma.backlink.findMany({
      where: whereClause,
      orderBy: {
        [sortBy as string]: order as "asc" | "desc"
      }
    });

    res.json(backlinks);
  } catch (error) {
    console.error("Fetch backlinks error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get SEO dashboard summary for a client
router.get("/dashboard/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { period = "30" } = req.query;

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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const days = parseInt(period as string);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get latest report
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

    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    let trafficSourceSummary: Awaited<ReturnType<typeof fetchTrafficSourcesFromRankedKeywords>> | null = null;
    try {
      if (client.domain) {
        const targetDomain = normalizeDomain(client.domain);
        if (targetDomain) {
          trafficSourceSummary = await fetchTrafficSourcesFromRankedKeywords(targetDomain, 100, 2840, "English");
        }
      }
    } catch (apiError) {
      console.error("Failed to fetch traffic summary from DataForSEO:", apiError);
    }

    const totalSessionsFromApi = trafficSourceSummary?.totalEstimatedTraffic ?? null;
    const organicSessionsFromApi = trafficSourceSummary?.organicEstimatedTraffic ?? null;
    const averagePositionFromApi = trafficSourceSummary?.averageRank ?? null;

    const totalSessions =
      totalSessionsFromApi ??
      (latestReport ? latestReport.totalSessions : keywordStats._count.id ?? 0);

    const organicSessions =
      organicSessionsFromApi ??
      (latestReport ? latestReport.organicSessions : null);

    const averagePosition =
      averagePositionFromApi ??
      (latestReport?.averagePosition ?? keywordStats._avg.currentPosition ?? null);

    const conversions = latestReport?.conversions ?? null;

    res.json({
      totalSessions,
      organicSessions,
      averagePosition,
      conversions,
      dataSources: {
        traffic: trafficSourceSummary ? "dataforseo" : latestReport ? "seo_report" : "fallback",
        conversions: latestReport ? "seo_report" : "unknown",
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
        avgDomainRating: backlinkStats._avg.domainRating
      },
      topKeywords
    });
  } catch (error) {
    console.error("Fetch SEO dashboard error:", error);
    res.status(500).json({ message: "Internal server error" });
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

    // Permission check - only ADMIN/SUPER_ADMIN can create reports
    const isAdmin = req.user.role === "ADMIN" || req.user.role === "SUPER_ADMIN";
    if (!isAdmin) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Enforce single report per client: upsert by clientId only
    const existing = await prisma.seoReport.findFirst({ where: { clientId } });

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

    // Cleanup: delete any other reports for this client
    await prisma.seoReport.deleteMany({
      where: {
        clientId,
        id: { not: report.id }
      }
    });

    res.json(report);
  } catch (error) {
    console.error("Create/update SEO report error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Fetch historical rank overview from DataForSEO
// Using the Historical Rank Overview endpoint: POST /v3/dataforseo_labs/historical_rank_overview/live
// Returns historical data showing total keywords ranked over time
async function fetchHistoricalRankOverviewFromDataForSEO(
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

  // Calculate date range for last 12 months (including current month)
  // Example: If today is Nov 6, 2025, we want data from Dec 1, 2024 to Nov 6, 2025
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11 (0 = January, 11 = December)
  
  // Calculate 12 months ago (11 months back + current month = 12 months total)
  // If currentMonth is 10 (November), then currentMonth - 11 = -1, which becomes December of previous year
  const twelveMonthsAgo = new Date(currentYear, currentMonth - 11, 1);
  
  // Format dates as YYYY-MM-DD for API
  const dateTo = now.toISOString().split('T')[0]; // Today's date
  const dateFrom = twelveMonthsAgo.toISOString().split('T')[0]; // 12 months ago
  
  console.log(`Requesting historical data from ${dateFrom} to ${dateTo} (12 months)`);

  const requestBody = [{
    target: normalizedDomain,
    location_code: locationCode,
    language_code: languageCode,
    date_from: dateFrom,
    date_to: dateTo,
    correlate: true, // Correlate data with previously obtained datasets for consistency
  }];

  try {
    const response = await fetch("https://api.dataforseo.com/v3/dataforseo_labs/historical_rank_overview/live", {
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

    // Log the full response for debugging
    console.log("DataForSEO Historical Rank Overview API Response:", JSON.stringify(data, null, 2));

    // Parse the response structure
    // DataForSEO API response structure: 
    // data.tasks[0].result[0].items[] - array of historical data points
    // Each item has: date, metrics.organic.count (total keywords), position_distribution, etc.
    if (!data.tasks || data.tasks.length === 0) {
      console.warn("No tasks in API response");
      return [];
    }

    const task = data.tasks[0];
    if (!task.result || task.result.length === 0) {
      console.warn("No result in task");
      return [];
    }

    const result = task.result[0];
    
    // Log the result structure to understand the data format
    console.log("Result structure keys:", Object.keys(result || {}));
    console.log("Result sample (first 2000 chars):", JSON.stringify(result, null, 2).substring(0, 2000));
    
    // Extract historical data points
    // The Historical Rank Overview API returns items array
    // Structure: result.items[] where each item has:
    //   - year: number (e.g., 2021)
    //   - month: number (e.g., 3 for March)
    //   - metrics.organic.count: number (total keywords ranked, e.g., 1499)
    let historicalData = [];
    
    if (result.items && Array.isArray(result.items)) {
      historicalData = result.items;
    } else if (result.historical_data && Array.isArray(result.historical_data)) {
      historicalData = result.historical_data;
    } else if (result.data && Array.isArray(result.data)) {
      historicalData = result.data;
    } else if (Array.isArray(result)) {
      // Sometimes the result itself is an array
      historicalData = result;
    }
    
    console.log(`Found ${historicalData.length} historical data items in API response`);
    
    if (historicalData.length === 0) {
      console.warn("No historical data items found in API response.");
      console.warn("Result structure:", JSON.stringify(result, null, 2));
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

      const formatted = {
        date: `${year}-${String(month).padStart(2, '0')}-01`, // Format as YYYY-MM-DD
        month: month, // 1-12
        year: year,
        totalKeywords: Number(totalKeywords), // Ensure it's a number
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

// Get or fetch ranked keywords for a client
router.get("/ranked-keywords/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { fetch = "false" } = req.query;

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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;

    // Get current month data
    let currentData = await prisma.rankedKeywordsHistory.findUnique({
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

    // If fetch is requested or no current data exists, fetch from DataForSEO
    if (fetch === "true" || !currentData) {
      try {
        const rankedData = await fetchRankedKeywordsFromDataForSEO(
          client.domain,
          2840, // Default to US
          "en" // Default to English
        );

        // Upsert current month data
        currentData = await prisma.rankedKeywordsHistory.upsert({
          where: {
            clientId_month_year: {
              clientId,
              month: currentMonth,
              year: currentYear
            }
          },
          update: {
            totalKeywords: rankedData.totalKeywords,
            updatedAt: new Date()
          },
          create: {
            clientId,
            totalKeywords: rankedData.totalKeywords,
            month: currentMonth,
            year: currentYear
          }
        });
      } catch (error: any) {
        console.error("Failed to fetch ranked keywords from DataForSEO:", error);
        // Continue with existing data if fetch fails
        if (!currentData) {
          return res.status(500).json({ 
            message: "Failed to fetch ranked keywords and no existing data found",
            error: error.message 
          });
        }
      }
    }

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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Fetch historical data from DataForSEO Historical Rank Overview API
    try {
      console.log(`Fetching historical data for domain: ${client.domain}`);
      const historicalData = await fetchHistoricalRankOverviewFromDataForSEO(
        client.domain,
        2840, // Default to US
        "en" // Default to English
      );

      console.log(`Received ${historicalData.length} data points from API`);

      if (historicalData.length === 0) {
        console.warn("No historical data returned from API, falling back to database");
        throw new Error("No historical data from API");
      }

      // Group by month and year, taking the latest value for each month
      // This handles cases where there are multiple data points per month (e.g., weekly snapshots)
      const monthlyData: Record<string, { month: number; year: number; totalKeywords: number; date: string }> = {};
      
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
            date: item.date
          };
        }
      });

      console.log(`Grouped into ${Object.keys(monthlyData).length} unique months`);

      // Convert to array and sort by year and month (chronologically)
      const sortedData = Object.values(monthlyData).sort((a, b) => {
        if (a.year !== b.year) {
          return a.year - b.year;
        }
        return a.month - b.month;
      });

      // Create a complete 12-month dataset (from 12 months ago to current month)
      // Fill in missing months with 0 or use the previous month's value
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1; // 1-12
      
      const completeData: Array<{ month: number; year: number; totalKeywords: number; date: string }> = [];
      
      // Generate all 12 months
      for (let i = 11; i >= 0; i--) {
        const targetDate = new Date(currentYear, currentMonth - 1 - i, 1);
        const targetYear = targetDate.getFullYear();
        const targetMonth = targetDate.getMonth() + 1;
        const key = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
        
        const existingData = monthlyData[key];
        if (existingData) {
          completeData.push(existingData);
        } else {
          // Fill missing months with 0 or use previous month's value
          const prevValue = completeData.length > 0 
            ? completeData[completeData.length - 1].totalKeywords 
            : 0;
          completeData.push({
            month: targetMonth,
            year: targetYear,
            totalKeywords: 0, // Use 0 for missing months to show accurate data
            date: `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
          });
        }
      }

      // Log for debugging
      console.log(`Historical data for ${client.domain}: ${completeData.length} months prepared`);
      console.log("Monthly data:", completeData.map(d => `${d.year}-${String(d.month).padStart(2, '0')}: ${d.totalKeywords}`).join(", "));

      res.json(completeData);
    } catch (apiError: any) {
      console.error("Failed to fetch historical data from DataForSEO:", apiError);
      console.error("API Error details:", apiError.message);
      
      // Fallback to database if API fails
      const allHistory = await prisma.rankedKeywordsHistory.findMany({
        where: { clientId },
        orderBy: [
          { year: "asc" },
          { month: "asc" }
        ]
      });

      console.log(`Fallback: Found ${allHistory.length} months in database`);

      // Create complete 12-month dataset from database data
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      
      const dbMonthlyData: Record<string, { month: number; year: number; totalKeywords: number; date: string }> = {};
      allHistory.forEach((item) => {
        const key = `${item.year}-${String(item.month).padStart(2, '0')}`;
        dbMonthlyData[key] = {
          month: item.month,
          year: item.year,
          totalKeywords: item.totalKeywords,
          date: `${item.year}-${String(item.month).padStart(2, '0')}-01`
        };
      });

      const completeData: Array<{ month: number; year: number; totalKeywords: number; date: string }> = [];
      
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
            date: `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
          });
        }
      }

      console.log(`Fallback: Returning ${completeData.length} months (${completeData.filter(d => d.totalKeywords > 0).length} with data)`);
      res.json(completeData);
    }
  } catch (error: any) {
    console.error("Get ranked keywords history error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/backlinks/:clientId/timeseries", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { range = "30", group = "day" } = req.query;

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
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    const hasAccess = isAdmin || clientAgencyIds.some((id) => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    const targetDomain = normalizeDomain(client.domain);

    const now = new Date();
    const rangeNumber = Number(range) || 30;
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - rangeNumber + 1);

    const dateTo = now.toISOString().split("T")[0];
    const dateFrom = fromDate.toISOString().split("T")[0];
    const summary = await fetchBacklinkTimeseriesSummaryFromDataForSEO(
      targetDomain,
      dateFrom,
      dateTo,
      (group as "day" | "week" | "month") || "day"
    );

    res.json(summary);
  } catch (error: any) {
    console.error("Backlink timeseries fetch error:", error);
    res.status(500).json({ message: "Failed to fetch backlink timeseries data" });
  }
});

router.get("/top-pages/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { limit = "10", locationCode = "2840", language = "English" } = req.query;

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
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    const hasAccess = isAdmin || clientAgencyIds.some((id) => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    const targetDomain = normalizeDomain(client.domain);

    const topPages = await fetchRelevantPagesFromDataForSEO(
      targetDomain,
      Number(limit) || 10,
      Number(locationCode) || 2840,
      String(language || "English")
    );

    res.json(topPages);
  } catch (error: any) {
    console.error("Top pages fetch error:", error);
    res.status(500).json({ message: "Failed to fetch top pages data" });
  }
});

router.get("/traffic-sources/:clientId", authenticateToken, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { limit = "100", locationCode = "2840", language = "English" } = req.query;

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
    const userMemberships = await prisma.userAgency.findMany({
      where: { userId: req.user.userId },
      select: { agencyId: true },
    });
    const userAgencyIds = userMemberships.map((m) => m.agencyId);
    const clientAgencyIds = client.user.memberships.map((m) => m.agencyId);
    const hasAccess = isAdmin || clientAgencyIds.some((id) => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    const targetDomain = normalizeDomain(client.domain);

    const result = await fetchTrafficSourcesFromRankedKeywords(
      targetDomain,
      Number(limit) || 100,
      Number(locationCode) || 2840,
      String(language || "English")
    );

    res.json(result);
  } catch (error: any) {
    console.error("Traffic sources fetch error:", error);
    res.status(500).json({ message: "Failed to fetch traffic sources data" });
  }
});

router.get("/keyword-research", authenticateToken, async (req, res) => {
  try {
    const { keyword, limit = "50", locationCode = "2840", languageCode = "en" } = req.query;

    if (!keyword || typeof keyword !== "string" || keyword.trim().length === 0) {
      return res.status(400).json({ message: "Keyword query is required" });
    }

    const parsedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const parsedLocationCode = Number(locationCode) || 2840;
    const parsedLanguageCode = typeof languageCode === "string" ? languageCode : "en";

    const suggestions = await fetchKeywordSuggestionsFromDataForSEO(
      keyword.trim(),
      parsedLimit,
      parsedLocationCode,
      parsedLanguageCode
    );

    res.json(suggestions);
  } catch (error: any) {
    console.error("Keyword research fetch error:", error);
    res.status(500).json({ message: "Failed to fetch keyword research suggestions" });
  }
});

// Get agency dashboard summary (aggregated data from all clients)
router.get("/agency/dashboard", authenticateToken, async (req, res) => {
  try {
    const { period = "30" } = req.query;
    const days = parseInt(period as string) || 30;

    // Get user's accessible clients
    let accessibleClientIds: string[] = [];
    
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
      const agencyIds = userMemberships.map(m => m.agencyId);
      
      const clients = await prisma.client.findMany({
        where: {
          user: {
            memberships: {
              some: { agencyId: { in: agencyIds } },
            },
          },
        },
        select: { id: true },
      });
      accessibleClientIds = clients.map(c => c.id);
    }

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
      });
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
            domain: true,
          },
        },
      },
    });

    // Get top pages across all clients using DataForSEO
    const topPagesData: any[] = [];
    const allClients = await prisma.client.findMany({
      where: { 
        id: { in: accessibleClientIds }
      },
      select: { id: true, domain: true },
      take: 5, // Limit to avoid too many API calls
    });
    
    // Filter clients with valid domains
    const clientsWithDomains = allClients.filter(client => client.domain && client.domain.trim() !== "");

    // Fetch top pages for each client
    for (const client of clientsWithDomains) {
      if (client.domain) {
        try {
          const normalizeDomain = (domain: string) => {
            return domain
              .replace(/^https?:\/\//, "")
              .replace(/^www\./, "")
              .replace(/\/$/, "")
              .toLowerCase();
          };
          const targetDomain = normalizeDomain(client.domain);
          const pages = await fetchRelevantPagesFromDataForSEO(targetDomain, 5, 2840, "English");
          topPagesData.push(...pages.map(page => ({
            ...page,
            clientId: client.id,
            clientDomain: client.domain,
          })));
        } catch (error) {
          console.error(`Failed to fetch top pages for client ${client.id}:`, error);
        }
      }
    }

    // Sort top pages by estimated traffic and take top 5
    const topPages = topPagesData
      .sort((a, b) => (b.organic?.etv || 0) - (a.organic?.etv || 0))
      .slice(0, 5)
      .map(page => ({
        url: page.url,
        clicks: Math.round(page.organic?.etv || 0),
        impressions: (page.organic?.count || 0) * 100, // Estimate
        ctr: 5.0, // Default CTR
        position: page.organic?.pos1 > 0 ? 1 : (page.organic?.pos2_3 > 0 ? 2.5 : 5),
      }));

    // Calculate organic traffic from top pages
    const organicTraffic = topPagesData.reduce((sum, page) => sum + (page.organic?.etv || 0), 0);

    // Format recent rankings
    const formattedRecentRankings = recentRankings.map(kw => ({
      keyword: kw.keyword,
      position: kw.currentPosition!,
      change: kw.previousPosition ? kw.currentPosition! - kw.previousPosition : 0,
      url: kw.googleUrl || "",
      volume: kw.searchVolume || 0,
    }));

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
    });
  } catch (error: any) {
    console.error("Agency dashboard fetch error:", error);
    res.status(500).json({ message: error?.message || "Failed to fetch agency dashboard data" });
  }
});

export default router;

