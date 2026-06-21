# glowficlog — styling iteration v4

Fourth styling pass on the reader. The previous (v3) layout painted each post's
tint as a **gutter "arm"** that flowed from the icon all the way DOWN to the next
same-side icon — a tall vertical stroke far below the icon. v4 replaces that with
the spec-v4 shape: a **compact, icon-centred tinted box** + a **thin connector**
+ the **post body rectangle**, all sharing the post's tint.

All structural/data-flow conventions are unchanged: TypeScript, immutable
`Post[]` → pure `renderReader`, `glr-`-scoped classes, defensive content script,
vanilla DOM, no swallowed errors. Theme inheritance, pagination (page 2+ via
`commonAncestor`), the monogram `onerror` fallback, first-appearance/condensed
identity, and the offline `?fixture=&theme=` harness all still work.

---

## Correction 1 — Compact, icon-centred tinted box + thin connector (MAIN FIX)

The tinted gutter element (`.glr-arm`) is no longer a full flow-segment stroke.
It is now a **compact rounded box = the icon square + a symmetric padding on all
four sides**, centred on the icon and top-aligned with the post's first line. It
never extends below the icon beyond that padding.

- The icon image (`.glr-icon-box`) is wrapped in `.glr-arm`, which carries
  `padding: var(--glr-icon-pad)` and `width/height: fit-content`, so the tinted
  box is *always* exactly `icon + 2 × pad` (measured: a 96px icon → a 112×112
  box, with the arm extending exactly 8px — the padding — below the icon).
- `.glr-arm` is absolutely placed and **hugs the text column** at the inner edge
  of its gutter (`right: calc(100% - var(--glr-gutter))` on the left;
  `left: …` on the right), top-aligned at `var(--glr-post-pad)` so the icon lines
  up with the identity line.
- A new **`.glr-connector`** element is the thin horizontal stroke of the "L":
  it bridges the icon box to the body band across the gutter→body gap, overlapping
  each by ~1px for a seamless join, and sits at the post's first-line height
  (`top: calc(var(--glr-post-pad) + 0.3em)`, `height: var(--glr-connector-h)`).
- `.glr-band` is now the **post's body rectangle** (the spec's large rectangle):
  it covers exactly the centre column behind the text, full body height, rounded
  on all corners. The body text paints above it (`z-index`) so contrast is intact.

Icon box (`.glr-arm`), connector and body band all carry the post's
`glr-stripe-a/-b`, so they read as one connected region in the post's tint.

`render.ts`: added the `.glr-connector` element (aria-hidden, stripe-tinted)
between the band and the arm; rewrote the `buildArm` doc-comment (it now builds a
compact box, not a flowing arm). No change to the immutable/pure contract.

## Correction 2 — Icon sizing: cap-primary, shrink only for same-side overlap

`computeIconSizes` is kept purely as the **collision/shrink** constraint, and the
cap is now the PRIMARY size:

    size[i] = clamp(min, (nextTop - thisTop) - gap, cap)

- The cap (`--glr-icon-cap: 96px`) is used whenever same-side spacing allows, so
  long posts get ~cap icons in compact boxes (verified: long-infodump and
  icon-heavy render 96px icons throughout; the dense dialogue thread shrinks only
  the trailing post that runs into the container bottom → 63px).
- `layoutIcons` now folds the box padding into the clearance it passes to
  `computeIconSizes` (`gap → gap + 2 × pad`) so the whole *padded* box — not just
  the raw image — never overlaps the next same-side box, and clamps the image to
  `gutter − 2 × pad` so the box always fits its gutter.
- The previous `computeIconSegments` helper (the *uncapped* flow-segment height
  that drove the long arm) is **removed**, along with the `arm.style.height`
  write in `layoutIcons`. The box now derives its height from the icon + padding
  in CSS; no JS height is set on the arm.

## Correction 3 — Dividers removed

The inter-post `border-top` separators (`.glr-post + .glr-post` and the
`.glr-post--op` override) are gone. Posts are now separated by **spacing +
alternating tint only**: `.glr-post + .glr-post { margin-top: var(--glr-post-gap) }`.
(Verified: 0 posts have a `border-top` in any fixture.) `--glr-sep-width` was
removed; `--glr-sep` is retained for blockquote rules. OP keeps a subtle accent
rail via `box-shadow: inset 3px 0 0 0 var(--glr-chip-bg)` on its body band rather
than a divider.

## Correction 4 — Post padding & readability-optimised text

- **Comfortable internal padding** inside every post body via
  `--glr-post-pad: 18px` on `.glr-body` (the band rectangle covers the padded
  area, so the whole card is tinted while the text is inset).
- **Readable body text**: full `--glr-fg`, `--glr-body-size: 15.5px`,
  `line-height: 1.6`, measure tightened to `--glr-measure: 72ch` (was 78ch) so
  lines stay readable even though the card is wider, and paragraph spacing bumped
  to `0.85em`.
- **Vertical rhythm**: identity block margin raised to 8px; the **character name**
  is made distinct (bold, full fg, `1.02em`, slight letter-spacing) while author
  / screenname stay muted (`--glr-muted`) but legible — preserving dark-theme
  contrast.

---

## New / changed CSS custom properties (`.glr-reader`)

| Property | v4 value | Notes |
| --- | --- | --- |
| `--glr-icon-pad` | `8px` | **new** — symmetric padding around the icon in its box |
| `--glr-connector-h` | `12px` | **new** — thickness of the icon→body connector |
| `--glr-post-pad` | `18px` | **new** — body internal padding |
| `--glr-post-gap` | `16px` | **new** — spacing between posts (replaces dividers) |
| `--glr-icon-cap` | `96px` | was `100px`; cap is now the PRIMARY size |
| `--glr-icon-min` | `28px` | was `26px` |
| `--glr-gap` | `16px` | was `14px`; also the connector length |
| `--glr-radius` | `12px` | was `9px`; box + body-rectangle rounding |
| `--glr-measure` | `72ch` | was `78ch` (Req 4) |
| `--glr-col-max` | `1040px` | was `1100px` |
| `--glr-row-pad` | — | **removed** (replaced by `--glr-post-pad` / `--glr-post-gap`) |
| `--glr-sep-width` | — | **removed** (no dividers) |

`layout.ts` also exports `DEFAULT_ICON_PAD` (8) as the JS fallback for
`--glr-icon-pad`.

## How the compact box + connector are implemented (summary)

- `.glr-arm` = `position:absolute; padding: var(--glr-icon-pad); width/height:
  fit-content` → shrink-wraps the JS-sized `.glr-icon-box` into an `icon + pad`
  tinted box, hugging the text column and top-aligned with the first line.
- `.glr-connector` = a thin absolutely-placed bar spanning the gutter→body gap at
  the first-line height, tinted with the post stripe.
- `.glr-band` = an absolutely-placed rounded rectangle over the centre column,
  full body height, tinted with the post stripe; body text sits above it.
- `layoutIcons` writes only the square `.glr-icon-box` size (cap-primary, padded
  clearance, gutter-clamped); CSS derives the box height from icon + padding.

## Tests

- `test/layout.test.ts`: removed the `computeIconSegments` suite and the
  arm-height assertions; kept the full `computeIconSizes` suite (size/shrink
  behaviour) and added a `cap is the PRIMARY size whenever space allows` case and
  a `DEFAULT_ICON_PAD` range check. `layoutIcons` tests now assert the compact box
  size and that **no** flowing height is written to the arm.
- `test/reader-core.test.ts`: structure tests now also assert the
  `.glr-connector` exists, carries the post stripe, and is `glr-`-scoped.
- `test/theme.test.ts`, `test/dom.test.ts`: unchanged.

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
# tests 51
# suites 0
# pass 51
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

`web-ext` reports **0 errors**. The 1 notice
(`MISSING_DATA_COLLECTION_PERMISSIONS`, a forward-looking Firefox manifest hint)
and 3 `UNSAFE_VAR_ASSIGNMENT` warnings (the defensive `innerHTML` sanitiser in
`buildBody` and the harness) are **pre-existing** and unrelated to this pass;
`validate` exits 0.

## Verification (headless geometry measurement, not screenshots)

Rendered the built `dist/dev` harness in headless Chromium and measured (no
screenshots — the parent handles those):

- `dividerCount (border-top > 0) = 0 / N` for every fixture.
- `.glr-arm` = 112×112 for a 96px icon; arm extends exactly **8px** (the padding)
  below the icon box → the box never extends below the icon.
- Connector top = 23px below body top (the first/identity line); bridges the
  icon box to the body band.
- Body padding-top = 18px.
- Icons are 96px (cap) across long/icon-heavy threads; the dense dialogue thread
  shrinks only the trailing post (→ 63px), confirming cap-primary + shrink.
