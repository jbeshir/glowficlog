// Public surface of reader-core, shared verbatim by the content script and the
// offline dev harness.
export type { Post, RenderOptions, FixtureMeta } from './types.js';
export { parsePosts } from './parse.js';
export { renderReader } from './render.js';
export type { ThemeVars } from './theme.js';
export { readThemeFromDocument, applyTheme, withAlpha, isTransparent } from './theme.js';
export type { IconSizeOpts } from './layout.js';
export {
  computeIconSegments,
  computeIconSizes,
  layoutIcons,
  DEFAULT_ICON_OPTS,
} from './layout.js';
export { commonAncestor } from './dom.js';
