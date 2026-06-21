# glowficlog — styling iteration v5

Fifth styling pass on the reader: five targeted fixes. All structural/data-flow
conventions are unchanged: TypeScript, immutable `Post[]` → pure `renderReader`,
`glr-`-scoped classes, defensive content script, vanilla DOM, no swallowed
errors. Every prior feature is intact — rotated-L compact icon boxes, alternating
tints, theme inheritance, pagination via `commonAncestor`, the monogram `onerror`
fallback, first-appearance/condensed identity, and the offline
`?fixture=&theme=` harness.

---

## Fix 1 — Placement: reader sits BETWEEN the top and bottom paginators (BUG)

Previously the reader was inserted before the post list's *wrapper*, which on a
real thread page sat ABOVE the top `.paginator` — so hiding the posts left the
top and bottom paginator nav bars collapsed together at the bottom.

Now the reader is inserted **at the post list's position**: immediately before the
FIRST `.post-container` within that container's own parent
(`firstPost.parentElement.insertBefore(reader, firstPost)`), which lands it
between the top and bottom paginators. Only `.post-container` elements are hidden;
the `.paginator` bars (and all other page chrome) are never touched. Toggling off
removes the reader and unhides the posts, restoring the page exactly.

- New pure, testable helpers in `reader-core/dom.ts`:
  - `mountReaderInPostList(reader, doc)` — anchors before the first
    `.post-container`, hides only the containers, returns the reader (or `null`
    when there are none, so the caller leaves the page untouched). `commonAncestor`
    is now consulted **only as a sanity check**; insertion always anchors to the
    first container, so page 2+ (reply-only, no OP) works identically.
  - `unmountReader(reader, doc)` — removes the reader and unhides every post.
  - `HIDDEN_ORIGINAL_CLASS` exported (was a private const in `content.ts`).
- `content.ts` `activate`/`deactivate` now delegate to these helpers; the old
  `readerAnchor` (which reached up to the wrapper) is removed, as is the now-unused
  `commonAncestor` import in the content script.

## Fix 2 — Body text matches the host site's font & size (was too small)

`theme.ts` now also samples the host body typography and feeds it through the same
`applyTheme` path:

- `ThemeVars` gains optional `fontFamily` / `fontSize` / `lineHeight`.
- `readThemeFromDocument` reads `font-family`, `font-size` and `line-height` from
  `.post-content` (fallback `body`); a computed `line-height: normal` is treated as
  *unsampled* so the reader's own readable fallback applies.
- `applyTheme` writes `--glr-font-family`, `--glr-font-size`, `--glr-line-height`
  (skipped when unsampled so the CSS fallback survives).
- `reader.css` defines the fallbacks **Helvetica, Verdana, sans-serif / 16px /
  1.25** and drives `.glr-reader` + `.glr-content` typography from the vars.
- The harness sets those exact fallbacks on every palette (`FONT_FALLBACK`),
  applied through the same `applyTheme`, so the offline preview matches the real
  site. Metadata (author/screenname) stays muted at `0.85em`; the character name
  stays bold.

Verified in headless Chromium: reader body computes to `font-size: 16px`,
`font-family: Helvetica, Verdana, sans-serif`, `line-height: 20px` (= 1.25 × 16).

## Fix 3 — Body text fills the post card (no mismatched inner width)

Removed the inner `max-width` measure cap (`--glr-measure`, the ~72ch limit) and
the `--glr-body-size` var. `.glr-content` now fills the post card's content box
edge-to-edge, inset only by the card's own `--glr-post-pad`, so the text width
matches the post borders with no left-aligned dead space.

Verified: `.glr-content` computes `max-width: none`, and its rendered width
(930px) equals the body card width minus padding exactly.

## Fix 4 — Seamless connector join (no gaps / doubled edges)

The icon box, connector and body band are translucent stripe tints; the old ~1px
overlaps therefore either *doubled* alpha (a dark seam) or left a sub-pixel *gap*
(a light seam). Each tinted piece is now painted as the translucent stripe
composited over an **opaque** copy of the host background:

```css
background: linear-gradient(var(--glr-stripe-a), var(--glr-stripe-a)), var(--glr-bg);
```

This looks identical to a bare translucent overlay on the reader's bg, but makes
each piece **fully opaque and identical in colour**. The connector now overlaps
~2px into both the icon box and the band; because the pieces are opaque and the
same colour, the overlap neither darkens nor gaps — the join is seamless in light
and dark. (`color-mix()` would be cleaner but isn't safe on the `chrome100` build
target.)

Verified: band/connector/arm computed `background-color` alpha = **1** (opaque) in
both light and dark, each carrying the stripe gradient on top.

## Fix 5 — Smooth, un-clipped hover preview

Reimplemented the full-size icon preview in a new `reader-core/previews.ts`
(`enableIconPreviews(root) → cleanup`):

- A **single** floating `.glr-icon-preview` element is appended to `<body>` —
  deliberately OUTSIDE the reader subtree — so no ancestor `overflow` can clip it
  and showing it causes **no layout shift** (it is `position: fixed`).
- Shown on hover after a small **140ms delay** (debounces fly-overs) with a CSS
  opacity **fade**; positioned next to the icon, flipping side / clamping to stay
  fully on-screen; capped at **200px** on its longest edge (natural size
  otherwise); very high z-index.
- **Skipped for monogram fallbacks** (iconless or broken/blocked images have no
  real `.glr-icon` img). Hides on leave and on scroll; `cleanup()` removes every
  listener and the floating node, so toggle-off leaves no trace.
- `render.ts` no longer emits a per-post `.glr-icon-pop` node; the old
  `:hover`-driven CSS preview is gone. `content.ts` and the harness both call
  `enableIconPreviews` and tear it down on deactivate/re-render.

Verified in headless Chromium (with a loadable data-URI icon, since the real CDN
icons can't load offline): the preview appears on hover, is a child of `<body>`,
becomes visible, stays inside the viewport, and carries z-index 2147483646.

---

## Tests

- `test/dom.test.ts`: added a Fix 1 suite — `mountReaderInPostList` anchors before
  the first `.post-container` (between the paginators), hides only the containers
  and never the `.paginator`s, works on a reply-only page 2+ with no OP, and
  returns `null` with no containers; `unmountReader` restores the exact original
  order.
- `test/theme.test.ts`: added Fix 2 cases — font/size/line-height sampling from
  `.post-content`, `normal` line-height treated as unsampled, and `applyTheme`
  writing / omitting the `--glr-font-*` vars.
- `test/previews.test.ts` (new): Fix 5 — preview shows on hover after the delay,
  is appended to `<body>` (not nested), is skipped for monograms, and is removed
  on cleanup.
- `test/reader-core.test.ts`, `test/layout.test.ts`: unchanged and still green
  (no test depended on the removed inner measure or the `.glr-icon-pop` node).

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
# tests 64
# suites 0
# pass 64
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

`web-ext` reports **0 errors**; `validate` exits 0. The 1 notice
(`MISSING_DATA_COLLECTION_PERMISSIONS`, a forward-looking Firefox manifest hint)
and 3 `UNSAFE_VAR_ASSIGNMENT` warnings (the defensive `innerHTML` sanitiser in
`buildBody` and the harness) are **pre-existing** and unrelated to this pass.

## Verification (headless geometry measurement, not screenshots)

Measured the built `dist/dev` harness in headless Chromium (the parent handles
screenshots):

| Check | light | dark |
| --- | --- | --- |
| reader `font-size` | 16px | 16px |
| reader `font-family` | Helvetica, Verdana, sans-serif | same |
| reader `line-height` | 20px | 20px |
| `.glr-content` `max-width` | none | none |
| `.glr-content` width vs (card − padding) | 930 == 930 | 930 == 930 |
| band / connector / arm bg alpha | 1 / 1 / 1 (opaque) | 1 / 1 / 1 |
| hover preview (data-URI icon) | floating in `<body>`, visible, on-screen, z 2147483646 | — |
