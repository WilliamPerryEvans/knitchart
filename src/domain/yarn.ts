import type { Gauge } from '../model/types';

/**
 * Typical stockinette gauges by yarn weight, as a starting point for people who
 * don't have a swatch yet. Stitch counts follow the Craft Yarn Council's
 * standard weight categories (the number in each label is the CYC symbol);
 * row counts are typical values for that weight, since CYC doesn't publish them.
 *
 * These are estimates. Real gauge varies by needle size, fibre, and knitter, so
 * the app treats them as a fill-in for the gauge fields, not a fixed property of
 * the chart — the numbers stay editable afterwards.
 */
export interface YarnWeight {
  id: string;
  label: string;
  /** Rough needle range, shown as a hint. */
  needles: string;
  stsPer4in: number;
  rowsPer4in: number;
}

export const YARN_WEIGHTS: YarnWeight[] = [
  { id: 'lace', label: 'Lace (0)', needles: '1.5–2.25 mm', stsPer4in: 36, rowsPer4in: 46 },
  {
    id: 'fingering',
    label: 'Fingering / Sock (1)',
    needles: '2.25–3.25 mm',
    stsPer4in: 28,
    rowsPer4in: 36,
  },
  { id: 'sport', label: 'Sport (2)', needles: '3.25–3.75 mm', stsPer4in: 24, rowsPer4in: 32 },
  { id: 'dk', label: 'DK (3)', needles: '3.75–4.5 mm', stsPer4in: 22, rowsPer4in: 30 },
  { id: 'worsted', label: 'Worsted (4)', needles: '4.5–5.5 mm', stsPer4in: 20, rowsPer4in: 26 },
  { id: 'aran', label: 'Aran (4)', needles: '5.5–6.5 mm', stsPer4in: 18, rowsPer4in: 24 },
  { id: 'bulky', label: 'Bulky / Chunky (5)', needles: '6.5–8 mm', stsPer4in: 14, rowsPer4in: 19 },
  {
    id: 'super-bulky',
    label: 'Super bulky (6)',
    needles: '8–12.75 mm',
    stsPer4in: 10,
    rowsPer4in: 13,
  },
  { id: 'jumbo', label: 'Jumbo (7)', needles: '12.75 mm+', stsPer4in: 6, rowsPer4in: 8 },
];

export const CUSTOM_WEIGHT_ID = 'custom';

/** The preset matching this gauge exactly, or null if the numbers are custom. */
export function matchYarnWeight(gauge: Pick<Gauge, 'stsPer4in' | 'rowsPer4in'>): YarnWeight | null {
  return (
    YARN_WEIGHTS.find(
      (w) => w.stsPer4in === gauge.stsPer4in && w.rowsPer4in === gauge.rowsPer4in
    ) ?? null
  );
}

export function yarnWeightById(id: string): YarnWeight | null {
  return YARN_WEIGHTS.find((w) => w.id === id) ?? null;
}
