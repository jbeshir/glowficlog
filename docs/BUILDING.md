# Reproducible Build Guide (AMO Source Review)

## Environment

- Linux or macOS
- Node.js 20.x or 22.x (npm 10+)
- No network access required beyond the initial `npm ci`

## Steps

### 1. Install dependencies

```bash
npm ci
```

Installs exact versions from the committed `package-lock.json`. Requires network only for this step.

### 2. Build

```bash
npm run build
```

Runs `node scripts/build.mjs` via esbuild. Produces `dist/` containing:

- `content.js`, `options.js`, `reader.css` — extension scripts/styles
- `manifest.json`, `icons/` — extension manifest and icons
- `dist/dev/` — offline dev harness (used for local development only; excluded from packaged zips)

### 3. Package

```bash
npm run package
```

Runs `node scripts/package.mjs`. Produces two zips in `web-ext-artifacts/`:

- `glowficlog-firefox-0.1.4.zip` (built with web-ext)
- `glowficlog-chrome-0.1.4.zip`

**Contents of each zip** (the `dev/` directory is explicitly excluded):

```
manifest.json
content.js
options.html
options.js
reader.css
options.css
icons/icon-16.png
icons/icon-48.png
icons/icon-128.png
```

## Validation gate

```bash
npm run validate
```

Runs typecheck + eslint + tests + build + web-ext lint. This is the authoritative CI gate.

## Convenience wrappers

Each `make <target>` wraps the corresponding `npm run <name>`:

```bash
make build      # npm run build
make package    # npm run build && npm run package
make validate   # npm run validate
```
