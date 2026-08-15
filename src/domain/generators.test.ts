import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GENERATOR,
  carpetCell,
  cropGrid,
  flipVertical,
  gaugeRowScale,
  generateCarpet,
  generateChecks,
  generatePattern,
  generateRule,
  generateStripes,
  generatorLabel,
  ruleTable,
  scaleGrid,
  seedCells,
  seedRowFromChart,
  stepRule,
  type GeneratorOptions,
} from './generators';

const opts = (patch: Partial<GeneratorOptions> = {}): GeneratorOptions => ({
  ...DEFAULT_GENERATOR,
  ...patch,
});

/** Render a binary grid as text so failures are readable. */
function show(cells: Uint8Array, width: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < cells.length; i += width) {
    out.push(
      [...cells.subarray(i, i + width)].map((v) => (v ? '#' : '.')).join('')
    );
  }
  return out;
}

describe('ruleTable', () => {
  it('decodes rule 90 as left XOR right', () => {
    const t = ruleTable(90);
    for (let n = 0; n < 8; n++) {
      const left = (n >> 2) & 1;
      const right = n & 1;
      expect(t[n]).toBe(left ^ right);
    }
  });

  it('decodes rule 150 as left XOR centre XOR right', () => {
    const t = ruleTable(150);
    for (let n = 0; n < 8; n++) {
      expect(t[n]).toBe(((n >> 2) & 1) ^ ((n >> 1) & 1) ^ (n & 1));
    }
  });

  it('rule 0 is all off and rule 255 all on', () => {
    expect([...ruleTable(0)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...ruleTable(255)]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });
});

describe('stepRule', () => {
  const t90 = ruleTable(90);

  it('spreads a single cell to both neighbours', () => {
    const row = Uint8Array.from([0, 0, 1, 0, 0]);
    expect([...stepRule(row, t90, false)]).toEqual([0, 1, 0, 1, 0]);
  });

  it('treats off-grid as empty when not wrapping', () => {
    const row = Uint8Array.from([1, 0, 0, 0, 0]);
    // The left neighbour of cell 0 is nothing, so only cell 1 lights up.
    expect([...stepRule(row, t90, false)]).toEqual([0, 1, 0, 0, 0]);
  });

  it('wraps around the cylinder when knitting in the round', () => {
    const row = Uint8Array.from([1, 0, 0, 0, 0]);
    // Cell 4's right neighbour is cell 0, so the run continues round the join.
    expect([...stepRule(row, t90, true)]).toEqual([0, 1, 0, 0, 1]);
  });
});

describe('seedCells', () => {
  it('centres a single cell by default', () => {
    expect([...seedCells(7, opts({ seed: 'center' }))]).toEqual([0, 0, 0, 1, 0, 0, 0]);
  });

  it('places the seed at either end', () => {
    expect([...seedCells(4, opts({ seed: 'left' }))]).toEqual([1, 0, 0, 0]);
    expect([...seedCells(4, opts({ seed: 'right' }))]).toEqual([0, 0, 0, 1]);
  });

  it('alternates every other stitch', () => {
    expect([...seedCells(5, opts({ seed: 'alternate' }))]).toEqual([1, 0, 1, 0, 1]);
  });

  it('uses the injected random source, so a run is reproducible', () => {
    const values = [0.1, 0.9, 0.2, 0.8];
    let i = 0;
    const cells = seedCells(4, opts({ seed: 'random', random: () => values[i++] }));
    expect([...cells]).toEqual([1, 0, 1, 0]);
  });

  it('takes an explicit seed row', () => {
    const seedRow = Uint8Array.from([0, 1, 1, 0]);
    expect([...seedCells(4, opts({ seed: 'row', seedRow }))]).toEqual([0, 1, 1, 0]);
  });
});

describe('generateRule', () => {
  it('reproduces the Sierpinski triangle from a centred seed', () => {
    // Pascal's triangle mod 2. Row 0 is the top, so the apex points up.
    expect(show(generateRule(9, 5, opts({ rule: 90 })), 9)).toEqual([
      '....#....',
      '...#.#...',
      '..#...#..',
      '.#.#.#.#.',
      '#.......#',
    ]);
  });

  it('matches binomial coefficients mod 2', () => {
    const n = 16;
    const width = n * 2 + 1;
    const cells = generateRule(width, n, opts({ rule: 90 }));
    // C(r, k) mod 2 lands at column (width>>1) - r + 2k on generation r.
    const centre = width >> 1;
    for (let r = 0; r < n; r++) {
      let c = 1; // C(r, 0)
      for (let k = 0; k <= r; k++) {
        const col = centre - r + 2 * k;
        expect(cells[r * width + col]).toBe(c % 2 === 1 ? 1 : 0);
        c = (c * (r - k)) / (k + 1);
      }
    }
  });

  it('leaves every generation blank under rule 0 when not restarting', () => {
    const cells = generateRule(5, 4, opts({ rule: 0, restart: false }));
    expect(show(cells, 5)).toEqual(['..#..', '.....', '.....', '.....']);
  });

  it('re-seeds when a generation burns out, so the chart is not left bare', () => {
    // Rule 90 with plain edges dies out on any width one less than a power of
    // two. 15 is the width you get from 60 stitches at 4 stitches per cell.
    const plain = generateRule(15, 12, opts({ rule: 90, restart: false }));
    expect(show(plain, 15).slice(8)).toEqual(['...............', '...............', '...............', '...............']);

    const repeated = generateRule(15, 12, opts({ rule: 90, restart: true }));
    expect(show(repeated, 15).slice(0, 8)).toEqual(show(plain, 15).slice(0, 8));
    // ...and then the triangle starts over rather than leaving bare fabric.
    expect(show(repeated, 15)[8]).toBe('.......#.......');
    expect(show(repeated, 15)[9]).toBe('......#.#......');
  });

  it('leaves rules that never die out alone', () => {
    const a = generateRule(31, 40, opts({ rule: 30, restart: false }));
    const b = generateRule(31, 40, opts({ rule: 30, restart: true }));
    expect([...a]).toEqual([...b]);
  });

  it('is deterministic for a fixed rule and seed', () => {
    const a = generateRule(20, 20, opts({ rule: 30 }));
    const b = generateRule(20, 20, opts({ rule: 30 }));
    expect([...a]).toEqual([...b]);
  });
});

describe('carpetCell', () => {
  it('punches out the centre of the 3x3 block at depth 1', () => {
    const rows: string[] = [];
    for (let y = 0; y < 3; y++) {
      let line = '';
      for (let x = 0; x < 3; x++) line += carpetCell(x, y, 1) ? '#' : '.';
      rows.push(line);
    }
    expect(rows).toEqual(['###', '#.#', '###']);
  });

  it('recurses into each surviving block at depth 2', () => {
    const rows: string[] = [];
    for (let y = 0; y < 9; y++) {
      let line = '';
      for (let x = 0; x < 9; x++) line += carpetCell(x, y, 2) ? '#' : '.';
      rows.push(line);
    }
    expect(rows).toEqual([
      '#########',
      '#.##.##.#',
      '#########',
      '###...###',
      '#.#...#.#',
      '###...###',
      '#########',
      '#.##.##.#',
      '#########',
    ]);
  });

  it('fills a 9x9 carpet with the same figure the cell test gives', () => {
    const cells = generateCarpet(9, 9, 2);
    expect(show(cells, 9)[4]).toBe('#.#...#.#');
  });

  it('tiles in phase when the chart is a whole number of motifs across', () => {
    // 18 wide at depth 2 is exactly two 9-wide carpets, so both must be intact.
    const cells = generateCarpet(18, 9, 2);
    expect(show(cells, 18)[4]).toBe('#.#...#.##.#...#.#');
  });

  it('trims both edges equally when the chart is not a whole number of motifs', () => {
    // 12 wide takes two 9-wide tiles (18), so 3 columns come off each side and
    // the join between the two carpets sits in the middle.
    const cells = generateCarpet(12, 9, 2);
    expect(show(cells, 12)[0]).toBe('############');
    expect(show(cells, 12)[4]).toBe('...#.##.#...');
  });
});

describe('generateStripes', () => {
  it('alternates rows by the two run lengths', () => {
    expect(show(generateStripes(3, 6, 2, 1, 'horizontal'), 3)).toEqual([
      '...',
      '...',
      '###',
      '...',
      '...',
      '###',
    ]);
  });

  it('runs down the chart when vertical', () => {
    expect(show(generateStripes(6, 2, 2, 1, 'vertical'), 6)).toEqual(['..#..#', '..#..#']);
  });

  it('treats a zero run as one so the pattern still has a period', () => {
    expect(show(generateStripes(2, 2, 0, 0, 'horizontal'), 2)).toEqual(['..', '##']);
  });
});

describe('generateChecks', () => {
  it('alternates blocks in both directions', () => {
    expect(show(generateChecks(4, 4, 2, 2), 4)).toEqual(['..##', '..##', '##..', '##..']);
  });

  it('handles oblong blocks', () => {
    expect(show(generateChecks(4, 2, 1, 2), 4)).toEqual(['.#.#', '.#.#']);
  });
});

describe('scaleGrid', () => {
  it('blows each cell up into a block', () => {
    const cells = Uint8Array.from([1, 0, 0, 1]);
    expect(show(scaleGrid(cells, 2, 2, 2, 3), 4)).toEqual([
      '##..',
      '##..',
      '##..',
      '..##',
      '..##',
      '..##',
    ]);
  });

  it('returns the input untouched at 1:1', () => {
    const cells = Uint8Array.from([1, 0]);
    expect(scaleGrid(cells, 2, 1, 1, 1)).toBe(cells);
  });
});

describe('cropGrid and flipVertical', () => {
  it('takes an offset window', () => {
    const cells = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...cropGrid(cells, 3, 1, 1, 2, 2)]).toEqual([4, 5, 7, 8]);
  });

  it('turns the chart upside down', () => {
    expect(show(flipVertical(Uint8Array.from([1, 1, 0, 0]), 2, 2), 2)).toEqual(['..', '##']);
  });
});

describe('gaugeRowScale', () => {
  it('adds rows because stitches are wider than they are tall', () => {
    // Worsted: 20 sts and 26 rows per 4in, so a square cell needs 1.3 rows.
    expect(gaugeRowScale({ stsPer4in: 20, rowsPer4in: 26, unit: 'in' }, 1)).toBe(1);
    expect(gaugeRowScale({ stsPer4in: 20, rowsPer4in: 26, unit: 'in' }, 4)).toBe(5);
    expect(gaugeRowScale({ stsPer4in: 20, rowsPer4in: 26, unit: 'in' }, 10)).toBe(13);
  });

  it('stays 1:1 for a square gauge', () => {
    expect(gaugeRowScale({ stsPer4in: 24, rowsPer4in: 24, unit: 'in' }, 3)).toBe(3);
  });

  it('never returns less than one row', () => {
    expect(gaugeRowScale({ stsPer4in: 40, rowsPer4in: 10, unit: 'in' }, 1)).toBe(1);
  });
});

describe('generatePattern', () => {
  it('maps on and off cells onto the chosen palette indices', () => {
    const grid = generatePattern(5, 2, { kind: 'stripes', runA: 1, runB: 1, bg: 2, fg: 7 });
    expect([...grid]).toEqual([2, 2, 2, 2, 2, 7, 7, 7, 7, 7]);
  });

  it('returns exactly stitches x rows even when the scale does not divide evenly', () => {
    const grid = generatePattern(10, 7, { kind: 'checks', scaleX: 3, scaleY: 4 });
    expect(grid.length).toBe(70);
  });

  it('keeps the triangle apex on the centre stitch', () => {
    const grid = generatePattern(9, 3, { kind: 'sierpinski' });
    expect(show(grid, 9)).toEqual(['....#....', '...#.#...', '..#...#..']);
  });

  it('flips the automaton when it starts from the bottom', () => {
    const top = show(generatePattern(9, 3, { kind: 'sierpinski', origin: 'top' }), 9);
    const bottom = show(generatePattern(9, 3, { kind: 'sierpinski', origin: 'bottom' }), 9);
    expect(bottom).toEqual([...top].reverse());
  });

  it('scales a triangle up without losing its shape', () => {
    const grid = generatePattern(6, 4, { kind: 'sierpinski', scaleX: 2, scaleY: 2 });
    expect(show(grid, 6)).toEqual(['..##..', '..##..', '##..##', '##..##']);
  });

  it('ignores the rule setting for named fractals', () => {
    const asNamed = generatePattern(9, 4, { kind: 'sierpinski', rule: 30, wrap: true });
    const asRule90 = generatePattern(9, 4, { kind: 'rule', rule: 90, seed: 'center', wrap: false });
    expect([...asNamed]).toEqual([...asRule90]);
  });
});

describe('seedRowFromChart', () => {
  it('reads anything that is not the background as a live stitch', () => {
    const grid = Uint8Array.from([0, 1, 0, 2, 0, 0]);
    expect([...seedRowFromChart(grid, 6, 0, 0, 1)]).toEqual([0, 1, 0, 1, 0, 0]);
  });

  it('samples every scaleX stitches to match the pattern grid', () => {
    const grid = Uint8Array.from([1, 0, 0, 0, 1, 0]);
    expect([...seedRowFromChart(grid, 6, 0, 0, 2)]).toEqual([1, 0, 1]);
  });

  it('reads the requested row, not always the first', () => {
    const grid = Uint8Array.from([0, 0, 1, 1]);
    expect([...seedRowFromChart(grid, 2, 1, 0, 1)]).toEqual([1, 1]);
  });
});

describe('generatorLabel', () => {
  it('names fractals plainly and rules by number', () => {
    expect(generatorLabel(opts({ kind: 'sierpinski' }))).toBe('Sierpinski triangle');
    expect(generatorLabel(opts({ kind: 'carpet' }))).toBe('Sierpinski carpet');
    expect(generatorLabel(opts({ kind: 'rule', rule: 30 }))).toBe('Rule 30');
    expect(generatorLabel(opts({ kind: 'stripes', axis: 'vertical' }))).toBe('Vertical stripes');
  });
});
