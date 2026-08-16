import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../state/store';
import {
  deleteFromLibrary,
  listCharts,
  loadFromLibrary,
  newId,
  renameInLibrary,
  saveToLibrary,
} from '../io/library';
import type { LibraryCard } from '../io/library';

/** "3 Aug", or "3 Aug 2025" once it is no longer this year. */
function whenSaved(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function LibraryDialog({ onClose }: { onClose: () => void }) {
  const chart = useStore((s) => s.chart);
  const libraryId = useStore((s) => s.libraryId);
  const dirty = useStore((s) => s.dirty);

  const [cards, setCards] = useState<LibraryCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const refresh = useCallback(async () => {
    try {
      setCards(await listCharts());
      setError(null);
    } catch (err) {
      setCards([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saved = cards?.find((c) => c.id === libraryId);

  const save = async (asCopy: boolean) => {
    setBusy(true);
    try {
      const s = useStore.getState();
      const id = asCopy || !s.libraryId ? newId() : s.libraryId;
      await saveToLibrary(s.chart, id, s.filePath);
      s.setLibraryId(id);
      s.markSaved();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const open = async (card: LibraryCard) => {
    // Everything on screen is autosaved, but opening replaces it — and if this
    // chart was never saved here, that copy is the only one.
    if (dirty && !libraryId) {
      const ok = confirm(
        `"${chart.title}" has not been saved to your charts. Open "${card.title}" and leave it behind?`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const result = await loadFromLibrary(card.id);
      if (!result) {
        await refresh();
        throw new Error('That chart is no longer here.');
      }
      useStore.getState().loadChart(result.chart, result.entry.filePath ?? null, card.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (card: LibraryCard) => {
    if (!confirm(`Delete "${card.title}"? This cannot be undone.`)) return;
    try {
      await deleteFromLibrary(card.id);
      if (useStore.getState().libraryId === card.id) useStore.getState().setLibraryId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const commitRename = async (id: string) => {
    try {
      const updated = await renameInLibrary(id, draftName);
      // The open chart and its saved copy must not drift apart in name.
      if (updated && useStore.getState().libraryId === id) {
        useStore.getState().setTitle(updated.title);
        useStore.getState().markSaved();
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenaming(null);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog-library" onClick={(e) => e.stopPropagation()}>
        <h2>Your charts</h2>

        <div className="library-save">
          <div className="library-save-what">
            <strong>{chart.title || 'Untitled chart'}</strong>
            <span>
              {chart.stitches} × {chart.rows}
              {saved ? ` · saved ${whenSaved(saved.modified)}` : ' · not saved here yet'}
            </span>
          </div>
          <div className="library-save-buttons">
            <button className="primary" disabled={busy} onClick={() => save(false)}>
              {libraryId ? 'Save changes' : 'Save to my charts'}
            </button>
            {libraryId && (
              <button disabled={busy} onClick={() => save(true)}>
                Save as a copy
              </button>
            )}
          </div>
        </div>

        {error && <p className="dialog-error">{error}</p>}

        {cards === null ? (
          <p className="dialog-note">Looking…</p>
        ) : cards.length === 0 ? (
          <p className="dialog-note">
            Nothing saved yet. Charts you save here stay in this browser, so they are one tap away
            next time — no file to find.
          </p>
        ) : (
          <ul className="library-grid">
            {cards.map((card) => (
              <li key={card.id} className={card.id === libraryId ? 'library-card open' : 'library-card'}>
                <button
                  className="library-open"
                  disabled={busy}
                  onClick={() => open(card)}
                  title={`Open "${card.title}"`}
                >
                  {card.thumbnail ? (
                    <img src={card.thumbnail} alt="" />
                  ) : (
                    <span className="library-nothumb">no preview</span>
                  )}
                </button>

                {renaming === card.id ? (
                  <input
                    className="library-rename"
                    value={draftName}
                    autoFocus
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => void commitRename(card.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(card.id);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <div className="library-title" title={card.title}>
                    {card.title}
                  </div>
                )}

                <div className="library-meta">
                  {card.stitches} × {card.rows} · {whenSaved(card.modified)}
                </div>
                <div className="library-actions">
                  <button
                    onClick={() => {
                      setDraftName(card.title);
                      setRenaming(card.id);
                    }}
                  >
                    Rename
                  </button>
                  <button onClick={() => void remove(card)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="dialog-note">
          These live in this browser on this device — clearing site data removes them, and they do
          not follow you to another phone or computer. Use <strong>Save</strong> or an export for a
          copy you can keep and share.
        </p>

        <div className="dialog-buttons">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
