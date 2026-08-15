import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { mirrorCellIndices } from '../domain/region';

const gauge = { stsPer4in: 20, rowsPer4in: 26, unit: 'in' as const };

/** Narrow an undo entry to a cell command, failing loudly if it isn't one. */
function cellDiffs(index: number) {
  const cmd = useStore.getState().undoStack[index];
  if (!cmd || cmd.kind !== 'cells') {
    throw new Error(`undoStack[${index}] is ${cmd?.kind ?? 'missing'}, expected a cells command`);
  }
  return cmd.diffs;
}

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
    expect(cellDiffs(0)).toHaveLength(3);
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
    expect(cellDiffs(0)).toEqual([{ i: 5, before: 0, after: 1 }]);

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

describe('resize', () => {
  it('adds rows to the top, keeping existing stitches', () => {
    freshChart(4, 2);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1); // top-left
    s.endStroke('Pencil');

    useStore.getState().resizeByEdges({ top: 2 });
    const c = useStore.getState().chart;
    expect(c.rows).toBe(4);
    expect(c.stitches).toBe(4);
    expect(c.grid[0]).toBe(0); // new blank row
    expect(c.grid[2 * 4]).toBe(1); // the painted stitch moved down two rows
  });

  it('restores stitches lost to shrinking when undone', () => {
    freshChart(4, 2);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(3, 1); // top-right, the stitch about to be cut off
    s.endStroke('Pencil');

    useStore.getState().resizeByEdges({ right: -2 });
    expect(useStore.getState().chart.stitches).toBe(2);
    expect([...useStore.getState().chart.grid]).not.toContain(1);

    useStore.getState().undo();
    const c = useStore.getState().chart;
    expect(c.stitches).toBe(4);
    expect(c.grid[3]).toBe(1); // the cut stitch came back
  });

  it('redoes a resize', () => {
    freshChart(4, 4);
    useStore.getState().resizeByEdges({ bottom: 2 });
    useStore.getState().undo();
    expect(useStore.getState().chart.rows).toBe(4);
    useStore.getState().redo();
    expect(useStore.getState().chart.rows).toBe(6);
  });

  it('resizes to an absolute size with an anchor', () => {
    freshChart(2, 2);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1);
    s.endStroke('Pencil');

    useStore.getState().resizeTo(4, 4, { h: 'right', v: 'bottom' });
    const c = useStore.getState().chart;
    expect([c.stitches, c.rows]).toEqual([4, 4]);
    expect(c.grid[2 * 4 + 2]).toBe(1); // pushed to the bottom-right block
  });

  it('refuses to shrink past one stitch', () => {
    freshChart(2, 2);
    useStore.getState().resizeByEdges({ left: -5 });
    expect(useStore.getState().chart.stitches).toBe(2);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('crops away background borders', () => {
    freshChart(6, 6);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(2 * 6 + 2, 1);
    s.paintCell(3 * 6 + 3, 1);
    s.endStroke('Pencil');

    useStore.getState().cropToContent();
    const c = useStore.getState().chart;
    expect([c.stitches, c.rows]).toEqual([2, 2]);
    expect([...c.grid]).toEqual([1, 0, 0, 1]);
  });

  it('leaves an empty chart alone when cropping', () => {
    freshChart(4, 4);
    useStore.getState().cropToContent();
    expect(useStore.getState().chart.stitches).toBe(4);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('does not bump chartEpoch, so the view will not jump', () => {
    freshChart(4, 4);
    const before = useStore.getState().chartEpoch;
    useStore.getState().resizeByEdges({ top: 1, right: 1 });
    expect(useStore.getState().chartEpoch).toBe(before);
  });
});

describe('dirty cell tracking', () => {
  it('accumulates repaints instead of dropping all but the last', () => {
    // The canvas reads dirtyCells once per render, and React can coalesce
    // several edits into one — so replacing the list would leave stitches
    // painted in the store but stale on screen.
    freshChart(8, 8);
    useStore.setState({ dirtyCells: [] });
    const s = useStore.getState();
    s.beginStroke();
    for (let c = 0; c < 6; c++) s.paintCell(c, 1);
    s.endStroke('Pencil');
    expect(useStore.getState().dirtyCells).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps a pending full rebuild rather than narrowing it to a few cells', () => {
    freshChart(8, 8);
    expect(useStore.getState().dirtyCells).toBeNull(); // a new chart repaints all
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1);
    s.endStroke('Pencil');
    expect(useStore.getState().dirtyCells).toBeNull();
  });

  it('carries undo and redo repaints through the same list', () => {
    freshChart(8, 8);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(3, 1);
    s.endStroke('Pencil');
    useStore.setState({ dirtyCells: [] });
    useStore.getState().undo();
    useStore.getState().redo();
    expect(useStore.getState().dirtyCells).toEqual([3, 3]);
  });
});

describe('selection', () => {
  it('moves a region as one undo step, clearing the source', () => {
    freshChart(4, 4);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1);
    s.paintCell(1, 1);
    s.endStroke('Pencil');
    const undoDepth = useStore.getState().undoStack.length;

    useStore.getState().setSelection({ row: 0, col: 0, w: 2, h: 1 });
    useStore.getState().moveSelection(2, 2);

    expect(useStore.getState().undoStack).toHaveLength(undoDepth + 1);
    const c = useStore.getState().chart;
    expect([c.grid[0], c.grid[1]]).toEqual([0, 0]);
    expect([c.grid[2 * 4 + 2], c.grid[2 * 4 + 3]]).toEqual([1, 1]);

    useStore.getState().undo();
    const back = useStore.getState().chart;
    expect([back.grid[0], back.grid[1]]).toEqual([1, 1]);
  });

  it('copies and pastes a region elsewhere', () => {
    freshChart(4, 4);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1);
    s.endStroke('Pencil');

    useStore.getState().setSelection({ row: 0, col: 0, w: 1, h: 1 });
    useStore.getState().copySelection();
    useStore.getState().pasteClipboard(3, 3);

    const c = useStore.getState().chart;
    expect(c.grid[0]).toBe(1); // original still there
    expect(c.grid[3 * 4 + 3]).toBe(1); // and the copy
  });

  it('pastes on top without disturbing what is underneath', () => {
    freshChart(4, 4);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1); // the motif: one stitch, on a background of index 0
    s.paintCell(2 * 4 + 1, 2); // something already on the chart, under the paste
    s.endStroke('Pencil');

    useStore.getState().setSelection({ row: 0, col: 0, w: 2, h: 2 });
    useStore.getState().copySelection();
    useStore.getState().pasteClipboard(2, 0, 'over');

    const c = useStore.getState().chart;
    expect(c.grid[2 * 4 + 0]).toBe(1); // the motif landed
    expect(c.grid[2 * 4 + 1]).toBe(2); // ...and the stitch beneath survived
  });

  it('replaces everything under the clipboard in the default mode', () => {
    freshChart(4, 4);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1);
    s.paintCell(2 * 4 + 1, 2);
    s.endStroke('Pencil');

    useStore.getState().setSelection({ row: 0, col: 0, w: 2, h: 2 });
    useStore.getState().copySelection();
    useStore.getState().pasteClipboard(2, 0, 'replace');

    expect(useStore.getState().chart.grid[2 * 4 + 1]).toBe(0); // wiped to background
  });

  it('follows the sticky paste mode when none is given', () => {
    freshChart(4, 4);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1);
    s.paintCell(2 * 4 + 1, 2);
    s.endStroke('Pencil');

    useStore.getState().setSelection({ row: 0, col: 0, w: 2, h: 2 });
    useStore.getState().copySelection();
    useStore.getState().setPasteMode('over');
    useStore.getState().pasteClipboard(2, 0);

    expect(useStore.getState().chart.grid[2 * 4 + 1]).toBe(2);
  });

  it('rotates a selection as one undo step and follows it with the marquee', () => {
    freshChart(4, 4);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1);
    s.paintCell(1, 1);
    s.paintCell(2, 1); // a 3-stitch horizontal bar along the top
    s.endStroke('Pencil');
    const undoDepth = useStore.getState().undoStack.length;

    useStore.getState().setSelection({ row: 0, col: 0, w: 3, h: 1 });
    useStore.getState().rotateSelection(1);

    expect(useStore.getState().undoStack).toHaveLength(undoDepth + 1);
    const sel = useStore.getState().selection;
    expect({ w: sel?.w, h: sel?.h }).toEqual({ w: 1, h: 3 }); // stood on end
    const c = useStore.getState().chart;
    const painted = [...c.grid].filter((v) => v === 1).length;
    expect(painted).toBe(3); // no stitches lost

    useStore.getState().undo();
    const back = useStore.getState().chart;
    expect([back.grid[0], back.grid[1], back.grid[2]]).toEqual([1, 1, 1]);
  });

  it('ignores a rotate with nothing selected', () => {
    freshChart(4, 4);
    useStore.getState().clearSelection();
    const depth = useStore.getState().undoStack.length;
    useStore.getState().rotateSelection(1);
    expect(useStore.getState().undoStack).toHaveLength(depth);
  });

  it('clips a selection to the chart', () => {
    freshChart(4, 4);
    useStore.getState().setSelection({ row: 2, col: 2, w: 10, h: 10 });
    expect(useStore.getState().selection).toEqual({ row: 2, col: 2, w: 2, h: 2 });
  });

  it('mirrors a selection in place', () => {
    freshChart(4, 2);
    const s = useStore.getState();
    s.beginStroke();
    s.paintCell(0, 1); // row 0, col 0
    s.endStroke('Pencil');

    useStore.getState().setSelection({ row: 0, col: 0, w: 4, h: 1 });
    useStore.getState().mirrorSelection('horizontal');
    const c = useStore.getState().chart;
    expect(c.grid[0]).toBe(0);
    expect(c.grid[3]).toBe(1); // flipped to the far end
  });

  it('drops the selection when a resize changes the chart', () => {
    freshChart(4, 4);
    useStore.getState().setSelection({ row: 0, col: 0, w: 2, h: 2 });
    useStore.getState().resizeByEdges({ top: 1 });
    expect(useStore.getState().selection).toBeNull();
  });
});

describe('mirror painting', () => {
  it('paints the mirrored stitch across the vertical centre', () => {
    freshChart(5, 3);
    useStore.getState().setMirrorAxis('vertical');
    const s = useStore.getState();
    s.beginStroke();
    // store-level paint is unmirrored; the editor expands cells. Verify the
    // expansion helper is wired by mirroring through the same path the UI uses.
    s.paintCells(
      mirrorCellIndices([0], { stitches: 5, rows: 3 }, 'vertical').map((i) => ({ i, color: 1 }))
    );
    s.endStroke('Pencil');

    const c = useStore.getState().chart;
    expect(c.grid[0]).toBe(1);
    expect(c.grid[4]).toBe(1);
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

  /**
   * Palette ids are array indices and cells store them directly, so removing or
   * reordering a color has to renumber the grid too. These are the tests that
   * catch a chart being silently recolored.
   */
  describe('delete', () => {
    function threeColorChart() {
      freshChart(4, 1);
      useStore.getState().addColor('#c92a2a', 'CC2');
      const s = useStore.getState();
      s.beginStroke();
      s.paintCell(0, 0);
      s.paintCell(1, 1);
      s.paintCell(2, 2);
      s.paintCell(3, 2);
      s.endStroke('setup');
    }

    it('repaints the removed color and shifts higher indices down', () => {
      threeColorChart();
      // remove CC1 (index 1); its stitches become MC (0), and CC2 becomes 1
      useStore.getState().deleteColor(1, 0);

      const c = useStore.getState().chart;
      expect(c.palette).toHaveLength(2);
      expect(c.palette.map((p) => p.name)).toEqual(['MC', 'CC2']);
      expect(c.palette.map((p) => p.id)).toEqual([0, 1]);
      expect([...c.grid]).toEqual([0, 0, 1, 1]);
    });

    it('keeps every cell pointing at a real palette entry', () => {
      threeColorChart();
      useStore.getState().deleteColor(0, 1);
      const c = useStore.getState().chart;
      for (const v of c.grid) expect(v).toBeLessThan(c.palette.length);
    });

    it('can remap onto a different surviving color', () => {
      threeColorChart();
      // remove CC1, turning its stitches into CC2 (which becomes index 1)
      useStore.getState().deleteColor(1, 2);
      expect([...useStore.getState().chart.grid]).toEqual([0, 1, 1, 1]);
    });

    it('undoes palette and grid together', () => {
      threeColorChart();
      const before = [...useStore.getState().chart.grid];
      useStore.getState().deleteColor(1, 0);
      useStore.getState().undo();

      const c = useStore.getState().chart;
      expect(c.palette).toHaveLength(3);
      expect([...c.grid]).toEqual(before);
    });

    it('refuses to remove the last color', () => {
      freshChart(2, 1);
      useStore.getState().deleteColor(1);
      useStore.getState().deleteColor(0);
      expect(useStore.getState().chart.palette.length).toBeGreaterThanOrEqual(1);
    });

    it('keeps the active color valid', () => {
      threeColorChart();
      useStore.getState().setActiveColor(2);
      useStore.getState().deleteColor(1, 0);
      const { activeColor, chart } = useStore.getState();
      expect(activeColor).toBe(1); // CC2 slid down into slot 1
      expect(activeColor).toBeLessThan(chart.palette.length);
    });
  });

  describe('reorder', () => {
    it('remaps every cell through the new order', () => {
      freshChart(3, 1);
      useStore.getState().addColor('#c92a2a', 'CC2');
      const s = useStore.getState();
      s.beginStroke();
      s.paintCell(0, 0);
      s.paintCell(1, 1);
      s.paintCell(2, 2);
      s.endStroke('setup');

      // move CC2 (index 2) to the front
      useStore.getState().reorderColor(2, 0);

      const c = useStore.getState().chart;
      expect(c.palette.map((p) => p.name)).toEqual(['CC2', 'MC', 'CC1']);
      expect(c.palette.map((p) => p.id)).toEqual([0, 1, 2]);
      // the stitches keep their colors: MC->1, CC1->2, CC2->0
      expect([...c.grid]).toEqual([1, 2, 0]);
    });

    it('leaves the chart looking identical', () => {
      freshChart(3, 1);
      useStore.getState().addColor('#c92a2a', 'CC2');
      const s = useStore.getState();
      s.beginStroke();
      s.paintCell(0, 2);
      s.endStroke('setup');

      const indexBefore = useStore.getState().chart.grid[0];
      const colorBefore = useStore.getState().chart.palette[indexBefore].hex;

      useStore.getState().reorderColor(2, 0);
      const c = useStore.getState().chart;
      expect(c.palette[c.grid[0]].hex).toBe(colorBefore);
    });

    it('undoes back to the original order', () => {
      freshChart(3, 1);
      useStore.getState().addColor('#c92a2a', 'CC2');
      const before = useStore.getState().chart.palette.map((p) => p.name);
      useStore.getState().reorderColor(2, 0);
      useStore.getState().undo();
      expect(useStore.getState().chart.palette.map((p) => p.name)).toEqual(before);
    });
  });
});
