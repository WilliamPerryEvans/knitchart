import type { Chart } from '../model/types';
import { chartToFile, fileToChart } from '../model/chartFile';

export const isTauri = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const FILTERS = [{ name: 'Knit chart', extensions: ['knitchart'] }];

/**
 * Save the chart. Returns the path written (Tauri) or null (browser download).
 * When `saveAs` is false and a path is known, overwrites silently.
 */
export async function saveChart(
  chart: Chart,
  currentPath: string | null,
  saveAs: boolean
): Promise<string | null> {
  const json = JSON.stringify(chartToFile(chart), null, 1);
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    let path = currentPath;
    if (saveAs || !path) {
      path = await save({
        filters: FILTERS,
        defaultPath: `${chart.title.replace(/[<>:"/\\|?*]/g, '_') || 'chart'}.knitchart`,
      });
      if (!path) return null; // user cancelled
    }
    if (!path.toLowerCase().endsWith('.knitchart')) path += '.knitchart';
    await writeTextFile(path, json);
    return path;
  }
  // Browser fallback: download
  downloadBlob(new Blob([json], { type: 'application/json' }), `${chart.title || 'chart'}.knitchart`);
  return null;
}

/** Open a chart. Returns chart + path, or null if cancelled. */
export async function openChart(): Promise<{ chart: Chart; path: string | null } | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ filters: FILTERS, multiple: false });
    if (!path || typeof path !== 'string') return null;
    const text = await readTextFile(path);
    return { chart: fileToChart(JSON.parse(text)), path };
  }
  // Browser fallback: file picker
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.knitchart,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try {
        resolve({ chart: fileToChart(JSON.parse(await f.text())), path: null });
      } catch (err) {
        reject(err);
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Save arbitrary bytes (PNG/SVG export) with a save dialog in Tauri, download in browser. */
export async function saveBytes(
  bytes: Uint8Array | string,
  defaultName: string,
  filterName: string,
  extension: string
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
    let path = await save({
      filters: [{ name: filterName, extensions: [extension] }],
      defaultPath: defaultName,
    });
    if (!path) return false;
    if (!path.toLowerCase().endsWith(`.${extension}`)) path += `.${extension}`;
    if (typeof bytes === 'string') await writeTextFile(path, bytes);
    else await writeFile(path, bytes);
    return true;
  }
  downloadBlob(
    typeof bytes === 'string'
      ? new Blob([bytes], { type: mimeFor(extension) })
      : new Blob([bytes.buffer as ArrayBuffer], { type: mimeFor(extension) }),
    defaultName
  );
  return true;
}

/**
 * Downloads need the right content type, not just the right file extension.
 * Every binary export used to be labelled `image/png`, so a saved PDF arrived
 * claiming to be an image — which desktop browsers shrug off but Android takes
 * seriously, offering it to an image viewer or refusing to open it at all.
 */
export function mimeFor(extension: string): string {
  switch (extension.toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'knitchart':
    case 'json':
      return 'application/json';
    case 'txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}
