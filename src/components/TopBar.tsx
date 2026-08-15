import { useState } from 'react';
import { useStore } from '../state/store';
import { openChart, saveBytes, saveChart } from '../io/file';
import { exportPng, exportSvg } from '../io/export';
import { finishedSize } from '../model/gauge';
import { CUSTOM_WEIGHT_ID, YARN_WEIGHTS, matchYarnWeight, yarnWeightById } from '../domain/yarn';

export function TopBar({
  onNewChart,
  onPrint,
  onPattern,
  onGenerate,
}: {
  onNewChart: () => void;
  onPrint: () => void;
  onPattern: () => void;
  onGenerate: () => void;
}) {
  const chart = useStore((s) => s.chart);
  const dirty = useStore((s) => s.dirty);
  const filePath = useStore((s) => s.filePath);
  const squareMode = useStore((s) => s.squareMode);
  const undoStack = useStore((s) => s.undoStack);
  const redoStack = useStore((s) => s.redoStack);
  const [busy, setBusy] = useState(false);

  const doSave = async (saveAs: boolean) => {
    const s = useStore.getState();
    const path = await saveChart(s.chart, s.filePath, saveAs);
    if (path) s.setFilePath(path);
    s.markSaved();
  };

  const doOpen = async () => {
    try {
      const result = await openChart();
      if (result) useStore.getState().loadChart(result.chart, result.path);
    } catch (err) {
      alert(`Could not open chart: ${err instanceof Error ? err.message : err}`);
    }
  };

  const doExport = async (kind: 'png' | 'svg') => {
    setBusy(true);
    try {
      const c = useStore.getState().chart;
      const name = (c.title || 'chart').replace(/[<>:"/\\|?*]/g, '_');
      if (kind === 'png') {
        await saveBytes(await exportPng(c), `${name}.png`, 'PNG image', 'png');
      } else {
        await saveBytes(exportSvg(c), `${name}.svg`, 'SVG image', 'svg');
      }
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  };

  const size = finishedSize(chart.gauge, chart.stitches, chart.rows);

  return (
    <div className="topbar">
      <div className="topbar-group">
        <button onClick={onNewChart}>New</button>
        <button onClick={doOpen}>Open</button>
        <button onClick={() => doSave(false)}>Save{dirty ? ' •' : ''}</button>
        <button onClick={() => doSave(true)}>Save As</button>
        <button onClick={onPrint} title="Print or save a PDF to knit from">
          PDF
        </button>
        <button onClick={onPattern} title="Written instructions and yarn estimate">
          Pattern
        </button>
        <button onClick={() => doExport('png')} disabled={busy}>
          PNG
        </button>
        <button onClick={() => doExport('svg')} disabled={busy}>
          SVG
        </button>
      </div>

      <div className="topbar-group">
        <button onClick={onGenerate} title="Fill the chart with a fractal or a repeat (Ctrl+G)">
          ✦ Generate
        </button>
        <button onClick={() => useStore.getState().undo()} disabled={undoStack.length === 0}>
          ↩ Undo
        </button>
        <button onClick={() => useStore.getState().redo()} disabled={redoStack.length === 0}>
          ↪ Redo
        </button>
      </div>

      <input
        className="title-input"
        value={chart.title}
        onChange={(e) => useStore.getState().setTitle(e.target.value)}
        placeholder="Chart title"
      />

      <div className="topbar-group">
        <label>
          Yarn
          <select
            value={matchYarnWeight(chart.gauge)?.id ?? CUSTOM_WEIGHT_ID}
            title="Fills in a typical gauge for this yarn weight"
            onChange={(e) => {
              const w = yarnWeightById(e.target.value);
              if (w) {
                useStore
                  .getState()
                  .setGauge({ ...chart.gauge, stsPer4in: w.stsPer4in, rowsPer4in: w.rowsPer4in });
              }
            }}
          >
            {YARN_WEIGHTS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
            <option value={CUSTOM_WEIGHT_ID}>Custom</option>
          </select>
        </label>
        <label>
          {chart.gauge.unit === 'in' ? 'Sts/4"' : 'Sts/10cm'}
          <input
            type="number"
            min={1}
            step={0.5}
            value={chart.gauge.stsPer4in}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (v > 0) useStore.getState().setGauge({ ...chart.gauge, stsPer4in: v });
            }}
          />
        </label>
        <label>
          {chart.gauge.unit === 'in' ? 'Rows/4"' : 'Rows/10cm'}
          <input
            type="number"
            min={1}
            step={0.5}
            value={chart.gauge.rowsPer4in}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (v > 0) useStore.getState().setGauge({ ...chart.gauge, rowsPer4in: v });
            }}
          />
        </label>
        <label>
          Direction
          <select
            value={chart.direction}
            onChange={(e) =>
              useStore.getState().setDirection(e.target.value === 'round' ? 'round' : 'flat')
            }
          >
            <option value="flat">Flat</option>
            <option value="round">In the round</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={squareMode}
            onChange={(e) => useStore.getState().setSquareMode(e.target.checked)}
          />
          Square grid
        </label>
      </div>

      <div className="topbar-status">
        {chart.stitches} × {chart.rows} · {size.width.toFixed(1)} × {size.height.toFixed(1)}{' '}
        {size.unit}
        {filePath ? ` · ${filePath.split(/[\\/]/).pop()}` : ''}
      </div>
    </div>
  );
}
