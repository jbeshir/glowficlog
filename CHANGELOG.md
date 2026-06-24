# Changelog

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
