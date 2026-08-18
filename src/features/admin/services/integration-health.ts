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
  if (/(401|403|invalid_grant|unauthenticated|token (?:has )?expired|invalid token|access token)/.test(normalized)) {
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

export function integrationHealthLabel(status: string | null | undefined): string {
  switch (status) {
    case "connected": return "Connected";
    case "authentication_expired": return "Authentication expired";
    case "synchronization_delayed": return "Synchronization delayed";
    case "configuration_required": return "Configuration required";
    case "degraded":
    case "error": return "Degraded";
    default: return "Not connected";
  }
}

export function integrationHealthTone(status: string | null | undefined): "success" | "warning" | "danger" | "neutral" {
  if (status === "connected") return "success";
  if (status === "authentication_expired" || status === "configuration_required") return "danger";
  if (status === "synchronization_delayed" || status === "degraded" || status === "error") return "warning";
  return "neutral";
}
