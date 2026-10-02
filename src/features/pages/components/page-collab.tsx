import Link from "next/link";
import { isEnabled } from "@/lib/feature-flags";
import type { ObjectRef } from "@/lib/objects/contracts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPagesT } from "@/features/pages/i18n/server";
import { ObjectComments } from "@/features/object-comments/components/object-comments";
import { VersionHistory } from "@/features/versions/components/version-history";
import { listObjectVersions } from "@/features/versions/services/version.queries";
import { PageCollabTabs } from "./page-collab-tabs";
import { ActivityFeed } from "./page-collab-activity-feed";

/**
 * Comments and version history under a page's body (U9, plan A10 and V1-17).
 *
 * Comments reuse the object comments panel with the page's own parent type;
 * with a block id they show that block's thread. The version list reuses the
 * shared history, whose rows lead to the compare screen, where the whole
 * page, one block or the title can be restored. With the activity switch
 * (wave 2 C2: wos_objects beside wos_pages) an Activity tab lists who did
 * what and when.
 */
export async function PageCollab({
  pageId,
  canEdit,
  blockId,
  editorMounted,
}: {
  pageId: string;
  canEdit: boolean;
  /** Set when the address names one block: only that block's thread is shown. */
  blockId: string | null;
  /** Whether the block editor is on the page, so a block can be picked from the cursor. */
  editorMounted: boolean;
}) {
  const t = await getPagesT();
  const object: ObjectRef = { id: pageId, type: "page" };
  const [versions, threads, activityOn] = await Promise.all([
    listObjectVersions(object),
    blockThreads(pageId),
    isEnabled("wos_objects"),
  ]);

  return (
    <PageCollabTabs
      pageId={pageId}
      blockId={blockId}
      editorMounted={editorMounted}
      labels={{
        heading: t("collab.heading"),
        comments: t("collab.tabs.comments"),
        versions: t("collab.tabs.versions"),
        commentOnBlock: t("collab.commentOnBlock"),
        noBlockSelected: t("collab.noBlockSelected"),
        blockThread: t("collab.blockThread"),
        allComments: t("collab.allComments"),
        openVersions: t("collab.openVersions"),
        activity: t("units.c2.tab"),
      }}
      activity={
        activityOn ? (
          <ActivityFeed objectId={pageId} kind="page" />
        ) : null
      }
      comments={
        <>
          {!blockId && threads.length > 0 ? (
            <nav aria-label={t("collab.blockThreads")} className="mt-4">
              <h3 className="text-[13px] font-medium">{t("collab.blockThreads")}</h3>
              <ul className="mt-1 space-y-1">
                {threads.map((thread) => (
                  <li key={thread.blockId}>
                    <Link
                      href={`/pages/${pageId}?block=${encodeURIComponent(thread.blockId)}#page-collab`}
                      className="text-body-sm text-brand-fg hover:underline"
                    >
                      {t("collab.blockThreadLink", {
                        count: thread.count,
                        text: thread.text ?? t("collab.removedBlock"),
                      })}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <ObjectComments object={object} blockId={blockId} />
        </>
      }
      versions={
        <VersionHistory
          object={object}
          versions={versions}
          canEdit={canEdit}
          compareBase={`/collab/versions/${pageId}/compare?type=page`}
        />
      }
    />
  );
}

/**
 * The page's blocks that have open comments, in document order, with a short
 * preview of each block's text. Read as the signed-in person, so RLS decides.
 */
async function blockThreads(pageId: string): Promise<{ blockId: string; count: number; text: string | null }[]> {
  const db = await createSupabaseServerClient();
  const { data: rows } = await db
    .from("record_comment")
    .select("block_id")
    .eq("parent_type", "page")
    .eq("parent_id", pageId)
    .not("block_id", "is", null)
    .is("parent_comment_id", null)
    .is("resolved_at", null)
    .is("deleted_at", null)
    .limit(500);
  const counts = new Map<string, number>();
  for (const row of (rows ?? []) as { block_id: string }[]) counts.set(row.block_id, (counts.get(row.block_id) ?? 0) + 1);
  if (counts.size === 0) return [];
  const { data: blocks } = await db
    .from("block")
    .select("block_id, text, position")
    .eq("object_id", pageId)
    .in("block_id", [...counts.keys()]);
  const found = new Map(
    ((blocks ?? []) as { block_id: string; text: string; position: number }[]).map((block) => [block.block_id, block]),
  );
  const preview = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);
  return [...counts]
    .map(([blockId, count]) => {
      const block = found.get(blockId);
      return { blockId, count, text: block ? preview(block.text) || null : null, position: block?.position ?? Infinity };
    })
    .sort((a, b) => a.position - b.position)
    .map(({ blockId, count, text }) => ({ blockId, count, text }));
}
