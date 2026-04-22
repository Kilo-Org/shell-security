import { describe, test, expect } from "bun:test";
import { patchConfig } from "../src/auth/token-store";

const TEST_PATH =
  "/home/node/.openclaw/secrets/openclaw-security-advisor-auth-token";

function getAuthToken(cfg: unknown): unknown {
  const root = cfg as Record<string, unknown>;
  const plugins = root.plugins as Record<string, unknown>;
  const entries = plugins.entries as Record<string, unknown>;
  const entry = entries["openclaw-security-advisor"] as Record<string, unknown>;
  const config = entry.config as Record<string, unknown>;
  return config.authToken;
}

function getProvider(cfg: unknown): unknown {
  const root = cfg as Record<string, unknown>;
  const secrets = root.secrets as Record<string, unknown>;
  const providers = secrets.providers as Record<string, unknown>;
  return providers.kilocode_security_advisor;
}

describe("patchConfig", () => {
  test("patches an empty config", () => {
    const next = patchConfig({}, TEST_PATH);
    expect(getProvider(next)).toEqual({
      source: "file",
      path: TEST_PATH,
      mode: "singleValue",
    });
    expect(getAuthToken(next)).toEqual({
      source: "file",
      provider: "kilocode_security_advisor",
      id: "value",
    });
  });

  test("treats null/undefined config as empty", () => {
    expect(() => patchConfig(null, TEST_PATH)).not.toThrow();
    expect(() => patchConfig(undefined, TEST_PATH)).not.toThrow();
    const next = patchConfig(null, TEST_PATH);
    expect(getProvider(next)).toBeDefined();
    expect(getAuthToken(next)).toBeDefined();
  });

  test("preserves unrelated plugin entries", () => {
    const cfg = {
      plugins: {
        entries: {
          "some-other-plugin": { config: { key: "value" } },
        },
      },
    };
    const next = patchConfig(cfg, TEST_PATH) as Record<string, unknown>;
    const plugins = next.plugins as Record<string, unknown>;
    const entries = plugins.entries as Record<string, unknown>;
    expect(entries["some-other-plugin"]).toEqual({
      config: { key: "value" },
    });
    expect(entries["openclaw-security-advisor"]).toBeDefined();
  });

  test("preserves unrelated secret providers", () => {
    const cfg = {
      secrets: {
        providers: {
          other_provider: { source: "env", path: "OTHER_TOKEN" },
        },
      },
    };
    const next = patchConfig(cfg, TEST_PATH) as Record<string, unknown>;
    const secrets = next.secrets as Record<string, unknown>;
    const providers = secrets.providers as Record<string, unknown>;
    expect(providers.other_provider).toEqual({
      source: "env",
      path: "OTHER_TOKEN",
    });
    expect(providers.kilocode_security_advisor).toBeDefined();
  });

  test("overwrites existing authToken for this plugin", () => {
    const cfg = {
      plugins: {
        entries: {
          "openclaw-security-advisor": {
            config: {
              authToken: "stale-plain-string",
              apiBaseUrl: "http://host.docker.internal:3000",
            },
          },
        },
      },
    };
    const next = patchConfig(cfg, TEST_PATH);
    expect(getAuthToken(next)).toEqual({
      source: "file",
      provider: "kilocode_security_advisor",
      id: "value",
    });
    // apiBaseUrl should survive
    const root = next as Record<string, unknown>;
    const plugins = root.plugins as Record<string, unknown>;
    const entries = plugins.entries as Record<string, unknown>;
    const entry = entries["openclaw-security-advisor"] as Record<
      string,
      unknown
    >;
    const config = entry.config as Record<string, unknown>;
    expect(config.apiBaseUrl).toBe("http://host.docker.internal:3000");
  });

  test("preserves other top-level keys", () => {
    const cfg = {
      model: "gpt-4o",
      theme: "dark",
    };
    const next = patchConfig(cfg, TEST_PATH) as Record<string, unknown>;
    expect(next.model).toBe("gpt-4o");
    expect(next.theme).toBe("dark");
    expect(next.secrets).toBeDefined();
    expect(next.plugins).toBeDefined();
  });

  test("tolerates corrupt nested shapes (non-object plugins)", () => {
    const cfg = { plugins: "not-an-object" };
    expect(() => patchConfig(cfg, TEST_PATH)).not.toThrow();
    const next = patchConfig(cfg, TEST_PATH);
    expect(getAuthToken(next)).toBeDefined();
  });
});
