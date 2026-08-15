import type { Chart, Direction } from '../model/types';

/**
 * Chart gutter labels. Shared by the on-screen canvas and the PNG/SVG export so
 * the printed chart matches what was edited.
 *
 * Conventions:
 * - Rows number from the BOTTOM, so grid row 0 (stored first) is the top row
 *   and displays as `rows`.
 * - Stitches number from the RIGHT, so stitch 1 is the bottom-right corner —
 *   the first stitch worked on a RS row.
 * - Flat knitting alternates sides: odd rows are RS (worked right-to-left),
 *   even rows are WS (worked left-to-right). Every round is RS.
 */

export type Side = 'RS' | 'WS';

/** Displayed row number for a grid row (grid row 0 is the top of the chart). */
export function rowNumber(rows: number, gridRow: number): number {
  return rows - gridRow;
}

/** Displayed stitch number for a column (column 0 is the left edge). */
export function stitchNumber(stitches: number, col: number): number {
  return stitches - col;
}

/** Which face of the fabric a row is worked on. */
export function rowSide(direction: Direction, rowNum: number): Side {
  if (direction === 'round') return 'RS'; // knit in a spiral, always facing out
  return rowNum % 2 === 1 ? 'RS' : 'WS';
}

/**
 * Which gutter a row's number sits in. RS rows read right-to-left so their
 * number goes on the right, where the row starts; WS rows get the left.
 */
export function rowNumberOnRight(direction: Direction, rowNum: number): boolean {
  return rowSide(direction, rowNum) === 'RS';
}

/** Reading-direction arrow for a row: RS is worked right-to-left. */
export function rowArrow(direction: Direction, rowNum: number): '←' | '→' {
  return rowSide(direction, rowNum) === 'RS' ? '←' : '→';
}

/**
 * Label every stitch when the cells are wide enough, otherwise every 5th or
 * 10th, so numbers never collide. `charWidth` is the width of one digit.
 */
export function stitchLabelStep(cellWidth: number, stitches: number, charWidth: number): number {
  const digits = String(stitches).length;
  const needed = digits * charWidth + 4; // label plus a little breathing room
  if (cellWidth >= needed) return 1;
  if (cellWidth * 5 >= needed) return 5;
  return 10;
}

/** Should this stitch number be drawn at the given step? Stitch 1 always is. */
export function showStitchLabel(num: number, step: number): boolean {
  return step === 1 || num === 1 || num % step === 0;
}

/** Row/side labels for every row of a chart, top to bottom. Handy for tests. */
export function rowLabels(chart: Chart): Array<{ num: number; side: Side; right: boolean }> {
  const out = [];
  for (let r = 0; r < chart.rows; r++) {
    const num = rowNumber(chart.rows, r);
    out.push({
      num,
      side: rowSide(chart.direction, num),
      right: rowNumberOnRight(chart.direction, num),
    });
  }
  return out;
}
