// Tests for the icon sizing: the pure core (computeIconSizes) exhaustively, and
// the DOM pass (layoutIcons) against a jsdom reader with mocked offsetTop. The
// box is COMPACT (icon + padding); there is no flowing arm segment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  computeIconSizes,
  layoutIcons,
  renderReader,
  parsePosts,
  DEFAULT_ICON_OPTS,
  DEFAULT_ICON_PAD,
} from '../src/reader-core/index.js';

const OPTS = { min: 26, cap: 100, gap: 8 };

// ---------------------------------------------------------------------------
// computeIconSizes — pure geometry
// ---------------------------------------------------------------------------

test('computeIconSizes: flow across boundary grows the icon to fill the gap', () => {
  // One icon at top 0; the next same-side icon is 200px below. Available space
  // (200 - 0 - gap) is well past the cap, so it clamps to the cap.
  const sizes = computeIconSizes([0, 200], 1000, OPTS);
  assert.equal(sizes[0], OPTS.cap, 'first icon grows to cap across the boundary');
});

test('computeIconSizes: a moderate gap grows the icon but below the cap', () => {
  // Next icon 60px below → available 60 - 8 = 52, between min and cap.
  const sizes = computeIconSizes([0, 60], 1000, OPTS);
  assert.equal(sizes[0], 52, 'icon sized to the available span minus gap');
});

test('computeIconSizes: tight same-side spacing clamps to min', () => {
  // Dense run: icons 24px apart → available 24 - 8 = 16 < min → floored at min.
  const sizes = computeIconSizes([0, 24, 48, 72], 1000, OPTS);
  assert.deepEqual(
    sizes.slice(0, 3),
    [OPTS.min, OPTS.min, OPTS.min],
    'dense same-side run stays at min',
  );
});

test('computeIconSizes: the cap is always respected', () => {
  const sizes = computeIconSizes([0, 5000], 10000, { min: 10, cap: 64, gap: 8 });
  assert.equal(sizes[0], 64, 'never exceeds cap even with huge available space');
});

test('computeIconSizes: last icon uses containerBottom', () => {
  // Last icon at 100, container bottom 130 → available 30 - 8 = 22 < min → min.
  // Bump the container so the last icon can grow instead.
  const tight = computeIconSizes([0, 100], 130, OPTS);
  assert.equal(tight[1], OPTS.min, 'last icon floored when container ends close');

  const roomy = computeIconSizes([0, 100], 400, OPTS);
  assert.equal(roomy[1], OPTS.cap, 'last icon grows toward containerBottom');
});

test('computeIconSizes: single icon grows to containerBottom (capped)', () => {
  assert.equal(computeIconSizes([0], 300, OPTS)[0], OPTS.cap, 'single icon, lots of room → cap');
  assert.equal(computeIconSizes([10], 40, OPTS)[0], OPTS.min, 'single icon, little room → min');
});

test('computeIconSizes: empty input yields empty output', () => {
  assert.deepEqual(computeIconSizes([], 1000, OPTS), []);
});

test('computeIconSizes: does not mutate its input', () => {
  const tops = [0, 50, 100];
  const copy = [...tops];
  computeIconSizes(tops, 500, OPTS);
  assert.deepEqual(tops, copy, 'input array untouched');
});

test('computeIconSizes: negative/degenerate spans floor at min', () => {
  // Out-of-order or coincident tops must never produce sub-min or negative sizes.
  const sizes = computeIconSizes([100, 100, 50], 500, OPTS);
  assert.ok(sizes.every((s) => s >= OPTS.min), 'all sizes at least min');
});

test('DEFAULT_ICON_OPTS are within the spec ranges', () => {
  assert.ok(DEFAULT_ICON_OPTS.min >= 24 && DEFAULT_ICON_OPTS.min <= 28, 'min ≈ one line height');
  assert.ok(DEFAULT_ICON_OPTS.cap >= 96 && DEFAULT_ICON_OPTS.cap <= 100, 'cap ≈ glowfic max');
  assert.ok(DEFAULT_ICON_OPTS.gap >= 6 && DEFAULT_ICON_OPTS.gap <= 8, 'small gap');
  assert.ok(DEFAULT_ICON_PAD >= 6 && DEFAULT_ICON_PAD <= 10, 'icon padding is small/symmetric');
});

test('computeIconSizes: cap is the PRIMARY size whenever space allows', () => {
  // Plenty of vertical room on every side → every icon sits at the cap, NOT a
  // flowing segment. This is the cap-primary rule.
  const sizes = computeIconSizes([0, 500, 1000], 4000, OPTS);
  assert.deepEqual(sizes, [OPTS.cap, OPTS.cap, OPTS.cap], 'all icons at the cap');
});

// ---------------------------------------------------------------------------
// layoutIcons — DOM measure-and-apply with mocked offsetTop
// ---------------------------------------------------------------------------

function readerWithPosts(n: number): { dom: JSDOM; reader: HTMLElement } {
  // Build n minimal posts; renderReader alternates left/right by index.
  let html = '<div class="post-list">';
  for (let i = 0; i < n; i++) {
    html += `
      <div class="post-container post-reply">
        <a class="noheight" id="reply-${i + 1}"></a>
        <div class="post-icon"><img src="https://cdn.example/${i}.png" alt="k" title="k"></div>
        <div class="post-character">Char${i % 2}</div>
        <div class="post-author">Author${i % 2}</div>
        <div class="post-content"><p>Body ${i}</p></div>
      </div>`;
  }
  html += '</div>';
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const doc = dom.window.document;
  const posts = parsePosts(doc);
  const reader = renderReader(posts, { document: doc });
  doc.body.appendChild(reader);
  return { dom, reader };
}

/** Mock the layout geometry jsdom does not compute: each post's offsetTop (the
 *  arm is pinned to its post top) and the column height. */
function mockGeometry(reader: HTMLElement, topFor: (post: HTMLElement, side: string, i: number) => number, columnHeight: number): void {
  const column = reader.querySelector('.glr-column') as HTMLElement;
  Object.defineProperty(column, 'offsetHeight', { value: columnHeight, configurable: true });
  for (const side of ['left', 'right']) {
    const posts = Array.from(
      reader.querySelectorAll<HTMLElement>(`.glr-post--${side}`),
    );
    posts.forEach((post, i) => {
      Object.defineProperty(post, 'offsetTop', { value: topFor(post, side, i), configurable: true });
    });
  }
}

test('layoutIcons: sizes the compact icon box, not a flowing arm', () => {
  const { reader } = readerWithPosts(4);
  // Posts 0,2 are left (rows at 0, 200); posts 1,3 are right (rows at 100, 300).
  // Spacing of 200 between same-side icons. Column tall.
  mockGeometry(reader, (_post, _side, i) => i * 200, 1000);

  layoutIcons(reader);

  const boxes = Array.from(reader.querySelectorAll<HTMLElement>('.glr-icon-box'));
  assert.equal(boxes.length, 4, 'one box per post');
  for (const box of boxes) {
    assert.equal(box.style.width, box.style.height, 'icon box is square');
    assert.ok(box.style.width.endsWith('px'), 'size written in px');
  }
  // Left side first icon: ~200px of same-side room → the icon sits at the cap
  // (cap-primary), in a COMPACT box. The arm is never given a flow-segment
  // height — its size is icon + padding, derived in CSS.
  const leftPost = reader.querySelector('.glr-post--left') as HTMLElement;
  assert.equal(
    (leftPost.querySelector('.glr-icon-box') as HTMLElement).style.width,
    '100px',
    'isolated icon sits at the cap',
  );
  assert.equal(
    (leftPost.querySelector('.glr-arm') as HTMLElement).style.height,
    '',
    'arm is NOT given a flowing height (box is icon + padding via CSS)',
  );
});

test('layoutIcons: dense same-side run shrinks icons to avoid box overlap', () => {
  const { reader } = readerWithPosts(6);
  // Pack same-side icons only 10px apart → the padded box cannot fit, so the
  // icon floors at min (the box's padding is folded into the clearance).
  mockGeometry(reader, (_post, _side, i) => i * 10, 1000);
  layoutIcons(reader);

  const leftPost = reader.querySelector('.glr-post--left') as HTMLElement;
  // Non-last left icons are floored at min (26px); only the last can grow.
  assert.equal(
    (leftPost.querySelector('.glr-icon-box') as HTMLElement).style.width,
    '26px',
    'dense run icon floored at min',
  );
  assert.equal(
    (leftPost.querySelector('.glr-arm') as HTMLElement).style.height,
    '',
    'no flowing arm height in a dense run either',
  );
});

test('layoutIcons: no posts is a safe no-op', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="glr-reader"><div class="glr-column"></div></div></body></html>');
  const reader = dom.window.document.querySelector('.glr-reader') as HTMLElement;
  assert.doesNotThrow(() => layoutIcons(reader));
});

// ---------------------------------------------------------------------------
// render: icon box structure + onerror monogram fallback
// ---------------------------------------------------------------------------

test('renderReader emits an icon box per post inside its arm', () => {
  const { reader } = readerWithPosts(3);
  const arms = reader.querySelectorAll('.glr-arm');
  assert.equal(arms.length, 3);
  for (const arm of arms) {
    const box = arm.querySelector('.glr-icon-box');
    assert.ok(box, 'arm contains a .glr-icon-box');
    assert.ok(box!.querySelector('.glr-icon'), 'box contains the icon img');
  }
});

test('broken icon image falls back to the monogram on error', () => {
  const { dom, reader } = readerWithPosts(1);
  const img = reader.querySelector('.glr-icon') as HTMLImageElement;
  const box = img.closest('.glr-icon-box') as HTMLElement;
  assert.ok(img && box, 'icon and box present before error');

  // Simulate the image failing to load (broken/blocked/offline).
  img.dispatchEvent(new dom.window.Event('error'));

  assert.equal(box.querySelector('.glr-icon'), null, 'broken img removed');
  const mono = box.querySelector('.glr-icon-mono');
  assert.ok(mono, 'monogram inserted in its place');
  assert.ok((mono!.textContent ?? '').length > 0, 'monogram shows an initial');
});

test('iconless post renders a monogram, not an img', () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div class="post-container post-reply">
      <a class="noheight" id="reply-1"></a>
      <div class="post-character">Nobody</div>
      <div class="post-author">Auth</div>
      <div class="post-content"><p>no icon</p></div>
    </div></body></html>`);
  const doc = dom.window.document;
  const reader = renderReader(parsePosts(doc), { document: doc });
  assert.equal(reader.querySelector('.glr-icon'), null, 'no img for iconless post');
  assert.ok(reader.querySelector('.glr-icon-mono'), 'monogram rendered');
});
