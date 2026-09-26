import { z } from "zod";

/**
 * Pure helpers for the document library (#147): folder categories, tag
 * parsing and search text. Kept free of server imports so pages, client
 * components and unit tests can share them.
 */

export const FOLDER_CATEGORIES = [
  { id: "governance", label: "Governance" },
  { id: "hr", label: "HR" },
  { id: "finance", label: "Finance" },
  { id: "programs", label: "Programs" },
  { id: "operations", label: "Operations" },
  { id: "other", label: "Other" },
] as const;

export type FolderCategory = (typeof FOLDER_CATEGORIES)[number]["id"];

export interface LibraryFolder {
  id: string;
  category: FolderCategory;
  name: string;
  visibility: "organization" | "staff";
}

export function categoryLabel(category: string): string {
  return FOLDER_CATEGORIES.find((c) => c.id === category)?.label ?? "Other";
}

/** "Governance / Bylaws". */
export function folderLabel(folder: Pick<LibraryFolder, "category" | "name">): string {
  return `${categoryLabel(folder.category)} / ${folder.name}`;
}

/** Folders grouped by category, in the category order above, for a <select>. */
export function groupFolders<T extends Pick<LibraryFolder, "category" | "name">>(
  folders: T[],
): { category: string; label: string; folders: T[] }[] {
  return FOLDER_CATEGORIES.map((c) => ({
    category: c.id as string,
    label: c.label as string,
    folders: folders
      .filter((f) => f.category === c.id)
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.folders.length > 0);
}

export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 40;

/**
 * "Policy, Conduct , policy" → ["policy", "conduct"]. The database normalizes
 * the same way; doing it here too lets the form refuse early and say why.
 */
export function parseTags(input: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(input) ? input : (input ?? "").split(",");
  const tags: string[] = [];
  for (const value of raw) {
    const tag = value.trim().toLowerCase();
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/**
 * Escapes a person's search words for a Postgres ILIKE pattern, so `%` and
 * `_` are matched literally instead of acting as wildcards.
 */
export function likePattern(query: string): string {
  const escaped = query.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

/** Tags as typed (comma-separated) or as a list, validated after parsing. */
export const tagsSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => parseTags(value))
  .refine((tags) => tags.length <= MAX_TAGS, `Use at most ${MAX_TAGS} tags.`)
  .refine(
    (tags) => tags.every((tag) => tag.length <= MAX_TAG_LENGTH),
    `Each tag can be at most ${MAX_TAG_LENGTH} characters.`,
  );

