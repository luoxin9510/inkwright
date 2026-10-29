import { getLanguage } from "../i18n";
import { zhTable } from "./zh";

export type Severity = "error" | "warning" | "todo";

export interface Diagnostic {
  severity: Severity;
  file: string;
  line: number | null;
  message: string;
  raw: string;
}

export interface ParsedMessage {
  severity: Severity;
  file: string | null;
  line: number | null;
  text: string;
}

const PREFIX: Record<string, Severity> = { ERROR: "error", WARNING: "warning", TODO: "todo" };

export function parseRaw(raw: string, fallback: Severity = "error"): ParsedMessage {
  const m = raw.match(/^(ERROR|WARNING|TODO):\s*(?:'([^']*)'\s+)?(?:line\s+(\d+):\s*)?([\s\S]*)$/);
  if (!m) return { severity: fallback, file: null, line: null, text: raw };
  return {
    severity: PREFIX[m[1]],
    file: m[2] ?? null,
    line: m[3] ? Number(m[3]) : null,
    text: m[4],
  };
}

/** Chinese UI: translated text. English UI: inkjs's original message. */
export function translate(text: string): string {
  if (getLanguage() === "en") return text;
  for (const [re, fn] of zhTable) {
    const m = text.match(re);
    if (m) return fn(m);
  }
  return `${text}(暂无中文翻译)`;
}
