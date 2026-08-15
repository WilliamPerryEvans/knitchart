import { create } from 'zustand';
import type { Chart, Direction, FloatWarning, Gauge, PaletteColor } from '../model/types';
import { createChart } from '../model/types';
import { checkChartFloats, updateChartFloats } from '../domain/floats';

export type Tool = 'pencil' | 'fill' | 'eyedropper' | 'rect' | 'line';

/** One cell edit: flat grid index, palette index before/after. */
export interface CellDiff {
  i: number;
  before: number;
  after: number;
}

interface Command {
  label: string;
  diffs: CellDiff[];
}

const MAX_HISTORY = 200;

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
  filePath: string | null;
  dirty: boolean;

  tool: Tool;
  activeColor: number;
  squareMode: boolean;
  floatWarnings: FloatWarning[];
  /** Draw the red float markers on the chart. The panel still lists them. */
  showFloatHighlight: boolean;

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

  // --- painting (stroke-coalesced) ---
  beginStroke: () => void;
  paintCell: (i: number, color: number) => void;
  paintCells: (cells: Array<{ i: number; color: number }>) => void;
  endStroke: (label: string) => void;

  /** One-shot grid command (fill, color swap): applies + pushes one undo step. */
  applyCells: (label: string, cells: Array<{ i: number; color: number }>) => void;

  undo: () => void;
  redo: () => void;

  // --- palette ---
  addColor: (hex: string, name?: string) => void;
  updateColor: (id: number, patch: Partial<Pick<PaletteColor, 'hex' | 'name'>>) => void;
  /** Repaint every cell of color `from` with color `to` (undoable). */
  swapColor: (from: number, to: number) => void;
}

function recompute(chart: Chart): FloatWarning[] {
  return checkChartFloats(chart);
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
  filePath: null,
  dirty: false,

  tool: 'pencil',
  activeColor: 1,
  squareMode: false,
  floatWarnings: [],
  showFloatHighlight: true,

  undoStack: [],
  redoStack: [],
  pendingStroke: null,

  newChart: (opts) => {
    const chart = createChart(opts);
    set({
      chart,
      gridVersion: get().gridVersion + 1,
      dirtyCells: null,
      filePath: null,
      dirty: false,
      floatWarnings: recompute(chart),
      undoStack: [],
      redoStack: [],
      pendingStroke: null,
      activeColor: 1,
    });
  },

  loadChart: (chart, filePath) => {
    set({
      chart,
      gridVersion: get().gridVersion + 1,
      dirtyCells: null,
      filePath,
      dirty: false,
      floatWarnings: recompute(chart),
      undoStack: [],
      redoStack: [],
      pendingStroke: null,
      activeColor: Math.min(1, chart.palette.length - 1),
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
      set({ gridVersion: get().gridVersion + 1, dirtyCells: touched, dirty: true });
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
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), { label, diffs }],
      redoStack: [],
      floatWarnings: recomputeTouched(
        chart,
        floatWarnings,
        diffs.map((d) => d.i)
      ),
    });
  },

  applyCells: (label, cells) => {
    const { chart, undoStack, floatWarnings } = get();
    const diffs: CellDiff[] = [];
    for (const { i, color } of cells) {
      const before = chart.grid[i];
      if (before === color) continue;
      diffs.push({ i, before, after: color });
      chart.grid[i] = color;
    }
    if (diffs.length === 0) return;
    set({
      gridVersion: get().gridVersion + 1,
      dirtyCells: diffs.map((d) => d.i),
      dirty: true,
      undoStack: [...undoStack.slice(-(MAX_HISTORY - 1)), { label, diffs }],
      redoStack: [],
      floatWarnings: recomputeTouched(
        chart,
        floatWarnings,
        diffs.map((d) => d.i)
      ),
    });
  },

  undo: () => {
    const { undoStack, redoStack, chart, floatWarnings } = get();
    const cmd = undoStack[undoStack.length - 1];
    if (!cmd) return;
    for (const d of cmd.diffs) chart.grid[d.i] = d.before;
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, cmd],
      gridVersion: get().gridVersion + 1,
      dirtyCells: cmd.diffs.map((d) => d.i),
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
    for (const d of cmd.diffs) chart.grid[d.i] = d.after;
    set({
      undoStack: [...undoStack, cmd],
      redoStack: redoStack.slice(0, -1),
      gridVersion: get().gridVersion + 1,
      dirtyCells: cmd.diffs.map((d) => d.i),
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
}));

// Dev-only handle so the browser smoke test can drive and inspect the editor.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __knitStore: typeof useStore }).__knitStore = useStore;
}
