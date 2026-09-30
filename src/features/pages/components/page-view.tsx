import Link from "next/link";
import { Lock } from "lucide-react";
import type { SessionContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PagesSidebarData } from "@/features/pages/services/page.queries";
import { getPagesT } from "@/features/pages/i18n/server";
import { canEditPage } from "@/features/pages/access";
import { coverClass } from "@/features/pages/covers";
import { ancestors, buildTree, type PageRow } from "@/features/pages/tree";
import { PageActions } from "./page-actions";
import { PageTitle } from "./page-title";
import { RestorePageButton } from "./restore-page-button";

/** One page: cover, breadcrumbs, icon, title, and the pages inside it. */
export async function PageView({
  session,
  page,
  sidebar,
  children,
}: {
  session: SessionContext;
  page: PageRow;
  sidebar: PagesSidebarData;
  /** The page body; the editor mounts here (M4b). */
  children?: React.ReactNode;
}) {
  const t = await getPagesT();
  const viewer = { userId: session.userId, role: session.role };
  const canEdit = canEditPage(viewer, page);
  const rows = sidebar.pages.some((p) => p.id === page.id) ? sidebar.pages : [...sidebar.pages, page];
  const trail = ancestors(rows, page.id);
  const tree = {
    workspace: buildTree(sidebar.pages.filter((p) => p.visibility === "workspace")),
    private: buildTree(sidebar.pages.filter((p) => p.visibility === "private")),
  };
  const subpages = sidebar.pages
    .filter((p) => p.parentPageId === page.id)
    .sort((a, b) => a.position - b.position);
  const cover = coverClass(page.cover);

  return (
    <article className="max-w-3xl">
      {cover ? <div className={cn("mb-5 h-28 rounded-(--radius-md)", cover)} aria-hidden /> : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t("page.breadcrumb")} className="min-w-0 text-caption text-muted">
          <ol className="flex flex-wrap items-center gap-1">
            {trail.map((p) => (
              <li key={p.id} className="flex items-center gap-1">
                <Link href={`/pages/${p.id}`} className="hover:text-ink hover:underline">
                  {p.icon ? `${p.icon} ` : ""}
                  {p.title || t("page.untitled")}
                </Link>
                <span aria-hidden>/</span>
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex items-center gap-2">
          {page.visibility === "private" ? (
            <Badge>
              <Lock className="size-3" aria-hidden /> {t("page.private")}
            </Badge>
          ) : null}
          {page.deletedAt ? null : (
            <PageActions
              page={page}
              pages={sidebar.pages}
              tree={tree}
              isFavourite={sidebar.favouriteIds.includes(page.id)}
              canEdit={canEdit}
              label={t("sidebar.actions", { title: page.title || t("page.untitled") })}
            />
          )}
        </div>
      </div>

      {page.deletedAt ? (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-(--radius-sm) border border-warning bg-warning/10 px-3 py-2 text-body-sm text-warning-fg">
          <span>{t("page.trashed")}</span>
          {canEditPage(viewer, { ...page, deletedAt: null }) ? <RestorePageButton pageId={page.id} /> : null}
        </div>
      ) : null}

      <div className="flex items-start gap-3">
        {page.icon ? (
          <span className="text-[2rem] leading-none" aria-hidden>
            {page.icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <PageTitle key={`${page.id}:${page.title}`} pageId={page.id} title={page.title} canEdit={canEdit} />
        </div>
      </div>
      <div className="qbbe-brand-rule mt-2 w-20" aria-hidden />

      {!canEdit && !page.deletedAt ? <p className="mt-3 text-caption text-muted">{t("page.readOnly")}</p> : null}

      <div className="mt-6">
        {children ?? <p className="text-body-sm text-muted">{t("page.bodyComingSoon")}</p>}
      </div>

      {subpages.length > 0 ? (
        <section className="mt-8" aria-labelledby="subpages-heading">
          <h2 id="subpages-heading" className="eyebrow mb-2">
            {t("page.subpages")}
          </h2>
          <ul className="card divide-y divide-line">
            {subpages.map((child) => (
              <li key={child.id}>
                <Link href={`/pages/${child.id}`} className="flex items-center gap-2 px-4 py-2.5 text-ink hover:bg-surface-soft">
                  <span aria-hidden>{child.icon ?? "📄"}</span>
                  {child.title || t("page.untitled")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
