"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

/** Built per call so the validation message is in the person's language. */
function profileSchema(t: TranslateFn) {
  return z.object({
    fullName: requiredText(t("onboarding.errors.nameRequired"), 120),
    title: z.string().trim().max(120).optional(),
    timezone: z.string().trim().max(80).optional(),
  });
}

export async function saveOnboardingProfile(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const parsed = profileSchema(t).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? t("onboarding.errors.invalidInput"),
    };
  }
  const { fullName, title, timezone } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("user_profile")
    .update({
      full_name: fullName,
      title: title || null,
      timezone: timezone || null,
    })
    .eq("id", session.userId);

  if (error) return { ok: false, error: t("onboarding.errors.profileFailed") };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Marks onboarding complete. Optional steps never block the workspace. */
export async function completeOnboarding(): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("user_profile")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", session.userId);
  if (error) return { ok: false, error: t("onboarding.errors.completeFailed") };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Reduced motion as an in-app setting (UI-009), for people who cannot change
 * the operating-system preference. Either one turns animation down.
 */
export async function setReduceMotion(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const parsed = z.boolean().safeParse(input);
  if (!parsed.success) return { ok: false, error: t("onboarding.errors.invalidSetting") };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("user_profile")
    .update({ reduce_motion: parsed.data })
    .eq("id", session.userId);
  if (error) return { ok: false, error: t("onboarding.errors.settingFailed") };

  revalidatePath("/", "layout");
  return { ok: true };
}

const densitySchema = z.enum(["comfortable", "compact"]);

/** Display density for heavy operational screens (P1-UX-07). */
export async function setDisplayDensity(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const parsed = densitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("onboarding.errors.invalidDensity") };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("user_profile")
    .update({ display_density: parsed.data })
    .eq("id", session.userId);
  if (error) return { ok: false, error: t("onboarding.errors.settingFailed") };

  revalidatePath("/", "layout");
  return { ok: true };
}
