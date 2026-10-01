"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, FileText, Lock, Plus } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { usePagesT } from "@/features/pages/i18n/client";
import { createPage } from "@/features/pages/services/page.commands";
import { buildTree, type PageNode, type PageRow } from "@/features/pages/tree";
import { NewPageFromTemplate } from "./new-page-from-template";
import { PageActions } from "./page-actions";

export interface PagesSidebarProps {
  pages: PageRow[];
  favouriteIds: string[];
  recentIds: string[];
  currentPageId?: string;
  canCreateWorkspace: boolean;
  canCreatePrivate: boolean;
  /** Pages the reader may edit; the rest get read-only menus. */
  editableIds: string[];
}

/**
 * The pages tree for one person: favourites, recent, then the workspace and
 * private areas. This is a component for the pages screens, not the main
 * navigation; integration decides where it is mounted.
 *
 * Built as nested lists of links with disclosure buttons (the WAI "navigation
 * with disclosure" pattern) rather than an ARIA tree, because each row also
 * holds an actions menu, and interactive children inside a treeitem are not
 * reachable by screen readers.
 */
export function PagesSidebar({
  pages,
  favouriteIds,
  recentIds,
  currentPageId,
  canCreateWorkspace,
  canCreatePrivate,
  editableIds,
}: PagesSidebarProps) {
  const t = usePagesT();
  const workspace = React.useMemo(() => buildTree(pages.filter((p) => p.visibility === "workspace")), [pages]);
  const privateTree = React.useMemo(() => buildTree(pages.filter((p) => p.visibility === "private")), [pages]);
  const tree = { workspace, private: privateTree };
  const byId = new Map(pages.map((p) => [p.id, p]));
  const favourites = new Set(favouriteIds);
  const editable = new Set(editableIds);

  // A branch is open if the person opened it, or, until they choose, if it
  // holds the current page.
  const [choices, setChoices] = React.useState<Map<string, boolean>>(() => new Map());
  const holdsCurrent = new Set<string>();
  let parent = currentPageId ? byId.get(currentPageId)?.parentPageId : null;
  while (parent && !holdsCurrent.has(parent)) {
    holdsCurrent.add(parent);
    parent = byId.get(parent)?.parentPageId ?? null;
  }
  const isOpen = (id: string) => choices.get(id) ?? holdsCurrent.has(id);
  const toggle = (id: string) =>
    setChoices((prev) => new Map(prev).set(id, !isOpen(id)));

  const row = { pages, tree, favourites, editable, currentPageId, isOpen, toggle };

  return (
    <nav aria-label={t("sidebar.label")} className="flex flex-col gap-5 text-body-sm">
      <Section title={t("sidebar.favourites")}>
        {favouriteIds.length === 0 ? (
          <p className="px-2 text-caption text-muted">{t("sidebar.noFavourites")}</p>
        ) : (
          <ul>
            {favouriteIds.map((id) => byId.get(id)).filter(Boolean).map((page) => (
              <li key={page!.id}>
                <FlatLink page={page!} current={page!.id === currentPageId} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t("sidebar.recent")}>
        {recentIds.length === 0 ? (
          <p className="px-2 text-caption text-muted">{t("sidebar.noRecent")}</p>
        ) : (
          <ul>
            {recentIds.map((id) => byId.get(id)).filter(Boolean).map((page) => (
              <li key={page!.id}>
                <FlatLink page={page!} current={page!.id === currentPageId} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={t("sidebar.workspace")}
        action={canCreateWorkspace ? <span className="flex items-center"><NewPageFromTemplate pages={pages} editableIds={editableIds} canCreateWorkspace /><NewPageButton visibility="workspace" label={t("sidebar.newPage")} /></span> : null}
      >
        <Tree nodes={workspace} {...row} />
      </Section>

      <Section
        title={t("sidebar.private")}
        action={canCreatePrivate ? <NewPageButton visibility="private" label={t("sidebar.newPrivatePage")} /> : null}
      >
        <Tree nodes={privateTree} {...row} />
      </Section>
    </nav>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id}>
      <div className="mb-1 flex items-center justify-between px-2">
        <h2 id={id} className="eyebrow">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function PageIcon({ page }: { page: PageRow }) {
  if (page.icon) {
    return (
      <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>
        {page.icon}
      </span>
    );
  }
  return page.visibility === "private" ? (
    <Lock className="size-4 shrink-0 text-muted" aria-hidden />
  ) : (
    <FileText className="size-4 shrink-0 text-muted" aria-hidden />
  );
}

function FlatLink({ page, current }: { page: PageRow; current: boolean }) {
  const t = usePagesT();
  return (
    <Link
      href={`/pages/${page.id}`}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-8 items-center gap-2 rounded-(--radius-sm) px-2 py-1 text-ink hover:bg-surface-soft",
        current && "bg-surface-soft font-medium",
      )}
    >
      <PageIcon page={page} />
      <span className="truncate">{page.title || t("page.untitled")}</span>
    </Link>
  );
}

interface RowContext {
  pages: PageRow[];
  tree: { workspace: PageNode[]; private: PageNode[] };
  favourites: Set<string>;
  editable: Set<string>;
  currentPageId?: string;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

function Tree({ nodes, ...context }: { nodes: PageNode[] } & RowContext) {
  const t = usePagesT();
  if (nodes.length === 0) {
    return <p className="px-2 text-caption text-muted">{t("sidebar.noPages")}</p>;
  }
  return (
    <ul>
      {nodes.map((node) => (
        <TreeRow key={node.id} node={node} {...context} />
      ))}
    </ul>
  );
}

function TreeRow({ node, ...context }: { node: PageNode } & RowContext) {
  const t = usePagesT();
  const { isOpen, toggle, currentPageId, favourites, editable, pages, tree } = context;
  const title = node.title || t("page.untitled");
  const open = isOpen(node.id);
  const hasChildren = node.children.length > 0;
  const groupId = `page-children-${node.id}`;
  const current = node.id === currentPageId;
  return (
    <li>
      <div
        className={cn(
          "group flex min-h-8 items-center gap-0.5 rounded-(--radius-sm) pr-1 hover:bg-surface-soft",
          current && "bg-surface-soft",
        )}
        style={{ paddingLeft: `${node.depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={groupId}
            aria-label={open ? t("sidebar.collapse", { title }) : t("sidebar.expand", { title })}
            onClick={() => toggle(node.id)}
            className="rounded-(--radius-sm) p-1 text-muted hover:text-ink"
          >
            {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
          </button>
        ) : (
          <span className="inline-block w-5.5" aria-hidden />
        )}
        <Link
          href={`/pages/${node.id}`}
          aria-current={current ? "page" : undefined}
          className={cn("flex min-w-0 flex-1 items-center gap-2 py-1 text-ink", current && "font-medium")}
        >
          <PageIcon page={node} />
          <span className="truncate">{title}</span>
        </Link>
        {editable.has(node.id) ? (
          <NewPageButton parentPageId={node.id} visibility={node.visibility} label={t("sidebar.newSubpage", { title })} compact />
        ) : null}
        <PageActions
          page={node}
          pages={pages}
          tree={tree}
          isFavourite={favourites.has(node.id)}
          canEdit={editable.has(node.id)}
        />
      </div>
      {hasChildren && open ? (
        <ul id={groupId}>
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} {...context} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function NewPageButton({
  visibility,
  parentPageId,
  label,
  compact = false,
}: {
  visibility: "workspace" | "private";
  parentPageId?: string;
  label: string;
  compact?: boolean;
}) {
  const t = usePagesT();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await createPage({ visibility, parentPageId: parentPageId ?? null });
          if (!result.ok || !result.id) {
            toast(result.error ?? t("errors.failed"), { tone: "error" });
            return;
          }
          router.push(`/pages/${result.id}`);
          router.refresh();
        })
      }
      className={cn(
        "rounded-(--radius-sm) p-1 text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-50",
        compact && "p-1.5",
      )}
    >
      <Plus className="size-4" aria-hidden />
    </button>
  );
}
