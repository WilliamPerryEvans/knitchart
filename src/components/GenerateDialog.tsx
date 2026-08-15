import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  DEFAULT_GENERATOR,
  RULE_PRESETS,
  gaugeRowScale,
  generatePattern,
  generatorLabel,
  generatorSummary,
  seedRowFromChart,
  smallestTriangle,
  type GeneratorKind,
  type GeneratorOptions,
  type Origin,
  type SeedKind,
  type StripeAxis,
} from '../domain/generators';
import { cellAspect } from '../model/gauge';

const KINDS: Array<{ id: GeneratorKind; label: string; note: string }> = [
  {
    id: 'sierpinski',
    label: 'Sierpinski triangle',
    note: 'The classic fractal triangle, one stitch wider each side per row',
  },
  {
    id: 'equilateral',
    label: 'Equilateral Sierpinski',
    note: 'A true equilateral triangle once knitted, not on the chart squares',
  },
  { id: 'carpet', label: 'Sierpinski carpet', note: 'Square fractal, tiles all over' },
  { id: 'rule', label: 'Cellular automaton', note: 'Rule 90 and its 255 siblings' },
  { id: 'stripes', label: 'Stripes', note: 'Two colours, two run lengths' },
  { id: 'checks', label: 'Checks', note: 'Blocks in a checkerboard' },
];

const SEEDS: Array<{ id: SeedKind; label: string }> = [
  { id: 'center', label: 'One stitch, centred' },
  { id: 'left', label: 'One stitch at the left' },
  { id: 'right', label: 'One stitch at the right' },
  { id: 'alternate', label: 'Every other stitch' },
  { id: 'random', label: 'Random stitches' },
  { id: 'row', label: 'The row already on the chart' },
];

const PREVIEW_W = 300;
const PREVIEW_MAX_H = 260;

export function GenerateDialog({ onClose }: { onClose: () => void }) {
  const chart = useStore((s) => s.chart);
  const selection = useStore((s) => s.selection);
  const activeColor = useStore((s) => s.activeColor);

  const [target, setTarget] = useState<'chart' | 'selection'>(selection ? 'selection' : 'chart');
  const [opts, setOpts] = useState<GeneratorOptions>({
    ...DEFAULT_GENERATOR,
    fg: activeColor === 0 ? 1 : activeColor,
    // Knitting in the round makes the row a cylinder, so the automaton should
    // carry on across the join rather than stopping dead at the edges.
    wrap: chart.direction === 'round',
  });
  // A new random seed each time you press the button, rather than on every
  // keystroke — otherwise the preview would flicker as you type.
  const [randomNonce, setRandomNonce] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const set = <K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) =>
    setOpts((o) => ({ ...o, [key]: value }));

  const region = target === 'selection' ? selection : null;
  const width = region ? region.w : chart.stitches;
  const height = region ? region.h : chart.rows;

  const isAutomaton = opts.kind === 'sierpinski' || opts.kind === 'rule';

  // The equilateral triangle needs the fabric's proportions, not the chart's.
  const aspect = cellAspect(chart.gauge);
  const smallest = smallestTriangle(width, height, opts.depth, aspect);

  /** Options with the gauge and any chart-derived seed row filled in. */
  const resolved = useMemo<GeneratorOptions>(() => {
    const base = { ...opts, aspect };
    if (!isAutomaton || base.seed !== 'row') return base;
    // Seed from whichever end the automaton starts at.
    const gridRow = region
      ? base.origin === 'top'
        ? region.row
        : region.row + region.h - 1
      : base.origin === 'top'
        ? 0
        : chart.rows - 1;
    const col = region ? region.col : 0;
    const slice = chart.grid.subarray(gridRow * chart.stitches + col, gridRow * chart.stitches + col + width);
    return { ...base, seedRow: seedRowFromChart(slice, width, 0, base.bg, base.scaleX) };
  }, [opts, aspect, isAutomaton, region, chart.grid, chart.stitches, chart.rows, width]);

  const pattern = useMemo(() => {
    void randomNonce; // regenerate when the user asks for a new random seed
    return generatePattern(width, height, resolved);
  }, [width, height, resolved, randomNonce]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw one pixel per stitch, then scale up with smoothing off, so a 300x300
    // preview costs one blit instead of 90,000 rects.
    const src = document.createElement('canvas');
    src.width = width;
    src.height = height;
    const sctx = src.getContext('2d');
    if (!sctx) return;
    const image = sctx.createImageData(width, height);
    const rgb = chart.palette.map((c) => {
      const n = parseInt(c.hex.replace('#', ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    });
    for (let i = 0; i < pattern.length; i++) {
      const [r, g, b] = rgb[pattern[i]] ?? [128, 128, 128];
      image.data[i * 4] = r;
      image.data[i * 4 + 1] = g;
      image.data[i * 4 + 2] = b;
      image.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(image, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  }, [pattern, width, height, chart.palette]);

  // Preview keeps the fabric's proportions, so a squashed triangle looks
  // squashed here too rather than coming as a surprise off the needles.
  const previewH = Math.min(PREVIEW_MAX_H, Math.round((PREVIEW_W / width) * height * aspect));

  const apply = () => {
    const grid = Uint8Array.from(chart.grid);
    if (region) {
      for (let r = 0; r < region.h; r++) {
        for (let c = 0; c < region.w; c++) {
          grid[(region.row + r) * chart.stitches + region.col + c] = pattern[r * region.w + c];
        }
      }
    } else {
      grid.set(pattern);
    }
    useStore.getState().replaceGrid(generatorLabel(resolved), grid);
    onClose();
  };

  const colorOptions = chart.palette.map((c, i) => (
    <option key={i} value={i}>
      {c.name || c.hex}
    </option>
  ));

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog-generate" onClick={(e) => e.stopPropagation()}>
        <h2>Generate a pattern</h2>

        <div className="generate-body">
          <div className="generate-controls">
            <label>
              Pattern
              <select
                value={opts.kind}
                onChange={(e) => set('kind', e.target.value as GeneratorKind)}
              >
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="dialog-note generate-hint">
              {KINDS.find((k) => k.id === opts.kind)?.note}
            </p>

            {opts.kind === 'rule' && (
              <>
                <label>
                  Rule
                  <select value={opts.rule} onChange={(e) => set('rule', Number(e.target.value))}>
                    {RULE_PRESETS.map((p) => (
                      <option key={p.rule} value={p.rule}>
                        {p.label} — {p.note}
                      </option>
                    ))}
                    {!RULE_PRESETS.some((p) => p.rule === opts.rule) && (
                      <option value={opts.rule}>Rule {opts.rule}</option>
                    )}
                  </select>
                </label>
                <label>
                  Rule number (0–255)
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={opts.rule}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v >= 0 && v <= 255) set('rule', Math.floor(v));
                    }}
                  />
                </label>
                <label>
                  Start from
                  <select value={opts.seed} onChange={(e) => set('seed', e.target.value as SeedKind)}>
                    {SEEDS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                {opts.seed === 'random' && (
                  <button className="generate-reroll" onClick={() => setRandomNonce((n) => n + 1)}>
                    Try another random start
                  </button>
                )}
              </>
            )}

            {opts.kind === 'carpet' && (
              <label>
                Levels of detail
                <select value={opts.depth} onChange={(e) => set('depth', Number(e.target.value))}>
                  <option value={1}>1 — a single ring of blocks</option>
                  <option value={2}>2 — rings within rings</option>
                  <option value={3}>3 — the usual carpet</option>
                  <option value={4}>4 — very fine</option>
                </select>
              </label>
            )}

            {opts.kind === 'equilateral' && (
              <>
                <label>
                  Levels of detail
                  <select value={opts.depth} onChange={(e) => set('depth', Number(e.target.value))}>
                    <option value={1}>1 — one triangle, one hole</option>
                    <option value={2}>2 — three holes within</option>
                    <option value={3}>3 — the usual gasket</option>
                    <option value={4}>4 — fine</option>
                    <option value={5}>5 — very fine</option>
                  </select>
                </label>
                <p className="dialog-note generate-hint">
                  {smallest.stitches < 3 || smallest.rows < 3
                    ? `Too fine for this chart — the smallest triangle is only ${smallest.stitches} × ${smallest.rows} stitches. Use fewer levels, or more stitches.`
                    : `Smallest triangle: ${smallest.stitches} sts × ${smallest.rows} rows.`}
                </p>
                <label>
                  Apex points
                  <select
                    value={opts.origin}
                    onChange={(e) => set('origin', e.target.value as Origin)}
                  >
                    <option value="top">Up</option>
                    <option value="bottom">Down</option>
                  </select>
                </label>
              </>
            )}

            {opts.kind === 'stripes' && (
              <>
                <label>
                  Direction
                  <select
                    value={opts.axis}
                    onChange={(e) => set('axis', e.target.value as StripeAxis)}
                  >
                    <option value="horizontal">Across the rows</option>
                    <option value="vertical">Up the stitches</option>
                  </select>
                </label>
                <div className="dialog-grid">
                  <label>
                    First colour
                    <input
                      type="number"
                      min={1}
                      value={opts.runA}
                      onChange={(e) => set('runA', Math.max(1, Number(e.target.value)))}
                    />
                  </label>
                  <label>
                    Second colour
                    <input
                      type="number"
                      min={1}
                      value={opts.runB}
                      onChange={(e) => set('runB', Math.max(1, Number(e.target.value)))}
                    />
                  </label>
                </div>
              </>
            )}

            {opts.kind === 'checks' && (
              <div className="dialog-grid">
                <label>
                  Block width
                  <input
                    type="number"
                    min={1}
                    value={opts.blockW}
                    onChange={(e) => set('blockW', Math.max(1, Number(e.target.value)))}
                  />
                </label>
                <label>
                  Block height
                  <input
                    type="number"
                    min={1}
                    value={opts.blockH}
                    onChange={(e) => set('blockH', Math.max(1, Number(e.target.value)))}
                  />
                </label>
              </div>
            )}

            {opts.kind !== 'stripes' && opts.kind !== 'checks' && (
              <div className="dialog-grid">
                <label>
                  Stitches per cell
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={opts.scaleX}
                    onChange={(e) => set('scaleX', Math.max(1, Number(e.target.value)))}
                  />
                </label>
                <label>
                  Rows per cell
                  <input
                    type="number"
                    min={1}
                    max={32}
                    value={opts.scaleY}
                    onChange={(e) => set('scaleY', Math.max(1, Number(e.target.value)))}
                  />
                </label>
              </div>
            )}

            {opts.kind !== 'stripes' && opts.kind !== 'checks' && (
              <button
                className="generate-reroll"
                title="Stitches are wider than they are tall, so a square motif needs more rows than stitches"
                onClick={() => set('scaleY', gaugeRowScale(chart.gauge, opts.scaleX))}
              >
                Match my gauge ({opts.scaleX} × {gaugeRowScale(chart.gauge, opts.scaleX)})
              </button>
            )}

            {isAutomaton && (
              <>
                <label>
                  Grows from
                  <select
                    value={opts.origin}
                    onChange={(e) => set('origin', e.target.value as Origin)}
                  >
                    <option value="top">The top of the chart</option>
                    <option value="bottom">The bottom of the chart</option>
                  </select>
                </label>
                {opts.kind === 'rule' && (
                  <label className="checkbox-label dialog-check">
                    <input
                      type="checkbox"
                      checked={opts.wrap}
                      onChange={(e) => set('wrap', e.target.checked)}
                    />
                    Carry on across the join (for knitting in the round)
                  </label>
                )}
                <label
                  className="checkbox-label dialog-check"
                  title="Some rules run out partway up and would leave the rest of the chart plain"
                >
                  <input
                    type="checkbox"
                    checked={opts.restart}
                    onChange={(e) => set('restart', e.target.checked)}
                  />
                  Start over if the pattern runs out
                </label>
              </>
            )}

            <div className="dialog-grid">
              <label>
                Background
                <select value={opts.bg} onChange={(e) => set('bg', Number(e.target.value))}>
                  {colorOptions}
                </select>
              </label>
              <label>
                Pattern colour
                <select value={opts.fg} onChange={(e) => set('fg', Number(e.target.value))}>
                  {colorOptions}
                </select>
              </label>
            </div>

            {selection && (
              <label>
                Fill
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value === 'selection' ? 'selection' : 'chart')}
                >
                  <option value="selection">
                    The selection ({selection.w} × {selection.h})
                  </option>
                  <option value="chart">
                    The whole chart ({chart.stitches} × {chart.rows})
                  </option>
                </select>
              </label>
            )}
          </div>

          <div className="generate-preview">
            <canvas
              ref={canvasRef}
              width={PREVIEW_W}
              height={previewH}
              style={{ width: PREVIEW_W, height: previewH }}
            />
            <p className="dialog-note">{generatorSummary(resolved, chart.palette, width, height)}</p>
          </div>
        </div>

        <p className="dialog-note">
          This replaces {region ? 'the selected stitches' : 'everything on the chart'}. Undo puts it
          back.
        </p>

        <div className="dialog-buttons">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={apply}>
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
