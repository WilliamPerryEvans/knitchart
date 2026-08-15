import { useState } from 'react';
import { useStore } from '../state/store';

export function PalettePanel() {
  const palette = useStore((s) => s.chart.palette);
  const activeColor = useStore((s) => s.activeColor);
  const [swapFrom, setSwapFrom] = useState(0);
  const [swapTo, setSwapTo] = useState(1);

  return (
    <div className="panel">
      <h3>Palette</h3>
      <div className="palette-list">
        {palette.map((c) => (
          <div
            key={c.id}
            className={c.id === activeColor ? 'palette-row active' : 'palette-row'}
            onClick={() => useStore.getState().setActiveColor(c.id)}
          >
            <input
              type="color"
              value={c.hex}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => useStore.getState().updateColor(c.id, { hex: e.target.value })}
              title="Edit color"
            />
            <input
              className="palette-name"
              value={c.name ?? ''}
              placeholder={`Color ${c.id}`}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => useStore.getState().updateColor(c.id, { name: e.target.value })}
            />
            {c.id === activeColor && <span className="palette-active-mark">●</span>}
          </div>
        ))}
      </div>
      <button
        className="wide"
        disabled={palette.length >= 256}
        onClick={() => {
          const hues = ['#c92a2a', '#e8890c', '#2b8a3e', '#1971c2', '#862e9c', '#5f3dc4'];
          useStore.getState().addColor(hues[(palette.length - 2) % hues.length] ?? '#888888');
        }}
      >
        + Add color
      </button>

      <h4>Swap colors</h4>
      <div className="swap-row">
        <select value={swapFrom} onChange={(e) => setSwapFrom(+e.target.value)}>
          {palette.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || `Color ${c.id}`}
            </option>
          ))}
        </select>
        <span>→</span>
        <select value={swapTo} onChange={(e) => setSwapTo(+e.target.value)}>
          {palette.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || `Color ${c.id}`}
            </option>
          ))}
        </select>
      </div>
      <button
        className="wide"
        disabled={swapFrom === swapTo || swapFrom >= palette.length || swapTo >= palette.length}
        onClick={() => useStore.getState().swapColor(swapFrom, swapTo)}
        title="Repaint every stitch of the first color with the second (undoable)"
      >
        Swap across chart
      </button>
    </div>
  );
}
