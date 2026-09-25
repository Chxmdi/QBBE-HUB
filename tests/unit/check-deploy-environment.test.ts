import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The deploy workflow's fail-closed environment check (#51, #52). Each case
 * is a way a deploy could reach the wrong site or database; each must stop
 * before anything is migrated or published.
 */
const script = join(process.cwd(), "scripts/check-deploy-environment.sh");
const STAGING_SITE = "2169b17a-8dc3-49de-a466-4281e1285de2";
const PRODUCTION_SITE = "a34499c8-0d84-47d5-bfb2-502c2b9b9071";

function run(overrides: Record<string, string>) {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: process.env.PATH ?? "",
    RELEASE_ENABLED: "true",
    NETLIFY_AUTH_TOKEN: "token",
    SUPABASE_ACCESS_TOKEN: "token",
    SUPABASE_DB_PASSWORD: "password",
    STAGING_SUPABASE_REF: "stagingref",
    PRODUCTION_SUPABASE_REF: "productionref",
    TARGET_ENVIRONMENT: "staging",
    NETLIFY_SITE_ID: STAGING_SITE,
    SUPABASE_PROJECT_REF: "stagingref",
    ...overrides,
  };
  const result = spawnSync("bash", [script], { env, encoding: "utf8" });
  return { ok: result.status === 0, output: result.stdout + result.stderr };
}

describe("check-deploy-environment.sh", () => {
  it("passes an environment bound to its own site and database", () => {
    expect(run({}).ok).toBe(true);
    expect(
      run({
        TARGET_ENVIRONMENT: "production",
        NETLIFY_SITE_ID: PRODUCTION_SITE,
        SUPABASE_PROJECT_REF: "productionref",
      }).ok,
    ).toBe(true);
  });

  it("refuses staging pointed at the production database", () => {
    const result = run({ SUPABASE_PROJECT_REF: "productionref" });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("not its registered project");
  });

  it("refuses production on the staging site", () => {
    const result = run({
      TARGET_ENVIRONMENT: "production",
      NETLIFY_SITE_ID: STAGING_SITE,
      SUPABASE_PROJECT_REF: "productionref",
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("wrong Netlify site ID");
  });

  it("refuses when staging and production share one database", () => {
    const result = run({ PRODUCTION_SUPABASE_REF: "stagingref" });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("same Supabase project");
  });

  it("refuses when release is not enabled", () => {
    expect(run({ RELEASE_ENABLED: "false" }).ok).toBe(false);
    expect(run({ RELEASE_ENABLED: "" }).ok).toBe(false);
  });

  it("refuses when any credential or registration is missing", () => {
    for (const name of [
      "NETLIFY_SITE_ID",
      "NETLIFY_AUTH_TOKEN",
      "SUPABASE_PROJECT_REF",
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_DB_PASSWORD",
      "STAGING_SUPABASE_REF",
      "PRODUCTION_SUPABASE_REF",
    ]) {
      const result = run({ [name]: "" });
      expect(result.ok, name).toBe(false);
      expect(result.output, name).toContain(`Missing ${name}`);
    }
  });

  it("refuses an unknown environment", () => {
    expect(run({ TARGET_ENVIRONMENT: "preview" }).ok).toBe(false);
  });
});
