import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';

const gauge = { stsPer4in: 20, rowsPer4in: 26, unit: 'in' as const };

function freshChart(stitches = 10, rows = 6, direction: 'flat' | 'round' = 'flat') {
  useStore.getState().newChart({
    title: 'test',
    stitches,
    rows,
    gauge,
    direction,
  });
}

describe('paint strokes', () => {
  beforeEach(() => freshChart());

  it('coalesces a drag into a single undo step', () => {
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1);
    s.paintCell(1, 1);
    s.paintCell(2, 1);
    s.endStroke('Pencil');

    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().undoStack[0].diffs).toHaveLength(3);
    expect(Array.from(useStore.getState().chart.grid.slice(0, 4))).toEqual([1, 1, 1, 0]);

    useStore.getState().undo();
    expect(Array.from(useStore.getState().chart.grid.slice(0, 4))).toEqual([0, 0, 0, 0]);
    useStore.getState().redo();
    expect(Array.from(useStore.getState().chart.grid.slice(0, 4))).toEqual([1, 1, 1, 0]);
  });

  it('keeps the original "before" when a cell is repainted within one stroke', () => {
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(5, 1);
    s.paintCell(5, 1); // same color, no-op
    s.endStroke('Pencil');
    const cmd = useStore.getState().undoStack[0];
    expect(cmd.diffs).toEqual([{ i: 5, before: 0, after: 1 }]);

    // second stroke paints the same cell a different color
    const s2 = useStore.getState();
    s2.beginStroke();
    s2.paintCell(5, 0);
    s2.endStroke('Pencil');
    expect(useStore.getState().undoStack).toHaveLength(2);
    useStore.getState().undo();
    expect(useStore.getState().chart.grid[5]).toBe(1);
  });

  it('pushes no undo step when a stroke changes nothing', () => {
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 0); // already color 0
    s.endStroke('Pencil');
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('clears the redo stack on a new edit', () => {
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1);
    s.endStroke('Pencil');
    useStore.getState().undo();
    expect(useStore.getState().redoStack).toHaveLength(1);

    const s2 = useStore.getState();
    s2.beginStroke();
    s2.paintCell(3, 1);
    s2.endStroke('Pencil');
    expect(useStore.getState().redoStack).toHaveLength(0);
  });
});

describe('float warnings update with edits', () => {
  it('appears after painting a long run and clears on undo', () => {
    freshChart(12, 3);
    const s = useStore.getState();
    s.beginStroke();
    for (let c = 0; c < 7; c++) s.paintCell(c, 1); // 7-stitch run of CC1 in row 0
    s.endStroke('Pencil');

    const warnings = useStore.getState().floatWarnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ row: 0, start: 0, len: 7, color: 1 });

    useStore.getState().undo();
    expect(useStore.getState().floatWarnings).toHaveLength(0);
  });

  it('recomputes when the threshold changes', () => {
    // 8 wide: row 0 becomes [1,1,1,1,0,0,0,0] — two runs of 4.
    freshChart(8, 3);
    const s = useStore.getState();
    s.beginStroke();
    for (let c = 0; c < 4; c++) s.paintCell(c, 1);
    s.endStroke('Pencil');
    expect(useStore.getState().floatWarnings).toHaveLength(0);

    useStore.getState().setFloatThreshold(3);
    expect(useStore.getState().floatWarnings).toHaveLength(2);
  });

  it('recomputes when direction switches to in-the-round', () => {
    freshChart(8, 1);
    const s = useStore.getState();
    s.beginStroke();
    // 1s in the middle; 0s wrap the boundary as a 6-run
    s.paintCell(3, 1);
    s.paintCell(4, 1);
    s.endStroke('Pencil');
    expect(useStore.getState().floatWarnings).toHaveLength(0);

    useStore.getState().setDirection('round');
    const w = useStore.getState().floatWarnings;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ len: 6, wraps: true });
  });
});

describe('palette', () => {
  it('swaps one color for another across the whole chart in one undo step', () => {
    freshChart(4, 2);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1);
    s.paintCell(5, 1);
    s.endStroke('Pencil');

    useStore.getState().swapColor(1, 0);
    expect(Array.from(useStore.getState().chart.grid)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(useStore.getState().undoStack).toHaveLength(2);

    useStore.getState().undo();
    expect(useStore.getState().chart.grid[0]).toBe(1);
    expect(useStore.getState().chart.grid[5]).toBe(1);
  });

  it('adds colors with sequential CC names', () => {
    freshChart();
    useStore.getState().addColor('#c92a2a');
    const p = useStore.getState().chart.palette;
    expect(p).toHaveLength(3);
    expect(p[2]).toMatchObject({ id: 2, hex: '#c92a2a', name: 'CC2' });
  });
});
