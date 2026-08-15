import type { RleRow } from './types';

/** Encode one grid row (palette indices) into [index, runLength] pairs. */
export function encodeRow(row: ArrayLike<number>): RleRow {
  const out: RleRow = [];
  const n = row.length;
  if (n === 0) return out;
  let cur = row[0];
  let run = 1;
  for (let i = 1; i < n; i++) {
    if (row[i] === cur) {
      run++;
    } else {
      out.push([cur, run]);
      cur = row[i];
      run = 1;
    }
  }
  out.push([cur, run]);
  return out;
}

/** Decode an RLE row into a Uint8Array of expected width. Throws on length mismatch. */
export function decodeRow(rle: RleRow, width: number): Uint8Array {
  const out = new Uint8Array(width);
  let pos = 0;
  for (const [color, run] of rle) {
    if (!Number.isInteger(color) || color < 0 || color > 255) {
      throw new Error(`RLE: invalid palette index ${color}`);
    }
    if (!Number.isInteger(run) || run <= 0) {
      throw new Error(`RLE: invalid run length ${run}`);
    }
    if (pos + run > width) {
      throw new Error(`RLE: row overflows width ${width}`);
    }
    out.fill(color, pos, pos + run);
    pos += run;
  }
  if (pos !== width) {
    throw new Error(`RLE: row decodes to ${pos} stitches, expected ${width}`);
  }
  return out;
}

/** Encode a full grid (row-major flat array) to per-row RLE. */
export function encodeGrid(grid: Uint8Array, stitches: number, rows: number): RleRow[] {
  const out: RleRow[] = [];
  for (let r = 0; r < rows; r++) {
    out.push(encodeRow(grid.subarray(r * stitches, (r + 1) * stitches)));
  }
  return out;
}

/** Decode per-row RLE back into a flat grid. */
export function decodeGrid(cells: RleRow[], stitches: number, rows: number): Uint8Array {
  if (cells.length !== rows) {
    throw new Error(`RLE: file has ${cells.length} rows, expected ${rows}`);
  }
  const grid = new Uint8Array(stitches * rows);
  for (let r = 0; r < rows; r++) {
    grid.set(decodeRow(cells[r], stitches), r * stitches);
  }
  return grid;
}
