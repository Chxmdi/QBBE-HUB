import * as React from "react";

/**
 * Editorial page header — one clear title, one dominant purpose, and a
 * small set of primary actions per screen. The gold rule ties the operational
 * pages back to the approved QBBE identity without reducing information
 * density or changing any route/data behavior.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-line/80 pb-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        <div className="qbbe-brand-rule mt-2 w-20" aria-hidden />
        {description ? (
          <p className="mt-2.5 max-w-2xl text-[14px] leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
