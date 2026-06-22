# Changelog

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
