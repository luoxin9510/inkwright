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
/**
 * Runtime messages look like "RUNTIME ERROR: 'main.ink' line 3: <text>".
 * Chinese UI: localized prefix + translated text. English UI: unchanged.
 */
export function translateRuntime(message: string): string {
  if (getLanguage() === "en") return message;
  const m = message.match(/^RUNTIME (ERROR|WARNING): (?:'([^']*)' )?(?:line (\d+): )?([\s\S]*)$/);
  if (!m) return translate(message);
  const kind = m[1] === "ERROR" ? "运行错误" : "运行警告";
  const where = [m[2], m[3] ? `第 ${m[3]} 行` : ""].filter(Boolean).join(" ");
  return `${kind}${where ? `(${where})` : ""}:${translate(m[4])}`;
}

export function translate(text: string): string {
  if (getLanguage() === "en") return text;
  for (const [re, fn] of zhTable) {
    const m = text.match(re);
    if (m) return fn(m);
  }
  return `${text}(暂无中文翻译)`;
}
