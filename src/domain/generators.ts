/**
 * Pattern generators: fractals and simple repeats.
 *
 * Everything here is pure. A generator produces a binary grid at its own
 * resolution, which is then blown up by the stitch/row scale and mapped onto
 * palette indices, so the same code serves the preview, the chart, and tests.
 *
 * Grid convention matches the rest of the app: `grid[row * width + col]`, row 0
 * being the TOP of the chart. Cellular automata therefore evolve downward by
 * default — generation 0 sits at the top, so a Sierpinski triangle points up.
 */

import type { Gauge, PaletteColor } from '../model/types';

export type GeneratorKind = 'sierpinski' | 'rule' | 'carpet' | 'stripes' | 'checks';

/** Where the automaton's first generation sits. */
export type Origin = 'top' | 'bottom';

export type SeedKind = 'center' | 'left' | 'right' | 'alternate' | 'random' | 'row';

export type StripeAxis = 'horizontal' | 'vertical';

/**
 * One flat options bag rather than a discriminated union: the dialog keeps every
 * control's value alive while you switch between generators, so flipping from
 * stripes to Rule 30 and back doesn't lose your settings.
 */
export interface GeneratorOptions {
  kind: GeneratorKind;
  /** Palette index for "off" stitches. */
  bg: number;
  /** Palette index for "on" stitches. */
  fg: number;
  /** Stitches per pattern cell. */
  scaleX: number;
  /** Rows per pattern cell. */
  scaleY: number;
  origin: Origin;

  // cellular automata
  rule: number;
  seed: SeedKind;
  /** 0/1 per pattern column, used when `seed` is 'row'. */
  seedRow?: Uint8Array;
  /** Treat the row as a cylinder. The right answer for knitting in the round. */
  wrap: boolean;
  /**
   * Sow the seed again if a generation comes out empty, so the motif repeats up
   * the chart rather than leaving bare fabric.
   */
  restart: boolean;
  /** Deterministic source for the random seed, so tests can pin it down. */
  random?: () => number;

  // Sierpinski carpet
  depth: number;

  // stripes
  runA: number;
  runB: number;
  axis: StripeAxis;

  // checks
  blockW: number;
  blockH: number;
}

export const DEFAULT_GENERATOR: GeneratorOptions = {
  kind: 'sierpinski',
  bg: 0,
  fg: 1,
  scaleX: 1,
  scaleY: 1,
  origin: 'top',
  rule: 90,
  seed: 'center',
  wrap: false,
  restart: true,
  depth: 3,
  runA: 4,
  runB: 4,
  axis: 'horizontal',
  blockW: 4,
  blockH: 4,
};

/**
 * Elementary cellular automaton rules worth offering by name. Rule 90 is the
 * Sierpinski triangle; the rest are here because they knit well.
 */
export const RULE_PRESETS: Array<{ rule: number; label: string; note: string }> = [
  { rule: 90, label: 'Rule 90', note: 'Sierpinski triangle — the classic' },
  { rule: 150, label: 'Rule 150', note: 'Denser triangle, filled in' },
  { rule: 18, label: 'Rule 18', note: 'Sparse, lacy Sierpinski' },
  { rule: 60, label: 'Rule 60', note: 'Half a triangle — leans right' },
  { rule: 22, label: 'Rule 22', note: 'Branching, irregular' },
  { rule: 30, label: 'Rule 30', note: 'Chaotic — no two rows alike' },
  { rule: 110, label: 'Rule 110', note: 'Drifting diagonal threads' },
  { rule: 126, label: 'Rule 126', note: 'Solid triangle with holes' },
];

// --- cellular automata ----------------------------------------------------

/**
 * Decode a rule number into its 8 outputs, indexed by the neighbourhood read as
 * a 3-bit number (left << 2 | centre << 1 | right).
 */
export function ruleTable(rule: number): Uint8Array {
  const table = new Uint8Array(8);
  for (let n = 0; n < 8; n++) table[n] = (rule >> n) & 1;
  return table;
}

/** One generation of an elementary CA. */
export function stepRule(cells: Uint8Array, table: Uint8Array, wrap: boolean): Uint8Array {
  const w = cells.length;
  const out = new Uint8Array(w);
  for (let i = 0; i < w; i++) {
    // Off the ends: wrap around the cylinder, or treat as empty stitches.
    const left = i > 0 ? cells[i - 1] : wrap ? cells[w - 1] : 0;
    const right = i < w - 1 ? cells[i + 1] : wrap ? cells[0] : 0;
    out[i] = table[(left << 2) | (cells[i] << 1) | right];
  }
  return out;
}

/** The automaton's first generation. */
export function seedCells(width: number, o: GeneratorOptions): Uint8Array {
  const cells = new Uint8Array(width);
  switch (o.seed) {
    case 'left':
      cells[0] = 1;
      break;
    case 'right':
      cells[width - 1] = 1;
      break;
    case 'alternate':
      for (let i = 0; i < width; i += 2) cells[i] = 1;
      break;
    case 'random': {
      const rng = o.random ?? Math.random;
      for (let i = 0; i < width; i++) cells[i] = rng() < 0.5 ? 1 : 0;
      break;
    }
    case 'row':
      if (o.seedRow) {
        for (let i = 0; i < width; i++) cells[i] = o.seedRow[i] ? 1 : 0;
      }
      break;
    case 'center':
    default:
      cells[width >> 1] = 1;
      break;
  }
  return cells;
}

/** Run the automaton for `height` generations, one per row. */
export function generateRule(width: number, height: number, o: GeneratorOptions): Uint8Array {
  const out = new Uint8Array(width * height);
  let row = seedCells(width, o);
  const table = ruleTable(o.rule);
  for (let r = 0; r < height; r++) {
    out.set(row, r * width);
    row = stepRule(row, table, o.wrap);
    // Plenty of rules burn out and leave the rest of the chart bare — rule 90
    // does it whenever the width is one less than a power of two, which is easy
    // to hit by accident. Re-seeding repeats the motif instead of wasting yards
    // of plain fabric.
    if (o.restart && !row.some((v) => v !== 0)) row = seedCells(width, o);
  }
  return out;
}

// --- Sierpinski carpet ----------------------------------------------------

/**
 * Is (x, y) part of the carpet, checking `depth` levels? A cell is a hole when
 * any level puts it in the middle square of its 3x3 block — that is exactly the
 * base-3 test: some digit position has both coordinates equal to 1.
 */
export function carpetCell(x: number, y: number, depth: number): boolean {
  let px = x;
  let py = y;
  for (let k = 0; k < depth; k++) {
    if (px % 3 === 1 && py % 3 === 1) return false;
    px = Math.floor(px / 3);
    py = Math.floor(py / 3);
  }
  return true;
}

/**
 * Offset that centres a whole number of `side`-wide tiles on a `span`-wide
 * chart. One tile centres the motif; several tile it, trimming both edges by
 * the same amount so the repeat stays symmetric instead of running off one side.
 */
function tileOffset(span: number, side: number): number {
  return Math.floor((Math.ceil(span / side) * side - span) / 2);
}

export function generateCarpet(width: number, height: number, depth: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const levels = Math.max(1, depth);
  const side = 3 ** levels;
  const ox = tileOffset(width, side);
  const oy = tileOffset(height, side);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      out[r * width + c] = carpetCell((c + ox) % side, (r + oy) % side, levels) ? 1 : 0;
    }
  }
  return out;
}

// --- simple repeats -------------------------------------------------------

export function generateStripes(
  width: number,
  height: number,
  runA: number,
  runB: number,
  axis: StripeAxis
): Uint8Array {
  const a = Math.max(1, runA);
  const b = Math.max(1, runB);
  const period = a + b;
  const out = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const n = axis === 'horizontal' ? r : c;
      out[r * width + c] = n % period < a ? 0 : 1;
    }
  }
  return out;
}

export function generateChecks(
  width: number,
  height: number,
  blockW: number,
  blockH: number
): Uint8Array {
  const bw = Math.max(1, blockW);
  const bh = Math.max(1, blockH);
  const out = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const on = (Math.floor(r / bh) + Math.floor(c / bw)) % 2 === 1;
      out[r * width + c] = on ? 1 : 0;
    }
  }
  return out;
}

// --- shaping --------------------------------------------------------------

/** Nearest-neighbour blow-up: each pattern cell becomes sx by sy stitches. */
export function scaleGrid(
  cells: Uint8Array,
  width: number,
  height: number,
  sx: number,
  sy: number
): Uint8Array {
  if (sx === 1 && sy === 1) return cells;
  const w = width * sx;
  const h = height * sy;
  const out = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    const src = Math.floor(r / sy) * width;
    for (let c = 0; c < w; c++) {
      out[r * w + c] = cells[src + Math.floor(c / sx)];
    }
  }
  return out;
}

/** Take a `w` by `h` window out of a larger grid, offset by (ox, oy). */
export function cropGrid(
  cells: Uint8Array,
  width: number,
  ox: number,
  oy: number,
  w: number,
  h: number
): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      out[r * w + c] = cells[(r + oy) * width + (c + ox)];
    }
  }
  return out;
}

export function flipVertical(cells: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(cells.length);
  for (let r = 0; r < height; r++) {
    out.set(cells.subarray((height - 1 - r) * width, (height - r) * width), r * width);
  }
  return out;
}

/**
 * Rows per pattern cell that make the motif come out square in the finished
 * fabric. Stitches are usually wider than they are tall, so a Sierpinski
 * triangle charted one-cell-per-stitch knits up squashed; worsted at
 * 20 sts x 26 rows needs about 1.3 rows per stitch to look right.
 */
export function gaugeRowScale(gauge: Gauge, scaleX: number): number {
  if (gauge.stsPer4in <= 0 || gauge.rowsPer4in <= 0) return scaleX;
  return Math.max(1, Math.round((scaleX * gauge.rowsPer4in) / gauge.stsPer4in));
}

// --- the pipeline ---------------------------------------------------------

/** Binary pattern at pattern-cell resolution, before scaling or colouring. */
export function generateBinary(
  width: number,
  height: number,
  o: GeneratorOptions
): Uint8Array {
  switch (o.kind) {
    case 'stripes':
      return generateStripes(width, height, o.runA, o.runB, o.axis);
    case 'checks':
      return generateChecks(width, height, o.blockW, o.blockH);
    case 'carpet':
      return generateCarpet(width, height, o.depth);
    case 'sierpinski':
      // The Sierpinski triangle IS rule 90 from a single stitch with plain
      // edges. Knitters look for it by name, so it gets its own entry.
      return generateRule(width, height, { ...o, rule: 90, seed: 'center', wrap: false });
    case 'rule':
    default:
      return generateRule(width, height, o);
  }
}

/**
 * Generate a `stitches` by `rows` block of palette indices, ready to blit onto
 * the chart. Scaling that doesn't divide evenly is centred rather than left
 * aligned, so a triangle stays on the middle stitch.
 */
export function generatePattern(
  stitches: number,
  rows: number,
  options: Partial<GeneratorOptions> = {}
): Uint8Array {
  const o = { ...DEFAULT_GENERATOR, ...options };
  const sx = Math.max(1, Math.floor(o.scaleX));
  const sy = Math.max(1, Math.floor(o.scaleY));
  const cw = Math.ceil(stitches / sx);
  const ch = Math.ceil(rows / sy);

  let cells = generateBinary(cw, ch, o);
  cells = scaleGrid(cells, cw, ch, sx, sy);

  const fullW = cw * sx;
  const fullH = ch * sy;
  if (fullW !== stitches || fullH !== rows) {
    cells = cropGrid(
      cells,
      fullW,
      Math.floor((fullW - stitches) / 2),
      Math.floor((fullH - rows) / 2),
      stitches,
      rows
    );
  }
  if (o.origin === 'bottom') cells = flipVertical(cells, stitches, rows);

  const out = new Uint8Array(stitches * rows);
  for (let i = 0; i < out.length; i++) out[i] = cells[i] ? o.fg : o.bg;
  return out;
}

/**
 * Read a row of the chart as an automaton seed: any stitch that isn't the
 * background colour counts as "on". Sampled every `scaleX` stitches so it lines
 * up with the pattern grid.
 */
export function seedRowFromChart(
  grid: Uint8Array,
  stitches: number,
  gridRow: number,
  bg: number,
  scaleX: number
): Uint8Array {
  const sx = Math.max(1, Math.floor(scaleX));
  const width = Math.ceil(stitches / sx);
  const out = new Uint8Array(width);
  for (let i = 0; i < width; i++) {
    out[i] = grid[gridRow * stitches + Math.min(stitches - 1, i * sx)] !== bg ? 1 : 0;
  }
  return out;
}

/** Undo-stack label, and the heading shown in the dialog. */
export function generatorLabel(o: GeneratorOptions): string {
  switch (o.kind) {
    case 'sierpinski':
      return 'Sierpinski triangle';
    case 'carpet':
      return 'Sierpinski carpet';
    case 'stripes':
      return o.axis === 'horizontal' ? 'Stripes' : 'Vertical stripes';
    case 'checks':
      return 'Checks';
    case 'rule':
    default:
      return `Rule ${o.rule}`;
  }
}

/** Plain-language summary of what the current settings will produce. */
export function generatorSummary(
  o: GeneratorOptions,
  palette: PaletteColor[],
  stitches: number,
  rows: number
): string {
  const name = (i: number) => palette[i]?.name || palette[i]?.hex || `color ${i}`;
  const cell =
    o.scaleX === 1 && o.scaleY === 1
      ? 'one stitch per pattern cell'
      : `${o.scaleX} ${o.scaleX === 1 ? 'stitch' : 'stitches'} by ${o.scaleY} ${
          o.scaleY === 1 ? 'row' : 'rows'
        } per pattern cell`;
  return `${generatorLabel(o)} in ${name(o.fg)} on ${name(o.bg)}, ${cell}, over ${stitches} × ${rows}.`;
}
