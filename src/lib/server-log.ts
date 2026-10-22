import { forwardToMonitoring } from "@/lib/observability";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * One structured log line per server event: JSON with a timestamp, level,
 * event name and the request id the proxy put on the request (src/proxy.ts),
 * so a line can be matched to the x-request-id header the browser saw.
 *
 * Log lines leave the server (container logs, monitoring), so values are
 * redacted here rather than trusted to each caller: fields whose name suggests
 * a credential or an address are dropped, and e-mail addresses and bearer
 * tokens inside free text are masked.
 */

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|email|api[-_]?key|signature/i;

export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/([?&](?:token|code|invite|key|secret)=)[^&\s]+/gi, "$1[redacted]");
}

function clean(fields: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || SENSITIVE_KEY.test(key)) continue;
    out[key] = typeof value === "string" ? redact(value).slice(0, 1000) : value;
  }
  return out;
}

/** The request id the proxy assigned, from a Request or a Headers object. */
export function requestIdOf(source: Request | Headers | null | undefined): string | undefined {
  const headers = source instanceof Request ? source.headers : source;
  return headers?.get("x-request-id") ?? undefined;
}

export function logEvent(event: string, fields: Fields = {}, level: Level = "info") {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...clean(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

/**
 * A server action or command that failed on a database or provider error.
 * Writes one line with the action, the error code (Postgres SQLSTATE such as
 * 42501 for a refused row) and a redacted message, and forwards it to error
 * monitoring when that is configured.
 */
export function logActionFailure(action: string, error: unknown, context: Fields = {}) {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  const message = error instanceof Error ? error.message : typeof e.message === "string" ? e.message : String(error);
  const fields = clean({ action, code: typeof e.code === "string" ? e.code : undefined, message, ...context });
  logEvent("action.failed", fields, "error");
  forwardToMonitoring(`action.failed: ${action}`, fields);
}

export type RefusalReason =
  | "not_configured"
  | "signature_invalid"
  | "unauthorized"
  | "bad_request"
  | "too_large"
  | "rate_limited"
  | "db_error"
  | "queue_error"
  | "unknown_job"
  | "disabled_job"
  | "failed";

/** Hourly counters per source and reason, read by the operator alerts. */
export const REFUSAL_COUNTER_PREFIX = "webhook-refused";

/**
 * A webhook or job call answered with anything but success. Logs one line and
 * counts it (rate_limit_counter, hourly bucket) so repeated signature failures
 * after a rotated secret, or a burst of forged deliveries, can raise an alert
 * instead of passing unseen. Counting never blocks or fails the request.
 */
export async function logRefusal(source: string, reason: RefusalReason, status: number, request?: Request, detail?: string) {
  logEvent(
    `${source}.refused`,
    { reason, status, requestId: requestIdOf(request), detail },
    status >= 500 ? "error" : "warn",
  );
  try {
    await checkRateLimit({
      action: REFUSAL_COUNTER_PREFIX,
      subject: `${source}:${reason}`,
      limit: 1_000_000,
      windowSeconds: 3600,
    });
  } catch {
    // The counter is best effort; the log line above is the record.
  }
}

/** A database error as "<code> <message>", for a log line's detail field. */
export function dbDetail(error: { code?: string; message?: string } | null | undefined): string {
  return [error?.code, error?.message].filter(Boolean).join(" ");
}
