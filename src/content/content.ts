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
  enableActionMenu,
  applyMoieties,
  watchResize,
} from '../reader-core/index.js';
import type { IconPreviewsHandle } from '../reader-core/index.js';
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
import type { Options, StorageChange } from '../shared/options.js';

// ---- Reader activation / restoration ----

let readerEl: HTMLElement | null = null;
let disablePreviews: IconPreviewsHandle | null = null;
let disposeMenus: (() => void) | null = null;
let controls: Controls | null = null;
/** Last-known options; refreshed at init and on storage changes. */
let options: Options = DEFAULT_OPTIONS;

// ---- FOUC prevention ----
//
// The content script runs at document_start (manifest.json), well before
// `#content` paints. If the reader was left ON last session we hide `#content`
// immediately (hideForFouc, called at module top level below) so the user never
// sees a flash of the original glowfic markup before init() — which has to wait
// for `.post-container` to exist — swaps it for the reader. mirrorEnabled() keeps
// a plain localStorage copy of the enabled flag (separate from the async
// storage.local read used everywhere else) so this synchronous, pre-DOMContentLoaded
// check has something to read.

/** Best-effort synchronous mirror of the enabled flag, written wherever the async
 *  `options.enabled` changes so the NEXT page load's hideForFouc() can read it
 *  synchronously (storage.local's API is async and unusable this early). */
function mirrorEnabled(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEYS.enabled, String(value));
  } catch {
    /* localStorage may be unavailable (private mode); mirror is best-effort. */
  }
}

/** Synchronously hide `#content` if the reader was last left ON, so the original
 *  markup never flashes before init() replaces it. Must run at module top level
 *  (document_start), before `#content` has painted. Never throws. */
function hideForFouc(): void {
  try {
    if (globalThis.localStorage?.getItem(STORAGE_KEYS.enabled) !== 'true') return;
    const style = document.createElement('style');
    style.id = 'glr-fouc-style';
    style.textContent = '#content{visibility:hidden !important;}';
    document.documentElement.appendChild(style);
  } catch {
    /* localStorage/DOM may be unavailable this early; never block the page. */
  }
}

/** Idempotently lift the FOUC curtain installed by hideForFouc(). Safe to call
 *  any number of times (init's success path, its error path, and the 3s
 *  failsafe below may all call it). Never throws. */
function revealAfterFouc(): void {
  try {
    document.getElementById('glr-fouc-style')?.remove();
  } catch {
    /* a stray style tag is harmless; never break the host page over it */
  }
}

/** True for ANY glowfic thread page — including paginated reply pages
 *  (`/posts/{id}?page=2+`) that contain only `.post-reply` containers and no OP.
 *  Detection keys off the presence of a `.post-container`, never the OP. */
function isThreadPage(): boolean {
  return document.querySelector('.post-container') !== null;
}

// ---- Re-scroll + highlight-on-enable ----

/**
 * PURE: resolve the post that `hash` (e.g. `location.hash`) points at, within
 * `reader`. glowfic reply permalinks look like `#reply-{id}`; when one matches,
 * find the post carrying that `data-post-id` (see render.ts). Returns null for
 * any non-matching/absent hash. Does no scrolling or DOM mutation — a pure query
 * — so it is unit-testable headlessly (exported for that reason). Never throws.
 */
export function resolveLinkedTarget(reader: HTMLElement, hash: string): HTMLElement | null {
  try {
    const match = /^#reply-(.+)$/.exec(hash ?? '');
    if (!match) return null;
    const id = decodeURIComponent(match[1]);
    // CSS.escape may be absent (e.g. jsdom under test); fall back to a manual scan.
    // We narrow with the querySelector<HTMLElement> generic rather than
    // `instanceof HTMLElement`, because — like `Element` in dom.ts — `HTMLElement`
    // is not a global in the plain-Node test runtime, so `instanceof` there would
    // throw (and this helper is exported specifically to be tested headlessly).
    const cssApi = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;
    if (cssApi && typeof cssApi.escape === 'function') {
      return reader.querySelector<HTMLElement>(`[data-post-id="${cssApi.escape(id)}"]`);
    }
    for (const node of Array.from(reader.querySelectorAll<HTMLElement>('[data-post-id]'))) {
      if (node.getAttribute('data-post-id') === id) return node;
    }
    return null;
  } catch {
    return null;
  }
}

/** Mark and scroll to the post the page landed on. A `#reply-{id}` hash wins: it
 *  is a more specific signal than glowfic's own server-rendered "first unread"
 *  flag (`post.highlighted`, already marked by render.ts) and may point at a
 *  different post, so it clears any existing `glr-post--linked` mark before
 *  applying its own, keeping at most one post highlighted at a time. With no
 *  hash, falls back to whatever render.ts already marked. Scrolling is deferred
 *  two animation frames so icon layout (layoutIcons, above) has settled first.
 *  Never throws. */
function applyLinkedHighlightAndScroll(reader: HTMLElement): void {
  try {
    let target = resolveLinkedTarget(reader, location.hash);
    if (target) {
      reader.querySelectorAll('.glr-post--linked').forEach((el) => {
        if (el === target) return;
        el.classList.remove('glr-post--linked');
        el.removeAttribute('data-glr-linked');
      });
      target.classList.add('glr-post--linked');
      target.setAttribute('data-glr-linked', '1');
    } else {
      const fallback = reader.querySelector('.glr-post--linked');
      target = fallback instanceof HTMLElement ? fallback : null;
    }
    if (!target) return;
    const scrollTarget = target;
    const raf = (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame })
      .requestAnimationFrame;
    if (typeof raf === 'function' && typeof scrollTarget.scrollIntoView === 'function') {
      raf(() => {
        raf(() => {
          scrollTarget.scrollIntoView({ block: 'start' });
        });
      });
    }
  } catch {
    /* a missed scroll/highlight is a nicety, never worth breaking the page over */
  }
}

function activate(): void {
  if (readerEl) return;
  const posts = parsePosts(document);
  if (posts.length === 0) return; // selectors absent → no-op

  // Colours, typography AND light/dark all follow the host glowfic theme (read
  // BEFORE we hide the originals, while their computed styles are still
  // observable). Cheap, so re-read on every (re)activation rather than caching.
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
  // The floating controls live on <body>, outside the reader, so they can't
  // inherit its host-sampled tokens; point them at the same derived mode so the
  // buttons match glowfic's light/dark rather than the OS.
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
  // Wire action-menu open/close; torn down in deactivate().
  disposeMenus = enableActionMenu(reader, posts, {
    onOpenChange: (open) => disablePreviews?.setSuspended(open),
  });
  // Mark + scroll to whatever post the page landed on. Last, since it
  // reads icon layout that must already be settled.
  applyLinkedHighlightAndScroll(reader);
}

function deactivate(): void {
  // Tear down the action-menu listeners before the reader goes away — the
  // document-level ones do NOT vanish with the reader subtree, so this must run.
  if (disposeMenus) {
    disposeMenus();
    disposeMenus = null;
  }
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
  // Keep the synchronous localStorage mirror in sync on BOTH the persisting and
  // non-persisting paths (the latter is how remote/other-tab changes arrive via
  // onStorageChange → setEnabled(value, false)), so the next page load's
  // hideForFouc() always sees the current state.
  mirrorEnabled(value);
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
  // even while the reader is OFF (re-set from a live sample on each activate()).
  controls.container.setAttribute('data-theme', themeMode(readThemeFromDocument(document)));
  reflectButton();
}

function onKeydown(event: KeyboardEvent): void {
  // Alt+G toggles. Ignore when typing into fields.
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key.toLowerCase() !== 'g') return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const tag = target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
  event.preventDefault();
  setEnabled(!options.enabled, true);
}

/** Apply changes pushed from the options page (or another tab) live. */
function onStorageChange(changes: Record<string, StorageChange>): void {
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
  // Bail out completely on non-thread pages — leave the page untouched. Reveal
  // immediately rather than waiting on the 3s failsafe: there's nothing left to
  // mount, so the curtain (if hideForFouc raised one) has nothing to wait for.
  if (!isThreadPage()) {
    revealAfterFouc();
    return;
  }

  document.addEventListener('keydown', onKeydown, true);
  watchResize(() => readerEl);
  onOptionsChanged(onStorageChange);

  // Restore remembered state (everything OFF by default) BEFORE mounting the
  // controls, so the toggle button paints in its correct on/off state on its
  // first frame instead of flashing the default 'off' label.
  options = await loadOptions();
  // Sync the localStorage mirror to what we just loaded, so it can't go stale
  // between now and the next setEnabled() call (e.g. this tab never toggles).
  mirrorEnabled(options.enabled);
  mountControls();
  if (options.enabled) {
    activate();
  }
  reflectButton();
  // Lift the FOUC curtain now that the reader is mounted (enabled) or we've
  // confirmed it should stay off (disabled) — either way the decision is final.
  revealAfterFouc();
}

// Runs synchronously at document_start, before `#content` has painted: hide the
// original page immediately if the reader was left ON last time, so there is no
// flash of the un-reformatted markup before init() — deferred below to
// DOMContentLoaded, since it needs `.post-container` to exist — mounts the reader.
hideForFouc();
// Failsafe: if init() never runs to completion (a script error, a future change
// to the logic above, etc.) the curtain must still lift — a blank page must never
// persist indefinitely.
setTimeout(revealAfterFouc, 3000);

function run(): void {
  init().catch((err) => {
    // Surface, never swallow — but never break the host page either. And make
    // sure a failed init can never leave the page hidden behind the FOUC curtain.
    console.error('[glowficlog] initialisation failed', err);
    revealAfterFouc();
  });
}

// init() needs `.post-container`, which does not exist yet at document_start —
// defer it to DOMContentLoaded (or run immediately if the document has already
// finished loading, e.g. this script were ever injected late).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run, { once: true });
} else {
  run();
}
