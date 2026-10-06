import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth";
import { versionsText } from "@/features/versions/messages";
import { listTrash } from "@/features/versions/services/version.queries";
import { TrashTable } from "@/features/versions/components/trash-controls";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: versionsText(await getLocale()).trash.title };
}

/** Deleted objects, restorable for 30 days (Workspace OS M16a). */
export default async function TrashPage() {
  if (!(await isEnabled("wos_editor"))) notFound();
  await requireSession();
  const m = versionsText(await getLocale());
  const entries = await listTrash({ pages: await isEnabled("wos_pages") });
  return (
    <>
      <PageHeader title={m.trash.title} description={m.trash.description} />
      <TrashTable entries={entries} />
    </>
  );
}
