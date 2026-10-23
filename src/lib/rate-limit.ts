import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getT } from "@/lib/i18n/server";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

/**
 * Rate limiting for the Hub's own write paths.
 *
 * Counters live in Postgres (see the `rate_limit_hit` function), because the
 * app runs as serverless functions: an in-process counter resets on every cold
 * start and is not shared between concurrent instances, which would look like
 * protection without being any.
 *
 * The check **fails open**. If the limiter itself is broken or unconfigured,
 * the Hub keeps working and says so in the logs. A rate limit exists to blunt
 * abuse and runaway loops; taking the whole workspace down because the counter
 * table is unreachable would be the worse failure.
 *
 * Authentication is deliberately not limited here — sign-in and sign-up go from
 * the browser straight to Supabase Auth, which applies its own limits.
 *
 * The database holds people to the same limits, under the same names, on
 * the tables they can insert into directly (SEC-024: app_limits.rule, kept
 * equal to RATE_LIMITS by tests/unit/rate-limit-shared.test.ts). Its
 * counters are its own, so a write through the app is not counted twice.
 */

export interface RateLimitRule {
  /** Stable identifier for what is being limited, e.g. "message:create". */
  action: string;
  /** Who is being limited — normally a user id. */
  subject: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
  resetAt: Date | null;
  /** True when the limiter could not be consulted and the request was let through. */
  degraded: boolean;
}

/** Sensible ceilings per action. Generous for people, tight enough to stop a loop. */
export const RATE_LIMITS = {
  "message:create": { limit: 120, windowSeconds: 60 },
  "task:create": { limit: 120, windowSeconds: 60 },
  // One bulk-bar change to up to 200 tasks.
  "task:bulk": { limit: 60, windowSeconds: 3600 },
  "invitation:create": { limit: 30, windowSeconds: 3600 },
  "access-grant:program": { limit: 120, windowSeconds: 3600 },
  "access-grant:project": { limit: 120, windowSeconds: 3600 },
  "announcement:publish": { limit: 20, windowSeconds: 3600 },
  "audit:record": { limit: 600, windowSeconds: 3600 },
  "document:upload": { limit: 60, windowSeconds: 3600 },
  "receipt:submit": { limit: 60, windowSeconds: 3600 },
  "form:submit": { limit: 60, windowSeconds: 3600 },
  "report:generate": { limit: 30, windowSeconds: 3600 },
  // Tighter than the rest: each one copies sensitive data out of the reach of
  // row-level security, and nobody legitimately needs a dozen an hour.
  "export:request": { limit: 10, windowSeconds: 3600 },
  // A lens export is a CSV of what the viewer can already see, so it may be
  // repeated more freely than a full data export; still few enough per hour
  // to stop a script draining the workspace row by row.
  "lens:export": { limit: 30, windowSeconds: 3600 },
  // One import can create up to 2000 records; a handful an hour is plenty.
  "import:run": { limit: 20, windowSeconds: 3600 },
  "job:run": { limit: 240, windowSeconds: 60 },
  "approval:submit": { limit: 60, windowSeconds: 3600 },
  "approval:delegate": { limit: 30, windowSeconds: 3600 },
  "ledger:write": { limit: 240, windowSeconds: 60 },
  "gift:write": { limit: 240, windowSeconds: 60 },
  "gift:email": { limit: 60, windowSeconds: 3600 },
  "payables:write": { limit: 240, windowSeconds: 60 },
  "bank:write": { limit: 240, windowSeconds: 60 },
  "payroll:write": { limit: 240, windowSeconds: 60 },
  // Workspace OS writes (epic #199). Each creates rows or copies data; the
  // ceilings are far above what a person does by hand and stop a runaway
  // script or a stuck client from filling a table.
  "page:create": { limit: 60, windowSeconds: 60 },
  // Page export and import (wave 2 unit X1): each copies a whole page out or in.
  "page:export": { limit: 30, windowSeconds: 3600 },
  "page:import": { limit: 20, windowSeconds: 3600 },
  "comment:create": { limit: 60, windowSeconds: 60 },
  "capture:create": { limit: 60, windowSeconds: 60 },
  "project:create": { limit: 120, windowSeconds: 3600 },
  "share:write": { limit: 120, windowSeconds: 3600 },
  "app:write": { limit: 240, windowSeconds: 3600 },
  "blueprint:write": { limit: 240, windowSeconds: 3600 },
  "blueprint:build": { limit: 30, windowSeconds: 3600 },
  "template:write": { limit: 60, windowSeconds: 3600 },
  // One property on one object from its record page, and undoing it (U14).
  "property:write": { limit: 240, windowSeconds: 60 },
  // Autosave is debounced on the device; this only catches a loop.
  "editor:save": { limit: 600, windowSeconds: 60 },
  // Zeffy webhook deliveries, counted only once their signature checks out:
  // far above Zeffy's own pace, low enough to stop a replay storm.
  "zeffy:webhook": { limit: 600, windowSeconds: 60 },
  // "Sync now" in Admin; each run spends Zeffy's shared request quota.
  "zeffy:sync": { limit: 12, windowSeconds: 3600 },
  // Staff placing Zeffy supporters the sync could not ("Needs matching").
  "zeffy:match": { limit: 240, windowSeconds: 3600 },
  // Browser crash reports (/api/client-errors), per address: a crash loop
  // must not flood the logs or the monitoring quota.
  "client-error:report": { limit: 20, windowSeconds: 60 },
  // Enforced only in the database, on notifications a person's own session
  // inserts (mentions, assignments, group messages). Bulk actions are given
  // room first with grantWriteAllowance.
  "notification:create": { limit: 600, windowSeconds: 60 },
} as const;

export type RateLimitedAction = keyof typeof RATE_LIMITS;

export async function checkRateLimit(rule: RateLimitRule): Promise<RateLimitResult> {
  const bucket = `${rule.action}:${rule.subject}`;

  try {
    const db = createSupabaseServiceClient();
    const { data, error } = await db.rpc("rate_limit_hit", {
      p_bucket: bucket,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });

    if (error) throw new Error(error.message);

    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed: boolean; used: number; reset_at: string }
      | undefined;

    if (!row) throw new Error("rate limiter returned no row");

    return {
      allowed: row.allowed,
      used: row.used,
      limit: rule.limit,
      resetAt: new Date(row.reset_at),
      degraded: false,
    };
  } catch (cause) {
    console.error(
      JSON.stringify({
        event: "rate_limit.unavailable",
        bucket,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    );
    return {
      allowed: true,
      used: 0,
      limit: rule.limit,
      resetAt: null,
      degraded: true,
    };
  }
}

/** Wording a person can act on: what happened, and when they can try again. */
export function rateLimitMessage(
  result: RateLimitResult,
  t: TranslateFn = createTranslator("en"),
): string {
  if (!result.resetAt) return t("shell.rateLimit.soon");
  const seconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
  const wait =
    seconds < 60
      ? t(seconds === 1 ? "shell.rateLimit.secondOne" : "shell.rateLimit.secondOther", { count: seconds })
      : t(seconds < 120 ? "shell.rateLimit.minuteOne" : "shell.rateLimit.minuteOther", {
          count: Math.ceil(seconds / 60),
        });
  return t("shell.rateLimit.later", { wait });
}

/**
 * Room for `count` more inserts under `action` in the database, for ten
 * minutes: for an import, which creates up to 2000 rows as the person after
 * its own "import:run" check. False when it could not be granted.
 */
export async function grantWriteAllowance(action: RateLimitedAction, subject: string, count: number): Promise<boolean> {
  try {
    const { error } = await createSupabaseServiceClient().rpc("grant_write_allowance", {
      p_user: subject,
      p_action: action,
      p_count: count,
      p_seconds: 600,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (cause) {
    console.error(
      JSON.stringify({
        event: "rate_limit.allowance_failed",
        action,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    );
    return false;
  }
}

/**
 * Convenience for a server action: returns an error result to hand straight
 * back, or null when the caller may proceed.
 */
export async function enforceRateLimit(
  action: RateLimitedAction,
  subject: string,
): Promise<{ ok: false; error: string } | null> {
  const { limit, windowSeconds } = RATE_LIMITS[action];
  const result = await checkRateLimit({ action, subject, limit, windowSeconds });
  if (result.allowed) return null;
  return { ok: false, error: rateLimitMessage(result, await getT()) };
}
