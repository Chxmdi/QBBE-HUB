"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  /** Destructive items render separated and in danger tone (Part II §9). */
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * Context action menu with keyboard support: arrows move, Enter/Space
 * activates, Escape closes and restores focus to the trigger.
 */
export function Menu({
  items,
  label = "More actions",
  trigger,
  align = "right",
}: {
  items: MenuItem[];
  label?: string;
  trigger?: React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const enabled = items.filter((i) => !i.disabled);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  React.useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, enabled.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(enabled.length - 1);
    }
  }

  const firstDestructive = enabled.findIndex((i) => i.destructive);

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setActiveIndex(0);
          setOpen((v) => !v);
        }}
        className="rounded-(--radius-sm) p-1.5 text-muted transition-colors hover:bg-surface-soft hover:text-ink"
      >
        {trigger ?? <MoreHorizontal className="size-4" aria-hidden />}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={handleKeyDown}
          className={cn(
            "absolute z-50 mt-1 min-w-48 rounded-(--radius-sm) border border-line bg-surface py-1 shadow-(--shadow-pop)",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {enabled.map((item, i) => (
            <React.Fragment key={item.label}>
              {i === firstDestructive && i > 0 ? (
                <div role="separator" className="my-1 border-t border-line" />
              ) : null}
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                role="menuitem"
                type="button"
                tabIndex={i === activeIndex ? 0 : -1}
                onClick={() => {
                  item.onSelect();
                  close(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13.5px]",
                  "hover:bg-surface-soft focus-visible:bg-surface-soft",
                  item.destructive ? "text-danger" : "text-ink",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
