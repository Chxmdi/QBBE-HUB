"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { LOCALE_COOKIE, LOCALES } from "@/lib/i18n/config";
import { createTranslator } from "@/lib/i18n/translate";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

/** "auto" clears the choice so the browser's language applies again. */
const localeChoiceSchema = z.enum([...LOCALES, "auto"]);

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Saves the interface language (#141).
 *
 * Signed in, the choice goes on the profile so it follows the person to every
 * device. The cookie is written either way: it is what the sign-in screen can
 * read before anybody is signed in, and it keeps a signed-out browser in the
 * language its last user chose.
 */
export async function setInterfaceLanguage(input: unknown): Promise<ActionResult> {
  const t = createTranslator(await getLocale());
  const parsed = localeChoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("language.invalid") };
  const choice = parsed.data;

  const session = await getSessionContext().catch(() => null);
  if (session) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("user_profile")
      .update({ locale: choice === "auto" ? null : choice })
      .eq("id", session.userId);
    if (error) return { ok: false, error: t("language.saveError") };
  }

  const jar = await cookies();
  if (choice === "auto") {
    jar.delete(LOCALE_COOKIE);
  } else {
    jar.set(LOCALE_COOKIE, choice, {
      path: "/",
      maxAge: ONE_YEAR,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
