import { notFound, redirect } from "next/navigation";
import { getApp } from "@/features/apps/services/app.queries";
import { navigation, validateAppDefinition } from "@/features/apps/schema";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";

/** An app opens on the first screen in its menu. */
export default async function AppHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await requireSession();
  const supabase = await createSupabasePageClient();
  if (!(await isEnabled("wos_objects", supabase))) notFound();
  const app = await getApp(supabase, session.organizationId, { slug });
  const validation = app ? validateAppDefinition(app.definition) : null;
  if (!app || !validation?.ok) notFound();
  const first = navigation(validation.app)[0];
  if (!first) notFound();
  redirect(`/apps/${app.slug}/${first.key}`);
}
