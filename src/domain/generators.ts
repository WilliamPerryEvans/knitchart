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

export type GeneratorKind =
  | 'sierpinski'
  | 'equilateral'
  | 'rule'
  | 'carpet'
  | 'stripes'
  | 'checks';

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

  // Sierpinski carpet, and levels of detail for the equilateral triangle
  depth: number;

  /**
   * Cell height divided by cell width in the finished fabric — `cellAspect` of
   * the chart's gauge. Only the equilateral triangle uses it, and only so the
   * shape is a true triangle off the needles rather than on the chart squares.
   */
  aspect: number;

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
  aspect: 1,
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

// --- equilateral Sierpinski triangle --------------------------------------

/** Half the height of an equilateral triangle relative to its base. */
const EQUILATERAL_RATIO = Math.sqrt(3) / 2;

/**
 * Is a point inside the Sierpinski gasket, given its barycentric coordinates in
 * the outer triangle? At each level the point either sits in one of the three
 * corner sub-triangles — identified by that coordinate reaching a half — and we
 * rescale into it, or it sits in the central inverted triangle, which is a hole.
 */
export function inGasket(u: number, v: number, w: number, depth: number): boolean {
  if (u < 0 || v < 0 || w < 0) return false; // outside the triangle entirely
  let a = u;
  let b = v;
  let c = w;
  for (let k = 0; k < depth; k++) {
    if (a >= 0.5) {
      a = 2 * a - 1;
      b *= 2;
      c *= 2;
    } else if (b >= 0.5) {
      b = 2 * b - 1;
      a *= 2;
      c *= 2;
    } else if (c >= 0.5) {
      c = 2 * c - 1;
      a *= 2;
      b *= 2;
    } else {
      return false;
    }
  }
  return true;
}

/** Points sampled across each stitch, per axis, when measuring coverage. */
const COVERAGE_SAMPLES = 4;

/**
 * Fill a stitch once the shape covers this much of it. Under a half on purpose:
 * the sub-triangles taper to points, and a stricter threshold eats the tips.
 */
const COVERAGE_THRESHOLD = 0.3;

type Point = [number, number];

/**
 * The apex of every solid sub-triangle, found by the same subdivision that
 * builds the gasket.
 *
 * Coverage alone cannot guarantee these survive: two sub-triangles meet at a
 * single point, and when that point lands on a stitch boundary its coverage
 * splits between the two neighbouring stitches so neither passes the threshold
 * — which severs the motif. Marking the stitch each apex falls in settles the
 * tie the same way every time.
 */
function gasketApexes(a: Point, b: Point, c: Point, depth: number, out: Point[]): void {
  if (depth <= 0) {
    out.push(a);
    return;
  }
  const mid = (p: Point, q: Point): Point => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const ab = mid(a, b);
  const ac = mid(a, c);
  const bc = mid(b, c);
  gasketApexes(a, ab, ac, depth - 1, out);
  gasketApexes(ab, b, bc, depth - 1, out);
  gasketApexes(ac, bc, c, depth - 1, out);
}

/**
 * A Sierpinski triangle that is actually equilateral **in the finished fabric**.
 *
 * The rule-90 version grows one column per side per row, which on a worsted
 * gauge knits up as a wide, flat wedge — right maths, wrong shape for a garment
 * panel. Here the triangle is drawn geometrically instead: work in units of one
 * cell width, so a cell is 1 wide and `aspect` tall, and fit the largest
 * equilateral triangle inside the chart's real proportions.
 *
 * Stitches are filled by **how much of them the shape covers**, not by whether
 * their centre happens to land inside it. Testing the centre alone breaks the
 * motif apart: a gasket pinches to a single point everywhere two sub-triangles
 * meet, no cell centre lands in a point, and the chart comes out as disconnected
 * fragments with entirely blank rows across the join.
 */
/**
 * The largest equilateral triangle that fits the chart, in units of one cell
 * width — so a cell is `1` wide and `aspect` tall, and the shape comes out
 * equilateral in the fabric rather than on the chart squares.
 */
function fitEquilateral(width: number, height: number, aspect: number) {
  const asp = aspect > 0 ? aspect : 1;
  const chartW = width;
  const chartH = height * asp;
  const base = Math.min(chartW, chartH / EQUILATERAL_RATIO);
  const triH = base * EQUILATERAL_RATIO;
  return { asp, base, triH, x0: (chartW - base) / 2, y0: (chartH - triH) / 2 };
}

/**
 * Size of the smallest solid triangle a given depth produces, in whole stitches
 * and rows. Each level halves it, so depth runs out of chart quickly: the
 * dialog uses this to say when a setting is finer than the knitting can show.
 */
export function smallestTriangle(
  width: number,
  height: number,
  depth: number,
  aspect: number
): { stitches: number; rows: number } {
  const { asp, base, triH } = fitEquilateral(width, height, aspect);
  const divisor = 2 ** Math.max(1, depth);
  return {
    stitches: Math.round(base / divisor),
    rows: Math.round(triH / divisor / asp),
  };
}

export function generateEquilateral(
  width: number,
  height: number,
  depth: number,
  aspect: number
): Uint8Array {
  const out = new Uint8Array(width * height);
  const levels = Math.max(1, depth);
  const { asp, base, triH, x0, y0 } = fitEquilateral(width, height, aspect);

  // Apex top-centre, base along the bottom.
  const ax = x0 + base / 2;
  const ay = y0;
  const bx = x0;
  const by = y0 + triH;
  const cx = x0 + base;
  const cy = y0 + triH;
  const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (den === 0) return out;

  const inside = (px: number, py: number) => {
    const u = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den;
    const v = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
    return inGasket(u, v, 1 - u - v, levels);
  };

  const n = COVERAGE_SAMPLES;
  const needed = n * n * COVERAGE_THRESHOLD;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let hits = 0;
      for (let sy = 0; sy < n; sy++) {
        const py = (r + (sy + 0.5) / n) * asp;
        for (let sx = 0; sx < n; sx++) {
          if (inside(c + (sx + 0.5) / n, py)) hits++;
        }
      }
      out[r * width + c] = hits >= needed ? 1 : 0;
    }
  }

  // Then make sure every sub-triangle's tip is on the chart, so the motif is
  // one connected piece rather than islands that cannot be knitted as drawn.
  const apexes: Point[] = [];
  gasketApexes([ax, ay], [bx, by], [cx, cy], levels, apexes);
  for (const [px, py] of apexes) {
    const c = Math.min(width - 1, Math.max(0, Math.floor(px)));
    const r = Math.min(height - 1, Math.max(0, Math.floor(py / asp)));
    out[r * width + c] = 1;
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
    case 'equilateral':
      return generateEquilateral(width, height, o.depth, o.aspect);
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

  // Scaling changes the shape of a pattern cell, so the equilateral triangle
  // has to be told the pattern grid's aspect rather than the chart's.
  const effective = o.kind === 'equilateral' ? { ...o, aspect: (o.aspect * sy) / sx } : o;
  let cells = generateBinary(cw, ch, effective);
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
    case 'equilateral':
      return 'Equilateral Sierpinski triangle';
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
