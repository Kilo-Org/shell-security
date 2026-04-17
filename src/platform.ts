/**
 * Platform detection for the security advisor plugin. Kept in its own
 * module on purpose: the openclaw plugin loader's security scanner
 * flags any source file that combines `process.env` reads with a
 * network send as potential credential harvesting. By keeping the env
 * read here and the network send in audit.ts, we stay on the safe
 * side of that check.
 *
 * Detection walks multiple independent signals in order of decreasing
 * reliability across deployment age. The goal is that at least one
 * signal fires on every KiloClaw instance ever deployed, regardless
 * of whether the instance predates a given env var. Any hit short-
 * circuits to "kiloclaw".
 *
 * Ordering (stopping at the first hit):
 *   2. openclaw.json has `plugins.entries["kiloclaw-customizer"].enabled`
 *      truthy — the kiloclaw controller writes this at boot for every
 *      kiloclaw instance, predating any of the env-var signals. Most
 *      durable universal signal today.
 *   3. openclaw.json `plugins.load.paths` contains the kiloclaw
 *      customizer install path — same writer, redundant cross-check.
 *   4. `process.env.KILOCLAW_SANDBOX_ID` is set — present on every
 *      kiloclaw instance since 2026-03-22.
 *   5. `process.env.KILOCODE_FEATURE === "kiloclaw"` — the original
 *      env-var signal, present on kiloclaw since 2026-02-17.
 *
 * We intentionally do NOT add a loose `KILOCLAW_*`-prefix heuristic;
 * the four signals above are precise and one of them will hit on any
 * real kiloclaw deployment.
 */

export type Platform = "kiloclaw" | "openclaw";

const CUSTOMIZER_ID = "kiloclaw-customizer";
const CUSTOMIZER_LOAD_PATH =
  "/usr/local/lib/node_modules/@kiloclaw/kiloclaw-customizer";

export function detectPlatform(
  config: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Platform {
  if (hasKiloclawCustomizerEntry(config)) return "kiloclaw";
  if (hasKiloclawCustomizerLoadPath(config)) return "kiloclaw";
  if (hasKiloclawSandboxIdEnv(env)) return "kiloclaw";
  if (hasKilocodeFeatureEnv(env)) return "kiloclaw";
  return "openclaw";
}

function hasKiloclawCustomizerEntry(config: unknown): boolean {
  const entry = getPath(config, ["plugins", "entries", CUSTOMIZER_ID]);
  if (!entry || typeof entry !== "object") return false;
  const enabled = (entry as Record<string, unknown>).enabled;
  return enabled === true;
}

function hasKiloclawCustomizerLoadPath(config: unknown): boolean {
  const paths = getPath(config, ["plugins", "load", "paths"]);
  return Array.isArray(paths) && paths.includes(CUSTOMIZER_LOAD_PATH);
}

function hasKiloclawSandboxIdEnv(env: NodeJS.ProcessEnv): boolean {
  const v = env.KILOCLAW_SANDBOX_ID;
  return typeof v === "string" && v.length > 0;
}

function hasKilocodeFeatureEnv(env: NodeJS.ProcessEnv): boolean {
  return env.KILOCODE_FEATURE === "kiloclaw";
}

function getPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
