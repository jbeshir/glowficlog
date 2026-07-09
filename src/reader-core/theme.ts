// Theme inheritance for the reader. Glowfic applies its many themes as
// stylesheets (there is no body class to read), so the only reliable signal is
// the *computed* colours of the live page. This module is framework-free and
// shared verbatim by the content script and the dev harness: the content script
// samples the real document, the harness samples a preset palette via the same
// `applyTheme`, so screenshots and production take identical code paths.

/**
 * The four colours the reader needs from its host. Everything the reader paints
 * (background, text, links/accents, separators, chips, first-appearance accents)
 * is derived from these in {@link applyTheme}. Any field may be the empty string
 * when the source could not be sampled — {@link applyTheme} then leaves the
 * corresponding custom property unset so `reader.css`'s built-in fallback shows.
 */
export interface ThemeVars {
  /** Page background. */
  readonly bg: string;
  /** Body / post text colour. */
  readonly fg: string;
  /** Link / accent colour. */
  readonly link: string;
  /** Border / separator base colour. */
  readonly border: string;
  /** Body text font-family (host `.post-content`), or '' / absent when unsampled. */
  readonly fontFamily?: string;
  /** Body text font-size, e.g. "16px", or '' / absent when unsampled. */
  readonly fontSize?: string;
  /** Body text line-height (computed px or unitless), or '' / absent when unsampled. */
  readonly lineHeight?: string;
}

/** Parse `rgb()`, `rgba()`, `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` into RGBA. */
function parseColor(input: string): [number, number, number, number] | null {
  const c = input.trim();
  if (!c) return null;

  const fn = c.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    // Components may be comma- or space-separated, alpha after a comma or slash.
    const parts = fn[1].split(/[\s,/]+/).filter((s) => s.length > 0);
    if (parts.length >= 3) {
      const r = Number.parseFloat(parts[0]);
      const g = Number.parseFloat(parts[1]);
      const b = Number.parseFloat(parts[2]);
      const a = parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;
      if ([r, g, b, a].every((n) => Number.isFinite(n))) return [r, g, b, a];
    }
    return null;
  }

  const hex = c.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) {
      h = h
        .split('')
        .map((ch) => ch + ch)
        .join('');
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return [r, g, b, a];
    }
  }
  return null;
}

/** True when a colour is missing, the keyword `transparent`, or zero-alpha. */
export function isTransparent(input: string | null | undefined): boolean {
  if (!input) return true;
  const c = input.trim().toLowerCase();
  if (c === '' || c === 'transparent') return true;
  const rgba = parseColor(c);
  return rgba !== null && rgba[3] === 0;
}

/**
 * Return `color` re-expressed at the given alpha. If the colour cannot be
 * parsed it is returned unchanged, so a derived var still resolves to something
 * sensible rather than nothing.
 */
export function withAlpha(color: string, alpha: number): string {
  const rgba = parseColor(color);
  if (!rgba) return color;
  const [r, g, b] = rgba;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** getComputedStyle bound to the document's own window (works under jsdom). */
function computedStyleFor(doc: Document): ((el: Element) => CSSStyleDeclaration) | null {
  const win = doc.defaultView ?? (globalThis as { getComputedStyle?: typeof getComputedStyle });
  const gcs = win.getComputedStyle?.bind(win);
  return gcs ? (el: Element) => gcs(el) : null;
}

/**
 * Sample the host page's effective colours into a {@link ThemeVars}.
 *
 * - **bg**: `body` background, walking up to `documentElement` if the body's is
 *   transparent / zero-alpha (glowfic paints the page on either).
 * - **fg**: text colour of `.post-content` if present, else `body`.
 * - **link**: colour of an `<a>` inside a post, else any `<a>`, else `body`.
 * - **border**: border colour of `.post-container` / `.post-footer`, else a
 *   translucent derivation of fg.
 * - **fontFamily / fontSize / lineHeight**: the body text typography of
 *   `.post-content` (fallback `body`), so the reader's body text matches the
 *   host's exactly.
 *
 * Never throws; unreadable fields come back as `''`.
 */
export function readThemeFromDocument(doc: Document): ThemeVars {
  const gcs = computedStyleFor(doc);
  const body = doc.body;
  const root = doc.documentElement;
  if (!gcs) {
    return { bg: '', fg: '', link: '', border: '' };
  }

  // Background: prefer body, fall back to the root element when body is bare.
  let bg = '';
  if (body) {
    const c = gcs(body).backgroundColor;
    if (!isTransparent(c)) bg = c;
  }
  if (!bg && root) {
    const c = gcs(root).backgroundColor;
    if (!isTransparent(c)) bg = c;
  }

  // Foreground text + body typography, sampled from the same element so the
  // reader's body text matches the host post text exactly.
  const fgEl = doc.querySelector('.post-content') ?? body;
  const fg = fgEl ? gcs(fgEl).color : '';
  let fontFamily = '';
  let fontSize = '';
  let lineHeight = '';
  if (fgEl) {
    const ts = gcs(fgEl);
    fontFamily = ts.fontFamily || '';
    fontSize = ts.fontSize || '';
    // Computed line-height is often `normal` when unset; treat that as unsampled
    // so the reader's own readable fallback applies rather than the host default.
    const lh = ts.lineHeight || '';
    lineHeight = lh && lh.toLowerCase() !== 'normal' ? lh : '';
  }

  // Link / accent.
  const linkEl =
    doc.querySelector('.post-content a') ??
    doc.querySelector('.post-container a') ??
    doc.querySelector('a') ??
    body;
  const link = linkEl ? gcs(linkEl).color : '';

  // Border / separator base.
  let border = '';
  const borderEl = doc.querySelector('.post-container') ?? doc.querySelector('.post-footer');
  if (borderEl) {
    const bs = gcs(borderEl);
    const candidate = bs.borderTopColor || bs.borderColor || '';
    if (!isTransparent(candidate)) border = candidate;
  }
  if (!border && fg && !isTransparent(fg)) border = withAlpha(fg, 0.2);

  return { bg, fg, link, border, fontFamily, fontSize, lineHeight };
}

/**
 * Apply a {@link ThemeVars} to a reader root as CSS custom properties. Sets the
 * four sampled colours plus derived translucent variants:
 *   `--glr-muted`     fg @ 0.65 (secondary text)
 *   `--glr-sep`       border (or fg) @ 0.14 (separators / hairlines)
 *   `--glr-chip-bg`   link @ 0.16 (name-chip + first-appearance accent wash)
 *   `--glr-stripe-a`  fg @ 0.045 (subtle L-block tint, even posts)
 *   `--glr-stripe-b`  fg @ 0.09  (subtle L-block tint, odd posts)
 *
 * It also sets the host body typography (`--glr-font-family`, `--glr-font-size`,
 * `--glr-line-height`) when sampled, so the reader's body text matches the host.
 *
 * The two stripes are low-alpha overlays of the host FOREGROUND, so they lift
 * off the host background on both light and dark themes (a dark page's fg is
 * light, lightening the stripe; a light page's fg darkens it).
 *
 * Empty inputs are skipped so `reader.css`'s defaults remain in effect.
 */
export function applyTheme(rootEl: HTMLElement, vars: ThemeVars): void {
  const set = (name: string, value: string): void => {
    if (value && value.trim().length > 0) rootEl.style.setProperty(name, value);
  };

  set('--glr-bg', vars.bg);
  set('--glr-fg', vars.fg);
  set('--glr-link', vars.link);
  set('--glr-border', vars.border);

  // Body typography sampled from the host post text (skipped when unsampled, so
  // reader.css's Helvetica,Verdana,sans-serif / 16px / 1.25 fallback shows).
  set('--glr-font-family', vars.fontFamily ?? '');
  set('--glr-font-size', vars.fontSize ?? '');
  set('--glr-line-height', vars.lineHeight ?? '');

  if (vars.fg && !isTransparent(vars.fg)) {
    set('--glr-muted', withAlpha(vars.fg, 0.65));
    set('--glr-stripe-a', withAlpha(vars.fg, 0.045));
    set('--glr-stripe-b', withAlpha(vars.fg, 0.09));
  }
  const sepBase = !isTransparent(vars.border) ? vars.border : vars.fg;
  if (sepBase && !isTransparent(sepBase)) {
    set('--glr-sep', withAlpha(sepBase, 0.14));
  }
  if (vars.link && !isTransparent(vars.link)) {
    set('--glr-chip-bg', withAlpha(vars.link, 0.16));
  }
}

/**
 * Derive the reader's light/dark mode from a sampled {@link ThemeVars} — i.e. from
 * the glowfic page's OWN theme, never the OS. The reader mirrors whatever glowfic
 * is showing, so the only correct signal is the sampled host background: a dark
 * page yields `'dark'`, a light page `'light'`. Falls back to `'light'` when the
 * background could not be sampled or parsed, matching reader.css's light defaults.
 */
export function themeMode(vars: ThemeVars): 'light' | 'dark' {
  const rgba = parseColor(vars.bg);
  if (!rgba) return 'light';
  const [r, g, b] = rgba;
  // sRGB perceived luminance on a 0-255 scale; below the midpoint is a dark surface.
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 128 ? 'dark' : 'light';
}
