// Headless tests for highlighted posts, `.post-edit-box` derived
// actions (parse + render), and the pure `resolveLinkedTarget` content-script
// helper. Mirrors the jsdom setup/import style of reader-core.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parsePosts, renderReader } from '../src/reader-core/index.js';
import type { Post, PostAction } from '../src/reader-core/index.js';

function domFor(html: string): JSDOM {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
}

interface PostOpts {
  readonly author?: string;
  readonly highlighted?: boolean;
  readonly actions?: readonly PostAction[];
}

function fullPost(id: string, opts: PostOpts = {}): Post {
  return Object.freeze({
    id,
    isOP: false,
    iconUrl: null,
    iconKeyword: null,
    character: 'Alice',
    screenname: null,
    author: opts.author ?? 'Auth',
    bodyHtml: '<p>hi</p>',
    permalink: null,
    highlighted: opts.highlighted ?? false,
    actions: opts.actions ?? [],
  });
}

// ---- content.ts: import AFTER stubbing globalThis.document -----------------
// content.ts runs real init logic at module top level, gated behind
// isThreadPage() (`document.querySelector('.post-container') !== null`), which
// reads an AMBIENT `document`, not an injected one — so we must stub
// globalThis.document to a `.post-container`-less document BEFORE importing,
// mirroring the extension-global stubbing pattern in controls.test.ts. With no
// `.post-container` present, isThreadPage() is false, so init() no-ops via
// revealAfterFouc() (a harmless, optional-chained DOM query) without ever
// reaching mountControls(), storage, or extension APIs.
const savedDocument = (globalThis as { document?: Document }).document;
(globalThis as { document?: Document }).document = domFor('').window.document;
const { resolveLinkedTarget } = await import('../src/content/content.js');
(globalThis as { document?: Document }).document = savedDocument;

function readerWithPosts(): HTMLElement {
  const dom = domFor(`
    <div class="glr-reader">
      <div class="glr-column">
        <article data-post-id="5">five</article>
        <article data-post-id="7">seven</article>
      </div>
    </div>`);
  return dom.window.document.querySelector('.glr-reader') as HTMLElement;
}

// ---------------------------------------------------------------------------
// parse — highlighted
// ---------------------------------------------------------------------------
test('parse: .reply-highlighted container -> highlighted true', () => {
  const html = `
    <div class="post-list">
      <div class="post-container post-reply reply-highlighted">
        <div class="post-author">Alice</div>
        <div class="post-content"><p>hi</p></div>
      </div>
    </div>`;
  const doc = domFor(html).window.document;
  const posts = parsePosts(doc);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].highlighted, true);
});

test('parse: a normal container -> highlighted false', () => {
  const html = `
    <div class="post-list">
      <div class="post-container post-reply">
        <div class="post-author">Alice</div>
        <div class="post-content"><p>hi</p></div>
      </div>
    </div>`;
  const doc = domFor(html).window.document;
  const posts = parsePosts(doc);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].highlighted, false);
});

// ---------------------------------------------------------------------------
// parse — actions
// ---------------------------------------------------------------------------
test('parse: edit-box anchors derive permalink + unread actions', () => {
  const html = `
    <div class="post-list">
      <div class="post-container post-reply">
        <div class="post-author">Alice</div>
        <div class="post-edit-box">
          <a rel="alternate" href="/replies/5#reply-5"><img title="Permalink"></a>
          <a href="/replies/5/unread=1" data-method="post"><img title="Mark Unread"></a>
        </div>
        <div class="post-content"><p>hi</p></div>
      </div>
    </div>`;
  const doc = domFor(html).window.document;
  const posts = parsePosts(doc);
  assert.equal(posts.length, 1);
  const { actions } = posts[0];
  assert.equal(actions.length, 2);

  const [permalink, unread] = actions;
  assert.equal(permalink.kind, 'permalink');
  assert.equal(permalink.label, 'Permalink');
  assert.equal(permalink.href, '/replies/5#reply-5');
  assert.equal(permalink.method, null);
  assert.equal(permalink.rel, 'alternate');
  assert.equal(permalink.iconUrl, null);

  assert.equal(unread.kind, 'unread');
  assert.equal(unread.label, 'Mark Unread');
  assert.equal(unread.href, '/replies/5/unread=1');
  assert.equal(unread.method, 'post');
  assert.equal(unread.rel, null);
  assert.equal(unread.iconUrl, null);
});

test('parse: no .post-edit-box -> empty actions and highlighted false', () => {
  const html = `
    <div class="post-list">
      <div class="post-container post-reply">
        <div class="post-author">Alice</div>
        <div class="post-content"><p>hi</p></div>
      </div>
    </div>`;
  const doc = domFor(html).window.document;
  const posts = parsePosts(doc);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].actions, []);
  assert.equal(posts[0].highlighted, false);
});

test('parse: forged .post-edit-box / a.noheight inside untrusted .post-content are ignored', () => {
  // Logged-out viewer: no genuine edit-box exists outside .post-content. A
  // page author has forged one inside the body, hoping it gets scraped into a
  // real clickable action (javascript: href) or hijacks the post id.
  const html = `
    <div class="post-list">
      <div class="post-container post-reply">
        <div class="post-author">Alice</div>
        <div class="post-content">
          <p>hi</p>
          <div class="post-edit-box">
            <a href="javascript:alert(1)" data-method="post"><img title="Mark Unread"></a>
          </div>
          <a class="noheight" id="reply-9999"></a>
        </div>
      </div>
    </div>`;
  const doc = domFor(html).window.document;
  const posts = parsePosts(doc);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].actions.length, 0, 'forged edit-box inside .post-content yields no actions');
  assert.notEqual(posts[0].id, '9999', 'forged noheight anchor inside .post-content does not hijack the id');
  assert.equal(posts[0].permalink, null, 'no permalink derived from forged in-body markup');
});

// ---------------------------------------------------------------------------
// render — highlighted
// ---------------------------------------------------------------------------
test('render: highlighted post gets glr-post--linked + data-glr-linked="1"', () => {
  const doc = domFor('').window.document;
  const posts: Post[] = [fullPost('h1', { highlighted: true })];
  const reader = renderReader(posts, { document: doc });
  const article = reader.querySelector('.glr-post')!;
  assert.ok(article.classList.contains('glr-post--linked'));
  assert.equal(article.getAttribute('data-glr-linked'), '1');
});

test('render: non-highlighted post has neither the class nor the attribute', () => {
  const doc = domFor('').window.document;
  const posts: Post[] = [fullPost('h2')];
  const reader = renderReader(posts, { document: doc });
  const article = reader.querySelector('.glr-post')!;
  assert.ok(!article.classList.contains('glr-post--linked'));
  assert.equal(article.hasAttribute('data-glr-linked'), false);
});

// ---------------------------------------------------------------------------
// render — actions menu
// ---------------------------------------------------------------------------
const unreadAction: PostAction = Object.freeze({
  kind: 'unread',
  label: 'Mark Unread',
  href: '/replies/9/unread=1',
  method: 'post',
  rel: null,
  iconUrl: 'https://cdn.example/icon.png',
});
const permalinkAction: PostAction = Object.freeze({
  kind: 'permalink',
  label: 'Permalink',
  href: '/replies/9#reply-9',
  method: null,
  rel: 'alternate',
  iconUrl: null,
});

test('render: actions menu trigger + menu markup for a post with actions', () => {
  const doc = domFor('').window.document;
  const posts: Post[] = [fullPost('9', { actions: [unreadAction, permalinkAction] })];
  const reader = renderReader(posts, { document: doc });

  const iconBox = reader.querySelector('.glr-icon-box')!;
  assert.ok(iconBox.classList.contains('glr-icon-box--menu'));
  assert.equal(iconBox.getAttribute('role'), 'button');
  assert.equal(iconBox.getAttribute('aria-haspopup'), 'menu');
  assert.equal(iconBox.getAttribute('aria-expanded'), 'false');
  assert.equal(iconBox.getAttribute('aria-controls'), 'glr-actions-9');

  const menu = reader.querySelector('#glr-actions-9')!;
  assert.ok(menu, 'menu element exists');
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.ok(menu.hasAttribute('hidden'));

  const items = Array.from(menu.querySelectorAll('.glr-action'));
  assert.equal(items.length, 2);

  const [item1, item2] = items;
  assert.equal(item1.getAttribute('role'), 'menuitem');
  assert.equal(item1.getAttribute('href'), '/replies/9/unread=1');
  assert.equal(item1.querySelector('.glr-action-label')?.textContent, 'Mark Unread');
  assert.ok(item1.querySelector('.glr-action-icon'), 'icon present when iconUrl is set');

  assert.equal(item2.getAttribute('role'), 'menuitem');
  assert.equal(item2.getAttribute('href'), '/replies/9#reply-9');
  assert.equal(item2.querySelector('.glr-action-label')?.textContent, 'Permalink');
  assert.equal(item2.querySelector('.glr-action-icon'), null, 'no icon when iconUrl is absent');
});

test('render: no actions -> no menu trigger, no menu element', () => {
  const doc = domFor('').window.document;
  const posts: Post[] = [fullPost('10')];
  const reader = renderReader(posts, { document: doc });
  assert.equal(reader.querySelector('.glr-icon-box--menu'), null);
  assert.equal(reader.querySelector('.glr-actions'), null);
});

// ---------------------------------------------------------------------------
// render — determinism
// ---------------------------------------------------------------------------
test('render: rendering the same posts array twice yields identical markup', () => {
  const doc = domFor('').window.document;
  const posts: Post[] = [
    fullPost('20', { highlighted: true }),
    fullPost('21', { author: 'Bo', actions: [unreadAction, permalinkAction] }),
  ];
  const first = renderReader(posts, { document: doc });
  const second = renderReader(posts, { document: doc });
  assert.equal(second.outerHTML, first.outerHTML, 'render is deterministic');
});

// ---------------------------------------------------------------------------
// content — resolveLinkedTarget
// ---------------------------------------------------------------------------
test('resolveLinkedTarget: #reply-{id} resolves the matching data-post-id element', () => {
  const reader = readerWithPosts();
  const target = resolveLinkedTarget(reader, '#reply-5');
  assert.ok(target);
  assert.equal(target?.getAttribute('data-post-id'), '5');
});

test('resolveLinkedTarget: empty hash returns null', () => {
  const reader = readerWithPosts();
  assert.equal(resolveLinkedTarget(reader, ''), null);
});

test('resolveLinkedTarget: non-matching hash returns null', () => {
  const reader = readerWithPosts();
  assert.equal(resolveLinkedTarget(reader, '#reply-nonexistent'), null);
});
