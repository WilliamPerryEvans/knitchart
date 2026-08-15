/**
 * Splitting a chart across printed pages.
 *
 * A chart big enough to knit from rarely fits on one sheet, so it gets tiled.
 * Every tile carries its own row/stitch gutters, so each page stands alone, and
 * adjacent tiles share a few stitches of overlap so they can be lined up and
 * taped without a seam falling exactly between two stitches.
 *
 * All measurements are PDF points (72 per inch). Pure maths — no pdf-lib here.
 */

import { rowNumber, stitchNumber } from './labels';

export interface PageSize {
  width: number;
  height: number;
}

/** Portrait dimensions in points. */
export const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
  legal: { width: 612, height: 1008 },
} as const;

export type PageSizeId = keyof typeof PAGE_SIZES;
export type Orientation = 'portrait' | 'landscape';

export function pageDimensions(id: PageSizeId, orientation: Orientation): PageSize {
  const { width, height } = PAGE_SIZES[id];
  return orientation === 'landscape' ? { width: height, height: width } : { width, height };
}

export const MM_PER_INCH = 25.4;
export const POINTS_PER_INCH = 72;

export const mmToPoints = (mm: number) => (mm / MM_PER_INCH) * POINTS_PER_INCH;
export const pointsToMm = (pt: number) => (pt / POINTS_PER_INCH) * MM_PER_INCH;

export interface TilePlan {
  /** 0-based page index among the chart pages, in reading order. */
  index: number;
  tileCol: number;
  tileRow: number;
  /** First grid column/row covered, and how many. */
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export interface Layout {
  colsPerPage: number;
  rowsPerPage: number;
  tileCols: number;
  tileRows: number;
  tiles: TilePlan[];
}

export interface LayoutOpts {
  stitches: number;
  rows: number;
  /** Cell size in points. */
  cellW: number;
  cellH: number;
  /** Space available for gutters plus grid, i.e. page minus margins and header. */
  availW: number;
  availH: number;
  gutterLeft: number;
  gutterRight: number;
  gutterBottom: number;
  /** Stitches/rows repeated between neighbouring tiles. */
  overlap: number;
}

/**
 * Start indices for tiles along one axis. Tiles step by `perPage - overlap`;
 * the last one may be short, which is fine — a partial final page is normal.
 */
export function tileStarts(total: number, perPage: number, overlap: number): number[] {
  if (total <= 0 || perPage <= 0) return [];
  if (perPage >= total) return [0];
  // Overlap must leave forward progress, or we would tile forever.
  const step = Math.max(1, perPage - Math.max(0, Math.min(overlap, perPage - 1)));
  const starts: number[] = [];
  for (let start = 0; start < total; start += step) {
    starts.push(start);
    if (start + perPage >= total) break; // this tile reaches the end
  }
  return starts;
}

/** How many whole cells fit, given the space the repeated gutters take. */
export function cellsPerPage(avail: number, gutters: number, cell: number): number {
  if (cell <= 0) return 0;
  return Math.max(0, Math.floor((avail - gutters) / cell));
}

export function planTiles(opts: LayoutOpts): Layout {
  const colsPerPage = cellsPerPage(opts.availW, opts.gutterLeft + opts.gutterRight, opts.cellW);
  const rowsPerPage = cellsPerPage(opts.availH, opts.gutterBottom, opts.cellH);
  if (colsPerPage < 1 || rowsPerPage < 1) {
    return { colsPerPage, rowsPerPage, tileCols: 0, tileRows: 0, tiles: [] };
  }

  const colStarts = tileStarts(opts.stitches, colsPerPage, opts.overlap);
  const rowStarts = tileStarts(opts.rows, rowsPerPage, opts.overlap);
  const tiles: TilePlan[] = [];
  let index = 0;
  // Reading order: across the top row of pages first, then down.
  rowStarts.forEach((row, tileRow) => {
    colStarts.forEach((col, tileCol) => {
      tiles.push({
        index: index++,
        tileCol,
        tileRow,
        col,
        row,
        cols: Math.min(colsPerPage, opts.stitches - col),
        rows: Math.min(rowsPerPage, opts.rows - row),
      });
    });
  });
  return {
    colsPerPage,
    rowsPerPage,
    tileCols: colStarts.length,
    tileRows: rowStarts.length,
    tiles,
  };
}

/**
 * Largest cell size that fits the whole chart on one page, preserving the
 * gauge aspect ratio (cellH / cellW).
 */
export function fitCellSize(opts: {
  stitches: number;
  rows: number;
  aspect: number;
  availW: number;
  availH: number;
  gutterLeft: number;
  gutterRight: number;
  gutterBottom: number;
}): number {
  const usableW = opts.availW - opts.gutterLeft - opts.gutterRight;
  const usableH = opts.availH - opts.gutterBottom;
  if (usableW <= 0 || usableH <= 0) return 0;
  const byWidth = usableW / opts.stitches;
  const byHeight = usableH / (opts.rows * opts.aspect);
  return Math.max(0, Math.min(byWidth, byHeight));
}

/**
 * Which stitches a tile covers, in knitting numbers (counted from the right,
 * so the range reads high-to-low across the page).
 */
export function tileStitchRange(stitches: number, tile: TilePlan): { from: number; to: number } {
  return {
    from: stitchNumber(stitches, tile.col),
    to: stitchNumber(stitches, tile.col + tile.cols - 1),
  };
}

/** Which rows a tile covers, in knitting numbers (counted from the bottom). */
export function tileRowRange(rows: number, tile: TilePlan): { from: number; to: number } {
  return {
    from: rowNumber(rows, tile.row),
    to: rowNumber(rows, tile.row + tile.rows - 1),
  };
}

/** Human-readable "sts 40–21, rows 60–41" for a tile's header. */
export function tileRangeLabel(stitches: number, rows: number, tile: TilePlan): string {
  const s = tileStitchRange(stitches, tile);
  const r = tileRowRange(rows, tile);
  const sts = s.from === s.to ? `st ${s.from}` : `sts ${s.from}–${s.to}`;
  const rws = r.from === r.to ? `row ${r.from}` : `rows ${r.from}–${r.to}`;
  return `${sts}, ${rws}`;
}

/** "Page 3 of 6" plus grid position when the chart spans more than one column/row. */
export function tilePositionLabel(layout: Layout, tile: TilePlan): string {
  const total = layout.tiles.length;
  const base = `Page ${tile.index + 1} of ${total}`;
  if (total <= 1) return base;
  const across = layout.tileCols > 1 ? ` · column ${tile.tileCol + 1} of ${layout.tileCols}` : '';
  const down = layout.tileRows > 1 ? ` · band ${tile.tileRow + 1} of ${layout.tileRows}` : '';
  return base + across + down;
}
