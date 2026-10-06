"use server";

import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { suggest, type Suggestion } from "./autocomplete";
import { catalogNeeds, loadCommandCatalog } from "./catalog.server";
import { commandsT } from "./i18n";
import { parseCommand } from "./parse";
import { resolveCommand, type CommandPlan } from "./resolve";

/** The feature switch commands sit behind until integration picks their own. */
const FLAG = "wos_home" as const;

export interface CommandRunResult {
  ok: boolean;
  message: string;
  /** Where to go next, for "open" and "show blocked tasks". */
  href?: string;
}

const MAX_INPUT = 500;

export async function suggestCommands(input: string): Promise<Suggestion[]> {
  await requireSession();
  const db = await createSupabaseServerClient();
  if (!(await isEnabled(FLAG, db))) return [];
  const text = String(input ?? "").slice(0, MAX_INPUT);
  const catalog = await loadCommandCatalog(db, catalogNeeds(parseCommand(text)));
  const locale = await getLocale();
  return suggest(text, catalog, locale);
}

async function execute(plan: CommandPlan): Promise<{ ok: boolean; error?: string }> {
  switch (plan.kind) {
    case "navigate":
      return { ok: true };
    case "create_project": {
      const { createProject } = await import("@/features/projects/services/project.commands");
      return createProject({ name: plan.name, programId: plan.spaceId ?? undefined });
    }
    case "assign_task": {
      const { updateTask } = await import("@/features/tasks/services/task.commands");
      return updateTask({ taskId: plan.taskId, assigneeId: plan.personId });
    }
    case "move_task": {
      const { updateTaskStatus } = await import("@/features/tasks/services/task.commands");
      return updateTaskStatus(plan.taskId, plan.status, plan.reason ?? undefined);
    }
    case "add_to_space": {
      const { setDirectProgramAccess } = await import("@/features/admin/services/access-grant.commands");
      return setDirectProgramAccess({ programId: plan.spaceId, userId: plan.personId, role: "contributor" });
    }
  }
}

/**
 * Runs one command. Every write goes through the Hub's existing action for it
 * (createProject, updateTask, updateTaskStatus, setDirectProgramAccess), so a
 * command can do exactly what the person could do on the screen, and nothing
 * else: the same checks, rate limits, history and notifications.
 */
export async function runCommand(input: string): Promise<CommandRunResult> {
  await requireSession();
  const t = commandsT(await getLocale());
  const db = await createSupabaseServerClient();
  if (!(await isEnabled(FLAG, db))) return { ok: false, message: t("errors.unavailable") };

  const text = String(input ?? "").slice(0, MAX_INPUT);
  const parsed = parseCommand(text);
  if (!parsed.ok) {
    if (parsed.reason === "empty") return { ok: false, message: t("errors.empty") };
    if (parsed.reason === "unknown") return { ok: false, message: t("errors.unknown") };
    if (parsed.reason === "unknown_status") {
      return { ok: false, message: t("errors.unknownStatus", { status: parsed.partial }) };
    }
    return { ok: false, message: t(`errors.incomplete.${parsed.slot}`) };
  }

  const catalog = await loadCommandCatalog(db, catalogNeeds(parsed));
  const resolved = resolveCommand(parsed.command, catalog);
  if (!resolved.ok) {
    const slot = t(`slot.${resolved.slot}`).toLowerCase();
    return resolved.reason === "not_found"
      ? { ok: false, message: t("errors.notFound", { slot, name: resolved.name }) }
      : {
          ok: false,
          message: t("errors.ambiguous", { slot, name: resolved.name, candidates: resolved.candidates.join(", ") }),
        };
  }

  const { plan } = resolved;
  const result = await execute(plan);
  if (!result.ok) return { ok: false, message: t("errors.failed", { message: result.error ?? "" }) };
  switch (plan.kind) {
    case "navigate":
      return { ok: true, message: t("result.opening"), href: plan.href };
    case "create_project":
      return { ok: true, message: t("result.projectCreated", { name: plan.name }) };
    case "assign_task":
      return { ok: true, message: t("result.taskAssigned") };
    case "move_task":
      return { ok: true, message: t("result.taskMoved") };
    case "add_to_space":
      return { ok: true, message: t("result.personAdded") };
  }
}
