// Icon hover preview (Fix 5). A clean, flicker-free, never-clipped enlarged
// preview of an icon shown next to it on hover.
//
// Design: ONE floating element (`.glr-icon-preview`) is created lazily and
// appended to <body> — deliberately OUTSIDE the reader subtree — so no ancestor
// `overflow` can clip it and showing it causes NO layout shift (it is
// `position: fixed`). A small show delay debounces quick fly-overs and a CSS
// opacity transition fades it in/out. The preview is reused across icons, capped
// at ~200px on its longest edge, and skipped entirely for monogram fallbacks
// (which have no real `<img>`). `enableIconPreviews` returns a cleanup function
// that detaches every listener and removes the floating node, so toggling the
// reader off leaves no trace.

/** Longest-edge cap (px) for the enlarged preview. */
const PREVIEW_MAX = 200;
/** Delay (ms) before the preview appears, so a passing cursor never flashes it. */
const SHOW_DELAY = 140;
/** Gap (px) kept between the icon and the floating preview. */
const EDGE_GAP = 8;
/** `.glr-icon-preview` padding (px) — kept in sync with reader.css. */
const FRAME = 4;

/**
 * Attach hover previews to every `.glr-icon-box` currently in `root`.
 * Idempotent per call site; returns a cleanup that removes all listeners and the
 * floating preview node. Safe in headless DOMs (it never assumes layout exists).
 */
export function enableIconPreviews(root: HTMLElement): () => void {
  const doc = root.ownerDocument;
  const win = doc?.defaultView ?? null;
  const body = doc?.body ?? null;
  if (!doc || !body) return () => {};

  let preview: HTMLDivElement | null = null;
  let previewImg: HTMLImageElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let currentBox: HTMLElement | null = null;

  function ensurePreview(): { wrap: HTMLDivElement; img: HTMLImageElement } {
    if (preview && previewImg) return { wrap: preview, img: previewImg };
    const wrap = doc!.createElement('div');
    wrap.className = 'glr-icon-preview';
    wrap.setAttribute('aria-hidden', 'true');
    const img = doc!.createElement('img');
    img.alt = '';
    wrap.appendChild(img);
    // The preview lives outside the reader subtree, so copy the reader's resolved
    // palette onto it for correct theming in light AND dark.
    if (win?.getComputedStyle) {
      const cs = win.getComputedStyle(root);
      const bg = cs.getPropertyValue('--glr-bg').trim();
      const shadow = cs.getPropertyValue('--glr-pop-shadow').trim();
      if (bg) wrap.style.setProperty('--glr-bg', bg);
      if (shadow) wrap.style.setProperty('--glr-pop-shadow', shadow);
    }
    body!.appendChild(wrap);
    preview = wrap;
    previewImg = img;
    return { wrap, img };
  }

  function clearShowTimer(): void {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  }

  function hide(): void {
    clearShowTimer();
    currentBox = null;
    if (preview) preview.classList.remove('glr-icon-preview--visible');
  }

  function show(box: HTMLElement, src: string, natW: number, natH: number): void {
    const { wrap, img } = ensurePreview();
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);

    // Cap the longest edge at PREVIEW_MAX, preserving aspect ratio. Natural
    // dimensions can be 0 (not yet decoded / headless) → fall back to a square.
    let w = natW || PREVIEW_MAX;
    let h = natH || PREVIEW_MAX;
    const scale = Math.min(1, PREVIEW_MAX / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;

    // Position next to the icon, flipping to the other side / clamping so the
    // preview always stays fully inside the viewport.
    const rect = box.getBoundingClientRect();
    const vw = win?.innerWidth ?? 0;
    const vh = win?.innerHeight ?? 0;
    const fullW = w + FRAME * 2;
    const fullH = h + FRAME * 2;

    let left = rect.right + EDGE_GAP;
    if (vw && left + fullW > vw - EDGE_GAP) left = rect.left - EDGE_GAP - fullW;
    if (left < EDGE_GAP) {
      left = vw ? Math.max(EDGE_GAP, vw - fullW - EDGE_GAP) : EDGE_GAP;
    }
    let top = rect.top + rect.height / 2 - fullH / 2;
    if (vh) top = Math.max(EDGE_GAP, Math.min(top, vh - fullH - EDGE_GAP));
    else top = Math.max(EDGE_GAP, top);

    wrap.style.left = `${Math.round(left)}px`;
    wrap.style.top = `${Math.round(top)}px`;
    wrap.classList.add('glr-icon-preview--visible');
  }

  function onEnter(ev: Event): void {
    const box = ev.currentTarget as HTMLElement;
    const img = box.querySelector<HTMLImageElement>('.glr-icon');
    // Monogram fallbacks (iconless or broken-image) have no real <img> → skip.
    if (!img) return;
    const src = img.currentSrc || img.src || img.getAttribute('src') || '';
    if (!src) return;
    currentBox = box;
    clearShowTimer();
    showTimer = setTimeout(() => {
      showTimer = null;
      if (currentBox !== box || !box.isConnected) return;
      show(box, src, img.naturalWidth, img.naturalHeight);
    }, SHOW_DELAY);
  }

  function onLeave(ev: Event): void {
    if (currentBox === ev.currentTarget) hide();
    else clearShowTimer();
  }

  const boxes = Array.from(root.querySelectorAll<HTMLElement>('.glr-icon-box'));
  for (const box of boxes) {
    box.addEventListener('mouseenter', onEnter);
    box.addEventListener('mouseleave', onLeave);
  }
  // Never let the preview linger when the page scrolls under it.
  const onScroll = (): void => hide();
  win?.addEventListener?.('scroll', onScroll, true);

  return () => {
    clearShowTimer();
    for (const box of boxes) {
      box.removeEventListener('mouseenter', onEnter);
      box.removeEventListener('mouseleave', onLeave);
    }
    win?.removeEventListener?.('scroll', onScroll, true);
    if (preview) preview.remove();
    preview = null;
    previewImg = null;
    currentBox = null;
  };
}
