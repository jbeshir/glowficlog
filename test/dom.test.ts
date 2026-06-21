// Tests for the commonAncestor helper the content script uses to locate the
// post-list wrapper without assuming an original post exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { commonAncestor } from '../src/reader-core/index.js';

function doc(html: string): Document {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`).window.document;
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
