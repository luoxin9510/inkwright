import type { Files } from "../src/play/store";

/** A folder tree in memory, like Obsidian's DataAdapter. */
export class MemoryFiles implements Files {
  files = new Map<string, string>();
  async exists(p: string) { return this.files.has(p) || [...this.files.keys()].some((k) => k.startsWith(p + "/")); }
  async read(p: string) { const v = this.files.get(p); if (v === undefined) throw new Error("missing " + p); return v; }
  async write(p: string, d: string) { this.files.set(p, d); }
  async mkdir(_p: string) {}
  async remove(p: string) { this.files.delete(p); }
  async rmdir(p: string) { for (const k of [...this.files.keys()]) if (k.startsWith(p + "/")) this.files.delete(k); }
  async rename(a: string, b: string) {
    for (const [k, v] of [...this.files]) if (k.startsWith(a + "/")) { this.files.delete(k); this.files.set(b + k.slice(a.length), v); }
  }
  async list(p: string) {
    const files = new Set<string>(), folders = new Set<string>();
    for (const k of this.files.keys()) {
      if (!k.startsWith(p + "/")) continue;
      const rest = k.slice(p.length + 1);
      const i = rest.indexOf("/");
      if (i < 0) files.add(k); else folders.add(p + "/" + rest.slice(0, i));
    }
    return { files: [...files], folders: [...folders] };
  }
}
