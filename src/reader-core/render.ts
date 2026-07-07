// renderReader: pure transform from Post[] to a fresh, detached DOM subtree
// implementing the glowficlog reader layout. No global state, no mutation of the
// input. The same posts + options always produce the same structure.
//
// Layout (see project brief / spec v4): one continuous centred column of post
// bodies. Each post owns a subtle STRIPE tint (A/B by index parity) painted as
// three connected pieces that read as one region:
//   - a COMPACT icon BOX (the `.glr-arm`): the icon image plus a small symmetric
//     padding, top-aligned with the post's first line. It is sized to icon+pad
//     only — it never flows down to the next icon.
//   - a thin CONNECTOR: the short horizontal stroke joining the icon box to the
//     body (the spec's "L" laid on its side).
//   - the BODY tint (the `.glr-band`): the rounded rectangle behind the text.
// Posts ALTERNATE side per post, so adjacent blocks sit on opposite gutters and
// differ in tint. `layoutIcons` sizes the icon (cap-primary, shrinking only to
// avoid same-side overlap). The FIRST appearance of a character+author identity
// shows full identity, repeats show a condensed chip. All structural classes are
// `glr-` prefixed.

import type { Post, RenderOptions } from './types.js';
import { trimBlankEdges } from './bodytrim.js';

const NS = 'glr';

/** Resolve the document to build with: explicit option wins, else ambient. */
function resolveDocument(options: RenderOptions): Document {
  if (options.document) return options.document;
  const ambient = (globalThis as { document?: Document }).document;
  if (ambient) return ambient;
  throw new Error('renderReader: no document available (pass options.document)');
}

function el(
  doc: Document,
  tag: string,
  className?: string,
  text?: string,
): HTMLElement {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * PURE: decide, per post in order, whether it shows its FULL identity (character
 * · screenname · author) as a "first appearance", or a condensed name chip.
 *
 * A post shows the full identity when:
 *   - its character name has not appeared yet, OR
 *   - the MOST RECENT previous post with the same character name had a different
 *     screenname OR author.
 *
 * The second clause is the alt rule: glowfic authors share a character name
 * across alts that differ only by screenname/author, so whenever the writer
 * behind a name changes we re-announce the full identity (then condense again
 * while it stays the same), and re-announce once more if a still-earlier alt
 * takes the name back. Comparison is against the PREVIOUS occurrence, not the
 * whole history, so an alt hand-off is always flagged.
 *
 * Author-only posts (no character) key on the author alone — they have no
 * character/screenname to vary, so the first is full and the rest condense, as
 * before. The `\u0000` separator (a source-level escape, so the file stays text)
 * cannot occur in real names, so keys never collide. Inputs never mutated.
 */
export function computeFullAppearances(posts: readonly Post[]): boolean[] {
  const lastSeen = new Map<string, string>();
  return posts.map((post) => {
    const primary =
      post.character != null ? `c\u0000${post.character}` : `a\u0000${post.author}`;
    const secondary = `${post.screenname ?? ''}\u0000${post.author}`;
    const prev = lastSeen.get(primary);
    lastSeen.set(primary, secondary);
    return prev === undefined || prev !== secondary;
  });
}

/** Human-readable full identity, used for titles/tooltips on condensed repeats. */
function fullIdentityLabel(post: Post): string {
  const name = post.character ?? '(no character)';
  const screen = post.screenname ? ` · ${post.screenname}` : '';
  return post.author ? `${name}${screen} — ${post.author}` : `${name}${screen}`;
}

/** Best single-glyph stand-in for an iconless post's gutter. */
function initialFor(post: Post): string {
  const src = post.character ?? post.author ?? '?';
  const ch = src.replace(/[^\p{L}\p{N}]/u, '').charAt(0) || src.charAt(0) || '?';
  return ch.toUpperCase();
}

/**
 * Build the post body node from raw HTML using the injected document. The markup
 * is the glowfic.com page's own already-rendered, same-origin content (or a saved
 * fixture in the dev harness), so the reader re-displays it as-is: re-inserting it
 * runs nothing the page did not already run, and `innerHTML` never executes
 * `<script>`. The only transform is the optional blank-edge trim.
 */
function buildBody(doc: Document, bodyHtml: string, trim: boolean): HTMLElement {
  const body = el(doc, 'div', `${NS}-content`);
  body.innerHTML = bodyHtml;
  // Optionally drop whitespace-only lines from the top/bottom of the post.
  if (trim) trimBlankEdges(body);
  return body;
}

/** Monogram stand-in: a filled initial used for iconless posts AND as the
 *  graceful fallback when an icon image fails to load (broken/blocked/offline). */
function buildMonogram(doc: Document, post: Post, title: string): HTMLElement {
  const mono = el(doc, 'span', `${NS}-icon-mono`, initialFor(post));
  mono.title = title;
  return mono;
}

/**
 * Build the post's COMPACT tinted icon box (`.glr-arm`): the icon image wrapped
 * in a small symmetric padding (`--glr-icon-pad`), carrying the post's own
 * stripe tint. It is absolutely placed in the post's gutter, hugging the text
 * column and top-aligned with the post's first line; it is sized to icon+pad
 * only and never flows down past the post. The `--side`/`--stripe` classes are
 * retained so the box's owner and gutter are identifiable in the DOM and so the
 * gutter is always tinted by the post whose icon occupies it.
 */
function buildArm(
  doc: Document,
  post: Post,
  side: 'left' | 'right',
  stripe: 'a' | 'b',
): HTMLElement {
  const arm = el(
    doc,
    'div',
    `${NS}-arm ${NS}-arm--${side} ${NS}-stripe-${stripe}`,
  );
  const title = post.iconKeyword
    ? `${post.iconKeyword} — ${fullIdentityLabel(post)}`
    : fullIdentityLabel(post);

  // The icon sits inside the box's padding and is sized (post-insert) by
  // layoutIcons, which fits it to its gutter preserving aspect ratio; renderReader
  // stays layout-free and emits it at the CSS min size. The monogram, when shown,
  // occupies the (square) box exactly as the image would.
  const box = el(doc, 'div', `${NS}-icon-box`);

  if (post.iconUrl) {
    const img = el(doc, 'img', `${NS}-icon`) as HTMLImageElement;
    img.src = post.iconUrl;
    img.alt = post.iconKeyword ?? post.character ?? post.author ?? '';
    img.title = title;
    img.loading = 'lazy';
    img.decoding = 'async';
    // The full-size hover preview is a single floating element managed by
    // enableIconPreviews() (Fix 5) — not a per-post node — so it doesn't bloat
    // the markup or get clipped by an ancestor's overflow.
    // Broken/blocked icons (and offline screenshots) degrade to the monogram.
    // Set as a property (not an attribute) so it never appears in serialized
    // markup — renderReader stays deterministic across identical inputs.
    img.onerror = (): void => {
      box.replaceChildren(buildMonogram(doc, post, title));
    };
    box.appendChild(img);
  } else {
    box.appendChild(buildMonogram(doc, post, title));
  }

  arm.appendChild(box);

  // Portrait action menu: only when the post scraped edit-box actions
  // (mark unread here, bookmark, etc — `.post-edit-box` links). The trigger
  // attributes on the icon box and the menu markup below are static/ARIA-only;
  // renderReader stays pure, so the actual open/close toggling of
  // aria-expanded/hidden is wired by the content script in a later phase.
  if (post.actions.length > 0) {
    const menuId = `${NS}-actions-${post.id}`;

    box.classList.add(`${NS}-icon-box--menu`);
    box.setAttribute('role', 'button');
    box.setAttribute('tabindex', '0');
    box.setAttribute('aria-haspopup', 'menu');
    box.setAttribute('aria-expanded', 'false');
    box.setAttribute('aria-controls', menuId);
    box.title = 'Post actions';

    const menu = el(doc, 'div', `${NS}-actions`);
    menu.id = menuId;
    menu.setAttribute('role', 'menu');
    // Present from the start: the menu is closed until the content script's
    // toggle handler reveals it, so the very first paint must already match.
    menu.hidden = true;

    for (const action of post.actions) {
      const link = el(doc, 'a', `${NS}-action`) as HTMLAnchorElement;
      link.setAttribute('role', 'menuitem');
      link.href = action.href;
      if (action.method != null) link.setAttribute('data-method', action.method);
      if (action.rel != null) link.rel = action.rel;
      link.title = action.label;

      if (action.iconUrl) {
        const icon = el(doc, 'img', `${NS}-action-icon`) as HTMLImageElement;
        icon.src = action.iconUrl;
        icon.alt = '';
        icon.setAttribute('aria-hidden', 'true');
        link.appendChild(icon);
      }
      link.appendChild(el(doc, 'span', `${NS}-action-label`, action.label));

      menu.appendChild(link);
    }

    arm.appendChild(menu);
  }

  return arm;
}

function buildIdentity(doc: Document, post: Post, isFirst: boolean): HTMLElement {
  const id = el(
    doc,
    'div',
    `${NS}-identity ${isFirst ? `${NS}-identity--full` : `${NS}-identity--chip`}`,
  );

  if (isFirst) {
    // Full identity: character (or author for author-only) + screenname + author.
    const headline = post.character ?? post.author;
    id.appendChild(el(doc, 'span', `${NS}-char`, headline));
    if (post.character && post.screenname) {
      id.appendChild(el(doc, 'span', `${NS}-screen`, post.screenname));
    }
    if (post.character && post.author) {
      id.appendChild(el(doc, 'span', `${NS}-author`, post.author));
    }
    if (!post.character) {
      id.classList.add(`${NS}-identity--authoronly`);
    }
  } else {
    // Condensed: just a character (or author) chip; full identity on hover.
    const chip = el(doc, 'span', `${NS}-chip`, post.character ?? post.author);
    chip.title = fullIdentityLabel(post);
    id.appendChild(chip);
  }

  if (post.permalink) {
    const link = el(doc, 'a', `${NS}-permalink`, '#') as HTMLAnchorElement;
    link.href = post.permalink;
    link.title = 'Permalink to this post';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    id.appendChild(link);
  }
  return id;
}

/**
 * Render `posts` into a new detached subtree. The returned element is not
 * attached to any document; the caller decides where (if anywhere) to insert it.
 */
export function renderReader(
  posts: readonly Post[],
  options: RenderOptions = {},
): HTMLElement {
  const doc = resolveDocument(options);
  const theme = options.theme ?? 'light';
  const trim = options.trimBlankEdges ?? false;

  const root = el(doc, 'div', `${NS}-reader`);
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-glr-version', '1');

  const column = el(doc, 'div', `${NS}-column`);
  root.appendChild(column);

  // Full-identity vs condensed decision per post, including alt re-announcement
  // (a character name returning under a different screenname/author re-shows the
  // full identity). Drives both the identity block and the --first/--repeat class.
  const fullAppearance = computeFullAppearances(posts);

  posts.forEach((post, index) => {
    const isFirst = fullAppearance[index];

    // Side and stripe alternate together by index parity, so adjacent posts
    // differ on BOTH and their L-blocks interlock.
    const side = index % 2 === 0 ? 'left' : 'right';
    const stripe = index % 2 === 0 ? 'a' : 'b';
    const article = el(
      doc,
      'article',
      `${NS}-post ${NS}-post--${side} ${NS}-stripe-${stripe} ${isFirst ? `${NS}-post--first` : `${NS}-post--repeat`}`,
    );
    if (post.isOP) article.classList.add(`${NS}-post--op`);
    // Server-rendered "linked/unread here" marker (glowfic's `.reply-highlighted`),
    // scraped straight through onto the post — a static flag, not a live unread
    // state, so it needs no listener to stay correct.
    if (post.highlighted) {
      article.classList.add(`${NS}-post--linked`);
      article.setAttribute('data-glr-linked', '1');
    }
    article.setAttribute('data-post-id', post.id);
    article.setAttribute('data-author', post.author);
    article.setAttribute('data-stripe', stripe);
    if (post.character) article.setAttribute('data-character', post.character);

    // Three tinted pieces, all carrying the post's stripe, read as one region:
    // the BAND (the rounded rectangle behind the text body), the CONNECTOR (a
    // thin horizontal stroke bridging the icon box to the band), and the compact
    // icon BOX (`.glr-arm`, holding the icon). The BODY (text) paints above the
    // band so its full-contrast text is never dimmed by the tint.
    const band = el(doc, 'div', `${NS}-band ${NS}-stripe-${stripe}`);
    band.setAttribute('aria-hidden', 'true');
    article.appendChild(band);
    const connector = el(doc, 'div', `${NS}-connector ${NS}-stripe-${stripe}`);
    connector.setAttribute('aria-hidden', 'true');
    article.appendChild(connector);
    article.appendChild(buildArm(doc, post, side, stripe));

    const body = el(doc, 'div', `${NS}-body`);
    body.appendChild(buildIdentity(doc, post, isFirst));
    body.appendChild(buildBody(doc, post.bodyHtml, trim));
    article.appendChild(body);

    column.appendChild(article);
  });

  return root;
}
