import { useState } from 'react';
import { useStore } from '../state/store';

export function PalettePanel() {
  const palette = useStore((s) => s.chart.palette);
  const activeColor = useStore((s) => s.activeColor);
  const [swapFrom, setSwapFrom] = useState(0);
  const [swapTo, setSwapTo] = useState(1);
  /** Index pending deletion, and what its stitches should become. */
  const [deleting, setDeleting] = useState<number | null>(null);
  const [replaceWith, setReplaceWith] = useState(0);

  return (
    <div className="panel">
      <h3>Palette</h3>
      <div className="palette-list">
        {palette.map((c, index) => (
          <div
            key={c.id}
            className={c.id === activeColor ? 'palette-row active' : 'palette-row'}
            onClick={() => useStore.getState().setActiveColor(c.id)}
          >
            {/* The swatch opens the color picker, so picking a color to paint
                with needs its own target. */}
            <button
              className={c.id === activeColor ? 'palette-pick on' : 'palette-pick'}
              title={`Paint with ${c.name || `color ${c.id}`}`}
              aria-pressed={c.id === activeColor}
              onClick={(e) => {
                e.stopPropagation();
                useStore.getState().setActiveColor(c.id);
              }}
            >
              {c.id === activeColor ? '●' : ''}
            </button>
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
            <div className="palette-actions">
              <button
                className="mini"
                title="Move up"
                disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  useStore.getState().reorderColor(index, index - 1);
                }}
              >
                ▲
              </button>
              <button
                className="mini"
                title="Move down"
                disabled={index === palette.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  useStore.getState().reorderColor(index, index + 1);
                }}
              >
                ▼
              </button>
              <button
                className="mini danger"
                title="Delete this color"
                disabled={palette.length <= 1}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleting(index);
                  // default the replacement to MC, unless MC is what's going
                  setReplaceWith(index === 0 ? 1 : 0);
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {deleting !== null && palette[deleting] && (
        <div className="delete-prompt">
          <div>
            Replace every <strong>{palette[deleting].name || `color ${deleting}`}</strong> stitch
            with:
          </div>
          <select value={replaceWith} onChange={(e) => setReplaceWith(+e.target.value)}>
            {palette.map(
              (c, index) =>
                index !== deleting && (
                  <option key={c.id} value={index}>
                    {c.name || `Color ${index}`}
                  </option>
                )
            )}
          </select>
          <div className="delete-prompt-buttons">
            <button onClick={() => setDeleting(null)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                useStore.getState().deleteColor(deleting, replaceWith);
                setDeleting(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
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
