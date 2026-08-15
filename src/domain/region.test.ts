import { describe, expect, it } from 'vitest';
import {
  anchorOffset,
  clampRegion,
  contentBounds,
  extractRegion,
  fillRegionCells,
  mirrorCellIndices,
  mirrorRegionH,
  mirrorRegionV,
  moveRegionCells,
  placeRegion,
  regionContains,
  regionFromCorners,
  resizeByEdges,
  resizeGrid,
  rotateRegion180,
  rotateRegion90,
  rotateRegionCells,
  rotatedPlacement,
  type GridSize,
  type RegionData,
} from './region';

/** Build a grid from rows of digits, e.g. ['012', '345']. */
function g(rows: string[]): { grid: Uint8Array; size: GridSize } {
  const size = { stitches: rows[0].length, rows: rows.length };
  const grid = new Uint8Array(size.stitches * size.rows);
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      grid[r * size.stitches + c] = parseInt(ch, 10);
    });
  });
  return { grid, size };
}

/** Render a grid back to rows of digits, for readable assertions. */
function s(grid: Uint8Array, size: GridSize): string[] {
  const out: string[] = [];
  for (let r = 0; r < size.rows; r++) {
    out.push([...grid.subarray(r * size.stitches, (r + 1) * size.stitches)].join(''));
  }
  return out;
}

describe('anchorOffset', () => {
  const from = { stitches: 2, rows: 2 };
  const to = { stitches: 6, rows: 6 };

  it('pins to the top-left', () => {
    expect(anchorOffset(from, to, { h: 'left', v: 'top' })).toEqual({ dx: 0, dy: 0 });
  });

  it('pins to the bottom-right', () => {
    expect(anchorOffset(from, to, { h: 'right', v: 'bottom' })).toEqual({ dx: 4, dy: 4 });
  });

  it('centers, rounding down on odd remainders', () => {
    expect(anchorOffset(from, to, { h: 'center', v: 'middle' })).toEqual({ dx: 2, dy: 2 });
    expect(
      anchorOffset({ stitches: 2, rows: 2 }, { stitches: 5, rows: 5 }, { h: 'center', v: 'middle' })
    ).toEqual({ dx: 1, dy: 1 });
  });

  it('gives negative offsets when shrinking', () => {
    expect(anchorOffset(to, from, { h: 'right', v: 'bottom' })).toEqual({ dx: -4, dy: -4 });
  });
});

describe('resizeGrid', () => {
  it('grows, keeping content in the top-left', () => {
    const { grid, size } = g(['12', '34']);
    const out = resizeGrid(grid, size, { stitches: 4, rows: 3 }, { h: 'left', v: 'top' });
    expect(s(out, { stitches: 4, rows: 3 })).toEqual(['1200', '3400', '0000']);
  });

  it('grows, keeping content in the bottom-right', () => {
    const { grid, size } = g(['12', '34']);
    const out = resizeGrid(grid, size, { stitches: 4, rows: 3 }, { h: 'right', v: 'bottom' });
    expect(s(out, { stitches: 4, rows: 3 })).toEqual(['0000', '0012', '0034']);
  });

  it('centers content when growing', () => {
    const { grid, size } = g(['12', '34']);
    const out = resizeGrid(grid, size, { stitches: 4, rows: 4 }, { h: 'center', v: 'middle' });
    expect(s(out, { stitches: 4, rows: 4 })).toEqual(['0000', '0120', '0340', '0000']);
  });

  it('drops the far edges when shrinking from the top-left anchor', () => {
    const { grid, size } = g(['123', '456', '789']);
    const out = resizeGrid(grid, size, { stitches: 2, rows: 2 }, { h: 'left', v: 'top' });
    expect(s(out, { stitches: 2, rows: 2 })).toEqual(['12', '45']);
  });

  it('drops the near edges when shrinking from the bottom-right anchor', () => {
    const { grid, size } = g(['123', '456', '789']);
    const out = resizeGrid(grid, size, { stitches: 2, rows: 2 }, { h: 'right', v: 'bottom' });
    expect(s(out, { stitches: 2, rows: 2 })).toEqual(['56', '89']);
  });

  it('fills new stitches with the given background', () => {
    const { grid, size } = g(['1']);
    const out = resizeGrid(grid, size, { stitches: 3, rows: 1 }, { h: 'center', v: 'middle' }, 7);
    expect(s(out, { stitches: 3, rows: 1 })).toEqual(['717']);
  });
});

describe('resizeByEdges', () => {
  it('adds rows to the top, pushing content down', () => {
    const { grid, size } = g(['12', '34']);
    const r = resizeByEdges(grid, size, { top: 2 });
    expect(r.size).toEqual({ stitches: 2, rows: 4 });
    expect(s(r.grid, r.size)).toEqual(['00', '00', '12', '34']);
  });

  it('adds stitches to the left, pushing content right', () => {
    const { grid, size } = g(['12', '34']);
    const r = resizeByEdges(grid, size, { left: 1 });
    expect(s(r.grid, r.size)).toEqual(['012', '034']);
  });

  it('adds to the bottom and right without moving content', () => {
    const { grid, size } = g(['12', '34']);
    const r = resizeByEdges(grid, size, { bottom: 1, right: 1 });
    expect(s(r.grid, r.size)).toEqual(['120', '340', '000']);
  });

  it('removes from an edge', () => {
    const { grid, size } = g(['123', '456', '789']);
    const trimTop = resizeByEdges(grid, size, { top: -1 });
    expect(s(trimTop.grid, trimTop.size)).toEqual(['456', '789']);
    const trimRight = resizeByEdges(grid, size, { right: -1 });
    expect(s(trimRight.grid, trimRight.size)).toEqual(['12', '45', '78']);
  });

  it('combines edges in one pass', () => {
    const { grid, size } = g(['123', '456', '789']);
    const r = resizeByEdges(grid, size, { top: -1, left: -1, right: 1 });
    expect(r.size).toEqual({ stitches: 3, rows: 2 });
    expect(s(r.grid, r.size)).toEqual(['560', '890']);
  });

  it('refuses to shrink a chart out of existence', () => {
    const { grid, size } = g(['12', '34']);
    expect(() => resizeByEdges(grid, size, { top: -2 })).toThrow(/at least one/);
    expect(() => resizeByEdges(grid, size, { left: -1, right: -1 })).toThrow(/at least one/);
  });
});

describe('contentBounds', () => {
  it('finds the tightest box around non-background stitches', () => {
    const { grid, size } = g(['0000', '0110', '0100', '0000']);
    expect(contentBounds(grid, size)).toEqual({ row: 1, col: 1, w: 2, h: 2 });
  });

  it('returns null for an empty chart', () => {
    const { grid, size } = g(['000', '000']);
    expect(contentBounds(grid, size)).toBeNull();
  });

  it('covers the whole chart when content touches every edge', () => {
    const { grid, size } = g(['101', '000', '101']);
    expect(contentBounds(grid, size)).toEqual({ row: 0, col: 0, w: 3, h: 3 });
  });

  it('honors a non-zero background index', () => {
    const { grid, size } = g(['222', '212', '222']);
    expect(contentBounds(grid, size, 2)).toEqual({ row: 1, col: 1, w: 1, h: 1 });
  });
});

describe('regionFromCorners', () => {
  it('normalizes corners dragged in any direction', () => {
    const expected = { row: 1, col: 2, w: 3, h: 2 };
    expect(regionFromCorners({ row: 1, col: 2 }, { row: 2, col: 4 })).toEqual(expected);
    expect(regionFromCorners({ row: 2, col: 4 }, { row: 1, col: 2 })).toEqual(expected);
    expect(regionFromCorners({ row: 2, col: 2 }, { row: 1, col: 4 })).toEqual(expected);
  });

  it('makes a single cell a 1x1 region', () => {
    expect(regionFromCorners({ row: 3, col: 3 }, { row: 3, col: 3 })).toEqual({
      row: 3,
      col: 3,
      w: 1,
      h: 1,
    });
  });
});

describe('clampRegion / regionContains', () => {
  const size = { stitches: 4, rows: 4 };

  it('clips a region overhanging an edge', () => {
    expect(clampRegion({ row: -1, col: 2, w: 4, h: 3 }, size)).toEqual({
      row: 0,
      col: 2,
      w: 2,
      h: 2,
    });
  });

  it('returns null when fully outside', () => {
    expect(clampRegion({ row: 9, col: 9, w: 2, h: 2 }, size)).toBeNull();
  });

  it('tests containment on the half-open box', () => {
    const region = { row: 1, col: 1, w: 2, h: 2 };
    expect(regionContains(region, 1, 1)).toBe(true);
    expect(regionContains(region, 2, 2)).toBe(true);
    expect(regionContains(region, 3, 2)).toBe(false);
    expect(regionContains(region, 0, 1)).toBe(false);
  });
});

describe('extractRegion / placeRegion', () => {
  it('round-trips a region through extract and place', () => {
    const { grid, size } = g(['1234', '5678', '9012']);
    const data = extractRegion(grid, size, { row: 0, col: 1, w: 2, h: 2 });
    expect(data.w).toBe(2);
    expect([...data.cells]).toEqual([2, 3, 6, 7]);

    const changes = placeRegion(data, size, 1, 2);
    expect(changes).toEqual([
      { i: 1 * 4 + 2, color: 2 },
      { i: 1 * 4 + 3, color: 3 },
      { i: 2 * 4 + 2, color: 6 },
      { i: 2 * 4 + 3, color: 7 },
    ]);
  });

  it('clips a region extracted across an edge', () => {
    const { grid, size } = g(['12', '34']);
    const data = extractRegion(grid, size, { row: 1, col: 1, w: 5, h: 5 });
    expect(data).toEqual({ w: 1, h: 1, cells: new Uint8Array([4]) });
  });

  it('clips a placement running past the edges instead of wrapping', () => {
    const { size } = g(['12', '34']);
    const data = { w: 2, h: 2, cells: new Uint8Array([9, 9, 9, 9]) };
    // top-left at (1,1) means only one cell lands on the chart
    expect(placeRegion(data, size, 1, 1)).toEqual([{ i: 3, color: 9 }]);
    // entirely off the chart
    expect(placeRegion(data, size, 5, 5)).toEqual([]);
  });

  it('extracts nothing for a region off the chart', () => {
    const { grid, size } = g(['12', '34']);
    expect(extractRegion(grid, size, { row: 5, col: 5, w: 2, h: 2 })).toEqual({
      w: 0,
      h: 0,
      cells: new Uint8Array(0),
    });
  });

  it('leaves the see-through colour out so what is underneath survives', () => {
    const { size } = g(['1111', '1111']);
    const data = { w: 2, h: 2, cells: new Uint8Array([0, 5, 5, 0]) };
    // Without a transparent index every stitch is written, background included.
    expect(placeRegion(data, size, 0, 0)).toHaveLength(4);
    // With it, only the two non-background stitches land.
    expect(placeRegion(data, size, 0, 0, 0)).toEqual([
      { i: 1, color: 5 },
      { i: 4, color: 5 },
    ]);
  });

  it('can be told a see-through colour other than the background', () => {
    const { size } = g(['11', '11']);
    const data = { w: 2, h: 2, cells: new Uint8Array([0, 5, 5, 0]) };
    expect(placeRegion(data, size, 0, 0, 5)).toEqual([
      { i: 0, color: 0 },
      { i: 3, color: 0 },
    ]);
  });
});

describe('rotateRegion90', () => {
  const data: RegionData = { w: 3, h: 2, cells: new Uint8Array([1, 2, 3, 4, 5, 6]) };
  const rows = (d: RegionData) => {
    const out: string[] = [];
    for (let r = 0; r < d.h; r++) out.push([...d.cells.subarray(r * d.w, (r + 1) * d.w)].join(''));
    return out;
  };

  it('turns clockwise, swapping width and height', () => {
    // 123      41
    // 456  ->  52
    //          63
    const turned = rotateRegion90(data, 1);
    expect({ w: turned.w, h: turned.h }).toEqual({ w: 2, h: 3 });
    expect(rows(turned)).toEqual(['41', '52', '63']);
  });

  it('turns anticlockwise on three quarter turns', () => {
    const turned = rotateRegion90(data, 3);
    expect(rows(turned)).toEqual(['36', '25', '14']);
  });

  it('agrees with rotateRegion180 on two turns', () => {
    expect([...rotateRegion90(data, 2).cells]).toEqual([...rotateRegion180(data).cells]);
  });

  it('comes back to the original after four turns', () => {
    let d = data;
    for (let i = 0; i < 4; i++) d = rotateRegion90(d, 1);
    expect({ w: d.w, h: d.h }).toEqual({ w: data.w, h: data.h });
    expect([...d.cells]).toEqual([...data.cells]);
  });

  it('copies rather than aliasing on a zero turn', () => {
    const same = rotateRegion90(data, 0);
    same.cells[0] = 9;
    expect(data.cells[0]).toBe(1);
  });
});

describe('rotatedPlacement', () => {
  it('keeps the centre and swaps the footprint on an odd turn', () => {
    const size: GridSize = { stitches: 20, rows: 20 };
    const at = rotatedPlacement({ row: 5, col: 4, w: 8, h: 2 }, size, 1);
    expect({ w: at.w, h: at.h }).toEqual({ w: 2, h: 8 });
    // centre was (6, 8); the 2x8 footprint centres on it too
    expect(at.row + at.h / 2).toBe(6);
    expect(at.col + at.w / 2).toBe(8);
  });

  it('shifts a turned region back onto the chart rather than off the edge', () => {
    const size: GridSize = { stitches: 6, rows: 6 };
    const at = rotatedPlacement({ row: 0, col: 0, w: 6, h: 1 }, size, 1);
    expect(at.row).toBe(0); // a 1x6 tower would start above the chart
    expect(at.row + at.h).toBeLessThanOrEqual(size.rows);
  });
});

describe('rotateRegionCells', () => {
  it('clears the old footprint and stamps the turned copy', () => {
    const { grid, size } = g(['1230', '4560', '0000', '0000']);
    const changes = rotateRegionCells(grid, size, { row: 0, col: 0, w: 3, h: 2 }, 1);
    const next = Uint8Array.from(grid);
    for (const { i, color } of changes) next[i] = color;
    // 3x2 becomes 2x3, centred on the same point
    expect(s(next, size)).toEqual(['0410', '0520', '0630', '0000']);
  });

  it('never lists a cell twice, so one undo restores it exactly', () => {
    const { grid, size } = g(['1234', '5678', '9876', '5432']);
    const changes = rotateRegionCells(grid, size, { row: 0, col: 0, w: 4, h: 2 }, 1);
    expect(new Set(changes.map((c) => c.i)).size).toBe(changes.length);
  });

  it('is a no-op for a full turn or an empty selection', () => {
    const { grid, size } = g(['12', '34']);
    expect(rotateRegionCells(grid, size, { row: 0, col: 0, w: 2, h: 2 }, 0)).toEqual([]);
    expect(rotateRegionCells(grid, size, { row: 9, col: 9, w: 2, h: 2 }, 1)).toEqual([]);
  });

  it('restores the original after four quarter turns of a square region', () => {
    const { grid, size } = g(['1234', '5678', '9876', '5432']);
    const next = Uint8Array.from(grid);
    for (let t = 0; t < 4; t++) {
      for (const { i, color } of rotateRegionCells(next, size, { row: 0, col: 0, w: 4, h: 4 }, 1)) {
        next[i] = color;
      }
    }
    expect([...next]).toEqual([...grid]);
  });
});

describe('moveRegionCells', () => {
  it('clears the source and stamps the copy at the destination', () => {
    const { grid, size } = g(['1200', '3400', '0000', '0000']);
    const changes = moveRegionCells(grid, size, { row: 0, col: 0, w: 2, h: 2 }, 2, 2);
    // apply them to see the result
    const after = Uint8Array.from(grid);
    for (const ch of changes) after[ch.i] = ch.color;
    expect(s(after, size)).toEqual(['0000', '0000', '0012', '0034']);
  });

  it('emits each cell only once when source and destination overlap', () => {
    const { grid, size } = g(['1200', '3400', '0000', '0000']);
    const changes = moveRegionCells(grid, size, { row: 0, col: 0, w: 2, h: 2 }, 1, 1);
    const seen = new Set(changes.map((c) => c.i));
    expect(seen.size).toBe(changes.length);

    const after = Uint8Array.from(grid);
    for (const ch of changes) after[ch.i] = ch.color;
    // the overlapping stitch keeps the moved content, not the cleared source
    expect(s(after, size)).toEqual(['0000', '0120', '0340', '0000']);
  });

  it('clips content moved partly off the chart', () => {
    const { grid, size } = g(['12', '34']);
    const changes = moveRegionCells(grid, size, { row: 0, col: 0, w: 2, h: 2 }, 1, 1);
    const after = Uint8Array.from(grid);
    for (const ch of changes) after[ch.i] = ch.color;
    expect(s(after, size)).toEqual(['00', '01']);
  });

  it('clears to a custom background', () => {
    const { grid, size } = g(['10', '00']);
    const changes = moveRegionCells(grid, size, { row: 0, col: 0, w: 1, h: 1 }, 1, 1, 5);
    const after = Uint8Array.from(grid);
    for (const ch of changes) after[ch.i] = ch.color;
    expect(s(after, size)).toEqual(['50', '01']);
  });
});

describe('fillRegionCells', () => {
  it('covers every stitch in the region', () => {
    const { size } = g(['000', '000', '000']);
    const changes = fillRegionCells({ row: 1, col: 0, w: 2, h: 2 }, size, 4);
    expect(changes.map((c) => c.i)).toEqual([3, 4, 6, 7]);
    expect(changes.every((c) => c.color === 4)).toBe(true);
  });
});

describe('mirroring regions', () => {
  const data = { w: 3, h: 2, cells: new Uint8Array([1, 2, 3, 4, 5, 6]) };

  it('mirrors left to right', () => {
    expect([...mirrorRegionH(data).cells]).toEqual([3, 2, 1, 6, 5, 4]);
  });

  it('mirrors top to bottom', () => {
    expect([...mirrorRegionV(data).cells]).toEqual([4, 5, 6, 1, 2, 3]);
  });

  it('rotates 180 degrees', () => {
    expect([...rotateRegion180(data).cells]).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('is its own inverse', () => {
    expect([...mirrorRegionH(mirrorRegionH(data)).cells]).toEqual([...data.cells]);
    expect([...mirrorRegionV(mirrorRegionV(data)).cells]).toEqual([...data.cells]);
  });
});

describe('mirrorCellIndices', () => {
  const size = { stitches: 5, rows: 4 };

  it('passes indices through untouched when off', () => {
    expect(mirrorCellIndices([7], size, 'none')).toEqual([7]);
  });

  it('mirrors left to right about the chart centre', () => {
    // row 1, col 0 -> row 1, col 4
    expect(mirrorCellIndices([5], size, 'vertical').sort((a, b) => a - b)).toEqual([5, 9]);
  });

  it('mirrors top to bottom', () => {
    // row 0, col 1 -> row 3, col 1
    expect(mirrorCellIndices([1], size, 'horizontal').sort((a, b) => a - b)).toEqual([1, 16]);
  });

  it('produces four stitches for both axes', () => {
    expect(mirrorCellIndices([0], size, 'both').sort((a, b) => a - b)).toEqual([0, 4, 15, 19]);
  });

  it('does not duplicate a stitch sitting on the axis', () => {
    // odd width: column 2 is the centre column, so it mirrors onto itself
    expect(mirrorCellIndices([2], size, 'vertical')).toEqual([2]);
  });

  it('deduplicates overlapping input', () => {
    const out = mirrorCellIndices([5, 9], size, 'vertical');
    expect(new Set(out).size).toBe(out.length);
    expect(out.sort((a, b) => a - b)).toEqual([5, 9]);
  });
});
