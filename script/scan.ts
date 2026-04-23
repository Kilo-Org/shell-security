#!/usr/bin/env bun

/**
 * CI preflight for OpenClaw's install-time `env-harvesting` scanner
 * rule (`openclaw/src/security/skill-scanner.ts`). Reads every file
 * the published tarball would include and fails if any of them would
 * trigger the rule under either the pre-2026-04-16 (v2026.4.9-era)
 * regex OR the tightened post-commit-678b019467 (origin/main) regex.
 *
 * The rule fires on a single file that contains BOTH env-var reads
 * AND a network-send pattern. This project's convention is to keep
 * env reads in `src/env.ts` and network sends in `src/client.ts` /
 * `src/audit.ts` / `src/auth/device-auth.ts`, so no file ever has
 * both and the rule cannot fire by construction. This script is the
 * enforcement mechanism that keeps the convention honest.
 *
 * Run locally: `bun run scan`
 * CI: `.github/workflows/scan.yml`
 *
 * The two regex variants are copied verbatim from OpenClaw source so
 * we stay in sync without a runtime dependency on the gateway. A
 * future follow-up will replace this with a matrix CI job that runs
 * `openclaw plugins install --link .` against real pinned gateway
 * versions, removing the need for a hand-copied regex altogether.
 */

import fs from "node:fs";
import path from "node:path";
import pkg from "../package.json" with { type: "json" };

// Mirrors openclaw `SCANNABLE_EXTENSIONS`. Extensions outside this
// set (e.g. `.md`, `.json`) are not scanned by the gateway's
// install-time scanner, so we don't need to check them here either.
const SCANNABLE_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".jsx",
  ".tsx",
]);

const ENV_READ = /process\.env/;
// Pre-2026-04-16 (e.g. v2026.4.9): matches standalone words.
const NET_OLD = /\bfetch\b|\bpost\b|http\.request/i;
// Post-commit-678b019467 (origin/main): requires an open paren.
const NET_NEW = /\bfetch\s*\(|\bpost\s*\(|\.\s*post\s*\(|http\.request\s*\(/i;

function walk(entry: string, out: string[] = []): string[] {
  if (!fs.existsSync(entry)) return out;
  const stat = fs.statSync(entry);
  if (stat.isFile()) {
    if (SCANNABLE_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
      out.push(entry);
    }
    return out;
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(entry)) {
      walk(path.join(entry, name), out);
    }
  }
  return out;
}

// Scan the paths the published tarball includes (per package.json
// `files`). `walk()` treats each entry as a literal path; if the
// field gains glob syntax (`*`, `?`) we fail fast rather than
// silently under-reporting, since the intended replacement is
// `npm pack --dry-run --json` for exact file enumeration.
const fileRoots = (pkg as { files?: string[] }).files ?? [];
const files: string[] = [];
for (const root of fileRoots) {
  if (root.includes("*") || root.includes("?")) {
    console.error(
      `scan.ts: pkg.files contains a glob pattern ("${root}"); switch to \`npm pack --dry-run --json\` for accurate file enumeration.`,
    );
    process.exit(2);
  }
  walk(root, files);
}
files.sort();

const byFile = new Map<string, Set<"old" | "new">>();
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  if (!ENV_READ.test(source)) continue;
  const variants = new Set<"old" | "new">();
  if (NET_OLD.test(source)) variants.add("old");
  if (NET_NEW.test(source)) variants.add("new");
  if (variants.size > 0) byFile.set(file, variants);
}

if (byFile.size > 0) {
  console.error(
    "env-harvesting scanner rule would block install on these files:",
  );
  for (const [file, variants] of byFile) {
    const labels: string[] = [];
    if (variants.has("old")) labels.push("v2026.4.9-era regex");
    if (variants.has("new")) labels.push("origin/main regex");
    console.error(`  ${file}  (trips ${labels.join(", ")})`);
  }
  console.error(
    "\nFix: keep env reads and network-send tokens in separate files.",
  );
  console.error("See src/env.ts for the project's env-isolation convention.");
  process.exit(1);
}

console.log(
  `Scanned ${files.length} file(s). env-harvesting rule would NOT fire under either regex variant.`,
);
