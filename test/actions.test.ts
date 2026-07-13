// Tests for enableActionMenu: a single floating popover appended to <body>,
// shared across every `.glr-icon-box--menu` trigger, repopulated per-post on
// open, closed on Escape/outside-pointerdown/scroll, and fully removed on
// cleanup. Mirrors the jsdom setup/dispatch style of previews.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { renderReader, enableActionMenu, ACTIONS_MENU_ID } from '../src/reader-core/index.js';
import type { Post, PostAction } from '../src/reader-core/index.js';

const replyAction: PostAction = Object.freeze({
  kind: 'permalink',
  label: 'Reply A',
  href: '/a#reply-a',
  method: null,
  rel: 'alternate',
  iconUrl: 'https://cdn.example/a.png',
});
const unreadActionB: PostAction = Object.freeze({
  kind: 'unread',
  label: 'Mark Unread B',
  href: '/b/unread=1',
  method: 'post',
  rel: null,
  iconUrl: 'https://cdn.example/b1.png',
});
const permalinkActionB: PostAction = Object.freeze({
  kind: 'permalink',
  label: 'Permalink B',
  href: '/b#reply-b',
  method: null,
  rel: 'alternate',
  iconUrl: null,
});

function fullPost(id: string, actions: readonly PostAction[]): Post {
  return Object.freeze({
    id,
    isOP: false,
    iconUrl: 'https://cdn.example/icon.png',
    iconKeyword: 'k',
    character: `Char${id}`,
    screenname: null,
    author: `Auth${id}`,
    bodyHtml: '<p>hi</p>',
    permalink: null,
    highlighted: false,
    actions,
  });
}

/** A reader with two posts ('a', 'b') carrying different actions, so the
 *  popover's repopulated content can be told apart after switching triggers. */
function readerWithTwoActionPosts(): { dom: JSDOM; reader: HTMLElement; posts: readonly Post[] } {
  const posts: readonly Post[] = [fullPost('a', [replyAction]), fullPost('b', [unreadActionB, permalinkActionB])];
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const doc = dom.window.document;
  const reader = renderReader(posts, { document: doc });
  doc.body.appendChild(reader);
  return { dom, reader, posts };
}

function triggers(reader: HTMLElement): HTMLElement[] {
  return Array.from(reader.querySelectorAll<HTMLElement>('.glr-icon-box--menu'));
}

test('enableActionMenu: open on click shows a body-level popover with the right post actions', () => {
  const { dom, reader, posts } = readerWithTwoActionPosts();
  const { document: doc } = dom.window;
  const dispose = enableActionMenu(reader, posts);

  const [triggerA] = triggers(reader);
  triggerA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  const popover = doc.getElementById(ACTIONS_MENU_ID) as HTMLElement;
  assert.ok(popover, 'popover exists');
  assert.equal(popover.parentElement, doc.body, 'popover is appended to <body>');
  assert.ok(popover.classList.contains('glr-actions--open'));
  assert.equal(popover.getAttribute('aria-hidden'), 'false');
  assert.equal(triggerA.getAttribute('aria-expanded'), 'true');

  const links = Array.from(popover.querySelectorAll('.glr-action'));
  assert.equal(links.length, 1, 'popover holds post A\'s single action');
  assert.equal(links[0].getAttribute('href'), '/a#reply-a');

  dispose();
});

test('enableActionMenu: open on Enter keydown', () => {
  const { dom, reader, posts } = readerWithTwoActionPosts();
  const { document: doc } = dom.window;
  const dispose = enableActionMenu(reader, posts);

  const [triggerA] = triggers(reader);
  triggerA.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );

  const popover = doc.getElementById(ACTIONS_MENU_ID);
  assert.ok(popover?.classList.contains('glr-actions--open'));
  assert.equal(triggerA.getAttribute('aria-expanded'), 'true');

  dispose();
});

test('enableActionMenu: open on Space keydown and preventDefault the scroll', () => {
  const { dom, reader, posts } = readerWithTwoActionPosts();
  const { document: doc } = dom.window;
  const dispose = enableActionMenu(reader, posts);

  const [triggerA] = triggers(reader);
  const ev = new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  triggerA.dispatchEvent(ev);

  const popover = doc.getElementById(ACTIONS_MENU_ID);
  assert.ok(popover?.classList.contains('glr-actions--open'));
  assert.equal(ev.defaultPrevented, true, 'Space is prevented so the page does not scroll');

  dispose();
});

test('enableActionMenu: close on Escape returns focus to the trigger', () => {
  const { dom, reader, posts } = readerWithTwoActionPosts();
  const { document: doc } = dom.window;
  const dispose = enableActionMenu(reader, posts);

  const [triggerA] = triggers(reader);
  triggerA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const popover = doc.getElementById(ACTIONS_MENU_ID) as HTMLElement;
  assert.ok(popover.classList.contains('glr-actions--open'), 'sanity: open before Escape');

  triggerA.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );

  assert.ok(!popover.classList.contains('glr-actions--open'));
  assert.equal(triggerA.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, triggerA, 'focus returns to the trigger that was open');

  dispose();
});

test('enableActionMenu: Escape from INSIDE the popover still closes it (popover is a body child, outside the reader)', () => {
  const { dom, reader, posts } = readerWithTwoActionPosts();
  const { document: doc } = dom.window;
  const dispose = enableActionMenu(reader, posts);

  const [triggerA] = triggers(reader);
  triggerA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const popover = doc.getElementById(ACTIONS_MENU_ID) as HTMLElement;
  assert.ok(popover.classList.contains('glr-actions--open'), 'sanity: open before Escape');

  // Move focus into the popover (a menuitem link), as a keyboard/AT user might,
  // then press Escape from there. The popover lives on <body>, structurally
  // OUTSIDE the reader root, so this only closes if Escape is handled at the
  // document level — a root-scoped handler would never see this event.
  const link = popover.querySelector('.glr-action') as HTMLElement;
  link.focus();
  link.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );

  assert.ok(!popover.classList.contains('glr-actions--open'), 'popover closes on Escape from within');
  assert.equal(triggerA.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.activeElement, triggerA, 'focus returns to the trigger');

  dispose();
});

test('enableActionMenu: close on outside pointerdown', () => {
  const { dom, reader, posts } = readerWithTwoActionPosts();
  const { document: doc } = dom.window;
  const dispose = enableActionMenu(reader, posts);

  const [triggerA] = triggers(reader);
  triggerA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const popover = doc.getElementById(ACTIONS_MENU_ID) as HTMLElement;
  assert.ok(popover.classList.contains('glr-actions--open'), 'sanity: open before outside pointerdown');

  const outside = doc.createElement('div');
  doc.body.appendChild(outside);
  outside.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));

  assert.ok(!popover.classList.contains('glr-actions--open'));
  assert.equal(triggerA.getAttribute('aria-expanded'), 'false');

  dispose();
});

test('enableActionMenu: close on document scroll', () => {
  const { dom, reader, posts } = readerWithTwoActionPosts();
  const { document: doc } = dom.window;
  const dispose = enableActionMenu(reader, posts);

  const [triggerA] = triggers(reader);
  triggerA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const popover = doc.getElementById(ACTIONS_MENU_ID) as HTMLElement;
  assert.ok(popover.classList.contains('glr-actions--open'), 'sanity: open before scroll');

  doc.dispatchEvent(new dom.window.Event('scroll'));

  assert.ok(!popover.classList.contains('glr-actions--open'));
  assert.equal(triggerA.getAttribute('aria-expanded'), 'false');

  dispose();
});

test('enableActionMenu: switching triggers closes A, opens B, repopulates a single shared popover', () => {
  const { dom, reader, posts } = readerWithTwoActionPosts();
  const { document: doc } = dom.window;
  const dispose = enableActionMenu(reader, posts);

  const [triggerA, triggerB] = triggers(reader);
  triggerA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  triggerB.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(triggerA.getAttribute('aria-expanded'), 'false');
  assert.equal(triggerB.getAttribute('aria-expanded'), 'true');
  assert.equal(doc.querySelectorAll('.glr-actions').length, 1, 'still exactly one popover node');

  const popover = doc.getElementById(ACTIONS_MENU_ID) as HTMLElement;
  const links = Array.from(popover.querySelectorAll('.glr-action'));
  assert.equal(links.length, 2, 'popover now holds post B\'s two actions');
  assert.equal(links[0].getAttribute('href'), '/b/unread=1');
  assert.equal(links[1].getAttribute('href'), '/b#reply-b');

  dispose();
});

test('enableActionMenu: onOpenChange fires true on open and false on close', () => {
  const { dom, reader, posts } = readerWithTwoActionPosts();
  const calls: boolean[] = [];
  const dispose = enableActionMenu(reader, posts, { onOpenChange: (open) => calls.push(open) });

  const [triggerA] = triggers(reader);
  triggerA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls, [true]);

  triggerA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls, [true, false]);

  dispose();
});

test('enableActionMenu: disposer removes the popover node and stops listening', () => {
  const { dom, reader, posts } = readerWithTwoActionPosts();
  const { document: doc } = dom.window;
  const dispose = enableActionMenu(reader, posts);

  const [triggerA] = triggers(reader);
  triggerA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.ok(doc.getElementById(ACTIONS_MENU_ID), 'sanity: popover exists before dispose');

  dispose();
  assert.equal(doc.getElementById(ACTIONS_MENU_ID), null, 'popover removed from the DOM');

  assert.doesNotThrow(() => doc.dispatchEvent(new dom.window.Event('scroll')));
  assert.doesNotThrow(() => doc.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })));
  assert.equal(doc.getElementById(ACTIONS_MENU_ID), null, 'still gone after post-dispose events');
});
