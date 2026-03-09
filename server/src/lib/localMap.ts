type UnknownRecord = Record<string, unknown>;

export type LocalMapGridPoint = {
  lat: number;
  lng: number;
  rank: number | null;
  competitors: string[];
  serpBusinesses?: LocalMapSerpBusiness[];
};

export type LocalMapSerpBusiness = {
  rank: number;
  title: string;
  placeId: string | null;
  address: string | null;
  rating: number | null;
  reviewsCount: number | null;
  category: string | null;
  isTarget: boolean;
  matchedBy?: "cid" | "place_id" | "name" | null;
};

export type GoogleBusinessSearchResult = {
  placeId: string;
  mapsCid: string | null;
  businessName: string;
  address: string;
  lat: number;
  lng: number;
};

export type DataForSeoLocalGridResult = {
  gridData: LocalMapGridPoint[];
  ataScore: number;
  topCompetitorsCurrent: string[];
  topDetectedBusinesses: string[];
  rawResult: unknown;
};

export type LocalMapPointSerpResult = {
  rank: number | null;
  competitors: string[];
  serpBusinesses: LocalMapSerpBusiness[];
  rawResult: unknown;
  debug: LocalMapPointSerpDebug;
};

export type LocalMapPointSerpDebug = {
  endpointUsed?: string;
  requestDepth?: number;
  taskStatusCode: number | null;
  taskStatusMessage: string | null;
  target: {
    businessName: string;
    placeId: string;
    mapsCid: string;
  };
  candidateCount: number;
  candidates: Array<{
    title: string;
    placeId: string | null;
    cidCandidates: string[];
    matchedBy: "cid" | "place_id" | "name" | null;
    rank: number;
  }>;
};

type DataForSeoLocalGridRequest = {
  keyword: string;
  placeId: string;
  mapsCid?: string;
  businessName?: string;
  centerLat: number;
  centerLng: number;
  gridSize?: number;
  gridSpacingMiles?: number;
};

type DataForSeoPointSerpRequest = {
  keyword: string;
  placeId: string;
  mapsCid?: string;
  businessName?: string;
  lat: number;
  lng: number;
  includePlaceDetails?: boolean;
};

const EARTH_RADIUS_METERS = 6371000;
const DEFAULT_GRID_SIZE = 7;
const DEFAULT_GRID_SPACING_MILES = 0.5;
const NOT_RANKED_FALLBACK = 20;
const DEFAULT_DATAFORSEO_LANGUAGE_CODE = "en";
const DEFAULT_DATAFORSEO_DEVICE = "desktop";
const DEFAULT_LOCAL_GRID_CONCURRENCY = 20;
const DEFAULT_LOCAL_GRID_POINT_TIMEOUT_MS = 8000;
const DEFAULT_LOCAL_GRID_SINGLE_RUN_TIMEOUT_MS = 12000;
const DEFAULT_LOCAL_POINT_SERP_TIMEOUT_MS = 20000;
const DEFAULT_DATAFORSEO_MAPS_DEPTH = 50;
const DEFAULT_DATAFORSEO_POINT_DEPTH = 100;
const MAX_DATAFORSEO_DEPTH = 100;
const DEFAULT_DATAFORSEO_MAPS_ENDPOINT = "https://api.dataforseo.com/v3/serp/google/maps/live/advanced";
const DEFAULT_DATAFORSEO_LOCAL_FINDER_ENDPOINT = "https://api.dataforseo.com/v3/serp/google/local_finder/live/advanced";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toAddressString(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length ? normalized : null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
    return parts.length ? parts.join(", ") : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as UnknownRecord;
  const orderedParts = [
    toStringOrNull(record.address),
    toStringOrNull(record.full_address),
    toStringOrNull(record.displayed_address),
    toStringOrNull(record.formatted),
    toStringOrNull(record.formatted_address),
    toStringOrNull(record.street),
    toStringOrNull(record.street_address),
    toStringOrNull(record.house),
    toStringOrNull(record.house_number),
    toStringOrNull(record.line1),
    toStringOrNull(record.line2),
    toStringOrNull(record.neighborhood),
    toStringOrNull(record.district),
    toStringOrNull(record.borough),
    toStringOrNull(record.city),
    toStringOrNull(record.province),
    toStringOrNull(record.region),
    toStringOrNull(record.state),
    toStringOrNull(record.zip_code),
    toStringOrNull(record.zip),
    toStringOrNull(record.postal_code),
    toStringOrNull(record.country_code),
    toStringOrNull(record.country),
  ].filter((part): part is string => Boolean(part));
  if (!orderedParts.length) return null;
  return orderedParts.join(", ");
}

function extractPlaceIdFromText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const fromParam = /(?:\?|&|#)place_id=([^&#]+)/i.exec(text)?.[1];
  if (!fromParam) return null;
  const decoded = decodeURIComponent(fromParam);
  return decoded.startsWith("ChI") ? decoded : null;
}

function extractPlaceId(row: UnknownRecord): string | null {
  const candidates = [
    row.place_id,
    row.placeId,
    row.google_place_id,
    row.placeid,
    row.check_url,
    row.url,
    row.maps_url,
  ];
  for (const candidate of candidates) {
    const asString = toStringOrNull(candidate);
    if (asString && asString.startsWith("ChI")) return asString;
    const parsed = extractPlaceIdFromText(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function resolveDepth(rawValue: unknown, fallback: number, minimum: number): number {
  const parsed = toNumber(rawValue);
  if (parsed == null) return fallback;
  const rounded = Math.round(parsed);
  return Math.max(minimum, Math.min(MAX_DATAFORSEO_DEPTH, rounded));
}

function milesToMeters(miles: number): number {
  return Math.round(miles * 1609.344);
}

export function normalizeMapRank(rawRank: unknown): number | null {
  const parsed = toNumber(rawRank);
  if (parsed == null || parsed <= 0) return null;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

export function rankToHeatBucket(rank: number | null): "green" | "yellow" | "orange" | "red" {
  if (rank != null && rank >= 1 && rank <= 3) return "green";
  if (rank != null && rank >= 4 && rank <= 10) return "yellow";
  if (rank != null && rank >= 11 && rank <= 20) return "orange";
  return "red";
}

export function calculateAtaScore(points: Array<{ rank: number | null }>): number {
  if (!points.length) return NOT_RANKED_FALLBACK;
  const total = points.reduce((sum, p) => sum + (p.rank == null ? NOT_RANKED_FALLBACK : p.rank), 0);
  return Number((total / points.length).toFixed(2));
}

function decodePolylineDistance(startLat: number, startLng: number, northMeters: number, eastMeters: number): { lat: number; lng: number } {
  const dLat = (northMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const dLng = (eastMeters / (EARTH_RADIUS_METERS * Math.cos((Math.PI * startLat) / 180))) * (180 / Math.PI);
  return { lat: startLat + dLat, lng: startLng + dLng };
}

function buildFallbackGrid(centerLat: number, centerLng: number, gridSize: number, spacingMeters: number): LocalMapGridPoint[] {
  const radius = Math.floor(gridSize / 2);
  const points: LocalMapGridPoint[] = [];
  for (let row = -radius; row <= radius; row += 1) {
    for (let col = -radius; col <= radius; col += 1) {
      const coords = decodePolylineDistance(centerLat, centerLng, row * spacingMeters, col * spacingMeters);
      points.push({
        lat: Number(coords.lat.toFixed(7)),
        lng: Number(coords.lng.toFixed(7)),
        rank: null,
        competitors: [],
        serpBusinesses: [],
      });
    }
  }
  return points;
}

function parseCompetitorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (entry && typeof entry === "object") {
        const maybeTitle = toStringOrNull((entry as UnknownRecord).title ?? (entry as UnknownRecord).name);
        return maybeTitle ?? "";
      }
      return "";
    })
    .filter((name) => name.length > 0)
    .slice(0, 3);
}

function parseGridPointsFromResult(
  result: UnknownRecord,
  targetPlaceId: string,
  targetBusinessName: string,
  targetMapsCid: string
): LocalMapGridPoint[] {
  const direct = Array.isArray(result.grid_data) ? result.grid_data : null;
  const source = direct ?? [];
  const parsed: LocalMapGridPoint[] = [];

  for (const row of source) {
    if (!row || typeof row !== "object") continue;
    const record = row as UnknownRecord;
    const lat = toNumber(record.lat ?? record.latitude ?? record.y);
    const lng = toNumber(record.lng ?? record.longitude ?? record.x);
    if (lat == null || lng == null) continue;

    const baseRank = normalizeMapRank(
      record.rank
      ?? record.rank_absolute
      ?? record.rank_group
      ?? record.rank_position
      ?? record.position
      ?? record.absolute_rank
      ?? record.local_pack_position
    );
    const competitors = parseCompetitorNames(
      record.competitors ??
      record.top_competitors ??
      record.top_3_competitors ??
      record.top_competitor_business_names
    );
    const serpBusinesses = parseSerpBusinesses(
      record.items
      ?? record.competitors
      ?? record.top_competitors
      ?? record.top_3_competitors
      ?? record.top_competitor_business_names,
      targetPlaceId,
      targetBusinessName,
      targetMapsCid
    );
    const derivedRankFromSerp = serpBusinesses.find((entry) => entry.isTarget)?.rank ?? null;
    const rank = baseRank ?? derivedRankFromSerp;
    const competitorsFromSerp = serpBusinesses
      .filter((entry) => !entry.isTarget)
      .slice(0, 3)
      .map((entry) => entry.title);

    parsed.push({
      lat: Number(lat.toFixed(7)),
      lng: Number(lng.toFixed(7)),
      rank,
      competitors: competitorsFromSerp.length ? competitorsFromSerp : competitors,
      serpBusinesses,
    });
  }

  return parsed;
}

async function tryRunLocalRankTrackerGrid(
  endpoint: string,
  base64Auth: string,
  input: DataForSeoLocalGridRequest,
  languageCode: string,
  device: string,
  depth: number,
  gridSize: number,
  spacingMeters: number
): Promise<{ gridData: LocalMapGridPoint[]; rawResult: unknown } | null> {
  const payload = [
    {
      keyword: input.keyword,
      place_id: input.placeId,
      location_coordinate: `${input.centerLat},${input.centerLng}`,
      grid_type: "square",
      grid_rows: gridSize,
      grid_cols: gridSize,
      distance: spacingMeters,
      language_code: languageCode,
      device,
      depth,
    },
  ];

  const singleRunTimeoutMs = Math.max(
    3000,
    Number(process.env.DATAFORSEO_LOCAL_GRID_SINGLE_RUN_TIMEOUT_MS ?? DEFAULT_LOCAL_GRID_SINGLE_RUN_TIMEOUT_MS)
  );
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let response: Response;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), singleRunTimeoutMs);
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${base64Auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const json = await getJsonResponse(response);
  if (!response.ok) return null;

  const tasks = Array.isArray((json as UnknownRecord)?.tasks)
    ? ((json as UnknownRecord).tasks as unknown[])
    : [];
  const firstTask = (tasks[0] as UnknownRecord | undefined) ?? {};
  const taskResults = Array.isArray(firstTask.result) ? (firstTask.result as unknown[]) : [];
  const firstResult = (taskResults[0] as UnknownRecord | undefined) ?? {};
  const parsed = parseGridPointsFromResult(firstResult, input.placeId, input.businessName ?? "", input.mapsCid ?? "");
  if (!parsed.length) return null;
  return { gridData: parsed, rawResult: json };
}

function extractTopCompetitorsCurrent(points: LocalMapGridPoint[]): string[] {
  const counts = new Map<string, number>();
  for (const point of points) {
    for (const name of point.competitors) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
}

function extractTopDetectedBusinessesFromRaw(rawResult: unknown[]): string[] {
  const counts = new Map<string, number>();
  for (const packet of rawResult) {
    const tasks = Array.isArray((packet as UnknownRecord)?.tasks)
      ? ((packet as UnknownRecord).tasks as unknown[])
      : [];
    for (const task of tasks) {
      const results = Array.isArray((task as UnknownRecord)?.result)
        ? ((task as UnknownRecord).result as unknown[])
        : [];
      for (const result of results) {
        const items = Array.isArray((result as UnknownRecord)?.items)
          ? ((result as UnknownRecord).items as unknown[])
          : [];
        for (const item of items) {
          const title = toStringOrNull((item as UnknownRecord)?.title);
          if (!title) continue;
          counts.set(title, (counts.get(title) ?? 0) + 1);
        }
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name]) => name);
}

function gridCoordinates(centerLat: number, centerLng: number, gridSize: number, spacingMeters: number): LocalMapGridPoint[] {
  const radius = Math.floor(gridSize / 2);
  const points: LocalMapGridPoint[] = [];
  for (let row = -radius; row <= radius; row += 1) {
    for (let col = -radius; col <= radius; col += 1) {
      const coords = decodePolylineDistance(centerLat, centerLng, row * spacingMeters, col * spacingMeters);
      points.push({
        lat: Number(coords.lat.toFixed(7)),
        lng: Number(coords.lng.toFixed(7)),
        rank: null,
        competitors: [],
        serpBusinesses: [],
      });
    }
  }
  return points;
}

function normalizePlaceId(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeCid(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const cidFromParam = /(?:\?|&|#)cid=(\d{5,})/i.exec(text)?.[1];
  if (cidFromParam) return cidFromParam;
  const digitsOnly = text.replace(/\D/g, "");
  return digitsOnly.length >= 5 ? digitsOnly : "";
}

function extractCidCandidates(row: UnknownRecord): string[] {
  const candidates = [
    row.cid,
    row.data_cid,
    row.place_cid,
    row.google_cid,
    row.data_id,
    row.feature_id,
    row.google_id,
    row.url,
    row.maps_url,
  ];
  const out = new Set<string>();
  for (const value of candidates) {
    const normalized = normalizeCid(value);
    if (normalized) out.add(normalized);
  }
  return [...out];
}

function normalizeBusinessName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTargetMatchReason(
  candidateTitle: string,
  candidatePlaceId: string | null,
  candidateCidCandidates: string[],
  targetPlaceId: string,
  targetBusinessName: string,
  targetMapsCid: string
): "cid" | "place_id" | "name" | null {
  const normalizedTargetCid = normalizeCid(targetMapsCid);
  if (normalizedTargetCid && candidateCidCandidates.some((cid) => cid === normalizedTargetCid)) {
    return "cid";
  }

  const normalizedTargetPlaceId = normalizePlaceId(targetPlaceId);
  const normalizedCandidatePlaceId = normalizePlaceId(candidatePlaceId ?? "");
  if (normalizedTargetPlaceId && normalizedCandidatePlaceId && normalizedCandidatePlaceId === normalizedTargetPlaceId) {
    return "place_id";
  }

  const normalizedTargetName = normalizeBusinessName(targetBusinessName);
  const normalizedCandidateName = normalizeBusinessName(candidateTitle);
  if (!normalizedTargetName || !normalizedCandidateName) return null;
  if (normalizedCandidateName === normalizedTargetName) return "name";

  const targetTokens = normalizedTargetName.split(" ").filter(Boolean);
  const candidateTokens = normalizedCandidateName.split(" ").filter(Boolean);
  if (targetTokens.length < 2 || candidateTokens.length < 2) return null;
  const targetSet = new Set(targetTokens);
  const candidateSet = new Set(candidateTokens);
  let intersection = 0;
  for (const token of candidateSet) {
    if (targetSet.has(token)) intersection += 1;
  }
  const union = new Set([...targetSet, ...candidateSet]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  return jaccard >= 0.6 ? "name" : null;
}

function isTargetBusinessMatch(
  candidateTitle: string,
  candidatePlaceId: string | null,
  candidateCidCandidates: string[],
  targetPlaceId: string,
  targetBusinessName: string,
  targetMapsCid: string
): boolean {
  return getTargetMatchReason(
    candidateTitle,
    candidatePlaceId,
    candidateCidCandidates,
    targetPlaceId,
    targetBusinessName,
    targetMapsCid
  ) !== null;
}

function parseSerpBusinesses(
  value: unknown,
  targetPlaceId: string,
  targetBusinessName: string,
  targetMapsCid: string
): LocalMapSerpBusiness[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      if (entry == null) return null;
      if (typeof entry === "string") {
        const title = entry.trim();
        if (!title) return null;
        const matchedBy = getTargetMatchReason(title, null, [], targetPlaceId, targetBusinessName, targetMapsCid);
        const isTarget = matchedBy !== null;
        return {
          rank: index + 1,
          title,
          placeId: null,
          address: null,
          rating: null,
          reviewsCount: null,
          category: null,
          isTarget,
          matchedBy,
        } as LocalMapSerpBusiness;
      }
      if (typeof entry !== "object") return null;
      const row = entry as UnknownRecord;
      const title = toStringOrNull(row.title ?? row.name);
      if (!title) return null;
      const placeId = extractPlaceId(row);
      const cidCandidates = extractCidCandidates(row);
      const rank = normalizeMapRank(
        row.rank
        ?? row.rank_absolute
        ?? row.rank_group
        ?? row.rank_position
        ?? row.position
        ?? row.absolute_rank
        ?? row.local_pack_position
      ) ?? (index + 1);
      const matchedBy = getTargetMatchReason(
        title,
        placeId,
        cidCandidates,
        targetPlaceId,
        targetBusinessName,
        targetMapsCid
      );
      const isTarget = matchedBy !== null;

      return {
        rank,
        title,
        placeId: placeId ?? null,
        address: toAddressString(row.address)
          ?? toAddressString(row.address_info)
          ?? toAddressString(row.address_data)
          ?? toAddressString(row.formatted_address)
          ?? toAddressString(row),
        rating: toNumber(row.rating)
          ?? toNumber((row.rating as UnknownRecord | undefined)?.value)
          ?? toNumber(row.rankings_rating),
        reviewsCount: toNumber(row.reviews_count)
          ?? toNumber(row.rating_votes)
          ?? toNumber(row.reviews)
          ?? toNumber((row.rating as UnknownRecord | undefined)?.votes_count)
          ?? toNumber((row.rating as UnknownRecord | undefined)?.votes),
        category: toStringOrNull(row.category_name ?? row.category ?? row.main_category),
        isTarget,
        matchedBy,
      } as LocalMapSerpBusiness;
    })
    .filter((item): item is LocalMapSerpBusiness => item !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 10);
}

function parseItemsForCoordinate(
  responseJson: unknown,
  targetPlaceId: string,
  targetBusinessName: string,
  targetMapsCid: string
): { rank: number | null; competitors: string[]; serpBusinesses: LocalMapSerpBusiness[]; debug: LocalMapPointSerpDebug } {
  const tasks = Array.isArray((responseJson as UnknownRecord)?.tasks)
    ? ((responseJson as UnknownRecord).tasks as unknown[])
    : [];
  const firstTask = (tasks[0] as UnknownRecord | undefined) ?? {};
  const taskStatusCode = toNumber(firstTask.status_code);
  const taskStatusMessage = toStringOrNull(firstTask.status_message);
  const baseDebug: LocalMapPointSerpDebug = {
    taskStatusCode,
    taskStatusMessage,
    target: {
      businessName: String(targetBusinessName ?? ""),
      placeId: String(targetPlaceId ?? ""),
      mapsCid: String(targetMapsCid ?? ""),
    },
    candidateCount: 0,
    candidates: [],
  };
  if (taskStatusCode === 40102) {
    // DataForSEO: "No Search Results" (valid no-data state, not a transport/system failure).
    return { rank: null, competitors: [], serpBusinesses: [], debug: baseDebug };
  }
  if (taskStatusCode != null && taskStatusCode >= 40000) {
    throw new Error(
      taskStatusMessage
        ? `DataForSEO task failed with status_code ${taskStatusCode}: ${taskStatusMessage}`
        : `DataForSEO task failed with status_code ${taskStatusCode}`
    );
  }

  const taskResults = Array.isArray(firstTask.result) ? (firstTask.result as unknown[]) : [];
  const firstResult = (taskResults[0] as UnknownRecord | undefined) ?? {};
  const items = Array.isArray(firstResult.items) ? (firstResult.items as unknown[]) : [];

  const ranked = items
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as UnknownRecord;
      const title = toStringOrNull(row.title) ?? "";
      const placeId = normalizePlaceId(row.place_id);
      const cidCandidates = extractCidCandidates(row);
      const rank =
        normalizeMapRank(
          row.rank
          ?? row.rank_absolute
          ?? row.rank_group
          ?? row.rank_position
          ?? row.position
          ?? row.absolute_rank
          ?? row.local_pack_position
        )
        // If endpoint omits explicit rank fields but returns ordered items, use item order.
        ?? (index + 1);
      const matchedBy = getTargetMatchReason(
        title,
        placeId || null,
        cidCandidates,
        targetPlaceId,
        targetBusinessName,
        targetMapsCid
      );
      return { title, placeId, rank, index, cidCandidates, matchedBy };
    })
    .filter((entry): entry is { title: string; placeId: string; rank: number; index: number; cidCandidates: string[]; matchedBy: "cid" | "place_id" | "name" | null } => entry !== null);

  const competitors = ranked
    .slice(0, 3)
    .map((entry) => entry.title)
    .filter((name) => name.length > 0);
  const serpBusinesses = parseSerpBusinesses(items, targetPlaceId, targetBusinessName, targetMapsCid);
  const match = ranked.find((entry) => entry.matchedBy !== null);
  const debug: LocalMapPointSerpDebug = {
    ...baseDebug,
    candidateCount: ranked.length,
    candidates: ranked.slice(0, 10).map((entry) => ({
      title: entry.title,
      placeId: entry.placeId || null,
      cidCandidates: entry.cidCandidates,
      matchedBy: entry.matchedBy,
      rank: entry.rank,
    })),
  };

  return {
    rank: match?.rank ?? null,
    competitors,
    serpBusinesses,
    debug,
  };
}

async function mapWithConcurrency<T, U>(
  values: T[],
  concurrency: number,
  run: (value: T, index: number) => Promise<U>
): Promise<U[]> {
  if (values.length === 0) return [];
  const maxConcurrency = Math.max(1, Math.floor(concurrency));
  const out: U[] = new Array(values.length) as U[];
  let cursor = 0;

  async function worker() {
    while (cursor < values.length) {
      const idx = cursor;
      cursor += 1;
      out[idx] = await run(values[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrency, values.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

async function getJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Unexpected non-JSON response: ${text.slice(0, 300)}`);
  }
}

type GooglePlaceDetail = {
  placeId: string;
  name: string | null;
  address: string | null;
  rating: number | null;
  reviewsCount: number | null;
  category: string | null;
};

function normalizeCategoryFromTypes(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const first = value.find((item) => typeof item === "string" && item.trim().length > 0) as string | undefined;
  if (!first) return null;
  return first.replace(/_/g, " ").trim();
}

function nameSimilarityScore(leftValue: unknown, rightValue: unknown): number {
  const left = normalizeBusinessName(leftValue);
  const right = normalizeBusinessName(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = left.split(" ").filter(Boolean);
  const rightTokens = right.split(" ").filter(Boolean);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union > 0 ? intersection / union : 0;
}

async function fetchGooglePlaceDetail(placeId: string): Promise<GooglePlaceDetail | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;
  const normalizedPlaceId = String(placeId || "").trim();
  if (!normalizedPlaceId) return null;

  const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  detailsUrl.searchParams.set("place_id", normalizedPlaceId);
  detailsUrl.searchParams.set("fields", "place_id,name,formatted_address,rating,user_ratings_total,types");
  detailsUrl.searchParams.set("key", apiKey);

  const res = await fetch(detailsUrl, { method: "GET" });
  if (!res.ok) return null;
  const json = await getJsonResponse(res);
  const result = (json as UnknownRecord)?.result as UnknownRecord | undefined;
  if (!result) return null;

  return {
    placeId: normalizedPlaceId,
    name: toStringOrNull(result.name),
    address: toAddressString(result.formatted_address),
    rating: toNumber(result.rating),
    reviewsCount: toNumber(result.user_ratings_total),
    category: normalizeCategoryFromTypes(result.types),
  };
}

async function searchGooglePlaceDetailByText(query: string, lat: number, lng: number): Promise<GooglePlaceDetail | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", normalizedQuery);
  url.searchParams.set("location", `${Number(lat)},${Number(lng)}`);
  url.searchParams.set("radius", "8000");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) return null;
  const json = await getJsonResponse(res);
  const rows = Array.isArray((json as UnknownRecord)?.results)
    ? ((json as UnknownRecord).results as unknown[])
    : [];

  let best: UnknownRecord | null = null;
  let bestScore = 0;
  for (const entry of rows) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as UnknownRecord;
    const score = nameSimilarityScore(normalizedQuery, toStringOrNull(row.name) ?? "");
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }

  if (!best || bestScore < 0.6) return null;
  const placeId = toStringOrNull(best.place_id);
  if (!placeId) return null;
  return {
    placeId,
    name: toStringOrNull(best.name),
    address: toAddressString(best.formatted_address),
    rating: toNumber(best.rating),
    reviewsCount: toNumber(best.user_ratings_total),
    category: normalizeCategoryFromTypes(best.types),
  };
}

async function enrichSerpBusinessesWithGooglePlaceDetails(
  businesses: LocalMapSerpBusiness[],
  lat: number,
  lng: number
): Promise<LocalMapSerpBusiness[]> {
  const placeIds = Array.from(
    new Set(
      businesses
        .map((entry) => toStringOrNull(entry.placeId))
        .filter((entry): entry is string => Boolean(entry))
    )
  );
  const details = await mapWithConcurrency(placeIds, 5, async (pid) => {
    try {
      return await fetchGooglePlaceDetail(pid);
    } catch {
      return null;
    }
  });
  const detailMap = new Map<string, GooglePlaceDetail>();
  for (const detail of details) {
    if (detail?.placeId) detailMap.set(detail.placeId, detail);
  }

  const queryCache = new Map<string, GooglePlaceDetail | null>();
  return mapWithConcurrency(businesses, 4, async (entry) => {
    const placeId = toStringOrNull(entry.placeId);
    let detail = placeId ? detailMap.get(placeId) ?? null : null;
    if (!detail && !toStringOrNull(entry.address)) {
      const key = normalizeBusinessName(entry.title);
      if (!queryCache.has(key)) {
        try {
          queryCache.set(key, await searchGooglePlaceDetailByText(entry.title, lat, lng));
        } catch {
          queryCache.set(key, null);
        }
      }
      detail = queryCache.get(key) ?? null;
    }
    if (!detail) return entry;
    return {
      ...entry,
      placeId: entry.placeId || detail.placeId,
      title: entry.title || detail.name || entry.title,
      address: entry.address || detail.address || null,
      rating: entry.rating != null && entry.rating > 0 ? entry.rating : (detail.rating != null && detail.rating > 0 ? detail.rating : null),
      reviewsCount: entry.reviewsCount != null && entry.reviewsCount > 0
        ? entry.reviewsCount
        : (detail.reviewsCount != null && detail.reviewsCount > 0 ? detail.reviewsCount : null),
      category: entry.category || detail.category || null,
    };
  });
}

export async function searchGoogleBusinessProfiles(query: string): Promise<GoogleBusinessSearchResult[]> {
  const input = query.trim();
  if (input.length < 2) return [];

  const apiKey = requireEnv("GOOGLE_PLACES_API_KEY");
  const autoCompleteUrl = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  autoCompleteUrl.searchParams.set("input", input);
  autoCompleteUrl.searchParams.set("types", "establishment");
  autoCompleteUrl.searchParams.set("key", apiKey);

  const autoRes = await fetch(autoCompleteUrl, { method: "GET" });
  const autoJson = await getJsonResponse(autoRes);
  if (!autoRes.ok) {
    throw new Error(`Google Places autocomplete failed with status ${autoRes.status}`);
  }

  const predictions = Array.isArray((autoJson as UnknownRecord)?.predictions)
    ? ((autoJson as UnknownRecord).predictions as unknown[])
    : [];
  const placeIds = predictions
    .map((item) => (item && typeof item === "object" ? toStringOrNull((item as UnknownRecord).place_id) : null))
    .filter((value): value is string => Boolean(value))
    .slice(0, 5);

  const details = await Promise.all(
    placeIds.map(async (placeId) => {
      const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      detailsUrl.searchParams.set("place_id", placeId);
      detailsUrl.searchParams.set("fields", "place_id,name,formatted_address,geometry/location,url");
      detailsUrl.searchParams.set("key", apiKey);
      const res = await fetch(detailsUrl, { method: "GET" });
      if (!res.ok) return null;
      const json = await getJsonResponse(res);
      const result = (json as UnknownRecord)?.result as UnknownRecord | undefined;
      if (!result) return null;

      const name = toStringOrNull(result.name);
      const address = toStringOrNull(result.formatted_address) ?? "";
      const geometry = result.geometry as UnknownRecord | undefined;
      const location = geometry?.location as UnknownRecord | undefined;
      const lat = toNumber(location?.lat);
      const lng = toNumber(location?.lng);
      const mapsCid = normalizeCid(result.url);

      if (!name || lat == null || lng == null) return null;
      return {
        placeId,
        mapsCid: mapsCid || null,
        businessName: name,
        address,
        lat: Number(lat.toFixed(7)),
        lng: Number(lng.toFixed(7)),
      };
    })
  );

  return details.filter((entry): entry is GoogleBusinessSearchResult => Boolean(entry));
}

export async function runDataForSeoLocalGrid(
  input: DataForSeoLocalGridRequest
): Promise<DataForSeoLocalGridResult> {
  const gridSize = input.gridSize ?? DEFAULT_GRID_SIZE;
  const gridSpacingMiles = input.gridSpacingMiles ?? DEFAULT_GRID_SPACING_MILES;
  const spacingMeters = milesToMeters(gridSpacingMiles);

  const points = gridCoordinates(input.centerLat, input.centerLng, gridSize, spacingMeters);
  const concurrency = Math.max(
    1,
    Number(process.env.DATAFORSEO_LOCAL_GRID_CONCURRENCY ?? DEFAULT_LOCAL_GRID_CONCURRENCY)
  );

  let rawResult: unknown[] = [];
  let gridData: LocalMapGridPoint[] = [];
  rawResult = [];
  gridData = await mapWithConcurrency(points, concurrency, async (point) => {
    try {
      const parsed = await fetchDataForSeoPointSerp({
        keyword: input.keyword,
        placeId: input.placeId,
        mapsCid: input.mapsCid,
        businessName: input.businessName,
        lat: point.lat,
        lng: point.lng,
      });
      rawResult.push(parsed.rawResult);
      return {
        lat: point.lat,
        lng: point.lng,
        rank: parsed.rank,
        competitors: parsed.competitors,
        serpBusinesses: parsed.serpBusinesses,
      };
    } catch {
      return {
        lat: point.lat,
        lng: point.lng,
        rank: null,
        competitors: [],
        serpBusinesses: [],
      };
    }
  });

  const hasAnyRank = gridData.some((p) => p.rank != null);
  const normalizedGridData = hasAnyRank ? gridData : buildFallbackGrid(input.centerLat, input.centerLng, gridSize, spacingMeters);

  const ataScore = calculateAtaScore(normalizedGridData);
  const topCompetitorsCurrent = extractTopCompetitorsCurrent(normalizedGridData);
  const topDetectedBusinesses = extractTopDetectedBusinessesFromRaw(rawResult);

  return {
    gridData: normalizedGridData,
    ataScore,
    topCompetitorsCurrent,
    topDetectedBusinesses,
    rawResult,
  };
}

export async function fetchDataForSeoPointSerp(input: DataForSeoPointSerpRequest): Promise<LocalMapPointSerpResult> {
  const base64Auth = requireEnv("DATAFORSEO_BASE64");
  const endpoint = process.env.DATAFORSEO_LOCAL_FINDER_ENDPOINT
    ?? DEFAULT_DATAFORSEO_LOCAL_FINDER_ENDPOINT;
  const languageCode = process.env.DATAFORSEO_LANGUAGE_CODE || DEFAULT_DATAFORSEO_LANGUAGE_CODE;
  const device = process.env.DATAFORSEO_DEVICE || DEFAULT_DATAFORSEO_DEVICE;
  const depth = resolveDepth(
    process.env.DATAFORSEO_LOCAL_FINDER_POINT_DEPTH
      ?? process.env.DATAFORSEO_MAPS_POINT_DEPTH
      ?? process.env.DATAFORSEO_MAPS_DEPTH,
    DEFAULT_DATAFORSEO_POINT_DEPTH,
    10
  );
  const pointTimeoutMs = Math.max(
    3000,
    Number(
      process.env.DATAFORSEO_LOCAL_POINT_SERP_TIMEOUT_MS
      ?? process.env.DATAFORSEO_LOCAL_GRID_POINT_TIMEOUT_MS
      ?? DEFAULT_LOCAL_POINT_SERP_TIMEOUT_MS
    )
  );

  const runPointRequest = async (requestEndpoint: string): Promise<LocalMapPointSerpResult> => {
    const isLocalFinderEndpoint = /\/local_finder\//i.test(requestEndpoint);
    const coordinateValue = isLocalFinderEndpoint
      ? `${Number(input.lat)},${Number(input.lng)}`
      : `${Number(input.lat)},${Number(input.lng)},20z`;
    const taskPayload: Record<string, unknown> = {
      keyword: String(input.keyword),
      location_coordinate: coordinateValue,
      language_code: languageCode,
      device,
      depth,
    };
    if (!isLocalFinderEndpoint) {
      taskPayload.place_id = String(input.placeId);
    }
    const payload = [
      taskPayload,
    ];

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        const controller = new AbortController();
        const timeoutForAttempt = attempt === 0 ? pointTimeoutMs : Math.round(pointTimeoutMs * 1.5);
        timeout = setTimeout(() => controller.abort(), timeoutForAttempt);
        const response = await fetch(requestEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Basic ${base64Auth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const json = await getJsonResponse(response);
        if (!response.ok) {
          throw new Error(`DataForSEO point request failed with status ${response.status}`);
        }

        const parsed = parseItemsForCoordinate(
          json,
          normalizePlaceId(input.placeId),
          String(input.businessName ?? ""),
          normalizeCid(input.mapsCid ?? "")
        );
        const serpBusinesses = input.includePlaceDetails
          ? await enrichSerpBusinessesWithGooglePlaceDetails(parsed.serpBusinesses, Number(input.lat), Number(input.lng))
          : parsed.serpBusinesses;
        return {
          rank: parsed.rank,
          competitors: parsed.competitors,
          serpBusinesses,
          rawResult: json,
          debug: {
            ...parsed.debug,
            endpointUsed: requestEndpoint,
            requestDepth: depth,
          },
        };
      } catch (error: any) {
        lastError = error;
        const aborted = error?.name === "AbortError" || String(error?.message || "").toLowerCase().includes("aborted");
        if (!aborted || attempt === 1) throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    throw (lastError instanceof Error ? lastError : new Error("Failed to load point SERP"));
  };

  return runPointRequest(endpoint);
}
