import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import type { Anchor, AnchorH, AnchorV } from '../domain/region';

const H: AnchorH[] = ['left', 'center', 'right'];
const V: AnchorV[] = ['top', 'middle', 'bottom'];

/** Add or remove stitches at one edge. */
function EdgeStepper({
  label,
  onChange,
  disabled,
}: {
  label: string;
  onChange: (delta: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="edge-row">
      <span className="edge-label">{label}</span>
      <button title={`Remove from ${label.toLowerCase()}`} disabled={disabled} onClick={() => onChange(-1)}>
        −
      </button>
      <button title={`Add to ${label.toLowerCase()}`} onClick={() => onChange(1)}>
        +
      </button>
    </div>
  );
}

export function ChartSizePanel() {
  const chart = useStore((s) => s.chart);
  const [anchor, setAnchor] = useState<Anchor>({ h: 'center', v: 'middle' });
  const [w, setW] = useState(String(chart.stitches));
  const [h, setH] = useState(String(chart.rows));

  // Follow the chart when it changes underneath us (resize, undo, open).
  useEffect(() => {
    setW(String(chart.stitches));
    setH(String(chart.rows));
  }, [chart.stitches, chart.rows]);

  const applySize = () => {
    const stitches = parseInt(w, 10);
    const rows = parseInt(h, 10);
    if (!Number.isFinite(stitches) || !Number.isFinite(rows)) return;
    useStore.getState().resizeTo(
      Math.max(1, Math.min(500, stitches)),
      Math.max(1, Math.min(500, rows)),
      anchor
    );
  };

  return (
    <div className="panel">
      <h3>Chart size</h3>

      <div className="edge-grid">
        <EdgeStepper
          label="Top"
          disabled={chart.rows <= 1}
          onChange={(d) => useStore.getState().resizeByEdges({ top: d })}
        />
        <EdgeStepper
          label="Bottom"
          disabled={chart.rows <= 1}
          onChange={(d) => useStore.getState().resizeByEdges({ bottom: d })}
        />
        <EdgeStepper
          label="Left"
          disabled={chart.stitches <= 1}
          onChange={(d) => useStore.getState().resizeByEdges({ left: d })}
        />
        <EdgeStepper
          label="Right"
          disabled={chart.stitches <= 1}
          onChange={(d) => useStore.getState().resizeByEdges({ right: d })}
        />
      </div>

      <h4>Set an exact size</h4>
      <div className="size-row">
        <input
          type="number"
          min={1}
          max={500}
          value={w}
          onChange={(e) => setW(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applySize()}
          title="Stitches across"
        />
        <span>×</span>
        <input
          type="number"
          min={1}
          max={500}
          value={h}
          onChange={(e) => setH(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applySize()}
          title="Rows tall"
        />
      </div>

      <div className="anchor-row">
        <div className="anchor-grid" title="Where the existing stitches sit in the new size">
          {V.map((v) =>
            H.map((hh) => (
              <button
                key={`${v}-${hh}`}
                className={anchor.v === v && anchor.h === hh ? 'anchor on' : 'anchor'}
                aria-label={`Anchor ${v} ${hh}`}
                onClick={() => setAnchor({ h: hh, v })}
              />
            ))
          )}
        </div>
        <button
          className="apply-size"
          disabled={+w === chart.stitches && +h === chart.rows}
          onClick={applySize}
        >
          Resize
        </button>
      </div>

      <button
        className="wide"
        title="Trim empty background from all four edges"
        onClick={() => useStore.getState().cropToContent()}
      >
        Crop to content
      </button>
    </div>
  );
}
