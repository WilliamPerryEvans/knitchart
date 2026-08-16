import { useEffect, useState } from 'react';
import { useStore } from './store';
import { chartFromEntry, readWorking, saveWorking } from '../io/library';

/**
 * Long enough that a fast stroke writes once instead of forty times, short
 * enough that almost nothing is lost if the tab dies mid-row.
 */
export const AUTOSAVE_DEBOUNCE_MS = 1200;

/**
 * Restore the chart that was on screen last time, then keep writing it back as
 * it changes.
 *
 * A phone browser can drop a background tab without warning, and the desktop
 * app can be closed on an unsaved chart. Either way this is what stands between
 * that and losing the work — which has already happened once on this project.
 */
export function useAutosave(): { restored: boolean; dismissRestored: () => void } {
  const [ready, setReady] = useState(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let alive = true;
    readWorking()
      .then((entry) => {
        if (!alive || !entry) return;
        try {
          useStore
            .getState()
            .loadChart(chartFromEntry(entry), entry.filePath ?? null, entry.sourceId ?? null);
          setRestored(true);
        } catch {
          // A corrupt slot is not worth refusing to start over. The blank chart
          // the app opened with stands, and the next edit overwrites the slot.
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // Nothing may be written before the restore has had its say, or the blank
    // startup chart would overwrite the work we are about to bring back.
    if (!ready) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      const s = useStore.getState();
      void saveWorking(s.chart, { filePath: s.filePath, sourceId: s.libraryId });
    };

    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.chart === prev.chart && state.gridVersion === prev.gridVersion) return;
      clearTimeout(timer);
      timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    });

    // Android can kill a backgrounded tab immediately, so waiting out the
    // debounce is exactly the case where the save would not happen.
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timer);
        flush();
      }
    };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      unsubscribe();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [ready]);

  return { restored, dismissRestored: () => setRestored(false) };
}
