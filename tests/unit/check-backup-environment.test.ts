import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The nightly backup's fail-closed settings check (DATA-001,
 * scripts/backup/check-backup-environment.sh). Each case is a way a backup
 * could read the wrong project, encrypt to nobody, never report a stopped
 * schedule, or fail without saying which setting to fix.
 */
const script = join(process.cwd(), "scripts/backup/check-backup-environment.sh");
const STAGING_REF = "stagingrefaaaaaaaaaa";
const PRODUCTION_REF = "productionrefbbbbbbb";
const RECIPIENT = "age1lqqlewea2m8y897m8ncrk58acexr2wqmky3yey706xh6z6uwlyjs5l7dge";
/** A test index key: 32 bytes as base64 (never a real secret). */
const INDEX_KEY = Buffer.alloc(32, 9).toString("base64");

/** A legacy Supabase service_role key's shape: a JWT naming its project. */
function legacyKey(ref: string, role = "service_role") {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ iss: "supabase", ref, role })}.c2lnbmF0dXJl`;
}

function run(overrides: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: process.env.PATH ?? "",
    TARGET_ENVIRONMENT: "staging",
    SUPABASE_PROJECT_REF: STAGING_REF,
    STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
    PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_REF,
    SUPABASE_DB_PASSWORD: "password",
    SUPABASE_SERVICE_ROLE_KEY: legacyKey(STAGING_REF),
    BACKUP_AGE_RECIPIENT: RECIPIENT,
    BACKUP_INDEX_KEY: INDEX_KEY,
    BACKUP_HEALTHCHECK_URL: "https://hc-ping.com/00000000-0000-0000-0000-000000000000",
    BACKUP_S3_ENDPOINT: "https://namespace.compat.objectstorage.ca-montreal-1.oraclecloud.com",
    BACKUP_S3_BUCKET: "qbbe-hub-backups",
    BACKUP_S3_REGION: "ca-montreal-1",
    BACKUP_S3_ACCESS_KEY_ID: "access",
    BACKUP_S3_SECRET_ACCESS_KEY: "secret",
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  const result = spawnSync("bash", [script], { env, encoding: "utf8" });
  return { ok: result.status === 0, output: result.stdout + result.stderr };
}

describe("check-backup-environment.sh", () => {
  it("passes an environment bound to its own project with every setting present", () => {
    const result = run({});
    expect(result.ok, result.output).toBe(true);
    expect(result.output).toContain("1 custodian key(s)");
    expect(result.output).toContain("an index key of 32 bytes");
  });

  it("passes production bound to production, and a new-style secret key", () => {
    const result = run({ TARGET_ENVIRONMENT: "production", SUPABASE_PROJECT_REF: PRODUCTION_REF, SUPABASE_SERVICE_ROLE_KEY: legacyKey(PRODUCTION_REF) });
    expect(result.ok, result.output).toBe(true);
    expect(run({ SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc123" }).ok).toBe(true);
  });

  it("names every missing setting and the backup environment it goes in, then stops", () => {
    const result = run({ BACKUP_S3_BUCKET: "", BACKUP_S3_SECRET_ACCESS_KEY: undefined, BACKUP_HEALTHCHECK_URL: "", PRODUCTION_SUPABASE_PROJECT_REF: "", BACKUP_INDEX_KEY: undefined });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("::error::Missing BACKUP_S3_BUCKET: add it as a variable on the backup-staging environment");
    expect(result.output).toContain("::error::Missing BACKUP_S3_SECRET_ACCESS_KEY: add it as a secret on the backup-staging environment");
    expect(result.output).toContain("::error::Missing BACKUP_HEALTHCHECK_URL: add it as a secret on the backup-staging environment");
    expect(result.output).toContain("::error::Missing PRODUCTION_SUPABASE_PROJECT_REF: add it as a repository variable");
    expect(result.output).toContain("::error::Missing BACKUP_INDEX_KEY: add it as a secret on the backup-staging environment");
  });

  it("refuses an index key shorter than 32 bytes, or not hex or base64, without printing it", () => {
    const short = run({ BACKUP_INDEX_KEY: "ab".repeat(16) });
    expect(short.ok).toBe(false);
    expect(short.output).toContain("BACKUP_INDEX_KEY holds 16 bytes; it must hold at least 32");
    expect(short.output).not.toContain("abab");
    const odd = run({ BACKUP_INDEX_KEY: "not a key!" });
    expect(odd.ok).toBe(false);
    expect(odd.output).toContain("neither hex nor base64");
    expect(run({ BACKUP_INDEX_KEY: "cd".repeat(32) }).output).toContain("an index key of 32 bytes");
  });

  it("refuses an environment pointed at the other environment's project", () => {
    const result = run({ SUPABASE_PROJECT_REF: PRODUCTION_REF });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("is not staging's registered project");
  });

  it("refuses another project's service-role key, or a key that is not one, without printing it", () => {
    const other = run({ SUPABASE_SERVICE_ROLE_KEY: legacyKey(PRODUCTION_REF) });
    expect(other.ok).toBe(false);
    expect(other.output).toContain("belongs to another Supabase project");
    expect(other.output).not.toContain(legacyKey(PRODUCTION_REF));
    expect(run({ SUPABASE_SERVICE_ROLE_KEY: legacyKey(STAGING_REF, "anon") }).output).toContain("is not a service-role");
    expect(run({ SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_abc" }).output).toContain("is not a service-role");
    expect(run({ SUPABASE_SERVICE_ROLE_KEY: "nonsense" }).output).toContain("is not a Supabase key");
  });

  it("refuses staging and production registered to one project", () => {
    const result = run({ PRODUCTION_SUPABASE_PROJECT_REF: STAGING_REF });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("same Supabase project");
  });

  it("refuses a private key in BACKUP_AGE_RECIPIENT without printing it", () => {
    const secret = "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ";
    const result = run({ BACKUP_AGE_RECIPIENT: `${RECIPIENT} ${secret}` });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("holds a private key");
    expect(result.output).not.toContain("QQQQ");
  });

  it("names a pasted age-keygen file, or a lowercase private key, as a private key", () => {
    const secret = "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ";
    const keygenFile = `# created: 2026-10-22T07:17:00Z\n# public key: ${RECIPIENT}\n${secret}\n`;
    const pasted = run({ BACKUP_AGE_RECIPIENT: keygenFile });
    expect(pasted.ok).toBe(false);
    expect(pasted.output).toContain("holds a private key");
    expect(pasted.output).not.toContain("QQQQ");
    const lower = run({ BACKUP_AGE_RECIPIENT: `${RECIPIENT} ${secret.toLowerCase()}` });
    expect(lower.output).toContain("holds a private key");
    expect(lower.output).not.toContain("qqqq");
  });

  it("accepts two custodians' keys and refuses anything that is not one", () => {
    const second = "age186hymdxkq7r370msxfppkc2t860djr8qz2s92xt3z57n7a89gvnq9en9a9";
    expect(run({ BACKUP_AGE_RECIPIENT: `${RECIPIENT},\n${second}` }).output).toContain("2 custodian key(s)");
    expect(run({ BACKUP_AGE_RECIPIENT: "age1short" }).ok).toBe(false);
    expect(run({ BACKUP_AGE_RECIPIENT: " , " }).output).toContain("no age public key");
  });

  it("refuses a bucket or a check-in address reached without HTTPS", () => {
    const bucket = run({ BACKUP_S3_ENDPOINT: "http://203.0.113.10:9000" });
    expect(bucket.ok).toBe(false);
    expect(bucket.output).toContain("must be https://");
    const monitor = run({ BACKUP_HEALTHCHECK_URL: "http://hc-ping.com/x" });
    expect(monitor.ok).toBe(false);
    expect(monitor.output).toContain("BACKUP_HEALTHCHECK_URL must be the https://");
  });

  it("writes nothing for later steps and prints no secret", () => {
    const result = run({ GITHUB_ENV: "/nonexistent/github-env" });
    expect(result.ok, result.output).toBe(true);
    expect(result.output).not.toContain(legacyKey(STAGING_REF));
    expect(result.output).not.toContain("password");
  });
});
