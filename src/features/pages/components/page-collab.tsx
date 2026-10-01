import type { ObjectRef } from "@/lib/objects/contracts";
import { getPagesT } from "@/features/pages/i18n/server";
import { ObjectComments } from "@/features/object-comments/components/object-comments";
import { VersionHistory } from "@/features/versions/components/version-history";
import { listObjectVersions } from "@/features/versions/services/version.queries";
import { PageCollabTabs } from "./page-collab-tabs";

/**
 * Comments and version history under a page's body (U9, plan A10 and V1-17).
 *
 * Comments reuse the object comments panel with the page's own parent type;
 * with a block id they show that block's thread. The version list reuses the
 * shared history, whose rows lead to the compare screen, where the whole
 * page, one block or the title can be restored.
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
  const versions = await listObjectVersions(object);

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
      }}
      comments={<ObjectComments object={object} blockId={blockId} />}
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
