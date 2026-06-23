// Headless tests for reader-core, run via tsx + node:test with jsdom.
// This is the in-pipeline proxy for "the reader renders": we parse every real
// fixture and assert the model, then render and assert the layout structure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';

import { parsePosts, renderReader, computeFullAppearances } from '../src/reader-core/index.js';
import type { FixtureMeta, Post } from '../src/reader-core/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, '..', 'fixtures');

const manifest: FixtureMeta[] = JSON.parse(
  readFileSync(join(fixturesDir, 'manifest.json'), 'utf8'),
);

function domFor(html: string): JSDOM {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
}

// ---------------------------------------------------------------------------
// Per-fixture model + render assertions
// ---------------------------------------------------------------------------
for (const meta of manifest) {
  test(`fixture ${meta.name}: parse model`, () => {
    const html = readFileSync(join(fixturesDir, meta.file), 'utf8');
    const dom = domFor(html);
    const doc = dom.window.document;

    let posts: readonly Post[] = [];
    assert.doesNotThrow(() => {
      posts = parsePosts(doc);
    }, 'parsePosts must not throw');

    // Count matches the manifest.
    assert.equal(posts.length, meta.postCount, 'post count matches manifest');

    // Immutability.
    assert.ok(Object.isFrozen(posts), 'returned array is frozen');
    assert.ok(posts.every((p) => Object.isFrozen(p)), 'each post is frozen');

    // Author is always present and non-empty for these real fixtures.
    assert.ok(
      posts.every((p) => typeof p.author === 'string' && p.author.length > 0),
      'every post has an author',
    );

    // Icon presence matches manifest flag.
    const iconless = posts.filter((p) => p.iconUrl === null);
    if (meta.hasIconlessPosts) {
      assert.ok(iconless.length > 0, 'has at least one iconless post');
    } else {
      assert.equal(iconless.length, 0, 'no iconless posts when flag is false');
    }

    // Author-only (no character) presence matches manifest flag.
    const authorOnly = posts.filter((p) => p.character === null);
    if (meta.hasAuthorOnlyPosts) {
      assert.ok(authorOnly.length > 0, 'has at least one author-only post');
    } else {
      assert.equal(authorOnly.length, 0, 'no author-only posts when flag is false');
    }

    // OP count matches the DOM.
    const opInDom = doc.querySelectorAll('.post-container.post-post').length;
    assert.equal(posts.filter((p) => p.isOP).length, opInDom, 'OP count matches DOM');

    // At least some screennames parse out (all fixtures contain them).
    assert.ok(
      posts.some((p) => p.screenname !== null),
      'at least one screenname parsed',
    );

    // Every icon-bearing post exposes a keyword and a CDN url.
    for (const p of posts) {
      if (p.iconUrl !== null) {
        assert.match(p.iconUrl, /^https?:\/\//, 'icon url looks absolute');
      }
    }
  });

  test(`fixture ${meta.name}: render structure`, () => {
    const html = readFileSync(join(fixturesDir, meta.file), 'utf8');
    const dom = domFor(html);
    const doc = dom.window.document;
    const posts = parsePosts(doc);

    let reader!: HTMLElement;
    assert.doesNotThrow(() => {
      reader = renderReader(posts, { document: doc, theme: 'light' });
    }, 'renderReader must not throw');

    // Scoped root + column.
    assert.ok(reader.classList.contains('glr-reader'), 'root is .glr-reader');
    assert.equal(reader.getAttribute('data-theme'), 'light');
    const column = reader.querySelector('.glr-column');
    assert.ok(column, 'has a .glr-column');

    const rendered = reader.querySelectorAll('.glr-post');
    assert.equal(rendered.length, posts.length, 'one .glr-post per post');

    // Gutter alternation: even index left, odd index right.
    rendered.forEach((el, i) => {
      const side = i % 2 === 0 ? 'left' : 'right';
      assert.ok(
        el.classList.contains(`glr-post--${side}`),
        `post ${i} is on the ${side}`,
      );
      // Structural children all present + scoped.
      assert.ok(el.querySelector('.glr-arm'), `post ${i} has a compact icon box`);
      assert.ok(el.querySelector('.glr-band'), `post ${i} has a body rectangle`);
      assert.ok(el.querySelector('.glr-connector'), `post ${i} has an icon→body connector`);
      assert.ok(el.querySelector('.glr-icon-box'), `post ${i} has an icon box`);
      assert.ok(el.querySelector('.glr-body'), `post ${i} has body`);
      assert.ok(el.querySelector('.glr-content'), `post ${i} has content`);

      // The three tinted pieces (icon box + connector + body band) carry the SAME
      // stripe as the post, and posts alternate stripe by parity so adjacent
      // blocks differ.
      const stripe = i % 2 === 0 ? 'a' : 'b';
      assert.ok(
        el.classList.contains(`glr-stripe-${stripe}`),
        `post ${i} is stripe ${stripe}`,
      );
      assert.ok(
        el.querySelector(`.glr-arm.glr-stripe-${stripe}`),
        `post ${i} icon box carries stripe ${stripe}`,
      );
      assert.ok(
        el.querySelector(`.glr-band.glr-stripe-${stripe}`),
        `post ${i} body band carries stripe ${stripe}`,
      );
      assert.ok(
        el.querySelector(`.glr-connector.glr-stripe-${stripe}`),
        `post ${i} connector carries stripe ${stripe}`,
      );
    });

    // First-appearance logic, INCLUDING alt re-announcement: a post is --first
    // when its character name is new OR the previous occurrence of that name had
    // a different screenname/author. computeFullAppearances is the source of truth.
    const fulls = computeFullAppearances(posts);
    const expectedFirst = fulls.filter(Boolean).length;
    const firstCount = reader.querySelectorAll('.glr-post--first').length;
    assert.equal(firstCount, expectedFirst, 'first-appearance count == full appearances');
    // The class on each post matches the per-index decision.
    rendered.forEach((el, i) => {
      assert.equal(
        el.classList.contains('glr-post--first'),
        fulls[i],
        `post ${i} --first matches computeFullAppearances`,
      );
    });
    if (posts.length > 0) {
      assert.ok(rendered[0].classList.contains('glr-post--first'), 'first post is --first');
    }
    if (posts.length > expectedFirst) {
      assert.ok(
        reader.querySelector('.glr-post--repeat'),
        'has at least one condensed repeat',
      );
      // Repeats render a chip; firsts render a full identity.
      assert.ok(reader.querySelector('.glr-identity--full'), 'has a full identity');
      assert.ok(reader.querySelector('.glr-chip'), 'has a condensed chip');
    }

    // Every structural element we create is glr- scoped (ignore embedded body
    // markup which legitimately keeps the host page's own classes).
    const ours = [
      reader,
      ...Array.from(reader.querySelectorAll('.glr-post, .glr-arm, .glr-band, .glr-connector, .glr-body, .glr-identity, .glr-column')),
    ];
    for (const el of ours) {
      for (const cls of Array.from(el.classList)) {
        assert.ok(cls.startsWith('glr-'), `class ${cls} is glr- scoped`);
      }
    }

    // Purity: a second render of the same input yields identical markup.
    const again = renderReader(posts, { document: doc, theme: 'light' });
    assert.equal(again.outerHTML, reader.outerHTML, 'render is deterministic');
  });
}

// ---------------------------------------------------------------------------
// Absence variants (synthetic DOM covering every documented edge case)
// ---------------------------------------------------------------------------
test('absence variants: every edge case parses without throwing', () => {
  const html = `
    <div class="post-list">
      <!-- OP with icon, character, no screenname -->
      <div class="post-container post-post">
        <div class="padding-10"><div class="post-info-box">
          <div class="post-icon"><a href="/icons/1"><img src="https://cdn.example/op.png" alt="kw-op" title="kw-op" class="icon"></a></div>
          <div class="post-info-text">
            <div class="post-character"><a href="/characters/1">Captain</a></div>
            <div class="post-author"><a href="/users/1">Alice</a></div>
          </div></div>
          <div class="post-edit-box"><a rel="alternate" href="/posts/100">l</a></div>
          <div class="post-content"><p>OP body</p></div>
        </div>
      </div>
      <!-- paginated reply: a-wrapped, full identity -->
      <div class="post-container post-reply ">
        <a class="noheight" id="reply-201"> </a>
        <div class="padding-10"><div class="post-info-box">
          <div class="post-icon"><a href="/icons/2"><img src="https://cdn.example/2.webp" alt="kw2" title="kw2" class="icon"></a></div>
          <div class="post-info-text">
            <div class="post-character"><a href="/characters/2">Bo</a></div>
            <div class="post-screenname">bo-screen</div>
            <div class="post-author"><a href="/users/2">Bob</a></div>
          </div></div>
          <div class="post-edit-box"><a rel="alternate" href="/replies/201#reply-201">l</a></div>
          <div class="post-content"><p>Hi</p></div>
        </div>
      </div>
      <!-- iconless reply (no .post-icon at all) -->
      <div class="post-container post-reply">
        <a class="noheight" id="reply-202"> </a>
        <div class="padding-10"><div class="post-info-box">
          <div class="post-info-text">
            <div class="post-character">Bo</div>
            <div class="post-screenname">bo-screen</div>
            <div class="post-author">Bob</div>
          </div></div>
          <div class="post-content"><p>No icon here</p></div>
        </div>
      </div>
      <!-- author-only (spacer-alt), icon present -->
      <div class="post-container post-reply">
        <a class="noheight" id="reply-203"> </a>
        <div class="padding-10"><div class="post-info-box">
          <div class="post-icon"><img src="https://cdn.example/3.jpg" alt="kw3" title="kw3" class="icon"></div>
          <div class="post-info-text">
            <div class="spacer-alt"></div>
            <div class="post-author">diaeresis</div>
          </div></div>
          <div class="post-content"><p>OOC note</p></div>
        </div>
      </div>
      <!-- deleted character + deleted author + no screenname + no icon -->
      <div class="post-container post-reply">
        <a class="noheight" id="reply-204"> </a>
        <div class="padding-10"><div class="post-info-box">
          <div class="post-info-text">
            <div class="post-character">[Deleted]</div>
            <div class="post-author"><em>(deleted user)</em></div>
          </div></div>
          <div class="post-content"><p>gone</p></div>
        </div>
      </div>
      <!-- malicious body content must be neutralised on render -->
      <div class="post-container post-reply">
        <a class="noheight" id="reply-205"> </a>
        <div class="padding-10"><div class="post-info-box">
          <div class="post-icon"><img src="https://cdn.example/5.png" alt="" title="" class="icon"></div>
          <div class="post-info-text">
            <div class="post-character">Captain</div>
            <div class="post-author">Alice</div>
          </div></div>
          <div class="post-content"><p onclick="evil()">x</p><script>evil()</script><a href="javascript:evil()">bad</a></div>
        </div>
      </div>
    </div>`;
  const dom = domFor(html);
  const doc = dom.window.document;

  let posts: readonly Post[] = [];
  assert.doesNotThrow(() => {
    posts = parsePosts(doc);
  });
  assert.equal(posts.length, 6);

  const [op, reply1, iconless, authorOnly, deleted] = posts;

  assert.equal(op.isOP, true);
  assert.equal(op.screenname, null, 'OP has no screenname');
  assert.equal(op.id, '100', 'OP id derived from /posts/100 permalink');
  assert.equal(op.character, 'Captain');

  assert.equal(reply1.isOP, false);
  assert.equal(reply1.id, '201');
  assert.equal(reply1.iconUrl, 'https://cdn.example/2.webp');
  assert.equal(reply1.iconKeyword, 'kw2');
  assert.equal(reply1.screenname, 'bo-screen');

  assert.equal(iconless.iconUrl, null, 'iconless post has null iconUrl');
  assert.equal(iconless.iconKeyword, null);
  assert.equal(iconless.character, 'Bo', 'flat plain-text character parsed');

  assert.equal(authorOnly.character, null, 'spacer-alt => null character');
  assert.equal(authorOnly.author, 'diaeresis');
  assert.equal(authorOnly.iconUrl, 'https://cdn.example/3.jpg');

  assert.equal(deleted.character, '[Deleted]', 'deleted character text preserved');
  assert.equal(deleted.author, '(deleted user)', 'deleted author text preserved');
  assert.equal(deleted.screenname, null);
  assert.equal(deleted.iconUrl, null);

  // Render must not throw and must neutralise scripts / inline handlers.
  let reader!: HTMLElement;
  assert.doesNotThrow(() => {
    reader = renderReader(posts, { document: doc });
  });
  assert.equal(reader.querySelectorAll('.glr-post').length, 6);
  assert.equal(reader.querySelectorAll('script').length, 0, 'scripts stripped from body');
  const bad = reader.querySelector('.glr-content [onclick]');
  assert.equal(bad, null, 'inline handlers stripped');
  const badHref = Array.from(reader.querySelectorAll('.glr-content a')).find((a) =>
    /javascript:/i.test(a.getAttribute('href') ?? ''),
  );
  assert.equal(badHref, undefined, 'javascript: hrefs stripped');

  // Reader default theme is light.
  assert.equal(reader.getAttribute('data-theme'), 'light');

  // Author-only render still shows an identity (author chip/full).
  const authorOnlyArticle = reader.querySelector('.glr-identity--authoronly');
  assert.ok(authorOnlyArticle, 'author-only identity rendered');
});

// ---------------------------------------------------------------------------
// Change 1 — paginated reply pages (page 2+): a fragment with ONLY .post-reply
// containers and NO original post must still parse and render.
// ---------------------------------------------------------------------------
test('reply-only pagination: a fragment with no OP parses and renders', () => {
  const html = `
    <div class="post-list">
      <div class="post-container post-reply">
        <a class="noheight" id="reply-301"></a>
        <div class="post-info-box">
          <div class="post-icon"><img src="https://cdn.example/a.png" alt="ka" title="ka"></div>
          <div class="post-character">Ada</div>
          <div class="post-author">Author-A</div>
        </div>
        <div class="post-edit-box"><a rel="alternate" href="/replies/301#reply-301">l</a></div>
        <div class="post-content"><p>Reply on page two.</p></div>
      </div>
      <div class="post-container post-reply">
        <a class="noheight" id="reply-302"></a>
        <div class="post-info-box">
          <div class="post-icon"><img src="https://cdn.example/b.png" alt="kb" title="kb"></div>
          <div class="post-character">Ben</div>
          <div class="post-author">Author-B</div>
        </div>
        <div class="post-edit-box"><a rel="alternate" href="/replies/302#reply-302">l</a></div>
        <div class="post-content"><p>Another reply, still no OP.</p></div>
      </div>
    </div>`;
  const dom = domFor(html);
  const doc = dom.window.document;

  // No OP anywhere on this (paginated) page.
  assert.equal(doc.querySelector('.post-post'), null, 'fixture has no OP');

  const posts = parsePosts(doc);
  assert.equal(posts.length, 2, 'both replies parsed without an OP');
  assert.ok(posts.every((p) => !p.isOP), 'no post is flagged OP');
  assert.deepEqual(posts.map((p) => p.id), ['301', '302'], 'reply ids derived');

  let reader!: HTMLElement;
  assert.doesNotThrow(() => {
    reader = renderReader(posts, { document: doc, theme: 'dark' });
  }, 'renderReader must not throw on reply-only input');
  assert.equal(reader.querySelectorAll('.glr-post').length, 2, 'two posts rendered');
  assert.equal(reader.querySelectorAll('.glr-arm').length, 2, 'each post has an arm');
});

// ---------------------------------------------------------------------------
// Change 2 — the CRITICAL coloring rule: a gutter arm carries its OWN post's
// stripe, never the neighbour's. With alternating parity, post 0 (left, stripe a)
// and post 2 (left, stripe a) sit on the same side; the arm flowing through the
// gutter beside the right-side post 1 must stay stripe a — owned by its icon's
// post, not the text beside it.
// ---------------------------------------------------------------------------
test('gutter-arm tint follows the icon owner, not the adjacent text post', () => {
  const html = `
    <div class="post-list">
      <div class="post-container post-reply"><div class="post-character">L0</div>
        <div class="post-author">A0</div><div class="post-content"><p>left zero</p></div></div>
      <div class="post-container post-reply"><div class="post-character">R1</div>
        <div class="post-author">A1</div><div class="post-content"><p>right one</p></div></div>
      <div class="post-container post-reply"><div class="post-character">L2</div>
        <div class="post-author">A2</div><div class="post-content"><p>left two</p></div></div>
    </div>`;
  const dom = domFor(html);
  const doc = dom.window.document;
  const reader = renderReader(parsePosts(doc), { document: doc });

  const posts = Array.from(reader.querySelectorAll('.glr-post'));
  // Post 0: left + stripe a; its arm is in the LEFT gutter and is stripe a.
  assert.ok(posts[0].classList.contains('glr-post--left'));
  assert.ok(posts[0].querySelector('.glr-arm--left.glr-stripe-a'), 'post 0 arm: left, stripe a');
  // Post 1: right + stripe b; its arm is in the RIGHT gutter and is stripe b.
  assert.ok(posts[1].classList.contains('glr-post--right'));
  assert.ok(posts[1].querySelector('.glr-arm--right.glr-stripe-b'), 'post 1 arm: right, stripe b');
  // Post 2: left + stripe a again — the same gutter side as post 0, so post 0's
  // arm flows down past post 1 carrying stripe a the whole way.
  assert.ok(posts[2].querySelector('.glr-arm--left.glr-stripe-a'), 'post 2 arm: left, stripe a');

  // The left gutter only ever holds stripe-a arms; the right only stripe-b — so
  // no arm is ever tinted by the post whose TEXT is beside it.
  for (const arm of reader.querySelectorAll('.glr-arm--left')) {
    assert.ok(arm.classList.contains('glr-stripe-a'), 'every left arm is stripe a');
  }
  for (const arm of reader.querySelectorAll('.glr-arm--right')) {
    assert.ok(arm.classList.contains('glr-stripe-b'), 'every right arm is stripe b');
  }
});

// ---------------------------------------------------------------------------
// phase03 — Render-structure regression guard
// The mobile layout (reader.css @media max-width:640px) is CSS-only; the
// rendered DOM must be identical to desktop. These assertions lock in:
//   (a) each post's stripe class — the hook .glr-post.glr-stripe-{a|b} uses
//   (b) the desktop DOM structure the mobile CSS overrides reference
// ---------------------------------------------------------------------------
test('mobile CSS hooks: stripe classes and desktop DOM structure are intact', () => {
  const html = `
    <div class="post-list">
      <div class="post-container post-reply">
        <div class="post-character">Alice</div>
        <div class="post-author">Auth-A</div>
        <div class="post-content"><p>Post one.</p></div>
      </div>
      <div class="post-container post-reply">
        <div class="post-character">Bob</div>
        <div class="post-author">Auth-B</div>
        <div class="post-content"><p>Post two.</p></div>
      </div>
      <div class="post-container post-reply">
        <div class="post-character">Alice</div>
        <div class="post-author">Auth-A</div>
        <div class="post-content"><p>Post three.</p></div>
      </div>
    </div>`;
  const dom = domFor(html);
  const doc = dom.window.document;
  const reader = renderReader(parsePosts(doc), { document: doc });

  const articles = Array.from(reader.querySelectorAll('.glr-post'));
  assert.ok(articles.length >= 2, 'at least two posts rendered');

  // (a) Each post carries exactly one stripe class.
  for (const [i, article] of articles.entries()) {
    const hasA = article.classList.contains('glr-stripe-a');
    const hasB = article.classList.contains('glr-stripe-b');
    assert.ok(hasA !== hasB, `post ${i} carries exactly one of glr-stripe-a / glr-stripe-b`);
  }

  // Both stripe variants present (parity alternation).
  assert.ok(articles.some((el) => el.classList.contains('glr-stripe-a')), 'has glr-stripe-a post');
  assert.ok(articles.some((el) => el.classList.contains('glr-stripe-b')), 'has glr-stripe-b post');

  // (b) Desktop DOM structure is intact — mobile is CSS-only; no structural change expected.
  for (const [i, article] of articles.entries()) {
    assert.ok(article.querySelector('.glr-band'), `post ${i} has .glr-band`);
    assert.ok(article.querySelector('.glr-connector'), `post ${i} has .glr-connector`);
    const arm = article.querySelector('.glr-arm');
    assert.ok(arm, `post ${i} has .glr-arm`);
    assert.ok(arm!.querySelector('.glr-icon-box'), `post ${i} .glr-arm contains .glr-icon-box`);
    const body = article.querySelector('.glr-body');
    assert.ok(body, `post ${i} has .glr-body`);
    assert.ok(body!.querySelector('.glr-identity'), `post ${i} .glr-body contains .glr-identity`);
    assert.ok(body!.querySelector('.glr-content'), `post ${i} .glr-body contains .glr-content`);
  }
});

test('defensive: empty / containerless roots return an empty frozen array', () => {
  const dom = domFor('<div>nothing here</div>');
  const posts = parsePosts(dom.window.document);
  assert.equal(posts.length, 0);
  assert.ok(Object.isFrozen(posts));

  const frag = domFor('').window.document.createDocumentFragment();
  assert.equal(parsePosts(frag).length, 0);
});

test('renderReader throws clearly when no document is available', () => {
  // No options.document and no ambient document in this Node context.
  assert.throws(
    () => renderReader([], {}),
    /no document available/,
    'must not silently no-op',
  );
});

// ---------------------------------------------------------------------------
// computeFullAppearances — full-identity vs condensed, incl. alt re-announcement
// ---------------------------------------------------------------------------

/** Minimal Post factory for identity tests (only identity fields matter here). */
function post(
  character: string | null,
  screenname: string | null,
  author: string,
): Post {
  return Object.freeze({
    id: `${character ?? '-'}/${screenname ?? '-'}/${author}`,
    isOP: false,
    iconUrl: null,
    iconKeyword: null,
    character,
    screenname,
    author,
    bodyHtml: '',
    permalink: null,
  });
}

test('computeFullAppearances: first occurrence is full, identical repeats condense', () => {
  const posts = [
    post('Alice', 'screen', 'Auth'),
    post('Alice', 'screen', 'Auth'),
    post('Alice', 'screen', 'Auth'),
  ];
  assert.deepEqual(computeFullAppearances(posts), [true, false, false]);
});

test('computeFullAppearances: a changed SCREENNAME re-announces (alt)', () => {
  const posts = [
    post('Carissa Sevar', 'to-let-you-in', 'lintamande'),
    post('Carissa Sevar', 'loves-her-strings', 'lintamande'),
    post('Carissa Sevar', 'loves-her-strings', 'lintamande'),
  ];
  assert.deepEqual(computeFullAppearances(posts), [true, true, false]);
});

test('computeFullAppearances: a changed AUTHOR re-announces (alt)', () => {
  const posts = [
    post('Shared Name', 'a', 'AuthorOne'),
    post('Shared Name', 'a', 'AuthorTwo'),
  ];
  assert.deepEqual(computeFullAppearances(posts), [true, true]);
});

test('computeFullAppearances: alternating alts re-announce every time (vs PREVIOUS)', () => {
  // The comparison is against the most recent occurrence, not the whole history,
  // so A/B/A/B flags a full appearance on every post.
  const posts = [
    post('Carissa Sevar', 'to-let-you-in', 'lintamande'),
    post('Carissa Sevar', 'loves-her-strings', 'lintamande'),
    post('Carissa Sevar', 'to-let-you-in', 'lintamande'),
    post('Carissa Sevar', 'loves-her-strings', 'lintamande'),
  ];
  assert.deepEqual(computeFullAppearances(posts), [true, true, true, true]);
});

test('computeFullAppearances: a different character interleaved does not condense the return', () => {
  const posts = [
    post('Alice', 's', 'A'), // full (new)
    post('Bob', 's', 'B'), // full (new)
    post('Alice', 's', 'A'), // condensed — Alice unchanged since her last post
  ];
  assert.deepEqual(computeFullAppearances(posts), [true, true, false]);
});

test('computeFullAppearances: author-only posts key on the author alone', () => {
  const posts = [
    post(null, null, 'Narrator'), // full (new author-only)
    post(null, null, 'Narrator'), // condensed
    post(null, null, 'Other'), // full (new author)
    post(null, null, 'Narrator'), // condensed again (unchanged since last)
  ];
  assert.deepEqual(computeFullAppearances(posts), [true, false, true, false]);
});

test('computeFullAppearances: a name and an author-only post that share a string do not collide', () => {
  // A character literally named "Narrator" must not share identity state with an
  // author-only post by author "Narrator".
  const posts = [
    post(null, null, 'Narrator'), // author-only Narrator → full
    post('Narrator', 's', 'Someone'), // a CHARACTER named Narrator → full (distinct)
    post(null, null, 'Narrator'), // author-only again → condensed (unchanged)
  ];
  assert.deepEqual(computeFullAppearances(posts), [true, true, false]);
});

test('computeFullAppearances: length matches and input is not mutated', () => {
  const posts = [post('A', 's', 'X'), post('A', 't', 'X')];
  const snapshot = JSON.stringify(posts);
  const out = computeFullAppearances(posts);
  assert.equal(out.length, posts.length);
  assert.equal(JSON.stringify(posts), snapshot, 'inputs untouched');
});

test('fixture alts: the alternating-screenname character re-announces each switch', () => {
  const html = readFileSync(join(fixturesDir, 'alts.html'), 'utf8');
  const posts = parsePosts(domFor(html).window.document);
  const fulls = computeFullAppearances(posts);

  // "Carissa Sevar" flips between two screennames on nearly every post, so each
  // of her appearances after a switch must be full, not condensed — meaning the
  // number of full appearances far exceeds the 4 distinct character names.
  const distinctNames = new Set(posts.map((p) => p.character ?? ` ${p.author}`));
  assert.ok(
    fulls.filter(Boolean).length > distinctNames.size,
    'alts cause more full appearances than there are distinct names',
  );

  // Specifically: every Carissa post whose screenname differs from her previous
  // Carissa post is flagged full.
  let prevScreen: string | null | undefined;
  posts.forEach((p, i) => {
    if (p.character !== 'Carissa Sevar') return;
    if (prevScreen !== undefined && p.screenname !== prevScreen) {
      assert.equal(fulls[i], true, `Carissa post ${i} re-announces on screenname switch`);
    }
    prevScreen = p.screenname;
  });
});
