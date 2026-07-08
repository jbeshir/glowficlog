// Debounced viewport-resize re-flow, shared by the content script and the dev
// harness: post heights — and therefore how far an icon may grow before
// meeting the next same-side icon — change with viewport width, so both
// hosts re-run layoutIcons + markSingleLineBodies after resizing settles.

import { layoutIcons, markSingleLineBodies } from './layout.js';

/**
 * Register a debounced `resize` listener that re-flows the reader rooted at
 * whatever `getRoot()` currently returns (re-read on each fire, so it tracks
 * activation/deactivation without re-subscribing). Returns a disposer that
 * removes the listener.
 */
export function watchResize(getRoot: () => HTMLElement | null, delayMs = 120): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const handler = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const root = getRoot();
      if (root) {
        layoutIcons(root);
        markSingleLineBodies(root);
      }
    }, delayMs);
  };
  globalThis.addEventListener?.('resize', handler);
  return () => globalThis.removeEventListener?.('resize', handler);
}
