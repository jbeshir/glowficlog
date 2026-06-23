// Trim whitespace-only "lines" from the START and END of a post body.
//
// Glowfic posts routinely carry blank padding at their edges — empty paragraphs,
// stray `<br>`s, `&nbsp;`-only lines, indentation whitespace — which wastes
// vertical space in the compact reader. This pass removes that padding from the
// leading and trailing edges ONLY; blank lines BETWEEN real content are left
// untouched (they're deliberate spacing).
//
// "Blank" is judged structurally on the rendered DOM, not by regex on HTML, so
// it correctly handles nesting (`<div><p>&nbsp;</p></div>`), mixed whitespace
// (`\n`, tabs, non-breaking spaces, other unicode spaces, zero-width spaces) and
// line breaks. A node is blank when it would render nothing visible:
//   - a text node of only whitespace,
//   - a comment,
//   - a `<br>`,
//   - any other element whose every child is itself blank (so empty `<p>`,
//     `<p><br></p>`, `<div>\n</div>` … all count).
// Replaced/embedded elements (images, media, `<hr>`, form controls, etc.) are
// always visible, so they stop the trim.

/**
 * Whitespace test for a text node. JS `\s` already covers the non-breaking space
 * (U+00A0) and the other unicode spaces (U+2000–U+200A, U+202F, U+205F, U+3000,
 * U+FEFF); the zero-width space (U+200B) is NOT in `\s`, so it is added here.
 */
const BLANK_TEXT = /^[\s\u200b]*$/;

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Elements that render something even when "empty" — they stop the trim. */
const VISIBLE_ELEMENTS = new Set([
  'IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'HR',
  'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'TABLE',
]);

/** True when `node` would render nothing visible (see module comment). */
export function isBlankNode(node: Node): boolean {
  if (node.nodeType === TEXT_NODE) {
    return BLANK_TEXT.test((node as Text).data);
  }
  if (node.nodeType !== ELEMENT_NODE) {
    // Comments, processing instructions, etc. render nothing.
    return true;
  }
  const el = node as Element;
  if (el.tagName === 'BR') return true;
  if (VISIBLE_ELEMENTS.has(el.tagName)) return false;
  for (const child of Array.from(el.childNodes)) {
    if (!isBlankNode(child)) return false;
  }
  return true;
}

/** Remove blank nodes from the leading edge, descending into the first node that
 *  has real content to strip ITS leading blanks too (e.g. `<p><br>Hi</p>`). */
function trimLeading(parent: Node): void {
  while (parent.firstChild) {
    const child = parent.firstChild;
    if (isBlankNode(child)) {
      parent.removeChild(child);
      continue;
    }
    if (child.nodeType === ELEMENT_NODE) trimLeading(child);
    break;
  }
}

/** Mirror of {@link trimLeading} for the trailing edge. */
function trimTrailing(parent: Node): void {
  while (parent.lastChild) {
    const child = parent.lastChild;
    if (isBlankNode(child)) {
      parent.removeChild(child);
      continue;
    }
    if (child.nodeType === ELEMENT_NODE) trimTrailing(child);
    break;
  }
}

/**
 * MUTATE `root` in place, removing whitespace-only content from its leading and
 * trailing edges (top and bottom of the post). Safe on already-tidy or wholly
 * blank bodies. Intended for the freshly-built, detached `.glr-content` node, so
 * the mutation never touches anything shared.
 */
export function trimBlankEdges(root: Element): void {
  trimLeading(root);
  trimTrailing(root);
}
