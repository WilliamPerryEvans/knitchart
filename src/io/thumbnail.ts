import type { Chart } from '../model/types';
import { cellAspect } from '../model/gauge';
import { hexToRgb } from '../model/color';

export interface ThumbnailPixels {
  width: number;
  height: number;
  /**
   * RGBA, row-major, row 0 = top of the chart (same as `Chart.grid`).
   * Backed by a plain ArrayBuffer so it can be handed straight to `ImageData`.
   */
  data: Uint8ClampedArray<ArrayBuffer>;
}

export const THUMB_MAX_W = 132;
export const THUMB_MAX_H = 132;

/**
 * Shrink a chart to thumbnail pixels, in gauge proportions so a scarf does not
 * come back square.
 *
 * Each output pixel takes the *most common* palette index in the block it
 * covers rather than averaging. Averaging would invent colours that are not in
 * the palette — a navy-and-cream chart would thumbnail as a field of muddy
 * grey-blue, which tells a knitter nothing about the yarn they picked.
 */
export function thumbnailPixels(
  chart: Chart,
  maxW = THUMB_MAX_W,
  maxH = THUMB_MAX_H
): ThumbnailPixels {
  const asp = cellAspect(chart.gauge);
  const scale = Math.min(maxW / chart.stitches, maxH / (chart.rows * asp));
  const width = Math.max(1, Math.round(chart.stitches * scale));
  const height = Math.max(1, Math.round(chart.rows * asp * scale));

  const lut = chart.palette.map((p) => hexToRgb(p.hex));
  const counts = new Uint32Array(Math.max(1, chart.palette.length));
  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));

  for (let y = 0; y < height; y++) {
    const r0 = Math.floor((y * chart.rows) / height);
    const r1 = Math.max(r0 + 1, Math.floor(((y + 1) * chart.rows) / height));
    for (let x = 0; x < width; x++) {
      const c0 = Math.floor((x * chart.stitches) / width);
      const c1 = Math.max(c0 + 1, Math.floor(((x + 1) * chart.stitches) / width));

      counts.fill(0);
      for (let r = r0; r < r1 && r < chart.rows; r++) {
        const base = r * chart.stitches;
        for (let c = c0; c < c1 && c < chart.stitches; c++) {
          const idx = chart.grid[base + c];
          if (idx < counts.length) counts[idx]++;
        }
      }

      let best = 0;
      for (let i = 1; i < counts.length; i++) {
        if (counts[i] > counts[best]) best = i;
      }
      const rgb = lut[best] ?? [255, 0, 255];
      const o = (y * width + x) * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
  }

  return { width, height, data };
}

/**
 * A PNG data URL for the chart, or '' where there is no canvas to draw on
 * (unit tests). Callers treat '' as "no picture", never as an error.
 */
export function thumbnailDataUrl(chart: Chart, maxW = THUMB_MAX_W, maxH = THUMB_MAX_H): string {
  if (typeof document === 'undefined') return '';
  try {
    const px = thumbnailPixels(chart, maxW, maxH);
    const canvas = document.createElement('canvas');
    canvas.width = px.width;
    canvas.height = px.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}
