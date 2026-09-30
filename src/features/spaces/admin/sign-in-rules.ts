/**
 * Sign-in rules per role (V2-9): the decision the app makes from
 * public.my_sign_in_status(). Pure, so it is unit-tested; the workspace layout
 * (integration) calls enforceSignInRules on every signed-in page.
 */

export interface SignInStatus {
  role: string;
  require_mfa: boolean;
  has_verified_factor: boolean;
  aal: string;
  mfa_ok: boolean;
  max_session_hours: number | null;
  session_started_at: string | null;
  session_ok: boolean;
}

export type SignInDecision =
  | { action: "allow" }
  /** Two-step sign-in is required: set it up, or complete it for this session. */
  | { action: "mfa"; enroll: boolean }
  /** The session is older than the role allows: sign in again. */
  | { action: "sign_in_again" };

export function decideSignIn(status: SignInStatus | null): SignInDecision {
  // No active membership: the existing pages already handle that.
  if (!status) return { action: "allow" };
  if (!status.session_ok) return { action: "sign_in_again" };
  if (!status.mfa_ok) return { action: "mfa", enroll: !status.has_verified_factor };
  return { action: "allow" };
}

export const ORG_ROLES = ["owner", "admin", "leadership_viewer", "staff", "volunteer", "guest"] as const;
export type OrgRoleKey = (typeof ORG_ROLES)[number];

export function isOrgRole(value: unknown): value is OrgRoleKey {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

/** Hours field: empty means no limit; otherwise a whole number 1–720. */
export function parseSessionHours(raw: string): number | null | "invalid" {
  const text = raw.trim();
  if (text === "") return null;
  if (!/^\d+$/.test(text)) return "invalid";
  const hours = Number(text);
  return hours >= 1 && hours <= 720 ? hours : "invalid";
}

/** One spreadsheet cell: quoted, and never read as a formula. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** The audit export's default range: the last 30 days, as YYYY-MM-DD. */
export function defaultAuditRange(now: number = Date.now()): { from: string; to: string } {
  return {
    from: new Date(now - 30 * 86_400_000).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  };
}
