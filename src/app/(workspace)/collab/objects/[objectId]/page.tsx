import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { objectCommentsText } from "@/features/object-comments/messages";
import { ObjectComments } from "@/features/object-comments/components/object-comments";
import { loadObjectTitle } from "@/features/object-comments/services/object-comment.queries";
import { objectTypeKeySchema } from "@/features/object-comments/schema";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: objectCommentsText(await getLocale()).page.title };
}

/**
 * The collaboration screen for one object (Workspace OS, stream S3b). Hidden
 * behind the editor switch until integration puts these panels on each
 * object's own page.
 */
export default async function ObjectCollaborationPage({
  params,
  searchParams,
}: {
  params: Promise<{ objectId: string }>;
  searchParams: Promise<{ type?: string; block?: string }>;
}) {
  if (!(await isEnabled("wos_editor"))) notFound();
  const { objectId } = await params;
  const query = await searchParams;
  const id = z.string().uuid().safeParse(objectId);
  const type = objectTypeKeySchema.safeParse(query.type ?? "object");
  const block = z.string().uuid().safeParse(query.block);
  if (!id.success || !type.success) notFound();

  const m = objectCommentsText(await getLocale());
  const object = { id: id.data, type: type.data };
  const title = await loadObjectTitle(object);
  if (title === null) {
    return (
      <>
        <PageHeader title={m.page.title} />
        <p className="meta">{m.page.notFound}</p>
      </>
    );
  }
  const typeLabel = (m.objectTypes as Record<string, string>)[type.data] ?? m.objectTypes.object;

  return (
    <>
      <PageHeader eyebrow={typeLabel} title={title} description={m.page.description} />
      <ObjectComments object={object} blockId={block.success ? block.data : null} />
    </>
  );
}
