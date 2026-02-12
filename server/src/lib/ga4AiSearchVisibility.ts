import { prisma } from "./prisma.js";
import { getAnalyticsClient } from "./ga4.js";

type ProviderKey = "chatgpt" | "gemini";

export type AiSearchVisibilityRow = {
  name: "ChatGPT" | "Gemini";
  visibility: number; // percent of total sessions (0-100)
  mentions: number; // sessions
  citedPages: number; // unique landing pages
};

function matchProvider(source: string): ProviderKey | null {
  const s = (source || "").toLowerCase();
  if (!s) return null;
  if (s.includes("chatgpt") || s.includes("openai") || s.includes("chat.openai") || s.includes("chatgpt.com")) return "chatgpt";
  if (s.includes("gemini") || s.includes("bard")) return "gemini";
  return null;
}

export async function fetchGA4AiSearchVisibility(
  clientId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  totalSessions: number;
  providers: Record<
    ProviderKey,
    {
      sessions: number;
      users: number;
      citedPages: number;
    }
  >;
}> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { ga4PropertyId: true },
  });

  if (!client?.ga4PropertyId) {
    return {
      totalSessions: 0,
      providers: {
        chatgpt: { sessions: 0, users: 0, citedPages: 0 },
        gemini: { sessions: 0, users: 0, citedPages: 0 },
      },
    };
  }

  const analytics = await getAnalyticsClient(clientId);
  const propertyId = client.ga4PropertyId.startsWith("properties/") ? client.ga4PropertyId : `properties/${client.ga4PropertyId}`;
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  const providers: Record<ProviderKey, { sessions: number; users: number; citedPages: Set<string> }> = {
    chatgpt: { sessions: 0, users: 0, citedPages: new Set<string>() },
    gemini: { sessions: 0, users: 0, citedPages: new Set<string>() },
  };

  // Total sessions (for percent visibility)
  let totalSessions = 0;
  try {
    const [totalsRes] = await analytics.runReport({
      property: propertyId,
      dateRanges: [{ startDate: startDateStr, endDate: endDateStr }],
      metrics: [{ name: "sessions" }],
    });
    totalSessions = Number(totalsRes?.rows?.[0]?.metricValues?.[0]?.value || 0) || 0;
  } catch {
    totalSessions = 0;
  }

  // Sessions/users by source
  try {
    const [sourcesRes] = await analytics.runReport({
      property: propertyId,
      dateRanges: [{ startDate: startDateStr, endDate: endDateStr }],
      dimensions: [{ name: "sessionManualSource" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 200,
    });

    const rows: any[] = Array.isArray(sourcesRes?.rows) ? sourcesRes.rows : [];
    for (const row of rows) {
      const source = row?.dimensionValues?.[0]?.value || "";
      const provider = matchProvider(source);
      if (!provider) continue;
      const sessions = Number(row?.metricValues?.[0]?.value || 0) || 0;
      const users = Number(row?.metricValues?.[1]?.value || 0) || 0;
      providers[provider].sessions += sessions;
      providers[provider].users += users;
    }
  } catch (e) {
    console.warn("[GA4] AI Search visibility: failed to fetch sessions by source", e);
  }

  // Landing pages (cited pages proxy) by source+landing page
  try {
    const [pagesRes] = await analytics.runReport({
      property: propertyId,
      dateRanges: [{ startDate: startDateStr, endDate: endDateStr }],
      dimensions: [{ name: "sessionManualSource" }, { name: "landingPagePlusQueryString" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 5000,
    });
    const rows: any[] = Array.isArray(pagesRes?.rows) ? pagesRes.rows : [];
    for (const row of rows) {
      const source = row?.dimensionValues?.[0]?.value || "";
      const provider = matchProvider(source);
      if (!provider) continue;
      const landing = row?.dimensionValues?.[1]?.value || "";
      if (landing) providers[provider].citedPages.add(landing);
    }
  } catch (e) {
    console.warn("[GA4] AI Search visibility: failed to fetch landing pages", e);
  }

  // Sessions by country (for AI sources only)
  const countriesByCode = new Map<string, { visibility: number; mentions: number }>();
  try {
    const [countryRes] = await analytics.runReport({
      property: propertyId,
      dateRanges: [{ startDate: startDateStr, endDate: endDateStr }],
      dimensions: [{ name: "sessionManualSource" }, { name: "country" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 500,
    });
    const aiSessionsTotal = providers.chatgpt.sessions + providers.gemini.sessions;
    const rows: any[] = Array.isArray(countryRes?.rows) ? countryRes.rows : [];
    for (const row of rows) {
      const source = row?.dimensionValues?.[0]?.value || "";
      const provider = matchProvider(source);
      if (!provider) continue;
      const countryCode = (row?.dimensionValues?.[1]?.value || "").toUpperCase() || "XX";
      const sessions = Number(row?.metricValues?.[0]?.value || 0) || 0;
      const existing = countriesByCode.get(countryCode) ?? { visibility: 0, mentions: 0 };
      existing.mentions += sessions;
      countriesByCode.set(countryCode, existing);
    }
    if (aiSessionsTotal > 0) {
      for (const [code, data] of countriesByCode.entries()) {
        data.visibility = Math.round((data.mentions / aiSessionsTotal) * 100);
        countriesByCode.set(code, data);
      }
    }
  } catch (e) {
    console.warn("[GA4] AI Search visibility: failed to fetch sessions by country", e);
  }

  return {
    totalSessions,
    providers: {
      chatgpt: {
        sessions: providers.chatgpt.sessions,
        users: providers.chatgpt.users,
        citedPages: providers.chatgpt.citedPages.size,
      },
      gemini: {
        sessions: providers.gemini.sessions,
        users: providers.gemini.users,
        citedPages: providers.gemini.citedPages.size,
      },
    },
    countries: Array.from(countriesByCode.entries())
      .map(([countryCode, data]) => ({ countryCode, visibility: data.visibility, mentions: data.mentions }))
      .filter((c) => c.mentions > 0)
      .sort((a, b) => b.mentions - a.mentions),
  };
}

