// glowficlog content script. Cross-browser MV3: runs on glowfic.com/posts/*,
// stays OFF by default, and is strictly additive — toggling OFF restores the
// original DOM exactly (we only add one class to host posts and insert/remove a
// single reader node + our own toggle button).
//
// Defensive by contract: if the expected glowfic selectors are absent we do
// nothing at all and leave the page untouched.

import {
  parsePosts,
  renderReader,
  readThemeFromDocument,
  applyTheme,
  themeMode,
  layoutIcons,
  markSingleLineBodies,
  mountReaderInPostList,
  unmountReader,
  enableIconPreviews,
  applyMoieties,
} from '../reader-core/index.js';
import { applyMoietyRings } from './moiety.js';
import { createControls, type Controls } from './controls.js';
import { openOptionsPage } from './open-options.js';
import {
  loadOptions,
  setOption,
  onOptionsChanged,
  STORAGE_KEYS,
  DEFAULT_OPTIONS,
} from '../shared/options.js';
import type { Options } from '../shared/options.js';

// ---- Reader activation / restoration ----

let readerEl: HTMLElement | null = null;
let disablePreviews: (() => void) | null = null;
let controls: Controls | null = null;
/** Last-known options; refreshed at init and on storage changes. */
let options: Options = DEFAULT_OPTIONS;

/** True for ANY glowfic thread page — including paginated reply pages
 *  (`/posts/{id}?page=2+`) that contain only `.post-reply` containers and no OP.
 *  Detection keys off the presence of a `.post-container`, never the OP. */
function isThreadPage(): boolean {
  return document.querySelector('.post-container') !== null;
}

function activate(): void {
  if (readerEl) return;
  const posts = parsePosts(document);
  if (posts.length === 0) return; // selectors absent → no-op

  // Colours, typography AND light/dark all follow the host glowfic theme — read
  // BEFORE we hide the originals, while their computed styles are still observable.
  // Cheap, so re-read on every (re)activation rather than caching.
  const hostTheme = readThemeFromDocument(document);
  const mode = themeMode(hostTheme);
  const reader = renderReader(posts, {
    document,
    theme: mode,
    trimBlankEdges: options.trimBlankEdges,
  });
  // The super-condensed density mode is a single class on the reader root.
  reader.classList.toggle('glr-condensed', options.condensed);
  applyTheme(reader, hostTheme);
  // The floating controls live on <body>, outside the reader, so they can't inherit
  // its tokens; point them at the same host-derived mode so the buttons match
  // glowfic's light/dark rather than the OS.
  controls?.container.setAttribute('data-theme', mode);
  // Insert the reader at the post list's position — between the top and bottom
  // paginators — and hide only the post containers (paginators stay). Bail out
  // untouched if there are no containers to anchor to.
  if (!mountReaderInPostList(reader, document)) return;
  readerEl = reader;
  // Smooth floating icon previews (cleaned up on deactivate).
  disablePreviews = enableIconPreviews(reader);
  // Icons can only be flow-sized once the reader is in a laid-out document.
  layoutIcons(reader);
  // Decide per-post single-line body alignment once the body has a measured
  // height (right-gutter single-line bodies right-align; everything else left).
  markSingleLineBodies(reader);
  // Fetch and apply per-author moiety colour rings. Fire-and-forget — must not
  // block the initial render.
  if (options.moietyRings) void applyMoietyRings(reader);
}

// Post heights — and therefore how far an icon may grow before meeting the next
// same-side icon — change with viewport width, so re-flow icons on resize.
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
function onResize(): void {
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    if (readerEl) {
      layoutIcons(readerEl);
      // Width changed → bodies may wrap/unwrap, so re-evaluate single-line state.
      markSingleLineBodies(readerEl);
    }
  }, 120);
}

function deactivate(): void {
  // Tear down the floating previews before the reader goes away.
  if (disablePreviews) {
    disablePreviews();
    disablePreviews = null;
  }
  // Remove the reader and unhide every host post we hid — fully reverts our DOM
  // mutations so the page is exactly as it was.
  unmountReader(readerEl, document);
  readerEl = null;
}

/** Rebuild the reader in place (used when an option changes how posts render). */
function rebuild(): void {
  if (!readerEl) return;
  deactivate();
  activate();
}

function reflectButton(): void {
  controls?.reflect(options.enabled);
}

function setEnabled(value: boolean, persist: boolean): void {
  options = { ...options, enabled: value };
  if (options.enabled) {
    activate();
  } else {
    deactivate();
  }
  reflectButton();
  if (persist) {
    void setOption('enabled', value);
  }
}

function mountControls(): void {
  if (controls) return;
  controls = createControls(document, {
    onToggle: () => setEnabled(!options.enabled, true),
    onOpenOptions: () => openOptionsPage(),
  });
  document.body.appendChild(controls.container);
  // Theme the cluster from glowfic's own palette so the toggle matches the host
  // even while the reader is OFF (re-set from the live sample on each activate).
  controls.container.setAttribute('data-theme', themeMode(readThemeFromDocument(document)));
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
  setEnabled(!options.enabled, true);
}

/** Apply changes pushed from the options page (or another tab) live. */
function onStorageChange(changes: Record<string, { newValue?: unknown }>): void {
  if (STORAGE_KEYS.condensed in changes) {
    options = { ...options, condensed: changes[STORAGE_KEYS.condensed].newValue === true };
    // Pure styling — just toggle the class, no rebuild needed.
    readerEl?.classList.toggle('glr-condensed', options.condensed);
  }
  if (STORAGE_KEYS.trimBlankEdges in changes) {
    options = {
      ...options,
      trimBlankEdges: changes[STORAGE_KEYS.trimBlankEdges].newValue === true,
    };
    // Changes how bodies render → rebuild so trimming is (un)applied.
    rebuild();
  }
  if (STORAGE_KEYS.enabled in changes) {
    const value = changes[STORAGE_KEYS.enabled].newValue === true;
    if (value !== options.enabled) setEnabled(value, false);
  }
  if (STORAGE_KEYS.moietyRings in changes) {
    const value = changes[STORAGE_KEYS.moietyRings].newValue !== false;
    options = { ...options, moietyRings: value };
    if (value && readerEl) {
      void applyMoietyRings(readerEl);
    } else if (!value && readerEl) {
      applyMoieties(readerEl, {});
    }
  }
}

async function init(): Promise<void> {
  // Bail out completely on non-thread pages — leave the page untouched.
  if (!isThreadPage()) return;

  // These listeners live for the whole lifetime of the content script. glowfic.com
  // does full page loads (no SPA navigation), so when the page is left the browser
  // tears down this context — and with it every listener and chrome.* registration
  // here. There is nothing to unsubscribe; we let them die with the page, so the
  // unsubscribe handle onOptionsChanged returns is discarded.
  document.addEventListener('keydown', onKeydown, true);
  globalThis.addEventListener?.('resize', onResize);
  onOptionsChanged(onStorageChange);

  // Restore remembered state (everything OFF by default). Load BEFORE mounting the
  // controls so the toggle button paints in its correct on/off state on first frame
  // (no flash of the default 'off' label — FOUC fix).
  options = await loadOptions();
  mountControls();
  if (options.enabled) {
    activate();
  }
}

init().catch((err) => {
  // Surface, never swallow — but never break the host page either.
  console.error('[glowficlog] initialisation failed', err);
});
