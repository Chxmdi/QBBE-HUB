import { z } from "zod";

export const createMilestoneSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1, "A milestone needs a name.").max(200),
  dueDate: z.string().optional(),
});

export const updateMilestoneSchema = z.object({
  milestoneId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  dueDate: z.string().nullable().optional(),
});
