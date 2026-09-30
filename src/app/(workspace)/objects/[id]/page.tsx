import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { RelatedPanel } from "@/features/objects/components/related-panel";
import { requireObjectsEnabled } from "@/features/objects/gate";
import { getObjectsT } from "@/features/objects/i18n/translate";
import { getObject, listObjectTypes } from "@/features/objects/services/registry.queries";
import { loadRelatedPanel } from "@/features/objects/services/related";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getObjectsT();
  const object = UUID.test(id) ? await getObject(id) : null;
  return { title: object?.title || t("related.title") };
}

/**
 * Any object, with its Related panel (Workspace OS M3b). Behind `wos_objects`;
 * integration links here from menus and records later.
 */
export default async function ObjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireObjectsEnabled();
  await requireSession();
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const [{ t, locale }, object] = await Promise.all([getObjectsT(), getObject(id)]);
  if (!object) notFound();

  const [types, related] = await Promise.all([
    listObjectTypes(object.organizationId),
    loadRelatedPanel(object.id, object.organizationId, locale, t("common.untitled")),
  ]);
  const typeLabel = (key: string) => {
    const type = types.find((candidate) => candidate.key === key);
    return type ? (locale === "fr-CA" ? type.name.fr : type.name.en) : key;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={typeLabel(object.type)}
        title={object.title.trim() || t("common.untitled")}
        actions={object.archivedAt ? <Badge tone="warning">{t("page.archived")}</Badge> : undefined}
      />
      <RelatedPanel data={related} typeLabel={typeLabel} typeName={typeLabel(object.type).toLowerCase()} t={t} />
    </div>
  );
}
