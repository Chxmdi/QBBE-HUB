import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandCatalog } from "./autocomplete";
import type { ParseResult } from "./parse";

const TASK_LIMIT = 25;
const OBJECT_LIMIT = 12;

/** `%` and `_` are wildcards in ilike; a name containing them is matched literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** What the text needs looked up: the typed task title and open target, if any. */
export function catalogNeeds(parsed: ParseResult): { task: string | null; target: string | null } {
  if (parsed.ok) {
    const { command } = parsed;
    return {
      task: command.kind === "assign_task" || command.kind === "move_task" ? command.task : null,
      target: command.kind === "open" ? command.target : null,
    };
  }
  if (parsed.reason === "incomplete" || parsed.reason === "unknown_status") {
    return {
      task: parsed.slot === "task" ? parsed.partial : (parsed.filled.task ?? null),
      target: parsed.slot === "target" ? parsed.partial : null,
    };
  }
  return { task: null, target: null };
}

/**
 * The names a command can refer to, read through the viewer's own client, so
 * row-level security decides every one: a command can only name a task,
 * person, space or record the viewer could already open.
 *
 * Spaces are programs until spaces arrive (M10a, stream S2).
 */
export async function loadCommandCatalog(
  db: SupabaseClient,
  needs: { task: string | null; target: string | null },
): Promise<CommandCatalog> {
  let tasks = db
    .from("task")
    .select("id, title")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(TASK_LIMIT);
  if (needs.task) tasks = tasks.ilike("title", likePattern(needs.task));

  const [taskRows, memberRows, programRows, objectRows] = await Promise.all([
    tasks,
    db
      .from("organization_membership")
      .select("user_id, user_profile:user_id(full_name)")
      .eq("status", "active"),
    db.from("program").select("id, name").is("archived_at", null).order("name"),
    needs.target && needs.target.trim().length >= 2
      ? db.rpc("global_search", { p_query: needs.target.trim(), p_limit: OBJECT_LIMIT })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  type Member = { user_id: string; user_profile: { full_name: string | null } | null };
  return {
    tasks: ((taskRows.data ?? []) as { id: string; title: string }[]).map(({ id, title }) => ({ id, title })),
    people: ((memberRows.data ?? []) as unknown as Member[])
      .filter((member) => member.user_profile?.full_name)
      .map((member) => ({ id: member.user_id, name: member.user_profile!.full_name! })),
    spaces: ((programRows.data ?? []) as { id: string; name: string }[]).map(({ id, name }) => ({ id, name })),
    objects: ((objectRows.data ?? []) as { id: string; title: string; result_type: string; href: string }[]).map(
      (row) => ({ id: row.id, title: row.title, type: row.result_type, href: row.href }),
    ),
  };
}
