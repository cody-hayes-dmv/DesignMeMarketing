/**
 * Import historical DataForSEO daily spend into dataforseo_daily_spend.
 *
 * Supports CSV or JSON input.
 *
 * Examples:
 *   npm run dataforseo:import -- --file "C:\\temp\\dataforseo-history.csv" --format csv
 *   npm run dataforseo:import -- --file "./backfill.json" --format json
 *   npm run dataforseo:import -- --file "./history.csv" --dry-run
 *
 * CSV minimum columns:
 *   date,total
 *
 * Optional CSV columns:
 *   byApi             (JSON string)
 *   any numeric cols  (treated as API buckets in byApi, excluding date/total/byApi)
 */

import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

type DailySpendRow = {
  date: string;
  total: number;
  byApi: Record<string, number>;
};

const prisma = new PrismaClient();

function getArg(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[$,]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((v) => v.trim());
}

function parseCsv(content: string): DailySpendRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const dateIdx = headers.findIndex((h) => h.toLowerCase() === "date");
  const totalIdx = headers.findIndex((h) => h.toLowerCase() === "total");
  const byApiIdx = headers.findIndex((h) => h.toLowerCase() === "byapi");

  if (dateIdx < 0 || totalIdx < 0) {
    throw new Error("CSV requires headers: date,total");
  }

  const rows: DailySpendRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const date = (cols[dateIdx] || "").slice(0, 10);
    const total = toNumber(cols[totalIdx]);
    if (!isDateString(date) || total === null) continue;

    let byApi: Record<string, number> = {};
    if (byApiIdx >= 0 && cols[byApiIdx]) {
      try {
        const parsed = JSON.parse(cols[byApiIdx]);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          byApi = Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>)
              .map(([k, v]) => [k, toNumber(v)])
              .filter(([, v]) => v !== null)
              .map(([k, v]) => [k, v as number])
          );
        }
      } catch {
        // ignore malformed byApi JSON in CSV row
      }
    } else {
      // Fallback: treat extra numeric columns as byApi buckets.
      for (let c = 0; c < headers.length; c += 1) {
        if (c === dateIdx || c === totalIdx || c === byApiIdx) continue;
        const key = headers[c];
        const n = toNumber(cols[c]);
        if (!key || n === null) continue;
        byApi[key] = n;
      }
    }

    rows.push({ date, total, byApi });
  }

  return rows;
}

function parseJson(content: string): DailySpendRow[] {
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON must be an array of rows");
  }

  const rows: DailySpendRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const dateRaw = typeof rec.date === "string" ? rec.date.slice(0, 10) : "";
    const total = toNumber(rec.total);
    if (!isDateString(dateRaw) || total === null) continue;

    let byApi: Record<string, number> = {};
    if (rec.byApi && typeof rec.byApi === "object" && !Array.isArray(rec.byApi)) {
      byApi = Object.fromEntries(
        Object.entries(rec.byApi as Record<string, unknown>)
          .map(([k, v]) => [k, toNumber(v)])
          .filter(([, v]) => v !== null)
          .map(([k, v]) => [k, v as number])
      );
    }

    rows.push({ date: dateRaw, total, byApi });
  }

  return rows;
}

function dedupeByDate(rows: DailySpendRow[]): DailySpendRow[] {
  // Keep last occurrence for each date.
  const byDate = new Map<string, DailySpendRow>();
  rows.forEach((r) => byDate.set(r.date, r));
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function main() {
  const fileArg = getArg("file");
  const formatArg = (getArg("format") || "").toLowerCase();
  const dryRun = hasFlag("dry-run");

  if (!fileArg) {
    throw new Error("Missing --file argument");
  }

  const filePath = path.isAbsolute(fileArg) ? fileArg : path.join(process.cwd(), fileArg);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const format =
    formatArg === "csv" || formatArg === "json"
      ? formatArg
      : ext === ".csv"
      ? "csv"
      : ext === ".json"
      ? "json"
      : "";

  if (!format) {
    throw new Error('Could not infer format. Pass --format csv or --format json');
  }

  const content = fs.readFileSync(filePath, "utf8");
  const rawRows = format === "csv" ? parseCsv(content) : parseJson(content);
  const rows = dedupeByDate(rawRows);

  if (rows.length === 0) {
    console.log("No valid rows found. Nothing to import.");
    return;
  }

  console.log(`Parsed ${rows.length} unique day(s).`);
  console.log(`Date range: ${rows[0].date} -> ${rows[rows.length - 1].date}`);

  if (dryRun) {
    console.log("Dry run enabled. No database writes performed.");
    return;
  }

  let upserted = 0;
  for (const row of rows) {
    await prisma.dataForSeoDailySpend.upsert({
      where: { date: row.date },
      create: {
        date: row.date,
        total: row.total,
        byApi: JSON.stringify(row.byApi || {}),
      },
      update: {
        total: row.total,
        byApi: JSON.stringify(row.byApi || {}),
      },
    });
    upserted += 1;
  }

  console.log(`Upserted ${upserted} day(s) into dataforseo_daily_spend.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

