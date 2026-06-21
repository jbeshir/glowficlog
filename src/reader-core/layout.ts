// Icon flow-sizing. Icons alternate gutters (left/right per post), so the gutter
// beside the NEXT post is empty — an icon may grow DOWNWARD across that adjacent
// post, across the message boundary, until it would meet the next icon ON THE
// SAME SIDE. Dense same-side runs therefore stay small; isolated icons grow up
// to the cap.
//
// The geometry is split into a PURE core (`computeIconSizes`, exhaustively unit
// tested) and a thin DOM layer (`layoutIcons`) that only measures `offsetTop`
// and writes square `width`/`height`. Both the content script and the harness
// call `layoutIcons` after insertion and (debounced) on resize, since post
// heights — and therefore icon spacing — change with viewport width.

/** Tunables for {@link computeIconSizes}; px. */
export interface IconSizeOpts {
  /** Floor size — roughly one line height, so dense runs stay tiny. */
  readonly min: number;
  /** Ceiling size — glowfic's native icon max (~100px). */
  readonly cap: number;
  /** Breathing room kept below an icon so it never touches the next same-side one. */
  readonly gap: number;
}

/** Defaults shared by the content script and harness when CSS vars are absent. */
export const DEFAULT_ICON_OPTS: IconSizeOpts = { min: 26, cap: 100, gap: 8 };

/**
 * Given the vertical offset (`top`) of each icon ON ONE GUTTER SIDE in document
 * order, plus the container's bottom edge, return each icon's square edge length.
 *
 * Each icon may grow to fill the gap down to the next same-side icon (or the
 * container bottom for the last one), capped at `opts.cap` and floored at
 * `opts.min`:
 *
 *     size[i] = clamp(min, min(cap, (nextTop - thisTop) - gap), cap)
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
    const available = nextTop - top - gap;
    // min(cap, available) is the desired size; flooring at `min` keeps dense
    // runs (and any degenerate negative span) at the minimum.
    return Math.max(min, Math.min(cap, available));
  });
}

/** Parse a CSS length custom property to px, falling back when unset/invalid. */
function readPx(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const v = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Measure-and-apply pass. For each gutter side, collect that side's icon boxes
 * in document order, read their `offsetTop` (relative to the positioned
 * `.glr-column`), compute sizes with {@link computeIconSizes}, and write square
 * `width`/`height` onto each icon box. Tunables come from the reader's CSS
 * custom properties (`--glr-icon-min/-cap/-gap`) so they stay co-located with
 * the rest of the styling, with {@link DEFAULT_ICON_OPTS} as the fallback.
 *
 * Idempotent and safe to call repeatedly (e.g. on resize).
 */
export function layoutIcons(root: HTMLElement): void {
  const column = (root.querySelector('.glr-column') as HTMLElement | null) ?? root;

  // Resolve tunables from CSS vars when a window is available; else defaults.
  let opts = DEFAULT_ICON_OPTS;
  const win = root.ownerDocument?.defaultView;
  if (win?.getComputedStyle) {
    const cs = win.getComputedStyle(root);
    opts = {
      min: readPx(cs, '--glr-icon-min', DEFAULT_ICON_OPTS.min),
      cap: readPx(cs, '--glr-icon-cap', DEFAULT_ICON_OPTS.cap),
      gap: readPx(cs, '--glr-icon-gap', DEFAULT_ICON_OPTS.gap),
    };
  }

  const containerBottom = column.offsetHeight || 0;

  for (const side of ['left', 'right'] as const) {
    // Measure the grid CELL (its offsetTop is the post's top relative to the
    // positioned column); size the BOX inside it (absolutely pinned to the
    // cell top, so it grows downward into the adjacent post's empty gutter).
    const cells = Array.from(
      root.querySelectorAll<HTMLElement>(`.glr-post--${side} .glr-icon-cell`),
    );
    if (cells.length === 0) continue;
    const tops = cells.map((c) => c.offsetTop);
    const sizes = computeIconSizes(tops, containerBottom, opts);
    cells.forEach((cell, i) => {
      const box = cell.querySelector<HTMLElement>('.glr-icon-box');
      if (!box) return;
      const px = `${Math.round(sizes[i])}px`;
      box.style.width = px;
      box.style.height = px;
    });
  }
}
