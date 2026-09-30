import { workspaceCapabilities, type WorkspaceCapability } from "@/lib/objects/contracts";

/**
 * Custom roles (M10d): named sets of the seven Workspace OS capabilities.
 * The bit values match app.cap_bit in 20261102010200_access_model.sql.
 */
export const capabilityBits: Record<WorkspaceCapability, number> = {
  view: 1,
  comment: 2,
  edit_content: 4,
  edit_structure: 8,
  manage: 16,
  run_workflow: 32,
  share: 64,
};

/** The built-in roles offered when sharing, smallest first. */
export const sharingRoleKeys = ["viewer", "commenter", "editor", "full_access"] as const;

export function bitsFromCapabilities(capabilities: Iterable<string>): number {
  let bits = 0;
  for (const capability of capabilities) {
    if (capability in capabilityBits) bits |= capabilityBits[capability as WorkspaceCapability];
  }
  // View comes with any other capability, as the database enforces.
  return bits === 0 ? 0 : bits | capabilityBits.view;
}

export function capabilitiesFromBits(bits: number): WorkspaceCapability[] {
  return workspaceCapabilities.filter((capability) => (bits & capabilityBits[capability]) !== 0);
}

/** A stable key from the English name: lower snake case, as the table requires. */
export function roleKeyFromName(name: string, suffix: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40);
  return `${base || "role"}_${suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
}

export interface AccessRole {
  id: string;
  key: string;
  name: { en: string; fr: string };
  capabilities: WorkspaceCapability[];
  builtin: boolean;
  /** How many shares use it; null when the reader may not see counts. */
  uses: number | null;
}
