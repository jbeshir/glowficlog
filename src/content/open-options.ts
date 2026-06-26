// glowficlog content-script open-options helper.
//
// WHY this module exists: content scripts run in a restricted extension context.
// The chrome.runtime surface available to them includes getURL(), connect(),
// sendMessage(), and message/connect events — but NOT openOptionsPage(). That
// method is privileged to extension pages (background, popup, options) only. We
// therefore resolve the options URL ourselves via runtime.getURL() (which IS
// available in content scripts) and navigate to it with window.open(), which
// content scripts are permitted to call. web_accessible_resources in manifest.json
// makes options.html reachable from the glowfic.com origin when opened this way.

interface RuntimeLike { runtime?: { getURL?(path: string): string } }
const ext: RuntimeLike | undefined =
  (globalThis as { browser?: RuntimeLike }).browser ??
  (globalThis as { chrome?: RuntimeLike }).chrome;

export function openOptionsPage(): void {
  const url = ext?.runtime?.getURL?.('options.html');
  if (!url) {
    console.warn('[glowficlog] cannot open options page: runtime.getURL unavailable');
    return;
  }
  globalThis.open(url, '_blank', 'noopener');
}
