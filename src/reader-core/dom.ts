// Small framework-free DOM helpers shared by the content script. Kept pure
// (read-only, no mutation, never throws) so they can be unit-tested headlessly.

/**
 * Nearest common ancestor Element of the given elements, walking `parentElement`
 * chains. The result is INCLUSIVE: the common ancestor of a single element is
 * that element itself; callers that want the surrounding wrapper take its
 * `parentElement`.
 *
 * Returns `null` for an empty input or when the elements share no ancestor
 * (e.g. they live in different detached trees).
 */
export function commonAncestor(els: readonly Element[]): Element | null {
  if (els.length === 0) return null;
  let ancestor: Element | null = els[0];
  for (let i = 1; i < els.length && ancestor; i++) {
    ancestor = lowestCommonAncestorPair(ancestor, els[i]);
  }
  return ancestor;
}

/** LCA of two elements, or null if they share no ancestor. */
function lowestCommonAncestorPair(a: Element, b: Element): Element | null {
  const aChain = new Set<Element>();
  for (let cur: Element | null = a; cur; cur = cur.parentElement) {
    aChain.add(cur);
  }
  for (let cur: Element | null = b; cur; cur = cur.parentElement) {
    if (aChain.has(cur)) return cur;
  }
  return null;
}

/** Class applied to the host's `.post-container`s to hide them while the reader
 *  is up. Removing it restores the page exactly. */
export const HIDDEN_ORIGINAL_CLASS = 'glr-hidden-original';

/**
 * Is this `.post-container` actually RENDERED on the page (i.e. one the reader
 * should represent), or is it a collapsed/hidden one to be ignored?
 *
 * A container is NOT rendered when it — or any ancestor up to (and including)
 * the post-list container — is collapsed: it carries the `hidden`/`post-expander`
 * class, has the `[hidden]` attribute, or (on a live page) computes to
 * `display: none`. On page 2+ the original post lives inside
 * `.post-expander > .hidden > .post-container.post-post`, so it is excluded; the
 * page-1 visible OP (a bare child of `#content`) is included.
 *
 * `stop` bounds the upward walk; pass the post-list container's own parent (or
 * `null` to walk to the document root). The `display:none` probe is best-effort:
 * jsdom without the host stylesheet reports nothing for a class-only `.hidden`,
 * which is exactly why the class/attribute checks come first.
 */
function isRenderedContainer(el: Element, stop: Element | null): boolean {
  for (let cur: Element | null = el; cur && cur !== stop; cur = cur.parentElement) {
    const cl = cur.classList;
    if (cl && (cl.contains('hidden') || cl.contains('post-expander'))) return false;
    if (typeof cur.hasAttribute === 'function' && cur.hasAttribute('hidden')) return false;
    const view = cur.ownerDocument?.defaultView;
    if (view?.getComputedStyle) {
      try {
        if (view.getComputedStyle(cur).display === 'none') return false;
      } catch {
        /* getComputedStyle can throw on detached nodes in some engines; ignore. */
      }
    }
  }
  return true;
}

/**
 * The `.post-container`s under `root` that are actually rendered, in document
 * order. Collapsed ones (the page-2 OP inside `.post-expander > .hidden`,
 * `[hidden]`, or `display:none`) are filtered out; everything visible — including
 * the page-1 OP — is kept. Pure: reads only, never mutates, never throws.
 */
export function renderedPostContainers(root: ParentNode): HTMLElement[] {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  // Bound the ancestor walk at the root's parent when root is itself an element
  // (e.g. a fixture wrapper), else walk freely to the document root. `nodeType`
  // is used rather than `instanceof Element` because `Element` is not a global
  // in the plain-Node test runtime (only on a jsdom window).
  const ELEMENT_NODE = 1;
  const stop =
    (root as { nodeType?: number }).nodeType === ELEMENT_NODE
      ? (root as unknown as Element).parentElement
      : null;
  return Array.from(root.querySelectorAll<HTMLElement>('.post-container')).filter(
    (el) => isRenderedContainer(el, stop),
  );
}

/**
 * Mount `reader` BETWEEN the top and bottom paginators and hide the host posts.
 *
 * The post-list container (`#content`) holds, as direct children, the rendered
 * `.post-container`s and the `.paginator` nav bars. Crucially the page-1 OP sits
 * ABOVE the top paginator while page-2's OP is a collapsed expander before it —
 * so "insert before the first `.post-container`" is wrong on both. Instead we:
 *
 *   1. take the RENDERED containers ({@link renderedPostContainers}) — the
 *      collapsed page-2 OP is excluded, the page-1 visible OP included;
 *   2. find the TOP paginator: the first `.paginator` child that still has a
 *      rendered post after it (so a thread's lone bottom nav is never mistaken
 *      for it) and insert the reader immediately AFTER it — landing it between
 *      the two navs even though the page-1 OP is above the top one;
 *   3. when there is no such paginator (a short single-page thread), fall back
 *      to inserting before the first rendered post.
 *
 * Only the rendered `.post-container`s are then hidden (the page-1 OP included —
 * its content now lives in the reader); the `.paginator` bars and the collapsed
 * OP expander are never touched.
 *
 * Returns the inserted `reader`, or `null` when there is nothing to anchor to
 * (caller then leaves the page untouched). Never throws.
 */
export function mountReaderInPostList(
  reader: HTMLElement,
  doc: Document,
): HTMLElement | null {
  const rendered = renderedPostContainers(doc);
  if (rendered.length === 0) return null;
  const container = rendered[0].parentElement;
  if (!container) return null;

  const children = Array.from(container.children);
  // Index of the last rendered post that is a direct child of the container —
  // the boundary a paginator must precede to count as the TOP nav.
  let lastRenderedIdx = -1;
  for (const post of rendered) {
    const idx = children.indexOf(post);
    if (idx > lastRenderedIdx) lastRenderedIdx = idx;
  }

  let topPaginator: Element | null = null;
  for (let i = 0; i < children.length && i < lastRenderedIdx; i++) {
    if (children[i].classList.contains('paginator')) {
      topPaginator = children[i];
      break;
    }
  }

  if (topPaginator) {
    // Immediately after the top nav → strictly between the two paginators.
    container.insertBefore(reader, topPaginator.nextSibling);
  } else {
    // No top nav (single-page thread): take the post list's own position.
    container.insertBefore(reader, rendered[0]);
  }
  // Hide ONLY the rendered post containers — never the paginators or the
  // collapsed-OP expander.
  for (const c of rendered) c.classList.add(HIDDEN_ORIGINAL_CLASS);
  return reader;
}

/**
 * Reverse {@link mountReaderInPostList}: remove the reader (if any) and unhide
 * every post we hid, restoring the host DOM to its pre-mount state. Never throws.
 */
export function unmountReader(reader: HTMLElement | null, doc: Document): void {
  if (reader) reader.remove();
  for (const c of Array.from(
    doc.querySelectorAll<HTMLElement>('.' + HIDDEN_ORIGINAL_CLASS),
  )) {
    c.classList.remove(HIDDEN_ORIGINAL_CLASS);
  }
}
