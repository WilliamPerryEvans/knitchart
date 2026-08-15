import { describe, expect, it } from 'vitest';
import { YARN_WEIGHTS, matchYarnWeight, yarnWeightById } from './yarn';
import { cellAspect } from '../model/gauge';

describe('YARN_WEIGHTS', () => {
  it('has unique ids', () => {
    expect(new Set(YARN_WEIGHTS.map((w) => w.id)).size).toBe(YARN_WEIGHTS.length);
  });

  it('runs from finest to heaviest', () => {
    const sts = YARN_WEIGHTS.map((w) => w.stsPer4in);
    expect(sts).toEqual([...sts].sort((a, b) => b - a));
  });

  it('always has more rows than stitches per 4in, as knit stitches are wider than tall', () => {
    for (const w of YARN_WEIGHTS) {
      expect(w.rowsPer4in).toBeGreaterThan(w.stsPer4in);
    }
  });

  it('produces sensible cell aspect ratios for every weight', () => {
    for (const w of YARN_WEIGHTS) {
      const aspect = cellAspect({ stsPer4in: w.stsPer4in, rowsPer4in: w.rowsPer4in, unit: 'in' });
      // knit stitches are wider than tall, but not wildly so
      expect(aspect).toBeGreaterThan(0.6);
      expect(aspect).toBeLessThan(1);
    }
  });

  it('matches the worsted rule of thumb used elsewhere in the app', () => {
    const worsted = yarnWeightById('worsted');
    expect(worsted).toMatchObject({ stsPer4in: 20, rowsPer4in: 26 });
  });
});

describe('matchYarnWeight', () => {
  it('finds the preset for an exact gauge', () => {
    expect(matchYarnWeight({ stsPer4in: 22, rowsPer4in: 30 })?.id).toBe('dk');
  });

  it('returns null for a hand-tuned gauge', () => {
    expect(matchYarnWeight({ stsPer4in: 21, rowsPer4in: 29 })).toBeNull();
  });

  it('does not match when only the stitch count lines up', () => {
    expect(matchYarnWeight({ stsPer4in: 20, rowsPer4in: 30 })).toBeNull();
  });
});

describe('yarnWeightById', () => {
  it('returns null for an unknown id', () => {
    expect(yarnWeightById('nope')).toBeNull();
  });
});
