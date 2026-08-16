import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Installed-app housekeeping.
 *
 * The service worker is what lets the app open with no signal, which also means
 * a new version cannot appear until the running one is replaced. Reloading on
 * its own would throw away the row being drawn, so it asks — and the offline
 * notice is worth showing once, because "it works on the sofa with no signal"
 * is not something a web page is assumed to do.
 *
 * In the desktop build the plugin is disabled and `registerSW` is a no-op, so
 * neither callback fires and this renders nothing.
 */
export function UpdatePrompt() {
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const update = useRef<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    update.current = registerSW({
      onNeedRefresh: () => setNeedsRefresh(true),
      onOfflineReady: () => setOfflineReady(true),
    });
  }, []);

  if (needsRefresh) {
    return (
      <div className="restore-note" role="status">
        <span>A newer KnitChart is ready.</span>
        <button onClick={() => void update.current?.(true)}>Reload</button>
        <button className="restore-dismiss" aria-label="Later" onClick={() => setNeedsRefresh(false)}>
          ✕
        </button>
      </div>
    );
  }

  if (offlineReady) {
    return (
      <div className="restore-note" role="status">
        <span>Ready to use offline — your charts open with no signal.</span>
        <button
          className="restore-dismiss"
          aria-label="Dismiss"
          onClick={() => setOfflineReady(false)}
        >
          ✕
        </button>
      </div>
    );
  }

  return null;
}
