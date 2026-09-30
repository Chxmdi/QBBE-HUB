import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { AppEditor } from "@/features/apps/components/app-editor";
import { appsMessages, fill } from "@/features/apps/i18n";
import { starterAppDefinition, validateAppDefinition } from "@/features/apps/schema";
import { getApp, listRoleGrants } from "@/features/apps/services/app.queries";
import { requireAdminAal2 } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: appsMessages(await getLocale()).launcher.title };
}

/** Settings for one app: owners and admins only (the database enforces the same). */
export default async function ManageAppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAdminAal2();
  const supabase = await createSupabasePageClient();
  if (!(await isEnabled("wos_objects", supabase))) notFound();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const app = await getApp(supabase, session.organizationId, { id });
  if (!app) notFound();

  const locale = await getLocale();
  const messages = appsMessages(locale);
  const validation = validateAppDefinition(app.definition);
  const grants = await listRoleGrants(supabase, app.id);
  const name = locale === "fr-CA" ? app.nameFr : app.nameEn;

  return (
    <div>
      <PageHeader eyebrow={messages.launcher.title} title={fill(messages.manage.title, { name })} />
      <AppEditor
        key={app.id}
        app={{
          id: app.id,
          slug: app.slug,
          nameEn: app.nameEn,
          nameFr: app.nameFr,
          descriptionEn: app.descriptionEn,
          descriptionFr: app.descriptionFr,
          definition: validation.ok ? validation.app : starterAppDefinition(),
          published: app.publishedAt !== null,
        }}
        grants={grants}
        messages={messages}
        locale={locale}
      />
    </div>
  );
}
