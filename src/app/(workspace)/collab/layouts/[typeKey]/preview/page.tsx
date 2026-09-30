import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth";
import { layoutsText } from "@/features/object-layouts/messages";
import { layoutCatalog } from "@/features/object-layouts/services/layout.catalog";
import { listObjectTypes, loadLayout, loadTaskPage } from "@/features/object-layouts/services/layout.queries";
import { ObjectLayoutView } from "@/features/object-layouts/components/object-layout-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: layoutsText(await getLocale()).list.title };
}

/** One object drawn with its type's layout (V2-4). */
export default async function LayoutPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ typeKey: string }>;
  searchParams: Promise<{ object?: string }>;
}) {
  if (!(await isEnabled("wos_editor"))) notFound();
  await requireSession();
  const { typeKey } = await params;
  const objectId = z.string().uuid().safeParse((await searchParams).object);
  const type = (await listObjectTypes()).find((candidate) => candidate.key === typeKey);
  if (!type || !objectId.success) notFound();

  const locale = await getLocale();
  const m = layoutsText(locale);
  const data = type.key === "task" ? await loadTaskPage(objectId.data) : null;
  if (!data) {
    return (
      <>
        <PageHeader title={m.list.title} />
        <p className="meta">{m.view.notFound}</p>
      </>
    );
  }
  const { layout } = await loadLayout(type.id, await layoutCatalog(type.key));
  return (
    <>
      <PageHeader eyebrow={locale === "fr-CA" ? type.name.fr : type.name.en} title={data.title} />
      <ObjectLayoutView layout={layout} data={data} />
    </>
  );
}
