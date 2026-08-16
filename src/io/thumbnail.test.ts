import { describe, expect, it } from 'vitest';
import { createChart } from '../model/types';
import type { Chart } from '../model/types';
import { thumbnailPixels } from './thumbnail';

function makeChart(stitches: number, rows: number): Chart {
  return createChart({
    title: 'T',
    stitches,
    rows,
    gauge: { stsPer4in: 20, rowsPer4in: 26, unit: 'in' },
    direction: 'flat',
  });
}

const pixel = (t: ReturnType<typeof thumbnailPixels>, x: number, y: number) => {
  const o = (y * t.width + x) * 4;
  return [t.data[o], t.data[o + 1], t.data[o + 2], t.data[o + 3]];
};

describe('thumbnailPixels', () => {
  it('keeps knitted proportions, so a square chart is not a square picture', () => {
    // 40 x 40 stitches at worsted gauge is wider than it is tall: aspect 20/26.
    const t = thumbnailPixels(makeChart(40, 40), 100, 100);
    expect(t.width).toBe(100);
    expect(t.height).toBe(Math.round(100 * (20 / 26)));
  });

  it('fits inside the box in either direction', () => {
    const tall = thumbnailPixels(makeChart(10, 200), 100, 100);
    expect(tall.width).toBeLessThanOrEqual(100);
    expect(tall.height).toBeLessThanOrEqual(100);

    const wide = thumbnailPixels(makeChart(200, 10), 100, 100);
    expect(wide.width).toBeLessThanOrEqual(100);
    expect(wide.height).toBeLessThanOrEqual(100);
  });

  it('never collapses to nothing', () => {
    const t = thumbnailPixels(makeChart(300, 2), 20, 20);
    expect(t.width).toBeGreaterThanOrEqual(1);
    expect(t.height).toBeGreaterThanOrEqual(1);
  });

  it('fills opaque pixels from the palette', () => {
    const chart = makeChart(4, 4); // default palette: #f4efe8 (MC), #31435f (CC1)
    chart.grid.fill(1);
    const t = thumbnailPixels(chart, 8, 8);
    expect(pixel(t, 0, 0)).toEqual([0x31, 0x43, 0x5f, 255]);
  });

  it('shrinks to colours that are actually in the palette', () => {
    // Averaging would blend navy and cream into a grey-blue that appears
    // nowhere in the chart, which tells a knitter nothing about their yarn.
    const chart = makeChart(60, 60);
    for (let i = 0; i < chart.grid.length; i++) chart.grid[i] = i % 2; // fine checks
    const t = thumbnailPixels(chart, 20, 20);

    const allowed = new Set(['244,239,232', '49,67,95']);
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        const [r, g, b] = pixel(t, x, y);
        expect(allowed.has(`${r},${g},${b}`)).toBe(true);
      }
    }
  });

  it('takes the dominant colour of each block', () => {
    const chart = makeChart(20, 20);
    // Left half mostly CC1, right half all MC.
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < 10; c++) chart.grid[r * 20 + c] = c === 0 ? 0 : 1;
    }
    const t = thumbnailPixels(chart, 4, 4);
    expect(pixel(t, 0, 0)).toEqual([0x31, 0x43, 0x5f, 255]);
    expect(pixel(t, t.width - 1, 0)).toEqual([0xf4, 0xef, 0xe8, 255]);
  });

  it('keeps row 0 at the top, like the grid it came from', () => {
    const chart = makeChart(10, 10);
    for (let c = 0; c < 10; c++) chart.grid[c] = 1; // top row only
    const t = thumbnailPixels(chart, 10, 10);
    expect(pixel(t, 5, 0)).toEqual([0x31, 0x43, 0x5f, 255]);
    expect(pixel(t, 5, t.height - 1)).toEqual([0xf4, 0xef, 0xe8, 255]);
  });
});
