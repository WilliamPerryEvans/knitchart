import { describe, expect, it } from 'vitest';
import { decodeGrid, decodeRow, encodeGrid, encodeRow } from './rle';

describe('encodeRow', () => {
  it('encodes a solid row as one run', () => {
    expect(encodeRow([3, 3, 3, 3])).toEqual([[3, 4]]);
  });

  it('encodes alternating colors as unit runs', () => {
    expect(encodeRow([0, 1, 0, 1])).toEqual([
      [0, 1],
      [1, 1],
      [0, 1],
      [1, 1],
    ]);
  });

  it('encodes mixed runs', () => {
    expect(encodeRow([0, 0, 1, 1, 1, 2])).toEqual([
      [0, 2],
      [1, 3],
      [2, 1],
    ]);
  });

  it('handles an empty row', () => {
    expect(encodeRow([])).toEqual([]);
  });

  it('handles a single stitch', () => {
    expect(encodeRow([7])).toEqual([[7, 1]]);
  });

  it('works on Uint8Array input', () => {
    expect(encodeRow(new Uint8Array([1, 1, 0]))).toEqual([
      [1, 2],
      [0, 1],
    ]);
  });
});

describe('decodeRow', () => {
  it('round-trips arbitrary rows', () => {
    const rows = [
      [0, 0, 0, 0],
      [0, 1, 2, 3, 4],
      [5],
      [1, 1, 0, 0, 1, 1],
    ];
    for (const row of rows) {
      expect(Array.from(decodeRow(encodeRow(row), row.length))).toEqual(row);
    }
  });

  it('rejects rows that decode short', () => {
    expect(() => decodeRow([[0, 3]], 4)).toThrow(/expected 4/);
  });

  it('rejects rows that overflow', () => {
    expect(() => decodeRow([[0, 5]], 4)).toThrow(/overflows/);
  });

  it('rejects non-positive run lengths', () => {
    expect(() => decodeRow([[0, 0]], 4)).toThrow(/run length/);
    expect(() => decodeRow([[0, -2]], 4)).toThrow(/run length/);
  });

  it('rejects out-of-range palette indices', () => {
    expect(() => decodeRow([[256, 4]], 4)).toThrow(/palette index/);
    expect(() => decodeRow([[-1, 4]], 4)).toThrow(/palette index/);
    expect(() => decodeRow([[1.5, 4]], 4)).toThrow(/palette index/);
  });
});

describe('grid round-trip', () => {
  it('round-trips a full grid', () => {
    const stitches = 7;
    const rows = 5;
    const grid = new Uint8Array(stitches * rows);
    for (let i = 0; i < grid.length; i++) grid[i] = (i * 13) % 3;
    const rle = encodeGrid(grid, stitches, rows);
    expect(rle).toHaveLength(rows);
    const back = decodeGrid(rle, stitches, rows);
    expect(Array.from(back)).toEqual(Array.from(grid));
  });

  it('round-trips a large mostly-solid grid compactly', () => {
    const stitches = 300;
    const rows = 300;
    const grid = new Uint8Array(stitches * rows); // all color 0
    grid[stitches * 150 + 150] = 1; // one contrasting stitch
    const rle = encodeGrid(grid, stitches, rows);
    // Solid rows should be a single run each.
    expect(rle[0]).toEqual([[0, 300]]);
    expect(rle[150]).toEqual([
      [0, 150],
      [1, 1],
      [0, 149],
    ]);
    const back = decodeGrid(rle, stitches, rows);
    expect(back).toEqual(grid);
  });

  it('rejects a row-count mismatch', () => {
    expect(() => decodeGrid([[[0, 4]]], 4, 2)).toThrow(/expected 2/);
  });
});
