import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

const ENGLISH = createTranslator("en");

export type IntegrationHealthStatus =
  | "connected"
  | "disconnected"
  | "degraded"
  | "authentication_expired"
  | "synchronization_delayed"
  | "configuration_required";

/** Maps non-sensitive provider failures to operator-actionable health states. */
export function classifyIntegrationFailure(message: string): Exclude<IntegrationHealthStatus, "connected" | "disconnected"> {
  const normalized = message.toLowerCase();
  if (/(401|403|invalid_grant|unauthenticated|token (?:has )?expired|invalid token|access token|authorization (?:expired|is unavailable)|reconnect)/.test(normalized)) {
    return "authentication_expired";
  }
  if (/(not configured|configuration|required credential|missing (?:token|credential|secret))/.test(normalized)) {
    return "configuration_required";
  }
  if (/(429|timeout|timed out|network|fetch failed|5\d{2})/.test(normalized)) {
    return "synchronization_delayed";
  }
  return "degraded";
}

/**
 * Pass `t` for the person's language; without it the label is English, which
 * is what the unit tests and log lines expect.
 */
export function integrationHealthLabel(
  status: string | null | undefined,
  t: TranslateFn = ENGLISH,
): string {
  switch (status) {
    case "connected": return t("admin.workspace.integrations.health.connected");
    case "authentication_expired": return t("admin.workspace.integrations.health.authentication_expired");
    case "synchronization_delayed": return t("admin.workspace.integrations.health.synchronization_delayed");
    case "configuration_required": return t("admin.workspace.integrations.health.configuration_required");
    case "degraded":
    case "error": return t("admin.workspace.integrations.health.degraded");
    default: return t("admin.workspace.integrations.health.notConnected");
  }
}

export function integrationHealthTone(status: string | null | undefined): "success" | "warning" | "danger" | "neutral" {
  if (status === "connected") return "success";
  if (status === "authentication_expired" || status === "configuration_required") return "danger";
  if (status === "synchronization_delayed" || status === "degraded" || status === "error") return "warning";
  return "neutral";
}
