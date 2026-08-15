import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { estimatePages, exportPdf, stitchSizeMm, type PdfOptions } from './pdf';
import { stitchCounts } from '../domain/yarnEstimate';
import { createChart, type Chart } from '../model/types';

const gauge = { stsPer4in: 20, rowsPer4in: 26, unit: 'in' as const };

function chartWith(stitches: number, rows: number, opts: Partial<Chart> = {}): Chart {
  const chart = createChart({
    title: 'Test chart',
    stitches,
    rows,
    gauge,
    direction: 'flat',
    ...opts,
  });
  // a simple two-color check so runs and grid lines have something to draw
  for (let i = 0; i < chart.grid.length; i++) {
    chart.grid[i] = (Math.floor(i / stitches) + i) % 3 === 0 ? 1 : 0;
  }
  return { ...chart, ...opts };
}

const pageCount = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

describe('exportPdf', () => {
  it('produces a valid PDF', async () => {
    const bytes = await exportPdf(chartWith(20, 16));
    expect(bytes.length).toBeGreaterThan(500);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    expect(await pageCount(bytes)).toBe(1);
  });

  it('tiles a large chart across pages', async () => {
    const bytes = await exportPdf(chartWith(120, 150), { cellSizeMm: 6 });
    expect(await pageCount(bytes)).toBeGreaterThan(4);
  });

  it('fits any chart on one page in fit mode', async () => {
    const bytes = await exportPdf(chartWith(200, 240), { cellSizeMm: 'fit' });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('uses the requested paper size and orientation', async () => {
    const portrait = await PDFDocument.load(await exportPdf(chartWith(10, 10)));
    const p = portrait.getPage(0).getSize();
    expect(Math.round(p.width)).toBe(612);
    expect(Math.round(p.height)).toBe(792);

    const landscape = await PDFDocument.load(
      await exportPdf(chartWith(10, 10), { orientation: 'landscape' })
    );
    const l = landscape.getPage(0).getSize();
    expect(Math.round(l.width)).toBe(792);
    expect(Math.round(l.height)).toBe(612);

    const a4 = await PDFDocument.load(await exportPdf(chartWith(10, 10), { pageSize: 'a4' }));
    expect(Math.round(a4.getPage(0).getSize().width)).toBe(595);
  });

  it('needs fewer pages with smaller stitches', async () => {
    const chart = chartWith(80, 100);
    const big = await pageCount(await exportPdf(chart, { cellSizeMm: 8 }));
    const small = await pageCount(await exportPdf(chart, { cellSizeMm: 4 }));
    expect(small).toBeLessThan(big);
  });

  it('survives a title the built-in fonts cannot encode', async () => {
    // Helvetica is WinAnsi-only; CJK and emoji must not blow up the export.
    const chart = chartWith(10, 10);
    const bytes = await exportPdf({ ...chart, title: 'Vest ✿ 日本語 🧶 — v2' });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('explains itself when the stitches cannot fit a page', async () => {
    await expect(exportPdf(chartWith(10, 10), { cellSizeMm: 300 })).rejects.toThrow(/too large/i);
  });

  it('exports an in-the-round chart', async () => {
    const bytes = await exportPdf(chartWith(30, 20, { direction: 'round' }));
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1);
  });

  it('handles a one-stitch chart', async () => {
    const bytes = await exportPdf(chartWith(1, 1));
    expect(await pageCount(bytes)).toBe(1);
  });
});

describe('appended sections', () => {
  it('adds pages for written instructions', async () => {
    const chart = chartWith(20, 30);
    const plain = await pageCount(await exportPdf(chart));
    const withText = await pageCount(await exportPdf(chart, { includeInstructions: true }));
    expect(withText).toBeGreaterThan(plain);
  });

  it('adds a page for the yarn estimate', async () => {
    const chart = chartWith(20, 16);
    const plain = await pageCount(await exportPdf(chart));
    const withYarn = await pageCount(await exportPdf(chart, { includeYarnEstimate: true }));
    expect(withYarn).toBe(plain + 1);
  });

  it('flows long instructions onto further pages', async () => {
    // Rows must be distinct AND aperiodic: identical rows merge into one
    // instruction block, and a repeating chart collapses to one cycle plus
    // "repeat rows 1-N". Writing the row number out in binary gives neither.
    const varied = (rows: number) => {
      const chart = createChart({ title: 'Varied', stitches: 20, rows, gauge, direction: 'flat' });
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 20; c++) chart.grid[r * 20 + c] = (r >> c) & 1;
      }
      return chart;
    };
    const short = await pageCount(await exportPdf(varied(20), { includeInstructions: true }));
    const long = await pageCount(await exportPdf(varied(200), { includeInstructions: true }));
    expect(long).toBeGreaterThan(short);
  });

  it('leaves the estimate out of the page count when not requested', () => {
    const chart = chartWith(20, 16);
    // estimatePages counts chart pages only, which is what the dialog promises
    expect(estimatePages(chart, { includeYarnEstimate: true })).toBe(
      estimatePages(chart, { includeYarnEstimate: false })
    );
  });
});

describe('estimatePages', () => {
  const cases: Array<Partial<PdfOptions>> = [
    { cellSizeMm: 6 },
    { cellSizeMm: 10 },
    { cellSizeMm: 4, orientation: 'landscape' },
    { cellSizeMm: 6, includeLegend: false },
    { cellSizeMm: 6, squareCells: true },
    { cellSizeMm: 'fit' },
    { cellSizeMm: 5, pageSize: 'a4', overlap: 4 },
  ];

  it('matches the page count of the document actually built', async () => {
    const chart = chartWith(90, 110);
    for (const opts of cases) {
      const estimate = estimatePages(chart, opts);
      const real = await pageCount(await exportPdf(chart, opts));
      expect(estimate, `options ${JSON.stringify(opts)}`).toBe(real);
    }
  });

  it('reports zero when nothing can fit, so the dialog can warn', () => {
    expect(estimatePages(chartWith(10, 10), { cellSizeMm: 300 })).toBe(0);
  });
});

describe('one page by default', () => {
  it('keeps a chart that used to tile on a single sheet', async () => {
    // 6 mm stitches — the old default — would put this across several pages.
    const chart = chartWith(120, 150);
    expect(estimatePages(chart, { cellSizeMm: 6 })).toBeGreaterThan(1);
    expect(estimatePages(chart)).toBe(1);
    expect(await pageCount(await exportPdf(chart))).toBe(1);
  });

  it('reports the stitch size that fitting actually cost', () => {
    const small = stitchSizeMm(chartWith(20, 16));
    const big = stitchSizeMm(chartWith(200, 160));
    expect(small).toBeGreaterThan(big); // squeezing more stitches on means smaller ones
    expect(big).toBeGreaterThan(0);
    expect(big).toBeLessThan(2); // small enough that the dialog warns about it
  });

  it('reports a fixed stitch size back unchanged', () => {
    expect(stitchSizeMm(chartWith(20, 16), { cellSizeMm: 6 })).toBeCloseTo(6, 6);
  });
});

describe('stitchCounts', () => {
  it('counts every stitch exactly once', () => {
    const chart = chartWith(12, 9);
    const counts = stitchCounts(chart);
    expect(counts).toHaveLength(chart.palette.length);
    expect(counts.reduce((a: number, b: number) => a + b, 0)).toBe(12 * 9);
  });

  it('counts a solid chart entirely as one color', () => {
    const chart = createChart({ title: 't', stitches: 5, rows: 4, gauge, direction: 'flat' });
    expect(stitchCounts(chart)[0]).toBe(20);
  });
});
