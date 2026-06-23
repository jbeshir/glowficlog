// Tests for applyMoieties: verifies that the per-author --glr-moiety custom
// property is set / cleared / replaced correctly on .glr-icon-box elements
// rendered by renderReader, and that the function is idempotent and safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import type { Post } from '../src/reader-core/index.js';
import { renderReader, applyMoieties } from '../src/reader-core/index.js';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const doc = dom.window.document;

function makePost(id: string, author: string): Post {
  return {
    id,
    isOP: false,
    iconUrl: 'https://cdn.example/icon.png',
    iconKeyword: null,
    character: null,
    screenname: null,
    author,
    bodyHtml: '<p>Hello</p>',
    permalink: null,
  };
}

const posts: Post[] = [makePost('1', 'Alice'), makePost('2', 'Bob')];

function buildReader(): HTMLElement {
  return renderReader(posts, { document: doc });
}

function iconBoxFor(reader: HTMLElement, author: string): HTMLElement | null {
  const post = reader.querySelector<HTMLElement>(`.glr-post[data-author="${author}"]`);
  if (!post) return null;
  return post.querySelector<HTMLElement>('.glr-icon-box');
}

// ---------------------------------------------------------------------------

test('applyMoieties: mapped author with colour sets --glr-moiety verbatim', () => {
  const reader = buildReader();
  applyMoieties(reader, { Alice: '#AA0000', Bob: '#00BF80' });
  assert.equal(
    iconBoxFor(reader, 'Alice')!.style.getPropertyValue('--glr-moiety'),
    '#AA0000',
  );
  assert.equal(
    iconBoxFor(reader, 'Bob')!.style.getPropertyValue('--glr-moiety'),
    '#00BF80',
  );
});

test('applyMoieties: author mapped to null → property absent', () => {
  const reader = buildReader();
  applyMoieties(reader, { Alice: '#AA0000', Bob: null });
  assert.equal(
    iconBoxFor(reader, 'Alice')!.style.getPropertyValue('--glr-moiety'),
    '#AA0000',
  );
  const bobProp = iconBoxFor(reader, 'Bob')!.style.getPropertyValue('--glr-moiety');
  assert.equal(bobProp, '', 'null-mapped author has no --glr-moiety');
});

test('applyMoieties: author NOT in map → property absent', () => {
  const reader = buildReader();
  applyMoieties(reader, { Alice: '#AA0000' });
  const bobProp = iconBoxFor(reader, 'Bob')!.style.getPropertyValue('--glr-moiety');
  assert.equal(bobProp, '', 'unmapped author has no --glr-moiety');
});

test('applyMoieties: idempotent — calling twice with same map yields same result', () => {
  const reader = buildReader();
  const map = { Alice: '#AA0000', Bob: '#00BF80' };
  applyMoieties(reader, map);
  applyMoieties(reader, map);
  assert.equal(
    iconBoxFor(reader, 'Alice')!.style.getPropertyValue('--glr-moiety'),
    '#AA0000',
  );
  assert.equal(
    iconBoxFor(reader, 'Bob')!.style.getPropertyValue('--glr-moiety'),
    '#00BF80',
  );
});

test('applyMoieties: re-calling with {} clears a previously-set ring', () => {
  const reader = buildReader();
  applyMoieties(reader, { Alice: '#AA0000' });
  assert.equal(
    iconBoxFor(reader, 'Alice')!.style.getPropertyValue('--glr-moiety'),
    '#AA0000',
  );
  applyMoieties(reader, {});
  assert.equal(
    iconBoxFor(reader, 'Alice')!.style.getPropertyValue('--glr-moiety'),
    '',
    'property cleared after empty-map call',
  );
});

test('applyMoieties: updating a colour replaces the previous value', () => {
  const reader = buildReader();
  applyMoieties(reader, { Alice: '#AA0000' });
  applyMoieties(reader, { Alice: '#0055FF' });
  assert.equal(
    iconBoxFor(reader, 'Alice')!.style.getPropertyValue('--glr-moiety'),
    '#0055FF',
  );
});

test('applyMoieties: unknown authors and root with no posts do not throw', () => {
  const emptyReader = renderReader([], { document: doc });
  assert.doesNotThrow(() => applyMoieties(emptyReader, { NoSuchAuthor: '#AABBCC' }));

  const reader = buildReader();
  assert.doesNotThrow(() => applyMoieties(reader, { Ghost: '#111111', Phantom: null }));
});
