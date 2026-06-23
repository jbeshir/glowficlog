# glowficlog

A cross-browser (Manifest V3) extension that reformats [glowfic.com](https://glowfic.com)
thread pages into a **compact, high-information-density reader** — plus a
standalone **offline dev harness** that renders the exact same reader from saved
HTML fixtures.

Glowfic threads have very low information density: every line of dialogue is a
full forum post with a large icon, character name, screenname, author and
metadata, so a short back-and-forth means endless scrolling. glowficlog collapses
all of that into one continuous, novel-like column.

---

## What it does

- Adds a floating **toggle** (bottom-right, or **Alt+G**) to glowfic thread pages.
- **OFF by default.** When you turn it on, the original posts are hidden (not
  removed) and a compact reader is shown in their place. Turn it off and the page
  is restored **exactly** — the only DOM change is one CSS class on the original
  posts plus a single inserted reader node, both reverted on toggle-off.
- Remembers your on/off choice in `storage.local`.
- Has an **options page** (two toggles, applied live to open tabs): **trim blank
  lines** at the start/end of posts (whitespace-only lines, including
  non-breaking spaces and empty paragraphs/line breaks), and a **super condensed
  view** (hairline gaps between posts + tighter vertical padding).
- Is **defensive**: on any page where the expected glowfic selectors are absent,
  it does nothing and leaves the page untouched.

## The layout design

A **continuous, centred text column**:

- All post bodies flow down one centred column with only a **light separator**
  between posts — it reads almost like a chat log / novel, with minimal vertical
  padding instead of a big padded userbox per post.
- Each post's **icon sits in the left or right side gutter** beside its text (not
  stacked above it). Icons **alternate** gutter side per post (1 left, 2 right,
  3 left, …). Alternation is purely space-saving — it does **not** encode author
  identity, so consecutive same-author posts may land on different sides (this is
  intended).
- Each icon **shrinks to fit its post's text height** (capped at ~56px). A
  one-line post gets a tiny icon that adds no vertical space; a long
  multi-paragraph post gets a larger, capped icon. The icon never makes a short
  post taller than its text. Short rapid dialogue therefore becomes very dense;
  long infodumps still show a visible icon.
- **Hovering** an icon shows it **full size** in a popover.
- Icons keep their **natural aspect ratio** — portrait and landscape icons are
  shown un-cropped — bounded so they can never grow tall enough to collide with
  the next same-side icon or wide enough to overflow their gutter.
- The **first appearance** of a character shows **full identity** (character
  name + screenname + author); **repeats** show a compact **character-name
  chip**, with the full identity available on hover (`title`). Glowfic authors
  share a character name across **alts** that differ only by screenname/author,
  so whenever the writer behind a name changes the full identity is
  **re-announced** (and condensed again while it stays the same).
- Author-only out-of-character posts (`.spacer-alt`), the OP (`.post-post`),
  deleted characters (`[Deleted]`), deleted authors (`(deleted user)`), missing
  screennames, and iconless posts are all handled gracefully, in **both** the
  flat (`?view=flat`) and paginated glowfic DOM shapes.

All reader styling is **scoped behind a `glr-` class prefix** (with CSS custom
properties for tunables), so it cannot leak into — or be broken by — the host
page.

---

## Architecture

The renderer is decoupled so the extension and the harness share **one**
implementation.

```
src/reader-core/      ← pure, framework-free, shared by both consumers
  types.ts            Post model + options
  parse.ts            parsePosts(root) -> readonly Post[]   (immutable, null-guarded)
  render.ts           renderReader(posts, opts) -> HTMLElement  (pure, detached subtree)
  reader.css          glr-scoped styles, CSS custom-property tunables
  index.ts            public surface

src/content/content.ts   Content script (consumer #1): toggle, storage, Alt+G,
                         hide/restore originals, applies options live. No UI framework.
src/dev/harness.ts       Dev harness (consumer #2): renders fixtures offline,
                         driven by URL query params, shares reader-core.
src/options/options.ts   Options page script (read/write the two option toggles).
src/shared/options.ts    Shared option model, storage keys + helpers (content + options).
public/dev/index.html    Harness shell (links reader.css + harness.js).
public/options.html      Options page (links options.css + options.js).

scripts/build.mjs        esbuild bundling + asset copy; embeds fixtures.
scripts/package.mjs      web-ext (Firefox) + Chrome zip.
scripts/gen-icons.mjs    regenerates the placeholder extension icons.
test/reader-core.test.ts node:test + jsdom unit tests (the in-pipeline render proxy).
fixtures/                8 real captured thread fixtures + manifest.json.
```

- `parsePosts(root)` accepts any `ParentNode` containing `.post-container`
  elements — the live document, a `.post-list`, or a detached fixture fragment.
  It returns a **frozen** array of **frozen** `Post` objects; every optional
  field is `null` when absent, so nothing downstream has to guess.
- `renderReader(posts, { document, theme })` is **pure**: same input → identical
  output, no global state. `document` is injectable so it runs headless under
  jsdom. The returned subtree is **detached** — the caller decides where to put
  it.

---

## Build & validate

Dependencies are pinned and **pre-installed**; never run `npm install`. All tools
are local; there is no network requirement.

```bash
make build       # bundle everything into dist/
make typecheck   # tsc --noEmit
make lint        # eslint
make lint-ext    # web-ext lint against dist/
make test        # node:test + jsdom (via tsx)
make validate    # typecheck + lint + test + build + web-ext lint  (authoritative gate)
make package     # Firefox .zip (web-ext) + Chrome .zip into web-ext-artifacts/
make dev         # build + print the offline harness path & query-param help
```

Each `make` target wraps the matching npm script (`npm run <name>`), so the npm
scripts work directly too.

---

## Loading the extension unpacked

First build: `make build` (everything loads from `dist/`).

**Firefox**

1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → choose `dist/manifest.json`.
3. Open any thread, e.g. `https://glowfic.com/posts/53995`, and click the
   bottom-right **Glowlog** button (or press **Alt+G**).

**Chrome / Chromium / Edge**

1. Go to `chrome://extensions`.
2. Enable **Developer mode**.
3. **Load unpacked** → choose the `dist/` folder.
4. Open a thread and toggle the reader.

The same `dist/` is a valid MV3 bundle for both browsers
(`browser_specific_settings.gecko` provides the Firefox id/min-version; Chromium
ignores it).

---

## Dev harness (offline)

The harness renders the **same** reader-core from saved fixtures with no network
and no browser extension host — handy for iterating on layout and for
deterministic screenshots.

```bash
make dev
# then open the printed file in a browser, e.g.:
#   file:///…/dist/dev/index.html?fixture=dialogue-2author&theme=dark
```

Query parameters:

| Param     | Values                                            | Default            |
|-----------|---------------------------------------------------|--------------------|
| `fixture` | `dialogue-2author`, `multi-author-3plus`, `icon-heavy`, `mixed-iconless`, `long-infodump`, `icon-aspect`, `alts`, `blank-lines` | first fixture |
| `theme`   | `light`, `dark`                                   | `light`            |
| `raw`     | `1` / `true` to show the raw original side-by-side | off               |
| `trim`    | `1` / `true` to trim blank lines at post edges     | off               |
| `condensed` | `1` / `true` for the super-condensed density     | off               |

Fixtures are embedded into the harness bundle **at build time**, so the built
`dist/dev/index.html` runs straight from `file://` — no server needed.

---

## Selector assumptions & fragility

This extension **scrapes the glowfic DOM**, so it is inherently coupled to that
markup and **may break if glowfic changes its HTML**. Documented assumptions
(see `/in/glowfic-dom.md`, captured 2026-06-21):

- Posts are `.post-container`; the OP also has `.post-post`, replies `.post-reply`.
- `.post-icon img` is the avatar; the whole `.post-icon` is **absent** when a post
  has no icon.
- `.post-character` is the character (absent for author-only posts, which instead
  have `.spacer-alt`); `.post-screenname` is optional; `.post-author` is always
  present.
- `.post-content` holds the body HTML; `a.noheight` carries `id="reply-{id}"`.
- **Flat view** (`?view=flat`): character/author are plain text and the icon img
  has no wrapping `<a>`. **Paginated view**: character/author/icon are wrapped in
  `<a>`. The parser handles both (prefers the inner link, falls back to text).

These class names are hand-authored and stable in the glowfic source, but no
scraper is future-proof. If the reader ever shows nothing, glowfic's markup has
likely changed and the selectors in `src/reader-core/parse.ts` need updating.

Post body HTML is reinserted from the host page (or fixture). As defence in depth
the renderer strips `<script>`/`<iframe>`/etc., inline `on*` handlers and
`javascript:` URLs before inserting it.

## License

Unlicensed sample/build project.
