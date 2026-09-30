import { z } from "zod";
import { coverKeys } from "./covers";

/** Input shapes for the page server actions (M4a). Messages are translated keys. */

const id = z.string().uuid();

export const createPageSchema = z.object({
  parentPageId: id.nullable().optional(),
  visibility: z.enum(["workspace", "private"]).default("workspace"),
  title: z.string().trim().max(500).optional(),
});

export const renamePageSchema = z.object({
  pageId: id,
  title: z.string().trim().max(500),
});

export const setPageIconSchema = z.object({
  pageId: id,
  icon: z.string().trim().max(32).nullable(),
});

export const setPageCoverSchema = z.object({
  pageId: id,
  cover: z.enum(coverKeys).nullable(),
});

export const movePageSchema = z.object({
  pageId: id,
  /** Null moves the page to the top level of `visibility`. */
  parentPageId: id.nullable(),
  visibility: z.enum(["workspace", "private"]),
  position: z.number().finite().optional(),
});

export const stepPageSchema = z.object({
  pageId: id,
  direction: z.enum(["up", "down"]),
});

export const pageIdSchema = z.object({ pageId: id });
