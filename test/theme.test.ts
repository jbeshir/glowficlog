// Tests for theme inheritance: readThemeFromDocument samples host computed
// colours; applyTheme writes the custom properties (incl. derived translucent
// variants) onto the reader root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  readThemeFromDocument,
  applyTheme,
  withAlpha,
  isTransparent,
} from '../src/reader-core/index.js';
import type { ThemeVars } from '../src/reader-core/index.js';

// ---------------------------------------------------------------------------
// withAlpha / isTransparent helpers
// ---------------------------------------------------------------------------

test('withAlpha re-expresses rgb/hex at a given alpha', () => {
  assert.equal(withAlpha('rgb(16, 32, 48)', 0.5), 'rgba(16, 32, 48, 0.5)');
  assert.equal(withAlpha('#102030', 0.65), 'rgba(16, 32, 48, 0.65)');
  assert.equal(withAlpha('#fff', 0.2), 'rgba(255, 255, 255, 0.2)');
});

test('withAlpha returns unparseable colours unchanged', () => {
  assert.equal(withAlpha('rebeccapurple', 0.5), 'rebeccapurple');
});

test('isTransparent recognises empty / transparent / zero-alpha', () => {
  assert.equal(isTransparent(''), true);
  assert.equal(isTransparent(null), true);
  assert.equal(isTransparent('transparent'), true);
  assert.equal(isTransparent('rgba(0, 0, 0, 0)'), true);
  assert.equal(isTransparent('rgb(0, 0, 0)'), false);
  assert.equal(isTransparent('#000'), false);
});

// ---------------------------------------------------------------------------
// readThemeFromDocument — jsdom computes inline styles
// ---------------------------------------------------------------------------

test('readThemeFromDocument samples bg/fg/link/border from a post page', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div class="post-container">
      <div class="post-content"><a href="/x">link</a>text</div>
    </div>
  </body></html>`);
  const doc = dom.window.document;
  doc.body.style.backgroundColor = 'rgb(20, 22, 27)';
  (doc.querySelector('.post-content') as HTMLElement).style.color = 'rgb(230, 231, 234)';
  (doc.querySelector('.post-content a') as HTMLElement).style.color = 'rgb(122, 162, 255)';
  (doc.querySelector('.post-container') as HTMLElement).style.borderTopColor = 'rgb(42, 44, 51)';

  const vars = readThemeFromDocument(doc);
  assert.equal(vars.bg, 'rgb(20, 22, 27)', 'bg from body');
  assert.equal(vars.fg, 'rgb(230, 231, 234)', 'fg from .post-content');
  assert.equal(vars.link, 'rgb(122, 162, 255)', 'link from post anchor');
  assert.equal(vars.border, 'rgb(42, 44, 51)', 'border from .post-container');
});

test('readThemeFromDocument walks to documentElement when body bg is transparent', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div class="post-content">text</div>
  </body></html>`);
  const doc = dom.window.document;
  // body background left unset (transparent); root carries the page colour.
  doc.documentElement.style.backgroundColor = 'rgb(244, 236, 216)';
  (doc.querySelector('.post-content') as HTMLElement).style.color = 'rgb(91, 70, 54)';

  const vars = readThemeFromDocument(doc);
  assert.equal(vars.bg, 'rgb(244, 236, 216)', 'falls back to documentElement bg');
  assert.equal(vars.fg, 'rgb(91, 70, 54)');
});

test('readThemeFromDocument derives a border from fg when none is present', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>text</body></html>`);
  const doc = dom.window.document;
  doc.body.style.backgroundColor = 'rgb(255, 255, 255)';
  doc.body.style.color = 'rgb(27, 27, 31)';

  const vars = readThemeFromDocument(doc);
  assert.equal(vars.fg, 'rgb(27, 27, 31)', 'fg from body when no .post-content');
  assert.equal(vars.border, 'rgba(27, 27, 31, 0.2)', 'border derived from fg');
});

test('readThemeFromDocument never throws on a bare document', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
  assert.doesNotThrow(() => readThemeFromDocument(dom.window.document));
});

// ---------------------------------------------------------------------------
// Host body typography sampling
// ---------------------------------------------------------------------------

test('readThemeFromDocument samples font-family/size/line-height from .post-content', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div class="post-container"><div class="post-content">text</div></div>
  </body></html>`);
  const doc = dom.window.document;
  const pc = doc.querySelector('.post-content') as HTMLElement;
  pc.style.fontFamily = 'Helvetica, Verdana, sans-serif';
  pc.style.fontSize = '16px';
  pc.style.lineHeight = '1.25';

  const vars = readThemeFromDocument(doc);
  assert.match(vars.fontFamily ?? '', /Helvetica/, 'font-family sampled');
  assert.equal(vars.fontSize, '16px', 'font-size sampled');
  assert.equal(vars.lineHeight, '1.25', 'line-height sampled');
});

test('readThemeFromDocument treats a "normal" line-height as unsampled', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div class="post-content">text</div>
  </body></html>`);
  const doc = dom.window.document;
  (doc.querySelector('.post-content') as HTMLElement).style.lineHeight = 'normal';

  const vars = readThemeFromDocument(doc);
  assert.equal(vars.lineHeight, '', 'normal → empty so the reader fallback applies');
});

test('applyTheme writes the host typography vars when present', () => {
  const { root } = freshRoot();
  applyTheme(root, {
    bg: '#fff',
    fg: 'rgb(27, 27, 31)',
    link: '#2563eb',
    border: '#ccc',
    fontFamily: 'Helvetica, Verdana, sans-serif',
    fontSize: '16px',
    lineHeight: '1.25',
  });
  assert.equal(root.style.getPropertyValue('--glr-font-family'), 'Helvetica, Verdana, sans-serif');
  assert.equal(root.style.getPropertyValue('--glr-font-size'), '16px');
  assert.equal(root.style.getPropertyValue('--glr-line-height'), '1.25');
});

test('applyTheme leaves typography vars unset when unsampled (CSS fallback survives)', () => {
  const { root } = freshRoot();
  applyTheme(root, { bg: '#fff', fg: 'rgb(27, 27, 31)', link: '#2563eb', border: '#ccc' });
  assert.equal(root.style.getPropertyValue('--glr-font-family'), '', 'no font-family var written');
  assert.equal(root.style.getPropertyValue('--glr-font-size'), '', 'no font-size var written');
  assert.equal(root.style.getPropertyValue('--glr-line-height'), '', 'no line-height var written');
});

// ---------------------------------------------------------------------------
// applyTheme — sets the vars + derived translucent variants
// ---------------------------------------------------------------------------

function freshRoot(): { root: HTMLElement; win: JSDOM } {
  const win = new JSDOM('<!DOCTYPE html><html><body><div class="glr-reader"></div></body></html>');
  const root = win.window.document.querySelector('.glr-reader') as HTMLElement;
  return { root, win };
}

test('applyTheme sets the four base vars and three derived ones', () => {
  const { root } = freshRoot();
  const vars: ThemeVars = {
    bg: 'rgb(255, 255, 255)',
    fg: 'rgb(27, 27, 31)',
    link: 'rgb(37, 99, 235)',
    border: 'rgb(229, 231, 235)',
  };
  applyTheme(root, vars);

  assert.equal(root.style.getPropertyValue('--glr-bg'), 'rgb(255, 255, 255)');
  assert.equal(root.style.getPropertyValue('--glr-fg'), 'rgb(27, 27, 31)');
  assert.equal(root.style.getPropertyValue('--glr-link'), 'rgb(37, 99, 235)');
  assert.equal(root.style.getPropertyValue('--glr-border'), 'rgb(229, 231, 235)');
  // Derived translucent variants.
  assert.equal(root.style.getPropertyValue('--glr-muted'), 'rgba(27, 27, 31, 0.65)');
  assert.equal(root.style.getPropertyValue('--glr-sep'), 'rgba(229, 231, 235, 0.14)');
  assert.equal(root.style.getPropertyValue('--glr-chip-bg'), 'rgba(37, 99, 235, 0.16)');
  // Stripe tints derive from the foreground at two low alphas.
  assert.equal(root.style.getPropertyValue('--glr-stripe-a'), 'rgba(27, 27, 31, 0.045)');
  assert.equal(root.style.getPropertyValue('--glr-stripe-b'), 'rgba(27, 27, 31, 0.09)');
});

test('applyTheme derives both stripe tints from the host foreground', () => {
  const { root } = freshRoot();
  // A dark host: light fg → the stripes lighten the dark page (both readable).
  applyTheme(root, { bg: 'rgb(18, 18, 22)', fg: 'rgb(235, 235, 240)', link: '#7aa2ff', border: '' });
  assert.equal(root.style.getPropertyValue('--glr-stripe-a'), 'rgba(235, 235, 240, 0.045)');
  assert.equal(root.style.getPropertyValue('--glr-stripe-b'), 'rgba(235, 235, 240, 0.09)');
});

test('applyTheme leaves stripe tints unset when fg is missing', () => {
  const { root } = freshRoot();
  applyTheme(root, { bg: '#fff', fg: '', link: '#2563eb', border: '#ccc' });
  assert.equal(root.style.getPropertyValue('--glr-stripe-a'), '', 'no stripe without fg');
  assert.equal(root.style.getPropertyValue('--glr-stripe-b'), '');
});

test('applyTheme leaves vars unset for empty inputs (CSS fallback survives)', () => {
  const { root } = freshRoot();
  applyTheme(root, { bg: '', fg: '', link: '', border: '' });
  assert.equal(root.style.getPropertyValue('--glr-bg'), '', 'no bg var written');
  assert.equal(root.style.getPropertyValue('--glr-muted'), '', 'no derived var written');
});

test('applyTheme derives --glr-sep from fg when border is absent', () => {
  const { root } = freshRoot();
  applyTheme(root, { bg: '#fff', fg: 'rgb(10, 20, 30)', link: '#2563eb', border: '' });
  assert.equal(root.style.getPropertyValue('--glr-sep'), 'rgba(10, 20, 30, 0.14)');
});

test('readThemeFromDocument + applyTheme round-trip blends a dark host', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div class="post-container"><div class="post-content"><a href="/x">l</a></div></div>
  </body></html>`);
  const doc = dom.window.document;
  doc.body.style.backgroundColor = 'rgb(18, 18, 22)';
  (doc.querySelector('.post-content') as HTMLElement).style.color = 'rgb(235, 235, 240)';
  (doc.querySelector('.post-content a') as HTMLElement).style.color = 'rgb(120, 170, 255)';

  const root = doc.createElement('div');
  applyTheme(root, readThemeFromDocument(doc));
  assert.equal(root.style.getPropertyValue('--glr-bg'), 'rgb(18, 18, 22)', 'reader bg matches host');
  assert.ok(root.style.getPropertyValue('--glr-muted').includes('0.65'), 'muted derived');
});
