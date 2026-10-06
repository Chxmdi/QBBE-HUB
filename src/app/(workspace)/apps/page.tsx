import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateAppForm } from "@/features/apps/components/create-app-form";
import { appsMessages, fill } from "@/features/apps/i18n";
import { listApps } from "@/features/apps/services/app.queries";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: appsMessages(await getLocale()).launcher.title };
}

/** The app launcher: every app the person may open, and for admins, drafts and a way to add one. */
export default async function AppsLauncherPage() {
  const session = await requireSession();
  const supabase = await createSupabasePageClient();
  if (!(await isEnabled("wos_objects", supabase))) notFound();

  const locale = await getLocale();
  const messages = appsMessages(locale);
  const apps = (await listApps(supabase, session.organizationId)).filter((app) => session.isAdmin || !app.archivedAt);

  return (
    <div>
      <PageHeader title={messages.launcher.title} description={messages.launcher.description} />
      {apps.length === 0 ? (
        <EmptyState icon={<LayoutGrid />} title={messages.launcher.empty} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => {
            const name = locale === "fr-CA" ? app.nameFr : app.nameEn;
            const description = locale === "fr-CA" ? app.descriptionFr : app.descriptionEn;
            return (
              <li key={app.id} className="flex flex-col gap-2 rounded-(--radius-md) border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-[15px] font-semibold">
                    <Link href={`/apps/${app.slug}`} className="text-brand-fg hover:underline" aria-label={fill(messages.launcher.open, { name })}>
                      {name}
                    </Link>
                  </h2>
                  {app.archivedAt ? (
                    <Badge>{messages.launcher.archived}</Badge>
                  ) : app.publishedAt ? null : (
                    <Badge tone="warning">{messages.launcher.draft}</Badge>
                  )}
                </div>
                {description ? <p className="text-[13px] text-muted">{description}</p> : null}
                {session.isAdmin ? (
                  <Link href={`/apps/manage/${app.id}`} className="mt-auto text-[13px] text-brand-fg hover:underline">
                    {fill(messages.launcher.manage, { name })}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {session.isAdmin ? (
        <div className="mt-8">
          <CreateAppForm messages={messages} />
        </div>
      ) : null}
    </div>
  );
}
