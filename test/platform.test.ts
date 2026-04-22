import { describe, test, expect } from "bun:test";
import { detectPlatform } from "../src/platform";

const CUSTOMIZER_LOAD_PATH =
  "/usr/local/lib/node_modules/@kiloclaw/kiloclaw-customizer";

// Every test passes an explicit `env` so tests never accidentally
// inherit KILOCODE_FEATURE / KILOCLAW_SANDBOX_ID from the developer's
// shell (which would mask an openclaw-classification bug).
const EMPTY_ENV: NodeJS.ProcessEnv = {};

describe("detectPlatform", () => {
  describe("returns openclaw when no signals hit", () => {
    test("null config, empty env", () => {
      expect(detectPlatform(null, EMPTY_ENV)).toBe("openclaw");
    });

    test("undefined config, empty env", () => {
      expect(detectPlatform(undefined, EMPTY_ENV)).toBe("openclaw");
    });

    test("empty object config, empty env", () => {
      expect(detectPlatform({}, EMPTY_ENV)).toBe("openclaw");
    });

    test("unrelated plugin entries, empty env", () => {
      const cfg = {
        plugins: {
          entries: {
            brave: { enabled: true },
            openai: { enabled: true },
          },
          load: { paths: ["/some/other/path"] },
        },
      };
      expect(detectPlatform(cfg, EMPTY_ENV)).toBe("openclaw");
    });

    test("customizer entry present but disabled does not count", () => {
      const cfg = {
        plugins: {
          entries: {
            "kiloclaw-customizer": { enabled: false },
          },
        },
      };
      expect(detectPlatform(cfg, EMPTY_ENV)).toBe("openclaw");
    });

    test("KILOCLAW_SANDBOX_ID set to empty string does not count", () => {
      expect(detectPlatform(null, { KILOCLAW_SANDBOX_ID: "" })).toBe(
        "openclaw",
      );
    });

    test("KILOCODE_FEATURE set to some other value does not count", () => {
      expect(detectPlatform(null, { KILOCODE_FEATURE: "something-else" })).toBe(
        "openclaw",
      );
    });
  });

  describe("returns kiloclaw on any single signal hit", () => {
    test("signal 2: plugins.entries.kiloclaw-customizer.enabled === true", () => {
      const cfg = {
        plugins: { entries: { "kiloclaw-customizer": { enabled: true } } },
      };
      expect(detectPlatform(cfg, EMPTY_ENV)).toBe("kiloclaw");
    });

    test("signal 3: plugins.load.paths contains the customizer path", () => {
      const cfg = {
        plugins: { load: { paths: [CUSTOMIZER_LOAD_PATH] } },
      };
      expect(detectPlatform(cfg, EMPTY_ENV)).toBe("kiloclaw");
    });

    test("signal 4: KILOCLAW_SANDBOX_ID env", () => {
      expect(
        detectPlatform(null, { KILOCLAW_SANDBOX_ID: "sandbox-abc123" }),
      ).toBe("kiloclaw");
    });

    test("signal 5: KILOCODE_FEATURE=kiloclaw env", () => {
      expect(detectPlatform(null, { KILOCODE_FEATURE: "kiloclaw" })).toBe(
        "kiloclaw",
      );
    });
  });

  describe("short-circuits on the first hit", () => {
    test("customizer entry hits even if env vars are absent", () => {
      const cfg = {
        plugins: { entries: { "kiloclaw-customizer": { enabled: true } } },
      };
      expect(detectPlatform(cfg, EMPTY_ENV)).toBe("kiloclaw");
    });

    test("env-only hit works when config is absent (older deployments)", () => {
      expect(detectPlatform(null, { KILOCODE_FEATURE: "kiloclaw" })).toBe(
        "kiloclaw",
      );
    });
  });

  describe("defensive against malformed config", () => {
    test("plugins.entries missing is safe", () => {
      const cfg = { plugins: {} };
      expect(detectPlatform(cfg, EMPTY_ENV)).toBe("openclaw");
    });

    test("plugins.entries is a non-object is safe", () => {
      const cfg = { plugins: { entries: "not-an-object" } };
      expect(detectPlatform(cfg, EMPTY_ENV)).toBe("openclaw");
    });

    test("plugins.load.paths is a non-array is safe", () => {
      const cfg = { plugins: { load: { paths: "not-an-array" } } };
      expect(detectPlatform(cfg, EMPTY_ENV)).toBe("openclaw");
    });

    test("deeply nested non-object path is safe", () => {
      const cfg = { plugins: { entries: { "kiloclaw-customizer": "scalar" } } };
      expect(detectPlatform(cfg, EMPTY_ENV)).toBe("openclaw");
    });
  });
});
