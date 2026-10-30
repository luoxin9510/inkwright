declare module "virtual:ink-runtime" {
  /** Source of the inkjs runtime (dist/ink.js), inlined at build time. */
  const source: string;
  export default source;
}

declare module "virtual:game-engine" {
  /** The game engine bundled for exported web pages (defines window.InkwrightGame), built at build time. */
  const source: string;
  export default source;
}
