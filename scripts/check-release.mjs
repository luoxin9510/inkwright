// Checks what the Obsidian community directory checks about versions and builds:
// manifest/package/versions.json agree, and `npm run build` is reproducible
// (the directory rebuilds main.js and compares it with the release asset).
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const manifest = read("manifest.json");
const pkg = read("package.json");
const versions = read("versions.json");
const problems = [];

if (pkg.version !== manifest.version) problems.push(`package.json version ${pkg.version} != manifest.json ${manifest.version}`);
if (versions[manifest.version] !== manifest.minAppVersion) {
  problems.push(`versions.json["${manifest.version}"] should be "${manifest.minAppVersion}" (manifest minAppVersion)`);
}
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : null;
if (tag !== null && tag !== manifest.version) problems.push(`tag ${tag} != manifest.json version ${manifest.version}`);

const build = () => {
  execSync("npm run build", { stdio: "ignore" });
  return createHash("sha256").update(readFileSync("main.js")).digest("hex");
};
const first = build();
if (build() !== first) problems.push("npm run build is not reproducible: two builds produced different main.js");

if (problems.length > 0) {
  for (const p of problems) console.error("✗ " + p);
  process.exit(1);
}
console.log(`✓ version ${manifest.version} consistent, build reproducible (main.js sha256 ${first.slice(0, 12)})`);
