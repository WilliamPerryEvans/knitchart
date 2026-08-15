import type { Gauge } from './types';

/**
 * Cell aspect ratio (height / width) for a gauge.
 * Stitch width  = 4in / stsPer4in; stitch height = 4in / rowsPer4in.
 * More rows per 4" than stitches per 4" means each stitch is SHORTER than wide,
 * so aspect = stsPer4in / rowsPer4in (< 1 for typical knitting).
 * Worsted 20 sts x 26 rows -> 20/26 ~ 0.77 (cells ~4:5, wider than tall).
 */
export function cellAspect(gauge: Gauge): number {
  if (gauge.stsPer4in <= 0 || gauge.rowsPer4in <= 0) {
    throw new Error('Gauge values must be positive');
  }
  return gauge.stsPer4in / gauge.rowsPer4in;
}

/** Cell size in px for a base cell width, honoring gauge unless squareMode. */
export function cellSize(
  gauge: Gauge,
  baseCellWidth: number,
  squareMode: boolean
): { w: number; h: number } {
  const w = baseCellWidth;
  const h = squareMode ? baseCellWidth : baseCellWidth * cellAspect(gauge);
  return { w, h };
}

/** Finished dimensions of the chart in gauge units (inches or cm-equivalent of 4in blocks x 10cm). */
export function finishedSize(
  gauge: Gauge,
  stitches: number,
  rows: number
): { width: number; height: number; unit: 'in' | 'cm' } {
  // Gauge is per 4 inches or per 10 cm depending on unit; both scale linearly.
  const block = gauge.unit === 'in' ? 4 : 10;
  return {
    width: (stitches / gauge.stsPer4in) * block,
    height: (rows / gauge.rowsPer4in) * block,
    unit: gauge.unit,
  };
}
