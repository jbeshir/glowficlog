// glowficlog content-script moiety module. This is the ONLY place in the
// extension that makes a network request: a same-origin fetch to glowfic's
// public `/api/v1/users` endpoint. No host_permissions are required (no CSP
// on glowfic.com; same-origin content-script fetch works on Chrome and
// Firefox MV3 without manifest changes). All failures degrade gracefully to
// no-ring — the warn log carries the error for debugging.

import { applyMoieties } from '../reader-core/index.js';

/** Shape of the `/api/v1/users` lookup response (subset this module relies on). */
interface MoietyLookupResponse {
  results?: Array<{ username?: string; moiety?: string | null }>;
}

const cache = new Map<string, string | null>();

export function clearMoietyCache(): void {
  cache.clear();
}

export function collectAuthors(reader: HTMLElement): string[] {
  const seen = new Set<string>();
  for (const el of reader.querySelectorAll<HTMLElement>('.glr-post[data-author]')) {
    const author = el.dataset.author ?? '';
    if (author && author !== '(deleted user)') seen.add(author);
  }
  return [...seen];
}

export async function fetchMoiety(username: string): Promise<string | null> {
  const cached = cache.get(username);
  if (cached !== undefined) return cached;
  let colour: string | null = null;
  try {
    const resp = await fetch('/api/v1/users?q=' + encodeURIComponent(username) + '&match=exact');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json() as MoietyLookupResponse;
    const match = data.results?.find(r => r.username === username) ?? data.results?.[0];
    const hex = match?.moiety ?? null;
    colour = hex ? '#' + hex : null;
  } catch (err) {
    console.warn('[glowficlog] moiety lookup failed for ' + username, err);
    colour = null;
  }
  cache.set(username, colour);
  return colour;
}

export async function applyMoietyRings(reader: HTMLElement): Promise<void> {
  const authors = collectAuthors(reader);
  const colours: Record<string, string | null> = {};
  await Promise.all(
    authors.map(async a => {
      colours[a] = await fetchMoiety(a);
      applyMoieties(reader, colours);
    }),
  );
}
