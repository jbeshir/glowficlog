# glowficlog — v6 changes

Sixth iteration. Six targeted fixes on top of v5; no prior features regressed
(rotated-L compact icon boxes, alternating tints, host theme + typography
inheritance, full-width text, monogram fallback, first-appearance/condensed
identity, floating hover preview, name-aligned-to-icon-side, offline harness all
intact). `make validate` is GREEN (full output pasted at the end).

Branch: `build/glowficlog-v1` (commits ADDED, history preserved).

---

## Fix 1 — Reader placed BETWEEN the top and bottom paginators (every page type)

**The repeatedly-reported bug:** the reader was inserted *before the first
`.post-container`*, which on the real DOM lands it **above the top nav** — and on
page 2 lands it **inside the hidden OP wrapper** (`display:none`), so it never
appeared at all.

The real captured `#content` (see `/in/out/page1-structure.md`,
`structure-notes.md`) is:

| | Page 1 (`/posts/47494`) | Page 2 (`/posts/47494?page=2`, `/replies/NNN`) |
|---|---|---|
| OP | `.post-container.post-post`, **visible, ABOVE the top paginator** | collapsed inside `.post-expander > .hidden` (`display:none`), before the top paginator |
| then | TOP `.paginator` → 25 `.post-reply` → BOTTOM `.paginator` | TOP `.paginator` → 25 `.post-reply` → BOTTOM `.paginator` |

So "insert before the first `.post-container`" is wrong on **both** pages (page 1:
the first container is the OP, above the nav; page 2: the first is the hidden OP).

**New placement** (`src/reader-core/dom.ts`):

1. **`renderedPostContainers(root)`** (new, exported) returns only the
   `.post-container`s that are actually rendered: a container is skipped when it,
   or any ancestor up to the post-list container, carries `.hidden` /
   `.post-expander`, has `[hidden]`, or computes to `display:none` at runtime. The
   page-2 collapsed OP is therefore excluded; the page-1 visible OP is included.
   (The class/attribute checks come first because jsdom, lacking glowfic's
   stylesheet, won't report `display:none` for a class-only `.hidden`.)
2. **`mountReaderInPostList`** now finds the **TOP paginator** = the first
   `.paginator` child of the container that still has a rendered post after it (so
   a single bottom-only nav is never mistaken for it) and inserts the reader
   **immediately after** it — landing it strictly between the two navs even though
   the page-1 OP sits above the top one. With no such paginator (a short
   single-page thread) it falls back to inserting before the first rendered post.
3. Only the **rendered** containers are hidden (page-1 OP included — its content
   now lives in the reader); the `.paginator`s and the collapsed-OP expander are
   never touched. `unmountReader` restores exactly (only our hide-class is
   toggled, plus the reader node removed).

**`parsePosts`** now also builds from `renderedPostContainers`, so the model the
reader renders is exactly the set of posts the page shows (page-2 collapsed OP
excluded), matching what the mount hides.

**Tests (`test/dom.test.ts`)** — added against the **real captured fixtures**
copied to `test/fixtures/page1-content.html` and `page2-content.html` (the
`#content` subtree, byte-for-byte from `/in/out/`). Run the full content-script
path (parse → render → mount) and assert, on **both** pages:
- the reader's `previousElementSibling` is the top paginator, and its index is
  `> top paginator` and `< bottom paginator` (i.e. strictly **between** them);
- it is **not** inside `.hidden` / `.post-expander` (`reader.closest(...) === null`);
- both paginators remain and are never given the hide-class;
- **page 1:** the OP appears in the reader (`.glr-post--op`) and the original OP
  container is hidden, even though it sits above the top nav (26 posts rendered);
- **page 2:** the collapsed OP is **absent** from the reader, untouched, and stays
  in its expander (25 posts rendered);
- `unmountReader` returns `#content` to the same child nodes in the same order
  with no lingering `glr-` classes.

> Placement note: putting the page1/page2 fixtures under `test/fixtures/` (not the
> harness `fixtures/`) keeps them out of the harness bundle and out of the
> manifest-driven `reader-core.test.ts` (whose `OP count matches DOM` assertion
> would otherwise break on page 2, where the DOM has a `.post-post` but the reader
> intentionally renders zero OPs). They are exercised directly by the jsdom
> placement tests above.

## Fix 2 — `/replies/*` URLs supported

`manifest.json` `content_scripts.matches` now lists all four patterns:

```
*://glowfic.com/posts/*    *://www.glowfic.com/posts/*
*://glowfic.com/replies/*  *://www.glowfic.com/replies/*
```

`/replies/NNN` serves the identical thread DOM (page-2 shape), so Fix 1 makes it
work with no further code. Verified in the rebuilt `dist/manifest.json`.

## Fix 3 — Character names: pill dropped, now plain readable text

`.glr-chip` (the condensed/repeat character name) was a link-blue rounded pill
(`background`, `border-radius`, `color: var(--glr-link)`) — it read as clickable
but isn't. Restyled (`src/reader-core/reader.css`) to plain text: **no background,
no border-radius, no link colour**; bold `var(--glr-fg)` in the body font
(`var(--glr-font-family)`), `0.95em` — marginally smaller than the
first-appearance `.glr-char` (`1.02em`, also bold fg, same `0.01em` letter-spacing)
so the two read consistently. The class name is unchanged, so the render path and
the existing `has a condensed chip` test are untouched. `--glr-chip-bg` is still
used by the OP accent rail, icon box, and monogram — only the name styling
changed.

## Fix 4 — Toggle label "Reader" → "Glowlog"

`src/content/content.ts` `reflectButton()`: button text is now
`📖 Glowlog: on` / `📖 Glowlog: off` (same on/off format). The `title` becomes
`Glowlog is on (Alt+G to toggle)` / `Show the Glowlog compact reader (Alt+G)`, and
a matching `aria-label` (mirroring the visible label) is now set. Verified in the
rebuilt `dist/content.js`.

## Fix 5 — Connector precision (no gap at the icon, aligned, both sides, OP)

The connector left a visible gap at the icon end — most obvious on the first post,
whose icon box is largest. Cause: the connector's icon-side edge was at
`gutter − 2px` while the icon box's inner edge is at `gutter − icon-pad`
(the box sits one `--glr-icon-pad` inside the gutter's inner edge) → a **6px gap**.

Fix (`src/reader-core/reader.css`): the connector's icon-side edge is now anchored
at exactly `calc(var(--glr-gutter) − var(--glr-icon-pad))` (left posts) /
mirrored with `right` (right posts), so it **butts the icon box's inner edge with
no gap**; its width is `calc(var(--glr-icon-pad) + var(--glr-gap) + 2px)` so the
band-side edge **overlaps the band by 2px** (seamless, opaque same-tint fusion).
Vertical position (`top: post-pad + 0.3em`) is unchanged and independent of the OP
accent (a band `box-shadow` that never shifts the connector).

**Headless geometry measurement** (real `reader.css` + reader-core +
`layoutIcons`, rendered in headless Chromium via Playwright; full JSON at
`/out/connector-geometry.json`). Synthetic thread: post 0 = OP/left, post 1 =
right, post 2 = left, post 3 = right; all cap-sized (96px) icon boxes — the worst
case for the icon-side gap:

| post | role | side | icon box | icon-side gap | band overlap | connector within icon box (vert.) |
|---|---|---|---|---|---|---|
| 0 | OP | left | 96px | **0px** | 2px | yes |
| 1 | reply | right | 96px | **0px** | 2px | yes |
| 2 | reply | left | 96px | **0px** | 2px | yes |
| 3 | reply | right | 96px | **0px** | 2px | yes |

Worst absolute icon-side gap = **0px** (criterion: ≤1px). For comparison, the
**pre-fix** connector measured a **6px** icon-side gap on every post (OP and both
sides). The OP's accent rail does not shift its connector (post 0 measures
identically to the normal posts).

---

## `make validate` — GREEN

```
> glowficlog@1.0.0 validate
> npm run typecheck && npm run lint && npm run test && npm run build && npm run lint:ext

> glowficlog@1.0.0 typecheck
> tsc --noEmit

> glowficlog@1.0.0 lint
> eslint .

> glowficlog@1.0.0 test
> tsx --test test/*.test.ts
...
1..68
# tests 68
# suites 0
# pass 68
# fail 0
# cancelled 0
# skipped 0
# todo 0

> glowficlog@1.0.0 build
> node scripts/build.mjs
build: ok — content script + harness (5 fixtures embedded) -> dist/

> glowficlog@1.0.0 lint:ext
> web-ext lint --source-dir dist --self-hosted

Validation Summary:
errors          0
notices         1
warnings        3
```

- **0 errors.** The 1 notice (`MISSING_DATA_COLLECTION_PERMISSIONS`, a future
  Firefox manifest key) and 3 warnings (`UNSAFE_VAR_ASSIGNMENT` on `innerHTML` in
  `content.js` / `dev/harness.js` — the body markup is sanitized in
  `render.ts:buildBody`, defence-in-depth) are **pre-existing** and unchanged from
  v5.
- Tests: **68/68 pass** (4 new real-fixture placement tests + 1 rendered-container
  test added; all prior tests still green).

## Deliverables

- `/out/repo` — updated repo incl. `.git` (committed on `build/glowficlog-v1`).
- `/out/dist` — rebuilt extension (`make build`).
- `/out/CHANGES-v6.md` — this file.
- `/out/connector-geometry.json` — raw headless connector measurement (Fix 5).

## Files touched

- `src/reader-core/dom.ts` — `renderedPostContainers` (new, exported);
  rewrote `mountReaderInPostList` (top-paginator anchor + rendered-only hide).
- `src/reader-core/parse.ts` — parse from rendered containers only.
- `src/reader-core/index.ts` — export `renderedPostContainers`.
- `src/reader-core/reader.css` — `.glr-chip` plain text (Fix 3); connector
  geometry (Fix 5).
- `src/content/content.ts` — Glowlog label / title / aria-label (Fix 4).
- `manifest.json` — `/replies/*` matches (Fix 2).
- `test/dom.test.ts` + `test/fixtures/page1-content.html`, `page2-content.html` —
  real-fixture placement tests (Fix 1).
