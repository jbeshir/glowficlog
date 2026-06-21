// Public surface of reader-core, shared verbatim by the content script and the
// offline dev harness.
export type { Post, RenderOptions, FixtureMeta } from './types.js';
export { parsePosts } from './parse.js';
export { renderReader } from './render.js';
export type { ThemeVars } from './theme.js';
export { readThemeFromDocument, applyTheme, withAlpha, isTransparent } from './theme.js';
export type { IconSizeOpts, SingleLineInput } from './layout.js';
export {
  computeIconSizes,
  layoutIcons,
  markSingleLineBodies,
  isSingleLine,
  resolveLineHeightPx,
  SINGLE_LINE_FACTOR,
  DEFAULT_ICON_OPTS,
  DEFAULT_ICON_PAD,
} from './layout.js';
export {
  commonAncestor,
  renderedPostContainers,
  mountReaderInPostList,
  unmountReader,
  HIDDEN_ORIGINAL_CLASS,
} from './dom.js';
export { enableIconPreviews } from './previews.js';
