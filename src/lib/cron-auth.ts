import { timingSafeEqual } from "node:crypto";

/** Compare bearer secrets without leaking length via early return on mismatch. */
export function secretsMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET` when that
 * env var is set. Local/ops jobs use `CRON_JOB_SECRET` on POST.
 */
export function cronAuthorized(request: Request): boolean {
  const expected = process.env.CRON_JOB_SECRET || process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix)) return false;
  return secretsMatch(auth.slice(prefix.length), expected);
}
