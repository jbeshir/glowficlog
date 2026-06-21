// Tests for the commonAncestor helper the content script uses to locate the
// post-list wrapper without assuming an original post exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';

import {
  commonAncestor,
  renderedPostContainers,
  mountReaderInPostList,
  unmountReader,
  parsePosts,
  renderReader,
  HIDDEN_ORIGINAL_CLASS,
} from '../src/reader-core/index.js';

function doc(html: string): Document {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`).window.document;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, 'fixtures');

/** Load a real captured `#content` fragment (page1/page2) into a live document. */
function pageDoc(file: string): Document {
  const html = readFileSync(join(fixturesDir, file), 'utf8');
  return doc(html);
}

/** Mount the full reader (parse → render → place) the way the content script
 *  does, and return the reader element. */
function mountFullReader(d: Document): HTMLElement {
  const reader = renderReader(parsePosts(d), { document: d });
  const placed = mountReaderInPostList(reader, d);
  assert.equal(placed, reader, 'reader mounts on the real page');
  return reader;
}

/** A glowfic thread page shape: a top paginator, the post list, a bottom
 *  paginator — all siblings inside #content. */
function threadDoc(): Document {
  return doc(`
    <div id="content">
      <div class="paginator" id="pg-top">page nav (top)</div>
      <div class="post-container post-post" id="op"><div class="post-content">op</div></div>
      <div class="post-container post-reply" id="r1"><div class="post-content">one</div></div>
      <div class="post-container post-reply" id="r2"><div class="post-content">two</div></div>
      <div class="paginator" id="pg-bottom">page nav (bottom)</div>
    </div>`);
}

test('commonAncestor: sibling containers resolve to their shared wrapper', () => {
  const d = doc(`
    <div class="post-list">
      <div class="post-container post-reply" id="r1"></div>
      <div class="post-container post-reply" id="r2"></div>
      <div class="post-container post-reply" id="r3"></div>
    </div>`);
  const containers = Array.from(d.querySelectorAll<HTMLElement>('.post-container'));
  const lca = commonAncestor(containers);
  assert.ok(lca, 'an ancestor is found');
  assert.ok((lca as HTMLElement).classList.contains('post-list'), 'LCA is the .post-list wrapper');
});

test('commonAncestor: reply-only page (no OP) still resolves the wrapper', () => {
  // Mirrors /posts/{id}?page=2 — only .post-reply containers, no .post-post.
  const d = doc(`
    <div id="content">
      <div class="post-list">
        <div class="post-container post-reply" id="a"></div>
        <div class="post-container post-reply" id="b"></div>
      </div>
    </div>`);
  const containers = Array.from(d.querySelectorAll<HTMLElement>('.post-container'));
  assert.equal(d.querySelector('.post-post'), null, 'no OP present');
  const lca = commonAncestor(containers) as HTMLElement;
  assert.ok(lca.classList.contains('post-list'), 'wrapper found without an OP');
});

test('commonAncestor: nested containers resolve to the outer one', () => {
  const d = doc(`
    <div class="post-container" id="outer">
      <div class="inner"><div class="post-container" id="nested"></div></div>
    </div>`);
  const containers = Array.from(d.querySelectorAll<HTMLElement>('.post-container'));
  const lca = commonAncestor(containers);
  assert.equal((lca as HTMLElement).id, 'outer', 'LCA is the enclosing container');
});

test('commonAncestor: a single element is its own (inclusive) LCA', () => {
  const d = doc('<div class="post-list"><div class="post-container" id="solo"></div></div>');
  const only = d.querySelector<HTMLElement>('.post-container');
  assert.ok(only);
  assert.equal((commonAncestor([only!]) as HTMLElement).id, 'solo', 'single → itself');
});

test('commonAncestor: empty input returns null', () => {
  assert.equal(commonAncestor([]), null);
});

test('commonAncestor: elements in separate trees share no ancestor', () => {
  const a = doc('<div class="post-container"></div>').querySelector<HTMLElement>('.post-container');
  const b = doc('<div class="post-container"></div>').querySelector<HTMLElement>('.post-container');
  assert.ok(a && b);
  assert.equal(commonAncestor([a!, b!]), null, 'disjoint trees → null');
});

// ---------------------------------------------------------------------------
// Fix 1 — mountReaderInPostList / unmountReader: the reader is inserted BETWEEN
// the top and bottom paginators (immediately before the first .post-container),
// only .post-containers are hidden, paginators stay, and toggle-off restores.
// ---------------------------------------------------------------------------

test('mountReaderInPostList: anchors before the first post, between the paginators', () => {
  const d = threadDoc();
  const reader = d.createElement('div');
  reader.className = 'glr-reader';

  const result = mountReaderInPostList(reader, d);
  assert.equal(result, reader, 'returns the inserted reader');

  // Inserted immediately BEFORE the first .post-container…
  const firstPost = d.querySelector('.post-container');
  assert.equal(reader.nextElementSibling, firstPost, 'reader sits right before the first post');
  // …which places it AFTER the top paginator (i.e. between the two nav bars).
  assert.equal(reader.previousElementSibling?.id, 'pg-top', 'reader is below the top paginator');
  assert.equal(reader.parentElement?.id, 'content', 'reader is in the post list wrapper');

  // The bottom paginator still trails the post list.
  const content = d.getElementById('content')!;
  assert.equal(content.lastElementChild?.id, 'pg-bottom', 'bottom paginator stays last');
});

test('mountReaderInPostList: hides only .post-containers, never the paginators', () => {
  const d = threadDoc();
  const reader = d.createElement('div');
  mountReaderInPostList(reader, d);

  for (const c of Array.from(d.querySelectorAll('.post-container'))) {
    assert.ok(c.classList.contains(HIDDEN_ORIGINAL_CLASS), 'each post container is hidden');
  }
  for (const pg of Array.from(d.querySelectorAll('.paginator'))) {
    assert.ok(!pg.classList.contains(HIDDEN_ORIGINAL_CLASS), 'paginators are never hidden');
  }
});

test('unmountReader: removes the reader and unhides every post (exact restore)', () => {
  const d = threadDoc();
  const reader = d.createElement('div');
  reader.className = 'glr-reader';
  mountReaderInPostList(reader, d);

  unmountReader(reader, d);

  assert.equal(d.querySelector('.glr-reader'), null, 'reader removed');
  assert.equal(d.querySelectorAll('.' + HIDDEN_ORIGINAL_CLASS).length, 0, 'no post left hidden');
  // The page is back to: top paginator, 3 posts, bottom paginator.
  const content = d.getElementById('content')!;
  const ids = Array.from(content.children).map((c) => c.id);
  assert.deepEqual(ids, ['pg-top', 'op', 'r1', 'r2', 'pg-bottom'], 'original order restored');
});

test('mountReaderInPostList: page 2+ (reply-only, no OP) anchors before the first reply', () => {
  const d = doc(`
    <div id="content">
      <div class="paginator" id="pg-top"></div>
      <div class="post-container post-reply" id="r301"><div class="post-content">a</div></div>
      <div class="post-container post-reply" id="r302"><div class="post-content">b</div></div>
      <div class="paginator" id="pg-bottom"></div>
    </div>`);
  assert.equal(d.querySelector('.post-post'), null, 'no OP on this page');
  const reader = d.createElement('div');

  assert.equal(mountReaderInPostList(reader, d), reader, 'mounts without an OP');
  assert.equal(reader.nextElementSibling?.id, 'r301', 'anchored before the first reply');
  assert.equal(reader.previousElementSibling?.id, 'pg-top', 'still between the paginators');
});

test('mountReaderInPostList: no containers → null (page left untouched)', () => {
  const d = doc('<div id="content"><div class="paginator"></div></div>');
  const reader = d.createElement('div');
  assert.equal(mountReaderInPostList(reader, d), null, 'returns null when no posts');
  assert.equal(reader.parentElement, null, 'reader not inserted anywhere');
  assert.equal(d.querySelector('.paginator')?.classList.length, 1, 'paginator untouched');
});

// ---------------------------------------------------------------------------
// Fix 1 (real fixtures) — the reader must land BETWEEN the top and bottom
// paginators on BOTH the page-1 DOM (visible OP ABOVE the top nav) and the
// page-2 DOM (collapsed OP inside `.post-expander > .hidden` BEFORE the top
// nav). These use the actual captured `#content` markup, not a hand-built
// stand-in, so they pin the exact placement the previous versions got wrong.
// ---------------------------------------------------------------------------

/** Order index of `el` among #content's direct children. */
function contentIndex(d: Document, el: Element | null): number {
  const content = d.getElementById('content')!;
  return el ? Array.from(content.children).indexOf(el) : -1;
}

test('rendered containers: page 1 keeps the visible OP, page 2 drops the collapsed OP', () => {
  const p1 = renderedPostContainers(pageDoc('page1-content.html'));
  assert.equal(p1.length, 26, 'page 1: OP + 25 replies are all rendered');
  assert.equal(
    p1.filter((c) => c.classList.contains('post-post')).length,
    1,
    'page 1: the visible OP is kept',
  );

  const p2 = renderedPostContainers(pageDoc('page2-content.html'));
  assert.equal(p2.length, 25, 'page 2: only the 25 visible replies (collapsed OP excluded)');
  assert.equal(
    p2.filter((c) => c.classList.contains('post-post')).length,
    0,
    'page 2: the hidden OP is NOT rendered',
  );
});

test('page 1: reader is inserted AFTER the top paginator and BEFORE the bottom one', () => {
  const d = pageDoc('page1-content.html');
  const paginators = Array.from(d.querySelectorAll('#content > .paginator'));
  assert.equal(paginators.length, 2, 'page 1 has exactly two paginators');
  const [topPg, bottomPg] = paginators;

  const reader = mountFullReader(d);

  // Placed strictly between the two navs.
  assert.equal(reader.parentElement?.id, 'content', 'reader lives directly in #content');
  assert.equal(reader.previousElementSibling, topPg, 'reader sits immediately after the top paginator');
  const ri = contentIndex(d, reader);
  assert.ok(ri > contentIndex(d, topPg), 'reader is below the top paginator');
  assert.ok(ri < contentIndex(d, bottomPg), 'reader is above the bottom paginator');

  // Never nested inside a hidden/expander wrapper.
  assert.equal(reader.closest('.hidden'), null, 'reader is not inside a .hidden wrapper');
  assert.equal(reader.closest('.post-expander'), null, 'reader is not inside a .post-expander');

  // Both paginators survive and stay visible.
  assert.equal(d.querySelectorAll('#content > .paginator').length, 2, 'both paginators remain');
  for (const pg of paginators) {
    assert.ok(!pg.classList.contains(HIDDEN_ORIGINAL_CLASS), 'paginator never hidden');
  }

  // The OP is represented in the reader AND its original container is hidden.
  assert.ok(reader.querySelector('.glr-post--op'), 'OP appears in the reader on page 1');
  assert.equal(reader.querySelectorAll('.glr-post').length, 26, '26 posts rendered');
  const op = d.querySelector('#content > .post-container.post-post')!;
  assert.ok(op.classList.contains(HIDDEN_ORIGINAL_CLASS), 'original OP is hidden');
  // The OP sits ABOVE the top paginator yet is still hidden — the reader is below.
  assert.ok(contentIndex(d, op) < contentIndex(d, topPg), 'page-1 OP is above the top nav');
});

test('page 2: reader is between the paginators and the collapsed OP is excluded', () => {
  const d = pageDoc('page2-content.html');
  const paginators = Array.from(d.querySelectorAll('#content > .paginator'));
  assert.equal(paginators.length, 2, 'page 2 has exactly two paginators');
  const [topPg, bottomPg] = paginators;

  const reader = mountFullReader(d);

  assert.equal(reader.previousElementSibling, topPg, 'reader sits immediately after the top paginator');
  const ri = contentIndex(d, reader);
  assert.ok(ri > contentIndex(d, topPg), 'reader is below the top paginator');
  assert.ok(ri < contentIndex(d, bottomPg), 'reader is above the bottom paginator');
  assert.equal(reader.closest('.hidden'), null, 'reader is not inside the hidden OP wrapper');
  assert.equal(reader.closest('.post-expander'), null, 'reader is not inside the expander');

  // The collapsed OP is NOT in the reader and was NOT touched.
  assert.equal(reader.querySelector('.glr-post--op'), null, 'collapsed OP is absent from the reader');
  assert.equal(reader.querySelectorAll('.glr-post').length, 25, 'only the 25 replies rendered');
  const collapsedOp = d.querySelector('.post-expander .post-container.post-post')!;
  assert.ok(collapsedOp, 'the collapsed OP still exists in the DOM');
  assert.ok(
    !collapsedOp.classList.contains(HIDDEN_ORIGINAL_CLASS),
    'we never add our hide-class to the already-collapsed OP',
  );
  assert.ok(collapsedOp.closest('.post-expander'), 'collapsed OP stays inside its expander');

  // Both paginators preserved.
  assert.equal(d.querySelectorAll('#content > .paginator').length, 2, 'both paginators remain');
});

test('unmountReader restores both real pages (same nodes, same order, nothing hidden)', () => {
  for (const file of ['page1-content.html', 'page2-content.html']) {
    const d = pageDoc(file);
    const content = d.getElementById('content')!;
    const before = Array.from(content.children); // node references, in order

    const reader = mountFullReader(d);
    unmountReader(reader, d);

    assert.equal(d.querySelector('.glr-reader'), null, `${file}: reader removed`);
    assert.equal(
      d.querySelectorAll('.' + HIDDEN_ORIGINAL_CLASS).length,
      0,
      `${file}: no host post left hidden`,
    );
    const after = Array.from(content.children);
    assert.equal(after.length, before.length, `${file}: child count restored`);
    after.forEach((node, i) => {
      assert.equal(node, before[i], `${file}: child ${i} is the same original node, same place`);
    });
    // No stray glr- classes were left on any host element.
    assert.equal(
      content.querySelectorAll('[class*="glr-"]').length,
      0,
      `${file}: no glr- classes linger on host nodes`,
    );
  }
});
