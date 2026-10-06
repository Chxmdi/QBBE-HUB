import { redirect } from "next/navigation";
import { requireSession, type SessionContext, NO_ACCESS_REDIRECT } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { isCalendarDate } from "@/lib/schema";

export interface LedgerSettings {
  chart_approved_on: string | null;
  chart_approved_by_name: string | null;
  chart_approval_recorded_at: string | null;
}

export interface LedgerAccess {
  session: SessionContext;
  supabase: Awaited<ReturnType<typeof createSupabasePageClient>>;
  /** Owners/admins with MFA, or staff an admin named as ledger readers. */
  canRead: boolean;
  /** Owners/admins with MFA. The database checks this again on every write. */
  canManage: boolean;
  /** A Guest holding a current external accountant grant (#154). */
  isAccountant: boolean;
  settings: LedgerSettings | null;
}

type PageClient = Awaited<ReturnType<typeof createSupabasePageClient>>;

/**
 * Whether the caller holds a current accountant grant. The grantee can read
 * their own grant before completing MFA; the books open only after it.
 */
export async function hasAccountantGrant(supabase: PageClient, session: SessionContext): Promise<boolean> {
  const { data } = await supabase
    .from("ledger_accountant_grant")
    .select("id")
    .eq("organization_id", session.organizationId)
    .eq("user_id", session.userId)
    .is("revoked_at", null)
    .lte("starts_at", new Date().toISOString())
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Route gate for the ledger screens. Staff, and a Guest holding a current
 * accountant grant, reach the pages; everyone else is sent home. Whether they
 * see the books is the database's answer: the settings row is readable
 * exactly when `app.can_read_ledger` is true for the caller. An accountant
 * who has not completed MFA is sent to do so first, and each accountant
 * session that opens the books is written to the audit log once.
 */
export async function getLedgerAccess(): Promise<LedgerAccess> {
  const session = await requireSession();
  const supabase = await createSupabasePageClient();
  const isAccountant = !session.isStaff && (await hasAccountantGrant(supabase, session));
  if (!session.isStaff && !isAccountant) redirect(NO_ACCESS_REDIRECT);
  const { data } = await supabase
    .from("ledger_settings")
    .select("chart_approved_on, chart_approved_by_name, chart_approval_recorded_at")
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  const canRead = Boolean(data);
  if (isAccountant) {
    if (!canRead) redirect("/mfa?next=/finance/ledger");
    await supabase.rpc("ledger_note_accountant_session", { p_organization: session.organizationId });
  }
  return {
    session,
    supabase,
    canRead,
    canManage: canRead && session.isAdmin,
    isAccountant,
    settings: (data as LedgerSettings | null) ?? null,
  };
}

/** Today in the organization's zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}

export function dateParam(value: string | undefined, fallback: string): string {
  return value && isCalendarDate(value) ? value : fallback;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(value: string | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}
