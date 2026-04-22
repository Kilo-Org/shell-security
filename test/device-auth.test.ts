import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { startDeviceAuth } from "../src/auth/device-auth";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(response: unknown, { ok = true, status = 200 } = {}): void {
  const stub: typeof fetch = async () =>
    new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  // ok is derived from status in Response, so we rely on status here.
  // Allow callers to force ok=false by passing status>=400.
  void ok;
  globalThis.fetch = stub;
}

describe("startDeviceAuth", () => {
  test("rewrites the path on the server-provided URL to /openclaw-advisor", async () => {
    stubFetch({
      code: "ABCD-1234",
      verificationUrl: "https://app.kilo.ai/device-auth?code=ABCD-1234",
      expiresIn: 600,
    });

    const result = await startDeviceAuth("https://app.kilo.ai");

    expect(result.kind).toBe("started");
    expect(result.code).toBe("ABCD-1234");
    expect(result.verificationUrl).toBe(
      "https://app.kilo.ai/openclaw-advisor?code=ABCD-1234",
    );
    expect(result.expiresIn).toBe(600);
  });

  test("preserves the server-provided origin, not apiBase, when they differ (prod)", async () => {
    // Regression: in production, apiBase is the API host (api.kilo.ai) but
    // the server builds verificationUrl from APP_URL (app.kilo.ai). Rebuilding
    // the link from apiBase would send users to a nonexistent endpoint.
    stubFetch({
      code: "QWER-7890",
      verificationUrl: "https://app.kilo.ai/device-auth?code=QWER-7890",
      expiresIn: 600,
    });

    const result = await startDeviceAuth("https://api.kilo.ai");

    expect(result.verificationUrl).toBe(
      "https://app.kilo.ai/openclaw-advisor?code=QWER-7890",
    );
  });

  test("preserves the dev-loop origin (host.docker.internal / localhost)", async () => {
    stubFetch({
      code: "WXYZ-5678",
      verificationUrl:
        "http://host.docker.internal:3000/device-auth?code=WXYZ-5678",
      expiresIn: 600,
    });

    const result = await startDeviceAuth("http://host.docker.internal:3000");

    expect(result.verificationUrl).toBe(
      "http://host.docker.internal:3000/openclaw-advisor?code=WXYZ-5678",
    );
  });

  test("preserves the ?code= query verbatim from the server-provided URL", async () => {
    // The server is the source of truth for the query string. We only swap
    // the pathname; we never reconstruct the query from the bare `code` field.
    stubFetch({
      code: "UVWX-9999",
      verificationUrl:
        "https://app.kilo.ai/device-auth?code=UVWX-9999&state=extra",
      expiresIn: 600,
    });

    const result = await startDeviceAuth("https://api.kilo.ai");

    expect(result.verificationUrl).toBe(
      "https://app.kilo.ai/openclaw-advisor?code=UVWX-9999&state=extra",
    );
  });

  test("throws a descriptive error when the server rejects the request", async () => {
    stubFetch({}, { status: 500 });

    await expect(startDeviceAuth("https://app.kilo.ai")).rejects.toThrow(
      /HTTP 500/,
    );
  });
});
