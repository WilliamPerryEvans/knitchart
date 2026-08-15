// Core data model for .knitchart files and the in-memory chart.
// Keep this roomy: symbolLayer and repeats are unused by the editor today
// but are part of the file format so future features don't break old files.

export interface PaletteColor {
  id: number;
  hex: string;
  name?: string; // "MC", "CC1"
  yarn?: { brand?: string; colorway?: string; fiber?: string };
  symbol?: string; // colorblind overlay symbol id (future)
}

export interface Gauge {
  stsPer4in: number;
  rowsPer4in: number;
  unit: 'in' | 'cm';
}

export type Direction = 'flat' | 'round';

/** RLE row: array of [paletteIndex, runLength] pairs. */
export type RleRow = Array<[number, number]>;

export interface KnitChartFile {
  version: 1;
  meta: {
    title: string;
    author?: string;
    created: string;
    modified: string;
    notes?: string;
  };
  dimensions: { stitches: number; rows: number };
  gauge: Gauge;
  direction: Direction;
  palette: PaletteColor[];
  /** Row-major, one RLE row per chart row. Row 0 is the TOP row as stored. */
  cells: RleRow[];
  symbolLayer?: Array<Array<string | null>>; // future: stitch symbols
  repeats?: Array<{ x: number; y: number; w: number; h: number; label?: string }>; // future
  floatThreshold?: number; // default 5
}

/** In-memory chart: flat Uint8Array grid for fast editing/rendering. */
export interface Chart {
  title: string;
  author?: string;
  created: string;
  notes?: string;
  stitches: number;
  rows: number;
  gauge: Gauge;
  direction: Direction;
  palette: PaletteColor[];
  /** grid[row * stitches + col] = palette index. Row 0 = top of chart. */
  grid: Uint8Array;
  floatThreshold: number;
}

export interface FloatWarning {
  row: number; // grid row index (0 = top)
  start: number; // starting column of the run
  len: number; // run length in stitches
  color: number; // palette index
  wraps: boolean; // run crosses the round boundary
}

export const DEFAULT_PALETTE: PaletteColor[] = [
  { id: 0, hex: '#f4efe8', name: 'MC' },
  { id: 1, hex: '#31435f', name: 'CC1' },
];

export function createChart(opts: {
  title: string;
  stitches: number;
  rows: number;
  gauge: Gauge;
  direction: Direction;
  palette?: PaletteColor[];
  floatThreshold?: number;
}): Chart {
  return {
    title: opts.title,
    created: new Date().toISOString(),
    stitches: opts.stitches,
    rows: opts.rows,
    gauge: opts.gauge,
    direction: opts.direction,
    palette: opts.palette ?? DEFAULT_PALETTE.map((c) => ({ ...c })),
    grid: new Uint8Array(opts.stitches * opts.rows),
    floatThreshold: opts.floatThreshold ?? 5,
  };
}
