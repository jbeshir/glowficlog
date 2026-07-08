// Offline dev harness. Imports the SAME reader-core the extension uses and
// renders saved fixtures with no network and no extension host. Fixtures are
// embedded at build time via the `__FIXTURES__` define (see scripts/build.mjs),
// so the built page runs by simply opening dist/dev/index.html.
//
// Driven by URL query params for deterministic screenshots:
//   ?fixture=dialogue-2author&theme=dark[&raw=1]

import {
  parsePosts,
  renderReader,
  applyTheme,
  layoutIcons,
  markSingleLineBodies,
  enableIconPreviews,
  applyMoieties,
  watchResize,
} from '../reader-core/index.js';
import type { FixtureMeta, ThemeVars } from '../reader-core/index.js';

// Offline stand-in for the live /api/v1/users moiety lookup (no network in the harness).
function stubMoiety(author: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < author.length; i++) {
    hash ^= author.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  const hue = hash % 360;
  const s = 0.65;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60)       { r = c; g = x; b = 0; }
  else if (hue < 120) { r = x; g = c; b = 0; }
  else if (hue < 180) { r = 0; g = c; b = x; }
  else if (hue < 240) { r = 0; g = x; b = c; }
  else if (hue < 300) { r = x; g = 0; b = c; }
  else                { r = c; g = 0; b = x; }
  const toHex = (n: number): string => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/** Host body typography fallback (matches reader.css / the real glowfic default
 *  post text), applied through the SAME applyTheme so the offline preview matches
 *  the live site. */
const FONT_FALLBACK = {
  fontFamily: 'Helvetica, Verdana, sans-serif',
  fontSize: '16px',
  lineHeight: '1.25',
} as const;

interface EmbeddedFixture {
  meta: FixtureMeta;
  html: string;
}

// Injected by esbuild at build time.
declare const __FIXTURES__: Record<string, EmbeddedFixture>;

const fixtures: Record<string, EmbeddedFixture> =
  typeof __FIXTURES__ !== 'undefined' ? __FIXTURES__ : {};

const names = Object.keys(fixtures).sort();

/**
 * Preset host palettes approximating real glowfic themes. The reader is fed
 * these via the SAME applyTheme() the content script calls on the live page, so
 * the harness exercises the production colour path. `?theme=` selects one.
 */
interface Palette {
  /** Flags the reader root `data-theme` (fallback colours only; applyTheme wins). */
  readonly dark: boolean;
  /** Host colours; also painted onto the harness page so screenshots blend in. */
  readonly vars: ThemeVars;
}

const PALETTES: Record<string, Palette> = {
  light: {
    dark: false,
    vars: { bg: '#ffffff', fg: '#1b1b1f', link: '#2563eb', border: '#e3e6eb', ...FONT_FALLBACK },
  },
  dark: {
    dark: true,
    vars: { bg: '#16171b', fg: '#e6e7ea', link: '#7aa2ff', border: '#2a2c33', ...FONT_FALLBACK },
  },
  sepia: {
    dark: false,
    vars: { bg: '#f4ecd8', fg: '#5b4636', link: '#9a3b2f', border: '#ddcdb0', ...FONT_FALLBACK },
  },
};

type Theme = keyof typeof PALETTES;

const themeNames = Object.keys(PALETTES) as Theme[];

interface ViewState {
  fixture: string;
  theme: Theme;
  raw: boolean;
  trim: boolean;
  condensed: boolean;
  moieties: boolean;
}

function boolParam(params: URLSearchParams, name: string): boolean {
  return params.get(name) === '1' || params.get(name) === 'true';
}

function readState(): ViewState {
  const params = new URLSearchParams(globalThis.location.search);
  const fixtureParam = params.get('fixture');
  const fixture =
    fixtureParam && fixtures[fixtureParam] ? fixtureParam : (names[0] ?? '');
  const themeParam = params.get('theme');
  const theme: Theme =
    themeParam && themeParam in PALETTES ? (themeParam as Theme) : 'light';
  return {
    fixture,
    theme,
    raw: boolParam(params, 'raw'),
    trim: boolParam(params, 'trim'),
    condensed: boolParam(params, 'condensed'),
    moieties: params.get('moieties') !== '0' && params.get('moieties') !== 'false',
  };
}

function writeState(state: ViewState): void {
  const params = new URLSearchParams();
  params.set('fixture', state.fixture);
  params.set('theme', state.theme);
  if (state.raw) params.set('raw', '1');
  if (state.trim) params.set('trim', '1');
  if (state.condensed) params.set('condensed', '1');
  if (!state.moieties) params.set('moieties', '0');
  const url = `${globalThis.location.pathname}?${params.toString()}`;
  globalThis.history.replaceState(null, '', url);
}

/** Parse a fixture's HTML string into a detached DOM fragment we can read. */
function fixtureFragment(html: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}

function buildControls(state: ViewState, onChange: (next: ViewState) => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'harness-bar';

  const title = document.createElement('strong');
  title.textContent = 'glowficlog harness';
  title.className = 'harness-title';
  bar.appendChild(title);

  // Fixture selector.
  const sel = document.createElement('select');
  sel.id = 'harness-fixture';
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    const m = fixtures[name].meta;
    opt.textContent = `${name} (${m.postCount} posts, ${m.view})`;
    if (name === state.fixture) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange({ ...state, fixture: sel.value }));
  bar.appendChild(labelled('Fixture', sel));

  // Theme toggle.
  const themeSel = document.createElement('select');
  for (const t of themeNames) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (t === state.theme) opt.selected = true;
    themeSel.appendChild(opt);
  }
  themeSel.addEventListener('change', () =>
    onChange({ ...state, theme: themeSel.value as Theme }),
  );
  bar.appendChild(labelled('Theme', themeSel));

  // Raw side-by-side toggle.
  bar.appendChild(
    checkbox('show raw original', state.raw, (v) => onChange({ ...state, raw: v })),
  );
  // Option toggles mirroring the extension's options page.
  bar.appendChild(
    checkbox('trim blank edges', state.trim, (v) => onChange({ ...state, trim: v })),
  );
  bar.appendChild(
    checkbox('condensed', state.condensed, (v) => onChange({ ...state, condensed: v })),
  );
  bar.appendChild(
    checkbox('moiety rings', state.moieties, (v) => onChange({ ...state, moieties: v })),
  );

  return bar;
}

/** A labelled checkbox control for the harness toolbar. */
function checkbox(label: string, checked: boolean, onToggle: (value: boolean) => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'harness-check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onToggle(box.checked));
  wrap.appendChild(box);
  wrap.appendChild(document.createTextNode(` ${label}`));
  return wrap;
}

function labelled(text: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'harness-field';
  const span = document.createElement('span');
  span.textContent = text;
  wrap.appendChild(span);
  wrap.appendChild(control);
  return wrap;
}

/** The reader currently on screen, so the resize handler can re-flow its icons. */
let currentReader: HTMLElement | null = null;
/** Cleanup for the on-screen reader's icon previews; torn down on re-render. */
let disablePreviews: (() => void) | null = null;

function render(state: ViewState): void {
  writeState(state);
  const palette = PALETTES[state.theme] ?? PALETTES.light;
  // data-theme drives the harness chrome (and the reader's fallback colours);
  // applyTheme below overrides the reader's actual colours regardless.
  document.body.setAttribute('data-theme', palette.dark ? 'dark' : 'light');
  // Paint the harness page itself in the host palette so the reader visibly
  // blends into the surrounding "site" in screenshots.
  document.body.style.background = palette.vars.bg;
  document.body.style.color = palette.vars.fg;

  // Tear down the previous reader's previews before we rebuild the DOM.
  if (disablePreviews) {
    disablePreviews();
    disablePreviews = null;
  }

  const app = document.getElementById('app');
  if (!app) return;
  app.textContent = '';

  app.appendChild(buildControls(state, render));

  const entry = fixtures[state.fixture];
  if (!entry) {
    const empty = document.createElement('p');
    empty.className = 'harness-empty';
    empty.textContent = names.length
      ? 'Unknown fixture.'
      : 'No fixtures were embedded at build time.';
    app.appendChild(empty);
    return;
  }

  const meta = document.createElement('p');
  meta.className = 'harness-meta';
  meta.textContent = entry.meta.notes;
  app.appendChild(meta);

  const stage = document.createElement('div');
  stage.className = state.raw ? 'harness-stage harness-stage--split' : 'harness-stage';

  const fragment = fixtureFragment(entry.html);
  const posts = parsePosts(fragment);
  const reader = renderReader(posts, {
    document,
    theme: palette.dark ? 'dark' : 'light',
    trimBlankEdges: state.trim,
  });
  // The super-condensed density mode is a single class on the reader root.
  reader.classList.toggle('glr-condensed', state.condensed);
  // Same colour path as the content script: blend the reader into the host.
  applyTheme(reader, palette.vars);
  currentReader = reader;

  const readerPane = document.createElement('div');
  readerPane.className = 'harness-pane';
  readerPane.appendChild(paneHeading(`Reader — ${posts.length} posts`));
  readerPane.appendChild(reader);
  stage.appendChild(readerPane);

  if (state.raw) {
    const rawPane = document.createElement('div');
    rawPane.className = 'harness-pane harness-pane--raw';
    rawPane.appendChild(paneHeading('Raw original'));
    const rawHost = document.createElement('div');
    rawHost.className = 'harness-raw';
    rawHost.appendChild(fixtureFragment(entry.html));
    rawPane.appendChild(rawHost);
    stage.appendChild(rawPane);
  }

  app.appendChild(stage);

  // Icons can only be flow-sized once the reader is laid out in the document.
  layoutIcons(reader);
  // Same single-line body alignment pass the content script runs after insert.
  markSingleLineBodies(reader);
  // Apply per-author moiety colour rings via the deterministic offline stub (no network).
  if (state.moieties) {
    const seen = new Set<string>();
    const moietyMap: Record<string, string> = {};
    for (const p of posts) {
      if (p.author && p.author !== '(deleted user)' && !seen.has(p.author)) {
        seen.add(p.author);
        moietyMap[p.author] = stubMoiety(p.author);
      }
    }
    applyMoieties(reader, moietyMap);
  } else {
    applyMoieties(reader, {});
  }
  // Smooth floating icon previews, same code path as the extension.
  disablePreviews = enableIconPreviews(reader);
}

// Re-flow icons on resize (debounced) — post heights, and thus how far an icon
// can grow before meeting the next same-side icon, change with viewport width.
watchResize(() => currentReader);

function paneHeading(text: string): HTMLElement {
  const h = document.createElement('h2');
  h.className = 'harness-pane-heading';
  h.textContent = text;
  return h;
}

render(readState());
