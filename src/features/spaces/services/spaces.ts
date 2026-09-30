import { workspaceCapabilities, type WorkspaceCapability } from "@/lib/objects/contracts";
import type { Locale } from "@/lib/i18n/config";

/**
 * Spaces (M10a, epic #199): the shape the screens use, and pure helpers.
 * The rules themselves live in SQL (20261102010100_spaces.sql).
 */

export const spaceKinds = ["workspace", "program", "private", "custom"] as const;
export type SpaceKind = (typeof spaceKinds)[number];

export interface Space {
  id: string;
  organizationId: string;
  kind: SpaceKind;
  programId: string | null;
  ownerId: string | null;
  name: { en: string; fr: string };
  description: string | null;
  icon: string | null;
  archivedAt: string | null;
  /** What the signed-in person can do here, in the order of workspaceCapabilities. */
  capabilities: WorkspaceCapability[];
}

/** A row of `public.my_spaces()`. */
export interface SpaceRow {
  id: string;
  organization_id: string;
  kind: string;
  program_id: string | null;
  owner_id: string | null;
  name_en: string;
  name_fr: string;
  description: string | null;
  icon: string | null;
  archived_at: string | null;
  capabilities: string[] | null;
}

export function isSpaceKind(value: unknown): value is SpaceKind {
  return typeof value === "string" && (spaceKinds as readonly string[]).includes(value);
}

/** Unknown kinds and capability names are dropped rather than trusted. */
export function toSpace(row: SpaceRow): Space | null {
  if (!isSpaceKind(row.kind)) return null;
  const granted = new Set(row.capabilities ?? []);
  return {
    id: row.id,
    organizationId: row.organization_id,
    kind: row.kind,
    programId: row.program_id,
    ownerId: row.owner_id,
    name: { en: row.name_en, fr: row.name_fr },
    description: row.description,
    icon: row.icon,
    archivedAt: row.archived_at,
    capabilities: workspaceCapabilities.filter((capability) => granted.has(capability)),
  };
}

export function spaceName(space: Pick<Space, "name">, locale: Locale): string {
  return locale === "fr-CA" ? space.name.fr : space.name.en;
}

export interface GroupedSpaces {
  workspace: Space[];
  private: Space[];
  programs: Space[];
  custom: Space[];
}

/** Spaces in the order the screen shows them; archived ones last in each group. */
export function groupSpaces(spaces: Space[], locale: Locale): GroupedSpaces {
  const byName = (a: Space, b: Space) =>
    Number(a.archivedAt !== null) - Number(b.archivedAt !== null) ||
    spaceName(a, locale).localeCompare(spaceName(b, locale), locale);
  const of = (kind: SpaceKind) => spaces.filter((space) => space.kind === kind).sort(byName);
  return {
    workspace: of("workspace"),
    private: of("private"),
    programs: of("program"),
    custom: of("custom"),
  };
}
