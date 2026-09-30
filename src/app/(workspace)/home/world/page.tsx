import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { HomeSection } from "@/features/home/components/home-section";
import { HomeTabs } from "@/features/home/components/home-tabs";
import { homeT } from "@/features/home/i18n";
import { WORLD_KEYS, buildMyWorld } from "@/features/home/sections";
import { loadHomeData } from "@/features/home/services/home.queries";

export async function generateMetadata(): Promise<Metadata> {
  return { title: homeT(await getLocale())("page.worldTitle") };
}
export const dynamic = "force-dynamic";

/** My World (M17b): my tasks, meetings, projects, waiting on, mentions, decisions needed. */
export default async function MyWorldPage() {
  const session = await requireSession();
  if (!(await isEnabled("wos_home"))) notFound();
  const t = homeT(await getLocale());
  const format = await getFormatters();
  const db = await createSupabasePageClient();
  const world = buildMyWorld(await loadHomeData(db, { userId: session.userId, timeZone: session.timeZone }));

  return (
    <div>
      <PageHeader title={t("page.worldTitle")} description={t("page.worldDescription")} />
      <HomeTabs active="world" t={t} />
      <div className="grid gap-4 lg:grid-cols-2">
        {WORLD_KEYS.map((key) => (
          <HomeSection
            key={key}
            id={`world-${key}`}
            title={t(`world.${key}.title`)}
            empty={t(`world.${key}.empty`)}
            items={world[key]}
            t={t}
            format={format}
            timeZone={session.timeZone}
          />
        ))}
      </div>
    </div>
  );
}
