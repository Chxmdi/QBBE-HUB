"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { deleteSavedView } from "@/features/admin/services/workflow.commands";
import { cn } from "@/lib/utils";

interface View {
  id: string;
  name: string;
  path: string;
  query: Record<string, string>;
}

function hrefFor(view: View): string {
  const query = new URLSearchParams(view.query).toString();
  return query ? `${view.path}?${query}` : view.path;
}

function sameQuery(view: View, current: URLSearchParams): boolean {
  const mine = Object.entries(view.query).filter(([key]) => key !== "task");
  const theirs = [...current.entries()].filter(([key]) => key !== "task");
  return (
    mine.length === theirs.length &&
    mine.every(([key, value]) => current.get(key) === value)
  );
}

/**
 * The person's saved views for this screen (P1-UX-08): each re-applies its
 * filters through the URL, and can be removed.
 */
export function SavedViews({ views }: { views: View[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  if (views.length === 0) return null;

  return (
    <nav aria-label="Saved views" className="mb-4">
      <ul className="flex flex-wrap items-center gap-2">
        {views.map((view) => {
          const current = sameQuery(view, searchParams);
          return (
            <li
              key={view.id}
              className={cn(
                "flex items-center rounded-full border text-[12.5px]",
                current ? "border-brand bg-brand-soft text-brand-fg" : "border-line bg-surface",
              )}
            >
              <Link
                href={hrefFor(view)}
                aria-current={current ? "page" : undefined}
                className="py-1 pr-1 pl-3 font-medium hover:underline"
              >
                {view.name}
              </Link>
              <button
                type="button"
                aria-label={`Delete saved view ${view.name}`}
                onClick={async () => {
                  setError(null);
                  const result = await deleteSavedView(view.id, view.path);
                  if (!result.ok) {
                    setError(result.error ?? "Could not delete the view.");
                    return;
                  }
                  router.refresh();
                }}
                className="mr-1 rounded-full p-1 text-muted hover:bg-surface-soft hover:text-ink"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="mt-1 text-[12.5px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </nav>
  );
}
