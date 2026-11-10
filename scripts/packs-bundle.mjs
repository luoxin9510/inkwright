// The first-party rule-system packs (packs/<id>/) as data for the plugin's new-game command (virtual:packs):
// { "<id>": { "<path in the pack>": "<text>" } }. A template's generated engine is left out: the plugin generates it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../packs", import.meta.url));

export function packsBundle() {
  const out = {};
  for (const id of readdirSync(ROOT).sort()) {
    const dir = join(ROOT, id);
    if (!statSync(dir).isDirectory()) continue;
    const files = {};
    const walk = (d) => {
      for (const name of readdirSync(d).sort()) {
        const p = join(d, name);
        if (name.startsWith(".")) continue;
        if (statSync(p).isDirectory()) walk(p);
        else {
          const rel = relative(dir, p).split("\\").join("/");
          if (rel !== "template/_engine.ink") files[rel] = readFileSync(p, "utf8");
        }
      }
    };
    walk(dir);
    out[id] = files;
  }
  return out;
}
