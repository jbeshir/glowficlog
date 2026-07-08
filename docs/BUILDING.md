# Reproducible Build Guide (AMO Source Review)

## What's in this archive

This is the complete, unmodified source. The extension's code is **hand-written
TypeScript** under `src/` — nothing here is transpiled, minified, concatenated, or
otherwise machine-generated. The build below compiles `src/` into the `dist/`
bundle that is packaged for the store; `dist/` is **not** included in this archive
(it is produced by step 2). `package-lock.json` pins exact dependency versions so
the build is reproducible.

## Environment

- **Operating system:** Linux or macOS (Windows works via WSL2).
- **Node.js 22.x with npm 10+** (Node 20.x also works). Install from
  <https://nodejs.org/en/download>, or with [nvm](https://github.com/nvm-sh/nvm):

  ```bash
  nvm install 22
  nvm use 22
  ```

  Verify with `node -v` (≥ 20) and `npm -v` (≥ 10).
- No network access is required beyond the initial `npm ci`.

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

Runs `node scripts/package.mjs`. Produces two zips in `web-ext-artifacts/`,
where `<version>` is the `version` field in `manifest.json` (currently `0.1.6`):

- `glowficlog-firefox-<version>.zip` (built with web-ext)
- `glowficlog-chrome-<version>.zip`

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
