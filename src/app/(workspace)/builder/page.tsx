import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { NewBlueprintButton } from "@/features/blueprints/components/new-blueprint-button";
import { blueprintsMessages, fill } from "@/features/blueprints/i18n";
import { listBlueprints } from "@/features/blueprints/services/blueprint.queries";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: blueprintsMessages(await getLocale()).title };
}

export default async function BuilderPage() {
  const session = await requireSession();
  const supabase = await createSupabasePageClient();
  if (!(await isEnabled("wos_objects", supabase)) || !session.isStaff) notFound();

  const locale = await getLocale();
  const messages = blueprintsMessages(locale);
  const blueprints = await listBlueprints(supabase, session.organizationId);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div>
      <PageHeader
        title={messages.title}
        description={messages.description}
        actions={
          session.isAdmin ? (
            <NewBlueprintButton label={messages.newBlueprint} takenKeys={blueprints.map((b) => b.key)} />
          ) : null
        }
      />
      {session.isAdmin ? null : <p className="mb-4 text-[13px] text-muted">{messages.readOnly}</p>}
      {blueprints.length === 0 ? (
        <EmptyState title={messages.empty} />
      ) : (
        <ul className="divide-y divide-line rounded-(--radius-md) border border-line bg-surface">
          {blueprints.map((blueprint) => (
            <li key={blueprint.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <Link href={`/builder/${blueprint.id}`} className="font-medium text-brand-fg hover:underline">
                  {locale === "fr-CA" ? blueprint.nameFr : blueprint.nameEn}
                </Link>
                <p className="text-[12.5px] text-muted">
                  {fill(messages.updated, { when: date.format(new Date(blueprint.updatedAt)) })}
                </p>
              </div>
              <Badge tone={blueprint.status === "built" ? "success" : blueprint.status === "approved" ? "info" : "neutral"}>
                {messages.status[blueprint.status]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
