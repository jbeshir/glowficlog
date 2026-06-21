// Offline dev harness. Imports the SAME reader-core the extension uses and
// renders saved fixtures with no network and no extension host. Fixtures are
// embedded at build time via the `__FIXTURES__` define (see scripts/build.mjs),
// so the built page runs by simply opening dist/dev/index.html.
//
// Driven by URL query params for deterministic screenshots:
//   ?fixture=dialogue-2author&theme=dark[&raw=1]

import { parsePosts, renderReader } from '../reader-core/index.js';
import type { FixtureMeta } from '../reader-core/index.js';

interface EmbeddedFixture {
  meta: FixtureMeta;
  html: string;
}

// Injected by esbuild at build time.
declare const __FIXTURES__: Record<string, EmbeddedFixture>;

const fixtures: Record<string, EmbeddedFixture> =
  typeof __FIXTURES__ !== 'undefined' ? __FIXTURES__ : {};

const names = Object.keys(fixtures).sort();

type Theme = 'light' | 'dark';

interface ViewState {
  fixture: string;
  theme: Theme;
  raw: boolean;
}

function readState(): ViewState {
  const params = new URLSearchParams(globalThis.location.search);
  const fixtureParam = params.get('fixture');
  const fixture =
    fixtureParam && fixtures[fixtureParam] ? fixtureParam : (names[0] ?? '');
  const theme: Theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  const raw = params.get('raw') === '1' || params.get('raw') === 'true';
  return { fixture, theme, raw };
}

function writeState(state: ViewState): void {
  const params = new URLSearchParams();
  params.set('fixture', state.fixture);
  params.set('theme', state.theme);
  if (state.raw) params.set('raw', '1');
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
  for (const t of ['light', 'dark'] as Theme[]) {
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
  const rawWrap = document.createElement('label');
  rawWrap.className = 'harness-check';
  const rawBox = document.createElement('input');
  rawBox.type = 'checkbox';
  rawBox.checked = state.raw;
  rawBox.addEventListener('change', () => onChange({ ...state, raw: rawBox.checked }));
  rawWrap.appendChild(rawBox);
  rawWrap.appendChild(document.createTextNode(' show raw original'));
  bar.appendChild(rawWrap);

  return bar;
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

function render(state: ViewState): void {
  writeState(state);
  document.body.setAttribute('data-theme', state.theme);

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
  const reader = renderReader(posts, { document, theme: state.theme });

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
}

function paneHeading(text: string): HTMLElement {
  const h = document.createElement('h2');
  h.className = 'harness-pane-heading';
  h.textContent = text;
  return h;
}

render(readState());
