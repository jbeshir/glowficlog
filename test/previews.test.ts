// Tests for enableIconPreviews: a single floating preview appended to
// <body> (so nothing clips it), shown on hover with a small delay, hidden on
// leave, skipped for monogram fallbacks, and fully removed on cleanup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { renderReader, parsePosts, enableIconPreviews } from '../src/reader-core/index.js';

/** A reader with one icon-bearing post (index 0) and one iconless/monogram post. */
function readerWithMixedIcons(): { dom: JSDOM; reader: HTMLElement } {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div class="post-list">
      <div class="post-container post-reply">
        <div class="post-icon"><img src="https://cdn.example/has-icon.png" alt="k" title="k"></div>
        <div class="post-character">Withicon</div><div class="post-author">A0</div>
        <div class="post-content"><p>one</p></div>
      </div>
      <div class="post-container post-reply">
        <div class="post-character">Noicon</div><div class="post-author">A1</div>
        <div class="post-content"><p>two</p></div>
      </div>
    </div></body></html>`);
  const doc = dom.window.document;
  const reader = renderReader(parsePosts(doc), { document: doc });
  doc.body.appendChild(reader);
  return { dom, reader };
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('enableIconPreviews: shows a floating, un-nested preview on hover and hides on leave', async () => {
  const { dom, reader } = readerWithMixedIcons();
  const { document: doc } = dom.window;
  const cleanup = enableIconPreviews(reader);

  const iconBox = reader.querySelector('.glr-icon-box') as HTMLElement;
  iconBox.dispatchEvent(new dom.window.Event('mouseenter'));

  // Nothing should appear before the show delay elapses.
  assert.equal(doc.querySelector('.glr-icon-preview.glr-icon-preview--visible'), null, 'no flash before delay');

  await wait(220);
  const preview = doc.querySelector('.glr-icon-preview') as HTMLElement;
  assert.ok(preview, 'a preview element exists');
  assert.equal(preview.parentElement, doc.body, 'preview is appended to <body>, not nested in the reader');
  assert.ok(preview.classList.contains('glr-icon-preview--visible'), 'preview is shown after the delay');
  const pImg = preview.querySelector('img') as HTMLImageElement;
  assert.match(pImg.getAttribute('src') ?? '', /cdn\.example\/has-icon/, 'preview shows the hovered icon');

  iconBox.dispatchEvent(new dom.window.Event('mouseleave'));
  assert.ok(!preview.classList.contains('glr-icon-preview--visible'), 'preview hidden on leave');

  cleanup();
});

test('enableIconPreviews: skips monogram fallbacks (no real image)', async () => {
  const { dom, reader } = readerWithMixedIcons();
  const { document: doc } = dom.window;
  const cleanup = enableIconPreviews(reader);

  // The second post is iconless → its box holds a monogram, not a .glr-icon img.
  const boxes = Array.from(reader.querySelectorAll<HTMLElement>('.glr-icon-box'));
  const monoBox = boxes[1];
  assert.equal(monoBox.querySelector('.glr-icon'), null, 'monogram box has no real image');

  monoBox.dispatchEvent(new dom.window.Event('mouseenter'));
  await wait(220);
  assert.equal(
    doc.querySelector('.glr-icon-preview.glr-icon-preview--visible'),
    null,
    'no preview shown for a monogram',
  );

  cleanup();
});

test('enableIconPreviews: cleanup removes the floating preview node', async () => {
  const { dom, reader } = readerWithMixedIcons();
  const { document: doc } = dom.window;
  const cleanup = enableIconPreviews(reader);

  const iconBox = reader.querySelector('.glr-icon-box') as HTMLElement;
  iconBox.dispatchEvent(new dom.window.Event('mouseenter'));
  await wait(220);
  assert.ok(doc.querySelector('.glr-icon-preview'), 'preview created');

  cleanup();
  assert.equal(doc.querySelector('.glr-icon-preview'), null, 'preview removed on cleanup');
});

test('enableIconPreviews: no icon boxes is a safe no-op returning a cleanup', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="glr-reader"></div></body></html>');
  const reader = dom.window.document.querySelector('.glr-reader') as HTMLElement;
  let cleanup!: () => void;
  assert.doesNotThrow(() => {
    cleanup = enableIconPreviews(reader);
  });
  assert.doesNotThrow(() => cleanup());
});
