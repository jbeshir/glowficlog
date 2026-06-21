// Tests for the commonAncestor helper the content script uses to locate the
// post-list wrapper without assuming an original post exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  commonAncestor,
  mountReaderInPostList,
  unmountReader,
  HIDDEN_ORIGINAL_CLASS,
} from '../src/reader-core/index.js';

function doc(html: string): Document {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`).window.document;
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
