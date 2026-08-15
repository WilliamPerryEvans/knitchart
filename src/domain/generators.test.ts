import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GENERATOR,
  carpetCell,
  cropGrid,
  flipVertical,
  gaugeRowScale,
  generateCarpet,
  generateChecks,
  generateEquilateral,
  generatePattern,
  generateRule,
  generateStripes,
  generatorLabel,
  inGasket,
  ruleTable,
  smallestTriangle,
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

describe('inGasket', () => {
  it('keeps all three corners at every depth', () => {
    for (const depth of [0, 1, 3, 6]) {
      expect(inGasket(1, 0, 0, depth)).toBe(true);
      expect(inGasket(0, 1, 0, depth)).toBe(true);
      expect(inGasket(0, 0, 1, depth)).toBe(true);
    }
  });

  it('punches out the middle from depth 1', () => {
    const third = 1 / 3;
    expect(inGasket(third, third, third, 0)).toBe(true); // depth 0 = solid triangle
    expect(inGasket(third, third, third, 1)).toBe(false);
    expect(inGasket(third, third, third, 4)).toBe(false);
  });

  it('rejects points outside the triangle', () => {
    expect(inGasket(1.2, -0.1, -0.1, 3)).toBe(false);
  });

  it('keeps the midpoint of an edge, which belongs to two corner sub-triangles', () => {
    expect(inGasket(0.5, 0.5, 0, 3)).toBe(true);
  });
});

describe('generateEquilateral', () => {
  /** Widest run of pattern cells in a row, and which row it is. */
  function widestRow(cells: Uint8Array, width: number, height: number) {
    let best = { row: -1, count: 0 };
    for (let r = 0; r < height; r++) {
      let count = 0;
      for (let c = 0; c < width; c++) if (cells[r * width + c]) count++;
      if (count > best.count) best = { row: r, count };
    }
    return best;
  }

  it('comes out equilateral in the finished fabric, not on the chart squares', () => {
    // Worsted: cells are 0.77 as tall as they are wide.
    const aspect = 20 / 26;
    const width = 80;
    const height = 80;
    const cells = generateEquilateral(width, height, 1, aspect);

    // The base is the widest row; the apex is the topmost occupied one.
    const base = widestRow(cells, width, height);
    let firstRow = height;
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (cells[r * width + c]) {
          firstRow = Math.min(firstRow, r);
          break;
        }
      }
    }
    const baseWidth = base.count; // in cell widths
    const triHeight = (base.row - firstRow + 1) * aspect; // also in cell widths
    expect(triHeight / baseWidth).toBeCloseTo(Math.sqrt(3) / 2, 1);
  });

  it('widens toward the base, with the central triangle bitten out', () => {
    const rows = show(generateEquilateral(27, 27, 1, 1), 27);
    const counts = rows.map((r) => r.split('#').length - 1);
    // The triangle is centred, so the top rows sit above the apex and are bare.
    const first = counts.findIndex((n) => n > 0);
    const last = counts.length - 1 - [...counts].reverse().findIndex((n) => n > 0);
    expect(first).toBeGreaterThan(0);
    expect(counts[last]).toBeGreaterThan(counts[first]);
    // Somewhere below halfway a row reads stitches, gap, stitches — the hole.
    expect(rows.some((r) => /#+\.+#+/.test(r))).toBe(true);
  });

  it('gets holier as the depth increases', () => {
    const count = (d: number) =>
      generateEquilateral(60, 60, d, 1).reduce((n, v) => n + v, 0);
    expect(count(1)).toBeGreaterThan(count(2));
    expect(count(2)).toBeGreaterThan(count(3));
  });

  it('survives a degenerate gauge without dividing by zero', () => {
    expect(() => generateEquilateral(10, 10, 3, 0)).not.toThrow();
  });

  it('never leaves a blank row inside the triangle', () => {
    // A gasket pinches to a single point wherever two sub-triangles meet.
    // Sampling only the stitch centre finds nothing there, which cut the motif
    // clean in half — at 40x40 depth 1, the row across the join was empty and
    // the top triangle floated free of the two beneath it.
    for (const depth of [1, 2, 3]) {
      for (const [w, h] of [[40, 40], [60, 78], [31, 47]]) {
        const cells = generateEquilateral(w, h, depth, 20 / 26);
        const filled = [];
        for (let r = 0; r < h; r++) {
          let n = 0;
          for (let c = 0; c < w; c++) if (cells[r * w + c]) n++;
          filled.push(n);
        }
        const first = filled.findIndex((n) => n > 0);
        const last = filled.length - 1 - [...filled].reverse().findIndex((n) => n > 0);
        const blank = filled.slice(first, last + 1).findIndex((n) => n === 0);
        expect(blank, `depth ${depth} on ${w}x${h}: row ${first + blank} is empty`).toBe(-1);
      }
    }
  });

  it('keeps each row joined to the next, so the motif is one piece', () => {
    // Neighbouring rows must overlap somewhere, or the chart shows islands.
    const w = 60;
    const h = 78;
    const cells = generateEquilateral(w, h, 3, 20 / 26);
    const cols = (r: number) => {
      const set = new Set<number>();
      for (let c = 0; c < w; c++) if (cells[r * w + c]) set.add(c);
      return set;
    };
    for (let r = 1; r < h; r++) {
      const above = cols(r - 1);
      const below = cols(r);
      if (above.size === 0 || below.size === 0) continue;
      const touching = [...below].some((c) => above.has(c) || above.has(c - 1) || above.has(c + 1));
      expect(touching, `row ${r} floats free of row ${r - 1}`).toBe(true);
    }
  });
});

describe('smallestTriangle', () => {
  it('halves with every level', () => {
    const one = smallestTriangle(64, 64, 1, 1);
    const two = smallestTriangle(64, 64, 2, 1);
    expect(two.stitches).toBe(Math.round(one.stitches / 2));
    expect(two.rows).toBe(Math.round(one.rows / 2));
  });

  it('reports the size the chart can actually show', () => {
    // 40 stitches at worsted fits a 35-stitch base; depth 3 divides it by 8.
    const s = smallestTriangle(40, 40, 3, 20 / 26);
    expect(s.stitches).toBeGreaterThan(2);
    expect(s.stitches).toBeLessThan(6);
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
