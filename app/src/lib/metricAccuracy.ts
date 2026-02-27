export type AccuracyUnavailableMetric = {
  metric: string;
  reason: string;
  source: string;
};

export type AccuracyEnvelope = {
  mode?: "fail_closed";
  unavailable?: AccuracyUnavailableMetric[];
  isAccurate?: boolean;
  checkedAt?: string;
};

export function getUnavailableMetricSet(accuracy?: AccuracyEnvelope | null): Set<string> {
  return new Set(
    Array.isArray(accuracy?.unavailable)
      ? (accuracy?.unavailable as AccuracyUnavailableMetric[]).map((item) => item.metric)
      : []
  );
}

export function isMetricUnavailable(
  accuracy: AccuracyEnvelope | null | undefined,
  metric: string | string[]
): boolean {
  const set = getUnavailableMetricSet(accuracy);
  if (Array.isArray(metric)) {
    return metric.some((entry) => set.has(entry));
  }
  return set.has(metric);
}

export function getUnavailableMetricInfo(
  accuracy: AccuracyEnvelope | null | undefined,
  metric: string | string[]
): AccuracyUnavailableMetric | null {
  if (!Array.isArray(accuracy?.unavailable)) return null;
  const candidates = Array.isArray(metric) ? metric : [metric];
  for (const metricName of candidates) {
    const match = accuracy.unavailable.find((entry) => entry.metric === metricName);
    if (match) return match;
  }
  return null;
}

export function formatUnavailableReason(reason: string): string {
  switch (reason) {
    case "non_authoritative_source":
      return "Data source is not authoritative for this metric";
    case "invalid_non_finite":
      return "Metric value is invalid";
    case "missing_value":
      return "Required metric value is missing";
    case "schema_validation_failed":
      return "Metric payload failed validation";
    default:
      return "Metric is unavailable";
  }
}

export function formatUnavailableSource(source: string): string {
  const normalized = String(source || "").trim().toLowerCase();
  if (!normalized) return "Unknown source";
  if (normalized === "ga4") return "Google Analytics 4";
  if (normalized === "seo_report") return "SEO report snapshot";
  if (normalized === "database") return "Database cache";
  if (normalized === "none") return "No data source";
  return source;
}

const parseNumericValue = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeTrendPoints = (trend: unknown): Array<{ date: string; value: number }> => {
  if (!Array.isArray(trend)) return [];
  return trend
    .map((point: any) => ({
      date: typeof point?.date === "string" ? point.date : "",
      value: Number.isFinite(Number(point?.value)) ? Number(point.value) : 0,
    }))
    .filter((point) => Boolean(point.date));
};

export function normalizeDashboardSummaryPayload<T extends Record<string, any>>(payload: T) {
  const unavailableSet = getUnavailableMetricSet(payload?.accuracy as AccuracyEnvelope | undefined);
  const toMetric = (metric: string, value: unknown): number | null => {
    if (unavailableSet.has(metric)) return null;
    return parseNumericValue(value);
  };

  return {
    ...payload,
    totalSessions: toMetric("totalSessions", payload?.totalSessions),
    organicSessions: toMetric("organicSessions", payload?.organicSessions),
    averagePosition: toMetric("averagePosition", payload?.averagePosition),
    conversions: toMetric("conversions", payload?.conversions),
    activeUsers: toMetric("activeUsers", payload?.activeUsers),
    eventCount: toMetric("eventCount", payload?.eventCount),
    newUsers: toMetric("newUsers", payload?.newUsers),
    keyEvents: toMetric("keyEvents", payload?.keyEvents),
    totalUsers: toMetric("totalUsers", payload?.totalUsers),
    firstTimeVisitors: toMetric("firstTimeVisitors", payload?.firstTimeVisitors ?? payload?.newUsers),
    engagedVisitors: toMetric("engagedVisitors", payload?.engagedVisitors ?? payload?.engagedSessions),
    organicSearchEngagedSessions: toMetric("organicSearchEngagedSessions", payload?.organicSearchEngagedSessions),
    activeUsersTrend: normalizeTrendPoints(payload?.activeUsersTrend),
    newUsersTrend: normalizeTrendPoints(payload?.newUsersTrend),
    totalUsersTrend: normalizeTrendPoints(payload?.totalUsersTrend ?? payload?.activeUsersTrend),
  };
}
