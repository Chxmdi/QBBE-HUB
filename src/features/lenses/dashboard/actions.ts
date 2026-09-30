"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLensT } from "@/features/lenses/i18n/server";
import { dashboardLayoutSchema } from "./schema";

/** Creating and saving dashboards (V1-5). RLS lets people write only their own lenses. */

export interface DashboardActionResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function createDashboard(input: unknown): Promise<DashboardActionResult> {
  const session = await requireSession();
  const t = await getLensT();
  const supabase = await createSupabaseServerClient();
  if (!(await isEnabled("wos_lenses", supabase))) return { ok: false, error: t("dashboard.saveFailed") };
  const parsed = z
    .object({ name: z.string().trim().min(1).max(120), shared: z.boolean().default(false) })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: t("dashboard.saveFailed") };
  const { data, error } = await supabase
    .from("lens")
    .insert({
      organization_id: session.organizationId,
      owner_id: session.userId,
      name: parsed.data.name,
      kind: "dashboard",
      spec: {},
      layout: { tiles: [], filters: {} },
      visibility: parsed.data.shared ? "shared" : "personal",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: t("dashboard.saveFailed") };
  revalidatePath("/lenses/dashboard");
  return { ok: true, id: data.id as string };
}

export async function saveDashboardLayout(input: unknown): Promise<DashboardActionResult> {
  await requireSession();
  const t = await getLensT();
  const supabase = await createSupabaseServerClient();
  if (!(await isEnabled("wos_lenses", supabase))) return { ok: false, error: t("dashboard.saveFailed") };
  const parsed = z.object({ id: z.string().uuid(), layout: dashboardLayoutSchema }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: t("dashboard.saveFailed") };
  const { data, error } = await supabase
    .from("lens")
    .update({ layout: parsed.data.layout })
    .eq("id", parsed.data.id)
    .eq("kind", "dashboard")
    .select("id");
  // Zero rows: not the viewer's dashboard (RLS), so nothing was changed.
  if (error || !data?.length) return { ok: false, error: t("saved.notYours") };
  revalidatePath("/lenses/dashboard");
  return { ok: true, id: parsed.data.id };
}
