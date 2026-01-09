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

    // Permission check - ADMIN/SUPER_ADMIN and AGENCY users can access reports
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
      // GA4 metrics from database
      activeUsers: report.activeUsers,
      eventCount: report.eventCount,
      newUsers: report.newUsers,
      keyEvents: report.keyEvents,
      // Email and sharing
      recipients: report.recipients,
      emailSubject: report.emailSubject,
      sentAt: report.sentAt,
      // Timestamps
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      // Schedule info
      scheduleId: report.scheduleId,
      hasActiveSchedule: report.schedule?.isActive || false,
      scheduleRecipients: Array.isArray(report.schedule?.recipients as any)
        ? (report.schedule!.recipients as any)
        : [],
      scheduleEmailSubject: report.schedule?.emailSubject || null,
    });
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
        const { getGA4MetricsFromDB, fetchGA4TrafficData, fetchGA4EventsData } = await import("../lib/ga4.js");
        
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
            eventCount: dbMetrics.eventCount,
            newUsers: dbMetrics.newUsers,
            keyEvents: dbMetrics.keyEvents,
            newUsersTrend: dbMetrics.newUsersTrend,
            activeUsersTrend: dbMetrics.activeUsersTrend,
          };
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
      averagePosition,
      conversions,
      // GA4 metrics
      activeUsers,
      eventCount,
      newUsers,
      keyEvents,
      newUsersTrend: ga4Data?.newUsersTrend || null,
      activeUsersTrend: ga4Data?.activeUsersTrend || null,
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
        avgDomainRating: backlinkStats._avg.domainRating
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
    const tokenData = verifyShareToken(token);
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

// Share endpoint for backlinks list
router.get("/share/:token/backlinks", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = verifyShareToken(token);
    if (!tokenData) {
      return res.status(401).json({ message: "Invalid or expired share link" });
    }

    const clientId = tokenData.clientId;
    const { lost = "false", limit = "50" } = req.query;

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, domain: true }
    });

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const backlinks = await prisma.backlink.findMany({
      where: {
        clientId,
        isLost: lost === "true"
      },
      orderBy: {
        domainRating: "desc"
      },
      take: Number(limit) || 50,
    });

    res.json(backlinks);
  } catch (error: any) {
    console.error("Share backlinks fetch error:", error);
    res.status(500).json({ message: "Failed to fetch backlinks data" });
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
    const tokenData = verifyShareToken(token);
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

    // Read from database only
    const trafficSources = await prisma.trafficSource.findMany({
      where: { clientId },
      orderBy: { value: "desc" },
    });

    const breakdown = trafficSources.map((ts) => ({
      name: ts.name,
      value: ts.value,
    })).filter((item) => item.value > 0);

    res.json(breakdown);
  } catch (error: any) {
    console.error("Share traffic sources fetch error:", error);
    res.status(500).json({ message: "Failed to fetch traffic sources data" });
  }
});

// Share endpoint for top events
router.get("/share/:token/events/top", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = verifyShareToken(token);
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
    const { fetchGA4TopEvents } = await import("../lib/ga4TopEvents.js");
    const eventsLimit = parseInt(limit as string) || 10;
    const events = await fetchGA4TopEvents(clientId, startDate, endDate, eventsLimit);

    res.json(events);
  } catch (error: any) {
    console.error("Share top events fetch error:", error);
    res.status(500).json({ message: "Failed to fetch top events data" });
  }
});

// Share endpoint for ranked keywords summary
router.get("/share/:token/ranked-keywords", async (req, res) => {
  try {
    const { token } = req.params;
    const tokenData = verifyShareToken(token);
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
    const tokenData = verifyShareToken(token);
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

    const allHistory = await prisma.rankedKeywordsHistory.findMany({
      where: { clientId },
      orderBy: [
        { year: "asc" },
        { month: "asc" }
      ]
    });

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

// Refresh keyword data from DataForSEO (SUPER_ADMIN only)
router.post("/keywords/:clientId/:keywordId/refresh", authenticateToken, async (req, res) => {
  try {
    // Only SUPER_ADMIN can refresh data
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only Super Admin can refresh data." });
    }

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
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client || !client.domain) {
      return res.status(404).json({ message: "Client not found or has no domain" });
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
      if (trafficSourceSummary) {
        await Promise.all(
          trafficSourceSummary.breakdown.map((item) =>
            prisma.trafficSource.create({
              data: {
                clientId,
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
      }
    } catch (error) {
      console.error("Failed to refresh traffic sources:", error);
    }

    // Refresh ranked keywords count (already saved via ranked-keywords endpoint)
    let rankedKeywordsCount = 0;
    try {
      const rankedData = await fetchRankedKeywordsFromDataForSEO(targetDomain, 2840, "en");
      rankedKeywordsCount = rankedData.totalKeywords || 0;
      
      // Update ranked keywords history (current month)
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      
      await prisma.rankedKeywordsHistory.upsert({
        where: {
          clientId_month_year: {
            clientId,
            month: currentMonth,
            year: currentYear,
          },
        },
        update: {
          totalKeywords: rankedKeywordsCount,
        },
        create: {
          clientId,
          totalKeywords: rankedKeywordsCount,
          month: currentMonth,
          year: currentYear,
        },
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

    res.json({
      message: "Dashboard data refreshed successfully",
      trafficSourceSummary,
      rankedKeywordsCount,
      ga4Refreshed,
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
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client || !client.domain) {
      return res.status(404).json({ message: "Client not found or has no domain" });
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
            rawData: page.raw || null,
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
            rawData: page.raw || null,
          },
        })
      )
    );

    res.json({
      message: "Top pages refreshed successfully",
      pages: savedPages.length,
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
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client || !client.domain) {
      return res.status(404).json({ message: "Client not found or has no domain" });
    }

    const normalizeDomain = (domain: string) => {
      return domain
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "")
        .toLowerCase();
    };

    const targetDomain = normalizeDomain(client.domain);
    
    // Get date range (last 30 days)
    const dateTo = new Date();
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 30);

    const summary = await fetchBacklinkTimeseriesSummaryFromDataForSEO(
      targetDomain,
      dateFrom.toISOString().split('T')[0],
      dateTo.toISOString().split('T')[0],
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
        const date = new Date(item.date);
        return prisma.backlinkTimeseries.create({
          data: {
            clientId,
            date,
            newBacklinks: item.newBacklinks,
            lostBacklinks: item.lostBacklinks,
            newReferringDomains: item.newReferringDomains,
            lostReferringDomains: item.lostReferringDomains,
            newReferringMainDomains: item.newReferringMainDomains,
            lostReferringMainDomains: item.lostReferringMainDomains,
            rawData: item.raw || null,
          },
        });
      })
    );

    res.json({
      message: "Backlinks refreshed successfully",
      items: savedItems.length,
    });
  } catch (error: any) {
    console.error("Refresh backlinks error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh agency dashboard data from DataForSEO (SUPER_ADMIN only)
router.post("/agency/dashboard/refresh", authenticateToken, async (req, res) => {
  try {
    // Only SUPER_ADMIN can refresh data
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only Super Admin can refresh data." });
    }

    // Get all clients
    const allClients = await prisma.client.findMany({
      where: {
        domain: { not: null as any },
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

    const refreshedClients: any[] = [];

    // Refresh data for each client
    for (const client of allClients) {
      if (client.domain) {
        try {
          const targetDomain = normalizeDomain(client.domain);
          
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
          
          refreshedClients.push({
            clientId: client.id,
            domain: client.domain,
            status: "success",
          });
        } catch (error) {
          console.error(`Failed to refresh data for client ${client.id}:`, error);
          refreshedClients.push({
            clientId: client.id,
            domain: client.domain,
            status: "error",
          });
        }
      }
    }

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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
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
        const { getGA4MetricsFromDB, fetchGA4TrafficData, fetchGA4EventsData } = await import("../lib/ga4.js");
        
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
            eventCount: dbMetrics.eventCount,
            newUsers: dbMetrics.newUsers,
            keyEvents: dbMetrics.keyEvents,
            newUsersTrend: dbMetrics.newUsersTrend,
            activeUsersTrend: dbMetrics.activeUsersTrend,
          };
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
    const totalUsers = activeUsers; // Map activeUsers to totalUsers for compatibility
    const firstTimeVisitors = newUsers; // Map newUsers to firstTimeVisitors for compatibility
    // Engaged Visitors is the same as Engaged Sessions from GA4
    const engagedVisitors = ga4Data?.engagedSessions ?? null;
    const totalUsersTrend = activeUsersTrend; // Map activeUsersTrend to totalUsersTrend for compatibility

    const averagePosition =
      trafficSourceSummary?.averageRank ??
      (latestReport?.averagePosition ?? keywordStats._avg.currentPosition ?? null);

    const conversions = ga4Data?.conversions ??
      (latestReport?.conversions ?? null);

    res.json({
      totalSessions,
      organicSessions,
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
        avgDomainRating: backlinkStats._avg.domainRating
      },
      topKeywords,
      ga4Events: ga4EventsData?.events || null
    });
  } catch (error) {
    console.error("Fetch SEO dashboard error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get top events for a client
router.get("/events/:clientId/top", authenticateToken, async (req, res) => {
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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

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
      const { fetchGA4TopEvents } = await import("../lib/ga4TopEvents.js");
      const eventsLimit = parseInt(limit as string) || 10;
      const events = await fetchGA4TopEvents(clientId, startDate, endDate, eventsLimit);
      res.json(events);
    } catch (fetchError: any) {
      console.error("Error fetching top events:", fetchError);
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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

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
      console.error("Error fetching visitor sources:", fetchError);
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
            recipients: scheduleData.recipients as any,
            nextRunAt
          }
        })
      : await prisma.reportSchedule.create({
          data: {
            ...scheduleData,
            recipients: scheduleData.recipients as any,
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

    // Send email to recipients
    const recipients = schedule.recipients as string[];
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
          recipients: recipients as any,
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

    const recipientsList = recipients || (report.recipients as string[] || []);
    if (!recipientsList || recipientsList.length === 0) {
      return res.status(400).json({ message: "No recipients specified" });
    }

    // Generate email HTML and PDF
    const { generateReportEmailHTML, generateReportPDFBuffer } = await import("../lib/reportScheduler.js");
    const emailHtml = generateReportEmailHTML(report, report.client);
    const pdfBuffer = await generateReportPDFBuffer(report, report.client);

    // Send emails with PDF attachment
    const { sendEmail } = await import("../lib/email.js");
    const emailPromises = recipientsList.map((email: string) =>
      sendEmail({
        to: email,
        subject: emailSubject || `SEO Report - ${report.client.name} - ${report.period.charAt(0).toUpperCase() + report.period.slice(1)}`,
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
        recipients: recipientsList as any,
        emailSubject: emailSubject || `SEO Report - ${report.client.name} - ${report.period.charAt(0).toUpperCase() + report.period.slice(1)}`
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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DataForSEO API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log("AAAAAAAAAAAAAAAAAAAA", data.tasks[0])
    const items: any[] =
      data?.tasks?.[0]?.result?.[0]?.items && Array.isArray(data.tasks[0].result[0].items)
        ? data.tasks[0].result[0].items
        : [];

    return items.map((item) => {
      const keywordInfo = item?.keyword_info || {};
      const serpInfo = item?.serp_info || null;
      
      // Extract SERP features/types
      const serpItemTypes = serpInfo?.serp_item_types || [];
      
      // Extract ranking URL from SERP info (first organic result)
      let googleUrl = null;
      let googlePosition = null;
      
      if (serpInfo) {
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
            googleUrl = organicResult.url || null;
            googlePosition = organicResult.rank_group || organicResult.rank_absolute || null;
          }
        }
        
        // Alternative: check if serpInfo has direct URL reference
        if (!googleUrl && serpInfo.relevant_url) {
          googleUrl = serpInfo.relevant_url;
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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Read from database only - no API calls for agency users
    // Get all historical data from database
    const allHistory = await prisma.rankedKeywordsHistory.findMany({
      where: { clientId },
      orderBy: [
        { year: "asc" },
        { month: "asc" }
      ]
    });

    console.log(`Found ${allHistory.length} months in database`);

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

    console.log(`Returning ${completeData.length} months (${completeData.filter(d => d.totalKeywords > 0).length} with data)`);
    res.json(completeData);
  } catch (error: any) {
    console.error("Get ranked keywords history error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Refresh ranked keywords history from DataForSEO (SUPER_ADMIN only)
router.post("/ranked-keywords/:clientId/history/refresh", authenticateToken, async (req, res) => {
  try {
    // Only SUPER_ADMIN can refresh data
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only Super Admin can refresh data." });
    }

    const { clientId } = req.params;
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client || !client.domain) {
      return res.status(404).json({ message: "Client not found or has no domain" });
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
        return res.status(404).json({ message: "No historical data returned from API" });
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
            },
            create: {
              clientId,
              month: item.month,
              year: item.year,
              totalKeywords: item.totalKeywords,
            },
          })
        )
      );

      console.log(`Historical data for ${client.domain}: ${completeData.length} months saved to database`);
      res.json({
        message: "Ranked keywords history refreshed successfully",
        months: completeData.length,
      });
    } catch (apiError: any) {
      console.error("Failed to fetch historical data from DataForSEO:", apiError);
      res.status(500).json({ 
        message: "Failed to refresh historical data",
        error: apiError.message 
      });
    }
  } catch (error: any) {
    console.error("Get ranked keywords history error:", error);
    res.status(500).json({ message: "Internal server error" });
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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

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
    const hasAccess = isAdmin || clientAgencyIds.some((id) => userAgencyIds.includes(id));

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
          // Use new metrics
          ga4Summary.websiteVisitors += data.activeUsers || 0;
          ga4Summary.organicSessions += data.eventCount || 0;
          ga4Summary.firstTimeVisitors += data.newUsers || 0;
          ga4Summary.engagedVisitors += data.keyEvents || 0;
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
      ga4Summary,
    });
  } catch (error: any) {
    console.error("Agency dashboard fetch error:", error);
    res.status(500).json({ message: error?.message || "Failed to fetch agency dashboard data" });
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

    if (!hasAccess) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Get tracked keywords (from keywords table) for this client
    const trackedKeywords = await prisma.keyword.findMany({
      where: { clientId },
      select: { keyword: true },
    });
    
    // Create a set of tracked keyword strings for fast lookup
    const trackedKeywordSet = new Set(trackedKeywords.map(k => k.keyword.toLowerCase()));

    // Get target keywords from database
    const allTargetKeywords = await prisma.targetKeyword.findMany({
      where: { clientId },
      orderBy: [
        { searchVolume: "desc" },
        { keyword: "asc" }
      ],
    });

    // Filter to only include target keywords that are also tracked
    const targetKeywords = allTargetKeywords.filter(tk => 
      trackedKeywordSet.has(tk.keyword.toLowerCase())
    );

    res.json(targetKeywords);
  } catch (error: any) {
    console.error("Get target keywords error:", error);
    res.status(500).json({ message: "Internal server error" });
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

    // Create target keyword
    const targetKeyword = await prisma.targetKeyword.create({
      data: {
        clientId,
        keyword: keywordData.keyword,
        searchVolume: keywordData.searchVolume || null,
        cpc: keywordData.cpc || null,
        competition: keywordData.competition || null,
        competitionValue: keywordData.competitionValue || null,
        locationCode: keywordData.locationCode || null,
        locationName: keywordData.locationName || null,
        languageCode: keywordData.languageCode || null,
        languageName: keywordData.languageName || null,
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
    const hasAccess = isAdmin || clientAgencyIds.some(id => userAgencyIds.includes(id));

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
    // Only SUPER_ADMIN can refresh data
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only Super Admin can refresh data." });
    }

    const { clientId } = req.params;
    const client = await prisma.client.findUnique({
      where: { id: clientId },
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

    // Fetch keywords from DataForSEO API
    const keywords = await fetchKeywordsForSiteFromDataForSEO(targetDomain, 100, 2840, "English");

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
            monthlySearches: kw.monthlySearches ? kw.monthlySearches as any : null,
            keywordInfo: kw.keywordInfo ? kw.keywordInfo as any : null,
            locationCode: kw.locationCode || null,
            locationName: locationName,
            languageCode: kw.languageCode || null,
            languageName: languageName,
            serpInfo: kw.serpInfo ? kw.serpInfo as any : null,
            serpItemTypes: kw.serpItemTypes ? kw.serpItemTypes as any : null,
            googleUrl: kw.googleUrl,
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
            monthlySearches: kw.monthlySearches ? kw.monthlySearches as any : null,
            keywordInfo: kw.keywordInfo ? kw.keywordInfo as any : null,
            locationCode: kw.locationCode || null,
            locationName: locationName,
            languageCode: kw.languageCode || null,
            languageName: languageName,
            serpInfo: kw.serpInfo ? kw.serpInfo as any : null,
            serpItemTypes: kw.serpItemTypes ? kw.serpItemTypes as any : null,
            googleUrl: kw.googleUrl,
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

