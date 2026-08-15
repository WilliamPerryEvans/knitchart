import { describe, expect, it } from 'vitest';
import {
  cellsPerPage,
  fitCellSize,
  mmToPoints,
  pageDimensions,
  planTiles,
  pointsToMm,
  tileRangeLabel,
  tileRowRange,
  tileStarts,
  tileStitchRange,
  tilePositionLabel,
  type LayoutOpts,
} from './pageLayout';

describe('page dimensions', () => {
  it('gives Letter in points', () => {
    expect(pageDimensions('letter', 'portrait')).toEqual({ width: 612, height: 792 });
  });

  it('swaps for landscape', () => {
    expect(pageDimensions('letter', 'landscape')).toEqual({ width: 792, height: 612 });
  });

  it('converts millimetres and points round-trip', () => {
    expect(mmToPoints(25.4)).toBeCloseTo(72, 10);
    expect(pointsToMm(72)).toBeCloseTo(25.4, 10);
    expect(pointsToMm(mmToPoints(6))).toBeCloseTo(6, 10);
  });
});

describe('tileStarts', () => {
  it('returns a single tile when everything fits', () => {
    expect(tileStarts(20, 30, 2)).toEqual([0]);
    expect(tileStarts(20, 20, 2)).toEqual([0]);
  });

  it('steps by page size when there is no overlap', () => {
    expect(tileStarts(100, 25, 0)).toEqual([0, 25, 50, 75]);
  });

  it('steps by page size minus overlap', () => {
    // 20 per page, 2 shared -> advance 18 each time. A fourth tile is needed:
    // the third covers 36..55, leaving 56..59 uncovered.
    expect(tileStarts(60, 20, 2)).toEqual([0, 18, 36, 54]);
  });

  it('stops as soon as a tile reaches the end', () => {
    const starts = tileStarts(40, 20, 2);
    const last = starts[starts.length - 1];
    expect(last + 20).toBeGreaterThanOrEqual(40);
    expect(starts).toEqual([0, 18, 36]);
  });

  it('covers every index across all tiles', () => {
    const total = 137;
    const perPage = 22;
    const covered = new Set<number>();
    for (const start of tileStarts(total, perPage, 3)) {
      for (let i = start; i < Math.min(start + perPage, total); i++) covered.add(i);
    }
    expect(covered.size).toBe(total);
  });

  it('makes progress even when overlap is silly', () => {
    // overlap >= perPage would otherwise loop forever
    const starts = tileStarts(50, 10, 10);
    expect(starts.length).toBeLessThan(60);
    expect(starts[1]).toBeGreaterThan(starts[0]);
    const starts2 = tileStarts(50, 10, 99);
    expect(starts2[1]).toBeGreaterThan(starts2[0]);
  });

  it('handles degenerate input', () => {
    expect(tileStarts(0, 10, 1)).toEqual([]);
    expect(tileStarts(10, 0, 1)).toEqual([]);
  });
});

describe('cellsPerPage', () => {
  it('subtracts the gutters before dividing', () => {
    expect(cellsPerPage(500, 100, 20)).toBe(20);
  });

  it('rounds down to whole stitches', () => {
    expect(cellsPerPage(509, 100, 20)).toBe(20);
  });

  it('never goes negative', () => {
    expect(cellsPerPage(50, 100, 20)).toBe(0);
  });
});

describe('planTiles', () => {
  // 600 - 90 of gutters = 510pt of grid, i.e. 42 columns of 12pt
  const base: LayoutOpts = {
    stitches: 40,
    rows: 40,
    cellW: 12,
    cellH: 9,
    availW: 600,
    availH: 700,
    gutterLeft: 60,
    gutterRight: 30,
    gutterBottom: 20,
    overlap: 2,
  };

  it('fits a small chart on one page', () => {
    const layout = planTiles(base);
    expect(layout.tiles).toHaveLength(1);
    expect(layout.tiles[0]).toMatchObject({ col: 0, row: 0, cols: 40, rows: 40 });
  });

  it('splits a wide chart across columns', () => {
    const layout = planTiles({ ...base, stitches: 120 });
    expect(layout.tileCols).toBeGreaterThan(1);
    expect(layout.tileRows).toBe(1);
    expect(layout.tiles).toHaveLength(layout.tileCols);
  });

  it('numbers pages in reading order, across then down', () => {
    const layout = planTiles({ ...base, stitches: 120, rows: 200 });
    expect(layout.tileCols).toBeGreaterThan(1);
    expect(layout.tileRows).toBeGreaterThan(1);
    // first row of pages comes first
    const firstBand = layout.tiles.filter((t) => t.tileRow === 0);
    expect(firstBand.map((t) => t.index)).toEqual(
      Array.from({ length: layout.tileCols }, (_, i) => i)
    );
    expect(layout.tiles[layout.tileCols].tileRow).toBe(1);
  });

  it('covers every stitch and row exactly once or more', () => {
    const layout = planTiles({ ...base, stitches: 137, rows: 91 });
    const cols = new Set<number>();
    const rows = new Set<number>();
    for (const t of layout.tiles) {
      for (let c = t.col; c < t.col + t.cols; c++) cols.add(c);
      for (let r = t.row; r < t.row + t.rows; r++) rows.add(r);
    }
    expect(cols.size).toBe(137);
    expect(rows.size).toBe(91);
  });

  it('never runs a tile past the chart edge', () => {
    const layout = planTiles({ ...base, stitches: 137, rows: 91 });
    for (const t of layout.tiles) {
      expect(t.col + t.cols).toBeLessThanOrEqual(137);
      expect(t.row + t.rows).toBeLessThanOrEqual(91);
      expect(t.cols).toBeGreaterThan(0);
      expect(t.rows).toBeGreaterThan(0);
    }
  });

  it('overlaps neighbouring tiles by the requested amount', () => {
    const layout = planTiles({ ...base, stitches: 120, overlap: 3 });
    const [first, second] = layout.tiles;
    const firstEnd = first.col + first.cols;
    expect(firstEnd - second.col).toBe(3);
  });

  it('gives up rather than looping when a cell cannot fit', () => {
    const layout = planTiles({ ...base, cellW: 5000 });
    expect(layout.tiles).toEqual([]);
    expect(layout.colsPerPage).toBe(0);
  });
});

describe('tile ranges', () => {
  const tile = { index: 0, tileCol: 0, tileRow: 0, col: 0, row: 0, cols: 20, rows: 20 };

  it('counts stitches from the right', () => {
    // leftmost 20 columns of a 40-stitch chart are stitches 40 down to 21
    expect(tileStitchRange(40, tile)).toEqual({ from: 40, to: 21 });
  });

  it('counts rows from the bottom', () => {
    // topmost 20 rows of a 40-row chart are rows 40 down to 21
    expect(tileRowRange(40, tile)).toEqual({ from: 40, to: 21 });
  });

  it('reads as a range label', () => {
    expect(tileRangeLabel(40, 40, tile)).toBe('sts 40–21, rows 40–21');
  });

  it('uses the singular for a one-stitch tile', () => {
    const single = { ...tile, cols: 1, rows: 1 };
    expect(tileRangeLabel(40, 40, single)).toBe('st 40, row 40');
  });
});

describe('tilePositionLabel', () => {
  it('is just the page number for a single page', () => {
    const layout = planTiles({
      stitches: 20,
      rows: 20,
      cellW: 10,
      cellH: 8,
      availW: 500,
      availH: 700,
      gutterLeft: 50,
      gutterRight: 30,
      gutterBottom: 20,
      overlap: 2,
    });
    expect(tilePositionLabel(layout, layout.tiles[0])).toBe('Page 1 of 1');
  });

  it('names the column and band when tiled both ways', () => {
    const layout = planTiles({
      stitches: 200,
      rows: 200,
      cellW: 12,
      cellH: 9,
      availW: 540,
      availH: 700,
      gutterLeft: 60,
      gutterRight: 30,
      gutterBottom: 20,
      overlap: 2,
    });
    const label = tilePositionLabel(layout, layout.tiles[0]);
    expect(label).toMatch(/^Page 1 of \d+/);
    expect(label).toContain('column 1 of');
    expect(label).toContain('band 1 of');
  });
});

describe('fitCellSize', () => {
  const base = {
    stitches: 40,
    rows: 40,
    aspect: 0.769,
    availW: 540,
    availH: 700,
    gutterLeft: 60,
    gutterRight: 30,
    gutterBottom: 20,
  };

  it('fits the chart within the page', () => {
    const cw = fitCellSize(base);
    expect(cw * base.stitches).toBeLessThanOrEqual(base.availW - base.gutterLeft - base.gutterRight + 0.01);
    expect(cw * base.aspect * base.rows).toBeLessThanOrEqual(base.availH - base.gutterBottom + 0.01);
  });

  it('is limited by width for a wide chart', () => {
    const cw = fitCellSize({ ...base, stitches: 200 });
    expect(cw).toBeCloseTo((540 - 90) / 200, 6);
  });

  it('is limited by height for a tall chart', () => {
    const cw = fitCellSize({ ...base, rows: 400 });
    expect(cw).toBeCloseTo((700 - 20) / (400 * 0.769), 6);
  });

  it('returns zero when there is no room', () => {
    expect(fitCellSize({ ...base, availW: 10, availH: 10 })).toBe(0);
  });
});
