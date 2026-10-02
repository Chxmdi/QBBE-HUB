"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { cursorBlockId } from "@/features/pages/cursor-block";

type Tab = "comments" | "versions" | "activity";

export interface PageCollabLabels {
  heading: string;
  comments: string;
  versions: string;
  commentOnBlock: string;
  noBlockSelected: string;
  blockThread: string;
  allComments: string;
  openVersions: string;
  activity: string;
}

/**
 * The tabs under a page: Comments and Versions (U9), and Activity when the
 * activity history is switched on (wave 2 C2). The panels are rendered
 * on the server and handed in; this only switches between them and offers
 * "Comment on this block", which takes the block from where the cursor last
 * was in the editor and opens that block's thread.
 */
export function PageCollabTabs({
  pageId,
  blockId,
  editorMounted,
  labels,
  comments,
  versions,
  activity,
}: {
  pageId: string;
  blockId: string | null;
  editorMounted: boolean;
  labels: PageCollabLabels;
  comments: React.ReactNode;
  versions: React.ReactNode;
  /** The Activity panel, or null while its switch is off. */
  activity: React.ReactNode;
}) {
  const router = useRouter();
  const headingId = React.useId();
  const hintId = React.useId();
  const [active, setActive] = React.useState<Tab>("comments");
  const [cursorBlock, setCursorBlock] = React.useState<string | null>(null);

  // Remember the last block the cursor was in, so clicking the button (which
  // moves focus out of the editor) still knows which block was meant.
  React.useEffect(() => {
    if (!editorMounted) return;
    const remember = () => {
      const id = cursorBlockId();
      if (id) setCursorBlock(id);
    };
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, [editorMounted]);

  const tabs = [
    { id: "comments", label: labels.comments },
    { id: "versions", label: labels.versions },
    ...(activity ? [{ id: "activity", label: labels.activity }] : []),
  ];

  return (
    <section aria-labelledby={headingId} className="mt-10" id="page-collab">
      <h2 id={headingId} className="eyebrow mb-2">
        {labels.heading}
      </h2>
      <Tabs tabs={tabs} active={active} onChange={(id) => setActive(id as Tab)} />
      <div
        role="tabpanel"
        id="tabpanel-comments"
        aria-labelledby="tab-comments"
        hidden={active !== "comments"}
        tabIndex={0}
      >
        {editorMounted ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-describedby={hintId}
              disabled={!cursorBlock}
              onClick={() => {
                const id = cursorBlockId() ?? cursorBlock;
                if (id) router.push(`/pages/${pageId}?block=${encodeURIComponent(id)}#page-collab`);
              }}
            >
              {labels.commentOnBlock}
            </Button>
            <p id={hintId} className="text-caption text-muted">
              {cursorBlock ? null : labels.noBlockSelected}
            </p>
          </div>
        ) : null}
        {blockId ? (
          <p role="status" className="mt-4 text-body-sm text-muted">
            {labels.blockThread}{" "}
            <Link href={`/pages/${pageId}#page-collab`} className="font-medium text-brand-fg hover:underline">
              {labels.allComments}
            </Link>
          </p>
        ) : null}
        {comments}
      </div>
      <div
        role="tabpanel"
        id="tabpanel-versions"
        aria-labelledby="tab-versions"
        hidden={active !== "versions"}
        tabIndex={0}
      >
        {versions}
        <p className="mt-3">
          <Link href={`/collab/versions/${pageId}?type=page`} className="text-[13px] font-medium text-brand-fg hover:underline">
            {labels.openVersions}
          </Link>
        </p>
      </div>
      {activity ? (
        <div
          role="tabpanel"
          id="tabpanel-activity"
          aria-labelledby="tab-activity"
          hidden={active !== "activity"}
          tabIndex={0}
        >
          {activity}
        </div>
      ) : null}
    </section>
  );
}
