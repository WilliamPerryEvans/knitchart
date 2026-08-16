import type { Chart, KnitChartFile } from '../model/types';
import { chartToFile, fileToChart } from '../model/chartFile';
import { thumbnailDataUrl } from './thumbnail';

/**
 * Charts saved inside the browser.
 *
 * On a phone "Save" means downloading a file into a Downloads folder, which is
 * not a thing anyone does twice. This is the other half: a list of charts the
 * app itself keeps, plus a working slot that is rewritten as you draw so a
 * killed tab does not cost you the afternoon.
 *
 * Entries hold the same validated `KnitChartFile` that `.knitchart` files hold,
 * so a chart can move between the library, a file and the desktop app without
 * a second format to keep in step.
 */
export interface LibraryEntry {
  id: string;
  title: string;
  /** ISO timestamp, from the file's own meta so the two never disagree. */
  modified: string;
  stitches: number;
  rows: number;
  /** PNG data URL, or '' if none could be drawn. */
  thumbnail: string;
  file: KnitChartFile;
  /** Desktop: the .knitchart path this came from, so Save still overwrites it. */
  filePath?: string | null;
  /** Working slot only: which saved chart this is a working copy of. */
  sourceId?: string | null;
}

/** An entry without the chart data — enough to draw the Charts screen. */
export type LibraryCard = Omit<LibraryEntry, 'file'>;

export interface LibraryDriver {
  put(entry: LibraryEntry): Promise<void>;
  get(id: string): Promise<LibraryEntry | null>;
  all(): Promise<LibraryEntry[]>;
  remove(id: string): Promise<void>;
}

/** Reserved id for the autosaved working chart. Never listed as a saved chart. */
export const WORKING_ID = '__working';

export function newId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Build a storable entry from a chart. Pure: the thumbnail is passed in. */
export function entryFor(
  chart: Chart,
  id: string,
  thumbnail = '',
  extra: Pick<LibraryEntry, 'filePath' | 'sourceId'> | Record<string, never> = {}
): LibraryEntry {
  const file = chartToFile(chart);
  return {
    id,
    title: chart.title.trim() || 'Untitled chart',
    modified: file.meta.modified,
    stitches: chart.stitches,
    rows: chart.rows,
    thumbnail,
    ...extra,
    file,
  };
}

export function chartFromEntry(entry: LibraryEntry): Chart {
  return fileToChart(entry.file);
}

/** Saved charts only, newest first, with the bulky chart data dropped. */
export function toCards(entries: LibraryEntry[]): LibraryCard[] {
  return entries
    .filter((e) => e.id !== WORKING_ID)
    .map(({ file: _file, ...card }) => card)
    .sort((a, b) => b.modified.localeCompare(a.modified) || a.title.localeCompare(b.title));
}

// ---- drivers ---------------------------------------------------------------

export function createMemoryDriver(): LibraryDriver {
  const map = new Map<string, LibraryEntry>();
  return {
    async put(entry) {
      map.set(entry.id, entry);
    },
    async get(id) {
      return map.get(id) ?? null;
    },
    async all() {
      return [...map.values()];
    },
    async remove(id) {
      map.delete(id);
    },
  };
}

const DB_NAME = 'knitchart';
const DB_VERSION = 1;
const STORE = 'charts';

function settle<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function createIndexedDbDriver(): LibraryDriver {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const db = () => {
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        // Another tab is holding an older version open. Fail rather than hang.
        req.onblocked = () => reject(new Error('Chart library is open in another tab'));
      }).catch((err) => {
        dbPromise = null; // let the next call try again
        throw err;
      });
    }
    return dbPromise;
  };

  const tx = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>) => {
    const store = (await db()).transaction(STORE, mode).objectStore(STORE);
    return run(store);
  };

  return {
    put: (entry) => tx('readwrite', async (s) => void (await settle(s.put(entry)))),
    get: (id) =>
      tx('readonly', async (s) => ((await settle(s.get(id))) as LibraryEntry | undefined) ?? null),
    all: () => tx('readonly', async (s) => ((await settle(s.getAll())) as LibraryEntry[]) ?? []),
    remove: (id) => tx('readwrite', async (s) => void (await settle(s.delete(id)))),
  };
}

let active: LibraryDriver | null = null;

/**
 * IndexedDB where it exists, memory otherwise. Private-mode browsers and the
 * unit tests both land on memory: the library then lasts one session instead of
 * throwing, which is the right failure for a drawing app.
 */
export function libraryDriver(): LibraryDriver {
  if (!active) {
    active = typeof indexedDB !== 'undefined' ? createIndexedDbDriver() : createMemoryDriver();
  }
  return active;
}

/** Tests only: swap the driver, or pass null to fall back to detection. */
export function setLibraryDriver(driver: LibraryDriver | null) {
  active = driver;
}

// ---- operations ------------------------------------------------------------

export async function listCharts(driver: LibraryDriver = libraryDriver()): Promise<LibraryCard[]> {
  return toCards(await driver.all());
}

/** Save (or overwrite) a chart in the library. Returns the entry written. */
export async function saveToLibrary(
  chart: Chart,
  id: string = newId(),
  filePath: string | null = null,
  driver: LibraryDriver = libraryDriver()
): Promise<LibraryEntry> {
  const entry = entryFor(chart, id, thumbnailDataUrl(chart), { filePath, sourceId: null });
  await driver.put(entry);
  return entry;
}

export async function loadFromLibrary(
  id: string,
  driver: LibraryDriver = libraryDriver()
): Promise<{ chart: Chart; entry: LibraryEntry } | null> {
  const entry = await driver.get(id);
  if (!entry) return null;
  return { chart: chartFromEntry(entry), entry };
}

export async function renameInLibrary(
  id: string,
  title: string,
  driver: LibraryDriver = libraryDriver()
): Promise<LibraryEntry | null> {
  const entry = await driver.get(id);
  if (!entry) return null;
  const name = title.trim() || 'Untitled chart';
  // The title lives in two places; a rename that updated only the card would
  // come back under the old name the moment the chart was exported.
  const updated: LibraryEntry = {
    ...entry,
    title: name,
    file: { ...entry.file, meta: { ...entry.file.meta, title: name } },
  };
  await driver.put(updated);
  return updated;
}

export async function deleteFromLibrary(
  id: string,
  driver: LibraryDriver = libraryDriver()
): Promise<void> {
  await driver.remove(id);
}

// ---- the working slot ------------------------------------------------------

/**
 * Overwrite the autosaved working chart. No thumbnail: nothing displays it, and
 * this runs every second or so while someone is drawing.
 */
export async function saveWorking(
  chart: Chart,
  extra: { filePath?: string | null; sourceId?: string | null } = {},
  driver: LibraryDriver = libraryDriver()
): Promise<void> {
  await driver.put(
    entryFor(chart, WORKING_ID, '', {
      filePath: extra.filePath ?? null,
      sourceId: extra.sourceId ?? null,
    })
  );
}

export async function readWorking(
  driver: LibraryDriver = libraryDriver()
): Promise<LibraryEntry | null> {
  return driver.get(WORKING_ID);
}

export async function clearWorking(driver: LibraryDriver = libraryDriver()): Promise<void> {
  await driver.remove(WORKING_ID);
}
