import * as React from "react";

/**
 * Editorial page header — one clear title, one dominant purpose, and a
 * small set of primary actions per screen (Part II §1.1).
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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[14px] text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div>
      ) : null}
    </header>
  );
}
