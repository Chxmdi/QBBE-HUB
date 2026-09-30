import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { BlockSection, HealthPanel } from "@/features/project-page/components/living-project";
import { projectPageT } from "@/features/project-page/i18n";
import { loadProjectPage } from "@/features/project-page/services/project-page.queries";

export async function generateMetadata(): Promise<Metadata> {
  return { title: projectPageT(await getLocale())("page.eyebrow") };
}
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The living project page (M19): calculated health and progress, then query
 * blocks for open tasks, recent decisions, milestones, files, activity and
 * risks. Behind wos_home until integration moves it onto /projects/[id].
 */
export default async function LivingProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!(await isEnabled("wos_home"))) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const t = projectPageT(await getLocale());
  const format = await getFormatters();
  const db = await createSupabasePageClient();
  const data = await loadProjectPage(db, id, { userId: session.userId, timeZone: session.timeZone });
  if (!data) notFound();
  const { project } = data;

  return (
    <div>
      <PageHeader
        eyebrow={t("page.eyebrow")}
        title={project.name}
        description={
          [project.outcome, project.target_date ? t("page.target", { date: format.date(project.target_date, session.timeZone) }) : t("page.noTarget")]
            .filter(Boolean)
            .join(" · ")
        }
        actions={
          <Link href={`/projects/${project.id}`} className="text-sm text-brand-fg underline hover:no-underline">
            {t("page.classic")}
          </Link>
        }
      />
      <HealthPanel calculated={data.calculated} reported={project.health} t={t} format={format} timeZone={session.timeZone} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {data.blocks.map((block) => (
          <BlockSection
            key={block.key}
            blockKey={block.key}
            href={block.href}
            rows={block.rows}
            t={t}
            format={format}
            timeZone={session.timeZone}
          />
        ))}
      </div>
    </div>
  );
}
