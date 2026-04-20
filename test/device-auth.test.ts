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
  test("constructs the openclaw-advisor verification URL from the returned code, ignoring the server-returned verificationUrl", async () => {
    // Server returns a legacy /device-auth?code=... URL — plugin should ignore it.
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

  test("uses the caller-provided apiBase for the verification URL (dev loop)", async () => {
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

  test("url-encodes the code to defend against unexpected server responses", async () => {
    // Defense-in-depth: even if the server returned a malformed code, we must
    // not inject unescaped query chars into the verification URL.
    stubFetch({
      code: "A&B=C D",
      verificationUrl: "ignored",
      expiresIn: 600,
    });

    const result = await startDeviceAuth("https://app.kilo.ai");

    expect(result.verificationUrl).toBe(
      "https://app.kilo.ai/openclaw-advisor?code=A%26B%3DC%20D",
    );
  });

  test("throws a descriptive error when the server rejects the request", async () => {
    stubFetch({}, { status: 500 });

    await expect(startDeviceAuth("https://app.kilo.ai")).rejects.toThrow(
      /HTTP 500/,
    );
  });
});
