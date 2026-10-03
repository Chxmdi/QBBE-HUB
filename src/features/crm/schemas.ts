import { z } from "zod";
import { isCalendarDate, requiredText } from "@/lib/schema";
import { peopleEn } from "@/lib/i18n/messages/workspace/people.en";

const V = peopleEn.crm.validation;

/** A follow-up with a contact organization: a task with a real due day. */
export const followUpSchema = z.object({
  crmOrganizationId: z.string().uuid(),
  title: requiredText(V.followUpTitle, 300),
  dueAt: requiredText(V.pickDueDate).refine(isCalendarDate, V.pickDueDate),
});
