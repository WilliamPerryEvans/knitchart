import { describe, expect, it } from 'vitest';
import {
  rowArrow,
  rowLabels,
  rowNumber,
  rowNumberOnRight,
  rowSide,
  showStitchLabel,
  stitchLabelStep,
  stitchNumber,
} from './labels';
import { createChart } from '../model/types';

const gauge = { stsPer4in: 20, rowsPer4in: 26, unit: 'in' as const };

describe('rowNumber', () => {
  it('numbers from the bottom, so the top grid row is the highest number', () => {
    expect(rowNumber(40, 0)).toBe(40);
    expect(rowNumber(40, 39)).toBe(1);
  });
});

describe('stitchNumber', () => {
  it('numbers from the right, so stitch 1 is the last column', () => {
    expect(stitchNumber(40, 39)).toBe(1);
    expect(stitchNumber(40, 0)).toBe(40);
  });
});

describe('rowSide', () => {
  it('alternates RS/WS when knit flat, starting with RS on row 1', () => {
    expect(rowSide('flat', 1)).toBe('RS');
    expect(rowSide('flat', 2)).toBe('WS');
    expect(rowSide('flat', 3)).toBe('RS');
    expect(rowSide('flat', 40)).toBe('WS');
  });

  it('is always RS in the round', () => {
    for (const n of [1, 2, 3, 40]) expect(rowSide('round', n)).toBe('RS');
  });
});

describe('rowNumberOnRight', () => {
  it('puts RS rows on the right and WS rows on the left when flat', () => {
    expect(rowNumberOnRight('flat', 1)).toBe(true);
    expect(rowNumberOnRight('flat', 2)).toBe(false);
  });

  it('puts every round on the right', () => {
    expect(rowNumberOnRight('round', 1)).toBe(true);
    expect(rowNumberOnRight('round', 2)).toBe(true);
  });
});

describe('rowArrow', () => {
  it('points right-to-left on RS and left-to-right on WS', () => {
    expect(rowArrow('flat', 1)).toBe('←');
    expect(rowArrow('flat', 2)).toBe('→');
    expect(rowArrow('round', 2)).toBe('←');
  });
});

describe('stitchLabelStep', () => {
  it('labels every stitch when cells are wide enough', () => {
    // 2-digit chart, 8px per char -> needs 20px; 24px cells have room
    expect(stitchLabelStep(24, 40, 8)).toBe(1);
  });

  it('falls back to every 5th when cells are narrow', () => {
    expect(stitchLabelStep(6, 40, 8)).toBe(5);
  });

  it('falls back to every 10th when cells are very narrow', () => {
    expect(stitchLabelStep(2, 300, 8)).toBe(10);
  });

  it('accounts for wider numbers on a big chart', () => {
    // 3 digits needs more room than 2 at the same cell width
    expect(stitchLabelStep(20, 300, 8)).toBe(5);
    expect(stitchLabelStep(20, 40, 8)).toBe(1);
  });
});

describe('showStitchLabel', () => {
  it('shows everything at step 1', () => {
    expect([1, 2, 3, 7].every((n) => showStitchLabel(n, 1))).toBe(true);
  });

  it('shows stitch 1 and multiples at step 5', () => {
    expect(showStitchLabel(1, 5)).toBe(true);
    expect(showStitchLabel(5, 5)).toBe(true);
    expect(showStitchLabel(10, 5)).toBe(true);
    expect(showStitchLabel(7, 5)).toBe(false);
  });
});

describe('rowLabels', () => {
  it('labels a flat chart bottom-up with alternating sides', () => {
    const chart = createChart({ title: 't', stitches: 4, rows: 4, gauge, direction: 'flat' });
    expect(rowLabels(chart)).toEqual([
      { num: 4, side: 'WS', right: false },
      { num: 3, side: 'RS', right: true },
      { num: 2, side: 'WS', right: false },
      { num: 1, side: 'RS', right: true },
    ]);
  });

  it('labels every round RS and right-side', () => {
    const chart = createChart({ title: 't', stitches: 4, rows: 3, gauge, direction: 'round' });
    expect(rowLabels(chart).every((l) => l.side === 'RS' && l.right)).toBe(true);
  });
});
