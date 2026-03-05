import PDFDocument from "pdfkit";
import type { GridKeyword, GridSnapshot } from "@prisma/client";

type ParsedGridPoint = {
  lat: number;
  lng: number;
  rank: number | null;
  competitors: string[];
};

type PdfChromeMeta = {
  title: string;
  subtitle?: string;
  generatedDate: string;
};

const CHROME = {
  headerBg: "#0F172A",
  accent: "#4F46E5",
  headerText: "#FFFFFF",
  muted: "#94A3B8",
  footerLine: "#E2E8F0",
  footerText: "#64748B",
} as const;

function drawCoverPage(
  doc: PDFKit.PDFDocument,
  options: {
    reportLabel: string;
    title: string;
    subtitle?: string;
    periodLine?: string;
  }
) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const labelY = pageHeight * 0.32;
  const lineW = 50;

  doc.save();
  doc.rect(0, 0, pageWidth, pageHeight).fill(CHROME.headerBg);
  doc.rect(0, 0, pageWidth, 4).fill(CHROME.accent);
  doc.fillColor(CHROME.muted).fontSize(11).font("Helvetica").text(options.reportLabel, 0, labelY, {
    align: "center",
    width: pageWidth,
  });
  doc.moveTo(pageWidth / 2 - lineW / 2, labelY + 16).lineTo(pageWidth / 2 + lineW / 2, labelY + 16).lineWidth(1).strokeColor(CHROME.accent).stroke();
  doc.fillColor("#FFFFFF").fontSize(28).font("Helvetica-Bold").text(options.title, 0, labelY + 28, {
    align: "center",
    width: pageWidth,
  });
  if (options.subtitle) {
    doc.fillColor(CHROME.muted).fontSize(12).font("Helvetica").text(options.subtitle, 0, labelY + 62, {
      align: "center",
      width: pageWidth,
    });
  }
  if (options.periodLine) {
    doc.fillColor(CHROME.footerText).fontSize(10).font("Helvetica").text(options.periodLine, 0, labelY + 100, {
      align: "center",
      width: pageWidth,
    });
  }
  doc.rect(0, pageHeight - 4, pageWidth, 4).fill(CHROME.accent);
  doc.restore();
}

function parseGrid(raw: string): ParsedGridPoint[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any) => ({
        lat: Number(item?.lat),
        lng: Number(item?.lng),
        rank: item?.rank == null ? null : Number(item.rank),
        competitors: Array.isArray(item?.competitors)
          ? item.competitors.filter((v: unknown): v is string => typeof v === "string").slice(0, 3)
          : [],
      }))
      .filter((item: ParsedGridPoint) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
  } catch {
    return [];
  }
}

function rankLabel(rank: number | null): string {
  if (rank == null) return "NR";
  return String(rank);
}

function heatColors(rank: number | null): { fill: string; text: string } {
  if (rank != null && rank >= 1 && rank <= 3) return { fill: "#10B981", text: "#FFFFFF" };
  if (rank != null && rank >= 4 && rank <= 10) return { fill: "#FACC15", text: "#111827" };
  if (rank != null && rank >= 11 && rank <= 20) return { fill: "#FB923C", text: "#111827" };
  return { fill: "#F87171", text: "#111827" };
}

function topCompetitors(points: ParsedGridPoint[]): string[] {
  const counts = new Map<string, number>();
  for (const point of points) {
    for (const competitor of point.competitors) {
      const name = String(competitor || "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
}

function parseDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function clampText(value: string, max = 42): string {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function contentBottomY(doc: PDFKit.PDFDocument): number {
  // Keep clear space above footer chrome.
  return doc.page.height - 46;
}

function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number): void {
  if (doc.y + Math.max(0, neededHeight) > contentBottomY(doc)) {
    doc.addPage();
  }
}

function gridCellSize(doc: PDFKit.PDFDocument, size: number, compact = false): number {
  const marginX = 50;
  const availableW = doc.page.width - marginX * 2;
  const preferredCell = compact ? 18 : 24;
  const minCell = compact ? 14 : 18;
  const maxCellByWidth = Math.floor(availableW / Math.max(1, size));
  return Math.max(minCell, Math.min(preferredCell, maxCellByWidth));
}

function estimateSnapshotSectionHeight(
  doc: PDFKit.PDFDocument,
  snapshot: GridSnapshot | null,
  options?: { compact?: boolean; showCompetitors?: boolean; showKeywordMeta?: boolean; subtitle?: string }
): number {
  const compact = Boolean(options?.compact);
  let h = compact ? 28 : 32; // section pill/title + spacing
  if (!snapshot) return h + 24;
  h += options?.showKeywordMeta === false ? 16 : 34;
  h += options?.subtitle ? 14 : 0;
  h += 8; // pre-grid spacing
  const parsed = parseGrid(snapshot.gridData);
  const size = Math.round(Math.sqrt(parsed.length || 49)) || 7;
  h += gridCellSize(doc, size, compact) * size + 8;
  if (options?.showCompetitors) h += 16;
  h += compact ? 10 : 14;
  return h;
}

function estimateTrendSectionHeight(snapshots: GridSnapshot[]): number {
  return snapshots.length < 2 ? 58 : 142;
}

function drawSectionPill(
  doc: PDFKit.PDFDocument,
  label: string,
  colors: { fill: string; text: string } = { fill: "#EEF2FF", text: "#3730A3" }
) {
  const x = 40;
  const y = doc.y;
  doc.save();
  doc.font("Helvetica-Bold").fontSize(10);
  const textW = doc.widthOfString(label);
  const width = Math.min(doc.page.width - 80, textW + 20);
  doc.roundedRect(x, y, width, 18, 6).fill(colors.fill);
  doc.fillColor(colors.text).text(label, x + 10, y + 5, { lineBreak: false });
  doc.restore();
  doc.y = y + 22;
}

function drawKeywordSummaryCard(
  doc: PDFKit.PDFDocument,
  keyword: GridKeyword,
  current: GridSnapshot | null
) {
  const cardX = 40;
  const cardY = doc.y;
  const cardW = doc.page.width - 80;
  const cardH = 118;
  doc.save();
  doc.roundedRect(cardX, cardY, cardW, cardH, 8).fill("#F8FAFC");
  doc.roundedRect(cardX, cardY, cardW, cardH, 8).lineWidth(0.8).strokeColor("#E2E8F0").stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748B").text("KEYWORD", cardX + 12, cardY + 10, { lineBreak: false });
  doc.font("Helvetica").fontSize(12).fillColor("#0F172A").text(keyword.keywordText, cardX + 12, cardY + 24, { width: cardW - 24 });
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748B").text("BUSINESS", cardX + 12, cardY + 44, { lineBreak: false });
  doc.font("Helvetica").fontSize(11).fillColor("#0F172A").text(keyword.businessName, cardX + 12, cardY + 57, { width: cardW - 24 });
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748B").text("LOCATION", cardX + 12, cardY + 75, { lineBreak: false });
  doc.font("Helvetica").fontSize(10).fillColor("#1F2937").text(keyword.businessAddress || "N/A", cardX + 12, cardY + 87, { width: cardW - 24 });
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748B").text("CURRENT ATA", cardX + cardW - 170, cardY + 10, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#065F46").text(current ? current.ataScore.toFixed(2) : "-", cardX + cardW - 170, cardY + 24, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748B").text("RUN DATE", cardX + cardW - 170, cardY + 58, { lineBreak: false });
  doc.font("Helvetica").fontSize(10).fillColor("#1F2937").text(current ? current.runDate.toISOString().slice(0, 10) : "N/A", cardX + cardW - 170, cardY + 72, { lineBreak: false });
  doc.restore();
  doc.y = cardY + cardH + 6;
}

async function renderPdf(
  write: (doc: PDFKit.PDFDocument) => void,
  options?: { title?: string; subtitle?: string; skipChromeOnFirstPage?: boolean }
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const generatedDate = parseDate(new Date());
    const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];
    const chromeMeta: PdfChromeMeta = {
      title: options?.title || "Local Map Rankings Report",
      subtitle: options?.subtitle || "Confidential",
      generatedDate,
    };

    const drawHeader = (meta: PdfChromeMeta) => {
      const pageWidth = doc.page.width;
      doc.save();
      doc.rect(0, 0, pageWidth, 30).fill(CHROME.headerBg);
      doc.rect(0, 30, pageWidth, 2).fill(CHROME.accent);
      doc.fillColor(CHROME.headerText).fontSize(10).font("Helvetica-Bold").text(meta.title, 40, 10, { lineBreak: false });
      doc.fillColor(CHROME.muted).fontSize(8).font("Helvetica").text(clampText(meta.subtitle || "", 34), pageWidth - 40, 10, { align: "right", lineBreak: false });
      doc.fillColor(CHROME.muted).fontSize(8).font("Helvetica").text(meta.generatedDate, pageWidth - 40, 20, { align: "right", lineBreak: false });
      doc.restore();
    };

    const drawFooter = (pageNum: number, totalPages: number, meta: PdfChromeMeta) => {
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const footerY = pageHeight - 20;
      doc.save();
      doc.moveTo(40, pageHeight - 30).lineTo(pageWidth - 40, pageHeight - 30).lineWidth(0.6).strokeColor(CHROME.footerLine).stroke();
      doc.fillColor(CHROME.footerText).fontSize(8).font("Helvetica").text(`Page ${pageNum} of ${totalPages}`, 0, footerY, {
        align: "center",
        width: pageWidth,
        lineBreak: false,
      });
      doc.fillColor(CHROME.muted).fontSize(7).font("Helvetica").text(`Generated ${meta.generatedDate}`, 40, footerY, { lineBreak: false });
      doc.fillColor(CHROME.muted).fontSize(7).font("Helvetica").text("Confidential", pageWidth - 100, footerY, { width: 60, align: "right", lineBreak: false });
      doc.restore();
    };

    const paintChromeAllPages = (meta: PdfChromeMeta) => {
      const range = (doc as any).bufferedPageRange?.() as { start: number; count: number } | undefined;
      if (!range || !range.count) return;
      const startIdx = options?.skipChromeOnFirstPage ? 1 : 0;
      for (let i = startIdx; i < range.count; i += 1) {
        (doc as any).switchToPage(range.start + i);
        drawHeader(meta);
        drawFooter(i + 1, range.count, meta);
      }
    };

    doc.on("pageAdded", () => {
      doc.y = 56;
    });
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.y = 56;
    write(doc);
    paintChromeAllPages(chromeMeta);
    doc.end();
  });
}

function drawGridTable(
  doc: PDFKit.PDFDocument,
  grid: ParsedGridPoint[],
  options?: { compact?: boolean }
) {
  const size = Math.round(Math.sqrt(grid.length)) || 7;
  const marginX = 50;
  const availableW = doc.page.width - marginX * 2;
  const preferredCell = gridCellSize(doc, size, options?.compact);
  const minCell = options?.compact ? 8 : 10;
  // Auto-control grid size based on remaining page height.
  const topGap = 10;
  const trailingGap = options?.compact ? 6 : 8;
  const availableH = Math.max(80, contentBottomY(doc) - (doc.y + topGap + trailingGap));
  const cellByHeight = Math.floor(availableH / Math.max(1, size));
  const cell = Math.max(minCell, Math.min(preferredCell, cellByHeight));
  const gridW = cell * size;
  const startX = marginX + Math.max(0, (availableW - gridW) / 2);
  let y = doc.y + topGap;
  const centerIdx = Math.floor(size / 2) * size + Math.floor(size / 2);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const idx = row * size + col;
      const point = grid[idx];
      const x = startX + col * cell;
      const { fill, text } = heatColors(point?.rank ?? null);
      doc.rect(x, y, cell, cell).fillColor(fill).fill();
      doc.rect(x, y, cell, cell).strokeColor("#FFFFFF").lineWidth(0.5).stroke();
      doc.fontSize(options?.compact ? 6 : 7).fillColor(text).text(rankLabel(point?.rank ?? null), x + (options?.compact ? 5 : 7), y + (options?.compact ? 6 : 8));
      if (idx === centerIdx) {
        doc.fontSize(options?.compact ? 5 : 6).fillColor(text).text("PIN", x + 2, y + 2);
      }
    }
    y += cell;
  }
  // Keep document cursor in sync after drawing absolute-positioned cells.
  doc.y = y + trailingGap;
}

function drawSnapshotSection(
  doc: PDFKit.PDFDocument,
  title: string,
  snapshot: GridSnapshot | null,
  keyword: GridKeyword,
  options?: {
    showCompetitors?: boolean;
    compact?: boolean;
    subtitle?: string;
    showKeywordMeta?: boolean;
    tailSpacing?: boolean;
  }
) {
  drawSectionPill(
    doc,
    title,
    options?.compact
      ? { fill: "#F5F3FF", text: "#5B21B6" }
      : { fill: "#E0E7FF", text: "#3730A3" }
  );
  if (!snapshot) {
    doc.fontSize(10).fillColor("#6B7280").text("No snapshot available.");
    doc.moveDown(0.8);
    return;
  }

  if (options?.showKeywordMeta !== false) {
    doc.fontSize(10).fillColor("#374151").text(`Keyword: ${keyword.keywordText}`);
    doc.text(`Business: ${keyword.businessName}`);
  }
  if (options?.subtitle) {
    doc.fontSize(9).fillColor("#4B5563").text(options.subtitle);
  } else {
    doc.fontSize(10).fillColor("#374151").text(`Run Date: ${parseDate(snapshot.runDate)}  |  ATA: ${snapshot.ataScore.toFixed(2)}`);
  }
  doc.moveDown(0.4);
  const parsedGrid = parseGrid(snapshot.gridData);
  drawGridTable(doc, parsedGrid, { compact: options?.compact });
  if (options?.showCompetitors) {
    const comps = topCompetitors(parsedGrid);
    doc.fontSize(9).fillColor("#4B5563").text(
      comps.length ? `Top Competitors (Current): ${comps.join(", ")}` : "Top Competitors (Current): Not available"
    );
  }
  if (options?.tailSpacing !== false) {
    doc.moveDown(options?.compact ? 0.45 : 0.7);
  }
}

function drawTrendChart(doc: PDFKit.PDFDocument, snapshots: GridSnapshot[]) {
  const sortedAsc = [...snapshots].sort((a, b) => a.runDate.getTime() - b.runDate.getTime());
  if (sortedAsc.length < 2) {
    doc.fontSize(10).fillColor("#6B7280").text("ATA trend unavailable (need at least 2 runs).");
    doc.moveDown(0.6);
    return;
  }
  const chartX = 50;
  const chartY = doc.y + 8;
  const chartW = Math.max(320, doc.page.width - chartX * 2);
  const maxChartH = Math.max(56, contentBottomY(doc) - chartY - 20);
  const chartH = Math.min(82, maxChartH);
  const values = sortedAsc.map((s) => s.ataScore);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.01, max - min);

  doc.rect(chartX, chartY, chartW, chartH).strokeColor("#E5E7EB").lineWidth(0.8).stroke();
  let lastX = 0;
  let lastY = 0;
  sortedAsc.forEach((snap, idx) => {
    const t = sortedAsc.length === 1 ? 0 : idx / (sortedAsc.length - 1);
    const px = chartX + t * chartW;
    const py = chartY + chartH - ((snap.ataScore - min) / span) * chartH;
    if (idx > 0) {
      doc.moveTo(lastX, lastY).lineTo(px, py).strokeColor("#2563EB").lineWidth(1.4).stroke();
    }
    doc.circle(px, py, 2.2).fillColor("#2563EB").fill();
    lastX = px;
    lastY = py;
  });
  doc.fontSize(8).fillColor("#6B7280").text(`Low ${min.toFixed(2)}  High ${max.toFixed(2)}`, chartX, chartY + chartH + 4);
  doc.y = chartY + chartH + 18;
}

export async function generateLocalMapKeywordPdfBuffer(
  keyword: GridKeyword,
  snapshots: GridSnapshot[]
): Promise<Buffer> {
  return renderPdf((doc) => {
    const sorted = [...snapshots].sort((a, b) => b.runDate.getTime() - a.runDate.getTime());
    const current = sorted[0] ?? null;
    const previousThree = sorted.slice(1, 4);
    const benchmark = sorted.find((snap) => snap.isBenchmark) ?? null;
    const generatedDate = parseDate(new Date());

    drawCoverPage(doc, {
      reportLabel: "LOCAL MAP RANKINGS REPORT",
      title: keyword.keywordText,
      subtitle: keyword.businessName,
      periodLine: `Generated ${generatedDate}`,
    });
    doc.addPage();

    doc.fontSize(20).fillColor("#111827").text("Local Map Report", { align: "left" });
    doc.moveDown(0.35);
    drawKeywordSummaryCard(doc, keyword, current);
    doc.fontSize(9).fillColor("#6B7280").text("ATA = average of all 49 grid positions; missing ranks are counted as 20. Lower ATA is better.");
    doc.moveDown(0.55);
    ensureSpace(doc, estimateTrendSectionHeight(sorted));
    drawSectionPill(doc, "ATA SCORE TREND", { fill: "#E0F2FE", text: "#0C4A6E" });
    drawTrendChart(doc, sorted);

    if (!sorted.length) {
      const noDataY = doc.y;
      doc.save();
      doc.roundedRect(40, noDataY, doc.page.width - 80, 58, 8).fill("#FFF7ED");
      doc.roundedRect(40, noDataY, doc.page.width - 80, 58, 8).lineWidth(0.8).strokeColor("#FDBA74").stroke();
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#9A3412").text("No snapshots available yet.", 52, noDataY + 14);
      doc.font("Helvetica").fontSize(10).fillColor("#7C2D12").text(
        "Run a Local Map snapshot first, then download this report again.",
        52,
        noDataY + 32,
        { width: doc.page.width - 104 }
      );
      doc.restore();
      doc.y = noDataY + 66;
      return;
    }

    ensureSpace(doc, estimateSnapshotSectionHeight(doc, current, { showCompetitors: true }));
    drawSnapshotSection(doc, "CURRENT", current, keyword, { showCompetitors: true });

    ensureSpace(doc, 30);
    drawSectionPill(doc, "PREVIOUS 3 RUNS", { fill: "#F5F3FF", text: "#5B21B6" });
    if (previousThree.length) {
      for (const [idx, prev] of previousThree.entries()) {
        ensureSpace(doc, estimateSnapshotSectionHeight(doc, prev, {
          compact: true,
          showKeywordMeta: false,
          subtitle: `${parseDate(prev.runDate)}  |  ATA: ${prev.ataScore.toFixed(2)}`,
        }));
        drawSnapshotSection(doc, `PREVIOUS ${idx + 1}`, prev, keyword, {
          compact: true,
          showKeywordMeta: false,
          subtitle: `${parseDate(prev.runDate)}  |  ATA: ${prev.ataScore.toFixed(2)}`,
        });
      }
    } else {
      doc.fontSize(10).fillColor("#6B7280").text("No previous runs yet.");
      doc.moveDown(0.6);
    }

    if (benchmark) {
      ensureSpace(doc, estimateSnapshotSectionHeight(doc, benchmark, {
        subtitle: `Benchmark - ${parseDate(benchmark.runDate)}`,
      }));
      drawSnapshotSection(doc, "YOUR BENCHMARK", benchmark, keyword, {
        subtitle: `Benchmark - ${parseDate(benchmark.runDate)}`,
        tailSpacing: false,
      });
    }
  }, {
    title: "Local Map Report",
    subtitle: keyword.businessName,
    skipChromeOnFirstPage: true,
  });
}

export async function generateLocalMapBundlePdfBuffer(
  rows: Array<{ keyword: GridKeyword; snapshots: GridSnapshot[] }>
): Promise<Buffer> {
  return renderPdf((doc) => {
    doc.fontSize(20).fillColor("#111827").text("Local Map Rankings - Dashboard Bundle");
    doc.moveDown(0.45);
    rows.forEach((row, index) => {
      if (index > 0) {
        doc.addPage();
      }
      const sorted = [...row.snapshots].sort((a, b) => b.runDate.getTime() - a.runDate.getTime());
      const current = sorted[0] ?? null;
      const previousThree = sorted.slice(1, 4);
      const benchmark = sorted.find((snap) => snap.isBenchmark) ?? null;

      doc.fontSize(15).fillColor("#111827").text(row.keyword.keywordText);
      doc.moveDown(0.2);
      drawKeywordSummaryCard(doc, row.keyword, current);
      doc.fontSize(9).fillColor("#6B7280").text("ATA = average of all 49 grid positions; missing ranks are counted as 20. Lower ATA is better.");
      doc.moveDown(0.45);

      if (!current) {
        const noDataY = doc.y;
        doc.save();
        doc.roundedRect(40, noDataY, doc.page.width - 80, 48, 8).fill("#FFF7ED");
        doc.roundedRect(40, noDataY, doc.page.width - 80, 48, 8).lineWidth(0.8).strokeColor("#FDBA74").stroke();
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#9A3412").text("No snapshot available yet.", 52, noDataY + 16);
        doc.restore();
        doc.y = noDataY + 56;
        return;
      }

      ensureSpace(doc, estimateTrendSectionHeight(sorted));
      drawSectionPill(doc, "ATA SCORE TREND", { fill: "#E0F2FE", text: "#0C4A6E" });
      drawTrendChart(doc, sorted);
      ensureSpace(doc, estimateSnapshotSectionHeight(doc, current, { showCompetitors: true }));
      drawSnapshotSection(doc, "CURRENT", current, row.keyword, { showCompetitors: true });
      ensureSpace(doc, 30);
      drawSectionPill(doc, "PREVIOUS 3 RUNS", { fill: "#F5F3FF", text: "#5B21B6" });
      previousThree.forEach((snap, idx) => {
        ensureSpace(doc, estimateSnapshotSectionHeight(doc, snap, {
          compact: true,
          showKeywordMeta: false,
          subtitle: `${parseDate(snap.runDate)}  |  ATA: ${snap.ataScore.toFixed(2)}`,
        }));
        drawSnapshotSection(doc, `PREVIOUS ${idx + 1}`, snap, row.keyword, {
          compact: true,
          showKeywordMeta: false,
          subtitle: `${parseDate(snap.runDate)}  |  ATA: ${snap.ataScore.toFixed(2)}`,
        });
      });
      if (benchmark) {
        ensureSpace(doc, estimateSnapshotSectionHeight(doc, benchmark, {
          subtitle: `Benchmark - ${parseDate(benchmark.runDate)}`,
        }));
        drawSnapshotSection(doc, "YOUR BENCHMARK", benchmark, row.keyword, {
          subtitle: `Benchmark - ${parseDate(benchmark.runDate)}`,
          tailSpacing: false,
        });
      }
    });
  }, {
    title: "Local Map Rankings - Dashboard Bundle",
    subtitle: "Confidential",
  });
}
