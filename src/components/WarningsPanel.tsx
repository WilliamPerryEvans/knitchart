import { useStore } from '../state/store';
import { rowNumber } from '../domain/labels';

/**
 * Cap on rendered rows. A busy chart can produce hundreds of warnings, and
 * rendering one DOM node each re-renders on every stroke and visibly slows
 * painting. The chart itself highlights every offending run, so the list only
 * needs to be a readable summary.
 */
const MAX_LISTED = 50;

export function WarningsPanel() {
  const warnings = useStore((s) => s.floatWarnings);
  const chart = useStore((s) => s.chart);
  const showHighlight = useStore((s) => s.showFloatHighlight);
  const listed = warnings.slice(0, MAX_LISTED);
  const hidden = warnings.length - listed.length;

  return (
    <div className="panel">
      <h3>
        Float check
        {warnings.length > 0 && <span className="warn-badge">{warnings.length}</span>}
      </h3>
      <p className="panel-help">
        Flags runs of one color long enough that the other yarn floats loosely
        behind the work. Marked with a red bar under the stitches on the chart.
      </p>
      <label className="threshold-label">
        Max float
        <input
          type="number"
          min={1}
          max={20}
          value={chart.floatThreshold}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v >= 1) useStore.getState().setFloatThreshold(v);
          }}
        />
        sts
      </label>
      <label className="threshold-label">
        <input
          type="checkbox"
          checked={showHighlight}
          onChange={(e) => useStore.getState().setShowFloatHighlight(e.target.checked)}
        />
        Mark them on the chart
      </label>
      {warnings.length === 0 ? (
        <div className="warn-empty">No floats longer than {chart.floatThreshold} sts.</div>
      ) : (
        <ul className="warn-list">
          {listed.map((w, idx) => {
            const displayRow = rowNumber(chart.rows, w.row);
            const colorName =
              chart.palette[w.color]?.name || `Color ${w.color}`;
            return (
              <li key={idx}>
                <span
                  className="warn-swatch"
                  style={{ background: chart.palette[w.color]?.hex }}
                />
                {chart.direction === 'round' ? 'Rnd' : 'Row'} {displayRow}: {w.len}-st float of{' '}
                {colorName}
                {w.wraps ? ' (wraps round)' : ''}
              </li>
            );
          })}
          {hidden > 0 && (
            <li className="warn-more">
              + {hidden} more {hidden === 1 ? 'float' : 'floats'} — all are highlighted on the chart
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
