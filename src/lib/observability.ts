/**
 * Optional error monitoring. When ERROR_MONITORING_DSN is unset the Hub
 * logs locally and does not pretend a vendor is connected (DONE-010).
 *
 * Sentry-compatible DSNs (`https://<key>@<host>/<projectId>`) are posted
 * to the store endpoint. Other DSN shapes are logged only.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  const digest =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown";
  console.error("[qbbe]", digest, context ?? "");
  const dsn = process.env.ERROR_MONITORING_DSN;
  if (!dsn) return;
  void sendToDsn(dsn, digest, context).catch((sendError) => {
    console.error("[qbbe] monitoring ingest failed", sendError);
  });
}

export function parseSentryDsn(dsn: string): {
  protocol: string;
  key: string;
  host: string;
  projectId: string;
} | null {
  try {
    const url = new URL(dsn);
    const key = url.username;
    const projectId = url.pathname.replace(/^\//, "").split("/").pop();
    if (!key || !projectId || !url.host) return null;
    return { protocol: url.protocol.replace(":", ""), key, host: url.host, projectId };
  } catch {
    return null;
  }
}

async function sendToDsn(
  dsn: string,
  message: string,
  context?: Record<string, unknown>,
) {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return;
  const endpoint = `${parsed.protocol}://${parsed.host}/api/${parsed.projectId}/store/`;
  await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=qbbe-hub/1.0.0, sentry_key=${parsed.key}`,
    },
    body: JSON.stringify({
      message,
      level: "error",
      platform: "javascript",
      timestamp: Date.now() / 1000,
      extra: context ?? {},
    }),
  });
}
