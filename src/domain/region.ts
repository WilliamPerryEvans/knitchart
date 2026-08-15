/**
 * Pure grid geometry: resizing the chart, and extracting / placing / mirroring
 * rectangular regions of stitches.
 *
 * Everything here works on a flat `Uint8Array` of palette indices with
 * `grid[row * stitches + col]`, row 0 being the top of the chart. Nothing in
 * this module touches the store or the canvas, so it is all directly testable.
 */

export interface GridSize {
  stitches: number;
  rows: number;
}

/** A rectangle of stitches, in grid coordinates. */
export interface Region {
  row: number;
  col: number;
  w: number;
  h: number;
}

/** A detached copy of a region's stitches. */
export interface RegionData {
  w: number;
  h: number;
  cells: Uint8Array;
}

export type AnchorH = 'left' | 'center' | 'right';
export type AnchorV = 'top' | 'middle' | 'bottom';

/** Where the existing chart sits inside the new canvas when resizing. */
export interface Anchor {
  h: AnchorH;
  v: AnchorV;
}

export const DEFAULT_ANCHOR: Anchor = { h: 'center', v: 'middle' };

/** A single cell change, matching the store's `applyCells` input. */
export interface CellChange {
  i: number;
  color: number;
}

// --- resizing -------------------------------------------------------------

/**
 * Copy `grid` into a differently-sized grid, offsetting the old content by
 * (dx, dy). Cells with no source are filled with `fill`; content pushed past an
 * edge is dropped.
 */
export function offsetGrid(
  grid: Uint8Array,
  from: GridSize,
  to: GridSize,
  dx: number,
  dy: number,
  fill = 0
): Uint8Array {
  const out = new Uint8Array(to.stitches * to.rows);
  if (fill !== 0) out.fill(fill);
  // Only iterate the overlapping band rather than the whole new grid.
  const startRow = Math.max(0, dy);
  const endRow = Math.min(to.rows, from.rows + dy);
  const startCol = Math.max(0, dx);
  const endCol = Math.min(to.stitches, from.stitches + dx);
  for (let r = startRow; r < endRow; r++) {
    const srcRow = r - dy;
    for (let c = startCol; c < endCol; c++) {
      out[r * to.stitches + c] = grid[srcRow * from.stitches + (c - dx)];
    }
  }
  return out;
}

/** Offset that places `from` inside `to` according to the anchor. */
export function anchorOffset(from: GridSize, to: GridSize, anchor: Anchor): { dx: number; dy: number } {
  const spareX = to.stitches - from.stitches;
  const spareY = to.rows - from.rows;
  const dx = anchor.h === 'left' ? 0 : anchor.h === 'right' ? spareX : Math.floor(spareX / 2);
  const dy = anchor.v === 'top' ? 0 : anchor.v === 'bottom' ? spareY : Math.floor(spareY / 2);
  return { dx, dy };
}

/** Resize to an absolute size, keeping content positioned by the anchor. */
export function resizeGrid(
  grid: Uint8Array,
  from: GridSize,
  to: GridSize,
  anchor: Anchor = DEFAULT_ANCHOR,
  fill = 0
): Uint8Array {
  const { dx, dy } = anchorOffset(from, to, anchor);
  return offsetGrid(grid, from, to, dx, dy, fill);
}

export interface Edges {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Grow or shrink by a number of stitches/rows on each edge. Positive adds,
 * negative removes. Returns the new grid and its size.
 */
export function resizeByEdges(
  grid: Uint8Array,
  from: GridSize,
  edges: Partial<Edges>,
  fill = 0
): { grid: Uint8Array; size: GridSize } {
  const top = edges.top ?? 0;
  const bottom = edges.bottom ?? 0;
  const left = edges.left ?? 0;
  const right = edges.right ?? 0;
  const size: GridSize = {
    stitches: from.stitches + left + right,
    rows: from.rows + top + bottom,
  };
  if (size.stitches < 1 || size.rows < 1) {
    throw new Error('A chart must keep at least one stitch and one row');
  }
  // Adding to the top/left pushes existing content down/right by that much.
  return { grid: offsetGrid(grid, from, size, left, top, fill), size };
}

/**
 * Tightest rectangle containing everything that isn't the background color,
 * or null when the chart is entirely background.
 */
export function contentBounds(grid: Uint8Array, size: GridSize, bg = 0): Region | null {
  let minRow = size.rows;
  let maxRow = -1;
  let minCol = size.stitches;
  let maxCol = -1;
  for (let r = 0; r < size.rows; r++) {
    for (let c = 0; c < size.stitches; c++) {
      if (grid[r * size.stitches + c] === bg) continue;
      if (r < minRow) minRow = r;
      if (r > maxRow) maxRow = r;
      if (c < minCol) minCol = c;
      if (c > maxCol) maxCol = c;
    }
  }
  if (maxRow < 0) return null;
  return { row: minRow, col: minCol, w: maxCol - minCol + 1, h: maxRow - minRow + 1 };
}

// --- regions --------------------------------------------------------------

/** Clamp a region to the chart, returning null if it falls entirely outside. */
export function clampRegion(region: Region, size: GridSize): Region | null {
  const r0 = Math.max(0, region.row);
  const c0 = Math.max(0, region.col);
  const r1 = Math.min(size.rows, region.row + region.h);
  const c1 = Math.min(size.stitches, region.col + region.w);
  if (r1 <= r0 || c1 <= c0) return null;
  return { row: r0, col: c0, w: c1 - c0, h: r1 - r0 };
}

/** Build a region from two corner cells, inclusive of both. */
export function regionFromCorners(
  a: { row: number; col: number },
  b: { row: number; col: number }
): Region {
  const row = Math.min(a.row, b.row);
  const col = Math.min(a.col, b.col);
  return {
    row,
    col,
    w: Math.abs(a.col - b.col) + 1,
    h: Math.abs(a.row - b.row) + 1,
  };
}

export function regionContains(region: Region, row: number, col: number): boolean {
  return (
    row >= region.row && row < region.row + region.h && col >= region.col && col < region.col + region.w
  );
}

/** Copy a region's stitches out of the grid. */
export function extractRegion(grid: Uint8Array, size: GridSize, region: Region): RegionData {
  const clamped = clampRegion(region, size);
  if (!clamped) return { w: 0, h: 0, cells: new Uint8Array(0) };
  const cells = new Uint8Array(clamped.w * clamped.h);
  for (let r = 0; r < clamped.h; r++) {
    for (let c = 0; c < clamped.w; c++) {
      cells[r * clamped.w + c] = grid[(clamped.row + r) * size.stitches + (clamped.col + c)];
    }
  }
  return { w: clamped.w, h: clamped.h, cells };
}

/**
 * Cell changes that would stamp `data` down with its top-left at (row, col).
 * Anything past an edge is clipped away rather than wrapping.
 *
 * Pass `transparent` to leave stitches of that colour out of the result, so
 * whatever is already on the chart shows through — "paste on top" rather than
 * "paste over". Leaving it undefined replaces every stitch, which is what
 * moving and mirroring a region want.
 */
export function placeRegion(
  data: RegionData,
  size: GridSize,
  row: number,
  col: number,
  transparent?: number
): CellChange[] {
  const out: CellChange[] = [];
  for (let r = 0; r < data.h; r++) {
    const gr = row + r;
    if (gr < 0 || gr >= size.rows) continue;
    for (let c = 0; c < data.w; c++) {
      const gc = col + c;
      if (gc < 0 || gc >= size.stitches) continue;
      const color = data.cells[r * data.w + c];
      if (transparent !== undefined && color === transparent) continue;
      out.push({ i: gr * size.stitches + gc, color });
    }
  }
  return out;
}

/**
 * Cell changes that move a region to a new position: the source is cleared to
 * `bg`, then the copy is stamped down. Overlapping source and destination is
 * handled by letting the stamped copy win, and each cell appears only once.
 */
export function moveRegionCells(
  grid: Uint8Array,
  size: GridSize,
  region: Region,
  toRow: number,
  toCol: number,
  bg = 0
): CellChange[] {
  const clamped = clampRegion(region, size);
  if (!clamped) return [];
  const data = extractRegion(grid, size, clamped);
  const byIndex = new Map<number, number>();
  // clear the source first...
  for (let r = 0; r < clamped.h; r++) {
    for (let c = 0; c < clamped.w; c++) {
      byIndex.set((clamped.row + r) * size.stitches + (clamped.col + c), bg);
    }
  }
  // ...then let the destination overwrite it where they overlap
  for (const change of placeRegion(data, size, toRow, toCol)) {
    byIndex.set(change.i, change.color);
  }
  return [...byIndex].map(([i, color]) => ({ i, color }));
}

/** Cell changes that set every stitch in a region to one color. */
export function fillRegionCells(region: Region, size: GridSize, color: number): CellChange[] {
  const clamped = clampRegion(region, size);
  if (!clamped) return [];
  const out: CellChange[] = [];
  for (let r = 0; r < clamped.h; r++) {
    for (let c = 0; c < clamped.w; c++) {
      out.push({ i: (clamped.row + r) * size.stitches + (clamped.col + c), color });
    }
  }
  return out;
}

// --- mirroring ------------------------------------------------------------

/** Mirror left-to-right. */
export function mirrorRegionH(data: RegionData): RegionData {
  const cells = new Uint8Array(data.cells.length);
  for (let r = 0; r < data.h; r++) {
    for (let c = 0; c < data.w; c++) {
      cells[r * data.w + c] = data.cells[r * data.w + (data.w - 1 - c)];
    }
  }
  return { w: data.w, h: data.h, cells };
}

/** Mirror top-to-bottom. */
export function mirrorRegionV(data: RegionData): RegionData {
  const cells = new Uint8Array(data.cells.length);
  for (let r = 0; r < data.h; r++) {
    for (let c = 0; c < data.w; c++) {
      cells[r * data.w + c] = data.cells[(data.h - 1 - r) * data.w + c];
    }
  }
  return { w: data.w, h: data.h, cells };
}

export function rotateRegion180(data: RegionData): RegionData {
  return mirrorRegionV(mirrorRegionH(data));
}

/** Number of quarter turns clockwise. */
export type QuarterTurns = 0 | 1 | 2 | 3;

/**
 * Rotate by quarter turns clockwise. Only right angles are offered: any other
 * angle would have to resample the grid, and half a stitch does not exist — the
 * edges come out ragged and the chart stops being knittable.
 */
export function rotateRegion90(data: RegionData, turns: QuarterTurns): RegionData {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return { w: data.w, h: data.h, cells: Uint8Array.from(data.cells) };
  if (t === 2) return rotateRegion180(data);
  const w = data.h;
  const h = data.w;
  const cells = new Uint8Array(data.cells.length);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      // clockwise: destination (r, c) comes from source (h - 1 - c, r)
      const [sr, sc] = t === 1 ? [data.h - 1 - c, r] : [c, data.w - 1 - r];
      cells[r * w + c] = data.cells[sr * data.w + sc];
    }
  }
  return { w, h, cells };
}

/** Where a rotated region lands: same centre, clamped so it starts on the chart. */
export function rotatedPlacement(
  region: Region,
  size: GridSize,
  turns: QuarterTurns
): { row: number; col: number; w: number; h: number } {
  const swapped = turns % 2 !== 0;
  const w = swapped ? region.h : region.w;
  const h = swapped ? region.w : region.h;
  const row = Math.round(region.row + region.h / 2 - h / 2);
  const col = Math.round(region.col + region.w / 2 - w / 2);
  return {
    row: Math.max(0, Math.min(row, Math.max(0, size.rows - h))),
    col: Math.max(0, Math.min(col, Math.max(0, size.stitches - w))),
    w,
    h,
  };
}

/**
 * Cell changes that rotate a region in place: the old footprint is cleared to
 * `bg`, then the turned copy is stamped down centred on the same point. Follows
 * `moveRegionCells` — overlap lets the stamped copy win, and each cell appears
 * only once.
 */
export function rotateRegionCells(
  grid: Uint8Array,
  size: GridSize,
  region: Region,
  turns: QuarterTurns,
  bg = 0
): CellChange[] {
  const clamped = clampRegion(region, size);
  if (!clamped || turns % 4 === 0) return [];
  const rotated = rotateRegion90(extractRegion(grid, size, clamped), turns);
  const at = rotatedPlacement(clamped, size, turns);
  const byIndex = new Map<number, number>();
  for (let r = 0; r < clamped.h; r++) {
    for (let c = 0; c < clamped.w; c++) {
      byIndex.set((clamped.row + r) * size.stitches + (clamped.col + c), bg);
    }
  }
  for (const change of placeRegion(rotated, size, at.row, at.col)) {
    byIndex.set(change.i, change.color);
  }
  return [...byIndex].map(([i, color]) => ({ i, color }));
}

export type MirrorAxis = 'none' | 'vertical' | 'horizontal' | 'both';

/**
 * Expand painted cells to include their mirror images across the chart's
 * centre lines. A 'vertical' axis mirrors left-to-right, which is the usual
 * choice for symmetric colorwork motifs. Indices are deduplicated so a stroke
 * crossing the axis doesn't paint the same stitch twice.
 */
export function mirrorCellIndices(
  indices: Iterable<number>,
  size: GridSize,
  axis: MirrorAxis
): number[] {
  if (axis === 'none') return [...indices];
  const out = new Set<number>();
  for (const i of indices) {
    const row = Math.floor(i / size.stitches);
    const col = i % size.stitches;
    const mCol = size.stitches - 1 - col;
    const mRow = size.rows - 1 - row;
    out.add(i);
    if (axis === 'vertical' || axis === 'both') out.add(row * size.stitches + mCol);
    if (axis === 'horizontal' || axis === 'both') out.add(mRow * size.stitches + col);
    if (axis === 'both') out.add(mRow * size.stitches + mCol);
  }
  return [...out];
}
