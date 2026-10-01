import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecordPage } from "@/features/objects/components/record-page";
import { requireObjectsEnabled } from "@/features/objects/gate";
import { getObjectsT } from "@/features/objects/i18n/translate";
import { loadRecordPage } from "@/features/objects/services/record-page.queries";
import { getObject } from "@/features/objects/services/registry.queries";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getObjectsT();
  // Off means the route does not exist: not even its title may say otherwise.
  const object = UUID.test(id) && (await isEnabled("wos_objects")) ? await getObject(id) : null;
  return { title: object?.title || t("common.eyebrow") };
}

/**
 * Any object as a page (Workspace OS U14): its type's layout, with editable
 * properties, the Related panel, content, comments and version history.
 * Behind `wos_objects`; off means the route does not exist. An object the
 * viewer cannot read is not found, never described.
 */
export default async function ObjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireObjectsEnabled();
  const session = await requireSession();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { locale } = await getObjectsT();
  const data = await loadRecordPage(id, { locale, timeZone: session.timeZone });
  if (!data) notFound();

  return <RecordPage data={data} session={session} />;
}
