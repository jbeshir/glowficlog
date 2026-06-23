// Shared option model, storage keys, defaults, and storage helpers used by BOTH
// the content script and the options page. The WebExtension storage API
// (browser/chrome) is feature-detected with a localStorage fallback, so the
// helpers also work in plain pages / tests without an extension host.

/** User-configurable reader options (most default OFF; moietyRings defaults ON). */
export interface Options {
  /** Master toggle: is the reader shown on a thread? */
  readonly enabled: boolean;
  /** Trim whitespace-only lines from the start/end of each post body. */
  readonly trimBlankEdges: boolean;
  /** Super-condensed view: hairline gaps + tight vertical padding. */
  readonly condensed: boolean;
  /** Draw a colour ring around each author's icon using their glowfic moiety colour. */
  readonly moietyRings: boolean;
}

/** storage.local keys, one per {@link Options} field. */
export const STORAGE_KEYS = {
  enabled: 'glowficlog:enabled',
  trimBlankEdges: 'glowficlog:trimBlankEdges',
  condensed: 'glowficlog:condensed',
  moietyRings: 'glowficlog:moietyRings',
} as const;

export const DEFAULT_OPTIONS: Options = {
  enabled: false,
  trimBlankEdges: false,
  condensed: false,
  moietyRings: true,
};

// ---- WebExtension API (feature-detected; no @types/chrome dependency) ----

interface StorageArea {
  get(keys: string[] | string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
/** One changed key in a storage.onChanged event. */
export interface StorageChange {
  readonly newValue?: unknown;
  readonly oldValue?: unknown;
}
type ChangeListener = (changes: Record<string, StorageChange>, areaName: string) => void;
interface BrowserLike {
  storage?: {
    local?: StorageArea;
    onChanged?: {
      addListener(cb: ChangeListener): void;
      removeListener(cb: ChangeListener): void;
    };
  };
}

export const ext: BrowserLike | undefined =
  (globalThis as { browser?: BrowserLike }).browser ??
  (globalThis as { chrome?: BrowserLike }).chrome;

const ALL_KEYS: string[] = Object.values(STORAGE_KEYS);

function readLocalStorage(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === 'true';
  } catch {
    return false;
  }
}

// Returns true when the key is absent (null) or explicitly 'true'; only 'false' → false.
function readLocalStorageDefaultTrue(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) !== 'false';
  } catch {
    return true;
  }
}

/** Read all options at once, with a localStorage fallback. */
export async function loadOptions(): Promise<Options> {
  const area = ext?.storage?.local;
  if (area) {
    try {
      const r = await area.get(ALL_KEYS);
      return {
        enabled: r[STORAGE_KEYS.enabled] === true,
        trimBlankEdges: r[STORAGE_KEYS.trimBlankEdges] === true,
        condensed: r[STORAGE_KEYS.condensed] === true,
        moietyRings: r[STORAGE_KEYS.moietyRings] !== false,
      };
    } catch (err) {
      console.warn('[glowficlog] storage.get failed; falling back', err);
    }
  }
  return {
    enabled: readLocalStorage(STORAGE_KEYS.enabled),
    trimBlankEdges: readLocalStorage(STORAGE_KEYS.trimBlankEdges),
    condensed: readLocalStorage(STORAGE_KEYS.condensed),
    moietyRings: readLocalStorageDefaultTrue(STORAGE_KEYS.moietyRings),
  };
}

/** Persist one option. Best-effort: never throws (storage may be unavailable). */
export async function setOption(key: keyof Options, value: boolean): Promise<void> {
  const storageKey = STORAGE_KEYS[key];
  const area = ext?.storage?.local;
  if (area) {
    try {
      await area.set({ [storageKey]: value });
      return;
    } catch (err) {
      console.warn('[glowficlog] storage.set failed; falling back', err);
    }
  }
  try {
    globalThis.localStorage?.setItem(storageKey, String(value));
  } catch {
    /* localStorage may be unavailable (private mode); state is best-effort. */
  }
}

/** Subscribe to local storage changes; returns an unsubscribe (no-op if unsupported). */
export function onOptionsChanged(cb: ChangeListener): () => void {
  const onChanged = ext?.storage?.onChanged;
  if (!onChanged) return () => {};
  const wrapped: ChangeListener = (changes, area) => {
    if (area === 'local') cb(changes, area);
  };
  onChanged.addListener(wrapped);
  return () => onChanged.removeListener(wrapped);
}
