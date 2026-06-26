// Tests for the content-script controls module and the open-options helper.
// Uses node:test + jsdom, mirroring moiety-content.test.ts / options.test.ts style.
//
// NOTE: jsdom has no layout engine, so min-width/min-height:44px on .glr-spanner
// and .glr-toggle are enforced by CSS (not measurable here). We assert the
// accessible attributes and class names that the CSS rules key off instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createControls } from '../src/content/controls.js';

// ---- openOptionsPage setup ------------------------------------------------
// open-options.js binds `ext` (browser ?? chrome) at module-evaluation time, so
// we install the extension-API fakes on globalThis BEFORE importing the module.
// Both browser and chrome are installed with distinct getURL implementations to
// let the preference test observe which one wins.

const savedChrome = (globalThis as unknown as { chrome?: unknown }).chrome;
const savedBrowser = (globalThis as unknown as { browser?: unknown }).browser;
const savedOpen = globalThis.open;

interface FakeRuntime { getURL?: (path: string) => string }
const fakeBrowserRuntime: FakeRuntime = {
  getURL: (p: string) => 'moz-extension://testid/' + p,
};
const fakeChromeRuntime: FakeRuntime = {
  getURL: (p: string) => 'chrome-extension://abc/' + p,
};
(globalThis as unknown as { browser: unknown }).browser = { runtime: fakeBrowserRuntime };
(globalThis as unknown as { chrome: unknown }).chrome = { runtime: fakeChromeRuntime };

// Import AFTER fakes are installed — ext binds to fakeBrowser (browser preferred).
const { openOptionsPage } = await import('../src/content/open-options.js');

// Restore globals (ext holds a direct reference to the object, so the fakes
// remain reachable for mutation inside tests even after we restore the slots).
(globalThis as unknown as { chrome?: unknown }).chrome = savedChrome;
(globalThis as unknown as { browser?: unknown }).browser = savedBrowser;

// ---------------------------------------------------------------------------

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const doc = dom.window.document;

// ---- createControls DOM structure -----------------------------------------

test('createControls: builds .glr-controls containing spanner and toggle', () => {
  const { container, toggle, spanner } = createControls(doc, {
    onToggle: () => {},
    onOpenOptions: () => {},
  });
  assert.equal(container.className, 'glr-controls');
  assert.ok(container.contains(spanner), 'spanner inside container');
  assert.ok(container.contains(toggle), 'toggle inside container');
});

test('createControls: spanner is the first child (sits left of toggle)', () => {
  const { container, toggle, spanner } = createControls(doc, {
    onToggle: () => {},
    onOpenOptions: () => {},
  });
  assert.equal(container.children[0], spanner, 'spanner is first child');
  assert.equal(container.children[1], toggle, 'toggle is second child');
});

test('createControls: spanner has correct accessible attributes and glyph', () => {
  const { spanner } = createControls(doc, {
    onToggle: () => {},
    onOpenOptions: () => {},
  });
  assert.equal(spanner.type, 'button');
  assert.equal(spanner.getAttribute('aria-label'), 'glowficlog options');
  assert.ok(spanner.title.length > 0, 'title is non-empty');
  assert.ok(spanner.textContent?.includes('🔧'), 'wrench glyph present');
  assert.equal(spanner.className, 'glr-spanner');
});

// ---- reflect() visibility lockstep ----------------------------------------

test('reflect(false): spanner is hidden and toggle reads off', () => {
  const { toggle, spanner, reflect } = createControls(doc, {
    onToggle: () => {},
    onOpenOptions: () => {},
  });
  reflect(false);
  assert.equal(spanner.hidden, true, 'spanner.hidden after reflect(false)');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.ok(toggle.textContent?.includes('off'));
});

test('reflect(true): spanner is visible and toggle reads on', () => {
  const { toggle, spanner, reflect } = createControls(doc, {
    onToggle: () => {},
    onOpenOptions: () => {},
  });
  reflect(true);
  assert.equal(spanner.hidden, false, 'spanner.hidden=false after reflect(true)');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.ok(toggle.textContent?.includes('📖 Glowlog: on'));
  assert.ok(toggle.getAttribute('aria-label')?.includes('on'));
});

// ---- click handlers --------------------------------------------------------

test('clicking spanner calls onOpenOptions exactly once', () => {
  let count = 0;
  const { spanner } = createControls(doc, {
    onToggle: () => {},
    onOpenOptions: () => { count++; },
  });
  spanner.click();
  assert.equal(count, 1);
});

test('clicking toggle calls onToggle exactly once', () => {
  let count = 0;
  const { toggle } = createControls(doc, {
    onToggle: () => { count++; },
    onOpenOptions: () => {},
  });
  toggle.click();
  assert.equal(count, 1);
});

// ---- openOptionsPage -------------------------------------------------------
// The module-level `ext` bound to fakeBrowserRuntime (browser preferred over
// chrome). Tests mutate the runtime object and stub globalThis.open per-test,
// restoring both afterwards.

test('openOptionsPage: browser-preferred path — opens options.html URL via globalThis.open', () => {
  // ext = fakeBrowserRuntime (browser ?? chrome resolved to browser at import time)
  fakeBrowserRuntime.getURL = (p: string) => 'chrome-extension://abc/' + p;
  const captured: string[][] = [];
  (globalThis as unknown as { open: unknown }).open = (url: string, target: string, features: string) => {
    captured.push([url, target, features]);
  };
  openOptionsPage();
  (globalThis as unknown as { open: unknown }).open = savedOpen;
  assert.equal(captured.length, 1, 'open called once');
  assert.equal(captured[0][0], 'chrome-extension://abc/options.html');
  assert.equal(captured[0][1], '_blank');
  assert.ok(captured[0][2].includes('noopener'));
});

test('openOptionsPage: browser-preferred over chrome — browser getURL used, not chrome getURL', () => {
  // Both browser and chrome are referenced in the module, but browser wins.
  // fakeBrowserRuntime.getURL returns a different URL than fakeChromeRuntime.getURL.
  fakeBrowserRuntime.getURL = (p: string) => 'moz-extension://testid/' + p;
  // fakeChromeRuntime.getURL returns 'chrome-extension://abc/...' — must NOT appear.
  let openedUrl = '';
  (globalThis as unknown as { open: unknown }).open = (url: string) => { openedUrl = url; };
  openOptionsPage();
  (globalThis as unknown as { open: unknown }).open = savedOpen;
  assert.ok(openedUrl.startsWith('moz-extension://'), 'browser URL used');
  assert.ok(!openedUrl.startsWith('chrome-extension://'), 'chrome URL NOT used');
});

test('openOptionsPage: getURL-missing path — warns and does not call open', () => {
  const origGetURL = fakeBrowserRuntime.getURL;
  delete fakeBrowserRuntime.getURL; // simulate missing getURL
  let openCalled = false;
  (globalThis as unknown as { open: unknown }).open = () => { openCalled = true; };
  let warned = false;
  const origWarn = console.warn;
  console.warn = (..._args: unknown[]) => { warned = true; };
  openOptionsPage(); // must not throw
  (globalThis as unknown as { open: unknown }).open = savedOpen;
  console.warn = origWarn;
  fakeBrowserRuntime.getURL = origGetURL; // restore
  assert.equal(openCalled, false, 'open must not be called when getURL is unavailable');
  assert.equal(warned, true, 'console.warn must be called');
});
