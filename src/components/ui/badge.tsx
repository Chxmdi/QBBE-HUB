import * as React from "react";
import { cn } from "@/lib/utils";

type Tone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-soft text-muted",
  // Foreground tokens are already theme-aware; no per-theme override needed.
  brand: "bg-brand-soft text-brand-fg",
  success: "bg-success/12 text-success-fg",
  warning: "bg-warning/12 text-warning-fg",
  danger: "bg-danger/12 text-danger-fg",
  info: "bg-info/12 text-info-fg",
  accent: "bg-accent/15 text-[#8a6d1f] dark:text-accent",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
