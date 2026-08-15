import type { Chart, KnitChartFile } from './types';
import { decodeGrid, encodeGrid } from './rle';

export function chartToFile(chart: Chart): KnitChartFile {
  return {
    version: 1,
    meta: {
      title: chart.title,
      author: chart.author,
      created: chart.created,
      modified: new Date().toISOString(),
      notes: chart.notes,
    },
    dimensions: { stitches: chart.stitches, rows: chart.rows },
    gauge: chart.gauge,
    direction: chart.direction,
    palette: chart.palette,
    cells: encodeGrid(chart.grid, chart.stitches, chart.rows),
    floatThreshold: chart.floatThreshold,
  };
}

export function fileToChart(file: KnitChartFile): Chart {
  if (file.version !== 1) {
    throw new Error(`Unsupported .knitchart version ${(file as { version: unknown }).version}`);
  }
  const { stitches, rows } = file.dimensions;
  if (!Number.isInteger(stitches) || stitches <= 0 || !Number.isInteger(rows) || rows <= 0) {
    throw new Error('Invalid chart dimensions');
  }
  if (!Array.isArray(file.palette) || file.palette.length === 0) {
    throw new Error('Chart file has no palette');
  }
  const grid = decodeGrid(file.cells, stitches, rows);
  const maxIndex = file.palette.length - 1;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > maxIndex) throw new Error(`Cell references missing palette index ${grid[i]}`);
  }
  return {
    title: file.meta.title ?? 'Untitled',
    author: file.meta.author,
    created: file.meta.created ?? new Date().toISOString(),
    notes: file.meta.notes,
    stitches,
    rows,
    gauge: file.gauge,
    direction: file.direction === 'round' ? 'round' : 'flat',
    palette: file.palette,
    grid,
    floatThreshold: file.floatThreshold ?? 5,
  };
}
