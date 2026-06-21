# glowficlog — v7b changes

## Goal

Replace the unconditional *"always right-align right-gutter bodies"* rule with
**measured single-line alignment**: a post body aligns to its icon side ONLY when
it renders as a single, non-wrapping line.

- right-gutter post whose body is **one line** → body right-aligns (sits under its icon);
- left-gutter single-line post → stays left (no visible change);
- **any** body that wraps to 2+ lines (or has multiple block children) → left-aligned, both sides.

So the only visible change from the browser default remains right-gutter posts with a
one-line body — but now correctly *measured*, not blanket-applied.

---

## What changed

### `src/reader-core/layout.ts`
- New **pure** helper `isSingleLine({ heightPx, lineHeightPx, blockChildCount })` — the
  width-independent decision, factored out for unit testing:
  - `blockChildCount > 1` → `false` (multiple stacked blocks are never one visual line);
  - `heightPx <= 0` (empty body) → `true` (aligning an empty body is a no-op — the stable choice);
  - non-positive `lineHeightPx` with real height → `false` (conservative: stay left);
  - otherwise single iff `heightPx <= lineHeightPx * SINGLE_LINE_FACTOR` (`1.6`).
  This is **robust against the `Range.getClientRects()` block+line ~1px double-rect trap**
  (a single `<p>` exposes its block rect *and* its text-line rect ~1px apart, which a
  naive distinct-top count miscounts as two lines): we compare measured **content height**
  to **line height** instead of counting rect tops.
- New `resolveLineHeightPx(style)` — resolves `line-height` to px from computed style,
  handling `normal` (≈1.2 × font-size), a unitless multiplier (`1.25` → × font-size), and an
  absolute `px` length.
- New DOM pass `markSingleLineBodies(root)` — per `.glr-post`, measures its `.glr-content`
  (block-child count via computed `display`, line height, `getBoundingClientRect().height`),
  calls `isSingleLine`, and toggles `glr-body--single` on the post. Idempotent; safe to
  re-run on resize. Exports `SINGLE_LINE_FACTOR` and the `SingleLineInput` type.

### `src/reader-core/reader.css`
- **Removed** the unconditional `.glr-post--right .glr-content { text-align: right; }`.
- **Added** `.glr-post--right.glr-body--single .glr-content { text-align: right; }` — the
  ONLY rule that right-aligns a body now. Nothing else right-aligns bodies.
- The right-gutter **name** alignment (`.glr-post--right .glr-identity { justify-content: flex-end }`)
  is unchanged, and the **OP connector lengthening** (`width: calc(--glr-icon-pad + --glr-gap + 6px)`,
  the ~6px band-side overlap) is **retained** verbatim.

### `src/reader-core/index.ts`
- Exports `markSingleLineBodies`, `isSingleLine`, `resolveLineHeightPx`,
  `SINGLE_LINE_FACTOR`, and the `SingleLineInput` type.

### `src/content/content.ts` and `src/dev/harness.ts`
- Call `markSingleLineBodies(reader)` **right after `layoutIcons`** on insert, AND in the
  debounced resize handler (alongside `layoutIcons`) — so wrapping changes with viewport
  width re-evaluate the single-line state in **both** the content script and the harness.

### `test/layout.test.ts`
- Added unit tests for the pure `isSingleLine` decision (single line → true; wrapped 2nd
  line → false; multiple block children → false even when short; inline-only one line →
  true; tolerance-boundary edge; the block+line ~1px trap; empty body; unmeasurable line
  height → false).
- Added jsdom DOM-pass tests for `markSingleLineBodies` with mocked geometry: short body
  gets the class / tall body does not; re-run after a wrap drops the class (resize); two
  block children stay unmarked even when short.
- No test asserted the old always-right CSS rule, so none needed removing.

---

## Headless Chromium verification (real layout)

A standalone page (built `reader.css` + an IIFE bundle of `reader-core`) with four bodies —
**A** left/short, **B** right/short, **C** right/long (always wraps), **D** right/borderline —
was measured in headless Chromium, running `markSingleLineBodies` at 1200px then at 360px:

| Post | Side  | Wide 1200px → `single` / `text-align` (height) | Narrow 360px → `single` / `text-align` (height) |
|------|-------|-----------------------------------------------|------------------------------------------------|
| A    | left  | `true` / **start (left)** (20px)              | `false` / start (left) (60px)                  |
| B    | right | `true` / **right** (20px)                     | `true` / **right** (20px)                       |
| C    | right | `false` / **start (left)** (80px)             | `false` / start (left) (2000px)                 |
| D    | right | `true` / **right** (20px)                     | **`false` / start (left)** (500px)              |

This confirms every required behaviour:
- short right post (B, D-wide) → `glr-body--single` **and** computed `text-align: right`;
- long right post (C) → **no** class, `text-align: start` (left);
- short left post (A-wide) → single but **left** (`start`) — no visible change, since CSS
  only right-aligns `.glr-post--right.glr-body--single`;
- **resize wrap drops the class**: borderline D right-aligns at 1200px and, once it wraps at
  360px, loses `glr-body--single` and reverts to left.

No console/page errors during the run.

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
1..79
# tests 79
# suites 0
# pass 79
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

`errors 0` (the 1 notice + 3 warnings are pre-existing and unrelated: the Firefox
`data_collection_permissions` future-requirement notice, and the standard `innerHTML`
assignment warnings on the renderer's defence-in-depth body insertion). All 79 tests pass,
up from the prior suite — the new `isSingleLine` and `markSingleLineBodies` tests are included.

---

## Files

- `/out/repo` — updated repo (incl. `.git`), committed on `build/glowficlog-v1`.
- `/out/dist` — rebuilt extension + harness.
- `/out/CHANGES-v7b.md` — this file.
