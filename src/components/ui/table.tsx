"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Data table primitive (Part II §9): sticky header, row hover, selection,
 * sorting, and compact mode. Sorting is announced via aria-sort so screen
 * readers report the current order.
 */

export function DataTable({
  children,
  className,
  minWidth = "720px",
}: {
  children: React.ReactNode;
  className?: string;
  minWidth?: string;
}) {
  return (
    <div className={cn("card overflow-hidden", className)}>
      <div className="max-h-[70vh] overflow-auto">
        <table
          className="w-full text-left text-[13.5px]"
          style={{ minWidth }}
        >
          {children}
        </table>
      </div>
    </div>
  );
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-surface-soft">
      <tr className="border-b border-line">{children}</tr>
    </thead>
  );
}

export type SortDirection = "asc" | "desc" | null;

export function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  activeKey: string | null;
  direction: SortDirection;
  onSort: (key: string) => void;
  className?: string;
}) {
  const isActive = activeKey === sortKey && direction !== null;
  return (
    <th
      scope="col"
      aria-sort={
        isActive ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
      className={cn("px-4 py-2.5 font-semibold", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-brand-fg"
      >
        {label}
        {isActive ? (
          direction === "asc" ? (
            <ArrowUp className="size-3.5" aria-hidden />
          ) : (
            <ArrowDown className="size-3.5" aria-hidden />
          )
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  );
}

export function TableHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th scope="col" className={cn("px-4 py-2.5 font-semibold", className)}>
      {children}
    </th>
  );
}

export function TableRow({
  children,
  selected,
  className,
}: {
  children: React.ReactNode;
  selected?: boolean;
  className?: string;
}) {
  return (
    <tr
      aria-selected={selected}
      className={cn(
        "border-b border-line transition-colors last:border-b-0",
        selected ? "bg-brand-soft/50" : "hover:bg-surface-soft/60",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TableCell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-4 py-3", className)}>{children}</td>;
}

/** Accessible selection checkbox for table rows and the header toggle. */
export function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      className="size-4 accent-(--color-brand)"
    />
  );
}

/** Generic client-side sort helper shared by tables. */
export function useSort<T>(
  rows: T[],
  accessors: Record<string, (row: T) => string | number | null>,
  initialKey: string | null = null,
) {
  const [sortKey, setSortKey] = React.useState<string | null>(initialKey);
  const [direction, setDirection] = React.useState<SortDirection>(
    initialKey ? "asc" : null,
  );

  function onSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setDirection("asc");
      return;
    }
    // asc → desc → unsorted
    if (direction === "asc") setDirection("desc");
    else if (direction === "desc") {
      setDirection(null);
      setSortKey(null);
    } else setDirection("asc");
  }

  const sorted = React.useMemo(() => {
    if (!sortKey || !direction || !accessors[sortKey]) return rows;
    const accessor = accessors[sortKey];
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const result =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return direction === "asc" ? result : -result;
    });
    // accessors is a stable literal at each call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, direction]);

  return { sorted, sortKey, direction, onSort };
}
