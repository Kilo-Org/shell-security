#!/usr/bin/env bun

/**
 * CI preflight that runs @kilocode/shell-security through the REAL
 * OpenClaw install path — the same code path an end user hits when
 * they type `openclaw plugins install @kilocode/shell-security`.
 *
 * Steps:
 *   1. Pack this plugin into a tarball (strips `private: true` the
 *      same way script/publish.ts does, then restores it).
 *   2. Install `openclaw@latest` into a throwaway node_modules.
 *   3. Run `openclaw plugins install <tarball>` against a throwaway
 *      OPENCLAW_STATE_DIR.
 *   4. Exit with whatever exit code `openclaw plugins install` gave
 *      us. Non-zero = scanner/denylist rejection = CI fails.
 *
 * NO bypass flags. Never add `--dangerously-force-unsafe-install`,
 * `--force`, `--skip-scan`, or any other "ignore the safety gate"
 * option to this script. The whole point is to exercise the real
 * gate. If the gate rejects the plugin, the fix is in the plugin
 * source (see src/env.ts for the project's env-isolation convention)
 * — never in this script.
 *
 * `OPENCLAW_DISABLE_BUNDLED_PLUGIN_POSTINSTALL=1` below is NOT a
 * bypass flag. It skips openclaw's postinstall step that sets up
 * compat sidecars for bundled channel plugins (Telegram, Slack,
 * Matrix, etc.) used by the gateway itself — none of which is
 * relevant to `plugins install`. The scanner code path this script
 * exercises is unaffected. Removing it just makes CI slower.
 *
 * Run locally: `bun run install-preflight`
 * CI: `.github/workflows/install-preflight.yml`
 */

import { $ } from "bun";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
process.chdir(repoRoot);

const pkgPath = path.join(repoRoot, "package.json");
const originalPkgText = await fs.readFile(pkgPath, "utf8");

// The finally block restores package.json and cleans up artifacts. It
// is critical that ANY mutation of pkgPath happens inside the try so
// the restore is always armed, and that we NEVER call `process.exit()`
// inside the try — that would terminate the process immediately and
// skip finally, leaving `private: true` stripped permanently (which
// is exactly the publish-safety regression this script must not cause).
// Instead we set `process.exitCode` at the bottom and let the event
// loop drain normally.
let tarball: string | undefined;
let ciTmp: string | undefined;
let openclawExit = 0;
try {
  // --- Pack --------------------------------------------------------
  const pkg = JSON.parse(originalPkgText);
  delete pkg.private;
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // `bun pm pack --quiet` emits only the tarball filename.
  tarball = (await $`bun pm pack --quiet`.text()).trim();
  if (!tarball) throw new Error("bun pm pack produced no tarball");
  console.log(`Packed: ${tarball}`);

  // --- Install openclaw --------------------------------------------
  ciTmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-preflight-"));
  const stateDir = path.join(ciTmp, "state");
  const nodeRoot = path.join(ciTmp, "node");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(nodeRoot, { recursive: true });

  const latest = (await $`npm view openclaw dist-tags.latest`.text()).trim();
  console.log(`Resolved openclaw@${latest}`);

  // Minimal scratch package so npm has somewhere to land node_modules.
  await fs.writeFile(
    path.join(nodeRoot, "package.json"),
    JSON.stringify(
      { name: "openclaw-preflight-scratch", private: true },
      null,
      2,
    ) + "\n",
  );

  process.env.OPENCLAW_DISABLE_BUNDLED_PLUGIN_POSTINSTALL = "1";
  await $`npm install --prefix ${nodeRoot} --no-save openclaw@${latest}`;

  // --- Run the real install ----------------------------------------
  process.env.OPENCLAW_STATE_DIR = stateDir;
  const tarballAbs = path.resolve(repoRoot, tarball);
  const cli = path.join(nodeRoot, "node_modules", ".bin", "openclaw");
  console.log(`Running: ${cli} plugins install ${tarballAbs}`);
  const result = await $`${cli} plugins install ${tarballAbs}`.nothrow();

  if (result.exitCode !== 0) {
    console.error(
      `\nFAIL: openclaw plugins install exited ${result.exitCode}. See output above.`,
    );
    console.error(
      "If this is an env-harvesting or other scanner rejection, the fix is in the plugin source (see src/env.ts for the project's env-isolation convention). Do NOT add a bypass flag to this script.",
    );
    openclawExit = result.exitCode;
  } else {
    console.log("\nOK: openclaw plugins install succeeded");
  }
} finally {
  // Always restore package.json (restores `private: true`), always
  // clean up the tarball, always clean up the scratch openclaw install
  // dir so repeated local runs don't accumulate ~400MB of node_modules
  // under os.tmpdir().
  await fs.writeFile(pkgPath, originalPkgText);
  if (tarball) {
    await $`rm -f ${tarball}`.nothrow();
  }
  if (ciTmp) {
    await $`rm -rf ${ciTmp}`.nothrow();
  }
}

process.exitCode = openclawExit;
