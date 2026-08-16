import { beforeEach, describe, expect, it } from 'vitest';
import { createChart } from '../model/types';
import type { Chart } from '../model/types';
import {
  WORKING_ID,
  chartFromEntry,
  createMemoryDriver,
  deleteFromLibrary,
  entryFor,
  listCharts,
  loadFromLibrary,
  newId,
  readWorking,
  renameInLibrary,
  saveToLibrary,
  saveWorking,
  toCards,
} from './library';
import type { LibraryDriver, LibraryEntry } from './library';

function makeChart(title = 'Swatch', stitches = 8, rows = 6): Chart {
  return createChart({
    title,
    stitches,
    rows,
    gauge: { stsPer4in: 20, rowsPer4in: 26, unit: 'in' },
    direction: 'flat',
  });
}

/** A chart with something drawn on it, so a round trip can be checked. */
function paint(chart: Chart): Chart {
  for (let i = 0; i < chart.grid.length; i += 3) chart.grid[i] = 1;
  return chart;
}

let driver: LibraryDriver;
beforeEach(() => {
  driver = createMemoryDriver();
});

describe('entryFor', () => {
  it('carries the metadata the Charts screen needs', () => {
    const entry = entryFor(makeChart('Fair Isle yoke', 60, 40), 'abc');
    expect(entry.id).toBe('abc');
    expect(entry.title).toBe('Fair Isle yoke');
    expect(entry.stitches).toBe(60);
    expect(entry.rows).toBe(40);
    expect(entry.modified).toBe(entry.file.meta.modified);
  });

  it('never stores a blank name', () => {
    expect(entryFor(makeChart('   '), 'a').title).toBe('Untitled chart');
  });
});

describe('save and load', () => {
  it('brings back an identical grid', async () => {
    const chart = paint(makeChart('Cables', 12, 10));
    const saved = await saveToLibrary(chart, 'id-1', null, driver);

    const result = await loadFromLibrary(saved.id, driver);
    expect(result).not.toBeNull();
    expect(result!.chart.stitches).toBe(12);
    expect(result!.chart.rows).toBe(10);
    expect([...result!.chart.grid]).toEqual([...chart.grid]);
    expect(result!.chart.palette).toEqual(chart.palette);
    expect(result!.chart.gauge).toEqual(chart.gauge);
  });

  it('returns null for a chart that is not there', async () => {
    expect(await loadFromLibrary('missing', driver)).toBeNull();
  });

  it('overwrites when saved under the same id', async () => {
    await saveToLibrary(makeChart('First'), 'same', null, driver);
    await saveToLibrary(makeChart('Second'), 'same', null, driver);
    const cards = await listCharts(driver);
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('Second');
  });

  it('keeps the desktop file path so Save still overwrites the right file', async () => {
    const saved = await saveToLibrary(makeChart(), 'p', 'C:/knits/hat.knitchart', driver);
    expect(saved.filePath).toBe('C:/knits/hat.knitchart');
  });
});

describe('listing', () => {
  it('puts the newest chart first', () => {
    const cards = toCards([
      { ...entryFor(makeChart('Old'), 'a'), modified: '2026-01-01T00:00:00.000Z' },
      { ...entryFor(makeChart('New'), 'b'), modified: '2026-08-01T00:00:00.000Z' },
      { ...entryFor(makeChart('Middle'), 'c'), modified: '2026-04-01T00:00:00.000Z' },
    ]);
    expect(cards.map((c) => c.title)).toEqual(['New', 'Middle', 'Old']);
  });

  it('hides the autosave slot', async () => {
    await saveToLibrary(makeChart('Real chart'), 'real', null, driver);
    await saveWorking(makeChart('Half-finished'), {}, driver);

    const cards = await listCharts(driver);
    expect(cards.map((c) => c.id)).toEqual(['real']);
  });

  it('drops the chart data so a long list stays cheap', () => {
    const cards = toCards([entryFor(paint(makeChart()), 'a')]);
    expect('file' in cards[0]).toBe(false);
  });
});

describe('rename', () => {
  it('renames the card and the chart inside it', async () => {
    await saveToLibrary(makeChart('Typo'), 'r', null, driver);
    const updated = await renameInLibrary('r', 'Sierpinski scarf', driver);

    expect(updated!.title).toBe('Sierpinski scarf');
    // The name lives in two places; renaming only the card would mean the chart
    // came back under its old title as soon as it was exported.
    const loaded = await loadFromLibrary('r', driver);
    expect(loaded!.chart.title).toBe('Sierpinski scarf');
  });

  it('refuses to blank a name', async () => {
    await saveToLibrary(makeChart('Named'), 'r', null, driver);
    expect((await renameInLibrary('r', '  ', driver))!.title).toBe('Untitled chart');
  });

  it('returns null when there is nothing to rename', async () => {
    expect(await renameInLibrary('nope', 'x', driver)).toBeNull();
  });
});

describe('delete', () => {
  it('removes just that chart', async () => {
    await saveToLibrary(makeChart('Keep'), 'k', null, driver);
    await saveToLibrary(makeChart('Bin'), 'b', null, driver);
    await deleteFromLibrary('b', driver);
    expect((await listCharts(driver)).map((c) => c.id)).toEqual(['k']);
  });
});

describe('the working slot', () => {
  it('round-trips the chart being drawn', async () => {
    const chart = paint(makeChart('In progress', 9, 7));
    await saveWorking(chart, { sourceId: 'lib-3', filePath: null }, driver);

    const entry = await readWorking(driver);
    expect(entry!.sourceId).toBe('lib-3');
    expect([...chartFromEntry(entry!).grid]).toEqual([...chart.grid]);
  });

  it('holds one chart, not a history', async () => {
    await saveWorking(makeChart('A'), {}, driver);
    await saveWorking(makeChart('B'), {}, driver);
    expect((await driver.all()).filter((e: LibraryEntry) => e.id === WORKING_ID)).toHaveLength(1);
    expect((await readWorking(driver))!.title).toBe('B');
  });

  it('is empty before anything has been drawn', async () => {
    expect(await readWorking(driver)).toBeNull();
  });
});

describe('newId', () => {
  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
  });
});
