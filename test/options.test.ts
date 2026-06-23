// Tests for the shared options storage layer. A fake WebExtension storage.local
// (a Map) is installed on globalThis BEFORE importing the module, since `ext`
// binds to the global at module load. This guards the storage-key contract the
// content script and options page both depend on.
import { test } from 'node:test';
import assert from 'node:assert/strict';

interface FakeArea {
  get(keys: string[] | string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const store = new Map<string, unknown>();
const area: FakeArea = {
  async get(keys) {
    const list = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (store.has(k)) out[k] = store.get(k);
    return out;
  },
  async set(items) {
    for (const [k, v] of Object.entries(items)) store.set(k, v);
  },
};
(globalThis as unknown as { browser: unknown }).browser = { storage: { local: area } };

const { loadOptions, setOption, STORAGE_KEYS } = await import('../src/shared/options.js');

test('loadOptions: everything is OFF by default (empty store)', async () => {
  store.clear();
  assert.deepEqual(await loadOptions(), {
    enabled: false,
    trimBlankEdges: false,
    condensed: false,
  });
});

test('setOption round-trips through storage under the documented keys', async () => {
  store.clear();
  await setOption('trimBlankEdges', true);
  await setOption('condensed', true);
  assert.equal(store.get(STORAGE_KEYS.trimBlankEdges), true, 'trim key written');
  assert.equal(store.get(STORAGE_KEYS.condensed), true, 'condensed key written');

  const opts = await loadOptions();
  assert.equal(opts.trimBlankEdges, true);
  assert.equal(opts.condensed, true);
  assert.equal(opts.enabled, false, 'untouched option stays false');
});

test('options are independent: clearing one does not affect another', async () => {
  store.clear();
  await setOption('enabled', true);
  await setOption('condensed', false);
  const opts = await loadOptions();
  assert.equal(opts.enabled, true);
  assert.equal(opts.condensed, false);
  assert.equal(opts.trimBlankEdges, false);
});

test('STORAGE_KEYS are the stable glowficlog-namespaced strings', () => {
  // The content script and options page communicate ONLY through these keys; a
  // drift here silently breaks live option application, so pin them.
  assert.deepEqual(STORAGE_KEYS, {
    enabled: 'glowficlog:enabled',
    trimBlankEdges: 'glowficlog:trimBlankEdges',
    condensed: 'glowficlog:condensed',
  });
});
