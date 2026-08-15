import { describe, expect, it } from 'vitest';
import {
  checkChartFloats,
  checkRowFloats,
  updateChartFloats,
  warningSegments,
} from './floats';
import { createChart } from '../model/types';

const gauge = { stsPer4in: 20, rowsPer4in: 26, unit: 'in' as const };

describe('checkRowFloats (flat)', () => {
  it('finds no warnings when all runs are at or under threshold', () => {
    // Runs of 5 with threshold 5 are fine (limit is "longer than").
    expect(checkRowFloats([0, 0, 0, 0, 0, 1, 1, 1, 1, 1], 5, false)).toEqual([]);
  });

  it('flags a run longer than threshold', () => {
    const row = [1, 0, 0, 0, 0, 0, 0, 1];
    expect(checkRowFloats(row, 5, false)).toEqual([
      { start: 1, len: 6, color: 0, wraps: false },
    ]);
  });

  it('flags a long run at the start of the row', () => {
    const row = [2, 2, 2, 2, 2, 2, 2, 0];
    expect(checkRowFloats(row, 5, false)).toEqual([
      { start: 0, len: 7, color: 2, wraps: false },
    ]);
  });

  it('flags a long run at the end of the row', () => {
    const row = [0, 1, 1, 1, 1, 1, 1];
    expect(checkRowFloats(row, 5, false)).toEqual([
      { start: 1, len: 6, color: 1, wraps: false },
    ]);
  });

  it('flags multiple runs in one row', () => {
    const row = [0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 2];
    expect(checkRowFloats(row, 5, false)).toEqual([
      { start: 0, len: 6, color: 0, wraps: false },
      { start: 7, len: 7, color: 2, wraps: false },
    ]);
  });

  it('respects a custom threshold', () => {
    const row = [0, 0, 0, 0, 1];
    expect(checkRowFloats(row, 3, false)).toEqual([
      { start: 0, len: 4, color: 0, wraps: false },
    ]);
    expect(checkRowFloats(row, 4, false)).toEqual([]);
  });

  it('does NOT wrap a flat row: long run split across the edges is two short runs', () => {
    const row = [0, 0, 0, 1, 1, 0, 0, 0];
    expect(checkRowFloats(row, 5, false)).toEqual([]);
  });

  it('handles an empty row', () => {
    expect(checkRowFloats([], 5, false)).toEqual([]);
  });
});

describe('checkRowFloats (in the round)', () => {
  it('flags a run that wraps across the round boundary', () => {
    // 3 at the end + 3 at the start = wrapped run of 6.
    const row = [0, 0, 0, 1, 1, 0, 0, 0];
    expect(checkRowFloats(row, 5, true)).toEqual([
      { start: 5, len: 6, color: 0, wraps: true },
    ]);
  });

  it('does not flag a wrapped run at or under threshold', () => {
    const row = [0, 0, 1, 1, 1, 1, 0, 0];
    // wrapped run of 4 zeros, run of 4 ones, threshold 5 -> nothing.
    expect(checkRowFloats(row, 5, true)).toEqual([]);
  });

  it('does not double-count the wrapped run', () => {
    const row = [2, 2, 2, 2, 0, 2, 2, 2];
    // wrapped run: cols 5,6,7,0,1,2,3 = 7 twos.
    const warnings = checkRowFloats(row, 5, true);
    expect(warnings).toEqual([{ start: 5, len: 7, color: 2, wraps: true }]);
  });

  it('flags interior runs in round mode too', () => {
    const row = [1, 0, 0, 0, 0, 0, 0, 1];
    expect(checkRowFloats(row, 5, true)).toEqual([
      { start: 1, len: 6, color: 0, wraps: false },
    ]);
  });

  it('returns runs in column order even when the last run found covers column 0', () => {
    // 7 A's then 9 B's: the A run at cols 0-6 is discovered last by the wrapped
    // scan (which starts at the col-7 boundary) but must be reported first.
    const row = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    expect(checkRowFloats(row, 5, true)).toEqual([
      { start: 0, len: 7, color: 0, wraps: false },
      { start: 7, len: 9, color: 1, wraps: false },
    ]);
  });

  it('never flags a solid single-color row or round (no stranding, no floats)', () => {
    expect(checkRowFloats([3, 3, 3, 3, 3, 3, 3], 5, true)).toEqual([]);
    expect(checkRowFloats([3, 3, 3, 3, 3, 3, 3], 5, false)).toEqual([]);
  });
});

describe('checkChartFloats', () => {
  it('reports the grid row for each warning', () => {
    const chart = createChart({
      title: 't',
      stitches: 8,
      rows: 3,
      gauge,
      direction: 'flat',
    });
    // Row 1: six 1s starting at col 1.
    for (let c = 1; c <= 6; c++) chart.grid[1 * 8 + c] = 1;
    const warnings = checkChartFloats(chart);
    expect(warnings).toEqual([{ row: 1, start: 1, len: 6, color: 1, wraps: false }]);
  });

  it('uses round wrap when direction is round', () => {
    const chart = createChart({
      title: 't',
      stitches: 8,
      rows: 1,
      gauge,
      direction: 'round',
    });
    chart.grid.set([0, 0, 0, 1, 1, 0, 0, 0]);
    expect(checkChartFloats(chart)).toEqual([
      { row: 0, start: 5, len: 6, color: 0, wraps: true },
    ]);
  });
});

describe('updateChartFloats', () => {
  it('matches a full rescan after edits', () => {
    const chart = createChart({
      title: 't',
      stitches: 24,
      rows: 12,
      gauge,
      direction: 'flat',
    });
    // seed a pattern
    for (let i = 0; i < chart.grid.length; i++) chart.grid[i] = (i * 7) % 5 === 0 ? 1 : 0;
    let warnings = checkChartFloats(chart);

    // edit some cells across three rows, then update incrementally
    const touched = [3 * 24 + 5, 3 * 24 + 6, 7 * 24 + 0, 11 * 24 + 23];
    for (const i of touched) chart.grid[i] = 1;
    warnings = updateChartFloats(chart, warnings, [3, 7, 11]);

    expect(warnings).toEqual(checkChartFloats(chart));
  });

  it('matches a full rescan when a row has a run covering column 0', () => {
    const chart = createChart({ title: 't', stitches: 16, rows: 3, gauge, direction: 'round' });
    chart.grid.set([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1], 16);
    const warnings = updateChartFloats(chart, checkChartFloats(chart), [1]);
    expect(warnings).toEqual(checkChartFloats(chart));
  });

  it('matches a full rescan in the round', () => {
    const chart = createChart({
      title: 't',
      stitches: 16,
      rows: 5,
      gauge,
      direction: 'round',
    });
    for (let i = 0; i < chart.grid.length; i++) chart.grid[i] = i % 11 === 0 ? 1 : 0;
    let warnings = checkChartFloats(chart);

    chart.grid[2 * 16 + 15] = 1;
    chart.grid[2 * 16 + 0] = 1;
    warnings = updateChartFloats(chart, warnings, [2]);

    expect(warnings).toEqual(checkChartFloats(chart));
  });

  it('leaves untouched rows alone', () => {
    const chart = createChart({ title: 't', stitches: 10, rows: 4, gauge, direction: 'flat' });
    for (let c = 0; c < 10; c++) chart.grid[c] = c < 7 ? 1 : 0;
    const initial = checkChartFloats(chart);
    expect(initial).toHaveLength(1);

    // "change" row 2, which is solid — row 0's warning must survive
    const after = updateChartFloats(chart, initial, [2]);
    expect(after).toEqual(initial);
  });

  it('returns the previous list when nothing changed', () => {
    const chart = createChart({ title: 't', stitches: 10, rows: 2, gauge, direction: 'flat' });
    const initial = checkChartFloats(chart);
    expect(updateChartFloats(chart, initial, [])).toBe(initial);
  });
});

describe('warningSegments', () => {
  it('splits a wrapped run into two spans', () => {
    expect(warningSegments([{ row: 0, start: 5, len: 6, color: 0, wraps: true }], 8)).toEqual([
      { row: 0, start: 5, len: 3 },
      { row: 0, start: 0, len: 3 },
    ]);
  });

  it('leaves a non-wrapping run as one span', () => {
    expect(warningSegments([{ row: 2, start: 1, len: 2, color: 0, wraps: false }], 8)).toEqual([
      { row: 2, start: 1, len: 2 },
    ]);
  });

  it('keeps a run ending exactly at the last stitch whole', () => {
    expect(warningSegments([{ row: 1, start: 2, len: 6, color: 0, wraps: false }], 8)).toEqual([
      { row: 1, start: 2, len: 6 },
    ]);
  });
});
