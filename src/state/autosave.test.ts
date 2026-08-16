import { describe, expect, it } from 'vitest';
import { createChart } from '../model/types';
import { worthAnnouncing } from './autosave';

const blank = () =>
  createChart({
    title: 'Untitled chart',
    stitches: 8,
    rows: 8,
    gauge: { stsPer4in: 20, rowsPer4in: 26, unit: 'in' },
    direction: 'flat',
  });

describe('worthAnnouncing', () => {
  it('says nothing about an untouched chart', () => {
    // Restoring it is right; announcing it would put a banner over a blank grid
    // on every second visit.
    expect(worthAnnouncing(blank())).toBe(false);
  });

  it('announces a chart with stitches on it', () => {
    const chart = blank();
    chart.grid[5] = 1;
    expect(worthAnnouncing(chart)).toBe(true);
  });

  it('announces a chart that was named, even if nothing is drawn yet', () => {
    expect(worthAnnouncing({ ...blank(), title: 'Fair Isle yoke' })).toBe(true);
  });

  it('treats a blanked title as untouched', () => {
    expect(worthAnnouncing({ ...blank(), title: '   ' })).toBe(false);
  });
});
