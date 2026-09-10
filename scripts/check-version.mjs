/**
 * Pre-deploy guard: verify the active version is synchronized everywhere.
 *
 * Enforces the project release rule by machine instead of memory:
 * package.json "version" must equal the `version` constant in
 * src/version.ts, and that version must have a patchUpdates entry
 * documenting the release. Run by CI on every push and by prepublishOnly,
 * so a mismatched or undocumented version can never be published.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const versionSource = readFileSync(join(root, "src", "version.ts"), "utf8");

// Extract: export const version = "x.y.z";
const match = versionSource.match(/export const version = "([^"]+)"/);
if (!match) {
  console.error("FAIL: could not find `export const version = \"...\"` in src/version.ts");
  process.exit(1);
}
const codeVersion = match[1];

const errors = [];
if (pkg.version !== codeVersion) {
  errors.push(`Version mismatch: package.json is ${pkg.version} but src/version.ts is ${codeVersion}`);
}

// The released version must be documented in patchUpdates.
if (!versionSource.includes(`version: "${pkg.version}"`)) {
  errors.push(`src/version.ts patchUpdates has no entry for version ${pkg.version} - document the release before publishing`);
}

if (errors.length > 0) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}
console.log(`OK: version ${pkg.version} is in sync (package.json, src/version.ts, patchUpdates)`);
