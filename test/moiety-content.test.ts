// Tests for the content-script moiety fetch/cache module. Uses jsdom + Node's
// built-in mock API. Each test calls clearMoietyCache() to ensure isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import type { Post } from '../src/reader-core/index.js';
import { renderReader } from '../src/reader-core/index.js';
import {
  collectAuthors,
  fetchMoiety,
  applyMoietyRings,
  clearMoietyCache,
} from '../src/content/moiety.js';

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
    highlighted: false,
    actions: [],
  };
}

function buildReader(posts: Post[]): HTMLElement {
  return renderReader(posts, { document: doc });
}

function iconBoxFor(reader: HTMLElement, author: string): HTMLElement | null {
  const post = reader.querySelector<HTMLElement>(`.glr-post[data-author="${author}"]`);
  if (!post) return null;
  return post.querySelector<HTMLElement>('.glr-icon-box');
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------

test('collectAuthors: dedupes repeated authors and skips (deleted user)', () => {
  clearMoietyCache();
  const posts = [
    makePost('1', 'Alice'),
    makePost('2', 'Bob'),
    makePost('3', 'Alice'),
    makePost('4', '(deleted user)'),
  ];
  const reader = buildReader(posts);
  const authors = collectAuthors(reader).sort();
  assert.deepEqual(authors, ['Alice', 'Bob']);
});

test('fetchMoiety: returns #hex and requests the exact URL', async (t) => {
  clearMoietyCache();
  const fetchMock = t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(jsonResponse({ results: [{ username: 'Alicorn', moiety: '00BF80' }] })),
  );
  const result = await fetchMoiety('Alicorn');
  assert.equal(result, '#00BF80');
  assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/v1/users?q=Alicorn&match=exact');
});

test('fetchMoiety: null moiety in response => returns null', async (t) => {
  clearMoietyCache();
  t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(jsonResponse({ results: [{ username: 'Bob', moiety: null }] })),
  );
  assert.equal(await fetchMoiety('Bob'), null);
});

test('fetchMoiety: fetch throwing => returns null and calls console.warn', async (t) => {
  clearMoietyCache();
  t.mock.method(globalThis, 'fetch', () => Promise.reject(new Error('Network error')));
  const warnMock = t.mock.method(console, 'warn');
  const result = await fetchMoiety('Charlie');
  assert.equal(result, null);
  assert.ok(warnMock.mock.callCount() > 0, 'console.warn was called');
});

test('fetchMoiety: non-ok response => returns null and calls console.warn', async (t) => {
  clearMoietyCache();
  t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(new Response('', { status: 404 })),
  );
  const warnMock = t.mock.method(console, 'warn');
  const result = await fetchMoiety('Dave');
  assert.equal(result, null);
  assert.ok(warnMock.mock.callCount() > 0, 'console.warn was called');
});

test('fetchMoiety: cache hit => second call does not re-fetch', async (t) => {
  clearMoietyCache();
  const fetchMock = t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve(jsonResponse({ results: [{ username: 'Eve', moiety: 'AABB00' }] })),
  );
  await fetchMoiety('Eve');
  await fetchMoiety('Eve');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('applyMoietyRings: sets --glr-moiety on matched author, absent for null-moiety', async (t) => {
  clearMoietyCache();
  const posts = [makePost('1', 'Alicorn'), makePost('2', 'Bob')];
  const reader = buildReader(posts);
  t.mock.method(globalThis, 'fetch', (url: string) => {
    if (url.includes('Alicorn')) {
      return Promise.resolve(
        jsonResponse({ results: [{ username: 'Alicorn', moiety: '00BF80' }] }),
      );
    }
    return Promise.resolve(
      jsonResponse({ results: [{ username: 'Bob', moiety: null }] }),
    );
  });
  await applyMoietyRings(reader);
  assert.equal(
    iconBoxFor(reader, 'Alicorn')!.style.getPropertyValue('--glr-moiety'),
    '#00BF80',
  );
  assert.equal(
    iconBoxFor(reader, 'Bob')!.style.getPropertyValue('--glr-moiety'),
    '',
    'null-moiety author has no --glr-moiety',
  );
});
