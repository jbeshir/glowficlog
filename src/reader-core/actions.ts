// Post action menu (mark unread here, bookmark, permalink, etc). A clean,
// single-instance popover shown off the trigger the user activated.
//
// Design: ONE floating element (`.glr-actions`) is created lazily and appended
// to <body> — deliberately OUTSIDE the reader subtree, mirroring
// `enableIconPreviews` — so no ancestor `overflow` can clip it and it never
// causes layout shift (it is `position: fixed`). It is reused across every
// trigger: each open() clears and repopulates its `.glr-action` links from the
// activated post's `actions` before positioning it off that trigger's rect.
// `enableActionMenu` returns a cleanup function that detaches every listener
// (including the document-level ones, which do NOT vanish when the reader
// subtree is unmounted) and removes the floating node, so toggling the reader
// off leaves no trace.

import type { Post } from './types.js';

const NS = 'glr';

/** Stable id of the ONE shared action-menu popover. Every trigger's
 *  aria-controls points here; the popover carries this id. */
export const ACTIONS_MENU_ID = `${NS}-actions-menu`;

/** Gap (px) kept between the trigger and the floating popover. */
const GAP = 8;

/** Handle returned by {@link enableActionMenu}: call it to tear down; call
 *  `.setSuspended(true)` to close-and-ignore-triggers (shape-parity with
 *  IconPreviewsHandle). */
export type ActionMenuHandle = (() => void) & {
  setSuspended(suspended: boolean): void;
};

export interface ActionMenuOptions {
  /** Called with true when a menu opens and false when all menus close.
   *  The wiring layer (content.ts/harness.ts) uses this to suspend the icon
   *  hover-preview while a menu is open (mutual-suspension is kept in the
   *  wiring layer, NOT coupled into this module). */
  onOpenChange?(anyOpen: boolean): void;
}

/**
 * Attach the shared action-menu popover to every `.glr-icon-box--menu`
 * trigger currently (or later) inside `root`. Trigger discovery is delegated
 * (root-level click/keydown listeners with `closest`), so triggers added by a
 * future re-render of `root`'s contents are picked up with no re-wiring.
 * Idempotent per call site; returns a cleanup that removes all listeners and
 * the floating popover node. Safe in headless DOMs (it never assumes layout
 * exists).
 */
export function enableActionMenu(
  root: HTMLElement,
  posts: readonly Post[],
  opts?: ActionMenuOptions,
): ActionMenuHandle {
  const doc = root.ownerDocument;
  const win = doc?.defaultView ?? null;
  const body = doc?.body ?? null;
  if (!doc || !body) return Object.assign(() => {}, { setSuspended() {} });
  const d = doc;
  const b = body;

  let popover: HTMLDivElement | null = null;
  let currentTrigger: HTMLElement | null = null;
  // While true, triggers are ignored entirely and any open popover is closed —
  // set by the wiring layer while something else occupies the same space.
  let suspended = false;

  function ensurePopover(): HTMLDivElement {
    if (popover) return popover;
    const wrap = d.createElement('div');
    wrap.className = `${NS}-actions`;
    wrap.id = ACTIONS_MENU_ID;
    wrap.setAttribute('role', 'menu');
    wrap.setAttribute('aria-hidden', 'true');
    // The popover lives outside the reader subtree, so copy the reader's
    // resolved palette onto it for correct theming in light AND dark.
    if (win?.getComputedStyle) {
      const cs = win.getComputedStyle(root);
      const bg = cs.getPropertyValue('--glr-bg').trim();
      const shadow = cs.getPropertyValue('--glr-pop-shadow').trim();
      if (bg) wrap.style.setProperty('--glr-bg', bg);
      if (shadow) wrap.style.setProperty('--glr-pop-shadow', shadow);
    }
    b.appendChild(wrap);
    popover = wrap;
    return wrap;
  }

  /** Resolve the post a trigger belongs to via its owning `article`'s
   *  `data-post-id` (render.ts). Returns null (ignored by callers) when the
   *  structure doesn't match or the id isn't found — defensive. */
  function resolvePost(trigger: HTMLElement): Post | null {
    const article = trigger.closest('article[data-post-id]');
    if (!article) return null;
    const id = article.getAttribute('data-post-id');
    if (id == null) return null;
    return posts.find((post) => post.id === id) ?? null;
  }

  /** Build `.glr-action` links exactly as render.ts's old buildArm block did. */
  function populate(menu: HTMLDivElement, post: Post): void {
    const links: HTMLElement[] = [];
    for (const action of post.actions) {
      const link = d.createElement('a');
      link.className = `${NS}-action`;
      link.setAttribute('role', 'menuitem');
      link.href = action.href;
      if (action.method != null) link.setAttribute('data-method', action.method);
      if (action.rel != null) link.rel = action.rel;
      link.title = action.label;

      if (action.iconUrl) {
        const icon = d.createElement('img');
        icon.className = `${NS}-action-icon`;
        icon.src = action.iconUrl;
        icon.alt = '';
        icon.setAttribute('aria-hidden', 'true');
        link.appendChild(icon);
      }
      const label = d.createElement('span');
      label.className = `${NS}-action-label`;
      label.textContent = action.label;
      link.appendChild(label);

      links.push(link);
    }
    menu.replaceChildren(...links);
  }

  /** Position the (already populated + `--open`ed, so measurable) popover off
   *  `trigger`'s rect, clamped to stay fully on-screen. Horizontal: opens
   *  toward the viewport centre (mirrors previews' show()); vertical: prefers
   *  below, flips above when it would overflow and there's more room there. */
  function position(menu: HTMLDivElement, trigger: HTMLElement): void {
    const rect = trigger.getBoundingClientRect();
    const mrect = menu.getBoundingClientRect();
    const vw = win?.innerWidth ?? 0;
    const vh = win?.innerHeight ?? 0;
    const w = mrect.width;
    const h = mrect.height;

    const triggerCentreX = rect.left + rect.width / 2;
    const openRight = vw ? triggerCentreX < vw / 2 : true;
    let left = openRight ? rect.left : rect.right - w;
    left = vw ? Math.max(GAP, Math.min(left, vw - w - GAP)) : Math.max(GAP, left);

    let top = rect.bottom + GAP;
    if (vh) {
      const overflowsBelow = top + h > vh - GAP;
      const moreRoomAbove = rect.top > vh - rect.bottom;
      if (overflowsBelow && moreRoomAbove) top = rect.top - GAP - h;
      top = Math.max(GAP, Math.min(top, vh - h - GAP));
    } else {
      top = Math.max(GAP, top);
    }

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }

  function close(): void {
    if (!popover || !currentTrigger) return;
    popover.classList.remove(`${NS}-actions--open`);
    popover.setAttribute('aria-hidden', 'true');
    currentTrigger.setAttribute('aria-expanded', 'false');
    currentTrigger = null;
    opts?.onOpenChange?.(false);
  }

  function open(trigger: HTMLElement): void {
    const post = resolvePost(trigger);
    if (!post) return; // structure mismatch → ignore, defensive
    if (currentTrigger && currentTrigger !== trigger) close();
    const menu = ensurePopover();
    populate(menu, post);
    menu.classList.add(`${NS}-actions--open`);
    menu.setAttribute('aria-hidden', 'false');
    trigger.setAttribute('aria-expanded', 'true');
    currentTrigger = trigger;
    position(menu, trigger);
    opts?.onOpenChange?.(true);
  }

  /** Close whatever else is open, then toggle this trigger's own popover. */
  function toggle(trigger: HTMLElement): void {
    if (suspended) return;
    if (currentTrigger === trigger) {
      close();
      return;
    }
    open(trigger);
  }

  function setSuspended(value: boolean): void {
    suspended = value;
    if (suspended) close();
  }

  const onClick = (event: MouseEvent): void => {
    try {
      // `instanceof Element`/`HTMLElement` is avoided on purpose: those DOM
      // constructors are NOT globals in the plain-Node test runtime (they live
      // only on a jsdom window), so `instanceof` would throw there — see the
      // same `nodeType`/duck-typing rationale in dom.ts. Duck-type on `.closest`
      // instead, which works identically live and headless.
      const target = event.target as Element | null;
      if (!target || typeof target.closest !== 'function') return;
      const trigger = target.closest<HTMLElement>(`.${NS}-icon-box--menu`);
      if (!trigger || !root.contains(trigger)) return;
      toggle(trigger);
    } catch {
      /* defensive: never break host page click handling */
    }
  };

  // Enter/Space activate a trigger — scoped to `root`, since the triggers live
  // there and this is where the event originates.
  const onRootKeydown = (event: KeyboardEvent): void => {
    try {
      const target = event.target as Element | null;
      if (!target || typeof target.closest !== 'function') return;
      const trigger = target.closest<HTMLElement>(`.${NS}-icon-box--menu`);
      if (!trigger || !root.contains(trigger)) return;
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        // Space would otherwise scroll the page.
        event.preventDefault();
        toggle(trigger);
      }
    } catch {
      /* defensive: never break host page keyboard handling */
    }
  };

  // Escape closes the open popover from ANYWHERE and returns focus to its
  // trigger. This is a document-level listener (like the pointerdown/scroll
  // closers below) because the popover is a <body> child OUTSIDE `root`: a
  // keydown while focus is inside the popover would never bubble to a
  // root-scoped listener, so a root-scoped Escape would silently miss it.
  const onDocumentKeydown = (event: KeyboardEvent): void => {
    try {
      if (event.key !== 'Escape' || !currentTrigger) return;
      const trigger = currentTrigger;
      close();
      trigger.focus();
    } catch {
      /* defensive */
    }
  };

  // Outside-interaction close: a pointerdown anywhere that's not inside the
  // open popover or its trigger closes it.
  const onDocumentPointerDown = (event: PointerEvent): void => {
    try {
      if (!popover || !currentTrigger) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (popover.contains(target) || currentTrigger.contains(target)) return;
      close();
    } catch {
      /* defensive */
    }
  };

  // The popover is fixed-positioned off a measured rect, so any scroll would
  // leave it drifted relative to its trigger — simplest correct behaviour is
  // to just close it.
  const onDocumentScroll = (): void => {
    try {
      close();
    } catch {
      /* defensive */
    }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onRootKeydown);
  d.addEventListener('keydown', onDocumentKeydown);
  d.addEventListener('pointerdown', onDocumentPointerDown);
  d.addEventListener('scroll', onDocumentScroll, { capture: true, passive: true });

  return Object.assign(
    () => {
      // The reader-root listeners vanish with the subtree on unmount
      // regardless, but removing them explicitly is cheap and avoids relying
      // on that. The document-level ones do NOT vanish, so this must run.
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onRootKeydown);
      d.removeEventListener('keydown', onDocumentKeydown);
      d.removeEventListener('pointerdown', onDocumentPointerDown);
      d.removeEventListener('scroll', onDocumentScroll, { capture: true });
      if (popover) popover.remove();
      popover = null;
      currentTrigger = null;
    },
    { setSuspended },
  );
}
