import { afterEach, describe, expect, it, vi } from "vitest";

/** The connect-src list next.config.ts sends, built with the given project address. */
async function connectSources(supabaseUrl: string | undefined): Promise<string[]> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl ?? "");
  const { default: config } = await import("../../next.config");
  const rules = await config.headers!();
  const policy = rules[0].headers.find((header) => header.key === "Content-Security-Policy")!.value;
  return policy.split("; ").find((directive) => directive.startsWith("connect-src "))!.split(" ").slice(1);
}

afterEach(() => vi.unstubAllEnvs());

describe("content security policy: connect-src (staging audit S3)", () => {
  it("names only this deployment's Supabase project, not every *.supabase.co project", async () => {
    const sources = await connectSources("https://agddtahflrxaywkioaeh.supabase.co");
    expect(sources).toContain("https://agddtahflrxaywkioaeh.supabase.co");
    expect(sources).toContain("wss://agddtahflrxaywkioaeh.supabase.co");
    expect(sources.filter((source) => source.includes("*.supabase.co"))).toEqual([]);
  });

  it("allows a local stack by its own address", async () => {
    const sources = await connectSources("http://127.0.0.1:54321");
    expect(sources).toEqual(expect.arrayContaining(["http://127.0.0.1:54321", "ws://127.0.0.1:54321"]));
    expect(sources.filter((source) => source.includes("*.supabase.co"))).toEqual([]);
  });

  it("falls back to the hosted wildcard only when no project is configured", async () => {
    const sources = await connectSources(undefined);
    expect(sources).toEqual(expect.arrayContaining(["https://*.supabase.co", "wss://*.supabase.co"]));
  });
});
