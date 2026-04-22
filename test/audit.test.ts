import { describe, test, expect } from "bun:test";
import { isValidIp, AuditOutputSchema } from "../src/audit";

describe("isValidIp", () => {
  test("accepts canonical IPv4", () => {
    expect(isValidIp("1.2.3.4")).toBe(true);
    expect(isValidIp("0.0.0.0")).toBe(true);
    expect(isValidIp("255.255.255.255")).toBe(true);
    expect(isValidIp("192.168.1.1")).toBe(true);
  });

  test("rejects malformed IPv4", () => {
    expect(isValidIp("256.1.1.1")).toBe(false);
    expect(isValidIp("1.2.3")).toBe(false);
    expect(isValidIp("1.2.3.4.5")).toBe(false);
    expect(isValidIp("1.2.3.a")).toBe(false);
    expect(isValidIp("")).toBe(false);
  });

  test("accepts canonical IPv6", () => {
    expect(isValidIp("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
  });

  test("accepts compressed IPv6", () => {
    expect(isValidIp("2001:db8::1")).toBe(true);
    expect(isValidIp("::1")).toBe(true);
    expect(isValidIp("fe80::")).toBe(true);
  });

  test("rejects IPv6 with brackets, ports, or trailing junk", () => {
    expect(isValidIp("[::1]")).toBe(false);
    expect(isValidIp("[2001:db8::1]:8080")).toBe(false);
    expect(isValidIp("2001:db8::1 ")).toBe(false);
    expect(isValidIp("2001:db8::1\n")).toBe(false);
  });

  test("rejects obvious non-IP input", () => {
    expect(isValidIp("example.com")).toBe(false);
    expect(isValidIp("localhost")).toBe(false);
    expect(isValidIp("not an ip")).toBe(false);
  });
});

describe("AuditOutputSchema", () => {
  const happyPath = {
    ts: 1700000000,
    summary: { critical: 1, warn: 2, info: 3 },
    findings: [
      {
        checkId: "check1",
        severity: "critical",
        title: "Title",
        detail: "Detail",
      },
    ],
  };

  test("accepts a minimal valid audit", () => {
    const result = AuditOutputSchema.safeParse(happyPath);
    expect(result.success).toBe(true);
  });

  test("accepts audits with optional deep and secretDiagnostics", () => {
    const result = AuditOutputSchema.safeParse({
      ...happyPath,
      deep: { foo: "bar" },
      secretDiagnostics: [{ kind: "warn" }],
    });
    expect(result.success).toBe(true);
  });

  test("accepts findings with nullable remediation", () => {
    const result = AuditOutputSchema.safeParse({
      ...happyPath,
      findings: [
        { ...happyPath.findings[0], remediation: null },
        { ...happyPath.findings[0], remediation: "fix it" },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects audits missing ts", () => {
    const { ts: _ts, ...rest } = happyPath;
    expect(AuditOutputSchema.safeParse(rest).success).toBe(false);
  });

  test("rejects audits with invalid severity", () => {
    const result = AuditOutputSchema.safeParse({
      ...happyPath,
      findings: [{ ...happyPath.findings[0], severity: "high" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects audits with non-number summary counts", () => {
    const result = AuditOutputSchema.safeParse({
      ...happyPath,
      summary: { critical: "1", warn: 2, info: 3 },
    });
    expect(result.success).toBe(false);
  });

  test("accepts an empty findings array", () => {
    const result = AuditOutputSchema.safeParse({
      ...happyPath,
      findings: [],
    });
    expect(result.success).toBe(true);
  });
});
