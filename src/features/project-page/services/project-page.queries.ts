import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarDateInZone } from "@/lib/time";
import { projectBlocks, type BlockKey } from "../blocks";
import { calculateHealth, type ProjectHealth } from "../health";
import { runBlockSpec, type BlockRow } from "../run-blocks";

export interface ProjectPageData {
  project: {
    id: string;
    name: string;
    outcome: string | null;
    stage: string;
    health: string;
    target_date: string | null;
    completed_at: string | null;
    last_status_update_at: string | null;
  };
  calculated: ProjectHealth;
  blocks: { key: BlockKey; href: string; rows: BlockRow[] | null }[];
}

/**
 * Everything the living project page shows, through the viewer's own client.
 * Null when the viewer cannot read the project: the page is then not found,
 * the same answer as for a project that does not exist.
 */
export async function loadProjectPage(
  db: Pick<SupabaseClient, "from">,
  projectId: string,
  viewer: { userId: string; timeZone: string },
  now: Date = new Date(),
): Promise<ProjectPageData | null> {
  const { data: project } = await db
    .from("project")
    .select("id, name, outcome, stage, health, target_date, completed_at, last_status_update_at")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  const today = calendarDateInZone(now, viewer.timeZone) ?? now.toISOString().slice(0, 10);
  const [tasks, milestones, risks, blocks] = await Promise.all([
    db.from("task").select("status, due_at").eq("project_id", projectId).is("archived_at", null).limit(5000),
    db.from("milestone").select("due_date, completed_at, status").eq("project_id", projectId).limit(500),
    db.from("risk").select("likelihood, impact, status").eq("project_id", projectId).limit(500),
    Promise.all(
      projectBlocks(projectId).map(async (block) => {
        try {
          return { key: block.key, href: block.href, rows: await runBlockSpec(db, block.spec, { userId: viewer.userId, timeZone: viewer.timeZone, now: () => now }) };
        } catch {
          // One failing block shows its own error; the rest of the page stays.
          return { key: block.key, href: block.href, rows: null };
        }
      }),
    ),
  ]);

  const calculated = calculateHealth({
    today,
    project: { target_date: project.target_date as string | null, completed_at: project.completed_at as string | null },
    tasks: (tasks.data ?? []) as { status: string; due_at: string | null }[],
    milestones: (milestones.data ?? []) as { due_date: string | null; completed_at: string | null; status: string | null }[],
    risks: (risks.data ?? []) as { likelihood: string; impact: string; status: string }[],
  });

  return { project: project as ProjectPageData["project"], calculated, blocks };
}
