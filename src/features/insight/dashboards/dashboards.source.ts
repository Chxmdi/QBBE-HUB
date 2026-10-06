import type { createSupabasePageClient } from "@/lib/supabase/page";
import { addCalendarDays } from "@/lib/time";
import { todayIn } from "../metrics";
import { TREND_WEEKS, type DashboardRows, type DashboardSource } from "./dashboards";

/**
 * Loads only the rows a dashboard template needs, each through the viewer's
 * own client, so every table's RLS decides what counts. Finance rows are
 * readable only by those the ledger admits; for anyone else those queries
 * return nothing and the tiles say so, rather than showing a false zero.
 */

type Client = Pick<Awaited<ReturnType<typeof createSupabasePageClient>>, "from">;

/** Caps keep one page load bounded; the page says when one was reached. */
export const ROW_LIMIT = 5000;

export interface DashboardLoad {
  rows: DashboardRows;
  /** Sources that returned no rows (possibly for lack of access). */
  empty: Set<DashboardSource>;
  truncated: boolean;
}

export async function loadDashboardRows(
  client: Client,
  needs: Set<DashboardSource>,
  now: Date,
  timeZone?: string,
): Promise<DashboardLoad> {
  const today = todayIn(now, timeZone);
  const trendStart = addCalendarDays(today, -7 * TREND_WEEKS - 7)!;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const giftsSince = trendStart < yearStart ? trendStart : yearStart;

  const queries: Record<DashboardSource, () => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>> = {
    programs: () => client.from("program").select("id, name").order("name").limit(ROW_LIMIT),
    projects: () => client.from("project").select("id, program_id").is("archived_at", null).limit(ROW_LIMIT),
    tasks: () =>
      client
        .from("task")
        .select("status, due_at, completed_at, created_at, program_id, project_id")
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT),
    risks: () => client.from("risk").select("status").limit(ROW_LIMIT),
    events: () =>
      client.from("event").select("starts_at, program_id, project_id").gte("starts_at", `${today}T00:00:00Z`).limit(ROW_LIMIT),
    activity: () =>
      client.from("activity_event").select("created_at").gte("created_at", `${trendStart}T00:00:00Z`).limit(ROW_LIMIT),
    bills: () => client.from("finance_bill").select("total_cents, paid_cents, status").eq("status", "posted").limit(ROW_LIMIT),
    invoices: () => client.from("finance_invoice").select("total_cents, paid_cents, status").eq("status", "posted").limit(ROW_LIMIT),
    gifts: () =>
      client.from("gift").select("amount_cents, received_on, status").gte("received_on", giftsSince).limit(ROW_LIMIT),
    measurements: () =>
      client.from("outcome_measurement").select("measured_on").gte("measured_on", addCalendarDays(today, -90)!).limit(ROW_LIMIT),
  };

  const rows: DashboardRows = {
    programs: [], projects: [], tasks: [], risks: [], events: [], activity: [],
    bills: [], invoices: [], gifts: [], measurements: [],
  };
  const empty = new Set<DashboardSource>();
  let truncated = false;
  await Promise.all(
    [...needs].map(async (source) => {
      const { data, error } = await queries[source]();
      if (error) throw new Error(error.message);
      const list = data ?? [];
      (rows as unknown as Record<DashboardSource, unknown[]>)[source] = list;
      if (list.length === 0) empty.add(source);
      if (list.length >= ROW_LIMIT) truncated = true;
    }),
  );
  return { rows, empty, truncated };
}
