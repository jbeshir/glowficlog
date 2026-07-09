// parsePosts: turn a DOM subtree containing `.post-container` elements into an
// immutable Post[]. Works for BOTH glowfic DOM shapes:
//   - flat view  (?view=flat): character/author are plain text, icon img has no <a>
//   - paginated view: character/author/icon wrapped in <a>
// Every field is null-guarded; malformed or absent markup yields nulls, never throws.

import type { Post, PostAction } from './types.js';
import { renderedPostContainers } from './dom.js';

/** Collapse internal whitespace and trim; return null for empty results. */
function cleanText(node: Element | null | undefined): string | null {
  if (!node) return null;
  const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

/** Character/author live as `<div class="x"><a>..</a></div>` (paginated) or as
 *  plain text (flat) or as deleted markup. Prefer the inner link, fall back to
 *  the container's own text. */
function fieldText(container: Element, selector: string): string | null {
  const box = container.querySelector(selector);
  if (!box) return null;
  return cleanText(box.querySelector('a')) ?? cleanText(box);
}

/** True when `match` is a real element that is NOT a descendant of `content`.
 *  `.post-content` is untrusted page-author HTML, so chrome-derived queries
 *  (edit-box, noheight anchor, permalink) must reject matches found inside it —
 *  those are forged markup, not the genuine site-rendered chrome. */
function outsideContent(match: Element | null, content: Element | null): match is Element {
  return !!match && !(content?.contains(match) ?? false);
}

function deriveId(
  container: Element,
  index: number,
  permalink: string | null,
  content: Element | null,
): string {
  // Replies carry `<a class="noheight" id="reply-{n}">`; ignore a forged copy
  // living inside untrusted `.post-content`. Require at least one digit after the
  // prefix so a malformed bare `id="reply-"` (slice → "") falls through to the
  // safe positional id below instead of yielding an empty string.
  const anchor = container.querySelector('a.noheight');
  const anchorId = outsideContent(anchor, content) ? anchor?.id : undefined;
  if (anchorId && /^reply-\d/.test(anchorId)) {
    return anchorId.slice('reply-'.length);
  }
  // OP has no noheight anchor; its permalink is `/posts/{n}`.
  if (permalink) {
    const m = permalink.match(/\/(?:posts|replies)\/(\d+)/);
    if (m) return m[1];
  }
  // Last resort: positional, stable within a single parse.
  return `pos-${index}`;
}

/** Fallback label used when an action has neither an icon title/alt nor link text. */
function defaultLabelForKind(kind: PostAction['kind']): string {
  switch (kind) {
    case 'permalink':
      return 'Permalink';
    case 'unread':
      return 'Mark Unread';
    case 'bookmark':
      return 'Bookmark';
    default:
      return 'Action';
  }
}

/** Scrape the `.post-edit-box` anchors (permalink/mark-unread/bookmark/etc) into
 *  immutable PostAction entries. Anchors without a usable href are skipped;
 *  everything else is null-guarded so malformed markup never throws. A
 *  `.post-edit-box` found inside untrusted `.post-content` is forged and
 *  treated as absent. */
function deriveActions(container: Element, content: Element | null): readonly PostAction[] {
  const editBox = container.querySelector('.post-edit-box');
  if (!outsideContent(editBox, content)) return Object.freeze([]);

  const anchors = Array.from(editBox.querySelectorAll('a'));
  const actions: PostAction[] = [];
  for (const anchor of anchors) {
    const href = anchor.getAttribute('href');
    if (!href) continue;

    const method = anchor.getAttribute('data-method');
    const rel = anchor.getAttribute('rel');
    const img = anchor.querySelector('img');
    const iconUrl = img?.getAttribute('src') ?? null;
    const rawLabel =
      img?.getAttribute('title') ?? img?.getAttribute('alt') ?? cleanText(anchor);

    const kind: PostAction['kind'] = rel?.includes('alternate')
      ? 'permalink'
      : href.includes('unread=') || /unread/i.test(rawLabel ?? '')
        ? 'unread'
        : /bookmark/i.test(href) || /bookmark/i.test(rawLabel ?? '')
          ? 'bookmark'
          : 'other';

    const label = rawLabel ?? defaultLabelForKind(kind);

    actions.push(
      Object.freeze({
        kind,
        label,
        href,
        method,
        rel,
        iconUrl,
      }),
    );
  }

  return Object.freeze(actions);
}

/**
 * Parse all `.post-container` descendants of `root` into immutable Post objects.
 *
 * @param root A ParentNode containing zero or more `.post-container` elements
 *             (the live document, a `.post-list`, or a detached fixture fragment).
 */
export function parsePosts(root: ParentNode): readonly Post[] {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return Object.freeze([]);
  }

  // RENDERED containers only: the reader must mirror exactly the posts the page
  // shows, so the collapsed page-2 OP (inside `.post-expander > .hidden`) is
  // skipped while the page-1 visible OP is kept — the same set the content
  // script hides on mount.
  const containers = renderedPostContainers(root);
  const posts: Post[] = containers.map((container, index) => {
    const isOP = container.classList.contains('post-post');

    // Icon: `.post-icon img` (img absent entirely when the post has no icon).
    const iconImg = container.querySelector('.post-icon img');
    const iconUrl = iconImg?.getAttribute('src') ?? null;
    const iconKeyword =
      iconImg?.getAttribute('title') ?? iconImg?.getAttribute('alt') ?? null;

    // Character: null for author-only posts (which show `.spacer-alt` instead).
    // Keep literal "[Deleted]" so callers can render it intentionally.
    const character = fieldText(container, '.post-character');
    const screenname = cleanText(container.querySelector('.post-screenname'));
    // Author is always present in well-formed markup; default to '' defensively.
    const author = fieldText(container, '.post-author') ?? '';

    const content = container.querySelector('.post-content');
    const bodyHtml = content ? content.innerHTML : '';

    // A `.post-edit-box a[rel="alternate"]` found inside untrusted `.post-content`
    // is forged and treated as absent.
    const permalinkAnchor = container.querySelector('.post-edit-box a[rel="alternate"]');
    const permalink = outsideContent(permalinkAnchor, content)
      ? (permalinkAnchor?.getAttribute('href') ?? null)
      : null;

    // Server-rendered "linked/unread here" marker (e.g. from a #reply-N anchor
    // or the site's own unread tracking) — carried verbatim as a class on the
    // source container.
    const highlighted = container.classList.contains('reply-highlighted');
    const actions = deriveActions(container, content);

    const post: Post = {
      id: deriveId(container, index, permalink, content),
      isOP,
      iconUrl,
      iconKeyword,
      character,
      screenname,
      author,
      bodyHtml,
      permalink,
      highlighted,
      actions,
    };
    return Object.freeze(post);
  });

  return Object.freeze(posts);
}
