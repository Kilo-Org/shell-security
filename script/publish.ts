#!/usr/bin/env bun

/**
 * Publish script for @kilocode/openclaw-security-advisor.
 *
 * Reads the channel from KILO_CHANNEL ("latest" | "dev"); defaults to
 * "latest". Channel resolution must stay in sync with script/version.ts.
 *
 * The version itself is NOT computed here — it's already been written
 * into package.json by script/version.ts in an earlier workflow step.
 *
 * Strips `private: true` from package.json before packing, restores it after,
 * so the source file stays marked private as a safety net but the published
 * tarball is public.
 */

import { $ } from "bun";
import { fileURLToPath } from "url";

const dir = fileURLToPath(new URL("..", import.meta.url));
process.chdir(dir);

const channel = process.env.KILO_CHANNEL || "latest";
if (channel !== "latest" && channel !== "dev") {
  throw new Error(`KILO_CHANNEL must be "latest" or "dev", got: ${channel}`);
}

const raw = await Bun.file("package.json").text();
const pkg = JSON.parse(raw);

console.log(
  `Publishing @kilocode/openclaw-security-advisor@${pkg.version} → channel: ${channel}`,
);

const original = JSON.stringify(pkg, null, 2) + "\n";

// Strip private flag so npm allows publishing.
delete pkg.private;
await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n");

let tarball: string | undefined;
try {
  // `bun pm pack --quiet` writes only the tarball filename to stdout.
  // Capture it so subsequent steps (publish, cleanup) reference the exact
  // file this run produced — no `*.tgz` glob, no risk of grabbing a stale
  // tarball left over from a previous run.
  tarball = (await $`bun pm pack --quiet`.text()).trim();
  if (!tarball) {
    throw new Error("bun pm pack did not emit a tarball filename");
  }
  await $`npm publish ${tarball} --tag ${channel} --access public --provenance`;
} finally {
  // Always restore, even if publish fails.
  await Bun.write("package.json", original);
  // Clean up the exact tarball we created (if we got that far).
  if (tarball) {
    await $`rm -f ${tarball}`.nothrow();
  }
}

console.log("Done.");
