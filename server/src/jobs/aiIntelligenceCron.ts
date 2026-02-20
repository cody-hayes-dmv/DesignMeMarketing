import { prisma } from "../lib/prisma.js";
import type { Client } from "@prisma/client";
import {
  fetchAiSearchMentions,
  fetchAiKeywordSearchVolume,
} from "../routes/seo.js";

// NOTE: These cron-style jobs are intended to be wired into a real scheduler
// (node-cron, bull, external worker, etc.). For now they are plain functions
// you can call from a runner script.

async function getActiveClients(): Promise<Client[]> {
  return prisma.client.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, domain: true },
  }) as any;
}

export async function updateAIMentions(date: Date = new Date()): Promise<void> {
  const clients = await getActiveClients();
  const dateRecorded = new Date(date.toDateString());

  for (const client of clients) {
    const domain = (client.domain || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

    // Search mentions (per-query data)
    const mentions = await fetchAiSearchMentions(domain, "domain", 2840, "en", 100);

    for (const item of mentions) {
      const query = item?.question || "";
      const platformStr = String(item?.platform || "google").toLowerCase();
      let platform = "google_ai_overview";
      if (platformStr.includes("chatgpt") || platformStr.includes("chat_gpt")) platform = "chatgpt";
      else if (platformStr.includes("perplexity")) platform = "perplexity";

      const sources = Array.isArray(item?.sources) ? item.sources : [];
      const firstSource = sources[0] || null;
      const mentionsCount = sources.length;

      await prisma.aiMention.create({
        data: {
          clientId: client.id,
          query,
          platform,
          mentions: mentionsCount,
          aiSearchVolume: Number(item?.ai_search_volume || 0),
          impressions: Number(item?.impressions || 0) || null,
          snippet: firstSource?.snippet || (item?.answer || null),
          referencedUrl: firstSource?.url || null,
          mentionPosition: firstSource ? 1 : null,
          dateRecorded,
        },
      });
    }

    // Aggregated metrics (per-domain totals by platform) could be stored
    // in a separate table if needed; for now this job focuses on ai_mentions.
  }
}

export async function updateCompetitorAI(date: Date = new Date()): Promise<void> {
  const clients = await getActiveClients();
  const dateRecorded = new Date(date.toDateString());

  for (const client of clients) {
    const locationCode = 2840;
    const languageCode = "en";

    // Re-use the same logic as the AI Intelligence endpoint:
    // 1) derive competitor domains from SERP cache
    // 2) fetch aggregated metrics for client + competitors via DataForSEO
    const competitorDomainsResult: any = await Promise.allSettled([
      // Dynamic import to avoid circular dependency at module load time
      import("../routes/seo"),
    ]);

    if (competitorDomainsResult[0].status !== "fulfilled") {
      // If we can't load helpers from seo route, skip this run
      // (better to fail soft than break the whole cron)
      // eslint-disable-next-line no-continue
      continue;
    }

    const seoHelpers = competitorDomainsResult[0].value as any;
    const extractCompetitorDomainsFromSerp = seoHelpers.extractCompetitorDomainsFromSerp as (clientId: string, limit?: number) => Promise<string[]>;
    const fetchCompetitorAiMetrics = seoHelpers.fetchCompetitorAiMetrics as (
      competitorDomains: string[],
      locationCode: number,
      languageCode: string,
      dateFrom: string,
      dateTo: string
    ) => Promise<Map<string, any>>;

    const competitorDomains = await extractCompetitorDomainsFromSerp(client.id, 10);
    if (!competitorDomains || competitorDomains.length === 0) {
      // Nothing to store for this client
      // eslint-disable-next-line no-continue
      continue;
    }

    // Use the last 30 days as the comparison window for stored competitor metrics
    const endDate = new Date(dateRecorded);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 30);
    const formatDateForAPI = (d: Date) => d.toISOString().split("T")[0];
    const dateFrom = formatDateForAPI(startDate);
    const dateTo = formatDateForAPI(endDate);

    const metricsMap = await fetchCompetitorAiMetrics(competitorDomains, locationCode, languageCode, dateFrom, dateTo);

    for (const domain of competitorDomains) {
      const key = domain.toLowerCase();
      const metrics = metricsMap.get(key);
      await prisma.aiCompetitor.create({
        data: {
          clientId: client.id,
          competitorDomain: domain,
          mentions: metrics?.totalMentions ?? 0,
          aiSearchVolume: metrics?.aiSearchVolume ?? 0,
          platform: "google_ai_overview", // current aggregated_metrics call is platform="google"
          dateRecorded,
        },
      });
    }
  }
}

export async function updateAISearchVolumeTrends(date: Date = new Date()): Promise<void> {
  const clients = await getActiveClients();
  const dateRecorded = new Date(date.toDateString());

  for (const client of clients) {
    const keywords = await prisma.targetKeyword.findMany({
      where: { clientId: client.id },
      select: { keyword: true },
      take: 200,
    });
    const keywordStrings = keywords.map((k: { keyword: string }) => k.keyword).filter(Boolean) as string[];
    if (keywordStrings.length === 0) continue;

    const keywordVolume = await fetchAiKeywordSearchVolume(keywordStrings, 2840, "en");

    for (const item of keywordVolume) {
      const keyword = item.keyword;
      for (const m of item.aiMonthlySearches || []) {
        await prisma.aiSearchVolumeTrend.upsert({
          where: {
            // Composite keys are not defined, so emulate via unique combination hash if needed.
            // For now, we'll just insert duplicates guarded by client/keyword/year/month in app logic.
            id: `${client.id}_${keyword}_${m.year}_${m.month}`,
          } as any,
          update: {
            aiSearchVolume: m.aiSearchVolume,
            dateRecorded,
          },
          create: {
            clientId: client.id,
            keyword,
            year: m.year,
            month: m.month,
            aiSearchVolume: m.aiSearchVolume,
            dateRecorded,
          },
        });
      }
    }
  }
}

