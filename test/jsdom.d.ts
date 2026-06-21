// Minimal ambient types for jsdom (no @types/jsdom available offline).
// Only declares the surface this test suite uses.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: Window & typeof globalThis;
  }
}
