"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Tell us your name.").max(120),
  title: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(80).optional(),
});

export async function saveOnboardingProfile(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
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

  if (error) return { ok: false, error: "Could not save your profile." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Marks onboarding complete. Optional steps never block the workspace. */
export async function completeOnboarding(): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("user_profile")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", session.userId);
  if (error) return { ok: false, error: "Could not complete setup." };
  revalidatePath("/", "layout");
  return { ok: true };
}

const densitySchema = z.enum(["comfortable", "compact"]);

/** Display density for heavy operational screens (P1-UX-07). */
export async function setDisplayDensity(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = densitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid density." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("user_profile")
    .update({ display_density: parsed.data })
    .eq("id", session.userId);
  if (error) return { ok: false, error: "Could not save the setting." };

  revalidatePath("/", "layout");
  return { ok: true };
}
