import { RecordComments, type CommentView } from "./record-comments";
import { getPickerOptions } from "@/features/tasks/services/task.queries";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

/**
 * Loads one record's comment thread and renders it (P0-COM-01).
 *
 * Every read goes through the signed-in person's client, so row-level security
 * decides what is shown: a thread on a record they cannot read is empty, and a
 * document they cannot read is not offered for attachment.
 */
export async function CommentThread({
  parentType,
  parentId,
}: {
  parentType: string;
  parentId: string;
}) {
  const session = await requireSession();
  const supabase = await createSupabasePageClient();
  const [{ data: rows }, options, { data: documentRows }] = await Promise.all([
    supabase
      .from("record_comment")
      .select(
        "id, body, author_id, parent_comment_id, created_at, edited_at, resolved_at, deleted_at, link_url, document_id",
      )
      .eq("parent_type", parentType)
      .eq("parent_id", parentId)
      .order("created_at", { ascending: true })
      .limit(200),
    getPickerOptions(),
    supabase
      .from("document")
      .select("id, title")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const names = new Map(
    options.people.map((person) => [person.id, person.label]),
  );
  const documents = (
    (documentRows ?? []) as { id: string; title: string }[]
  ).map((doc) => ({
    id: doc.id,
    label: doc.title,
  }));
  const documentTitles = new Map(documents.map((doc) => [doc.id, doc.label]));

  type Row = Omit<CommentView, "author_name" | "document"> & {
    document_id: string | null;
  };
  const comments: CommentView[] = ((rows ?? []) as Row[]).map((row) => ({
    ...row,
    author_name: names.get(row.author_id) ?? "Former member",
    document: row.document_id
      ? {
          id: row.document_id,
          title: documentTitles.get(row.document_id) ?? "A document",
        }
      : null,
  }));

  return (
    <RecordComments
      parentType={parentType}
      parentId={parentId}
      comments={comments}
      currentUserId={session.userId}
      isAdmin={session.isAdmin}
      people={options.people.map((person) => ({
        id: person.id,
        label: person.label,
      }))}
      documents={documents}
    />
  );
}
