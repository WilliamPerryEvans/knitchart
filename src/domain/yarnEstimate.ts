/**
 * Estimating how much of each yarn a chart will eat.
 *
 * Two things consume yarn in stranded colorwork: the stitches you knit, and the
 * floats carried behind the work while the other colour is showing. The chart
 * knows both, so both are counted — floats are why a background colour can use
 * far more yarn than its stitch count suggests.
 *
 * This is an estimate. Yarn per stitch varies with fibre, needle size, and
 * tension, so the figures are a planning aid, not a shopping guarantee.
 */

import type { Chart } from '../model/types';

export interface YarnEstimateOptions {
  /**
   * Yarn consumed by one stitch, as a multiple of stitch width. ~3 is the usual
   * rule of thumb for stockinette; looser fabric and thicker yarn run higher.
   */
  yarnPerStitchFactor?: number;
  /** Safety margin added on top, as a percentage. */
  marginPercent?: number;
}

export const DEFAULT_YARN_OPTIONS = {
  yarnPerStitchFactor: 3,
  marginPercent: 15,
} satisfies Required<YarnEstimateOptions>;

export interface ColorUsage {
  index: number;
  name: string;
  hex: string;
  /** Stitches actually worked in this colour. */
  knitStitches: number;
  /** Stitches' worth of yarn carried behind the work as floats. */
  carriedStitches: number;
  /** Estimated length including the safety margin. */
  yards: number;
  metres: number;
}

/** Stitches worked in each palette colour. */
export function stitchCounts(chart: Chart): number[] {
  const counts = new Array(chart.palette.length).fill(0);
  for (const v of chart.grid) if (v < counts.length) counts[v]++;
  return counts;
}

/**
 * Stitches' worth of float carried behind the work, per colour.
 *
 * Worked flat, a colour is carried only between its first and last use in a
 * row — before and after that it isn't in play. Worked in the round the yarn
 * travels the whole way around, so every stitch it doesn't work is carried.
 * A colour absent from a row is not carried at all.
 */
export function carriedCounts(chart: Chart): number[] {
  const carried = new Array(chart.palette.length).fill(0);
  const round = chart.direction === 'round';

  for (let r = 0; r < chart.rows; r++) {
    const row = chart.grid.subarray(r * chart.stitches, (r + 1) * chart.stitches);
    const first = new Map<number, number>();
    const last = new Map<number, number>();
    const used = new Map<number, number>();
    for (let c = 0; c < row.length; c++) {
      const color = row[c];
      if (!first.has(color)) first.set(color, c);
      last.set(color, c);
      used.set(color, (used.get(color) ?? 0) + 1);
    }
    // A single-colour row strands nothing: there is no second yarn in play.
    if (used.size < 2) continue;

    for (const [color, count] of used) {
      if (color >= carried.length) continue;
      const span = round ? chart.stitches : last.get(color)! - first.get(color)! + 1;
      carried[color] += span - count;
    }
  }
  return carried;
}

/** Width of one stitch, in inches. */
export function stitchWidthInches(chart: Chart): number {
  const block = chart.gauge.unit === 'in' ? 4 : 10 / 2.54;
  return block / chart.gauge.stsPer4in;
}

export function estimateYarn(chart: Chart, options: YarnEstimateOptions = {}): ColorUsage[] {
  const { yarnPerStitchFactor, marginPercent } = { ...DEFAULT_YARN_OPTIONS, ...options };
  const knit = stitchCounts(chart);
  const carried = carriedCounts(chart);
  const width = stitchWidthInches(chart);

  return chart.palette.map((color, index) => {
    // A float lies flat behind the work, so it costs roughly its own width;
    // a knitted stitch loops through the fabric and costs several times that.
    const inches =
      (knit[index] ?? 0) * width * yarnPerStitchFactor + (carried[index] ?? 0) * width;
    const withMargin = inches * (1 + marginPercent / 100);
    return {
      index,
      name: color.name?.trim() || `Color ${index}`,
      hex: color.hex,
      knitStitches: knit[index] ?? 0,
      carriedStitches: carried[index] ?? 0,
      yards: withMargin / 36,
      metres: (withMargin * 2.54) / 100,
    };
  });
}

/** Rounded up to something you could actually buy, and never a bare "0 yd". */
export function formatLength(usage: ColorUsage, unit: 'yd' | 'm'): string {
  const value = unit === 'yd' ? usage.yards : usage.metres;
  if (usage.knitStitches === 0) return '—';
  if (value < 1) return `<1 ${unit}`;
  return `${Math.ceil(value)} ${unit}`;
}
