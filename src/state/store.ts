import { create } from 'zustand';
import type { Chart, Direction, FloatWarning, Gauge, PaletteColor } from '../model/types';
import { createChart } from '../model/types';
import { checkChartFloats, updateChartFloats } from '../domain/floats';
import {
  DEFAULT_ANCHOR,
  clampRegion,
  contentBounds,
  extractRegion,
  fillRegionCells,
  mirrorRegionH,
  mirrorRegionV,
  moveRegionCells,
  placeRegion,
  resizeByEdges as resizeGridByEdges,
  resizeGrid,
  rotateRegionCells,
  rotatedPlacement,
  type Anchor,
  type Edges,
  type MirrorAxis,
  type QuarterTurns,
  type Region,
  type RegionData,
} from '../domain/region';

/**
 * How a paste lands. 'replace' overwrites everything under the clipboard;
 * 'over' lets stitches of the background colour show what was already there.
 */
export type PasteMode = 'replace' | 'over';

/** The palette slot treated as see-through when pasting on top. */
export const BACKGROUND_INDEX = 0;

export type Tool = 'pencil' | 'fill' | 'eyedropper' | 'rect' | 'line' | 'select';

/** One cell edit: flat grid index, palette index before/after. */
export interface CellDiff {
  i: number;
  before: number;
  after: number;
}

/** Everything a structural edit has to be able to put back. */
export interface Snapshot {
  grid: Uint8Array;
  stitches: number;
  rows: number;
  palette: PaletteColor[];
}

/**
 * Undo steps come in two shapes. Painting records per-cell diffs, which is why
 * a 300x300 drag costs a few bytes instead of a 90 KB snapshot. Resizing and
 * palette delete/reorder change the grid's shape or the meaning of its indices,
 * which diffs cannot express, so those snapshot instead — affordable because
 * structural edits are rare.
 */
export type Command =
  | { kind: 'cells'; label: string; diffs: CellDiff[] }
  | { kind: 'structure'; label: string; before: Snapshot; after: Snapshot };

const MAX_HISTORY = 200;

function snapshot(chart: Chart): Snapshot {
  return {
    grid: Uint8Array.from(chart.grid),
    stitches: chart.stitches,
    rows: chart.rows,
    palette: chart.palette.map((c) => ({ ...c })),
  };
}

interface EditorState {
  chart: Chart;
  /** Bumped on every grid mutation so canvas + panels know to refresh. */
  gridVersion: number;
  /**
   * Flat cell indices touched by the most recent mutation, so the canvas can
   * repaint just those. `null` means "everything changed" (new/loaded chart,
   * palette edit) and forces a full raster rebuild.
   */
  dirtyCells: number[] | null;
  /**
   * Bumped only when a different chart is loaded or created. The canvas fits
   * the view on change, so resizing must NOT bump it — otherwise the view would
   * jump on every click of a resize stepper.
   */
  chartEpoch: number;
  filePath: string | null;
  dirty: boolean;

  tool: Tool;
  activeColor: number;
  squareMode: boolean;
  floatWarnings: FloatWarning[];
  /** Draw the red float markers on the chart. The panel still lists them. */
  showFloatHighlight: boolean;

  /** Marquee selection, or null when nothing is selected. */
  selection: Region | null;
  /** App-internal copy buffer (not the OS clipboard). */
  clipboard: RegionData | null;
  /** Sticky choice, so Ctrl+V keeps doing whatever you picked last. */
  pasteMode: PasteMode;
  /** Live-mirror painted stitches across the chart's centre lines. */
  mirrorAxis: MirrorAxis;

  undoStack: Command[];
  redoStack: Command[];
  /** Pending diffs for the stroke in progress, keyed by grid index. */
  pendingStroke: Map<number, CellDiff> | null;

  // --- chart lifecycle ---
  newChart: (opts: {
    title: string;
    stitches: number;
    rows: number;
    gauge: Gauge;
    direction: Direction;
  }) => void;
  loadChart: (chart: Chart, filePath: string | null) => void;
  setFilePath: (path: string | null) => void;
  markSaved: () => void;
  setTitle: (title: string) => void;
  setGauge: (gauge: Gauge) => void;
  setDirection: (direction: Direction) => void;
  setFloatThreshold: (threshold: number) => void;

  // --- tools ---
  setTool: (tool: Tool) => void;
  setActiveColor: (index: number) => void;
  setSquareMode: (on: boolean) => void;
  setShowFloatHighlight: (on: boolean) => void;
  setMirrorAxis: (axis: MirrorAxis) => void;

  // --- chart size ---
  /** Grow/shrink by stitches per edge; negative removes. One undo step. */
  resizeByEdges: (edges: Partial<Edges>) => void;
  /** Resize to an absolute size, positioning existing stitches by the anchor. */
  resizeTo: (stitches: number, rows: number, anchor?: Anchor) => void;
  /** Trim background from every edge. No-op on an empty chart. */
  cropToContent: () => void;

  // --- selection ---
  setSelection: (region: Region | null) => void;
  moveSelection: (toRow: number, toCol: number) => void;
  copySelection: () => void;
  setPasteMode: (mode: PasteMode) => void;
  pasteClipboard: (row?: number, col?: number, mode?: PasteMode) => void;
  mirrorSelection: (axis: 'horizontal' | 'vertical') => void;
  /** Turn the selection clockwise by quarter turns. Right angles only. */
  rotateSelection: (turns: QuarterTurns) => void;
  fillSelection: (color: number) => void;
  clearSelection: () => void;

  // --- painting (stroke-coalesced) ---
  beginStroke: () => void;
  paintCell: (i: number, color: number) => void;
  paintCells: (cells: Array<{ i: number; color: number }>) => void;
  endStroke: (label: string) => void;
  /**
   * Abandon the stroke in progress, putting every stitch back as it was and
   * recording nothing on the undo stack. Used when a second finger lands: the
   * first one has already drawn a short line by then, and that line was the
   * start of a pinch, not a mark the knitter wanted.
   */
  cancelStroke: () => void;

  /** One-shot grid command (fill, color swap): applies + pushes one undo step. */
  applyCells: (label: string, cells: Array<{ i: number; color: number }>) => void;

  /**
   * Replace the grid, and optionally its dimensions and palette, as one
   * structural undo step. Used by resize and palette delete/reorder.
   */
  applyStructure: (
    label: string,
    next: { grid: Uint8Array; stitches?: number; rows?: number; palette?: PaletteColor[] }
  ) => void;

  /**
   * Swap in a whole new grid of the same size as one undo step. The pattern
   * generators rewrite most of the chart at once, so a snapshot is cheaper than
   * up to 90,000 cell diffs. The selection survives because the size hasn't
   * changed — you may well want to mirror what you just generated.
   */
  replaceGrid: (label: string, grid: Uint8Array) => void;

  undo: () => void;
  redo: () => void;

  // --- palette ---
  addColor: (hex: string, name?: string) => void;
  updateColor: (id: number, patch: Partial<Pick<PaletteColor, 'hex' | 'name'>>) => void;
  /** Repaint every cell of color `from` with color `to` (undoable). */
  swapColor: (from: number, to: number) => void;
  /**
   * Remove a color, repainting its stitches as `replaceWith` and renumbering
   * every higher index down by one. Palette and grid change together in one
   * undo step — separating them would silently recolor the chart.
   */
  deleteColor: (id: number, replaceWith?: number) => void;
  /** Move a color to a new position, remapping every cell through the new order. */
  reorderColor: (from: number, to: number) => void;
}

function recompute(chart: Chart): FloatWarning[] {
  return checkChartFloats(chart);
}

/**
 * Add cells to the pending repaint list rather than replacing it.
 *
 * React can coalesce several grid mutations into one render, and the canvas
 * reads `dirtyCells` once per render — so overwriting the list drops the
 * earlier edits' repaints and leaves stitches stale on screen until something
 * forces a full rebuild. `null` means "repaint everything", which already
 * covers whatever is being added.
 */
function addDirty(previous: number[] | null, cells: number[]): number[] | null {
  if (previous === null) return null;
  return previous.length === 0 ? cells : [...previous, ...cells];
}

/**
 * Put a snapshot back. Returns the state patch for undo/redo to spread, with a
 * fresh copy of the grid so the stored snapshot can't be mutated by later edits.
 */
function restoreSnapshot(chart: Chart, snap: Snapshot) {
  const restored: Chart = {
    ...chart,
    grid: Uint8Array.from(snap.grid),
    stitches: snap.stitches,
    rows: snap.rows,
    palette: snap.palette.map((c) => ({ ...c })),
  };
  return {
    chart: restored,
    dirtyCells: null,
    dirty: true,
    selection: null, // the old selection may not fit the restored size
    floatWarnings: checkChartFloats(restored),
  };
}

/** Re-scan only the rows containing the given cell indices. */
function recomputeTouched(
  chart: Chart,
  previous: FloatWarning[],
  cellIndices: Iterable<number>
): FloatWarning[] {
  const rows = new Set<number>();
  for (const i of cellIndices) rows.add(Math.floor(i / chart.stitches));
  return updateChartFloats(chart, previous, rows);
}

const initialChart = createChart({
  title: 'Untitled chart',
  stitches: 40,
  rows: 40,
  gauge: { stsPer4in: 20, rowsPer4in: 26, unit: 'in' },
  direction: 'flat',
});

export const useStore = create<EditorState>((set, get) => ({
  chart: initialChart,
  gridVersion: 0,
  dirtyCells: null,
  chartEpoch: 0,
  filePath: null,
  dirty: false,

  tool: 'pencil',
  activeColor: 1,
  squareMode: false,
  floatWarnings: [],
  showFloatHighlight: true,

  selection: null,
  clipboard: null,
  pasteMode: 'replace',
  mirrorAxis: 'none',

  undoStack: [],
  redoStack: [],
  pendingStroke: null,

  newChart: (opts) => {
    const chart = createChart(opts);
    set({
      chart,
      gridVersion: get().gridVersion + 1,
      dirtyCells: null,
      chartEpoch: get().chartEpoch + 1,
      filePath: null,
      dirty: false,
      floatWarnings: recompute(chart),
      undoStack: [],
      redoStack: [],
      pendingStroke: null,
      activeColor: 1,
      selection: null,
    });
  },

  loadChart: (chart, filePath) => {
    set({
      chart,
      gridVersion: get().gridVersion + 1,
      dirtyCells: null,
      chartEpoch: get().chartEpoch + 1,
      filePath,
      dirty: false,
      floatWarnings: recompute(chart),
      undoStack: [],
      redoStack: [],
      pendingStroke: null,
      activeColor: Math.min(1, chart.palette.length - 1),
      selection: null,
    });
  },

  setFilePath: (filePath) => set({ filePath }),
  markSaved: () => set({ dirty: false }),
  setTitle: (title) => set({ chart: { ...get().chart, title }, dirty: true }),

  setGauge: (gauge) => set({ chart: { ...get().chart, gauge }, dirty: true }),

  setDirection: (direction) => {
    const chart = { ...get().chart, direction };
    set({ chart, dirty: true, floatWarnings: recompute(chart) });
  },

  setFloatThreshold: (floatThreshold) => {
    const chart = { ...get().chart, floatThreshold };
    set({ chart, dirty: true, floatWarnings: recompute(chart) });
  },

  setTool: (tool) => set({ tool }),
  setActiveColor: (activeColor) => set({ activeColor }),
  setSquareMode: (squareMode) => set({ squareMode }),
  setShowFloatHighlight: (showFloatHighlight) => set({ showFloatHighlight }),
  setMirrorAxis: (mirrorAxis) => set({ mirrorAxis }),

  // --- chart size ---

  resizeByEdges: (edges) => {
    const { chart } = get();
    const size = { stitches: chart.stitches, rows: chart.rows };
    let next;
    try {
      next = resizeGridByEdges(chart.grid, size, edges);
    } catch {
      return; // would leave nothing to knit
    }
    if (next.size.stitches === chart.stitches && next.size.rows === chart.rows) return;
    get().applyStructure('Resize chart', {
      grid: next.grid,
      stitches: next.size.stitches,
      rows: next.size.rows,
    });
  },

  resizeTo: (stitches, rows, anchor = DEFAULT_ANCHOR) => {
    const { chart } = get();
    if (stitches < 1 || rows < 1) return;
    if (stitches === chart.stitches && rows === chart.rows) return;
    const from = { stitches: chart.stitches, rows: chart.rows };
    const grid = resizeGrid(chart.grid, from, { stitches, rows }, anchor);
    get().applyStructure('Resize chart', { grid, stitches, rows });
  },

  cropToContent: () => {
    const { chart } = get();
    const size = { stitches: chart.stitches, rows: chart.rows };
    const bounds = contentBounds(chart.grid, size);
    if (!bounds) return; // nothing but background
    if (bounds.w === chart.stitches && bounds.h === chart.rows) return;
    const next = resizeGridByEdges(chart.grid, size, {
      top: -bounds.row,
      left: -bounds.col,
      bottom: -(chart.rows - (bounds.row + bounds.h)),
      right: -(chart.stitches - (bounds.col + bounds.w)),
    });
    get().applyStructure('Crop to content', {
      grid: next.grid,
      stitches: next.size.stitches,
      rows: next.size.rows,
    });
  },

  // --- selection ---

  setSelection: (region) => {
    const { chart } = get();
    set({
      selection: region
        ? clampRegion(region, { stitches: chart.stitches, rows: chart.rows })
        : null,
    });
  },

  clearSelection: () => set({ selection: null }),

  moveSelection: (toRow, toCol) => {
    const { chart, selection } = get();
    if (!selection) return;
    const size = { stitches: chart.stitches, rows: chart.rows };
    const cells = moveRegionCells(chart.grid, size, selection, toRow, toCol);
    if (cells.length === 0) return;
    get().applyCells('Move selection', cells);
    set({ selection: clampRegion({ ...selection, row: toRow, col: toCol }, size) });
  },

  copySelection: () => {
    const { chart, selection } = get();
    if (!selection) return;
    set({
      clipboard: extractRegion(chart.grid, { stitches: chart.stitches, rows: chart.rows }, selection),
    });
  },

  setPasteMode: (pasteMode) => set({ pasteMode }),

  pasteClipboard: (row, col, mode) => {
    const { chart, clipboard, selection, pasteMode } = get();
    if (!clipboard || clipboard.w === 0) return;
    const size = { stitches: chart.stitches, rows: chart.rows };
    // Default to the current selection's corner, else the top-left.
    const r = row ?? selection?.row ?? 0;
    const c = col ?? selection?.col ?? 0;
    const how = mode ?? pasteMode;
    const cells = placeRegion(
      clipboard,
      size,
      r,
      c,
      how === 'over' ? BACKGROUND_INDEX : undefined
    );
    if (cells.length === 0) return;
    get().applyCells(how === 'over' ? 'Paste on top' : 'Paste', cells);
    set({ selection: clampRegion({ row: r, col: c, w: clipboard.w, h: clipboard.h }, size) });
  },

  mirrorSelection: (axis) => {
    const { chart, selection } = get();
    if (!selection) return;
    const size = { stitches: chart.stitches, rows: chart.rows };
    const data = extractRegion(chart.grid, size, selection);
    if (data.w === 0) return;
    const flipped = axis === 'horizontal' ? mirrorRegionH(data) : mirrorRegionV(data);
    get().applyCells(
      axis === 'horizontal' ? 'Mirror selection ↔' : 'Mirror selection ↕',
      placeRegion(flipped, size, selection.row, selection.col)
    );
  },

  rotateSelection: (turns) => {
    const { chart, selection } = get();
    if (!selection || turns % 4 === 0) return;
    const size = { stitches: chart.stitches, rows: chart.rows };
    const cells = rotateRegionCells(chart.grid, size, selection, turns);
    if (cells.length === 0) return;
    get().applyCells(turns === 2 ? 'Rotate 180°' : 'Rotate 90°', cells);
    const at = rotatedPlacement(selection, size, turns);
    set({ selection: clampRegion(at, size) });
  },

  fillSelection: (color) => {
    const { chart, selection } = get();
    if (!selection) return;
    const cells = fillRegionCells(selection, { stitches: chart.stitches, rows: chart.rows }, color);
    if (cells.length > 0) get().applyCells('Fill selection', cells);
  },

  beginStroke: () => set({ pendingStroke: new Map() }),

  paintCell: (i, color) => get().paintCells([{ i, color }]),

  paintCells: (cells) => {
    const { chart, pendingStroke } = get();
    if (!pendingStroke) return;
    const touched: number[] = [];
    for (const { i, color } of cells) {
      const before = chart.grid[i];
      if (before === color) continue;
      const existing = pendingStroke.get(i);
      if (existing) {
        // Keep the stroke's original `before` so one undo reverts the whole drag.
        existing.after = color;
      } else {
        pendingStroke.set(i, { i, before, after: color });
      }
      chart.grid[i] = color;
      touched.push(i);
    }
    if (touched.length > 0) {
      set({
        gridVersion: get().gridVersion + 1,
        dirtyCells: addDirty(get().dirtyCells, touched),
        dirty: true,
      });
    }
  },

  endStroke: (label) => {
    const { pendingStroke, undoStack, chart, floatWarnings } = get();
    if (!pendingStroke) return;
    const diffs = [...pendingStroke.values()].filter((d) => d.before !== d.after);
    if (diffs.length === 0) {
      set({ pendingStroke: null });
      return;
    }
    set({
      pendingStroke: null,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), { kind: 'cells', label, diffs }],
      redoStack: [],
      floatWarnings: recomputeTouched(
        chart,
        floatWarnings,
        diffs.map((d) => d.i)
      ),
    });
  },

  cancelStroke: () => {
    const { pendingStroke, chart, floatWarnings } = get();
    if (!pendingStroke) return;
    const diffs = [...pendingStroke.values()];
    if (diffs.length === 0) {
      set({ pendingStroke: null });
      return;
    }
    for (const d of diffs) chart.grid[d.i] = d.before;
    const touched = diffs.map((d) => d.i);
    set({
      pendingStroke: null,
      gridVersion: get().gridVersion + 1,
      dirtyCells: addDirty(get().dirtyCells, touched),
      floatWarnings: recomputeTouched(chart, floatWarnings, touched),
    });
  },

  applyCells: (label, cells) => {
    const { chart, undoStack, floatWarnings } = get();
    // Merge repeats so an index appears at most once: undo replays diffs in
    // order, so two diffs for the same cell would restore the wrong value.
    const merged = new Map<number, CellDiff>();
    for (const { i, color } of cells) {
      const existing = merged.get(i);
      if (existing) {
        existing.after = color;
      } else {
        merged.set(i, { i, before: chart.grid[i], after: color });
      }
    }
    const diffs = [...merged.values()].filter((d) => d.before !== d.after);
    if (diffs.length === 0) return;
    for (const d of diffs) chart.grid[d.i] = d.after;
    set({
      gridVersion: get().gridVersion + 1,
      dirtyCells: addDirty(
        get().dirtyCells,
        diffs.map((d) => d.i)
      ),
      dirty: true,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), { kind: 'cells', label, diffs }],
      redoStack: [],
      floatWarnings: recomputeTouched(
        chart,
        floatWarnings,
        diffs.map((d) => d.i)
      ),
    });
  },

  applyStructure: (label, next) => {
    const { chart, undoStack } = get();
    const before = snapshot(chart);
    const after: Snapshot = {
      grid: next.grid,
      stitches: next.stitches ?? chart.stitches,
      rows: next.rows ?? chart.rows,
      palette: next.palette ?? chart.palette,
    };
    const updated: Chart = { ...chart, ...after };
    set({
      chart: updated,
      gridVersion: get().gridVersion + 1,
      dirtyCells: null, // shape or palette changed: rebuild the whole raster
      dirty: true,
      selection: null,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), { kind: 'structure', label, before, after }],
      redoStack: [],
      floatWarnings: recompute(updated),
    });
  },

  replaceGrid: (label, grid) => {
    const { chart, selection } = get();
    if (grid.length !== chart.grid.length) return;
    get().applyStructure(label, { grid });
    if (selection) set({ selection });
  },

  undo: () => {
    const { undoStack, redoStack, chart, floatWarnings } = get();
    const cmd = undoStack[undoStack.length - 1];
    if (!cmd) return;
    const rest = { undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, cmd] };

    if (cmd.kind === 'structure') {
      set({ ...rest, ...restoreSnapshot(chart, cmd.before), gridVersion: get().gridVersion + 1 });
      return;
    }
    for (const d of cmd.diffs) chart.grid[d.i] = d.before;
    set({
      ...rest,
      gridVersion: get().gridVersion + 1,
      dirtyCells: addDirty(
        get().dirtyCells,
        cmd.diffs.map((d) => d.i)
      ),
      dirty: true,
      floatWarnings: recomputeTouched(
        chart,
        floatWarnings,
        cmd.diffs.map((d) => d.i)
      ),
    });
  },

  redo: () => {
    const { undoStack, redoStack, chart, floatWarnings } = get();
    const cmd = redoStack[redoStack.length - 1];
    if (!cmd) return;
    const rest = { undoStack: [...undoStack, cmd], redoStack: redoStack.slice(0, -1) };

    if (cmd.kind === 'structure') {
      set({ ...rest, ...restoreSnapshot(chart, cmd.after), gridVersion: get().gridVersion + 1 });
      return;
    }
    for (const d of cmd.diffs) chart.grid[d.i] = d.after;
    set({
      ...rest,
      gridVersion: get().gridVersion + 1,
      dirtyCells: addDirty(
        get().dirtyCells,
        cmd.diffs.map((d) => d.i)
      ),
      dirty: true,
      floatWarnings: recomputeTouched(
        chart,
        floatWarnings,
        cmd.diffs.map((d) => d.i)
      ),
    });
  },

  addColor: (hex, name) => {
    const { chart } = get();
    if (chart.palette.length >= 256) return;
    const id = chart.palette.length;
    const palette = [...chart.palette, { id, hex, name: name || `CC${id}` }];
    set({ chart: { ...chart, palette }, dirty: true });
  },

  updateColor: (id, patch) => {
    const { chart } = get();
    const palette = chart.palette.map((c) => (c.id === id ? { ...c, ...patch } : c));
    set({
      chart: { ...chart, palette },
      dirty: true,
      gridVersion: get().gridVersion + 1,
      dirtyCells: null, // a hex change can affect any cell — full repaint
    });
  },

  swapColor: (from, to) => {
    const { chart } = get();
    if (from === to) return;
    const cells: Array<{ i: number; color: number }> = [];
    for (let i = 0; i < chart.grid.length; i++) {
      if (chart.grid[i] === from) cells.push({ i, color: to });
    }
    get().applyCells(`Swap ${from} → ${to}`, cells);
  },

  deleteColor: (id, replaceWith = 0) => {
    const { chart, activeColor } = get();
    if (chart.palette.length <= 1) return; // a chart needs at least one color
    if (id < 0 || id >= chart.palette.length) return;
    // Stitches of the removed color become `replaceWith`; if that is the color
    // being deleted, fall back to the background so nothing dangles.
    const target = replaceWith === id ? 0 : replaceWith;

    const remap = new Uint8Array(chart.palette.length);
    for (let old = 0; old < chart.palette.length; old++) {
      const mapped = old === id ? target : old;
      // every index above the removed one shifts down by one
      remap[old] = mapped > id ? mapped - 1 : mapped;
    }
    const grid = Uint8Array.from(chart.grid, (v) => remap[v] ?? 0);
    const palette = chart.palette
      .filter((_, index) => index !== id)
      .map((c, index) => ({ ...c, id: index }));

    get().applyStructure(`Delete ${chart.palette[id]?.name || `color ${id}`}`, { grid, palette });
    set({ activeColor: Math.min(remap[activeColor] ?? 0, palette.length - 1) });
  },

  reorderColor: (from, to) => {
    const { chart, activeColor } = get();
    const n = chart.palette.length;
    if (from === to || from < 0 || from >= n || to < 0 || to >= n) return;

    const palette = [...chart.palette];
    const [moved] = palette.splice(from, 1);
    palette.splice(to, 0, moved);

    // remap[oldIndex] = position that color now occupies
    const remap = new Uint8Array(n);
    palette.forEach((color, index) => {
      remap[chart.palette.indexOf(color)] = index;
    });
    const grid = Uint8Array.from(chart.grid, (v) => remap[v] ?? 0);

    get().applyStructure(
      'Reorder palette',
      { grid, palette: palette.map((c, index) => ({ ...c, id: index })) }
    );
    set({ activeColor: remap[activeColor] ?? 0 });
  },
}));

// Dev-only handle so the browser smoke test can drive and inspect the editor.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __knitStore: typeof useStore }).__knitStore = useStore;
}
