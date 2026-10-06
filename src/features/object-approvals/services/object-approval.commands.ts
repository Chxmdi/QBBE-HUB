"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCan } from "@/lib/objects/can";
import { createActionRegistry } from "@/features/objects/actions/registry";
import { createSupabaseChangeSetStore } from "@/features/objects/actions/supabase-store";
import { objectApprovalsEnabled } from "../flag";
import { objectApprovalsT } from "../i18n";
import { approvableTypes, REQUEST_APPROVAL_ACTION_KEY, requestApprovalAction } from "../contract";

export interface CommandResult {
  ok: boolean;
  id?: string;
  error?: string;
}

const schema = z.object({
  type: z.enum(approvableTypes),
  id: z.string().uuid(),
  title: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
});

/** "Request approval" on a record, through the object.request_approval action. */
export async function requestObjectApproval(input: unknown): Promise<CommandResult> {
  const t = objectApprovalsT(await getLocale());
  if (!(await objectApprovalsEnabled())) return { ok: false, error: t("errors.notFound") };
  const session = await requireSession();
  const limited = await enforceRateLimit("approval:submit", session.userId);
  if (limited) return limited;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const { type, id, title, note } = parsed.data;

  const supabase = await createSupabaseServerClient();
  // The change set names the new approval item (not an object of the
  // registry) and its link to the record, which anchors the organization.
  const registry = createActionRegistry({
    store: createSupabaseChangeSetStore(supabase),
    writer: {
      // Withdrawing is the engine's own "withdraw", not an undo.
      apply: async () => {
        throw new Error("Withdraw the approval from Approvals instead.");
      },
      read: async () => {
        throw new Error("Withdraw the approval from Approvals instead.");
      },
    },
  });
  registry.register(requestApprovalAction((fn, args) => supabase.rpc(fn, args)));
  const result = await registry.run(
    REQUEST_APPROVAL_ACTION_KEY,
    { object: { type, id }, title, note },
    { actor: { kind: "person", id: session.userId }, can: createCan(supabase) },
  );
  if (!result.ok) {
    const waiting = result.message?.includes("already has an approval waiting");
    return { ok: false, error: waiting ? t("request.waiting") : t("request.error") };
  }
  revalidatePath(`/object-approvals/${type}/${id}`);
  const created = result.changeSet.changes[0];
  return { ok: true, id: created?.kind === "create" ? created.object.id : undefined };
}
