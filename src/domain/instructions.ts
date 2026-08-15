/**
 * Turning a chart into written knitting instructions.
 *
 * The direction rules matter more than the formatting here. Row 1 is the bottom
 * of the chart and you work upward. A RS row is worked right-to-left across the
 * chart and knitted; a WS row is worked left-to-right and purled. Every round of
 * a chart knit in the round is worked right-to-left and knitted. Reading a row
 * in the wrong direction produces a mirrored garment, so this is the part to get
 * right.
 */

import type { Chart } from '../model/types';
import { rowNumber, rowSide, type Side } from './labels';
import { encodeRow } from '../model/rle';

export interface RowInstruction {
  /** Knitting row number, counted from the bottom. */
  row: number;
  side: Side;
  /** "k3 MC, k1 CC1" — the stitches in the order they are worked. */
  body: string;
  stitches: number;
}

export type InstructionBlock =
  | {
      kind: 'rows';
      fromRow: number;
      toRow: number;
      side: Side;
      body: string;
      stitches: number;
    }
  | {
      kind: 'repeat';
      fromRow: number;
      toRow: number;
      /** The earlier rows to work again. */
      repeatFrom: number;
      repeatTo: number;
    };

export interface InstructionOptions {
  /** Say "Rnd" instead of "Row" — set automatically from the chart. */
  roundLabel?: boolean;
  /** Collapse a chart that repeats into "repeat rows 1–n". Default true. */
  detectRepeats?: boolean;
}

/** Palette name, falling back to a stable label so output is never blank. */
export function colorName(chart: Chart, index: number): string {
  return chart.palette[index]?.name?.trim() || `Color ${index}`;
}

/**
 * The stitches of one grid row in the order they are worked.
 * RS rows (and all rounds) start at the chart's right edge.
 */
export function workingOrder(chart: Chart, gridRow: number, side: Side): Uint8Array {
  const start = gridRow * chart.stitches;
  const slice = chart.grid.slice(start, start + chart.stitches);
  // The chart's rightmost column is stitch 1, so RS rows read the array backwards.
  return side === 'RS' ? slice.reverse() : slice;
}

/** One row's instruction text, e.g. "k3 MC, k1 CC1, k3 MC". */
export function rowBody(chart: Chart, gridRow: number, side: Side): string {
  const stitch = side === 'RS' || chart.direction === 'round' ? 'k' : 'p';
  const runs = encodeRow(workingOrder(chart, gridRow, side));
  return runs.map(([color, count]) => `${stitch}${count} ${colorName(chart, color)}`).join(', ');
}

export function rowInstructions(chart: Chart): RowInstruction[] {
  const out: RowInstruction[] = [];
  // Work bottom-up: the last grid row is row 1.
  for (let gridRow = chart.rows - 1; gridRow >= 0; gridRow--) {
    const row = rowNumber(chart.rows, gridRow);
    const side = rowSide(chart.direction, row);
    out.push({ row, side, body: rowBody(chart, gridRow, side), stitches: chart.stitches });
  }
  return out;
}

/**
 * Smallest number of rows the chart repeats on, or null if it never does.
 * A 2-row stripe returns 2, so the pattern can say "repeat rows 1–2".
 */
export function findRepeatPeriod(rows: RowInstruction[]): number | null {
  const n = rows.length;
  // A period only helps if the chart is longer than it.
  for (let period = 1; period < n; period++) {
    let matches = true;
    for (let i = period; i < n; i++) {
      if (rows[i].body !== rows[i - period].body || rows[i].side !== rows[i - period].side) {
        matches = false;
        break;
      }
    }
    if (matches) return period;
  }
  return null;
}

/**
 * Group rows into blocks: identical neighbours merge, and a repeating chart
 * collapses to its first cycle plus a "repeat" instruction.
 */
export function instructionBlocks(
  rows: RowInstruction[],
  options: InstructionOptions = {}
): InstructionBlock[] {
  if (rows.length === 0) return [];
  const detect = options.detectRepeats !== false;

  let literal = rows;
  let repeatBlock: InstructionBlock | null = null;
  if (detect) {
    const period = findRepeatPeriod(rows);
    // A period of 1 means every row is the same; merging those into
    // "Rows 1–8: ..." reads better than "Row 1: ... / Rows 2–8: repeat row 1".
    // Beyond that, only collapse when a full cycle is actually saved.
    if (period !== null && period >= 2 && rows.length >= period * 2) {
      literal = rows.slice(0, period);
      repeatBlock = {
        kind: 'repeat',
        fromRow: rows[period].row,
        toRow: rows[rows.length - 1].row,
        repeatFrom: rows[0].row,
        repeatTo: rows[period - 1].row,
      };
    }
  }

  const blocks: InstructionBlock[] = [];
  for (const row of literal) {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'rows' && last.body === row.body && last.side === row.side) {
      last.toRow = row.row;
      continue;
    }
    blocks.push({
      kind: 'rows',
      fromRow: row.row,
      toRow: row.row,
      side: row.side,
      body: row.body,
      stitches: row.stitches,
    });
  }
  if (repeatBlock) blocks.push(repeatBlock);
  return blocks;
}

/** "Row 3 (RS)" / "Rows 3–6 (RS)" / "Rnds 3–6". */
export function blockLabel(chart: Chart, block: InstructionBlock): string {
  const round = chart.direction === 'round';
  const noun = round ? 'Rnd' : 'Row';
  const plural = block.fromRow !== block.toRow;
  const range = plural
    ? `${noun}s ${block.fromRow}–${block.toRow}`
    : `${noun} ${block.fromRow}`;
  if (block.kind === 'repeat') return range;
  // Round charts are all RS, so the label would be noise.
  return round ? range : `${range} (${block.side})`;
}

/** The whole pattern as plain text, ready to paste or save. */
export function formatInstructions(chart: Chart, options: InstructionOptions = {}): string {
  const rows = rowInstructions(chart);
  const blocks = instructionBlocks(rows, options);
  const round = chart.direction === 'round';

  const lines: string[] = [];
  lines.push(chart.title || 'Untitled chart');
  lines.push(
    `${chart.stitches} sts x ${chart.rows} ${round ? 'rnds' : 'rows'} · ` +
      `${round ? 'worked in the round' : 'worked flat'}`
  );
  lines.push('');
  lines.push(
    round
      ? 'Every round is worked right to left, knitting all stitches.'
      : 'RS rows are knitted right to left; WS rows are purled left to right.'
  );
  lines.push('');

  for (const block of blocks) {
    if (block.kind === 'repeat') {
      const noun = round ? 'rnds' : 'rows';
      const target =
        block.repeatFrom === block.repeatTo
          ? `${noun.slice(0, -1)} ${block.repeatFrom}`
          : `${noun} ${block.repeatFrom}–${block.repeatTo}`;
      lines.push(`${blockLabel(chart, block)}: repeat ${target}.`);
    } else {
      lines.push(`${blockLabel(chart, block)}: ${block.body}. (${block.stitches} sts)`);
    }
  }
  return lines.join('\n');
}
