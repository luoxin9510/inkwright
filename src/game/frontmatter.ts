const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * A note's text split into its frontmatter, parsed with the YAML parser given (Obsidian's in the plugin, the `yaml`
 * package on the command line), and the body after it. `frontmatter` is set only when it parses to an object;
 * `raw` is whatever it parsed to, `error` the parser's message when it did not parse.
 */
export function splitNote(text: string, parseYaml: (yaml: string) => unknown): { raw: unknown; frontmatter: Record<string, unknown> | undefined; body: string; error?: string } {
  const m = FRONTMATTER.exec(text);
  const body = m ? text.slice(m[0].length) : text;
  if (!m) return { raw: undefined, frontmatter: undefined, body };
  try {
    const raw = parseYaml(m[1]);
    return { raw, frontmatter: raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined, body };
  } catch (e) {
    return { raw: undefined, frontmatter: undefined, body, error: e instanceof Error ? e.message : String(e) };
  }
}
