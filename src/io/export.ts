import type { Chart } from '../model/types';
import { cellAspect } from '../model/gauge';
import { encodeRow } from '../model/rle';
import {
  rowArrow,
  rowNumber,
  rowNumberOnRight,
  rowSide,
  showStitchLabel,
  stitchLabelStep,
  stitchNumber,
} from '../domain/labels';

interface ExportOpts {
  /** Pixel width of one cell; height follows gauge. Default 40 (high-res). */
  cellPx?: number;
  /** Render square cells instead of gauge-proportioned. Default false. */
  square?: boolean;
  /** Include row numbers, RS/WS labels, and stitch numbers. Default true. */
  numbers?: boolean;
}

/**
 * Chart geometry plus gutters. The left gutter holds RS/WS labels and the
 * WS-row numbers; the right holds RS-row numbers; the bottom holds stitch
 * numbers. Gutters scale with the font so labels never collide.
 */
function metrics(chart: Chart, opts: ExportOpts) {
  const cw = opts.cellPx ?? 40;
  const ch = opts.square ? cw : cw * cellAspect(chart.gauge);
  const labels = opts.numbers !== false;
  const fs = Math.max(6, Math.round(ch * 0.6));
  const charW = fs * 0.62;
  const rowDigits = String(chart.rows).length;
  const sideW = labels ? charW * 2 + fs * 0.6 : 0; // "RS" / "WS"
  const numW = labels ? charW * (rowDigits + 2) + fs * 0.6 : 0; // "12 <-"
  const left = sideW + numW;
  const right = labels ? numW : 0;
  const bottom = labels ? fs * 1.7 : 0;
  return {
    cw,
    ch,
    fs,
    charW,
    left,
    right,
    bottom,
    sideX: left - fs * 0.4, // right edge of the RS/WS column
    numX: left - sideW - fs * 0.4, // right edge of the WS row-number column
    width: chart.stitches * cw + left + right,
    height: chart.rows * ch + bottom,
  };
}

/** Render the chart to a high-res PNG. Returns PNG bytes. */
export async function exportPng(chart: Chart, opts: ExportOpts = {}): Promise<Uint8Array> {
  const { cw, ch, fs, charW, left, sideX, numX, width, height } = metrics(chart, opts);
  const gridH = chart.rows * ch;
  const gridW = chart.stitches * cw;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // cells
  for (let r = 0; r < chart.rows; r++) {
    for (let c = 0; c < chart.stitches; c++) {
      ctx.fillStyle = chart.palette[chart.grid[r * chart.stitches + c]]?.hex ?? '#f0f';
      ctx.fillRect(left + c * cw, r * ch, cw + 0.5, ch + 0.5);
    }
  }

  // grid lines
  ctx.beginPath();
  for (let c = 0; c <= chart.stitches; c++) {
    ctx.moveTo(left + c * cw, 0);
    ctx.lineTo(left + c * cw, gridH);
  }
  for (let r = 0; r <= chart.rows; r++) {
    ctx.moveTo(left, r * ch);
    ctx.lineTo(left + gridW, r * ch);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, cw / 40);
  ctx.stroke();

  // heavy lines every 5 (counted from bottom-right, where knitting starts)
  ctx.beginPath();
  for (let c = chart.stitches; c >= 0; c -= 5) {
    ctx.moveTo(left + c * cw, 0);
    ctx.lineTo(left + c * cw, gridH);
  }
  for (let r = chart.rows; r >= 0; r -= 5) {
    ctx.moveTo(left, r * ch);
    ctx.lineTo(left + gridW, r * ch);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = Math.max(1.5, cw / 20);
  ctx.stroke();

  if (opts.numbers !== false) {
    ctx.font = `${fs}px system-ui, sans-serif`;

    // row numbers, RS/WS labels, direction arrows
    ctx.textBaseline = 'middle';
    for (let r = 0; r < chart.rows; r++) {
      const num = rowNumber(chart.rows, r);
      const y = (r + 0.5) * ch;
      const side = rowSide(chart.direction, num);
      const arrow = rowArrow(chart.direction, num);

      ctx.textAlign = 'right';
      ctx.fillStyle = side === 'RS' ? '#33506f' : '#7a6a58';
      ctx.fillText(side, sideX, y);

      ctx.fillStyle = '#222';
      if (rowNumberOnRight(chart.direction, num)) {
        ctx.textAlign = 'left';
        ctx.fillText(`${num} ${arrow}`, left + gridW + fs * 0.4, y);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(`${arrow} ${num}`, numX, y);
      }
    }

    // stitch numbers along the bottom, counted right-to-left
    ctx.fillStyle = '#222';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = stitchLabelStep(cw, chart.stitches, charW);
    for (let c = 0; c < chart.stitches; c++) {
      const num = stitchNumber(chart.stitches, c);
      if (!showStitchLabel(num, step)) continue;
      ctx.fillText(`${num}`, left + (c + 0.5) * cw, gridH + fs * 0.35);
    }
  }

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Render the chart to an SVG string. One rect per RLE run keeps it compact. */
export function exportSvg(chart: Chart, opts: ExportOpts = {}): string {
  const { cw, ch, fs, charW, left, sideX, numX, width, height } = metrics(chart, opts);
  const gridW = chart.stitches * cw;
  const gridH = chart.rows * ch;
  const fmt = (n: number) => +n.toFixed(2);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(
      height
    )}" viewBox="0 0 ${fmt(width)} ${fmt(height)}">`
  );
  parts.push(`<rect width="${fmt(width)}" height="${fmt(height)}" fill="#ffffff"/>`);

  // cells, merged horizontally per RLE run
  for (let r = 0; r < chart.rows; r++) {
    const rle = encodeRow(chart.grid.subarray(r * chart.stitches, (r + 1) * chart.stitches));
    let col = 0;
    for (const [color, run] of rle) {
      const hex = chart.palette[color]?.hex ?? '#f0f';
      parts.push(
        `<rect x="${fmt(left + col * cw)}" y="${fmt(r * ch)}" width="${fmt(
          run * cw
        )}" height="${fmt(ch)}" fill="${hex}"/>`
      );
      col += run;
    }
  }

  // grid lines
  const thin: string[] = [];
  const heavy: string[] = [];
  for (let c = 0; c <= chart.stitches; c++) {
    const x = fmt(left + c * cw);
    const d = `M${x} 0V${fmt(gridH)}`;
    ((chart.stitches - c) % 5 === 0 ? heavy : thin).push(d);
  }
  for (let r = 0; r <= chart.rows; r++) {
    const y = fmt(r * ch);
    const d = `M${fmt(left)} ${y}H${fmt(left + gridW)}`;
    ((chart.rows - r) % 5 === 0 ? heavy : thin).push(d);
  }
  parts.push(
    `<path d="${thin.join('')}" stroke="rgba(0,0,0,0.35)" stroke-width="${fmt(
      Math.max(1, cw / 40)
    )}" fill="none"/>`
  );
  parts.push(
    `<path d="${heavy.join('')}" stroke="rgba(0,0,0,0.8)" stroke-width="${fmt(
      Math.max(1.5, cw / 20)
    )}" fill="none"/>`
  );

  // row numbers, RS/WS labels, stitch numbers
  if (opts.numbers !== false) {
    const ARROW = { '←': '&#8592;', '→': '&#8594;' } as const;
    parts.push(`<g font-family="system-ui, sans-serif" font-size="${fs}" fill="#222">`);
    for (let r = 0; r < chart.rows; r++) {
      const num = rowNumber(chart.rows, r);
      const y = fmt((r + 0.5) * ch + fs * 0.35);
      const side = rowSide(chart.direction, num);
      const arrow = ARROW[rowArrow(chart.direction, num)];

      parts.push(
        `<text x="${fmt(sideX)}" y="${y}" text-anchor="end" fill="${
          side === 'RS' ? '#33506f' : '#7a6a58'
        }">${side}</text>`
      );

      if (rowNumberOnRight(chart.direction, num)) {
        parts.push(`<text x="${fmt(left + gridW + fs * 0.4)}" y="${y}">${num} ${arrow}</text>`);
      } else {
        parts.push(`<text x="${fmt(numX)}" y="${y}" text-anchor="end">${arrow} ${num}</text>`);
      }
    }

    const step = stitchLabelStep(cw, chart.stitches, charW);
    const stitchY = fmt(gridH + fs * 1.15);
    for (let c = 0; c < chart.stitches; c++) {
      const num = stitchNumber(chart.stitches, c);
      if (!showStitchLabel(num, step)) continue;
      parts.push(
        `<text x="${fmt(left + (c + 0.5) * cw)}" y="${stitchY}" text-anchor="middle">${num}</text>`
      );
    }
    parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('\n');
}
