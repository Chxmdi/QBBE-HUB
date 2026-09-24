import type * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-(--radius-sm) bg-surface-soft",
        className,
      )}
    />
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Route-shaped loading states (P0-UX-05, UI-006). Each one mirrors the
 * layout the page will render, so content does not jump when it arrives,
 * and announces itself once to assistive technology.
 */
function LoadingFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        {label}
      </p>
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-6 h-9 w-64" />
      {children}
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <LoadingFrame label="Loading the board">
      <Skeleton className="mb-4 h-10 w-full" />
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, column) => (
          <div key={column} className="space-y-2 rounded-(--radius-md) border border-line p-3">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 3 }).map((__, card) => (
              <Skeleton key={card} className="h-20" />
            ))}
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}

export function TableSkeleton({ label = "Loading", rows = 8 }: { label?: string; rows?: number }) {
  return (
    <LoadingFrame label={label}>
      <Skeleton className="mb-4 h-10 w-full" />
      <div className="divide-y divide-line rounded-(--radius-md) border border-line">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="hidden h-3.5 w-24 sm:block" />
            <Skeleton className="hidden h-3.5 w-20 md:block" />
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}

export function CalendarSkeleton() {
  return (
    <LoadingFrame label="Loading the calendar">
      <Skeleton className="mb-4 h-10 w-72" />
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-(--radius-md) border border-line">
        {Array.from({ length: 35 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-none" />
        ))}
      </div>
    </LoadingFrame>
  );
}

export function DetailSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <LoadingFrame label={label}>
      <div className="mb-6 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <ListSkeleton rows={4} />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-24" />
        </div>
      </div>
    </LoadingFrame>
  );
}

export function MessagesSkeleton() {
  return (
    <LoadingFrame label="Loading messages">
      <div className="space-y-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className={i % 2 ? "h-3 w-2/3" : "h-3 w-1/2"} />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="mt-6 h-12 w-full" />
    </LoadingFrame>
  );
}
