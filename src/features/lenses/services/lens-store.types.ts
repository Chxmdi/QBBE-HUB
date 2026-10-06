import type { LensSpec } from "@/lib/query/spec";

export const LENS_KINDS = ["table", "board", "list", "calendar", "timeline", "gallery", "feed", "dashboard"] as const;
export type LensKind = (typeof LENS_KINDS)[number];

/** A saved lens as the screens use it. */
export interface SavedLens {
  id: string;
  name: string;
  kind: LensKind;
  typeKey: string | null;
  spec: LensSpec | Record<string, unknown>;
  layout: Record<string, unknown>;
  visibility: "personal" | "shared";
  path: string | null;
  legacyQuery: Record<string, string> | null;
  unsupportedFilters: string[];
  ownerId: string;
  ownerName: string | null;
  mine: boolean;
  fromSavedView: boolean;
}

/** Where a lens opens. Converted saved views reopen their screen with the same URL filters. */
export function lensHref(lens: Pick<SavedLens, "id" | "kind" | "path" | "legacyQuery" | "fromSavedView">): string {
  if (lens.fromSavedView && lens.legacyQuery && (lens.path === "/board" || lens.path === "/my-work")) {
    const query = new URLSearchParams(
      Object.entries(lens.legacyQuery).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== "view"),
    ).toString();
    return `/lenses${lens.path}${query ? `?${query}` : ""}`;
  }
  // Everything else opens in the table, which can show any spec. The other
  // lens kinds get their own ?lens= screens as they are built.
  return `/lenses/table?lens=${lens.id}`;
}
