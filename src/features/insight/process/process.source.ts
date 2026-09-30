import type { createSupabasePageClient } from "@/lib/supabase/page";
import {
  statusChangesFromMetadata,
  type ApprovalEventRow,
  type ApprovalItemRow,
  type TaskHistory,
  type TurnaroundInput,
} from "./process";

/**
 * Reads what process analytics needs through the viewer's own client, so
 * each table's RLS decides what is counted: task status changes from
 * activity_event (until object_event lands with M9a), tasks, risks, and
 * approval items with their trail. Everything is limited to a window.
 */

type Client = Pick<Awaited<ReturnType<typeof createSupabasePageClient>>, "from">;

export const PROCESS_LIMIT = 5000;
export const WINDOW_DAYS = [30, 90, 180] as const;
export type WindowDays = (typeof WINDOW_DAYS)[number];

export interface ProcessLoad {
  histories: TaskHistory[];
  turnaround: TurnaroundInput[];
  approvalItems: ApprovalItemRow[];
  approvalEvents: ApprovalEventRow[];
  truncated: boolean;
}

export async function loadProcessData(client: Client, since: Date): Promise<ProcessLoad> {
  const from = since.toISOString();
  const [tasks, activity, risks, items, events] = await Promise.all([
    // Tasks alive during the window: still open, or finished inside it.
    client
      .from("task")
      .select("id, status, created_at, completed_at")
      .is("archived_at", null)
      .or(`completed_at.is.null,completed_at.gte.${from}`)
      .order("created_at", { ascending: false })
      .limit(PROCESS_LIMIT),
    client
      .from("activity_event")
      .select("source_id, created_at, metadata")
      .eq("source_type", "task")
      .gte("created_at", from)
      .order("created_at", { ascending: true })
      .limit(PROCESS_LIMIT * 2),
    client.from("risk").select("created_at, closed_at").or(`closed_at.is.null,closed_at.gte.${from}`).limit(PROCESS_LIMIT),
    client
      .from("approval_item")
      .select("id, title, status, created_at, decided_at")
      .or(`status.eq.pending,decided_at.gte.${from}`)
      .limit(PROCESS_LIMIT),
    client.from("approval_event").select("item_id, kind, step, created_at").gte("created_at", from).limit(PROCESS_LIMIT * 2),
  ]);
  for (const result of [tasks, activity, risks, items, events]) {
    if (result.error) throw new Error(result.error.message);
  }

  const changesByTask = new Map<string, TaskHistory["changes"]>();
  for (const event of activity.data ?? []) {
    const changes = statusChangesFromMetadata(event.metadata, event.created_at);
    if (changes.length) changesByTask.set(event.source_id, [...(changesByTask.get(event.source_id) ?? []), ...changes]);
  }
  const histories: TaskHistory[] = (tasks.data ?? []).map((task) => ({
    id: task.id,
    createdAt: task.created_at,
    currentStatus: task.status,
    changes: changesByTask.get(task.id) ?? [],
  }));

  const turnaroundRows: TurnaroundInput[] = [
    ...(tasks.data ?? [])
      .filter((task) => task.created_at >= from || task.completed_at)
      .map((task) => ({ type: "task", start: task.created_at, end: task.completed_at })),
    ...(risks.data ?? []).map((risk) => ({ type: "risk", start: risk.created_at, end: risk.closed_at })),
    ...(items.data ?? []).map((item) => ({ type: "approval", start: item.created_at, end: item.decided_at })),
  ];

  const truncated = [tasks, risks, items].some((result) => (result.data?.length ?? 0) >= PROCESS_LIMIT) ||
    [activity, events].some((result) => (result.data?.length ?? 0) >= PROCESS_LIMIT * 2);

  return {
    histories,
    turnaround: turnaroundRows,
    approvalItems: (items.data ?? []).map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      createdAt: item.created_at,
    })),
    approvalEvents: (events.data ?? []).map((event) => ({
      itemId: event.item_id,
      kind: event.kind,
      step: event.step,
      at: event.created_at,
    })),
    truncated,
  };
}
