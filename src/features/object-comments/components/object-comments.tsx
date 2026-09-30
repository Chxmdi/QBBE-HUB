import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import type { ObjectRef } from "@/lib/objects/contracts";
import { objectCommentsText } from "../messages";
import { loadObjectComments } from "../services/object-comment.queries";
import { commentTargetFor } from "../target";
import { ObjectCommentsPanel } from "./object-comments-panel";

/**
 * Comments on any object, or on one block of it (M11). The integration point
 * for object pages and the block editor: render it with the object's ref, and
 * a block id for a block's own thread.
 */
export async function ObjectComments({
  object,
  blockId = null,
}: {
  object: ObjectRef;
  blockId?: string | null;
}) {
  const session = await requireSession();
  const m = objectCommentsText(await getLocale());
  const target = commentTargetFor(object, blockId);
  const db = await createSupabaseServerClient();
  const [data, { data: canPost }] = await Promise.all([
    loadObjectComments(target, session.userId, m.formerMember),
    db.rpc("can_post_comment", { p_type: target.parentType, p_id: target.parentId }),
  ]);
  return (
    <ObjectCommentsPanel
      object={object}
      blockId={blockId}
      data={data}
      currentUserId={session.userId}
      isAdmin={session.isAdmin}
      canPost={canPost === true}
    />
  );
}
