// Icon-arm flow-sizing. Each post owns a vertical "arm" in its gutter (left/right
// per post, alternating). Because the gutter beside the NEXT post is empty, an
// arm flows DOWNWARD across that adjacent post, past the message boundary, until
// it would meet the next arm ON THE SAME SIDE. That vertical span is the arm's
// FLOW SEGMENT; the post's icon image sits at the top of it. Dense same-side runs
// therefore have short arms; isolated arms reach all the way to the next icon.
//
// The geometry is split into a PURE core and a thin DOM layer (`layoutIcons`)
// that only measures each post's `offsetTop` and writes the arm height + square
// icon size. Two pure functions share one segment computation:
//   - `computeIconSegments` → the arm HEIGHT (uncapped flow segment): the tinted
//     arm fills the whole span down to the next same-side icon.
//   - `computeIconSizes`     → the icon IMAGE edge: that same segment capped at
//     `cap` (glowfic's native max), so the picture sits at the arm's top.
// Both the content script and the harness call `layoutIcons` after insertion and
// (debounced) on resize, since post heights — and therefore arm spans — change
// with viewport width.

/** Tunables for {@link computeIconSegments} / {@link computeIconSizes}; px. */
export interface IconSizeOpts {
  /** Floor size — roughly one line height, so dense runs stay tiny. */
  readonly min: number;
  /** Ceiling for the icon IMAGE — glowfic's native icon max (~100px). The arm
   *  itself is NOT capped: it spans the full flow segment. */
  readonly cap: number;
  /** Breathing room kept below an arm so it never touches the next same-side one. */
  readonly gap: number;
}

/** Defaults shared by the content script and harness when CSS vars are absent. */
export const DEFAULT_ICON_OPTS: IconSizeOpts = { min: 26, cap: 100, gap: 8 };

/**
 * Given the vertical offset (`top`) of each icon ON ONE GUTTER SIDE in document
 * order, plus the container's bottom edge, return each ARM's flow-segment height
 * — the span from the post's top down to just above the next same-side icon (or
 * the container bottom for the last one), with `gap` clearance and floored at
 * `opts.min`. This is the height of the tinted arm; it is deliberately UNCAPPED
 * so the arm fills the whole segment:
 *
 *     segment[i] = max(min, (nextTop - thisTop) - gap)
 *
 * Pure: no DOM, no globals, input never mutated.
 */
export function computeIconSegments(
  tops: readonly number[],
  containerBottom: number,
  opts: IconSizeOpts,
): number[] {
  const { min, gap } = opts;
  return tops.map((top, i) => {
    const nextTop = i + 1 < tops.length ? tops[i + 1] : containerBottom;
    // The full vertical span minus clearance; degenerate/negative spans floor at min.
    return Math.max(min, nextTop - top - gap);
  });
}

/**
 * Square edge length of each icon IMAGE: the same flow segment as
 * {@link computeIconSegments}, capped at `opts.cap` so the picture never exceeds
 * glowfic's native max and sits at the TOP of its (possibly much taller) arm:
 *
 *     size[i] = min(cap, segment[i])
 *
 * Pure: no DOM, no globals, input never mutated.
 */
export function computeIconSizes(
  tops: readonly number[],
  containerBottom: number,
  opts: IconSizeOpts,
): number[] {
  const { cap } = opts;
  return computeIconSegments(tops, containerBottom, opts).map((seg) => Math.min(cap, seg));
}

/** Parse a CSS length custom property to px, falling back when unset/invalid. */
function readPx(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const v = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Measure-and-apply pass. For each gutter side, collect that side's posts in
 * document order, read each post's `offsetTop` (relative to the positioned
 * `.glr-column`), then:
 *   - size the post's tinted ARM to the flow segment ({@link computeIconSegments})
 *     so it spans down to just above the next same-side icon, and
 *   - size the icon IMAGE/monogram square to `min(segment, cap, gutter)`
 *     ({@link computeIconSizes}, additionally clamped to the gutter width) so it
 *     sits at the top of that arm.
 *
 * The arm is absolutely pinned (CSS `top: 0`) to its post, so its own height
 * never affects row layout and it is free to overflow downward into the adjacent
 * (opposite-side, empty) gutter. Tunables come from the reader's CSS custom
 * properties (`--glr-icon-min/-cap/-gap`, `--glr-gutter`) so they stay
 * co-located with the styling, with {@link DEFAULT_ICON_OPTS} as the fallback.
 *
 * Idempotent and safe to call repeatedly (e.g. on resize).
 */
export function layoutIcons(root: HTMLElement): void {
  const column = (root.querySelector('.glr-column') as HTMLElement | null) ?? root;

  // Resolve tunables from CSS vars when a window is available; else defaults.
  let opts = DEFAULT_ICON_OPTS;
  let gutter = DEFAULT_ICON_OPTS.cap;
  const win = root.ownerDocument?.defaultView;
  if (win?.getComputedStyle) {
    const cs = win.getComputedStyle(root);
    opts = {
      min: readPx(cs, '--glr-icon-min', DEFAULT_ICON_OPTS.min),
      cap: readPx(cs, '--glr-icon-cap', DEFAULT_ICON_OPTS.cap),
      gap: readPx(cs, '--glr-icon-gap', DEFAULT_ICON_OPTS.gap),
    };
    gutter = readPx(cs, '--glr-gutter', opts.cap);
  }

  const containerBottom = column.offsetHeight || 0;

  for (const side of ['left', 'right'] as const) {
    // Measure each post (its offsetTop is the post's top relative to the
    // positioned column); size the ARM inside it (absolutely pinned to the post
    // top, so it grows downward into the adjacent post's empty gutter).
    const posts = Array.from(
      root.querySelectorAll<HTMLElement>(`.glr-post--${side}`),
    );
    if (posts.length === 0) continue;
    const tops = posts.map((p) => p.offsetTop);
    const segments = computeIconSegments(tops, containerBottom, opts);
    const sizes = computeIconSizes(tops, containerBottom, opts);
    posts.forEach((post, i) => {
      const arm = post.querySelector<HTMLElement>('.glr-arm');
      if (arm) arm.style.height = `${Math.round(segments[i])}px`;
      const box = post.querySelector<HTMLElement>('.glr-icon-box');
      if (box) {
        // The icon never outgrows its gutter, its arm, or the cap.
        const px = `${Math.round(Math.min(sizes[i], gutter))}px`;
        box.style.width = px;
        box.style.height = px;
      }
    });
  }
}
