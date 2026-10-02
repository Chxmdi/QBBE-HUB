"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { loadActivity } from "@/features/pages/activity/activity.actions";
import type { ActivityCursor, ActivityItem, ActivityPage } from "@/features/pages/activity/activity.queries";

export interface ActivityLabels {
  listLabel: string;
  empty: string;
  error: string;
  retry: string;
  showOlder: string;
  loadingOlder: string;
  olderError: string;
  end: string;
  loading: string;
}

/**
 * Wave 2 C2: an object's activity, newest first (the page's Activity tab and
 * the record page's Activity section). Every page of entries, the first
 * included, is read in the browser through the loadActivity action once the
 * screen is up: the record page refreshes itself after each property save,
 * and reading activity on the server would make every one of those refreshes
 * wait for it. Each entry says who did what, and when, in the reader's
 * language and time zone.
 */
export function ActivityPanel({ objectId, labels }: { objectId: string; labels: ActivityLabels }) {
  const [items, setItems] = React.useState<ActivityItem[] | null>(null);
  const [next, setNext] = React.useState<ActivityCursor | null>(null);
  const [failed, setFailed] = React.useState<"first" | "older" | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [loadedOlder, setLoadedOlder] = React.useState(false);

  const load = React.useCallback(
    (before: ActivityCursor | null) =>
      startTransition(async () => {
        const page: ActivityPage = await loadActivity({ objectId, before }).catch(() => ({ ok: false }) as const);
        if (!page.ok) {
          setFailed(before ? "older" : "first");
          return;
        }
        setFailed(null);
        setItems((current) => (before && current ? [...current, ...page.items] : page.items));
        setNext(page.next);
        if (before) setLoadedOlder(true);
      }),
    [objectId],
  );

  React.useEffect(() => {
    load(null);
  }, [load]);

  if (failed === "first") {
    return (
      <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-body-sm text-danger-fg">
        <span>{labels.error}</span>
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => load(null)}>
          {pending ? labels.loading : labels.retry}
        </Button>
      </div>
    );
  }

  if (items === null) return <ActivityLoading label={labels.loading} />;

  if (items.length === 0) {
    return <p className="mt-4 text-body-sm text-muted">{labels.empty}</p>;
  }

  return (
    <div className="mt-4">
      <ol aria-label={labels.listLabel} className="space-y-0 divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <span className="min-w-0 break-words text-body-sm text-ink">{item.text}</span>
            <time dateTime={item.at} className="shrink-0 text-caption text-muted">
              {item.when}
            </time>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3" aria-live="polite">
        {next ? (
          <Button type="button" variant="secondary" size="sm" aria-busy={pending} disabled={pending} onClick={() => load(next)}>
            {pending ? labels.loadingOlder : labels.showOlder}
          </Button>
        ) : loadedOlder ? (
          <p className="text-caption text-muted">{labels.end}</p>
        ) : null}
        {failed === "older" ? (
          <p role="alert" className="text-caption text-danger-fg">
            {labels.olderError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Shown while the first page of activity is read. */
export function ActivityLoading({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="mt-4 flex flex-col gap-2">
      <p role="status" className="sr-only">
        {label}
      </p>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}
