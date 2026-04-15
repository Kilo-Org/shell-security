import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";

// version.ts validation tests.
//
// All validation errors thrown by script/version.ts happen before any
// network call (gh release list / npm registry fetch), so these tests
// are fast and don't need internet. They run version.ts as a subprocess
// because the script uses top-level await + module-level side effects
// (writes package.json, writes $GITHUB_OUTPUT) that aren't friendly to
// in-process import.
//
// The validation paths exercised here all error BEFORE the package.json
// write step, so the local file is never modified. As a defensive
// measure we still snapshot + restore package.json around the suite.

const PKG_PATH = `${process.cwd()}/package.json`;
let pkgBackup: string;

beforeAll(() => {
  pkgBackup = readFileSync(PKG_PATH, "utf-8");
});

afterAll(() => {
  writeFileSync(PKG_PATH, pkgBackup);
});

// Build a clean env that overrides any KILO_*/GH_* vars leaking from the
// developer's shell, while preserving PATH/HOME so `bun` itself can run.
function testEnv(overrides: Record<string, string>): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    KILO_CHANNEL: "",
    KILO_BUMP: "",
    KILO_VERSION: "",
    GH_REPO: "",
    GH_TOKEN: "",
    GITHUB_OUTPUT: "",
    ...overrides,
  };
}

async function runVersion(
  overrides: Record<string, string>,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const result = await $`bun script/version.ts`
    .env(testEnv(overrides))
    .nothrow()
    .quiet();
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

describe("version.ts channel validation", () => {
  test("rejects KILO_CHANNEL=beta", async () => {
    const result = await runVersion({ KILO_CHANNEL: "beta" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('KILO_CHANNEL must be "latest" or "dev"');
  });

  test("rejects KILO_CHANNEL=rc", async () => {
    const result = await runVersion({ KILO_CHANNEL: "rc" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('KILO_CHANNEL must be "latest" or "dev"');
  });

  test("rejects KILO_CHANNEL=anything-else", async () => {
    const result = await runVersion({ KILO_CHANNEL: "experimental" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('KILO_CHANNEL must be "latest" or "dev"');
  });
});

describe("version.ts version-format validation", () => {
  test("rejects dev-suffix version on latest channel", async () => {
    const result = await runVersion({
      KILO_CHANNEL: "latest",
      KILO_VERSION: "0.1.0-dev.1",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "must be plain semver (X.Y.Z) for channel=latest",
    );
  });

  test("rejects plain semver on dev channel", async () => {
    const result = await runVersion({
      KILO_CHANNEL: "dev",
      KILO_VERSION: "0.1.0",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "must look like X.Y.Z-dev.N for channel=dev",
    );
  });

  test("rejects garbage version string", async () => {
    const result = await runVersion({
      KILO_CHANNEL: "latest",
      KILO_VERSION: "not-a-version",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("must be plain semver");
  });

  test("rejects unknown bump type", async () => {
    const result = await runVersion({
      KILO_CHANNEL: "latest",
      KILO_BUMP: "sideways",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown bump type: sideways");
  });
});
