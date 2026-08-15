import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { DEFAULT_PDF_OPTIONS, estimatePages, exportPdf, type PdfOptions } from '../io/pdf';
import { saveBytes } from '../io/file';
import type { Orientation, PageSizeId } from '../domain/pageLayout';

const SIZES: Array<{ id: PageSizeId; label: string }> = [
  { id: 'letter', label: 'Letter (8.5 × 11")' },
  { id: 'a4', label: 'A4 (210 × 297 mm)' },
  { id: 'legal', label: 'Legal (8.5 × 14")' },
];

const STITCH_SIZES = [
  { value: 4, label: 'Small — 4 mm' },
  { value: 5, label: 'Compact — 5 mm' },
  { value: 6, label: 'Comfortable — 6 mm' },
  { value: 8, label: 'Large print — 8 mm' },
  { value: 10, label: 'Extra large — 10 mm' },
];

export function PdfDialog({ onClose }: { onClose: () => void }) {
  const chart = useStore((s) => s.chart);
  const [opts, setOpts] = useState<PdfOptions>(DEFAULT_PDF_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof PdfOptions>(key: K, value: PdfOptions[K]) =>
    setOpts((o) => ({ ...o, [key]: value }));

  const pages = useMemo(() => {
    try {
      return estimatePages(chart, opts);
    } catch {
      return 0;
    }
  }, [chart, opts]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const bytes = await exportPdf(chart, opts);
      const name = (chart.title || 'chart').replace(/[<>:"/\\|?*]/g, '_');
      await saveBytes(bytes, `${name}.pdf`, 'PDF document', 'pdf');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Print / PDF</h2>

        <div className="dialog-grid">
          <label>
            Paper size
            <select
              value={opts.pageSize}
              onChange={(e) => set('pageSize', e.target.value as PageSizeId)}
            >
              {SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Orientation
            <select
              value={opts.orientation}
              onChange={(e) => set('orientation', e.target.value as Orientation)}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label>
            Stitch size
            <select
              value={String(opts.cellSizeMm)}
              onChange={(e) =>
                set('cellSizeMm', e.target.value === 'fit' ? 'fit' : Number(e.target.value))
              }
            >
              {STITCH_SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
              <option value="fit">Fit on one page</option>
            </select>
          </label>
          <label>
            Page overlap
            <select value={opts.overlap} onChange={(e) => set('overlap', Number(e.target.value))}>
              <option value={0}>None</option>
              <option value={1}>1 stitch</option>
              <option value={2}>2 stitches</option>
              <option value={4}>4 stitches</option>
            </select>
          </label>
        </div>

        <label className="checkbox-label dialog-check">
          <input
            type="checkbox"
            checked={opts.includeLegend}
            onChange={(e) => set('includeLegend', e.target.checked)}
          />
          Print the color key on every page
        </label>
        <label className="checkbox-label dialog-check">
          <input
            type="checkbox"
            checked={opts.squareCells}
            onChange={(e) => set('squareCells', e.target.checked)}
          />
          Square cells instead of gauge proportions
        </label>

        <p className="dialog-note">
          {pages === 0
            ? 'Stitches are too big for this page — pick a smaller size, bigger paper, or landscape.'
            : pages === 1
              ? 'Fits on a single page.'
              : `${pages} pages, to be taped together${
                  opts.overlap > 0
                    ? `. Neighbouring pages share ${opts.overlap} ${
                        opts.overlap === 1 ? 'stitch' : 'stitches'
                      }, marked with a dashed line.`
                    : '.'
                }`}
        </p>
        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-buttons">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || pages === 0} onClick={save}>
            {busy ? 'Building…' : 'Save PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
