// Public surface of reader-core, shared verbatim by the content script and the
// offline dev harness.
export type { Post, PostAction, RenderOptions, FixtureMeta } from './types.js';
export { parsePosts } from './parse.js';
export { renderReader, computeFullAppearances } from './render.js';
export { trimBlankEdges, isBlankNode } from './bodytrim.js';
export type { ThemeVars } from './theme.js';
export { readThemeFromDocument, applyTheme, withAlpha, isTransparent, themeMode } from './theme.js';
export {
  computeIconSizes,
  fitIconBox,
  layoutIcons,
  markSingleLineBodies,
  isSingleLine,
  SINGLE_LINE_FACTOR,
  DEFAULT_ICON_OPTS,
  DEFAULT_ICON_PAD,
} from './layout.js';
export { watchResize } from './resize.js';
export {
  commonAncestor,
  renderedPostContainers,
  mountReaderInPostList,
  unmountReader,
  HIDDEN_ORIGINAL_CLASS,
} from './dom.js';
export type { IconPreviewsHandle } from './previews.js';
export { enableIconPreviews } from './previews.js';
export { applyMoieties } from './moiety.js';
