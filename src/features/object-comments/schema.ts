import { z } from "zod";

/** A native type key, `page`, or a custom type's key (lower snake case). */
export const objectTypeKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,62}$/);

export const objectRefSchema = z.object({
  id: z.string().uuid(),
  type: objectTypeKeySchema,
});

/** The editor's id for a block (S3); short and URL-safe. */
export const blockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
