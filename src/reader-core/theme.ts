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

  // Foreground text.
  const fgEl = doc.querySelector('.post-content') ?? body;
  const fg = fgEl ? gcs(fgEl).color : '';

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

  return { bg, fg, link, border };
}

/**
 * Apply a {@link ThemeVars} to a reader root as CSS custom properties. Sets the
 * four sampled colours plus three derived translucent variants:
 *   `--glr-muted`   fg @ 0.65 (secondary text)
 *   `--glr-sep`     border (or fg) @ 0.14 (separators / hairlines)
 *   `--glr-chip-bg` link @ 0.16 (name-chip + first-appearance accent wash)
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

  if (vars.fg && !isTransparent(vars.fg)) {
    set('--glr-muted', withAlpha(vars.fg, 0.65));
  }
  const sepBase = !isTransparent(vars.border) ? vars.border : vars.fg;
  if (sepBase && !isTransparent(sepBase)) {
    set('--glr-sep', withAlpha(sepBase, 0.14));
  }
  if (vars.link && !isTransparent(vars.link)) {
    set('--glr-chip-bg', withAlpha(vars.link, 0.16));
  }
}
