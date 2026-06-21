// Shared, framework-free data model for the glowficlog reader.
// Everything here is plain data so it can cross the content-script / dev-harness
// boundary unchanged.

/**
 * Immutable model of a single glowfic post (OP or reply), extracted from the
 * page/fixture DOM. Every optional field is `null` when absent in the source so
 * consumers never have to distinguish `undefined` from "not present".
 */
export interface Post {
  /** Reply id (e.g. "2486270") or `op:{permalink}` / positional fallback. Stable within a render. */
  readonly id: string;
  /** True for the original post (`.post-container.post-post`). */
  readonly isOP: boolean;
  /** Icon image URL, or null when the post has no icon. */
  readonly iconUrl: string | null;
  /** Icon keyword (alt/title), or null. */
  readonly iconKeyword: string | null;
  /** Character name, or null for author-only (`.spacer-alt`) posts. May be "[Deleted]". */
  readonly character: string | null;
  /** Character screenname, or null when unset. */
  readonly screenname: string | null;
  /** Author account name. May be "(deleted user)". Empty string only if the DOM is malformed. */
  readonly author: string;
  /** Raw post body HTML (inner HTML of `.post-content`). */
  readonly bodyHtml: string;
  /** Permalink href (e.g. "/replies/123#reply-123" or "/posts/47494"), or null. */
  readonly permalink: string | null;
}

/** Options for {@link renderReader}. `document` is injectable for headless testing. */
export interface RenderOptions {
  /** Document used to create nodes. Defaults to the ambient `document` when available. */
  readonly document?: Document;
  /** Theme applied as `data-theme` on the root. */
  readonly theme?: 'light' | 'dark';
}

/** Shape of one entry in fixtures/manifest.json (subset the harness/tests rely on). */
export interface FixtureMeta {
  readonly name: string;
  readonly file: string;
  readonly view: 'flat' | 'paginated';
  readonly postCount: number;
  readonly distinctAuthors: number;
  readonly distinctCharacters: number;
  readonly hasIconlessPosts: boolean;
  readonly hasAuthorOnlyPosts: boolean;
  readonly avgPostChars: number;
  readonly category: string;
  readonly notes: string;
}
