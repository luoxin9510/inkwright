/** The folder a vault path is in, with its trailing slash ("" at the vault's top). */
export function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/** A story's name for journals: its folder's name, or the vault's when it sits at the top. */
export function storyName(root: string, vaultName: string): string {
  const dir = folderOf(root);
  return dir === "" ? vaultName : dir.slice(0, -1).split("/").pop() ?? "story";
}
