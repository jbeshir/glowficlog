// glowficlog options page. A tiny standalone page (no framework) that reads the
// current options and writes each toggle back to storage.local on change. The
// content script listens for those changes and applies them live to open
// glowfic tabs, so there is no "save" button.

import { loadOptions, setOption } from '../shared/options.js';
import type { Options } from '../shared/options.js';

/** Wire one checkbox to an option key: reflect the stored value, persist on change. */
function bindToggle(id: string, key: keyof Options, initial: boolean): void {
  const box = document.getElementById(id);
  if (!(box instanceof HTMLInputElement)) return;
  box.checked = initial;
  box.addEventListener('change', () => {
    void setOption(key, box.checked);
  });
}

async function init(): Promise<void> {
  const options = await loadOptions();
  bindToggle('opt-trim-blank-edges', 'trimBlankEdges', options.trimBlankEdges);
  bindToggle('opt-condensed', 'condensed', options.condensed);
}

init().catch((err) => {
  console.error('[glowficlog] options init failed', err);
});
