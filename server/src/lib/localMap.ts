type UnknownRecord = Record<string, unknown>;

export type LocalMapGridPoint = {
  lat: number;
  lng: number;
  rank: number | null;
  competitors: string[];
};

export type GoogleBusinessSearchResult = {
  placeId: string;
  businessName: string;
  address: string;
  lat: number;
  lng: number;
};

export type DataForSeoLocalGridResult = {
  gridData: LocalMapGridPoint[];
  ataScore: number;
  topCompetitorsCurrent: string[];
  rawResult: unknown;
};

type DataForSeoLocalGridRequest = {
  keyword: string;
  placeId: string;
  centerLat: number;
  centerLng: number;
  gridSize?: number;
  gridSpacingMiles?: number;
};

const EARTH_RADIUS_METERS = 6371000;
const DEFAULT_GRID_SIZE = 7;
const DEFAULT_GRID_SPACING_MILES = 0.5;
const NOT_RANKED_FALLBACK = 20;
const DEFAULT_DATAFORSEO_LANGUAGE_CODE = "en";
const DEFAULT_DATAFORSEO_DEVICE = "desktop";

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

function parseGridPointsFromResult(result: UnknownRecord): LocalMapGridPoint[] {
  const direct = Array.isArray(result.grid_data) ? result.grid_data : null;
  const items = Array.isArray(result.items) ? result.items : null;
  const source = direct ?? items ?? [];
  const parsed: LocalMapGridPoint[] = [];

  for (const row of source) {
    if (!row || typeof row !== "object") continue;
    const record = row as UnknownRecord;
    const lat = toNumber(record.lat ?? record.latitude ?? record.y);
    const lng = toNumber(record.lng ?? record.longitude ?? record.x);
    if (lat == null || lng == null) continue;

    const rank = normalizeMapRank(record.rank ?? record.position ?? record.absolute_rank);
    const competitors = parseCompetitorNames(
      record.competitors ??
      record.top_competitors ??
      record.top_3_competitors ??
      record.top_competitor_business_names
    );

    parsed.push({
      lat: Number(lat.toFixed(7)),
      lng: Number(lng.toFixed(7)),
      rank,
      competitors,
    });
  }

  return parsed;
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
      });
    }
  }
  return points;
}

function normalizePlaceId(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function parseItemsForCoordinate(
  responseJson: unknown,
  targetPlaceId: string
): { rank: number | null; competitors: string[] } {
  const tasks = Array.isArray((responseJson as UnknownRecord)?.tasks)
    ? ((responseJson as UnknownRecord).tasks as unknown[])
    : [];
  const firstTask = (tasks[0] as UnknownRecord | undefined) ?? {};
  const taskStatusCode = toNumber(firstTask.status_code);
  if (taskStatusCode != null && taskStatusCode >= 40000) {
    throw new Error(`DataForSEO task failed with status_code ${taskStatusCode}`);
  }

  const taskResults = Array.isArray(firstTask.result) ? (firstTask.result as unknown[]) : [];
  const firstResult = (taskResults[0] as UnknownRecord | undefined) ?? {};
  const items = Array.isArray(firstResult.items) ? (firstResult.items as unknown[]) : [];

  const ranked = items
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as UnknownRecord;
      const title = toStringOrNull(row.title) ?? "";
      const placeId = normalizePlaceId(row.place_id);
      const rank = normalizeMapRank(row.rank_absolute ?? row.rank_group ?? row.rank);
      return { title, placeId, rank };
    })
    .filter((entry): entry is { title: string; placeId: string; rank: number | null } => Boolean(entry));

  const competitors = ranked
    .slice(0, 3)
    .map((entry) => entry.title)
    .filter((name) => name.length > 0);
  const match = ranked.find((entry) => entry.placeId && entry.placeId === targetPlaceId);

  return {
    rank: match?.rank ?? null,
    competitors,
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
      detailsUrl.searchParams.set("fields", "place_id,name,formatted_address,geometry/location");
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

      if (!name || lat == null || lng == null) return null;
      return {
        placeId,
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
  const base64Auth = requireEnv("DATAFORSEO_BASE64");
  const endpoint = process.env.DATAFORSEO_LOCAL_RANK_ENDPOINT
    ?? "https://api.dataforseo.com/v3/serp/google/maps/live/advanced";

  const gridSize = input.gridSize ?? DEFAULT_GRID_SIZE;
  const gridSpacingMiles = input.gridSpacingMiles ?? DEFAULT_GRID_SPACING_MILES;
  const spacingMeters = milesToMeters(gridSpacingMiles);

  const languageCode = process.env.DATAFORSEO_LANGUAGE_CODE || DEFAULT_DATAFORSEO_LANGUAGE_CODE;
  const device = process.env.DATAFORSEO_DEVICE || DEFAULT_DATAFORSEO_DEVICE;
  const depth = Math.max(20, Number(process.env.DATAFORSEO_MAPS_DEPTH ?? 20));
  const targetPlaceId = normalizePlaceId(input.placeId);
  const points = gridCoordinates(input.centerLat, input.centerLng, gridSize, spacingMeters);

  const rawResult: unknown[] = [];
  const gridData = await mapWithConcurrency(points, 8, async (point) => {
    const payload = [
      {
        keyword: input.keyword,
        location_coordinate: `${point.lat},${point.lng},20z`,
        language_code: languageCode,
        device,
        depth,
      },
    ];

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${base64Auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const json = await getJsonResponse(response);
      rawResult.push(json);
      if (!response.ok) {
        throw new Error(`DataForSEO local grid request failed with status ${response.status}`);
      }

      const parsed = parseItemsForCoordinate(json, targetPlaceId);
      return {
        lat: point.lat,
        lng: point.lng,
        rank: parsed.rank,
        competitors: parsed.competitors,
      };
    } catch {
      return {
        lat: point.lat,
        lng: point.lng,
        rank: null,
        competitors: [],
      };
    }
  });

  const hasAnyRank = gridData.some((p) => p.rank != null);
  const normalizedGridData = hasAnyRank ? gridData : buildFallbackGrid(input.centerLat, input.centerLng, gridSize, spacingMeters);

  const ataScore = calculateAtaScore(normalizedGridData);
  const topCompetitorsCurrent = extractTopCompetitorsCurrent(normalizedGridData);

  return {
    gridData: normalizedGridData,
    ataScore,
    topCompetitorsCurrent,
    rawResult,
  };
}
