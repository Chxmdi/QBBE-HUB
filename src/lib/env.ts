/**
 * Server-side environment access.
 *
 * Every value here is read at call time rather than at module load, so a
 * missing variable surfaces as a handled error inside the request that needs
 * it instead of crashing the build (ENV-003). Nothing in this file may be
 * imported from a client component — none of these names are NEXT_PUBLIC, so a
 * client bundle would inline them as undefined rather than leaking a value.
 * The one exception is `appUrl`/`absoluteUrl`, which read a public variable and
 * are safe anywhere.
 */

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(
      `${name} is not set. Add it to the environment for this deployment; see .env.example.`,
    );
    this.name = "MissingEnvError";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new MissingEnvError(name);
  return value;
}

function optional(name: string): string | null {
  return process.env[name] || null;
}

/** Privileged database access for background work. Never reaches the browser. */
export const serviceRoleKey = () => required("SUPABASE_SERVICE_ROLE_KEY");

/** Shared secret the scheduler presents on every job request. */
export const jobSecret = () => required("CRON_JOB_SECRET");

/** Transactional email credentials. Absent means the log transport is used. */
export const emailApiKey = () => optional("EMAIL_PROVIDER_API_KEY");
export const emailFromAddress = () =>
  optional("EMAIL_FROM_ADDRESS") ?? "QBBE Hub <hub@localhost>";

/**
 * Canonical origin for links inside outbound email. Falls back to localhost so
 * a development run still produces clickable links.
 */
export function appUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** Absolute URL for an in-app path, for use in email bodies. */
export function absoluteUrl(path: string): string {
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The Supabase project a legacy (JWT) API key belongs to, from its `ref`
 * claim, or null for keys that carry none (new-style sb_ keys, local keys).
 * Used only to catch a key pasted from the wrong project; never verifies it.
 */
export function keyProjectRef(key: string): string | null {
  const payload = key.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { ref?: unknown };
    return typeof claims.ref === "string" ? claims.ref : null;
  } catch {
    return null;
  }
}

/**
 * Settings a deployed server cannot work without, checked once at start-up
 * (src/instrumentation.ts) and by /api/health/ready. Returns one plain
 * sentence per problem and never a value, so the result is safe to log.
 */
export function serverEnvProblems(env: Record<string, string | undefined> = process.env): string[] {
  const problems: string[] = [];
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    problems.push("NEXT_PUBLIC_SUPABASE_URL is missing or not a URL.");
  }
  for (const name of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!env[name]) problems.push(`${name} is not set.`);
  }
  if ((env.CRON_JOB_SECRET ?? "").length < 32) problems.push("CRON_JOB_SECRET is missing or shorter than 32 characters.");
  // Deployed sites are served over https; a local run may use http.
  const addressShape = env.QBBE_ENV ? /^https:\/\/[^/]+\/?$/ : /^https?:\/\/[^/]+\/?$/;
  if (!addressShape.test(env.NEXT_PUBLIC_APP_URL ?? "")) problems.push("NEXT_PUBLIC_APP_URL must be this site's address (https:// once deployed).");

  // A hosted project's address names its ref; a JWT key names the project it
  // was issued for. They must agree.
  const projectRef = /^([a-z0-9]{20})\.supabase\.co$/.exec(host)?.[1];
  if (projectRef) {
    for (const name of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      const ref = keyProjectRef(env[name] ?? "");
      if (ref && ref !== projectRef) problems.push(`${name} belongs to another Supabase project than NEXT_PUBLIC_SUPABASE_URL.`);
    }
  }
  return problems;
}

/**
 * True on a deployed server (QBBE_ENV is set by deploy/server/compose.app.yaml).
 * Local development, CI builds and tests leave it unset.
 */
export const isDeployedEnvironment = (env: Record<string, string | undefined> = process.env) => Boolean(env.QBBE_ENV);
