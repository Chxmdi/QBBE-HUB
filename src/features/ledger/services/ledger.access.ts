import { requireStaff, type SessionContext } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

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
  settings: LedgerSettings | null;
}

/**
 * Route gate for the ledger screens. Staff reach the pages; whether they see
 * the books is the database's answer: the settings row is readable exactly
 * when `app.can_read_ledger` is true for the caller.
 */
export async function getLedgerAccess(): Promise<LedgerAccess> {
  const session = await requireStaff();
  const supabase = await createSupabasePageClient();
  const { data } = await supabase
    .from("ledger_settings")
    .select("chart_approved_on, chart_approved_by_name, chart_approval_recorded_at")
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  const canRead = Boolean(data);
  return {
    session,
    supabase,
    canRead,
    canManage: canRead && session.isAdmin,
    settings: (data as LedgerSettings | null) ?? null,
  };
}

/** Today in the organization's zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function dateParam(value: string | undefined, fallback: string): string {
  return value && DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : fallback;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(value: string | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}
