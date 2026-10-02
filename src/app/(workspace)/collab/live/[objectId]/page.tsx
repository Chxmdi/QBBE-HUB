import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { contentAdapterFor, isEditorDocumentType } from "@/features/versions/adapters/registry";
import { objectContentPath } from "@/features/versions/paths";
import { objectTypeKeySchema } from "@/features/versions/schema";
import { collabText } from "@/features/collab/messages";
import { getObjectLock } from "@/features/collab/services/collab.queries";
import { LiveView } from "@/features/collab/components/live-view";
import { LockControl } from "@/features/collab/components/lock-control";
import { listOpenSuggestions } from "@/features/collab/services/suggestion.queries";
import { ObjectComments } from "@/features/object-comments/components/object-comments";
import { commentTargetFor } from "@/features/object-comments/target";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: collabText(await getLocale()).page.title };
}

/** Presence, cursors and page lock on one object (Workspace OS V1-17). */
export default async function LiveObjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ objectId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  if (!(await isEnabled("wos_editor"))) notFound();
  const session = await requireSession();
  const id = z.string().uuid().safeParse((await params).objectId);
  const type = objectTypeKeySchema.safeParse((await searchParams).type ?? "");
  if (!id.success || !type.success) notFound();

  const m = collabText(await getLocale());
  const object = { id: id.data, type: type.data };
  // Pages and meetings are co-edited in the block editor on their own screen.
  const editorPath = isEditorDocumentType(object.type) ? objectContentPath(object) : null;
  if (editorPath) redirect(editorPath);
  const adapter = contentAdapterFor(object.type);
  const snapshot = adapter ? await adapter.read(object) : null;
  if (!snapshot) {
    return (
      <>
        <PageHeader title={m.page.title} />
        <p className="meta">{m.page.notFound}</p>
      </>
    );
  }
  const db = await createSupabasePageClient();
  const target = commentTargetFor(object);
  const [{ data: canEdit }, { data: canManage }, { data: canSuggest }, { data: canComment }, lock, suggestions] =
    await Promise.all([
      db.rpc("can", { object_id: object.id, capability: "edit_content" }),
      db.rpc("can", { object_id: object.id, capability: "manage" }),
      db.rpc("can", { object_id: object.id, capability: "comment" }),
      db.rpc("can_post_comment", { p_type: target.parentType, p_id: target.parentId }),
      getObjectLock(object.id),
      listOpenSuggestions(object.id),
    ]);
  const block = snapshot.content.blocks[0];

  return (
    <>
      <PageHeader eyebrow={m.page.title} title={String(snapshot.properties.title ?? "")} description={m.page.description} />
      <LockControl objectId={object.id} lock={lock} canManage={canManage === true} />
      <LiveView
        object={object}
        me={session.userId}
        canEdit={canEdit === true}
        canSuggest={canSuggest === true}
        canComment={canComment === true}
        locked={lock !== null}
        blockId={block?.id ?? "description"}
        initialText={block?.text ?? ""}
        suggestions={suggestions}
      />
      <ObjectComments object={object} blockId={block?.id ?? "description"} />
    </>
  );
}
