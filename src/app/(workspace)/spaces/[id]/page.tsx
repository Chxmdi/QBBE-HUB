import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { ShareMenu } from "@/features/sharing/components/share-menu";
import { getSharingT } from "@/features/sharing/i18n";
import { loadSharePanel } from "@/features/sharing/services/share.queries";
import { getSpacesT } from "@/features/spaces/i18n";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getSpacesT())("metaTitle") };
}

/**
 * One space and its share menu (M10f). Behind `wos_spaces`. Integration can
 * render <ShareMenu> for a page the same way, with the page's object id.
 */
export default async function SpacePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  if (!(await isEnabled("wos_spaces"))) notFound();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const [locale, t, st] = await Promise.all([getLocale(), getSharingT(), getSpacesT()]);
  const panel = await loadSharePanel(id, locale);
  if (!panel || !["workspace", "program", "private", "custom"].includes(panel.target.kind)) notFound();

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow={st(`kinds.${panel.target.kind as "workspace" | "program" | "private" | "custom"}`)}
        title={panel.target.name ?? ""}
        actions={
          <Link href="/spaces" className="text-sm font-medium text-brand-fg underline underline-offset-2">
            {st("roles.back")}
          </Link>
        }
      />
      {panel.target.kind === "private" ? <p className="mb-4 text-[13px] text-muted">{t("privateSpace")}</p> : null}
      {panel.target.kind === "program" ? (
        <p className="mb-4 text-[13px] text-muted">
          {t("programSpace")}{" "}
          <Link href={`/programs/${panel.target.id}`} className="font-medium text-brand-fg underline underline-offset-2">
            {t("programLink")}
          </Link>
        </p>
      ) : null}
      <ShareMenu panel={panel} />
    </div>
  );
}
