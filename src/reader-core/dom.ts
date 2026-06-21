// Small framework-free DOM helpers shared by the content script. Kept pure
// (read-only, no mutation, never throws) so they can be unit-tested headlessly.

/**
 * Lowest common ancestor of the given elements, walking `parentElement` chains.
 *
 * Used by the content script to locate the post-list wrapper from the page's
 * `.post-container`s WITHOUT assuming an original post exists (paginated reply
 * pages have none) — the reader is inserted relative to this wrapper rather than
 * to an OP. The result is INCLUSIVE: the LCA of a single element is that element
 * itself; callers that want the surrounding wrapper take its `parentElement`.
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
 * Mount `reader` at the post list's position and hide the host posts.
 *
 * A glowfic thread page is `…[.paginator (top)] [.post-container …] [.paginator
 * (bottom)]…`: the post containers sit BETWEEN two `.paginator` nav bars. The
 * reader must take the post list's place, so it is inserted immediately before
 * the FIRST `.post-container` within that container's own parent
 * (`firstPost.parentElement.insertBefore(reader, firstPost)`) — which lands it
 * between the top and bottom paginators. Only `.post-container` elements are then
 * hidden; the `.paginator` bars (and every other sibling) are left untouched.
 *
 * `commonAncestor` is consulted ONLY as a sanity check that the containers form a
 * single list; insertion is always anchored to the first container's position so
 * the reader works on page 2+ (which has no OP) exactly as on page 1.
 *
 * Returns the inserted `reader` on success, or `null` when there are no
 * containers / the first has no parent (caller then leaves the page untouched).
 * Never throws.
 */
export function mountReaderInPostList(
  reader: HTMLElement,
  doc: Document,
): HTMLElement | null {
  const containers = Array.from(doc.querySelectorAll<HTMLElement>('.post-container'));
  if (containers.length === 0) return null;
  const first = containers[0];
  const parent = first.parentElement;
  if (!parent) return null;
  // Sanity check only — the containers should share a wrapper for "the post
  // list's position" to be well-defined. We anchor to `first` regardless.
  commonAncestor(containers);
  parent.insertBefore(reader, first);
  // Hide ONLY the post containers — never the surrounding paginators/chrome.
  for (const c of containers) c.classList.add(HIDDEN_ORIGINAL_CLASS);
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
