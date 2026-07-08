// Icon sizing. Each post owns a COMPACT, icon-centred tinted box in its gutter
// (left/right per post, alternating): the box is just the icon image plus a
// small symmetric padding — it does NOT flow down to the next same-side icon.
// The PRIMARY size is the cap (~96px, glowfic's native max); an icon shrinks
// ONLY when the vertical space to the next icon ON THE SAME SIDE would let its
// (padded) box overlap the next one. So long posts keep cap-sized icons in
// compact boxes; dense short runs get smaller icons. The box tint, a thin
// connector and the post body all share the post's stripe, reading as one region.
//
// Icons keep their natural ASPECT RATIO: `computeIconSizes` gives each icon's
// vertical budget (its MAX HEIGHT), the gutter width is its MAX WIDTH, and
// `fitIconBox` scales the real image into both, so portrait/landscape icons are
// shown un-cropped, bounded so they can't grow too tall (same-side collision) or
// too wide (gutter overflow).
//
// The geometry is split into a PURE core (`computeIconSizes` + `fitIconBox`) and
// a thin DOM layer (`layoutIcons`) that measures each post's `offsetTop` and the
// icon's natural size and writes the fitted icon-box width/height. The surrounding
// arm padding is NOT set here — CSS derives it from `--glr-icon-pad`, so the box
// stays exactly icon + padding.

/** Tunables for {@link computeIconSizes}; px. */
export interface IconSizeOpts {
  /** Floor size — roughly one line height, so dense runs stay tiny. */
  readonly min: number;
  /** Ceiling / PRIMARY size — glowfic's native icon max (~96px). An icon is the
   *  cap unless same-side spacing forces it smaller. */
  readonly cap: number;
  /** Clearance kept between one (padded) box and the next same-side box. */
  readonly gap: number;
}

/** Defaults shared by the content script and harness when CSS vars are absent. */
export const DEFAULT_ICON_OPTS: IconSizeOpts = { min: 26, cap: 100, gap: 8 };

/** Default symmetric padding around the icon inside its tinted box (`--glr-icon-pad`). */
export const DEFAULT_ICON_PAD = 8;

/**
 * Square edge length of each icon IMAGE on ONE gutter side, in document order.
 * The icon is the cap by default; it only shrinks when the gap to the next
 * same-side icon (or the container bottom for the last one) cannot fit a
 * cap-sized box plus `opts.gap` clearance:
 *
 *     size[i] = clamp(min, (nextTop - thisTop) - gap, cap)
 *
 * `gap` here is the FULL clearance the caller wants kept between consecutive
 * boxes; `layoutIcons` folds the box padding (2 × icon-pad) into it so the
 * *padded* boxes — not just the raw images — never overlap.
 *
 * Pure: no DOM, no globals, input never mutated.
 */
export function computeIconSizes(
  tops: readonly number[],
  containerBottom: number,
  opts: IconSizeOpts,
): number[] {
  const { min, cap, gap } = opts;
  return tops.map((top, i) => {
    const nextTop = i + 1 < tops.length ? tops[i + 1] : containerBottom;
    // Available span minus clearance; degenerate/negative spans floor at min,
    // ample spans clamp at the cap (the cap is the PRIMARY size).
    return Math.min(cap, Math.max(min, nextTop - top - gap));
  });
}

/** Parse a CSS length custom property to px, falling back when unset/invalid. */
function readPx(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const v = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// Non-square icon fitting (aspect-ratio preserving)
// ---------------------------------------------------------------------------

/** A fitted icon box's pixel dimensions. */
export interface IconBox {
  readonly w: number;
  readonly h: number;
}

/**
 * PURE: fit an icon of natural size `natW × natH` into its gutter, PRESERVING
 * aspect ratio, bounded so it can neither grow too tall (and collide with the
 * next same-side icon) nor too wide (and protrude past its gutter into the text
 * or off-page):
 *
 *   - `maxHeight` is the vertical budget for this icon — the same-side span from
 *     {@link computeIconSizes}, which already folds in the cap — so the box's
 *     HEIGHT never exceeds it (no same-side collision, never taller than the cap).
 *   - `maxWidth` is the gutter's inner width, so the box's WIDTH never exceeds it
 *     (never overflows the gutter).
 *
 * The icon is scaled as large as it can be while fitting BOTH budgets (so a
 * roughly-square icon still fills toward the cap, matching the prior behaviour),
 * with aspect ratio intact. When natural dimensions are unknown — 0, i.e. the
 * image has not decoded yet, or it is a monogram with no real image — it falls
 * back to a SQUARE box of `min(maxHeight, maxWidth)`, exactly the pre-aspect
 * sizing, so nothing regresses until the real dimensions are known.
 *
 * No DOM, no globals, inputs never mutated.
 */
export function fitIconBox(
  natW: number,
  natH: number,
  maxHeight: number,
  maxWidth: number,
): IconBox {
  if (!(natW > 0) || !(natH > 0)) {
    const s = Math.min(maxHeight, maxWidth);
    return { w: s, h: s };
  }
  const scale = Math.min(maxHeight / natH, maxWidth / natW);
  return { w: natW * scale, h: natH * scale };
}

// ---------------------------------------------------------------------------
// Single-line body detection (drives icon-side body alignment)
// ---------------------------------------------------------------------------

/**
 * Slack allowed on top of one line height before a body counts as multi-line.
 * One line of text occupies ~1× the line height; 1.6× comfortably clears a
 * single line's descenders/leading yet stays well below the ~2× a wrapped second
 * line would add, so the threshold cleanly separates one line from two.
 */
export const SINGLE_LINE_FACTOR = 1.6;

/** Width-independent inputs for {@link isSingleLine}. */
export interface SingleLineInput {
  /** Measured rendered height of the `.glr-content` box, px. */
  readonly heightPx: number;
  /** Resolved line height of that box, px (see {@link resolveLineHeightPx}). */
  readonly lineHeightPx: number;
  /** Number of BLOCK-LEVEL element children of the content box. */
  readonly blockChildCount: number;
}

/**
 * PURE decision: does a post body render as a single, non-wrapping visual line?
 *
 * Robust against the naive `Range.getClientRects()` trap (a single `<p>` yields
 * the block's own rect PLUS its text-line rect ~1px apart, which a distinct-top
 * count would miscount as two): instead we compare the measured CONTENT height
 * to the line height. A body is single-line iff it has AT MOST ONE block-level
 * child AND its height fits within {@link SINGLE_LINE_FACTOR} line heights.
 *
 * - `blockChildCount > 1` → multiple stacked blocks → never single-line.
 * - `heightPx <= 0` (empty body) → treated as single-line (aligning an empty
 *   body is a no-op, so this is the harmless, stable choice).
 * - non-positive `lineHeightPx` (couldn't resolve) with real height → NOT
 *   single-line, the conservative default that leaves the body left-aligned.
 *
 * No DOM, no globals: just numbers in, boolean out.
 */
export function isSingleLine(input: SingleLineInput): boolean {
  const { heightPx, lineHeightPx, blockChildCount } = input;
  if (blockChildCount > 1) return false;
  if (heightPx <= 0) return true; // empty body → no visible effect either way
  if (!(lineHeightPx > 0)) return false; // can't measure a line → stay left
  return heightPx <= lineHeightPx * SINGLE_LINE_FACTOR;
}

/**
 * Resolve a content box's used line height to px from its computed style,
 * handling the three forms `line-height` can take: `normal` (≈1.2 × font-size),
 * a unitless multiplier (e.g. `1.25` → multiplier × font-size), and an absolute
 * `px` length. Falls back to 1.2 × font-size when the value is unparseable.
 */
function resolveLineHeightPx(style: CSSStyleDeclaration): number {
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const raw = (style.lineHeight || '').trim();
  if (!raw || raw === 'normal') return fontSize * 1.2;
  const num = Number.parseFloat(raw);
  if (!Number.isFinite(num)) return fontSize * 1.2;
  if (raw.endsWith('px')) return num;
  if (/^[0-9.]+$/.test(raw)) return num * fontSize; // unitless multiplier
  return num; // any other unit already in px-ish length; use the number
}

/** Count an element's BLOCK-LEVEL element children (inline-ish/none excluded). */
const INLINE_DISPLAYS = new Set([
  'inline',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'contents',
  'none',
]);
function countBlockChildren(content: HTMLElement, win: Window | null): number {
  let n = 0;
  for (const child of Array.from(content.children)) {
    if (win?.getComputedStyle) {
      if (!INLINE_DISPLAYS.has(win.getComputedStyle(child).display)) n++;
    } else {
      n++; // can't measure display → assume block (conservative: more likely multi)
    }
  }
  return n;
}

/**
 * Layout-time pass: for every `.glr-post`, decide whether its `.glr-content`
 * body is a single visual line and toggle `glr-body--single` on the post
 * accordingly. CSS then right-aligns ONLY right-gutter single-line bodies
 * (`.glr-post--right.glr-body--single .glr-content`); everything else stays
 * left. Width-dependent (wrapping changes with viewport width), so it must run
 * after insert AND on the debounced resize, alongside {@link layoutIcons}.
 *
 * Idempotent and safe to call repeatedly.
 */
export function markSingleLineBodies(root: HTMLElement): void {
  const win = root.ownerDocument?.defaultView ?? null;
  const posts = root.querySelectorAll<HTMLElement>('.glr-post');
  for (const post of Array.from(posts)) {
    const content = post.querySelector<HTMLElement>('.glr-content');
    let single = false;
    if (content) {
      const blockChildCount = countBlockChildren(content, win);
      const lineHeightPx = win?.getComputedStyle
        ? resolveLineHeightPx(win.getComputedStyle(content))
        : 0;
      const heightPx = content.getBoundingClientRect().height;
      single = isSingleLine({ heightPx, lineHeightPx, blockChildCount });
    }
    post.classList.toggle('glr-body--single', single);
  }
}

/**
 * Measure-and-apply pass. For each gutter side, collect that side's posts in
 * document order, read each post's `offsetTop` (relative to the positioned
 * `.glr-column`), compute its vertical budget via {@link computeIconSizes}, then
 * fit the real icon into that height and the gutter width with {@link fitIconBox},
 * preserving aspect ratio. The clearance passed to `computeIconSizes` is widened
 * by twice the icon padding so a cap-sized box never collides with the next
 * same-side box (the box is icon + 2 × pad).
 *
 * Only the icon-box width/height are written; the surrounding tinted box
 * (`.glr-arm`) derives its padding from `--glr-icon-pad` in CSS, so it always
 * stays exactly icon + padding and never grows into a flowing arm. Tunables come
 * from the reader's CSS custom properties (`--glr-icon-min/-cap/-gap/-pad`,
 * `--glr-gutter`) with {@link DEFAULT_ICON_OPTS} / {@link DEFAULT_ICON_PAD} as
 * the fallback.
 *
 * Idempotent and safe to call repeatedly (e.g. on resize). Icons whose natural
 * size is not yet known get a one-shot `load` listener that re-runs the pass once
 * they decode, so the aspect-correct box replaces the square fallback.
 */
export function layoutIcons(root: HTMLElement): void {
  const column = root.querySelector<HTMLElement>('.glr-column') ?? root;

  // Resolve tunables from CSS vars when a window is available; else defaults.
  let opts = DEFAULT_ICON_OPTS;
  let pad = DEFAULT_ICON_PAD;
  let gutter = DEFAULT_ICON_OPTS.cap + 2 * DEFAULT_ICON_PAD;
  const win = root.ownerDocument?.defaultView;
  if (win?.getComputedStyle) {
    const cs = win.getComputedStyle(root);
    opts = {
      min: readPx(cs, '--glr-icon-min', DEFAULT_ICON_OPTS.min),
      cap: readPx(cs, '--glr-icon-cap', DEFAULT_ICON_OPTS.cap),
      gap: readPx(cs, '--glr-icon-gap', DEFAULT_ICON_OPTS.gap),
    };
    pad = readPx(cs, '--glr-icon-pad', DEFAULT_ICON_PAD);
    gutter = readPx(cs, '--glr-gutter', opts.cap + 2 * pad);
  }

  // Keep the WHOLE padded box clear of the next same-side box, and never let the
  // padded box outgrow its gutter.
  const clearance = { min: opts.min, cap: opts.cap, gap: opts.gap + 2 * pad };
  const maxImage = Math.max(opts.min, gutter - 2 * pad);

  const containerBottom = column.offsetHeight || 0;

  for (const side of ['left', 'right'] as const) {
    const posts = Array.from(
      root.querySelectorAll<HTMLElement>(`.glr-post--${side}`),
    );
    if (posts.length === 0) continue;
    const tops = posts.map((p) => p.offsetTop);
    // computeIconSizes gives each icon's vertical budget (same-side span, capped):
    // that is the box's MAX HEIGHT. The gutter inner width (maxImage) is the box's
    // MAX WIDTH. fitIconBox scales the real image into both, preserving aspect.
    const sizes = computeIconSizes(tops, containerBottom, clearance);
    posts.forEach((post, i) => {
      const box = post.querySelector<HTMLElement>('.glr-icon-box');
      if (!box) return;
      const img = box.querySelector<HTMLImageElement>('.glr-icon');
      const { w, h } = fitIconBox(
        img?.naturalWidth ?? 0,
        img?.naturalHeight ?? 0,
        sizes[i],
        maxImage,
      );
      box.style.width = `${Math.round(w)}px`;
      box.style.height = `${Math.round(h)}px`;
      // An icon's natural size is unknown until it decodes (it loads AFTER this
      // pass runs at mount). Re-flow once it does so the square fallback above is
      // replaced by the aspect-correct box. Guarded + one-shot so repeated
      // layoutIcons calls (resize) never stack listeners.
      if (img && !(img.naturalWidth > 0) && img.dataset.glrRelayout !== '1') {
        img.dataset.glrRelayout = '1';
        img.addEventListener('load', () => layoutIcons(root), { once: true });
      }
    });
  }
}
