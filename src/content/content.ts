// glowficlog content script. Cross-browser MV3: runs on glowfic.com/posts/*,
// stays OFF by default, and is strictly additive — toggling OFF restores the
// original DOM exactly (we only add one class to host posts and insert/remove a
// single reader node + our own toggle button).
//
// Defensive by contract: if the expected glowfic selectors are absent we do
// nothing at all and leave the page untouched.

import { parsePosts, renderReader } from '../reader-core/index.js';

const STORAGE_KEY = 'glowficlog:enabled';
const HIDDEN_CLASS = 'glr-hidden-original';

// ---- WebExtension API (feature-detected; no @types/chrome dependency) ----

interface StorageArea {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
interface BrowserLike {
  storage?: { local?: StorageArea };
}

const ext: BrowserLike | undefined =
  (globalThis as { browser?: BrowserLike }).browser ??
  (globalThis as { chrome?: BrowserLike }).chrome;

async function loadEnabled(): Promise<boolean> {
  const area = ext?.storage?.local;
  if (area) {
    try {
      const result = await area.get(STORAGE_KEY);
      return result[STORAGE_KEY] === true;
    } catch (err) {
      console.warn('[glowficlog] storage.get failed; falling back', err);
    }
  }
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

async function saveEnabled(value: boolean): Promise<void> {
  const area = ext?.storage?.local;
  if (area) {
    try {
      await area.set({ [STORAGE_KEY]: value });
      return;
    } catch (err) {
      console.warn('[glowficlog] storage.set failed; falling back', err);
    }
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(value));
  } catch {
    /* localStorage may be unavailable (private mode); state is best-effort. */
  }
}

// ---- Reader activation / restoration ----

let readerEl: HTMLElement | null = null;
let enabled = false;
let toggleBtn: HTMLButtonElement | null = null;

function detectTheme(): 'light' | 'dark' {
  try {
    if (globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    /* matchMedia may be unavailable */
  }
  return 'light';
}

/** True only when this looks like a glowfic thread we can read. */
function isThreadPage(): boolean {
  return document.querySelector('.post-container') !== null;
}

function activate(): void {
  if (readerEl) return;
  const containers = document.querySelectorAll<HTMLElement>('.post-container');
  if (containers.length === 0) return; // selectors absent → no-op

  const posts = parsePosts(document);
  if (posts.length === 0) return;

  const reader = renderReader(posts, { document, theme: detectTheme() });
  const first = containers[0];
  first.parentNode?.insertBefore(reader, first);
  containers.forEach((c) => c.classList.add(HIDDEN_CLASS));
  readerEl = reader;
}

function deactivate(): void {
  if (readerEl) {
    readerEl.remove();
    readerEl = null;
  }
  // Restore every host post we hid (fully reverts our only DOM mutation).
  document
    .querySelectorAll<HTMLElement>('.' + HIDDEN_CLASS)
    .forEach((c) => c.classList.remove(HIDDEN_CLASS));
}

function reflectButton(): void {
  if (!toggleBtn) return;
  toggleBtn.setAttribute('aria-pressed', String(enabled));
  toggleBtn.textContent = enabled ? '📖 Reader: on' : '📖 Reader: off';
  toggleBtn.title = enabled
    ? 'glowficlog reader is on (Alt+G to toggle)'
    : 'Show the glowficlog compact reader (Alt+G)';
}

function setEnabled(value: boolean, persist: boolean): void {
  enabled = value;
  if (enabled) {
    activate();
  } else {
    deactivate();
  }
  reflectButton();
  if (persist) {
    void saveEnabled(enabled);
  }
}

function createToggle(): void {
  if (toggleBtn) return;
  const btn = document.createElement('button');
  btn.className = 'glr-toggle';
  btn.type = 'button';
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', () => setEnabled(!enabled, true));
  document.body.appendChild(btn);
  toggleBtn = btn;
  reflectButton();
}

function onKeydown(event: KeyboardEvent): void {
  // Alt+G toggles. Ignore when typing into fields.
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key.toLowerCase() !== 'g') return;
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
  event.preventDefault();
  setEnabled(!enabled, true);
}

async function init(): Promise<void> {
  // Bail out completely on non-thread pages — leave the page untouched.
  if (!isThreadPage()) return;

  createToggle();
  document.addEventListener('keydown', onKeydown, true);

  // Restore remembered state (OFF by default).
  const remembered = await loadEnabled();
  if (remembered) {
    setEnabled(true, false);
  } else {
    reflectButton();
  }
}

init().catch((err) => {
  // Surface, never swallow — but never break the host page either.
  console.error('[glowficlog] initialisation failed', err);
});
