import { z } from "zod";

/** A native type key, `page`, or a custom type's key (lower snake case). */
export const objectTypeKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,62}$/);

export const objectRefSchema = z.object({
  id: z.string().uuid(),
  type: objectTypeKeySchema,
});
