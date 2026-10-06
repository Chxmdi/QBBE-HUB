import type { QuerySpec } from "@/lib/objects/contracts";

/**
 * The living project page (M19b) is built from query blocks: each section is
 * a query spec in the agreed format (contracts.ts, plan A7). ./run-blocks.ts
 * runs every one of them through the lens query engine (M8a), so the same
 * specs work in query blocks in pages (M8e) and a person can later add,
 * remove or edit blocks. The properties each spec selects are the ones the
 * section shows plus the ones its link needs (project, meeting, source).
 */

export const BLOCK_KEYS = ["openTasks", "decisions", "milestones", "files", "activity", "risks"] as const;
export type BlockKey = (typeof BLOCK_KEYS)[number];

export interface ProjectBlock {
  key: BlockKey;
  spec: QuerySpec;
  /** Where "See all" goes. */
  href: string;
}

const OPEN_TASK_STATUSES = ["not_started", "ready", "in_progress", "waiting", "blocked", "in_review"];

export function projectBlocks(projectId: string): ProjectBlock[] {
  const inProject = { property: "project", op: "eq" as const, value: projectId };
  return [
    {
      key: "openTasks",
      href: `/my-work?project=${projectId}`,
      spec: {
        version: 1,
        types: ["task"],
        filter: { and: [inProject, { property: "status", op: "in", value: OPEN_TASK_STATUSES }] },
        sorts: [{ property: "due", direction: "asc" }],
        properties: ["status", "due", "assignee", "priority"],
        limit: 10,
      },
    },
    {
      key: "decisions",
      href: `/projects/${projectId}`,
      spec: {
        version: 1,
        types: ["decision"],
        filter: inProject,
        sorts: [{ property: "decided_time", direction: "desc" }],
        properties: ["decided_time", "meeting", "project"],
        limit: 5,
      },
    },
    {
      key: "milestones",
      href: `/projects/${projectId}`,
      spec: {
        version: 1,
        types: ["milestone"],
        filter: inProject,
        sorts: [{ property: "due", direction: "asc" }],
        properties: ["due", "status", "completed_time", "project"],
        limit: 10,
      },
    },
    {
      key: "files",
      href: `/documents?project=${projectId}`,
      spec: {
        version: 1,
        types: ["document"],
        // The engine never lists archived files, so no archived filter is needed.
        filter: inProject,
        sorts: [{ property: "edited_time", direction: "desc" }],
        properties: ["edited_time", "kind"],
        limit: 8,
      },
    },
    {
      key: "activity",
      href: `/projects/${projectId}`,
      spec: {
        version: 1,
        types: ["activity"],
        filter: inProject,
        sorts: [{ property: "created_time", direction: "desc" }],
        properties: ["created_time", "source_type", "source_id", "project"],
        limit: 10,
      },
    },
    {
      key: "risks",
      href: `/projects/${projectId}`,
      spec: {
        version: 1,
        types: ["risk"],
        filter: { and: [inProject, { property: "status", op: "in", value: ["open", "mitigating"] }] },
        sorts: [{ property: "score", direction: "desc" }],
        properties: ["status", "likelihood", "impact", "score", "project"],
        limit: 8,
      },
    },
  ];
}
