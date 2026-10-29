declare module "virtual:ink-runtime" {
  /** Source of the inkjs runtime (dist/ink.js), inlined at build time. */
  const source: string;
  export default source;
}
