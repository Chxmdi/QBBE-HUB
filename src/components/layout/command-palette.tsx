"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  FileText,
  FolderKanban,
  Hash,
  Layers,
  MessageSquare,
  Search,
  User,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { visibleNav } from "@/config/navigation";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/types/entities";

const typeIcons: Record<string, React.ReactNode> = {
  task: <FileText className="size-4" aria-hidden />,
  project: <FolderKanban className="size-4" aria-hidden />,
  program: <Layers className="size-4" aria-hidden />,
  channel: <Hash className="size-4" aria-hidden />,
  message: <MessageSquare className="size-4" aria-hidden />,
  person: <User className="size-4" aria-hidden />,
  meeting: <CalendarDays className="size-4" aria-hidden />,
  crm: <Building2 className="size-4" aria-hidden />,
  report: <BarChart3 className="size-4" aria-hidden />,
};

/**
 * ⌘K command palette (P0-CMD-01): keyboard-first search across authorized
 * records via the permission-safe app.global_search RPC, plus navigation.
 */
export function CommandPalette({
  open,
  onClose,
  isAdmin,
  isStaff,
}: {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  isStaff: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  const navItems = visibleNav({ isAdmin, isStaff }).flatMap((g) => g.items);
  const navMatches = query
    ? navItems.filter((i) =>
        i.label.toLowerCase().includes(query.toLowerCase()),
      )
    : navItems.slice(0, 6);

  const items: { label: string; sub?: string; href: string; icon: React.ReactNode }[] =
    [
      ...navMatches.map((n) => ({
        label: n.label,
        sub: "Go to",
        href: n.href,
        icon: <n.icon className="size-4" aria-hidden />,
      })),
      ...results.map((r) => ({
        label: r.title,
        sub: r.result_type,
        href: r.href,
        icon: typeIcons[r.result_type] ?? (
          <Search className="size-4" aria-hidden />
        ),
      })),
    ];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Debounced permission-safe search.
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.rpc("global_search", {
        p_query: query,
        p_limit: 12,
      });
      setResults((data as SearchResult[] | null) ?? []);
      setActiveIndex(0);
      setLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && items[activeIndex]) {
      e.preventDefault();
      go(items[activeIndex].href);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      aria-label="Command palette"
      className="m-auto mt-[12vh] w-[min(600px,calc(100vw-2rem))] rounded-(--radius-md) border border-line bg-surface p-0 text-ink shadow-(--shadow-pop) backdrop:bg-ink/40"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search className="size-4 text-muted" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search tasks, projects, channels, messages, people…"
          aria-label="Search"
          role="combobox"
          aria-controls="command-palette-results"
          aria-expanded={items.length > 0}
          className="h-12 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-muted/60"
        />
        {loading ? (
          <span className="meta" aria-live="polite">
            Searching…
          </span>
        ) : null}
      </div>
      <ul
        id="command-palette-results"
        role="listbox"
        className="max-h-[50vh] overflow-y-auto py-1.5"
      >
        {items.length === 0 ? (
          <li className="px-4 py-8 text-center text-[13.5px] text-muted">
            {query.length >= 2
              ? "No matching records you have access to."
              : "Type to search, or pick a destination."}
          </li>
        ) : (
          items.map((item, i) => (
            <li key={`${item.href}-${i}`} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onClick={() => go(item.href)}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2 text-left text-[13.5px]",
                  i === activeIndex && "bg-surface-soft",
                )}
              >
                <span className="text-muted">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.sub ? (
                  <span className="meta capitalize">{item.sub}</span>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </dialog>
  );
}
