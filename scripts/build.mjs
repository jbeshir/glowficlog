// Build everything into dist/ with esbuild. No network; deps are pre-installed.
//
// Outputs:
//   dist/content.js        content script (IIFE, reader-core bundled in)
//   dist/reader.css        scoped reader styles (also under dist/dev/)
//   dist/manifest.json     MV3 manifest
//   dist/icons/*           extension icons
//   dist/dev/index.html    offline harness page
//   dist/dev/harness.js    harness bundle with fixtures embedded via __FIXTURES__
//   dist/dev/harness.css   harness chrome styles
import { build } from 'esbuild';
import {
  rmSync,
  mkdirSync,
  cpSync,
  copyFileSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');
const isDev = process.argv.includes('--dev');

const TARGETS = ['chrome100', 'firefox115'];

function r(...p) {
  return join(root, ...p);
}

/** Read fixtures + manifest into the object embedded in the harness bundle. */
function collectFixtures() {
  const manifestPath = r('fixtures', 'manifest.json');
  const metas = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const out = {};
  for (const meta of metas) {
    const file = r('fixtures', meta.file);
    out[meta.name] = { meta, html: readFileSync(file, 'utf8') };
  }
  // Defensive: also embed any *.html present but missing from the manifest.
  for (const f of readdirSync(r('fixtures'))) {
    if (!f.endsWith('.html')) continue;
    const name = f.replace(/\.html$/, '');
    if (!Object.values(out).some((e) => e.meta.file === f) && !out[name]) {
      out[name] = {
        meta: { name, file: f, view: 'flat', postCount: 0, notes: `(unlisted fixture ${f})` },
        html: readFileSync(r('fixtures', f), 'utf8'),
      };
    }
  }
  return out;
}

async function main() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, 'dev'), { recursive: true });
  mkdirSync(join(dist, 'icons'), { recursive: true });

  const fixtures = collectFixtures();

  // Content script — IIFE so it runs as a classic content script.
  await build({
    entryPoints: [r('src', 'content', 'content.ts')],
    outfile: join(dist, 'content.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: TARGETS,
    sourcemap: false,
    legalComments: 'none',
  });

  // Options page script — IIFE so it runs as a classic page script.
  await build({
    entryPoints: [r('src', 'options', 'options.ts')],
    outfile: join(dist, 'options.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: TARGETS,
    sourcemap: false,
    legalComments: 'none',
  });

  // Dev harness — IIFE with fixtures embedded via define (valid JS object literal).
  await build({
    entryPoints: [r('src', 'dev', 'harness.ts')],
    outfile: join(dist, 'dev', 'harness.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: TARGETS,
    sourcemap: false,
    legalComments: 'none',
    define: {
      __FIXTURES__: JSON.stringify(fixtures),
    },
  });

  // Static assets.
  copyFileSync(r('manifest.json'), join(dist, 'manifest.json'));
  copyFileSync(r('public', 'options.html'), join(dist, 'options.html'));
  copyFileSync(r('public', 'options.css'), join(dist, 'options.css'));
  copyFileSync(r('src', 'reader-core', 'reader.css'), join(dist, 'reader.css'));
  copyFileSync(r('src', 'reader-core', 'reader.css'), join(dist, 'dev', 'reader.css'));
  copyFileSync(r('public', 'dev', 'index.html'), join(dist, 'dev', 'index.html'));
  copyFileSync(r('public', 'dev', 'harness.css'), join(dist, 'dev', 'harness.css'));
  cpSync(r('icons'), join(dist, 'icons'), { recursive: true });

  const count = Object.keys(fixtures).length;
  console.log(`build: ok — content script + harness (${count} fixtures embedded) -> dist/`);
  if (isDev) {
    console.log('\nDev harness (open offline in a browser):');
    console.log('  file://' + join(dist, 'dev', 'index.html'));
    console.log('Query params: ?fixture=<name>&theme=light|dark[&raw=1]');
    console.log('Fixtures: ' + Object.keys(fixtures).sort().join(', '));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
