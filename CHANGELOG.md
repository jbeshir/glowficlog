# Changelog

## v0.1.8-alpha — 2026-07-14

### Fixes

- **Action-menu icon unresponsive on mobile**: tapping a post's portrait to
  open the link/bookmark/unread menu silently did nothing below the 640px
  breakpoint. A sibling element (the post body) kept a stacking property from
  the desktop layout that no longer had anything to paint over once mobile
  layout hid the element it was meant to sit above — it ended up covering the
  icon's tap target instead.
- **Extension failed to load in Firefox**: the manifest's
  `web_accessible_resources` used a Chrome-only MV3 property
  (`use_dynamic_url`) that Firefox's schema rejects. Removed it; Chrome's
  behaviour is unaffected since the resource (`options.html`) was already
  scoped to `glowfic.com` via `matches`.

### Reader

- **Removed the standalone permalink link**: the action menu already offers
  the same link as a "Permalink" item, so the separate hover/focus-revealed
  link next to the post identity was showing it a second time. Reach it via
  the action menu instead.

### Internal

- The action-menu popover is now a single lazily-created, body-level overlay
  positioned by script off the trigger's on-screen position — the same
  pattern already used for the icon hover-preview and the floating
  toggle/settings buttons — rather than living nested inside the post's icon
  box, which is what made it fragile to the mobile layout change above. The
  CSS z-index scale is documented and simplified to match.
- New browser-driven test (`npm run test:e2e`, part of `npm run validate`)
  drives a real Chromium across five viewport widths — including just above
  and below the 640px breakpoint — checking that every interactive element is
  present, actually receives clicks/taps (not silently covered by another
  element), and behaves as expected. This is the class of bug jsdom's
  unit tests cannot see, and the one that caused the mobile tap bug above.

## v0.1.7-alpha — 2026-07-09

### Reader

- **Anchor-tag "linked here" highlight**: reformatting now restores the highlight
  glowfic.com shows for the post a link points to (or your own next-unread post),
  redesigned to fit the compact layout and both light/dark themes rather than
  porting glowfic's plain border directly.
- **Anchor-tag scroll position**: following a link to a specific reply now scrolls
  to the correct post after reformatting; previously it could leave the page
  scrolled to the wrong spot.
- **Portrait action menu**: restores the link/bookmark/mark-unread icons the
  compact layout previously dropped, via a menu on tap/click of the character
  portrait instead of restoring them inline.
- **Faster, flicker-free reformatting**: the extension now reformats the page
  before first paint instead of after, removing the brief flash of the original
  unstyled thread.
- **Theme follows glowfic, not your OS**: light/dark mode (including the floating
  toggle/settings buttons) now matches glowfic's own page theme rather than your
  system preference, so the two can no longer disagree.

### Fixes

- The hover preview and the portrait action menu no longer overlap when both are
  visible.
- Fixed the linked-post highlight sometimes marking two posts at once.
- Fixed the action menu occasionally rendering behind a later post's portrait.
- Fixed the floating toggle button briefly flashing its "off" state on page load.
- A malformed reply anchor could previously produce an empty post id; it now
  falls back safely to a positional id.

### Security

- Scraping for the action-menu links/permalink/post id no longer trusts markup
  found inside the untrusted, page-author-controlled post body — closes a path
  where a forged post could spoof a fake action-menu entry or a fake post id.

### Internal

- Consolidated the CSS z-index scheme into a single documented scale, removed
  several dead/duplicate declarations and unused exports, and other
  maintainability cleanup — no user-visible change.

## v0.1.6-alpha — 2026-06-26

### Reader

- **Remove non-functional body sanitisation**: `buildBody` previously stripped
  `<script>`/`<iframe>`/etc. elements, inline `on*` handlers, and `javascript:`
  URLs from post bodies after inserting them. Post bodies are glowfic.com's own
  already-rendered, same-origin markup — re-displaying them runs nothing the page
  did not already run, and `innerHTML` never executes `<script>` — so that guard
  enforced no real boundary while implying one (and could mislead future work
  about where the trust boundary sits). Removed it; the body is re-displayed
  as-is, with only the optional blank-edge trim applied. glowfic is the trust
  boundary.

## v0.1.5-alpha — 2026-06-26

### Reader / UX

- **Settings button (spanner)**: when the reader is on, a 🔧 button appears
  immediately to the left of the toggle in the same fixed bottom-right cluster.
  Clicking it opens the options page in a new tab. The button is hidden when the
  reader is off; it shows and hides in lockstep with the toggle state via the
  shared `reflect()` call — no extra wiring needed.
- **Floating control cluster** (`.glr-controls`): the toggle and spanner are now
  grouped in a `position:fixed` flex container (`z-index: 2147483646`). The
  toggle loses its own positioning properties and inherits placement from the
  container. Mobile layout (`≤ 640px`) keeps the cluster at `right:12px;
  bottom:12px` to mirror the desktop inset.

### Manifest

- **`web_accessible_resources`**: `options.html` is now web-accessible and scoped
  to `*://glowfic.com/*` and `*://www.glowfic.com/*`, enabling the content script
  to navigate to it via `runtime.getURL()` + `window.open()`. No background
  script is added; `permissions` stays `["storage"]`; no new network calls.

### Icons

- **Transparent icon background**: the toolbar/store icons
  (`icons/icon-{16,48,128}.png`) are re-rendered from `icon.svg` with a
  transparent background instead of a baked-in opaque white square, so the rounded
  rose tile blends into any surface (previously Firefox's add-ons panel showed a
  white frame around it).

## v0.1.4-alpha — 2026-06-24

Packaging / distribution only — no reader or content-script behaviour changes.

### Store readiness

- **Manifest keys for AMO + Firefox-for-Android**: stable add-on id
  `glowficlog@beshir.org` (was the placeholder `glowficlog@glowficlog.local`);
  `data_collection_permissions: { required: ["none"] }` nested under `gecko` to
  declare zero data collection; and `gecko_android.strict_min_version: "128.0"`
  to make the extension installable on Firefox for Android (MV3 landed in
  Firefox-Android 128). Desktop `strict_min_version` stays at `115.0` for maximum
  reach including ESR. Single shared manifest — Chrome ignores
  `browser_specific_settings`.
- **Dev harness no longer bundled in the packaged extension**: `web-ext build`
  and `web-ext lint` now ignore `dev/**`, so the shipped zips contain only the
  reader runtime (no offline harness). The harness is still built into `dist/dev/`
  for local development.
- **Reproducible builds for AMO source review**: committed `package-lock.json`
  (install with `npm ci`) and a reviewer build guide at `docs/BUILDING.md`.

## v0.1.3-alpha — 2026-06-23

### Reader

- **Mobile reading layout** (`@media (max-width: 640px)`): below 640px the reader
  switches from the alternating-gutter desktop layout to a single full-width
  column in which each post's icon and author name float to the **right** and the
  body text wraps around and below them. Icons keep a larger legible minimum size
  (64px floor, vs the 28px desktop floor) so expressive headshots stay readable;
  the gutter-based connector/band decorations are simplified into a per-post tint;
  and the column runs edge-to-edge. Desktop layout above 640px is unchanged.
- **Per-author moiety colour rings**: each post's icon now displays a subtle
  coloured ring keyed to the author's moiety colour. The ring is pure CSS, driven
  by the `--glr-moiety` custom property set on `.glr-icon-box` by the new
  `applyMoieties` reader-core pass. Ring tunables (`--glr-moiety-ring: 2px`,
  `--glr-moiety-gap: 2px`) live on `.glr-reader`; when the property is unset the
  `box-shadow` is invalid at computed-value time and collapses to `none`, so no
  ring appears without any helper class.

### Extension

- **Content-script moiety fetch** (`src/content/moiety.ts`): same-origin
  `GET /api/v1/users?q=<author>&match=exact` (relative URL) fetches each author's
  moiety colour once per page and caches it in-session. This is the extension's
  **first network call**; it requires **no new `host_permissions`** (glowfic.com
  sends no CSP; same-origin content-script requests are always allowed). On any
  error the icon shows no ring and a `console.warn` is emitted — the reader
  continues working normally.
- **Default-ON "author colour rings" option**: new `moietyRings` toggle (default
  `true`) in the options page. Turning it off makes zero network requests and
  clears all rings immediately (`applyMoieties(reader, {})`).
- **Larger toggle button**: the floating Glowlog toggle is now at least 44×44 CSS
  px (WCAG 2.5.5 enhanced target size).

### Dev harness

- **Offline deterministic stub**: the harness uses `stubMoiety(author)` — a stable
  FNV-1a hash of the author name mapped to HSL — to colour rings with no network.
  `?moieties=0` (or `?moieties=false`) disables rings; default is on. A "moiety
  rings" checkbox is added to the toolbar mirroring the trim/condensed controls.

## v0.1.2-alpha — 2026-06-23

### Options page

- Adds an extension **options page** (two toggles, applied live to open tabs):
  - **Trim blank lines at the start/end of posts** — removes whitespace-only
    lines, including non-breaking spaces and empty paragraphs / line breaks,
    from the top and bottom of each post (blank lines between content are kept).
  - **Super condensed view** — shrinks the gap between posts to a hairline and
    trims the top/bottom padding inside each post.

### Dev

- New captured fixture `blank-lines` (thread 53995 p5) for the trim option, and
  `trim` / `condensed` toggles in the dev harness.

## v0.1.1-alpha — 2026-06-22

### Reader

- **Non-square icons** keep their natural aspect ratio (portrait and landscape
  icons are shown un-cropped), bounded so they can't grow too tall (colliding
  with the next same-side icon) or too wide (overflowing the gutter).
- **Alt re-announcement**: glowfic authors share a character name across alts
  that differ only by screenname/author. The reader now re-shows the full
  identity whenever the previous occurrence of a character name had a different
  screenname or author, then condenses again while it stays the same.
- **Hover preview** is now a genuine zoom (longest edge fixed at 240px, scaling
  small icons up rather than showing an icon-sized twin) and always opens toward
  the centre of the screen, into the reading area.

### Dev

- Two new captured fixtures: `icon-aspect` (thread 1025; non-square icons) and
  `alts` (thread 4265 p40; one character name alternating between two
  screennames).

## v0.1.0-alpha — 2026-06-22

First alpha. A cross-browser (Firefox + Chromium) Manifest V3 extension that
reformats [glowfic.com](https://glowfic.com) threads into a compact,
high-information-density reader, plus an offline dev harness that renders the
same reader from saved fixtures.

### Reader

- Continuous centred reading column that **matches the host page's font, size,
  and colours** (sampled at runtime, so it blends with whatever glowfic theme
  you use).
- Interlocking "rotated-L" layout: each post is a tinted card with a compact
  icon box in the left/right gutter (alternating side per post), joined to the
  body by a short connector.
- Icons are sized cap-primary (~96px), shrinking only to avoid collisions;
  full-size on hover; broken/blocked icons fall back to a monogram.
- Character name · screenname · author shown in full on a character's first
  appearance, condensed afterwards; the name aligns to the icon's side.
- A single-line post on the right gutter right-aligns toward its icon; wrapping
  posts stay left-aligned.

### Behaviour

- Toggle button ("Glowlog"), **off by default**, last state remembered; **Alt+G**
  shortcut.
- Runs on `glowfic.com` / `www.glowfic.com` `/posts/*` and `/replies/*`; works on
  page 2+ of a thread (the reader is inserted between the pagination bars).
- Defensive: it does nothing if the page isn't a recognised thread, and toggling
  off fully restores the original page.

### Known limitations

- It scrapes glowfic's HTML, so a change to the site's markup can break it (it
  fails safe — leaving the page untouched — rather than mangling it).
- This alpha is distributed unsigned: Chrome loads it via Developer Mode, and
  Firefox loads it as a temporary add-on (until a signed build is published).
