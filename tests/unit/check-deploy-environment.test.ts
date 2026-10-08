import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The deploy workflow's fail-closed environment check (#51, #52). Each case
 * is a way a deploy could reach the wrong database, address or settings;
 * each must stop before anything is migrated or released.
 */
const script = join(process.cwd(), "scripts/check-deploy-environment.sh");
// Real refs are 20 lowercase letters.
const STAGING_REF = "stagingrefaaaaaaaaaa";
const PRODUCTION_REF = "productionrefbbbbbbb";
const STAGING_SITE = "https://staging.hub.example.org";
const PRODUCTION_SITE = "https://hub.example.org";
const SECRET = "x".repeat(48);

function appEnv(ref: string, site: string, extra = "") {
  return [
    `NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co`,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=anon",
    "SUPABASE_SERVICE_ROLE_KEY=service",
    `NEXT_PUBLIC_APP_URL=${site}`,
    `CRON_JOB_SECRET=${SECRET}`,
    extra,
  ].join("\n");
}

function run(overrides: Record<string, string>) {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: process.env.PATH ?? "",
    RELEASE_ENABLED: "true",
    SUPABASE_ACCESS_TOKEN: "token",
    SUPABASE_DB_PASSWORD: "password",
    STAGING_SUPABASE_REF: STAGING_REF,
    PRODUCTION_SUPABASE_REF: PRODUCTION_REF,
    TARGET_ENVIRONMENT: "staging",
    SUPABASE_PROJECT_REF: STAGING_REF,
    DEPLOY_HOST: "203.0.113.10",
    DEPLOY_SSH_KEY: "key",
    DEPLOY_KNOWN_HOSTS: "203.0.113.10 ssh-ed25519 AAAA",
    SITE_URL: STAGING_SITE,
    APP_ENV: appEnv(STAGING_REF, STAGING_SITE, "WORKSPACE_OS_FLAGS=all"),
    ...overrides,
  };
  const result = spawnSync("bash", [script], { env, encoding: "utf8" });
  return { ok: result.status === 0, output: result.stdout + result.stderr };
}

const production = {
  TARGET_ENVIRONMENT: "production",
  SUPABASE_PROJECT_REF: PRODUCTION_REF,
  SITE_URL: PRODUCTION_SITE,
  APP_ENV: appEnv(PRODUCTION_REF, PRODUCTION_SITE),
};

describe("check-deploy-environment.sh", () => {
  it("passes an environment bound to its own database, address and settings", () => {
    expect(run({}).output).toContain("match their registrations");
    expect(run({}).ok).toBe(true);
    expect(run(production).ok).toBe(true);
  });

  it("reads quoted values, CRLF line endings and a trailing slash", () => {
    const quoted = appEnv(STAGING_REF, STAGING_SITE)
      .replace(`NEXT_PUBLIC_SUPABASE_URL=https://${STAGING_REF}.supabase.co`, `NEXT_PUBLIC_SUPABASE_URL="https://${STAGING_REF}.supabase.co/"`)
      .replace(/\n/g, "\r\n");
    expect(run({ APP_ENV: quoted, SITE_URL: `${STAGING_SITE}/` }).ok).toBe(true);
  });

  it("refuses staging pointed at the production database", () => {
    const result = run({ SUPABASE_PROJECT_REF: PRODUCTION_REF });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("not its registered project");
  });

  it("refuses app settings that point at the other environment's database", () => {
    const result = run({ APP_ENV: appEnv(PRODUCTION_REF, STAGING_SITE) });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("NEXT_PUBLIC_SUPABASE_URL is not staging's Supabase project");
    const prod = run({ ...production, APP_ENV: appEnv(STAGING_REF, PRODUCTION_SITE) });
    expect(prod.ok).toBe(false);
  });

  it("refuses app settings built for another address", () => {
    const result = run({ ...production, APP_ENV: appEnv(PRODUCTION_REF, STAGING_SITE) });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("NEXT_PUBLIC_APP_URL must be this environment's address");
  });

  it("refuses an address that is not https://<host>", () => {
    for (const bad of ["http://hub.example.org", "https://hub.example.org/app", "hub.example.org"]) {
      const result = run({ SITE_URL: bad });
      expect(result.ok, bad).toBe(false);
      expect(result.output, bad).toContain("SITE_URL");
    }
  });

  it("refuses settings without the keys the app cannot run without", () => {
    for (const name of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      const lines = appEnv(STAGING_REF, STAGING_SITE).split("\n").filter((l) => !l.startsWith(`${name}=`));
      const result = run({ APP_ENV: lines.join("\n") });
      expect(result.ok, name).toBe(false);
      expect(result.output, name).toContain(`has no ${name}`);
    }
    const short = appEnv(STAGING_REF, STAGING_SITE).replace(SECRET, "short");
    expect(run({ APP_ENV: short }).output).toContain("CRON_JOB_SECRET of at least 32 characters");
  });

  it("refuses Workspace OS switch overrides on production, even empty", () => {
    for (const line of ["WORKSPACE_OS_FLAGS=all", "WORKSPACE_OS_FLAGS=", "export WORKSPACE_OS_FLAGS=wos_pages"]) {
      const result = run({ ...production, APP_ENV: appEnv(PRODUCTION_REF, PRODUCTION_SITE, line) });
      expect(result.ok, line).toBe(false);
      expect(result.output, line).toContain("sets WORKSPACE_OS_FLAGS");
    }
  });

  it("refuses when staging and production share one database", () => {
    const result = run({ PRODUCTION_SUPABASE_REF: STAGING_REF });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("same Supabase project");
  });

  it("refuses when release is not enabled", () => {
    expect(run({ RELEASE_ENABLED: "false" }).ok).toBe(false);
    expect(run({ RELEASE_ENABLED: "" }).ok).toBe(false);
  });

  it("refuses when any credential or setting is missing", () => {
    for (const name of [
      "SUPABASE_PROJECT_REF",
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_DB_PASSWORD",
      "STAGING_SUPABASE_REF",
      "PRODUCTION_SUPABASE_REF",
      "DEPLOY_HOST",
      "DEPLOY_SSH_KEY",
      "DEPLOY_KNOWN_HOSTS",
      "SITE_URL",
      "APP_ENV",
    ]) {
      const result = run({ [name]: "" });
      expect(result.ok, name).toBe(false);
      expect(result.output, name).toContain(`Missing ${name}`);
    }
  });

  it("refuses a ref that is not a project ref, even when both copies match", () => {
    for (const bad of ["staging ref", "https://abcdefghijklmnopqrst.supabase.co", "ABCDEFGHIJKLMNOPQRST", "short"]) {
      const result = run({ SUPABASE_PROJECT_REF: bad, STAGING_SUPABASE_REF: bad });
      expect(result.ok, bad).toBe(false);
      expect(result.output, bad).toContain("is not a Supabase project ref");
    }
    const result = run({ PRODUCTION_SUPABASE_REF: "production ref" });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("PRODUCTION_SUPABASE_REF");
  });

  it("refuses an unknown environment", () => {
    expect(run({ TARGET_ENVIRONMENT: "preview" }).ok).toBe(false);
  });
});
