import { z } from "zod";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

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

const english = createTranslator("en");

/** A category's name in the reader's language (English when `t` is left out). */
export function categoryLabel(category: string, t: TranslateFn = english): string {
  const known = FOLDER_CATEGORIES.find((c) => c.id === category)?.id ?? "other";
  return t(`documents.categories.${known}`);
}

/** "Governance / Bylaws". The folder's own name is data and stays as typed. */
export function folderLabel(
  folder: Pick<LibraryFolder, "category" | "name">,
  t: TranslateFn = english,
): string {
  return t("documents.folderPath", { category: categoryLabel(folder.category, t), name: folder.name });
}

/** Folders grouped by category, in the category order above, for a <select>. */
export function groupFolders<T extends Pick<LibraryFolder, "category" | "name">>(
  folders: T[],
  t: TranslateFn = english,
): { category: string; label: string; folders: T[] }[] {
  return FOLDER_CATEGORIES.map((c) => ({
    category: c.id as string,
    label: categoryLabel(c.id, t),
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

/**
 * Tags as typed (comma-separated) or as a list, validated after parsing. The
 * messages are in the language `t` speaks, so server actions build it per call.
 */
export function tagsSchemaFor(t: TranslateFn) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => parseTags(value))
    .refine((tags) => tags.length <= MAX_TAGS, t("documents.tagsTooMany", { max: MAX_TAGS }))
    .refine(
      (tags) => tags.every((tag) => tag.length <= MAX_TAG_LENGTH),
      t("documents.tagTooLong", { max: MAX_TAG_LENGTH }),
    );
}

/** The English tags schema, for callers outside a request. */
export const tagsSchema = tagsSchemaFor(english);

