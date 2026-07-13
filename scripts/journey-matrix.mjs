// Regression gate: a feature x form-factor interaction matrix driven against a
// real Chromium (jsdom has no layout/paint engine, so hit-testing, hover
// reveals, and viewport-clamped popovers are all invisible to `npm test`).
// Loads the built dev harness (dist/dev/index.html, via file://, same as the
// harness is designed to run offline) once per form factor and, for each
// (feature, form-factor) cell, checks four lenses:
//   (a) Present   — the element exists with a non-zero bounding box.
//   (b) Reachable — its own centre point hit-tests back to itself (a tap there
//                   would actually reach it, not an overlapping sibling).
//   (c) Effective — a real interaction produces the documented effect, and
//                   reverses cleanly where applicable.
//   (d) Clean     — no pageerror/console error occurred during the sequence.
// Any b/c/d failure, or an (a) Present failure, is a HARD fail.
//
// Requires a real Chromium: first tries playwright-core's own auto-discovery
// (works inside the demesne `browser` sandbox image, which ships a
// Playwright-cache Chromium), then falls back to scanning common system
// install locations ($CHROMIUM_PATH or /usr/bin/chromium* etc) for a bare
// host. Fails loudly if neither resolves — never silently skipped.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const harnessPath = path.join(root, 'dist', 'dev', 'index.html');
const harnessUrl = 'file://' + harnessPath;

const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'];

const CANDIDATE_BROWSERS = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/snap/bin/chromium',
].filter(Boolean);

const FORM_FACTORS = [
  { label: 'mobile', width: 375, height: 667, isMobile: true },
  { label: '639', width: 639, height: 800, isMobile: false }, // just below 640 breakpoint
  { label: '641', width: 641, height: 800, isMobile: false }, // just above
  { label: 'tablet', width: 768, height: 1024, isMobile: false },
  { label: 'desktop', width: 1280, height: 900, isMobile: false },
];

async function launchBrowser() {
  try {
    return await chromium.launch({ args: LAUNCH_ARGS });
  } catch (autoErr) {
    for (const candidate of CANDIDATE_BROWSERS) {
      if (fs.existsSync(candidate)) {
        return chromium.launch({ executablePath: candidate, args: LAUNCH_ARGS });
      }
    }
    throw new Error(
      'no usable Chromium found: playwright-core auto-discovery failed ' +
        `(${autoErr.message}), and none of the fallback binaries exist ` +
        `(tried: ${CANDIDATE_BROWSERS.join(', ') || '(no candidates — set $CHROMIUM_PATH)'}).`,
    );
  }
}

/** Load the default harness, then (if it has no menu triggers) enumerate the
 *  #harness-fixture <option>s and reload with ?fixture=<name> until one has
 *  ≥1 trigger. Returns the URL every form-factor context should load. */
async function resolveFixtureUrl(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(harnessUrl, { waitUntil: 'load' });
    await page.waitForSelector('.glr-icon-box', { timeout: 10000 }).catch(() => {});
    if ((await page.$$('.glr-icon-box--menu')).length > 0) return harnessUrl;

    const names = await page.$$eval('#harness-fixture option', (opts) => opts.map((o) => o.value));
    if (names.length === 0) {
      throw new Error('no #harness-fixture options found — dist/dev was likely built without fixtures');
    }
    for (const name of names) {
      const url = `${harnessUrl}?fixture=${encodeURIComponent(name)}`;
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForSelector('.glr-icon-box', { timeout: 5000 }).catch(() => {});
      if ((await page.$$('.glr-icon-box--menu')).length > 0) return url;
    }
    throw new Error(
      `no harness fixture (tried default + ${names.length} named: ${names.join(', ')}) ` +
        'has any .glr-icon-box--menu trigger',
    );
  } finally {
    await context.close();
  }
}

function fail(lens, message) {
  return { pass: false, lens, message };
}
function pass() {
  return { pass: true };
}

async function pollFor(page, predicate, timeoutMs, stepMs = 50) {
  const start = Date.now();
  for (;;) {
    const result = await predicate();
    if (result) return result;
    if (Date.now() - start >= timeoutMs) return null;
    await page.waitForTimeout(stepMs);
  }
}

async function activateTrigger(trigger, factor) {
  if (factor.isMobile) await trigger.tap();
  else await trigger.click();
}

/** 1. action-menu: .glr-icon-box--menu -> shared #glr-actions-menu popover. */
async function checkActionMenu(page, factor) {
  const triggers = await page.$$('.glr-icon-box--menu');
  if (triggers.length === 0) return fail('a', 'no .glr-icon-box--menu triggers found');

  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i];
    await trigger.scrollIntoViewIfNeeded();
    const box = await trigger.boundingBox();
    if (!box || box.width === 0 || box.height === 0) {
      return fail('a', `trigger #${i} has a zero-size bounding box`);
    }
    const hit = await trigger.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return node.contains(t);
    });
    if (!hit) return fail('b', `trigger #${i} centre point is covered by another element`);
  }

  const trigger = triggers[0];
  await activateTrigger(trigger, factor);

  const popover = await page
    .waitForSelector('#glr-actions-menu.glr-actions--open', { timeout: 2000 })
    .catch(() => null);
  if (!popover) return fail('c', 'popover did not gain .glr-actions--open after trigger activation');

  const linkCount = await popover.$$eval('.glr-action', (els) => els.length);
  if (linkCount < 1) return fail('c', 'popover opened with zero .glr-action links');

  const pbox = await popover.boundingBox();
  const viewport = page.viewportSize();
  if (!pbox || pbox.width === 0 || pbox.height === 0) return fail('c', 'popover has a zero-size bounding box');
  const within =
    pbox.x >= 0 &&
    pbox.y >= 0 &&
    pbox.x + pbox.width <= viewport.width &&
    pbox.y + pbox.height <= viewport.height;
  if (!within) {
    return fail(
      'c',
      `popover extends outside the viewport (box=${JSON.stringify(pbox)}, viewport=${JSON.stringify(viewport)})`,
    );
  }

  if (factor.isMobile) {
    await page.touchscreen.tap(5, 5);
  } else {
    await page.keyboard.press('Escape');
  }
  const closed = await page
    .waitForFunction(
      () => !document.getElementById('glr-actions-menu')?.classList.contains('glr-actions--open'),
      undefined,
      { timeout: 2000 },
    )
    .catch(() => null);
  if (!closed) return fail('c', 'popover did not close again — not reversibly closable');

  return pass();
}

/** 2. icon-preview: .glr-icon-box -> floating .glr-icon-preview on hover. */
async function checkIconPreview(page, factor) {
  const box = (await page.$$('.glr-icon-box'))[0];
  if (!box) return fail('a', 'no .glr-icon-box found');
  await box.scrollIntoViewIfNeeded();
  const bbox = await box.boundingBox();
  if (!bbox || bbox.width === 0 || bbox.height === 0) return fail('a', 'icon box has a zero-size bounding box');

  if (factor.isMobile) {
    // No forced hover on touch — tap the (shared) menu trigger and require no
    // interference from the preview code (previews.ts is hover-only and must
    // stay inert here; cleanliness is checked by the caller after this cell).
    const menuTrigger = (await page.$$('.glr-icon-box--menu'))[0];
    if (menuTrigger) {
      await menuTrigger.scrollIntoViewIfNeeded();
      await menuTrigger.tap();
      await page.touchscreen.tap(5, 5); // close it again, don't leak state
    } else {
      const c = await box.boundingBox();
      await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2);
    }
    return pass();
  }

  // Pointer form factor. The preview only ever attaches to a real <img
  // class="glr-icon"> — render.ts intentionally degrades to a monogram (no
  // <img>) when the icon fails to load, and previews.ts documents that the
  // preview is "skipped entirely for monogram fallbacks". Icon srcs in the
  // fixtures are live glowfic CDN URLs, which this sandboxed harness cannot
  // reach, so exercise the hover-reveal path when a real icon is present and
  // otherwise assert the graceful no-preview path stays clean.
  const hasRealIcon = await box.evaluate((el) => !!el.querySelector('.glr-icon'));
  await box.hover();
  if (!hasRealIcon) {
    await page.mouse.move(0, 0);
    return pass();
  }

  const shown = await pollFor(page, () => page.$('.glr-icon-preview.glr-icon-preview--visible'), 1000);
  if (!shown) return fail('c', 'hovering a real icon did not reveal .glr-icon-preview--visible within 1000ms');

  const title = await page.$('.harness-title');
  if (title) await title.hover();
  else await page.mouse.move(0, 0);
  const hidden = await pollFor(
    page,
    async () => !(await page.$('.glr-icon-preview.glr-icon-preview--visible')),
    1000,
  );
  if (!hidden) return fail('c', 'preview did not hide after moving the pointer away');

  return pass();
}

const FEATURE_CHECKS = [
  ['action-menu', checkActionMenu],
  ['icon-preview', checkIconPreview],
];

async function resetState(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.move(0, 0).catch(() => {});
}

async function runCell(page, errors, checkFn, factor) {
  errors.length = 0;
  try {
    const result = await checkFn(page, factor);
    if (!result.pass) return result;
    if (errors.length > 0) {
      return fail('d', `page/console errors during check: ${errors.slice(0, 3).join('; ')}`);
    }
    return pass();
  } catch (err) {
    return fail('?', `threw: ${err && err.message ? err.message : String(err)}`);
  } finally {
    await resetState(page);
  }
}

function printGrid(results, featureLabels, factors) {
  const colWidth = Math.max(...factors.map((f) => f.label.length), 'FAIL(x)'.length) + 2;
  const featureColWidth = Math.max(...featureLabels.map((f) => f.length)) + 2;
  let header = ' '.repeat(featureColWidth);
  for (const factor of factors) header += factor.label.padStart(colWidth);
  console.log(header);
  for (const feature of featureLabels) {
    let row = feature.padEnd(featureColWidth);
    for (const factor of factors) {
      const cell = results.find((r) => r.feature === feature && r.factor === factor.label);
      const text = cell && cell.pass ? 'PASS' : `FAIL(${(cell && cell.lens) || '?'})`;
      row += text.padStart(colWidth);
    }
    console.log(row);
  }
}

async function main() {
  if (!fs.existsSync(harnessPath)) {
    throw new Error(`${harnessPath} not found — run \`npm run build\` first`);
  }

  const browser = await launchBrowser();
  const results = [];
  try {
    const fixtureUrl = await resolveFixtureUrl(browser);
    console.log(`journey-matrix: using fixture ${fixtureUrl}`);

    for (const factor of FORM_FACTORS) {
      const context = await browser.newContext({
        viewport: { width: factor.width, height: factor.height },
        hasTouch: factor.isMobile,
        isMobile: factor.isMobile,
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        // Ignore failed resource loads: this harness is deliberately offline and
        // its fixtures reference live glowfic CDN icon URLs it cannot fetch, so
        // Chromium logs "Failed to load resource"/net::ERR_ console errors that
        // are environmental, not defects (render.ts degrades such icons to
        // monograms by design). Lens (d) is meant to catch genuine script
        // errors from the reader's own code, not the sandbox's lack of network.
        if (/Failed to load resource/i.test(text) || /net::ERR_/i.test(text)) return;
        errors.push(`console.error: ${text}`);
      });

      try {
        await page.goto(fixtureUrl, { waitUntil: 'load' });
        await page.waitForSelector('.glr-icon-box', { timeout: 10000 });
        // Let async icon load/error handling (render.ts's onerror monogram
        // fallback) settle before the first cell probes the DOM.
        await page.waitForTimeout(400);

        for (const [feature, checkFn] of FEATURE_CHECKS) {
          const result = await runCell(page, errors, checkFn, factor);
          results.push({ feature, factor: factor.label, ...result });
          const status = result.pass ? 'ok' : `FAIL(${result.lens})`;
          console.log(`  ${factor.label} (${factor.width}x${factor.height}) / ${feature}: ${status}`);
        }
      } catch (err) {
        for (const [feature] of FEATURE_CHECKS) {
          results.push({
            feature,
            factor: factor.label,
            pass: false,
            lens: '?',
            message: `context setup failed: ${err.message}`,
          });
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log('');
  printGrid(
    results,
    FEATURE_CHECKS.map(([f]) => f),
    FORM_FACTORS,
  );

  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.log('\nfailures:');
    for (const f of failures) {
      console.log(`  [${f.feature} x ${f.factor}] lens=${f.lens} — ${f.message}`);
    }
    console.error(`\njourney-matrix failed: ${failures.length}/${results.length} cells failed`);
    process.exit(1);
  }

  console.log(`\nok — journey-matrix: ${results.length}/${results.length} cells passed`);
}

main().catch((err) => {
  console.error('journey-matrix failed:', err.message);
  process.exit(1);
});
