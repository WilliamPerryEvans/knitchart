import { useState } from 'react';
import { useStore } from '../state/store';
import type { Direction } from '../model/types';
import { CUSTOM_WEIGHT_ID, YARN_WEIGHTS, matchYarnWeight, yarnWeightById } from '../domain/yarn';

export function NewChartDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('Untitled chart');
  const [stitches, setStitches] = useState(40);
  const [rows, setRows] = useState(40);
  const [sts4, setSts4] = useState(20);
  const [rows4, setRows4] = useState(26);
  const [unit, setUnit] = useState<'in' | 'cm'>('in');
  const [direction, setDirection] = useState<Direction>('flat');

  const preset = matchYarnWeight({ stsPer4in: sts4, rowsPer4in: rows4 });
  const pickYarn = (id: string) => {
    const w = yarnWeightById(id);
    if (!w) return; // "Custom" — leave whatever numbers are typed
    setSts4(w.stsPer4in);
    setRows4(w.rowsPer4in);
  };

  const valid =
    stitches >= 1 && stitches <= 500 && rows >= 1 && rows <= 500 && sts4 > 0 && rows4 > 0;

  const create = () => {
    if (!valid) return;
    useStore.getState().newChart({
      title: title.trim() || 'Untitled chart',
      stitches: Math.round(stitches),
      rows: Math.round(rows),
      gauge: { stsPer4in: sts4, rowsPer4in: rows4, unit },
      direction,
    });
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>New chart</h2>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label>
          Yarn weight
          <select value={preset?.id ?? CUSTOM_WEIGHT_ID} onChange={(e) => pickYarn(e.target.value)}>
            {YARN_WEIGHTS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label} — about {w.stsPer4in} sts / {w.rowsPer4in} rows per 4"
              </option>
            ))}
            <option value={CUSTOM_WEIGHT_ID}>Custom gauge</option>
          </select>
        </label>
        <p className="dialog-note dialog-note-tight">
          {preset
            ? `Fills in a typical gauge for ${preset.label.replace(/\s*\(\d\)$/, '')} on ${
                preset.needles
              } needles. Swatch and adjust below if yours differs.`
            : 'Using your own gauge numbers. Measure a blocked swatch for the truest fit.'}
        </p>

        <div className="dialog-grid">
          <label>
            Stitches (width)
            <input
              type="number"
              min={1}
              max={500}
              value={stitches}
              onChange={(e) => setStitches(+e.target.value)}
            />
          </label>
          <label>
            Rows (height)
            <input
              type="number"
              min={1}
              max={500}
              value={rows}
              onChange={(e) => setRows(+e.target.value)}
            />
          </label>
          <label>
            Sts per {unit === 'in' ? '4"' : '10 cm'}
            <input
              type="number"
              min={1}
              step={0.5}
              value={sts4}
              onChange={(e) => setSts4(+e.target.value)}
            />
          </label>
          <label>
            Rows per {unit === 'in' ? '4"' : '10 cm'}
            <input
              type="number"
              min={1}
              step={0.5}
              value={rows4}
              onChange={(e) => setRows4(+e.target.value)}
            />
          </label>
          <label>
            Gauge unit
            <select value={unit} onChange={(e) => setUnit(e.target.value as 'in' | 'cm')}>
              <option value="in">inches (4")</option>
              <option value="cm">cm (10 cm)</option>
            </select>
          </label>
          <label>
            Knit direction
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as Direction)}
            >
              <option value="flat">Flat (back and forth)</option>
              <option value="round">In the round</option>
            </select>
          </label>
        </div>
        <p className="dialog-note">
          Cells will render {sts4 > 0 && rows4 > 0 ? (sts4 / rows4).toFixed(2) : '—'}× as tall as
          wide to match your gauge, so the preview looks like real fabric.
        </p>
        <div className="dialog-buttons">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!valid} onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
