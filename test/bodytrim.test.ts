// Tests for the post-body edge trimming: the blank-node classifier
// (isBlankNode) and the edge trimmer (trimBlankEdges), plus the renderReader
// integration that the trimBlankEdges option drives it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';

import { isBlankNode, trimBlankEdges, renderReader, parsePosts } from '../src/reader-core/index.js';

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const doc = dom.window.document;

/** Build a detached <div> with the given inner HTML. */
function frag(html: string): HTMLElement {
  const div = doc.createElement('div');
  div.innerHTML = html;
  return div;
}

const NBSP = '\u00a0';
const ZWSP = '\u200b';

// ---------------------------------------------------------------------------
// isBlankNode
// ---------------------------------------------------------------------------

test('isBlankNode: whitespace text (incl. nbsp / zero-width / unicode spaces) is blank', () => {
  for (const s of ['', '   ', '\n\t ', NBSP, NBSP + NBSP, ZWSP, ' \u3000', '\n' + NBSP + '\t']) {
    assert.equal(isBlankNode(doc.createTextNode(s)), true, JSON.stringify(s));
  }
});

test('isBlankNode: text with any real character is not blank', () => {
  assert.equal(isBlankNode(doc.createTextNode('x')), false);
  assert.equal(isBlankNode(doc.createTextNode('  hi  ')), false);
});

test('isBlankNode: a comment is blank', () => {
  assert.equal(isBlankNode(doc.createComment(' note ')), true);
});

test('isBlankNode: <br> and empty/whitespace elements are blank', () => {
  assert.equal(isBlankNode(frag('<br>').firstChild as Node), true);
  assert.equal(isBlankNode(frag('<p></p>').firstChild as Node), true);
  assert.equal(isBlankNode(frag('<p>&nbsp;</p>').firstChild as Node), true);
  assert.equal(isBlankNode(frag('<p><br></p>').firstChild as Node), true);
  assert.equal(isBlankNode(frag('<div>\n   </div>').firstChild as Node), true);
  assert.equal(isBlankNode(frag('<div><p>&nbsp;</p><br></div>').firstChild as Node), true);
});

test('isBlankNode: elements with real content are not blank', () => {
  assert.equal(isBlankNode(frag('<p>hi</p>').firstChild as Node), false);
  assert.equal(isBlankNode(frag('<div><p>x</p></div>').firstChild as Node), false);
});

test('isBlankNode: replaced/visible elements are never blank even when empty', () => {
  for (const tag of ['img', 'hr', 'video', 'iframe', 'table']) {
    assert.equal(isBlankNode(frag(`<${tag}>`).firstChild as Node), false, tag);
  }
});

// ---------------------------------------------------------------------------
// trimBlankEdges
// ---------------------------------------------------------------------------

function trimmed(html: string): string {
  const el = frag(html);
  trimBlankEdges(el);
  return el.innerHTML;
}

test('trimBlankEdges: removes leading and trailing empty paragraphs', () => {
  assert.equal(trimmed('<p></p><p>Real</p>'), '<p>Real</p>');
  assert.equal(trimmed('<p>Real</p><p>&nbsp;</p>'), '<p>Real</p>');
  assert.equal(trimmed('<p></p><p>&nbsp;</p><p>Real</p><p><br></p>'), '<p>Real</p>');
});

test('trimBlankEdges: strips leading/trailing <br> inside the first/last block', () => {
  assert.equal(trimmed('<p><br><br>Hi</p>'), '<p>Hi</p>');
  assert.equal(trimmed('<p>Hi<br><br></p>'), '<p>Hi</p>');
  assert.equal(trimmed('<p><br>Hi<br></p>'), '<p>Hi</p>');
});

test('trimBlankEdges: removes whitespace-only text nodes at the edges', () => {
  assert.equal(trimmed('\n  <p>Hi</p>\n  '), '<p>Hi</p>');
  assert.equal(trimmed(`${NBSP}<p>Hi</p>${NBSP}`), '<p>Hi</p>');
});

test('trimBlankEdges: keeps blank lines BETWEEN content (only edges are trimmed)', () => {
  assert.equal(trimmed('<p>A</p><p></p><p>B</p>'), '<p>A</p><p></p><p>B</p>');
  assert.equal(trimmed('<p>A<br><br>B</p>'), '<p>A<br><br>B</p>');
});

test('trimBlankEdges: a wholly blank body collapses to empty', () => {
  assert.equal(trimmed('<p></p><p>&nbsp;</p><br>\n  '), '');
});

test('trimBlankEdges: descends through nested wrappers at the edges', () => {
  assert.equal(trimmed('<div><p></p><p>Hi</p></div>'), '<div><p>Hi</p></div>');
  assert.equal(trimmed('<blockquote><br>Quote<br></blockquote>'), '<blockquote>Quote</blockquote>');
});

test('trimBlankEdges: never removes visible content at the edge', () => {
  assert.equal(trimmed('<img src="x"><p>Hi</p>'), '<img src="x"><p>Hi</p>');
  assert.equal(trimmed('Hello<p>x</p>'), 'Hello<p>x</p>');
});

test('trimBlankEdges: a tidy body is unchanged', () => {
  assert.equal(trimmed('<p>One</p><p>Two</p>'), '<p>One</p><p>Two</p>');
});

// ---------------------------------------------------------------------------
// renderReader integration: the trimBlankEdges option
// ---------------------------------------------------------------------------

function postHtml(body: string): string {
  return `<div class="post-list"><div class="post-container post-reply">
    <a class="noheight" id="reply-1"></a>
    <div class="post-icon"><img src="https://cdn.example/i.png" alt="k" title="k"></div>
    <div class="post-character">Char</div><div class="post-author">Auth</div>
    <div class="post-content">${body}</div>
  </div></div>`;
}

function contentHtmlFor(body: string, trimBlankEdgesOpt: boolean): string {
  const d = new JSDOM(`<!DOCTYPE html><html><body>${postHtml(body)}</body></html>`).window.document;
  const reader = renderReader(parsePosts(d), { document: d, trimBlankEdges: trimBlankEdgesOpt });
  return (reader.querySelector('.glr-content') as HTMLElement).innerHTML;
}

test('renderReader: trimBlankEdges option trims post body edges when on', () => {
  assert.equal(contentHtmlFor('<p></p><p>Hello</p><p><br></p>', true), '<p>Hello</p>');
});

test('renderReader: body is left intact when the option is off (default)', () => {
  const body = '<p></p><p>Hello</p><p><br></p>';
  assert.equal(contentHtmlFor(body, false), body);
  // Default (option omitted) also leaves it intact.
  const d = new JSDOM(`<!DOCTYPE html><html><body>${postHtml(body)}</body></html>`).window.document;
  const reader = renderReader(parsePosts(d), { document: d });
  assert.equal((reader.querySelector('.glr-content') as HTMLElement).innerHTML, body);
});

// ---------------------------------------------------------------------------
// Real-fixture regression: the blank-lines thread (posts/53995 p5)
// ---------------------------------------------------------------------------

/** Does a content box begin or end with a blank node (a blank edge)? */
function hasBlankEdge(content: Element): boolean {
  return (
    (content.firstChild != null && isBlankNode(content.firstChild)) ||
    (content.lastChild != null && isBlankNode(content.lastChild))
  );
}

test('fixture blank-lines: real blank edges are present untrimmed and gone after trim', () => {
  const html = readFileSync(join(fixturesDir, 'blank-lines.html'), 'utf8');
  const contents = (trim: boolean): Element[] => {
    const d = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`).window.document;
    const reader = renderReader(parsePosts(d), { document: d, trimBlankEdges: trim });
    return Array.from(reader.querySelectorAll('.glr-content'));
  };
  assert.ok(
    contents(false).some(hasBlankEdge),
    'the real page genuinely has blank-edge posts (untrimmed)',
  );
  assert.ok(
    contents(true).every((c) => !hasBlankEdge(c)),
    'no blank edges remain once trimming is on',
  );
});
