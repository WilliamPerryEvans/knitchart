import type { Chart, FloatWarning } from '../model/types';

/**
 * Scan one row for runs of a single color longer than `threshold`.
 * For in-the-round charts the scan wraps across the row boundary, so a run
 * ending at the last stitch and continuing at the first is counted once,
 * as a single wrapped run.
 */
export function checkRowFloats(
  row: ArrayLike<number>,
  threshold: number,
  round: boolean
): Omit<FloatWarning, 'row'>[] {
  const n = row.length;
  if (n === 0) return [];
  const warnings: Omit<FloatWarning, 'row'>[] = [];

  // A single-color row is knit without stranding — no floats exist.
  const first = row[0];
  let allSame = true;
  for (let i = 1; i < n; i++) {
    if (row[i] !== first) {
      allSame = false;
      break;
    }
  }
  if (allSame) return [];

  if (!round) {
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || row[i] !== row[start]) {
        if (i - start > threshold) {
          warnings.push({ start, len: i - start, color: row[start], wraps: false });
        }
        start = i;
      }
    }
    return warnings;
  }

  // Find the first color boundary, then scan n stitches starting there so
  // every run (including the one wrapping the boundary) is seen exactly once.
  let anchor = 0;
  for (let i = 1; i < n; i++) {
    if (row[i] !== row[i - 1]) {
      anchor = i;
      break;
    }
  }
  let start = anchor;
  for (let i = anchor + 1; i <= anchor + n; i++) {
    const cur = row[i % n];
    const prev = row[start % n];
    if (i === anchor + n || cur !== prev) {
      const len = i - start;
      if (len > threshold) {
        warnings.push({
          start: start % n,
          len,
          color: prev,
          wraps: start % n + len > n,
        });
      }
      start = i;
    }
  }
  // The wrapped scan visits runs starting from `anchor`, so a run covering
  // column 0 is found last. Sort so callers always get left-to-right order and
  // a full rescan agrees with an incremental one.
  warnings.sort((a, b) => a.start - b.start);
  return warnings;
}

/** Scan the whole chart. Rows are grid rows (0 = top). */
export function checkChartFloats(chart: Chart): FloatWarning[] {
  const { grid, stitches, rows, floatThreshold, direction } = chart;
  const round = direction === 'round';
  const out: FloatWarning[] = [];
  for (let r = 0; r < rows; r++) {
    const rowArr = grid.subarray(r * stitches, (r + 1) * stitches);
    for (const w of checkRowFloats(rowArr, floatThreshold, round)) {
      out.push({ row: r, ...w });
    }
  }
  return out;
}

/**
 * Refresh warnings for just the rows that changed, reusing the rest.
 * An edit touches a handful of rows, so this avoids rescanning the whole
 * chart on every stroke. Result stays ordered by row, then by start.
 */
export function updateChartFloats(
  chart: Chart,
  previous: FloatWarning[],
  changedRows: Iterable<number>
): FloatWarning[] {
  const { grid, stitches, floatThreshold, direction } = chart;
  const round = direction === 'round';
  const dirty = new Set(changedRows);
  if (dirty.size === 0) return previous;

  const out = previous.filter((w) => !dirty.has(w.row));
  for (const r of dirty) {
    if (r < 0 || r >= chart.rows) continue;
    const rowArr = grid.subarray(r * stitches, (r + 1) * stitches);
    for (const w of checkRowFloats(rowArr, floatThreshold, round)) {
      out.push({ row: r, ...w });
    }
  }
  out.sort((a, b) => a.row - b.row || a.start - b.start);
  return out;
}

export interface WarningSegment {
  row: number;
  start: number;
  len: number;
}

/**
 * Contiguous horizontal spans covering the warnings, splitting any run that
 * wraps the round boundary into two spans. Drawing a span per run keeps the
 * overlay at a few dozen fills instead of one per stitch.
 */
export function warningSegments(warnings: FloatWarning[], stitches: number): WarningSegment[] {
  const out: WarningSegment[] = [];
  for (const w of warnings) {
    const end = w.start + w.len;
    if (end <= stitches) {
      out.push({ row: w.row, start: w.start, len: w.len });
    } else {
      out.push({ row: w.row, start: w.start, len: stitches - w.start });
      out.push({ row: w.row, start: 0, len: end - stitches });
    }
  }
  return out;
}
