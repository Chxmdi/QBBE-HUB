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
