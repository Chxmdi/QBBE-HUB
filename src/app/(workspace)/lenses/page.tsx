import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { listLenses } from "@/features/lenses/services/lens-store.queries";
import { LensIndex } from "@/features/lenses/components/lens-index";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("saved.title") };
}
export const dynamic = "force-dynamic";

/** Saved lenses (M8d): the viewer's own and the organization's shared ones. */
export default async function LensesPage() {
  await requireLensesEnabled();
  const session = await requireSession();
  const t = await getLensT();
  const lenses = await listLenses(session.userId);
  return (
    <div>
      <PageHeader
        title={t("saved.title")}
        description={t("saved.description")}
        actions={
          <div className="flex flex-wrap gap-3 text-[13px] font-medium">
            <Link href="/lenses/table" className="text-brand-fg hover:underline">{t("table.title")}</Link>
            <Link href="/lenses/board" className="text-brand-fg hover:underline">{t("board.title")}</Link>
            <Link href="/lenses/my-work" className="text-brand-fg hover:underline">{t("myWork.title")}</Link>
            <Link href="/lenses/import" className="text-brand-fg hover:underline">{t("csv.importLink")}</Link>
          </div>
        }
      />
      <LensIndex lenses={lenses} />
    </div>
  );
}
