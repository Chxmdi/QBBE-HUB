import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { HomeSection } from "@/features/home/components/home-section";
import { HomeTabs } from "@/features/home/components/home-tabs";
import { explainAttention } from "@/features/home/explain";
import { homeT } from "@/features/home/i18n";
import { SECTION_KEYS, buildHomeSections } from "@/features/home/sections";
import { loadHomeData } from "@/features/home/services/home.queries";

export async function generateMetadata(): Promise<Metadata> {
  return { title: homeT(await getLocale())("page.title") };
}
export const dynamic = "force-dynamic";

/**
 * Home (M17a): Now, Today, Waiting, Continue, Decisions and Changes. Now is
 * ranked by the attention score, each item with its reasons (M17c).
 */
export default async function HomePage() {
  const session = await requireSession();
  if (!(await isEnabled("wos_home"))) notFound();
  const t = homeT(await getLocale());
  const format = await getFormatters();
  const db = await createSupabasePageClient();
  const data = await loadHomeData(db, { userId: session.userId, timeZone: session.timeZone });
  const sections = buildHomeSections(data);

  return (
    <div>
      <PageHeader title={t("page.title")} description={t("page.description")} />
      <HomeTabs active="home" t={t} />
      <div className="grid gap-4 lg:grid-cols-2">
        {SECTION_KEYS.map((key) => (
          <HomeSection
            key={key}
            id={key}
            title={t(`section.${key}.title`)}
            empty={t(`section.${key}.empty`)}
            items={sections[key]}
            t={t}
            format={format}
            timeZone={session.timeZone}
          >
            {(item) =>
              item.attention ? (
                <p className="mt-0.5 text-xs text-ink">
                  <span className="sr-only">{t("attention.why")}: </span>
                  {explainAttention(item.attention, t)}
                </p>
              ) : null
            }
          </HomeSection>
        ))}
      </div>
    </div>
  );
}
