import type { createSupabasePageClient } from "@/lib/supabase/page";
import type { GraphData, GraphEdge, GraphNode } from "./graph";

/**
 * Stand-in graph source: programmes, projects, milestones and tasks with the
 * native links between them, read through the viewer's own client so every
 * table's RLS decides what appears. An edge is drawn only when both of its
 * objects came back, so a link never reveals an object the viewer cannot read.
 *
 * Replaced by S4's query engine plus S1's relation layer (M3) at integration;
 * the lens itself only sees GraphData.
 */

type Client = Pick<Awaited<ReturnType<typeof createSupabasePageClient>>, "from">;

export const GRAPH_TYPES = ["program", "project", "milestone", "task"] as const;

/** Caps keep a large workspace drawable; the page says when a cap was hit. */
export const GRAPH_LIMITS = { program: 100, project: 200, milestone: 400, task: 600 } as const;

export interface GraphLoad {
  data: GraphData;
  truncated: boolean;
}

export async function loadWorkGraph(client: Client): Promise<GraphLoad> {
  const [programs, projects, milestones, tasks, taskDeps, milestoneDeps] = await Promise.all([
    client.from("program").select("id, name").order("name").limit(GRAPH_LIMITS.program),
    client
      .from("project")
      .select("id, name, program_id")
      .is("archived_at", null)
      .order("name")
      .limit(GRAPH_LIMITS.project),
    client.from("milestone").select("id, name, project_id").order("sort_key").limit(GRAPH_LIMITS.milestone),
    client
      .from("task")
      .select("id, title, project_id, milestone_id, program_id")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(GRAPH_LIMITS.task),
    client.from("task_dependency").select("blocking_task_id, blocked_task_id").limit(2000),
    client.from("milestone_dependency").select("blocking_milestone_id, blocked_milestone_id").limit(2000),
  ]);
  for (const result of [programs, projects, milestones, tasks, taskDeps, milestoneDeps]) {
    if (result.error) throw new Error(result.error.message);
  }

  const nodes: GraphNode[] = [];
  const known = new Set<string>();
  const add = (node: GraphNode) => {
    nodes.push(node);
    known.add(node.ref.id);
  };
  for (const row of programs.data ?? []) {
    add({ ref: { id: row.id, type: "program" }, title: row.name, href: `/programs/${row.id}` });
  }
  for (const row of projects.data ?? []) {
    add({ ref: { id: row.id, type: "project" }, title: row.name, href: `/projects/${row.id}` });
  }
  for (const row of milestones.data ?? []) {
    add({ ref: { id: row.id, type: "milestone" }, title: row.name, href: `/projects/${row.project_id}` });
  }
  for (const row of tasks.data ?? []) {
    add({ ref: { id: row.id, type: "task" }, title: row.title, href: `/my-work?task=${row.id}` });
  }

  const edges: GraphEdge[] = [];
  const link = (edge: GraphEdge) => {
    if (known.has(edge.from.id) && known.has(edge.to.id)) edges.push(edge);
  };
  for (const row of projects.data ?? []) {
    if (row.program_id) {
      link({
        relationTypeKey: "contains",
        from: { id: row.program_id, type: "program" },
        to: { id: row.id, type: "project" },
        source: "project_program",
      });
    }
  }
  for (const row of milestones.data ?? []) {
    link({
      relationTypeKey: "contains",
      from: { id: row.project_id, type: "project" },
      to: { id: row.id, type: "milestone" },
      source: "milestone_project",
    });
  }
  for (const row of tasks.data ?? []) {
    // A task in a milestone hangs off the milestone, not the project too:
    // the milestone already sits inside the project.
    if (row.milestone_id && known.has(row.milestone_id)) {
      link({
        relationTypeKey: "contains",
        from: { id: row.milestone_id, type: "milestone" },
        to: { id: row.id, type: "task" },
        source: "task_milestone",
      });
    } else if (row.project_id) {
      link({
        relationTypeKey: "contains",
        from: { id: row.project_id, type: "project" },
        to: { id: row.id, type: "task" },
        source: "task_project",
      });
    } else if (row.program_id) {
      link({
        relationTypeKey: "contains",
        from: { id: row.program_id, type: "program" },
        to: { id: row.id, type: "task" },
        source: "task_project",
      });
    }
  }
  for (const row of taskDeps.data ?? []) {
    link({
      relationTypeKey: "blocks",
      from: { id: row.blocking_task_id, type: "task" },
      to: { id: row.blocked_task_id, type: "task" },
      source: "task_dependency",
    });
  }
  for (const row of milestoneDeps.data ?? []) {
    link({
      relationTypeKey: "blocks",
      from: { id: row.blocking_milestone_id, type: "milestone" },
      to: { id: row.blocked_milestone_id, type: "milestone" },
      source: "milestone_dependency",
    });
  }

  const truncated =
    (programs.data?.length ?? 0) >= GRAPH_LIMITS.program ||
    (projects.data?.length ?? 0) >= GRAPH_LIMITS.project ||
    (milestones.data?.length ?? 0) >= GRAPH_LIMITS.milestone ||
    (tasks.data?.length ?? 0) >= GRAPH_LIMITS.task;
  return { data: { nodes, edges }, truncated };
}
