// Produce distributable artifacts from a built dist/:
//   web-ext-artifacts/glowficlog-firefox-<version>.zip  (built by web-ext)
//   web-ext-artifacts/glowficlog-chrome-<version>.zip   (same MV3 bundle)
//
// The MV3 bundle is cross-browser, so the Chrome artifact is the identical
// zipped dist/ — just named for clarity. Requires `make build` first.
import { execFileSync } from 'node:child_process';
import { readFileSync, copyFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');
const artifacts = join(root, 'web-ext-artifacts');

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('package: dist/ not built — run `make build` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const version = pkg.version;
const webExt = join(root, 'node_modules', '.bin', 'web-ext');

// Clean previous artifacts so we can reliably pick up the fresh one.
rmSync(artifacts, { recursive: true, force: true });

// dev/ is the offline harness — exclude it (and its now-empty dir entry) from
// the shipped artifact. `dev/**` drops the files; `dev` drops the bare folder.
execFileSync(
  webExt,
  ['build', '--source-dir', dist, '--artifacts-dir', artifacts, '--overwrite-dest',
    '--ignore-files', 'dev/**', '--ignore-files', 'dev'],
  { stdio: 'inherit' },
);

// web-ext names it <name>-<version>.zip; find it and produce both named copies.
const built = readdirSync(artifacts).find((f) => f.endsWith('.zip'));
if (!built) {
  console.error('package: web-ext produced no zip.');
  process.exit(1);
}
const src = join(artifacts, built);
const firefox = join(artifacts, `glowficlog-firefox-${version}.zip`);
const chrome = join(artifacts, `glowficlog-chrome-${version}.zip`);
copyFileSync(src, firefox);
copyFileSync(src, chrome);

console.log('package: ok');
console.log('  Firefox: ' + firefox);
console.log('  Chrome:  ' + chrome);
