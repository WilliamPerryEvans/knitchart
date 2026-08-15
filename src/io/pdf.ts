import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Chart } from '../model/types';
import { cellAspect, finishedSize } from '../model/gauge';
import { encodeRow } from '../model/rle';
import {
  rowNumber,
  rowNumberOnRight,
  rowSide,
  showStitchLabel,
  stitchLabelStep,
  stitchNumber,
} from '../domain/labels';
import {
  fitCellSize,
  mmToPoints,
  pageDimensions,
  planTiles,
  tilePositionLabel,
  tileRangeLabel,
  type Orientation,
  type PageSizeId,
  type TilePlan,
} from '../domain/pageLayout';

export interface PdfOptions {
  pageSize: PageSizeId;
  orientation: Orientation;
  /** Stitch width in millimetres, or 'fit' to squeeze the chart onto one page. */
  cellSizeMm: number | 'fit';
  /** Stitches and rows shared between neighbouring pages, for taping up. */
  overlap: number;
  /** Ignore gauge and draw square cells. */
  squareCells: boolean;
  includeLegend: boolean;
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  pageSize: 'letter',
  orientation: 'portrait',
  cellSizeMm: 6,
  overlap: 2,
  squareCells: false,
  includeLegend: true,
};

const MARGIN = 36; // 0.5in
const HEADER_H = 32;
const LEGEND_SWATCH = 9;
const LEGEND_ROW_H = 13;
const LEGEND_COLS = 4;
/** Gauge/size line at the very bottom, plus the gap above it. */
const GAUGE_LINE_H = 16;
/** Room for the "pages overlap by N" note, reserved on every page so all
 *  pages share one geometry even though only the first carries the note. */
const NOTE_H = 11;
const CAPTION_H = 13;

const INK = rgb(0.13, 0.13, 0.13);
const MUTED = rgb(0.42, 0.45, 0.5);
const GRID_THIN = rgb(0.65, 0.65, 0.65);
const GRID_HEAVY = rgb(0.2, 0.2, 0.2);
const RS_COLOR = rgb(0.2, 0.31, 0.44);
const WS_COLOR = rgb(0.48, 0.42, 0.35);

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const v = parseInt(full, 16);
  if (!Number.isFinite(v)) return rgb(1, 0, 1);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

/**
 * The built-in fonts only speak WinAnsi, so anything outside it (CJK, emoji in
 * a chart title) would throw at draw time. Swap those for '?' rather than
 * failing the whole export.
 */
function safeText(text: string): string {
  return [...text]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code >= 32 && code <= 126) return ch;
      if ('–—‘’“”•…°×'.includes(ch)) return ch;
      if (code >= 160 && code <= 255) return ch;
      return '?';
    })
    .join('');
}

/** Small solid triangle standing in for the ← / → glyphs, which WinAnsi lacks. */
function drawArrow(page: PDFPage, x: number, y: number, size: number, dir: 'left' | 'right') {
  const h = size * 0.5;
  const tip = dir === 'left' ? x : x + size;
  const back = dir === 'left' ? x + size : x;
  page.drawSvgPath(`M ${tip} 0 L ${back} ${-h / 2} L ${back} ${h / 2} Z`, {
    x: 0,
    y,
    color: MUTED,
  });
}

interface Metrics {
  cellW: number;
  cellH: number;
  fontSize: number;
  charW: number;
  gutterLeft: number;
  gutterRight: number;
  gutterBottom: number;
  sideW: number;
}

function metricsFor(chart: Chart, cellW: number, cellH: number): Metrics {
  // Labels must stay legible on paper even when stitches are small.
  const fontSize = Math.max(4.5, Math.min(9, cellH * 0.62));
  const charW = fontSize * 0.58;
  const rowDigits = String(chart.rows).length;
  const sideW = charW * 2 + 4; // "RS" / "WS"
  const numW = charW * rowDigits + fontSize * 0.9; // digits plus an arrow
  return {
    cellW,
    cellH,
    fontSize,
    charW,
    sideW,
    gutterLeft: sideW + numW,
    gutterRight: numW,
    gutterBottom: fontSize + 4,
  };
}

/** Total height reserved below the chart: gauge line, key, and overlap note. */
function footerHeight(chart: Chart, includeLegend: boolean): number {
  const base = GAUGE_LINE_H + NOTE_H;
  if (!includeLegend) return base;
  const rows = Math.ceil(chart.palette.length / LEGEND_COLS);
  return base + rows * LEGEND_ROW_H + CAPTION_H;
}

/** Y of the overlap note, which sits just above the key. */
function noteY(chart: Chart, includeLegend: boolean): number {
  return MARGIN + footerHeight(chart, includeLegend) - NOTE_H;
}

/** Stitch counts per palette entry, for the legend. */
export function stitchCounts(chart: Chart): number[] {
  const counts = new Array(chart.palette.length).fill(0);
  for (const v of chart.grid) if (v < counts.length) counts[v]++;
  return counts;
}

function drawHeader(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  chart: Chart,
  right: string,
  pageW: number,
  pageH: number
) {
  const top = pageH - MARGIN - 11;
  page.drawText(safeText(chart.title || 'Untitled chart'), {
    x: MARGIN,
    y: top,
    size: 11,
    font: fonts.bold,
    color: INK,
  });
  const rightText = safeText(right);
  const w = fonts.regular.widthOfTextAtSize(rightText, 8.5);
  page.drawText(rightText, {
    x: pageW - MARGIN - w,
    y: top + 1,
    size: 8.5,
    font: fonts.regular,
    color: MUTED,
  });
  page.drawLine({
    start: { x: MARGIN, y: pageH - MARGIN - 17 },
    end: { x: pageW - MARGIN, y: pageH - MARGIN - 17 },
    thickness: 0.5,
    color: GRID_THIN,
  });
}

function drawLegend(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  chart: Chart,
  counts: number[],
  pageW: number,
  include: boolean
) {
  const size = finishedSize(chart.gauge, chart.stitches, chart.rows);
  const unit = chart.gauge.unit === 'in' ? '"' : ' cm';
  const gaugeLine =
    `${chart.stitches} sts x ${chart.rows} ${chart.direction === 'round' ? 'rnds' : 'rows'}` +
    ` · gauge ${chart.gauge.stsPer4in} sts / ${chart.gauge.rowsPer4in} rows per ` +
    `${chart.gauge.unit === 'in' ? '4"' : '10 cm'}` +
    ` · finished ${size.width.toFixed(1)}${unit} x ${size.height.toFixed(1)}${unit}` +
    ` · ${chart.direction === 'round' ? 'in the round' : 'knit flat'}`;

  page.drawText(safeText(gaugeLine), {
    x: MARGIN,
    y: MARGIN,
    size: 7.5,
    font: fonts.regular,
    color: MUTED,
  });
  if (!include) return;

  // Stack upward from the gauge line: swatch rows, then the "Key" caption.
  const rowCount = Math.ceil(chart.palette.length / LEGEND_COLS);
  const bottomRowY = MARGIN + GAUGE_LINE_H;
  const captionY = bottomRowY + rowCount * LEGEND_ROW_H;
  page.drawText('Key', { x: MARGIN, y: captionY, size: 8, font: fonts.bold, color: INK });

  const colW = (pageW - MARGIN * 2) / LEGEND_COLS;
  chart.palette.forEach((color, i) => {
    const col = i % LEGEND_COLS;
    const row = Math.floor(i / LEGEND_COLS);
    const x = MARGIN + col * colW;
    // row 0 is the topmost, so it sits highest
    const y = bottomRowY + (rowCount - 1 - row) * LEGEND_ROW_H;
    page.drawRectangle({
      x,
      y,
      width: LEGEND_SWATCH,
      height: LEGEND_SWATCH,
      color: hexToRgb(color.hex),
      borderColor: GRID_HEAVY,
      borderWidth: 0.4,
    });
    const label = `${color.name || `Color ${i}`} — ${counts[i]} sts`;
    page.drawText(safeText(label), {
      x: x + LEGEND_SWATCH + 4,
      y: y + 1,
      size: 7.5,
      font: fonts.regular,
      color: INK,
    });
  });
}

/** Draw one tile of the chart: cells, grid lines, and the repeated gutters. */
function drawTile(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  chart: Chart,
  tile: TilePlan,
  m: Metrics,
  originX: number,
  topY: number
) {
  const { cellW, cellH } = m;
  const cellX = (localCol: number) => originX + localCol * cellW;
  // PDF y grows upward, but grid row 0 is the top of the chart.
  const cellY = (localRow: number) => topY - (localRow + 1) * cellH;

  // --- stitches, merged into horizontal runs so a solid area is one rect ---
  for (let r = 0; r < tile.rows; r++) {
    const gridRow = tile.row + r;
    const slice = chart.grid.subarray(
      gridRow * chart.stitches + tile.col,
      gridRow * chart.stitches + tile.col + tile.cols
    );
    let col = 0;
    for (const [colorIndex, run] of encodeRow(slice)) {
      const hex = chart.palette[colorIndex]?.hex;
      // Skip the background: white paper already reads as the main color, and
      // leaving it unpainted keeps the file small and the print cheap.
      if (hex && colorIndex !== 0) {
        page.drawRectangle({
          x: cellX(col),
          y: cellY(r),
          width: run * cellW,
          height: cellH,
          color: hexToRgb(hex),
        });
      }
      col += run;
    }
  }

  // --- grid lines: every stitch, heavier every 5th counted from the chart's
  // bottom-right, so the guides line up with how a knitter counts ---
  const gridW = tile.cols * cellW;
  const gridH = tile.rows * cellH;
  for (let c = 0; c <= tile.cols; c++) {
    const stitchesFromRight = chart.stitches - (tile.col + c);
    const heavy = stitchesFromRight % 5 === 0;
    page.drawLine({
      start: { x: cellX(c), y: topY },
      end: { x: cellX(c), y: topY - gridH },
      thickness: heavy ? 0.9 : 0.3,
      color: heavy ? GRID_HEAVY : GRID_THIN,
    });
  }
  for (let r = 0; r <= tile.rows; r++) {
    const rowsFromBottom = chart.rows - (tile.row + r);
    const heavy = rowsFromBottom % 5 === 0;
    page.drawLine({
      start: { x: originX, y: topY - r * cellH },
      end: { x: originX + gridW, y: topY - r * cellH },
      thickness: heavy ? 0.9 : 0.3,
      color: heavy ? GRID_HEAVY : GRID_THIN,
    });
  }

  // --- row numbers, RS/WS, and reading arrows on both flanks ---
  const fs = m.fontSize;
  for (let r = 0; r < tile.rows; r++) {
    const gridRow = tile.row + r;
    const num = rowNumber(chart.rows, gridRow);
    const side = rowSide(chart.direction, num);
    const y = cellY(r) + (cellH - fs) / 2 + fs * 0.15;
    const arrowY = cellY(r) + cellH / 2;

    page.drawText(side, {
      x: originX - m.sideW,
      y,
      size: fs,
      font: fonts.regular,
      color: side === 'RS' ? RS_COLOR : WS_COLOR,
    });

    const label = String(num);
    const labelW = fonts.regular.widthOfTextAtSize(label, fs);
    if (rowNumberOnRight(chart.direction, num)) {
      page.drawText(label, {
        x: originX + gridW + 3,
        y,
        size: fs,
        font: fonts.regular,
        color: INK,
      });
      drawArrow(page, originX + gridW + 5 + labelW, arrowY, fs * 0.7, 'left');
    } else {
      page.drawText(label, {
        x: originX - m.sideW - 3 - labelW,
        y,
        size: fs,
        font: fonts.regular,
        color: INK,
      });
      drawArrow(page, originX - m.sideW - 5 - labelW - fs * 0.7, arrowY, fs * 0.7, 'right');
    }
  }

  // --- stitch numbers under the tile, thinned if the cells are narrow ---
  const step = stitchLabelStep(cellW, chart.stitches, m.charW);
  for (let c = 0; c < tile.cols; c++) {
    const num = stitchNumber(chart.stitches, tile.col + c);
    if (!showStitchLabel(num, step)) continue;
    const label = String(num);
    const w = fonts.regular.widthOfTextAtSize(label, fs);
    page.drawText(label, {
      x: cellX(c) + (cellW - w) / 2,
      y: topY - gridH - fs - 1,
      size: fs,
      font: fonts.regular,
      color: INK,
    });
  }
}

/** Dashed guide showing where the neighbouring page's stitches begin. */
function drawOverlapGuides(
  page: PDFPage,
  tile: TilePlan,
  layout: { tileCols: number; tileRows: number },
  m: Metrics,
  originX: number,
  topY: number,
  overlap: number
) {
  if (overlap <= 0) return;
  const gridH = tile.rows * m.cellH;
  const gridW = tile.cols * m.cellW;

  /**
   * The guide crosses stitches of every color, so a plain colored line
   * disappears over dark or red yarn. Lay a white casing down first and the
   * dashes read against anything.
   */
  const guide = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    page.drawLine({ start: from, end: to, thickness: 2.4, color: rgb(1, 1, 1) });
    page.drawLine({
      start: from,
      end: to,
      thickness: 1,
      color: rgb(0.8, 0.15, 0.15),
      dashArray: [3.5, 2.5],
    });
  };

  // A tile that isn't the last across shares its right-hand stitches.
  if (tile.tileCol < layout.tileCols - 1 && tile.cols > overlap) {
    const x = originX + (tile.cols - overlap) * m.cellW;
    guide({ x, y: topY }, { x, y: topY - gridH });
  }
  if (tile.tileRow < layout.tileRows - 1 && tile.rows > overlap) {
    const y = topY - (tile.rows - overlap) * m.cellH;
    guide({ x: originX, y }, { x: originX + gridW, y });
  }
}

/** Render the chart to a print-ready PDF. Returns the file bytes. */
export async function exportPdf(chart: Chart, options: Partial<PdfOptions> = {}): Promise<Uint8Array> {
  const opts = { ...DEFAULT_PDF_OPTIONS, ...options };
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const { width: pageW, height: pageH } = pageDimensions(opts.pageSize, opts.orientation);
  const footerH = footerHeight(chart, opts.includeLegend);
  const availW = pageW - MARGIN * 2;
  const availH = pageH - MARGIN * 2 - HEADER_H - footerH;
  const aspect = opts.squareCells ? 1 : cellAspect(chart.gauge);

  // Provisional metrics to size the gutters, which then constrain the cells.
  const probe = metricsFor(chart, 12, 12 * aspect);
  let cellW =
    opts.cellSizeMm === 'fit'
      ? fitCellSize({
          stitches: chart.stitches,
          rows: chart.rows,
          aspect,
          availW,
          availH,
          gutterLeft: probe.gutterLeft,
          gutterRight: probe.gutterRight,
          gutterBottom: probe.gutterBottom,
        })
      : mmToPoints(opts.cellSizeMm);
  if (!Number.isFinite(cellW) || cellW <= 0) cellW = mmToPoints(4);

  const m = metricsFor(chart, cellW, cellW * aspect);
  const layout = planTiles({
    stitches: chart.stitches,
    rows: chart.rows,
    cellW: m.cellW,
    cellH: m.cellH,
    availW,
    availH,
    gutterLeft: m.gutterLeft,
    gutterRight: m.gutterRight,
    gutterBottom: m.gutterBottom,
    overlap: opts.overlap,
  });

  if (layout.tiles.length === 0) {
    throw new Error(
      'Stitches are too large to fit the page. Choose a smaller stitch size, a bigger page, or landscape.'
    );
  }

  const counts = stitchCounts(chart);
  const multi = layout.tiles.length > 1;

  for (const tile of layout.tiles) {
    const page = doc.addPage([pageW, pageH]);
    const position = tilePositionLabel(layout, tile);
    const ranges = tileRangeLabel(chart.stitches, chart.rows, tile);
    drawHeader(page, fonts, chart, multi ? `${position} · ${ranges}` : ranges, pageW, pageH);
    drawLegend(page, fonts, chart, counts, pageW, opts.includeLegend);

    // Centre the tile's grid horizontally within the printable width.
    const tileW = tile.cols * m.cellW;
    const blockW = m.gutterLeft + tileW + m.gutterRight;
    const originX = MARGIN + m.gutterLeft + Math.max(0, (availW - blockW) / 2);
    const topY = pageH - MARGIN - HEADER_H;

    drawTile(page, fonts, chart, tile, m, originX, topY);
    drawOverlapGuides(page, tile, layout, m, originX, topY, opts.overlap);
  }

  if (multi && opts.overlap > 0) {
    // One line explaining the dashed guides, on the first page only.
    const first = doc.getPage(0);
    first.drawText(
      safeText(
        `Pages overlap by ${opts.overlap} ${opts.overlap === 1 ? 'stitch' : 'stitches'}; ` +
          'the dashed line marks where the next page begins.'
      ),
      {
        x: MARGIN,
        y: noteY(chart, opts.includeLegend),
        size: 7,
        font: fonts.regular,
        color: MUTED,
      }
    );
  }

  return doc.save();
}

/** Page count without building the document, for the export dialog's preview. */
export function estimatePages(chart: Chart, options: Partial<PdfOptions> = {}): number {
  const opts = { ...DEFAULT_PDF_OPTIONS, ...options };
  const { width: pageW, height: pageH } = pageDimensions(opts.pageSize, opts.orientation);
  const footerH = footerHeight(chart, opts.includeLegend);
  const availW = pageW - MARGIN * 2;
  const availH = pageH - MARGIN * 2 - HEADER_H - footerH;
  const aspect = opts.squareCells ? 1 : cellAspect(chart.gauge);
  const probe = metricsFor(chart, 12, 12 * aspect);
  const cellW =
    opts.cellSizeMm === 'fit'
      ? fitCellSize({
          stitches: chart.stitches,
          rows: chart.rows,
          aspect,
          availW,
          availH,
          gutterLeft: probe.gutterLeft,
          gutterRight: probe.gutterRight,
          gutterBottom: probe.gutterBottom,
        })
      : mmToPoints(opts.cellSizeMm);
  if (!Number.isFinite(cellW) || cellW <= 0) return 0;
  const m = metricsFor(chart, cellW, cellW * aspect);
  return planTiles({
    stitches: chart.stitches,
    rows: chart.rows,
    cellW: m.cellW,
    cellH: m.cellH,
    availW,
    availH,
    gutterLeft: m.gutterLeft,
    gutterRight: m.gutterRight,
    gutterBottom: m.gutterBottom,
    overlap: opts.overlap,
  }).tiles.length;
}
