import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { blockLabel, formatInstructions, instructionBlocks, rowInstructions } from '../domain/instructions';
import { estimateYarn, formatLength } from '../domain/yarnEstimate';
import { saveBytes } from '../io/file';

type Tab = 'instructions' | 'yarn';

export function PatternDialog({ onClose }: { onClose: () => void }) {
  const chart = useStore((s) => s.chart);
  const [tab, setTab] = useState<Tab>('instructions');
  const [copied, setCopied] = useState(false);

  const blocks = useMemo(() => instructionBlocks(rowInstructions(chart)), [chart]);
  const yarn = useMemo(() => estimateYarn(chart), [chart]);
  const round = chart.direction === 'round';

  const asText = () => {
    if (tab === 'instructions') return formatInstructions(chart);
    const lines = [
      `${chart.title || 'Untitled chart'} — yarn estimate`,
      'Includes yarn carried behind the work as floats, plus a 15% margin.',
      '',
      ...yarn.map(
        (u) =>
          `${u.name}: ${formatLength(u, 'yd')} / ${formatLength(u, 'm')} · ` +
          `${u.knitStitches} sts knitted, ${u.carriedStitches} sts carried`
      ),
    ];
    return lines.join('\n');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const saveText = async () => {
    const name = (chart.title || 'chart').replace(/[<>:"/\\|?*]/g, '_');
    const suffix = tab === 'instructions' ? 'instructions' : 'yarn';
    await saveBytes(asText(), `${name} - ${suffix}.txt`, 'Text file', 'txt');
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Pattern</h2>

        <div className="tab-row">
          <button
            className={tab === 'instructions' ? 'tab on' : 'tab'}
            onClick={() => setTab('instructions')}
          >
            Written instructions
          </button>
          <button className={tab === 'yarn' ? 'tab on' : 'tab'} onClick={() => setTab('yarn')}>
            Yarn estimate
          </button>
        </div>

        {tab === 'instructions' ? (
          <>
            <p className="dialog-note dialog-note-tight">
              {round
                ? 'Every round is worked right to left, knitting all stitches.'
                : 'RS rows are knitted right to left; WS rows are purled left to right.'}
            </p>
            <div className="pattern-scroll">
              {blocks.map((block, i) => (
                <div key={i} className="pattern-line">
                  <span className="pattern-label">{blockLabel(chart, block)}</span>
                  {block.kind === 'repeat' ? (
                    <span className="pattern-repeat">
                      repeat {round ? 'rnds' : 'rows'} {block.repeatFrom}–{block.repeatTo}
                    </span>
                  ) : (
                    <span>{block.body}</span>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="dialog-note dialog-note-tight">
              Counts the yarn carried behind the work as floats, plus a 15% margin. Yarn use
              varies with fibre, needles, and tension — buy a little over.
            </p>
            <div className="pattern-scroll">
              <table className="yarn-table">
                <thead>
                  <tr>
                    <th>Colour</th>
                    <th>Knitted</th>
                    <th>Carried</th>
                    <th>Estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {yarn.map((u) => (
                    <tr key={u.index}>
                      <td>
                        <span className="yarn-swatch" style={{ background: u.hex }} />
                        {u.name}
                      </td>
                      <td>{u.knitStitches.toLocaleString()}</td>
                      <td>{u.carriedStitches.toLocaleString()}</td>
                      <td>
                        {formatLength(u, 'yd')} <span className="yarn-alt">/ {formatLength(u, 'm')}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="dialog-buttons">
          <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button onClick={saveText}>Save as text</button>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
