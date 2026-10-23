import { describe, expect, it } from "vitest";
import { isDeployedEnvironment, keyProjectRef, serverEnvProblems } from "@/lib/env";

const REF = "abcdefghijklmnopqrst";
const OTHER = "zyxwvutsrqponmlkjihg";
const jwt = (claims: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

const good = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: REF, role: "anon" }),
  SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: REF, role: "service_role" }),
  CRON_JOB_SECRET: "s".repeat(40),
  // 32 bytes in base64 (the Google token key, PRIV-011).
  GOOGLE_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
  NEXT_PUBLIC_APP_URL: "https://hub.example.org",
};

describe("serverEnvProblems", () => {
  it("accepts complete settings", () => {
    expect(serverEnvProblems(good)).toEqual([]);
  });

  it("names a missing service role key without printing any value", () => {
    const problems = serverEnvProblems({ ...good, SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(problems).toEqual(["SUPABASE_SERVICE_ROLE_KEY is not set."]);
  });

  it("refuses a short job secret and a non-https site address", () => {
    expect(serverEnvProblems({ ...good, NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000" })).toEqual([]);
    const problems = serverEnvProblems({ ...good, QBBE_ENV: "staging", CRON_JOB_SECRET: "tiny-xyz", NEXT_PUBLIC_APP_URL: "http://hub.example.org" });
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).not.toContain("tiny-xyz");
  });

  it("refuses a key issued for another Supabase project", () => {
    const problems = serverEnvProblems({ ...good, SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: OTHER, role: "service_role" }) });
    expect(problems).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY belongs to another Supabase project than NEXT_PUBLIC_SUPABASE_URL.",
    ]);
  });

  it("does not compare refs for keys that carry none (new-style or local keys)", () => {
    expect(serverEnvProblems({ ...good, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example" })).toEqual([]);
    expect(
      serverEnvProblems({ ...good, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: OTHER }) }),
    ).toEqual([]);
  });
});

describe("keyProjectRef", () => {
  it("reads the ref claim of a JWT key and nothing else", () => {
    expect(keyProjectRef(jwt({ ref: REF }))).toBe(REF);
    expect(keyProjectRef("not-a-jwt")).toBeNull();
    expect(keyProjectRef("a.%%%.c")).toBeNull();
  });
});

describe("isDeployedEnvironment", () => {
  it("is true only when QBBE_ENV is set", () => {
    expect(isDeployedEnvironment({ QBBE_ENV: "staging" })).toBe(true);
    expect(isDeployedEnvironment({})).toBe(false);
  });
});
