// Sanitize untrusted glowfic post-body HTML before it is assigned to innerHTML.
//
// reader-core re-displays the inner HTML of glowfic's `.post-content` (or a saved
// fixture). That markup is UNTRUSTED: a malicious or compromised post could carry
// `<script>`, `on*` event handlers, or `javascript:`/`data:` URLs. This module is
// the enforced trust boundary — every body passes through DOMPurify here before it
// reaches `render.ts buildBody`'s `innerHTML` sink.
//
// Context portability: reader-core renders into an INJECTED document and runs in
// three contexts — the content script (real browser window), the jsdom test suite,
// and the offline dev harness. So DOMPurify is created against the OWNING window of
// the document we were handed (`doc.defaultView`), never a hardcoded global
// `window` (there is no global `window` under Node at all). Instances are cached
// per-window so the hook is installed once per window.

import DOMPurify, { type WindowLike } from 'dompurify';

type Purifier = ReturnType<typeof DOMPurify>;

// One DOMPurify instance per window. The few windows reader-core ever sees (the
// page, the jsdom DOM, the harness page) each get a single instance with the URL
// hook attached once. WeakMap so instances are collected with their window.
const instances = new WeakMap<Window, Purifier>();

/** Strip `javascript:` and `data:` from URL-bearing attributes. */
const DANGEROUS_URI = /^\s*(?:javascript|data):/i;

/**
 * Build (or fetch the cached) DOMPurify instance bound to `win`.
 *
 * DOMPurify's default config already drops `<script>` and every `on*` handler, and
 * its default URL policy rejects `javascript:` — but it STILL permits `data:` URLs
 * on media tags (img/audio/video/source/track) via its DATA_URI_TAGS special case,
 * which bypasses the URL regexp. The `afterSanitizeAttributes` hook below closes
 * that gap, stripping both `javascript:` and `data:` from href/src/xlink:href.
 */
function purifierFor(win: Window): Purifier {
  const cached = instances.get(win);
  if (cached) return cached;

  // A real Window exposes the DOM constructors DOMPurify needs (Node, Element,
  // DocumentFragment, DOMParser, …) — true for the browser window, jsdom, and the
  // harness alike — but lib.dom's `Window` type is not structurally assignable to
  // DOMPurify's `WindowLike`. The cast is sound for any genuine window object.
  const purify = DOMPurify(win as unknown as WindowLike);
  // `afterSanitizeAttributes` fires per element after DOMPurify's own attribute
  // pass; `node` is an Element. Drop any URL-bearing attribute whose value is a
  // `javascript:` or `data:` URL (DOMPurify already blocks `javascript:` on most
  // attributes but permits `data:` on media tags — this also covers that gap).
  purify.addHook('afterSanitizeAttributes', (node) => {
    for (const attr of ['href', 'src', 'xlink:href']) {
      const value = node.getAttribute(attr);
      if (value && DANGEROUS_URI.test(value)) node.removeAttribute(attr);
    }
  });
  instances.set(win, purify);
  return purify;
}

/**
 * Sanitize a post-body HTML string for insertion via innerHTML, using the window
 * that owns `doc`. Returns a string with `<script>`, `on*` event-handler
 * attributes, and `javascript:`/`data:` URLs removed, while preserving legitimate
 * glowfic formatting: links, images, inline `style`, blockquotes, lists,
 * `<details>` spoilers, tables, `<br>`, bold/italic, etc. (DOMPurify's default
 * `html` profile — verified against the repo's fixtures to cover every tag/attr
 * real posts use, so nothing legitimate is over-stripped).
 *
 * Fail closed: if the document has no owning window (`defaultView === null`, e.g.
 * a document with no browsing context) DOMPurify cannot run, so we return '' rather
 * than ever assigning unsanitized HTML. In all real reader-core contexts the
 * document HAS a window, so this is only a safety net.
 */
export function sanitizeBodyHtml(doc: Document, html: string): string {
  if (!html) return '';
  const win = doc.defaultView;
  if (!win) return '';
  return purifierFor(win).sanitize(html, { USE_PROFILES: { html: true } });
}

/**
 * Validate a permalink before it becomes an `href`. Accept only a relative path
 * (starts with '/') or an absolute `http(s)://` URL; everything else — including
 * `javascript:` and other script-bearing schemes — falls back to '#'. Closes the
 * click-to-execute vector on the permalink anchor (render.ts buildIdentity).
 */
export function safePermalinkHref(raw: string | null): string {
  if (raw && (raw.startsWith('/') || /^https?:\/\//i.test(raw))) return raw;
  return '#';
}
