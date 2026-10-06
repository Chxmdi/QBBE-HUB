import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, createNonce } from "@/lib/security/content-security-policy";

/** The sources one directive lists. */
function sources(policy: string, name: string): string[] {
  return policy.split("; ").find((directive) => directive.startsWith(`${name} `))!.split(" ").slice(1);
}

const policy = (supabaseUrl: string | undefined, development = false) =>
  contentSecurityPolicy({ nonce: "abc123", development, supabaseUrl });

describe("content security policy: connect-src (staging audit S3)", () => {
  it("names only this deployment's Supabase project, not every *.supabase.co project", () => {
    const connect = sources(policy("https://agddtahflrxaywkioaeh.supabase.co"), "connect-src");
    expect(connect).toContain("https://agddtahflrxaywkioaeh.supabase.co");
    expect(connect).toContain("wss://agddtahflrxaywkioaeh.supabase.co");
    expect(connect.filter((source) => source.includes("*.supabase.co"))).toEqual([]);
  });

  it("allows a local stack by its own address", () => {
    const connect = sources(policy("http://127.0.0.1:54321"), "connect-src");
    expect(connect).toEqual(expect.arrayContaining(["http://127.0.0.1:54321", "ws://127.0.0.1:54321"]));
    expect(connect.filter((source) => source.includes("*.supabase.co"))).toEqual([]);
  });

  it("falls back to the hosted wildcard only when no project is configured", () => {
    const connect = sources(policy(undefined), "connect-src");
    expect(connect).toEqual(expect.arrayContaining(["https://*.supabase.co", "wss://*.supabase.co"]));
  });
});

describe("content security policy: script-src (staging audit S1)", () => {
  it("runs only scripts carrying this request's nonce, and never inline script or eval in production", () => {
    const script = sources(policy("https://x.supabase.co"), "script-src");
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    // WebAssembly for receipt reading, and nothing else of eval.
    expect(script).toContain("'wasm-unsafe-eval'");
  });

  it("allows eval only on the development server, which needs it for fast refresh", () => {
    expect(sources(policy("https://x.supabase.co", true), "script-src")).toContain("'unsafe-eval'");
  });

  it("refuses plugins and keeps framing and form targets closed", () => {
    const text = policy("https://x.supabase.co");
    expect(sources(text, "object-src")).toEqual(["'none'"]);
    expect(sources(text, "frame-ancestors")).toEqual(["'none'"]);
    expect(sources(text, "form-action")).toEqual(["'self'"]);
  });

  it("makes a different, unguessable nonce for every request", () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });
});
