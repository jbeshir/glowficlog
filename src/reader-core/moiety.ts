// applyMoieties: pure DOM pass setting --glr-moiety on each post's
// .glr-icon-box from a per-author colour map. Sets the property verbatim for
// non-empty strings; removes it for null/absent entries. Idempotent, never
// throws on missing nodes, no globals, no network, framework-free.

export function applyMoieties(
  root: HTMLElement,
  colorsByAuthor: Record<string, string | null>,
): void {
  const posts = root.querySelectorAll<HTMLElement>('.glr-post[data-author]');
  for (const post of posts) {
    const author = post.getAttribute('data-author') ?? '';
    const iconBox = post.querySelector<HTMLElement>('.glr-icon-box');
    if (!iconBox) continue;

    if (Object.prototype.hasOwnProperty.call(colorsByAuthor, author)) {
      const value = colorsByAuthor[author];
      if (typeof value === 'string' && value.length > 0) {
        iconBox.style.setProperty('--glr-moiety', value);
      } else {
        iconBox.style.removeProperty('--glr-moiety');
      }
    } else {
      iconBox.style.removeProperty('--glr-moiety');
    }
  }
}
