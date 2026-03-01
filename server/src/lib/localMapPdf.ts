import PDFDocument from "pdfkit";
import type { GridKeyword, GridSnapshot } from "@prisma/client";

type ParsedGridPoint = {
  lat: number;
  lng: number;
  rank: number | null;
};

function parseGrid(raw: string): ParsedGridPoint[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item: any) => ({
        lat: Number(item?.lat),
        lng: Number(item?.lng),
        rank: item?.rank == null ? null : Number(item.rank),
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

async function renderPdf(write: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    write(doc);
    doc.end();
  });
}

function drawGridTable(doc: PDFKit.PDFDocument, grid: ParsedGridPoint[]) {
  const size = Math.round(Math.sqrt(grid.length)) || 7;
  const cell = 28;
  const startX = 50;
  let y = doc.y + 10;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const idx = row * size + col;
      const point = grid[idx];
      const x = startX + col * cell;
      doc.rect(x, y, cell, cell).strokeColor("#D1D5DB").lineWidth(0.5).stroke();
      doc.fontSize(8).fillColor("#111827").text(rankLabel(point?.rank ?? null), x + 10, y + 10);
    }
    y += cell;
  }
  doc.moveDown(2);
}

export async function generateLocalMapKeywordPdfBuffer(
  keyword: GridKeyword,
  snapshots: GridSnapshot[]
): Promise<Buffer> {
  return renderPdf((doc) => {
    const current = snapshots[0];
    doc.fontSize(20).fillColor("#111827").text("Local Map Rankings Report", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor("#111827").text(`Keyword: ${keyword.keywordText}`);
    doc.text(`Business: ${keyword.businessName}`);
    if (keyword.businessAddress) doc.text(`Address: ${keyword.businessAddress}`);
    doc.text(`Place ID: ${keyword.placeId}`);
    doc.moveDown(0.6);
    doc.text(`Current ATA: ${current ? current.ataScore.toFixed(2) : "-"}`);
    doc.text(`Current Run Date: ${current ? current.runDate.toISOString().slice(0, 10) : "N/A"}`);
    doc.moveDown(0.8);

    if (!current) {
      doc.fontSize(11).fillColor("#6B7280").text("No snapshots available yet.");
      return;
    }

    doc.fontSize(12).fillColor("#111827").text("Current Grid");
    const grid = parseGrid(current.gridData);
    drawGridTable(doc, grid);
  });
}

export async function generateLocalMapBundlePdfBuffer(
  rows: Array<{ keyword: GridKeyword; latestSnapshot: GridSnapshot | null }>
): Promise<Buffer> {
  return renderPdf((doc) => {
    doc.fontSize(20).fillColor("#111827").text("Local Map Rankings - Dashboard Bundle");
    doc.moveDown();
    rows.forEach((row, index) => {
      if (index > 0) {
        doc.addPage();
      }
      doc.fontSize(15).fillColor("#111827").text(row.keyword.keywordText);
      doc.fontSize(11).fillColor("#374151").text(row.keyword.businessName);
      if (row.keyword.businessAddress) {
        doc.text(row.keyword.businessAddress);
      }
      doc.moveDown(0.4);
      doc.text(`ATA: ${row.latestSnapshot ? row.latestSnapshot.ataScore.toFixed(2) : "-"}`);
      doc.text(`Run Date: ${row.latestSnapshot ? row.latestSnapshot.runDate.toISOString().slice(0, 10) : "N/A"}`);
      doc.moveDown(0.4);
      if (row.latestSnapshot) {
        drawGridTable(doc, parseGrid(row.latestSnapshot.gridData));
      } else {
        doc.fillColor("#6B7280").text("No snapshot available yet.");
      }
    });
  });
}
