// Pure cell-geometry helpers for the editor tools.

export interface Cell {
  row: number;
  col: number;
}

/** Bresenham line between two cells, inclusive. */
export function lineCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  let x0 = a.col;
  let y0 = a.row;
  const x1 = b.col;
  const y1 = b.row;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ row: y0, col: x0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}

/** Filled rectangle between two corner cells, inclusive. */
export function rectCells(a: Cell, b: Cell, filled: boolean): Cell[] {
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  const c0 = Math.min(a.col, b.col);
  const c1 = Math.max(a.col, b.col);
  const out: Cell[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (filled || r === r0 || r === r1 || c === c0 || c === c1) {
        out.push({ row: r, col: c });
      }
    }
  }
  return out;
}

/** Scanline flood fill on a flat grid. Returns flat indices to repaint. */
export function floodFill(
  grid: Uint8Array,
  stitches: number,
  rows: number,
  startRow: number,
  startCol: number
): number[] {
  const target = grid[startRow * stitches + startCol];
  const out: number[] = [];
  const visited = new Uint8Array(grid.length);
  const stack: Array<[number, number]> = [[startRow, startCol]];
  while (stack.length) {
    const [r, cIn] = stack.pop()!;
    let c = cIn;
    // walk left to the start of the span
    while (c > 0 && grid[r * stitches + c - 1] === target && !visited[r * stitches + c - 1]) c--;
    let spanAbove = false;
    let spanBelow = false;
    while (c < stitches && grid[r * stitches + c] === target && !visited[r * stitches + c]) {
      const i = r * stitches + c;
      visited[i] = 1;
      out.push(i);
      const above = (r - 1) * stitches + c;
      const below = (r + 1) * stitches + c;
      if (r > 0 && grid[above] === target && !visited[above]) {
        if (!spanAbove) {
          stack.push([r - 1, c]);
          spanAbove = true;
        }
      } else {
        spanAbove = false;
      }
      if (r < rows - 1 && grid[below] === target && !visited[below]) {
        if (!spanBelow) {
          stack.push([r + 1, c]);
          spanBelow = true;
        }
      } else {
        spanBelow = false;
      }
      c++;
    }
  }
  return out;
}
