// parsePosts: turn a DOM subtree containing `.post-container` elements into an
// immutable Post[]. Works for BOTH glowfic DOM shapes (see /in/glowfic-dom.md):
//   - flat view  (?view=flat): character/author are plain text, icon img has no <a>
//   - paginated view: character/author/icon wrapped in <a>
// Every field is null-guarded; malformed or absent markup yields nulls, never throws.

import type { Post } from './types.js';
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

function deriveId(container: Element, index: number, permalink: string | null): string {
  // Replies carry `<a class="noheight" id="reply-{n}">`. Require at least one digit
  // after the prefix so a malformed bare `id="reply-"` (slice → "") falls through to
  // the safe positional id below instead of yielding an empty string.
  const anchorId = container.querySelector('a.noheight')?.id;
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

    const permalink =
      container
        .querySelector('.post-edit-box a[rel="alternate"]')
        ?.getAttribute('href') ?? null;

    const post: Post = {
      id: deriveId(container, index, permalink),
      isOP,
      iconUrl,
      iconKeyword,
      character,
      screenname,
      author,
      bodyHtml,
      permalink,
    };
    return Object.freeze(post);
  });

  return Object.freeze(posts);
}
