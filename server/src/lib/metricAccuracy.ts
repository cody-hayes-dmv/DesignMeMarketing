import { z } from "zod";

export type AccuracyReason =
  | "invalid_non_finite"
  | "missing_value"
  | "non_authoritative_source"
  | "schema_validation_failed";

export type UnavailableMetric = {
  metric: string;
  reason: AccuracyReason;
  source: string;
};

type AccuracyEnvelope = {
  mode: "fail_closed";
  unavailable: UnavailableMetric[];
  isAccurate: boolean;
  checkedAt: string;
};

const accuracyIssueCounters = new Map<string, number>();

function recordAccuracyIssues(route: string, unavailable: UnavailableMetric[]): void {
  for (const item of unavailable) {
    const key = `${route}|${item.metric}|${item.reason}|${item.source}`;
    const next = (accuracyIssueCounters.get(key) ?? 0) + 1;
    accuracyIssueCounters.set(key, next);
    console.warn("[metric_accuracy] unavailable_metric", {
      route,
      metric: item.metric,
      reason: item.reason,
      source: item.source,
      count: next,
    });
  }
}

const finiteNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const dashboardSchema = z.object({
  totalSessions: z.number().nullable().optional(),
  organicSessions: z.number().nullable().optional(),
  averagePosition: z.number().nullable().optional(),
  conversions: z.number().nullable().optional(),
  activeUsers: z.number().nullable().optional(),
  eventCount: z.number().nullable().optional(),
  newUsers: z.number().nullable().optional(),
  keyEvents: z.number().nullable().optional(),
  totalUsers: z.number().nullable().optional(),
  firstTimeVisitors: z.number().nullable().optional(),
  engagedVisitors: z.number().nullable().optional(),
  organicSearchEngagedSessions: z.number().nullable().optional(),
  dataSources: z
    .object({
      traffic: z.string().optional(),
      conversions: z.string().optional(),
    })
    .optional(),
});

const aiVisibilitySchema = z.object({
  rows: z.array(
    z.object({
      name: z.string(),
      visibility: z.number(),
      mentions: z.number(),
      citedPages: z.number(),
    })
  ),
});

const aiIntelligenceSchema = z.object({
  kpis: z.object({
    aiVisibilityScore: z.number(),
    totalAiMentions: z.number(),
    aiSearchVolume: z.number(),
  }),
});

function createEnvelope(unavailable: UnavailableMetric[]): AccuracyEnvelope {
  return {
    mode: "fail_closed",
    unavailable,
    isAccurate: unavailable.length === 0,
    checkedAt: new Date().toISOString(),
  };
}

function enforceFiniteMetric(
  payload: Record<string, any>,
  unavailable: UnavailableMetric[],
  metric: string,
  source: string
) {
  const parsed = finiteNumberOrNull(payload[metric]);
  if (parsed === null) {
    unavailable.push({
      metric,
      reason: payload[metric] === null || payload[metric] === undefined ? "missing_value" : "invalid_non_finite",
      source,
    });
    payload[metric] = null;
    return;
  }
  payload[metric] = parsed;
}

export function enforceDashboardMetricAccuracy(
  rawPayload: Record<string, any>,
  context: { route: string; expectedTrafficSource?: string } = { route: "unknown" }
): Record<string, any> {
  const unavailable: UnavailableMetric[] = [];
  const payload = { ...rawPayload };

  if (!dashboardSchema.safeParse(payload).success) {
    unavailable.push({
      metric: "dashboard_payload",
      reason: "schema_validation_failed",
      source: context.route,
    });
  }

  const ga4Metrics = [
    "totalSessions",
    "organicSessions",
    "activeUsers",
    "eventCount",
    "newUsers",
    "keyEvents",
    "totalUsers",
    "firstTimeVisitors",
    "engagedVisitors",
    "organicSearchEngagedSessions",
  ];

  const trafficSource = String(payload?.dataSources?.traffic || "none");
  const conversionSource = String(payload?.dataSources?.conversions || "none");

  for (const metric of ga4Metrics) {
    const usesTrafficSource = metric !== "conversions";
    const actualSource = usesTrafficSource ? trafficSource : conversionSource;
    if (actualSource !== "ga4") {
      payload[metric] = null;
      unavailable.push({
        metric,
        reason: "non_authoritative_source",
        source: actualSource,
      });
      continue;
    }
    enforceFiniteMetric(payload, unavailable, metric, "ga4");
  }

  // Position is allowed from non-GA4 sources but must still be finite.
  enforceFiniteMetric(payload, unavailable, "averagePosition", trafficSource || "seo");
  if (conversionSource === "ga4") {
    enforceFiniteMetric(payload, unavailable, "conversions", conversionSource || "ga4");
  } else {
    payload.conversions = null;
    unavailable.push({
      metric: "conversions",
      reason: "non_authoritative_source",
      source: conversionSource,
    });
  }

  if (unavailable.length > 0) {
    recordAccuracyIssues(context.route, unavailable);
  }
  payload.accuracy = createEnvelope(unavailable);
  return payload;
}

export function enforceAiVisibilityAccuracy(rawPayload: Record<string, any>, source = "ai_search_visibility") {
  const unavailable: UnavailableMetric[] = [];
  const payload = { ...rawPayload };
  if (!aiVisibilitySchema.safeParse(payload).success) {
    unavailable.push({
      metric: "ai_visibility_rows",
      reason: "schema_validation_failed",
      source,
    });
    payload.rows = [];
  } else {
    payload.rows = (payload.rows || []).map((row: any) => ({
      ...row,
      visibility: finiteNumberOrNull(row.visibility) ?? 0,
      mentions: finiteNumberOrNull(row.mentions) ?? 0,
      citedPages: finiteNumberOrNull(row.citedPages) ?? 0,
    }));
  }
  if (unavailable.length > 0) {
    recordAccuracyIssues(source, unavailable);
  }
  payload.accuracy = createEnvelope(unavailable);
  return payload;
}

export function enforceAiIntelligenceAccuracy(rawPayload: Record<string, any>, source = "ai_intelligence") {
  const unavailable: UnavailableMetric[] = [];
  const payload = { ...rawPayload };
  if (!aiIntelligenceSchema.safeParse(payload).success) {
    unavailable.push({
      metric: "ai_intelligence_kpis",
      reason: "schema_validation_failed",
      source,
    });
    payload.kpis = {
      aiVisibilityScore: 0,
      aiVisibilityScoreTrend: null,
      totalAiMentions: 0,
      totalAiMentionsTrend: null,
      aiSearchVolume: 0,
      aiSearchVolumeTrend: null,
      monthlyTrendPercent: null,
    };
  }
  if (unavailable.length > 0) {
    recordAccuracyIssues(source, unavailable);
  }
  payload.accuracy = createEnvelope(unavailable);
  return payload;
}

export function enforceDomainOverviewAccuracy(rawPayload: Record<string, any>, source = "domain_overview") {
  const unavailable: UnavailableMetric[] = [];
  const payload = { ...rawPayload };

  const organicKeywords = finiteNumberOrNull(payload?.metrics?.organicSearch?.keywords);
  const organicTraffic = finiteNumberOrNull(payload?.metrics?.organicSearch?.traffic);
  const authorityScore = finiteNumberOrNull(payload?.metrics?.authorityScore);

  if (!payload.metrics) payload.metrics = {};
  if (!payload.metrics.organicSearch) payload.metrics.organicSearch = {};

  if (organicKeywords === null) {
    unavailable.push({ metric: "organicSearch.keywords", reason: "invalid_non_finite", source });
    payload.metrics.organicSearch.keywords = null;
  } else {
    payload.metrics.organicSearch.keywords = organicKeywords;
  }

  if (organicTraffic === null) {
    unavailable.push({ metric: "organicSearch.traffic", reason: "invalid_non_finite", source });
    payload.metrics.organicSearch.traffic = null;
  } else {
    payload.metrics.organicSearch.traffic = organicTraffic;
  }

  if (authorityScore === null) {
    unavailable.push({ metric: "authorityScore", reason: "invalid_non_finite", source });
    payload.metrics.authorityScore = null;
  } else {
    payload.metrics.authorityScore = authorityScore;
  }

  if (unavailable.length > 0) {
    recordAccuracyIssues(source, unavailable);
  }
  payload.accuracy = createEnvelope(unavailable);
  return payload;
}
