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
