import { describe, expect, it } from 'vitest';
import { cellAspect, cellSize, finishedSize } from './gauge';

describe('cellAspect', () => {
  it('is under 1 for typical knitting (stitches wider than tall)', () => {
    // Worsted: 20 sts x 26 rows per 4"
    expect(cellAspect({ stsPer4in: 20, rowsPer4in: 26, unit: 'in' })).toBeCloseTo(20 / 26, 10);
  });

  it('matches the ~4:5 worsted rule of thumb', () => {
    const a = cellAspect({ stsPer4in: 20, rowsPer4in: 25, unit: 'in' });
    expect(a).toBeCloseTo(0.8, 10);
  });

  it('is 1 for a square gauge', () => {
    expect(cellAspect({ stsPer4in: 22, rowsPer4in: 22, unit: 'in' })).toBe(1);
  });

  it('throws on non-positive gauge', () => {
    expect(() => cellAspect({ stsPer4in: 0, rowsPer4in: 26, unit: 'in' })).toThrow();
    expect(() => cellAspect({ stsPer4in: 20, rowsPer4in: -1, unit: 'in' })).toThrow();
  });
});

describe('cellSize', () => {
  const gauge = { stsPer4in: 20, rowsPer4in: 26, unit: 'in' as const };

  it('returns gauge-proportioned height by default', () => {
    const { w, h } = cellSize(gauge, 13, false);
    expect(w).toBe(13);
    expect(h).toBeCloseTo(13 * (20 / 26), 10);
    expect(h).toBeLessThan(w);
  });

  it('returns square cells in square mode', () => {
    expect(cellSize(gauge, 13, true)).toEqual({ w: 13, h: 13 });
  });
});

describe('finishedSize', () => {
  it('computes inches from a 4-inch gauge block', () => {
    // 20 sts / 4in -> 5 sts per inch; 100 sts = 20in. 26 rows/4in -> 130 rows = 20in.
    const size = finishedSize({ stsPer4in: 20, rowsPer4in: 26, unit: 'in' }, 100, 130);
    expect(size.width).toBeCloseTo(20, 10);
    expect(size.height).toBeCloseTo(20, 10);
    expect(size.unit).toBe('in');
  });

  it('computes cm from a 10-cm gauge block', () => {
    const size = finishedSize({ stsPer4in: 22, rowsPer4in: 30, unit: 'cm' }, 110, 90);
    expect(size.width).toBeCloseTo(50, 10);
    expect(size.height).toBeCloseTo(30, 10);
    expect(size.unit).toBe('cm');
  });
});
