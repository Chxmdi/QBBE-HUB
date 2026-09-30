"use client";

import type { LensRow } from "@/lib/query/run";
import { useLensT } from "@/features/lenses/i18n/client";
import { TaskMeta, TaskTitleLink, refOf, textOf } from "./task-card-bits";

export interface ListSection {
  key: string;
  label: string;
  rows: LensRow[];
}

/**
 * The list lens (M8c): rows under section headings, each row a link plus
 * its key facts. A plain list of links, so it needs no keyboard pattern of its
 * own: Tab moves from task to task.
 */
export function ListLens({
  sections,
  timeZone,
  hideEmpty = true,
}: {
  sections: ListSection[];
  timeZone: string;
  hideEmpty?: boolean;
}) {
  const t = useLensT();
  const shown = hideEmpty ? sections.filter((s) => s.rows.length > 0) : sections;
  if (shown.length === 0) {
    return <p className="card px-4 py-6 text-center text-[13px] text-muted">{t("common.empty")}</p>;
  }
  return (
    <div className="space-y-7">
      {shown.map((section) => {
        const headingId = `lens-list-${section.key}`;
        return (
          <section key={section.key} aria-labelledby={headingId} data-lens-section={section.key}>
            <h2 id={headingId} className="section-heading mb-2 flex items-center gap-2">
              {section.label}
              <span className="meta font-normal">{section.rows.length}</span>
            </h2>
            {section.rows.length === 0 ? (
              <p className="card px-4 py-4 text-[13px] text-muted">{t("common.empty")}</p>
            ) : (
              <ul className="card divide-y divide-line">
                {section.rows.map((row) => {
                  const project = refOf(row, "project");
                  const reason = textOf(row, "blocked_reason");
                  return (
                    <li key={row.id} data-lens-row={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                      <div className="min-w-0 flex-1 basis-52">
                        <TaskTitleLink row={row} className="block truncate text-[14px] font-medium" />
                        <span className="meta flex flex-wrap gap-x-2">
                          <span className="truncate">{project?.label ?? t("list.noProject")}</span>
                          {reason ? <span className="text-danger-fg">{reason}</span> : null}
                        </span>
                      </div>
                      <div className="w-full sm:w-64">
                        <TaskMeta row={row} timeZone={timeZone} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
