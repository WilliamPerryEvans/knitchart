import { describe, expect, it } from 'vitest';
import {
  blockLabel,
  colorName,
  findRepeatPeriod,
  formatInstructions,
  instructionBlocks,
  rowBody,
  rowInstructions,
  workingOrder,
} from './instructions';
import { createChart, type Chart, type Direction } from '../model/types';

const gauge = { stsPer4in: 20, rowsPer4in: 26, unit: 'in' as const };

/** Build a chart from rows of digits, TOP row first (as stored). */
function chartFrom(rows: string[], direction: Direction = 'flat', names?: string[]): Chart {
  const chart = createChart({
    title: 'Test',
    stitches: rows[0].length,
    rows: rows.length,
    gauge,
    direction,
  });
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      chart.grid[r * chart.stitches + c] = parseInt(ch, 10);
    });
  });
  if (names) {
    chart.palette = names.map((name, id) => ({ id, hex: '#000000', name }));
  } else {
    // ensure enough palette entries for the digits used
    const max = Math.max(...[...rows.join('')].map(Number));
    while (chart.palette.length <= max) {
      chart.palette.push({ id: chart.palette.length, hex: '#888888', name: `CC${chart.palette.length}` });
    }
  }
  return chart;
}

describe('workingOrder', () => {
  it('reads a RS row right to left', () => {
    // one row: leftmost stitch is 1, rightmost is 2 -> worked 2 then 1
    const chart = chartFrom(['12']);
    expect([...workingOrder(chart, 0, 'RS')]).toEqual([2, 1]);
  });

  it('reads a WS row left to right', () => {
    const chart = chartFrom(['12']);
    expect([...workingOrder(chart, 0, 'WS')]).toEqual([1, 2]);
  });

  it('does not disturb the chart itself', () => {
    const chart = chartFrom(['12']);
    workingOrder(chart, 0, 'RS');
    expect([...chart.grid]).toEqual([1, 2]);
  });
});

describe('rowBody', () => {
  it('knits on RS and purls on WS when worked flat', () => {
    const chart = chartFrom(['0011'], 'flat', ['MC', 'CC1']);
    // RS reads right-to-left: two CC1 then two MC
    expect(rowBody(chart, 0, 'RS')).toBe('k2 CC1, k2 MC');
    expect(rowBody(chart, 0, 'WS')).toBe('p2 MC, p2 CC1');
  });

  it('always knits in the round', () => {
    const chart = chartFrom(['0011'], 'round', ['MC', 'CC1']);
    expect(rowBody(chart, 0, 'RS')).toBe('k2 CC1, k2 MC');
  });

  it('collapses a solid row into one run', () => {
    const chart = chartFrom(['000000'], 'flat', ['MC', 'CC1']);
    expect(rowBody(chart, 0, 'RS')).toBe('k6 MC');
  });

  it('handles alternating stitches', () => {
    const chart = chartFrom(['0101'], 'flat', ['MC', 'CC1']);
    expect(rowBody(chart, 0, 'RS')).toBe('k1 CC1, k1 MC, k1 CC1, k1 MC');
  });

  it('falls back to a label when a color has no name', () => {
    const chart = chartFrom(['01']);
    chart.palette = [
      { id: 0, hex: '#fff', name: '' },
      { id: 1, hex: '#000', name: '  ' },
    ];
    expect(colorName(chart, 0)).toBe('Color 0');
    expect(rowBody(chart, 0, 'RS')).toBe('k1 Color 1, k1 Color 0');
  });
});

describe('rowInstructions', () => {
  it('starts at row 1, the bottom of the chart', () => {
    // top row is all CC1, bottom row all MC
    const chart = chartFrom(['11', '00'], 'flat', ['MC', 'CC1']);
    const rows = rowInstructions(chart);
    expect(rows[0].row).toBe(1);
    expect(rows[0].body).toBe('k2 MC');
    expect(rows[1].row).toBe(2);
    expect(rows[1].body).toBe('p2 CC1');
  });

  it('alternates RS and WS when flat', () => {
    const chart = chartFrom(['00', '00', '00', '00'], 'flat', ['MC']);
    expect(rowInstructions(chart).map((r) => r.side)).toEqual(['RS', 'WS', 'RS', 'WS']);
  });

  it('is all RS in the round', () => {
    const chart = chartFrom(['00', '00', '00'], 'round', ['MC']);
    expect(rowInstructions(chart).every((r) => r.side === 'RS')).toBe(true);
  });

  it('reports the stitch count on every row', () => {
    const chart = chartFrom(['012', '210'], 'flat');
    expect(rowInstructions(chart).every((r) => r.stitches === 3)).toBe(true);
  });
});

describe('findRepeatPeriod', () => {
  it('finds a two-row stripe', () => {
    const chart = chartFrom(['11', '00', '11', '00', '11', '00'], 'round', ['MC', 'CC1']);
    expect(findRepeatPeriod(rowInstructions(chart))).toBe(2);
  });

  it('finds a one-row repeat when every row is the same', () => {
    const chart = chartFrom(['00', '00', '00', '00'], 'round', ['MC']);
    expect(findRepeatPeriod(rowInstructions(chart))).toBe(1);
  });

  it('returns null when nothing repeats', () => {
    const chart = chartFrom(['00', '01', '11'], 'round', ['MC', 'CC1']);
    expect(findRepeatPeriod(rowInstructions(chart))).toBeNull();
  });

  it('does not treat alternating RS/WS sides as a repeat', () => {
    // identical grid rows, but flat knitting alternates knit and purl rows,
    // so the period is 2 (not 1) because the text differs
    const chart = chartFrom(['01', '01', '01', '01'], 'flat', ['MC', 'CC1']);
    expect(findRepeatPeriod(rowInstructions(chart))).toBe(2);
  });
});

describe('instructionBlocks', () => {
  it('merges neighbouring identical rows', () => {
    const chart = chartFrom(['00', '00', '00', '00'], 'round', ['MC']);
    const blocks = instructionBlocks(rowInstructions(chart), { detectRepeats: false });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'rows', fromRow: 1, toRow: 4, body: 'k2 MC' });
  });

  it('collapses a repeating chart into one cycle plus a repeat', () => {
    const chart = chartFrom(['11', '00', '11', '00', '11', '00'], 'round', ['MC', 'CC1']);
    const blocks = instructionBlocks(rowInstructions(chart));
    const repeat = blocks[blocks.length - 1];
    expect(repeat).toMatchObject({ kind: 'repeat', fromRow: 3, toRow: 6, repeatFrom: 1, repeatTo: 2 });
    // only the first cycle is spelled out
    expect(blocks.filter((b) => b.kind === 'rows')).toHaveLength(2);
  });

  it('leaves a chart alone when it does not repeat', () => {
    const chart = chartFrom(['00', '01', '11'], 'round', ['MC', 'CC1']);
    const blocks = instructionBlocks(rowInstructions(chart));
    expect(blocks.every((b) => b.kind === 'rows')).toBe(true);
    expect(blocks).toHaveLength(3);
  });

  it('does not collapse when less than two full cycles exist', () => {
    // period 2 but only 3 rows: spelling it out is clearer than repeating
    const chart = chartFrom(['11', '00', '11'], 'round', ['MC', 'CC1']);
    const blocks = instructionBlocks(rowInstructions(chart));
    expect(blocks.some((b) => b.kind === 'repeat')).toBe(false);
  });

  it('handles an empty list', () => {
    expect(instructionBlocks([])).toEqual([]);
  });
});

describe('blockLabel', () => {
  const flat = chartFrom(['00', '00'], 'flat', ['MC']);
  const round = chartFrom(['00', '00'], 'round', ['MC']);

  it('names a single flat row with its side', () => {
    const block = { kind: 'rows' as const, fromRow: 1, toRow: 1, side: 'RS' as const, body: '', stitches: 2 };
    expect(blockLabel(flat, block)).toBe('Row 1 (RS)');
  });

  it('names a range', () => {
    const block = { kind: 'rows' as const, fromRow: 1, toRow: 4, side: 'WS' as const, body: '', stitches: 2 };
    expect(blockLabel(flat, block)).toBe('Rows 1–4 (WS)');
  });

  it('uses Rnd and drops the side for charts in the round', () => {
    const block = { kind: 'rows' as const, fromRow: 2, toRow: 5, side: 'RS' as const, body: '', stitches: 2 };
    expect(blockLabel(round, block)).toBe('Rnds 2–5');
  });
});

describe('formatInstructions', () => {
  it('produces a readable pattern', () => {
    const chart = chartFrom(['11', '00'], 'flat', ['MC', 'CC1']);
    chart.title = 'Two-row stripe';
    const text = formatInstructions(chart);
    expect(text).toContain('Two-row stripe');
    expect(text).toContain('2 sts x 2 rows');
    expect(text).toContain('Row 1 (RS): k2 MC. (2 sts)');
    expect(text).toContain('Row 2 (WS): p2 CC1. (2 sts)');
  });

  it('explains the reading direction', () => {
    expect(formatInstructions(chartFrom(['00'], 'flat', ['MC']))).toContain('RS rows are knitted');
    expect(formatInstructions(chartFrom(['00'], 'round', ['MC']))).toContain('Every round');
  });

  it('writes the repeat instruction in round wording', () => {
    const chart = chartFrom(['11', '00', '11', '00'], 'round', ['MC', 'CC1']);
    const text = formatInstructions(chart);
    expect(text).toContain('Rnds 3–4: repeat rnds 1–2.');
  });

  it('uses the singular when repeating a single row', () => {
    const chart = chartFrom(['00', '00', '00', '00'], 'round', ['MC']);
    const text = formatInstructions(chart);
    // every round identical: merged into one block, no repeat needed
    expect(text).toContain('Rnds 1–4: k2 MC.');
  });

  it('covers every row of a non-repeating chart', () => {
    const chart = chartFrom(['00', '01', '11', '10'], 'flat', ['MC', 'CC1']);
    const text = formatInstructions(chart);
    for (const n of [1, 2, 3, 4]) expect(text).toMatch(new RegExp(`Row ${n} \\(`));
  });
});
