/**
 * Optional error monitoring. When ERROR_MONITORING_DSN is unset the Hub
 * logs locally and does not pretend a vendor is connected (DONE-010).
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  const digest =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown";
  console.error("[qbbe]", digest, context ?? "");
  const dsn = process.env.ERROR_MONITORING_DSN;
  if (!dsn) return;
  // DSN is present: a future Sentry/etc. init belongs here. We still log
  // so local/dev never silently swallows the event.
}
