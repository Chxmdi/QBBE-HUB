import { z } from "zod";
import { optionalDay, requiredText } from "@/lib/schema";
import type { MessageKey } from "@/lib/i18n/translate";

const K = (key: MessageKey): string => key;

/** An action item raised in a meeting, which becomes an assigned task. */
export const actionSchema = z.object({
  meetingId: z.string().uuid(),
  title: requiredText(K("meetings.errors.actionTitleRequired"), 300),
  ownerId: z.string().uuid().optional(),
  dueAt: optionalDay().optional(),
});
