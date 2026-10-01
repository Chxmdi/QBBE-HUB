import type { ActionDefinition } from "@/lib/objects/contracts";
import { createProject } from "@/features/projects/services/project.commands";

/**
 * `project.create` for the action registry (plan A8), the project's twin of
 * `task.create`. It records through the existing createProject command, so a
 * project made by an import is the same thing as one made by the form: the
 * same checks (a program the caller manages, or an administrator for an
 * independent project), the same channel, membership and activity entry.
 *
 * A program is not an object in the registry, so there is no target for the
 * registry to check; the command's own authorization decides.
 */
export interface ProjectCreateInput {
  name: string;
  outcome?: string;
  programId?: string;
  ownerId?: string;
  sponsorId?: string;
  startDate?: string;
  targetDate?: string;
  priority?: "low" | "medium" | "high" | "critical";
  health?: "on_track" | "at_risk" | "off_track" | "paused" | "unknown";
  healthReason?: string;
  reportingCadence?: "none" | "weekly" | "monthly";
  stage?: "proposed" | "approved" | "planning" | "active";
}

export const PROJECT_CREATE_ACTION = "project.create";

export function projectCreateAction(): ActionDefinition<ProjectCreateInput> {
  return {
    key: PROJECT_CREATE_ACTION,
    label: { en: "Create project", fr: "Créer un projet" },
    capability: "edit_content",
    targets: () => [],
    async run(_context, input) {
      const result = await createProject(input);
      if (!result.ok || !result.id) throw new Error(`project.create failed: ${result.error ?? "failed"}`);
      return [
        {
          kind: "create",
          object: { id: result.id, type: "project" },
          values: { title: input.name, program: input.programId ?? null },
        },
      ];
    },
  };
}
