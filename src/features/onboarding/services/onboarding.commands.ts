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

const preferencesSchema = z.object({
  emailCritical: z.boolean().default(true),
  emailDigest: z.boolean().default(false),
  quietHoursStart: z.coerce.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.coerce.number().int().min(0).max(23).nullable().optional(),
});

export async function saveNotificationPreferences(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("notification_preference").upsert(
    {
      user_id: session.userId,
      email_critical: data.emailCritical,
      email_digest: data.emailDigest,
      quiet_hours_start: data.quietHoursStart ?? null,
      quiet_hours_end: data.quietHoursEnd ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) return { ok: false, error: "Could not save your preferences." };
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
