import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { contentAdapterFor } from "@/features/versions/adapters/registry";
import { versionsText } from "@/features/versions/messages";
import { objectTypeKeySchema } from "@/features/versions/schema";
import { isInTrash, listObjectVersions } from "@/features/versions/services/version.queries";
import { ContentEditor } from "@/features/versions/components/content-editor";
import { VersionHistory } from "@/features/versions/components/version-history";
import { DeleteObjectButton } from "@/features/versions/components/trash-controls";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: versionsText(await getLocale()).page.title };
}

/**
 * Content, autosave and version history for one object (Workspace OS M16a),
 * behind the editor switch until integration puts it on each object's page.
 */
export default async function ObjectVersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ objectId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  if (!(await isEnabled("wos_editor"))) notFound();
  await requireSession();
  const id = z.string().uuid().safeParse((await params).objectId);
  const type = objectTypeKeySchema.safeParse((await searchParams).type ?? "");
  if (!id.success || !type.success) notFound();

  const m = versionsText(await getLocale());
  const object = { id: id.data, type: type.data };
  const adapter = contentAdapterFor(object.type);
  const snapshot = adapter ? await adapter.read(object) : null;
  if (!adapter || !snapshot) {
    return (
      <>
        <PageHeader title={m.page.title} />
        <p className="meta">{adapter ? m.errors.notFound : m.errors.unsupported}</p>
      </>
    );
  }

  const db = await createSupabaseServerClient();
  const [{ data: canEdit }, { data: canManage }, versions, trashed] = await Promise.all([
    db.rpc("can", { object_id: object.id, capability: "edit_content" }),
    db.rpc("can", { object_id: object.id, capability: "manage" }),
    listObjectVersions(object),
    isInTrash(object.id),
  ]);
  const title = String(snapshot.properties.title ?? "");
  const block = snapshot.content.blocks[0];

  return (
    <>
      <PageHeader
        eyebrow={(m.types as Record<string, string>)[object.type] ?? m.types.object}
        title={title}
        description={trashed ? m.errors.inTrash : m.page.description}
        actions={canManage === true && !trashed ? <DeleteObjectButton object={object} title={title} /> : undefined}
      />
      <ContentEditor
        object={object}
        blockId={block?.id ?? "description"}
        initialText={block?.text ?? ""}
        disabled={canEdit !== true || trashed}
      />
      <VersionHistory object={object} versions={versions} canEdit={canEdit === true && !trashed} />
    </>
  );
}
