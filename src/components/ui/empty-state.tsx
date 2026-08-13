import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Purposeful empty state — every major data surface requires one (P0-UX-05).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-(--radius-md) border border-dashed border-line px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 text-muted/60 [&_svg]:size-8 [&_svg]:stroke-[1.5]">
          {icon}
        </div>
      ) : null}
      <p className="text-[15px] font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-[13.5px] text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
