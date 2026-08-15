import { describe, expect, it } from 'vitest';
import {
  carriedCounts,
  estimateYarn,
  formatLength,
  stitchCounts,
  stitchWidthInches,
} from './yarnEstimate';
import { createChart, type Chart, type Direction } from '../model/types';

const gauge = { stsPer4in: 20, rowsPer4in: 26, unit: 'in' as const };

function chartFrom(rows: string[], direction: Direction = 'flat'): Chart {
  const chart = createChart({
    title: 'Test',
    stitches: rows[0].length,
    rows: rows.length,
    gauge,
    direction,
  });
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      chart.grid[r * chart.stitches + c] = parseInt(ch, 10);
    })
  );
  const max = Math.max(...[...rows.join('')].map(Number));
  while (chart.palette.length <= max) {
    const id = chart.palette.length;
    chart.palette.push({ id, hex: '#888888', name: `CC${id}` });
  }
  return chart;
}

describe('stitchCounts', () => {
  it('counts every stitch once', () => {
    const chart = chartFrom(['0011', '0111']);
    expect(stitchCounts(chart)).toEqual([3, 5]);
    expect(stitchCounts(chart).reduce((a, b) => a + b, 0)).toBe(8);
  });
});

describe('carriedCounts', () => {
  it('carries nothing on a single-colour row', () => {
    // charts start with MC and CC1, so there is an entry per palette colour
    expect(carriedCounts(chartFrom(['0000']))).toEqual([0, 0]);
  });

  it('carries a colour only between its first and last use when flat', () => {
    // MC at both ends, CC1 in the middle:
    //   MC is used at 0 and 5, so it spans 6 and works 3 -> carries 3
    //   CC1 spans cols 1..4 (4) and works 3 -> carries 1
    const chart = chartFrom(['011010']);
    expect(carriedCounts(chart)).toEqual([3, 1]);
  });

  it('does not carry a colour past its last stitch in the row', () => {
    // CC1 only at the far left; MC fills the rest.
    // CC1 spans 1 stitch, works 1 -> carries 0
    const chart = chartFrom(['1000']);
    expect(carriedCounts(chart)).toEqual([0, 0]);
  });

  it('carries all the way around in the round', () => {
    // in a round, both yarns travel the full circumference
    const chart = chartFrom(['1000'], 'round');
    // MC works 3 of 4 -> carries 1; CC1 works 1 of 4 -> carries 3
    expect(carriedCounts(chart)).toEqual([1, 3]);
  });

  it('adds up across rows', () => {
    const chart = chartFrom(['011010', '011010']);
    expect(carriedCounts(chart)).toEqual([6, 2]);
  });

  it('ignores rows where only one colour appears', () => {
    const mixed = chartFrom(['0110', '0000']);
    const single = chartFrom(['0110']);
    expect(carriedCounts(mixed)).toEqual(carriedCounts(single));
  });
});

describe('stitchWidthInches', () => {
  it('divides the 4-inch gauge block by the stitch count', () => {
    expect(stitchWidthInches(chartFrom(['00']))).toBeCloseTo(4 / 20, 10);
  });

  it('handles a metric gauge', () => {
    const chart = chartFrom(['00']);
    chart.gauge = { stsPer4in: 20, rowsPer4in: 26, unit: 'cm' };
    // 10 cm is 3.937in, over 20 sts
    expect(stitchWidthInches(chart)).toBeCloseTo(10 / 2.54 / 20, 10);
  });
});

describe('estimateYarn', () => {
  it('returns one entry per palette colour', () => {
    const chart = chartFrom(['0011']);
    const est = estimateYarn(chart);
    expect(est).toHaveLength(2);
    expect(est.map((e) => e.name)).toEqual(['MC', 'CC1']);
  });

  it('needs more yarn for more stitches', () => {
    const few = estimateYarn(chartFrom(['0001']))[1];
    const many = estimateYarn(chartFrom(['0111']))[1];
    expect(many.yards).toBeGreaterThan(few.yards);
  });

  it('counts floats, so a scattered colour costs more than a solid block', () => {
    // same number of CC1 stitches, but spread out means more carrying of MC
    const solid = estimateYarn(chartFrom(['110000']))[0];
    const scattered = estimateYarn(chartFrom(['101000']))[0];
    expect(scattered.carriedStitches).toBeGreaterThan(solid.carriedStitches);
    expect(scattered.yards).toBeGreaterThan(solid.yards);
  });

  it('applies the safety margin', () => {
    const chart = chartFrom(['0011']);
    const bare = estimateYarn(chart, { marginPercent: 0 })[0];
    const padded = estimateYarn(chart, { marginPercent: 50 })[0];
    expect(padded.yards).toBeCloseTo(bare.yards * 1.5, 8);
  });

  it('scales with the yarn-per-stitch factor', () => {
    const chart = chartFrom(['0000']);
    const thin = estimateYarn(chart, { yarnPerStitchFactor: 2, marginPercent: 0 })[0];
    const thick = estimateYarn(chart, { yarnPerStitchFactor: 4, marginPercent: 0 })[0];
    expect(thick.yards).toBeCloseTo(thin.yards * 2, 8);
  });

  it('agrees between yards and metres', () => {
    const est = estimateYarn(chartFrom(['0011']))[0];
    expect(est.metres).toBeCloseTo(est.yards * 0.9144, 6);
  });

  it('gives an unused colour no yarn', () => {
    // CC1 exists in the palette but appears nowhere in this all-MC chart
    const est = estimateYarn(chartFrom(['0000']));
    expect(est[1].knitStitches).toBe(0);
    expect(est[1].yards).toBe(0);
  });

  it('produces a sane figure for a realistic chart', () => {
    // 100 x 130 worsted, half in each colour: a few hundred yards total is
    // the right order of magnitude for a vest front.
    const rows = Array.from({ length: 130 }, (_, r) =>
      Array.from({ length: 100 }, (_, c) => ((r + c) % 2 === 0 ? '0' : '1')).join('')
    );
    const est = estimateYarn(chartFrom(rows));
    const total = est.reduce((a, e) => a + e.yards, 0);
    expect(total).toBeGreaterThan(100);
    expect(total).toBeLessThan(2000);
  });
});

describe('formatLength', () => {
  const usage = {
    index: 0,
    name: 'MC',
    hex: '#fff',
    knitStitches: 100,
    carriedStitches: 0,
    yards: 12.3,
    metres: 11.2,
  };

  it('rounds up to whole units', () => {
    expect(formatLength(usage, 'yd')).toBe('13 yd');
    expect(formatLength(usage, 'm')).toBe('12 m');
  });

  it('never claims zero for a colour that is used', () => {
    expect(formatLength({ ...usage, yards: 0.2 }, 'yd')).toBe('<1 yd');
  });

  it('dashes an unused colour', () => {
    expect(formatLength({ ...usage, knitStitches: 0, yards: 0 }, 'yd')).toBe('—');
  });
});
