// Headless tests for reader-core, run via tsx + node:test with jsdom.
// This is the in-pipeline proxy for "the reader renders": we parse every real
// fixture and assert the model, then render and assert the layout structure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';

import { parsePosts, renderReader } from '../src/reader-core/index.js';
import type { FixtureMeta, Post } from '../src/reader-core/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, '..', 'fixtures');

const manifest: FixtureMeta[] = JSON.parse(
  readFileSync(join(fixturesDir, 'manifest.json'), 'utf8'),
);

function domFor(html: string): JSDOM {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
}

function identityKey(p: Post): string {
  return `${p.character ?? ''} ${p.author}`;
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
      assert.ok(el.querySelector('.glr-icon-cell'), `post ${i} has icon cell`);
      assert.ok(el.querySelector('.glr-body'), `post ${i} has body`);
      assert.ok(el.querySelector('.glr-content'), `post ${i} has content`);
    });

    // First-appearance logic: first occurrence of each identity is --first.
    const distinct = new Set(posts.map(identityKey));
    const firstCount = reader.querySelectorAll('.glr-post--first').length;
    assert.equal(firstCount, distinct.size, 'first-appearance count == distinct identities');
    if (posts.length > 0) {
      assert.ok(rendered[0].classList.contains('glr-post--first'), 'first post is --first');
    }
    if (posts.length > distinct.size) {
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
      ...Array.from(reader.querySelectorAll('.glr-post, .glr-icon-cell, .glr-body, .glr-identity, .glr-column')),
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
