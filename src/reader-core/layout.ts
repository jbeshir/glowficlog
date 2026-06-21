// Icon sizing. Each post owns a COMPACT, icon-centred tinted box in its gutter
// (left/right per post, alternating): the box is just the icon image plus a
// small symmetric padding — it does NOT flow down to the next same-side icon.
// The PRIMARY size is the cap (~96px, glowfic's native max); an icon shrinks
// ONLY when the vertical space to the next icon ON THE SAME SIDE would let its
// (padded) box overlap the next one. So long posts keep cap-sized icons in
// compact boxes; dense short runs get smaller icons. The box tint, a thin
// connector and the post body all share the post's stripe, reading as one region.
//
// The geometry is split into a PURE core (`computeIconSizes`) and a thin DOM
// layer (`layoutIcons`) that measures each post's `offsetTop` and writes the
// square icon-box size. The arm/box height is NOT set here — CSS derives it from
// the icon size plus `--glr-icon-pad`, so the box stays exactly icon + padding.

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

/**
 * Measure-and-apply pass. For each gutter side, collect that side's posts in
 * document order, read each post's `offsetTop` (relative to the positioned
 * `.glr-column`), then size the icon IMAGE/monogram square to
 * {@link computeIconSizes}, additionally clamped so the *padded* box fits the
 * gutter width. The clearance passed to `computeIconSizes` is widened by twice
 * the icon padding so a cap-sized box never collides with the next same-side
 * box (the box is icon + 2 × pad).
 *
 * Only the icon-box square is written; the surrounding tinted box (`.glr-arm`)
 * derives its size from that square plus `--glr-icon-pad` in CSS, so it always
 * stays exactly icon + padding and never grows into a flowing arm. Tunables come
 * from the reader's CSS custom properties (`--glr-icon-min/-cap/-gap/-pad`,
 * `--glr-gutter`) with {@link DEFAULT_ICON_OPTS} / {@link DEFAULT_ICON_PAD} as
 * the fallback.
 *
 * Idempotent and safe to call repeatedly (e.g. on resize).
 */
export function layoutIcons(root: HTMLElement): void {
  const column = (root.querySelector('.glr-column') as HTMLElement | null) ?? root;

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
    const sizes = computeIconSizes(tops, containerBottom, clearance);
    posts.forEach((post, i) => {
      const box = post.querySelector<HTMLElement>('.glr-icon-box');
      if (box) {
        const px = `${Math.round(Math.min(sizes[i], maxImage))}px`;
        box.style.width = px;
        box.style.height = px;
      }
    });
  }
}
