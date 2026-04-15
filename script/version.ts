#!/usr/bin/env bun

/**
 * Version resolution for @kilocode/openclaw-security-advisor.
 *
 * Two channels only:
 *   - `latest` — public stable releases. Versions are plain semver: 1.2.3.
 *   - `dev`    — internal dogfood snapshots. Versions are 1.2.3-dev.N
 *                where N is a monotonically increasing counter per (X.Y.Z).
 *
 * Inputs (env vars):
 *   KILO_CHANNEL  — "latest" | "dev". Defaults to "latest" when unset.
 *   KILO_BUMP     — "major" | "minor" | "patch". Optional.
 *   KILO_VERSION  — explicit version override. Wins over KILO_BUMP.
 *   GH_REPO       — "owner/repo" slug. Used to query gh releases.
 *
 * Stable (`channel=latest`):
 *   - Explicit KILO_VERSION wins.
 *   - Otherwise, query the highest existing stable tag (vX.Y.Z, no
 *     prerelease suffix) and bump it per KILO_BUMP (default: patch).
 *
 * Dev (`channel=dev`):
 *   - Explicit KILO_VERSION wins (must look like X.Y.Z-dev.N).
 *   - With KILO_BUMP: resets the dev cycle. Computes the next stable
 *     (highest stable + bump) and seeds it as ${next}-dev.1. Use this
 *     when starting a new dev cycle for the next major/minor/patch.
 *   - Without KILO_BUMP: queries the highest existing dev tag and
 *     increments its dev counter. Default workflow for "publish another
 *     snapshot in the current cycle."
 *   - First-ever dev cut (no prior dev tags): seeds at
 *     ${highest stable + 1 patch}-dev.1.
 *
 * Outputs (written to $GITHUB_OUTPUT when available):
 *   version, tag, channel, preview
 *
 * Side effects:
 *   - Rewrites package.json version field.
 *   - Throws if a release with the target tag already exists on GH_REPO.
 *
 * Local preview:
 *   KILO_CHANNEL=dev bun script/version.ts
 *   KILO_CHANNEL=latest KILO_BUMP=minor bun script/version.ts
 *
 * NB: intentionally inlined from the kilocode CLI's @opencode-ai/script
 * pattern (see kilocode/node_modules/@opencode-ai/script/src/index.ts).
 * No cross-repo dependency. Cross-check by hand if either repo's
 * version semantics change.
 */

import { $ } from "bun";

const NPM_PACKAGE = "@kilocode/openclaw-security-advisor";

const env = {
  KILO_CHANNEL: process.env.KILO_CHANNEL,
  KILO_BUMP: process.env.KILO_BUMP,
  KILO_VERSION: process.env.KILO_VERSION,
  GH_REPO: process.env.GH_REPO,
};

const CHANNEL = (() => {
  if (!env.KILO_CHANNEL) return "latest";
  if (env.KILO_CHANNEL !== "latest" && env.KILO_CHANNEL !== "dev") {
    throw new Error(
      `KILO_CHANNEL must be "latest" or "dev", got: ${env.KILO_CHANNEL}`,
    );
  }
  return env.KILO_CHANNEL;
})();

const IS_DEV = CHANNEL === "dev";

type StableVersion = {
  major: number;
  minor: number;
  patch: number;
  value: string; // "X.Y.Z"
};

type DevVersion = StableVersion & {
  dev: number;
  // value override: "X.Y.Z-dev.N"
};

function parseStable(input: string): StableVersion | undefined {
  const match = input.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    value: `${match[1]}.${match[2]}.${match[3]}`,
  };
}

function parseDev(input: string): DevVersion | undefined {
  const match = input.trim().match(/^v?(\d+)\.(\d+)\.(\d+)-dev\.(\d+)$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    dev: Number(match[4]),
    value: `${match[1]}.${match[2]}.${match[3]}-dev.${match[4]}`,
  };
}

function compareStable(a: StableVersion, b: StableVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function compareDev(a: DevVersion, b: DevVersion): number {
  const baseDelta = compareStable(a, b);
  if (baseDelta !== 0) return baseDelta;
  return a.dev - b.dev;
}

// Memoized so dev-resolution paths that need both the highest dev tag
// AND the highest stable tag (e.g. first-ever dev cut) only hit the
// GitHub API once instead of twice.
let cachedTags: string[] | undefined;
async function fetchAllTags(): Promise<string[]> {
  if (cachedTags !== undefined) return cachedTags;
  if (!env.GH_REPO) {
    cachedTags = [];
    return cachedTags;
  }
  try {
    const result =
      await $`gh release list --json tagName --limit 100 --repo ${env.GH_REPO}`.json();
    const releases = result as { tagName: string }[];
    cachedTags = releases.map((r) => r.tagName);
  } catch {
    // gh not installed, unauthed, or no releases yet.
    cachedTags = [];
  }
  return cachedTags;
}

async function fetchHighestStable(): Promise<StableVersion | undefined> {
  const tags = await fetchAllTags();
  const stables = tags.flatMap((t) => {
    const v = parseStable(t);
    return v ? [v] : [];
  });
  return stables.sort(compareStable).at(-1);
}

async function fetchHighestDev(): Promise<DevVersion | undefined> {
  const tags = await fetchAllTags();
  const devs = tags.flatMap((t) => {
    const v = parseDev(t);
    return v ? [v] : [];
  });
  return devs.sort(compareDev).at(-1);
}

async function fetchLatestStableFromNpm(): Promise<StableVersion> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`);
    if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
    const data = (await res.json()) as { version: string };
    const parsed = parseStable(data.version);
    if (parsed) return parsed;
  } catch {
    // Package not yet published or registry unreachable.
  }
  // Seed at 0.0.0 so the first patch bump lands at 0.0.1.
  return { major: 0, minor: 0, patch: 0, value: "0.0.0" };
}

function bumpStable(current: StableVersion, type: string): StableVersion {
  const kind = type.toLowerCase();
  if (kind === "major") {
    return {
      major: current.major + 1,
      minor: 0,
      patch: 0,
      value: `${current.major + 1}.0.0`,
    };
  }
  if (kind === "minor") {
    return {
      major: current.major,
      minor: current.minor + 1,
      patch: 0,
      value: `${current.major}.${current.minor + 1}.0`,
    };
  }
  if (kind === "patch") {
    return {
      major: current.major,
      minor: current.minor,
      patch: current.patch + 1,
      value: `${current.major}.${current.minor}.${current.patch + 1}`,
    };
  }
  throw new Error(
    `Unknown bump type: ${type} (expected major | minor | patch)`,
  );
}

function devToString(v: {
  major: number;
  minor: number;
  patch: number;
  dev: number;
}): string {
  return `${v.major}.${v.minor}.${v.patch}-dev.${v.dev}`;
}

async function resolveStableVersion(): Promise<string> {
  const current =
    (await fetchHighestStable()) ?? (await fetchLatestStableFromNpm());
  const bumped = bumpStable(current, env.KILO_BUMP ?? "patch");
  return bumped.value;
}

async function resolveDevVersion(): Promise<string> {
  if (env.KILO_BUMP) {
    // Reset dev cycle: seed next ${bump}.dev.1 from highest stable.
    const stable =
      (await fetchHighestStable()) ?? (await fetchLatestStableFromNpm());
    const next = bumpStable(stable, env.KILO_BUMP);
    return devToString({ ...next, dev: 1 });
  }
  // Continue dev cycle: increment counter on highest existing dev.
  const highestDev = await fetchHighestDev();
  if (highestDev) {
    return devToString({ ...highestDev, dev: highestDev.dev + 1 });
  }
  // First-ever dev cut: seed at next-patch-from-stable, dev.1.
  const stable =
    (await fetchHighestStable()) ?? (await fetchLatestStableFromNpm());
  const next = bumpStable(stable, "patch");
  return devToString({ ...next, dev: 1 });
}

const VERSION: string = await (async () => {
  if (env.KILO_VERSION) {
    const trimmed = env.KILO_VERSION.trim().replace(/^v/, "");
    // Validate: must be plain semver for latest, or X.Y.Z-dev.N for dev.
    if (CHANNEL === "latest") {
      if (!parseStable(trimmed)) {
        throw new Error(
          `KILO_VERSION must be plain semver (X.Y.Z) for channel=latest, got: ${env.KILO_VERSION}`,
        );
      }
    } else {
      if (!parseDev(trimmed)) {
        throw new Error(
          `KILO_VERSION must look like X.Y.Z-dev.N for channel=dev, got: ${env.KILO_VERSION}`,
        );
      }
    }
    return trimmed;
  }
  return CHANNEL === "latest"
    ? await resolveStableVersion()
    : await resolveDevVersion();
})();

const TAG = `v${VERSION}`;

// Guard against double-publishing: fail fast if a release with this tag
// already exists on the target repo. Skipped when GH_REPO is unset.
if (env.GH_REPO) {
  const existing = await $`gh release view ${TAG} --repo ${env.GH_REPO}`
    .nothrow()
    .quiet();
  if (existing.exitCode === 0) {
    throw new Error(
      `Release ${TAG} already exists on ${env.GH_REPO}. ` +
        `Bump the version or delete the existing release first.`,
    );
  }
}

// Rewrite package.json version in place.
const pkgPath = `${process.cwd()}/package.json`;
const pkg = await Bun.file(pkgPath).json();
pkg.version = VERSION;
await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// Emit outputs for the workflow to consume in downstream steps.
const outputs = [
  `version=${VERSION}`,
  `tag=${TAG}`,
  `channel=${CHANNEL}`,
  `preview=${IS_DEV}`,
];

if (process.env.GITHUB_OUTPUT) {
  const existing = await Bun.file(process.env.GITHUB_OUTPUT)
    .text()
    .catch(() => "");
  await Bun.write(
    process.env.GITHUB_OUTPUT,
    existing + outputs.join("\n") + "\n",
  );
}

console.log(
  JSON.stringify(
    { version: VERSION, tag: TAG, channel: CHANNEL, preview: IS_DEV },
    null,
    2,
  ),
);
