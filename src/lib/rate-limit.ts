import { createSupabaseServiceClient } from "@/lib/supabase/service";

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
  "invitation:create": { limit: 30, windowSeconds: 3600 },
  "announcement:publish": { limit: 20, windowSeconds: 3600 },
  "document:upload": { limit: 60, windowSeconds: 3600 },
  "report:generate": { limit: 30, windowSeconds: 3600 },
  "job:run": { limit: 240, windowSeconds: 60 },
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
export function rateLimitMessage(result: RateLimitResult): string {
  if (!result.resetAt) return "You're doing that too quickly. Wait a moment and try again.";
  const seconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
  const wait =
    seconds < 60
      ? `${seconds} second${seconds === 1 ? "" : "s"}`
      : `${Math.ceil(seconds / 60)} minute${seconds < 120 ? "" : "s"}`;
  return `You're doing that too quickly. Try again in about ${wait}.`;
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
  return { ok: false, error: rateLimitMessage(result) };
}
