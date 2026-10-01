"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/input";

/**
 * A searchable list of options, following the ARIA combobox pattern (U10):
 * the text field keeps focus, the list is announced as it changes, the arrow
 * keys move through it, Enter chooses the highlighted option and Escape closes
 * the list without changing the choice. Options can be grouped. When
 * `onQuery` is given the caller searches (a server call); otherwise the list
 * is filtered here by label.
 */

export interface ComboboxOption {
  id: string;
  label: string;
  description?: string;
  group?: string;
}

export interface ComboboxGroup {
  label: string;
  options: ComboboxOption[];
}

export interface ComboboxMessages {
  typeToSearch: string;
  searching: string;
  noResults: string;
  chosen: string;
  clear: string;
}

interface Props {
  id: string;
  label: string;
  /** The label of the current choice, shown while the list is closed. */
  selectedLabel: string;
  groups: ComboboxGroup[];
  onSelect: (option: ComboboxOption) => void;
  onClear?: () => void;
  /** Called as the person types, debounced; the caller then updates `groups`. */
  onQuery?: (query: string) => void;
  loading?: boolean;
  hint?: string;
  m: ComboboxMessages;
  /** Fills `{label}` placeholders in the "chosen" message. */
  fill: (template: string, vars: Record<string, string | number>) => string;
  className?: string;
}

function matches(option: ComboboxOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return option.label.toLowerCase().includes(needle) ||
    (option.description ?? "").toLowerCase().includes(needle) ||
    option.id.toLowerCase().includes(needle);
}

export function Combobox({
  id,
  label,
  selectedLabel,
  groups,
  onSelect,
  onClear,
  onQuery,
  loading,
  hint,
  m,
  fill,
  className,
}: Props) {
  const listId = `${id}-listbox`;
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const shown: ComboboxGroup[] = React.useMemo(() => {
    if (onQuery) return groups;
    return groups
      .map((group) => ({ ...group, options: group.options.filter((option) => matches(option, query)) }))
      .filter((group) => group.options.length > 0);
  }, [groups, onQuery, query]);
  const flat = React.useMemo(() => shown.flatMap((group) => group.options), [shown]);

  React.useEffect(() => {
    if (!onQuery || !open) return;
    const timer = setTimeout(() => onQuery(query), 150);
    return () => clearTimeout(timer);
  }, [onQuery, open, query]);

  React.useEffect(() => {
    if (highlight >= flat.length) setHighlight(0);
  }, [flat.length, highlight]);

  const choose = (option: ComboboxOption) => {
    onSelect(option);
    setOpen(false);
    setQuery("");
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setHighlight((current) => (flat.length ? (current + 1) % flat.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setHighlight((current) => (flat.length ? (current - 1 + flat.length) % flat.length : 0));
    } else if (event.key === "Enter") {
      if (open && flat[highlight]) {
        event.preventDefault();
        choose(flat[highlight]);
      } else if (open) {
        event.preventDefault();
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setQuery("");
      }
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const activeId = open && flat[highlight] ? `${id}-option-${highlight}` : undefined;
  let position = -1;

  return (
    <div className={cn("relative", className)}>
      <Label htmlFor={id}>{label}</Label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-describedby={[hint ? hintId : null, statusId].filter(Boolean).join(" ")}
        placeholder={m.typeToSearch}
        value={open ? query : selectedLabel}
        className="h-9.5 w-full rounded-(--radius-sm) border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-brand"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          // A click on an option fires mousedown (handled) before blur.
          setOpen(false);
          setQuery("");
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
      />
      {hint ? <p id={hintId} className="mt-1 text-[12.5px] text-muted">{hint}</p> : null}
      <p id={statusId} className="sr-only" aria-live="polite">
        {selectedLabel ? fill(m.chosen, { label: selectedLabel }) : ""}
      </p>
      {selectedLabel && onClear ? (
        <button
          type="button"
          className="mt-1 text-[12.5px] text-brand-fg underline-offset-2 hover:underline"
          onClick={() => {
            onClear();
            setQuery("");
          }}
        >
          {m.clear}
        </button>
      ) : null}
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto rounded-(--radius-sm) border border-line bg-surface p-1 shadow-lg"
      >
        {loading ? <li role="presentation" className="px-2 py-1.5 text-[13px] text-muted">{m.searching}</li> : null}
        {!loading && flat.length === 0 ? <li role="presentation" className="px-2 py-1.5 text-[13px] text-muted">{m.noResults}</li> : null}
        {shown.map((group) => (
          <li key={group.label} role="presentation">
            {shown.length > 1 || group.label ? (
              <div role="presentation" className="px-2 pb-0.5 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                {group.label}
              </div>
            ) : null}
            <ul role="group" aria-label={group.label || label}>
              {group.options.map((option) => {
                position += 1;
                const index = position;
                return (
                  <li
                    key={option.id}
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={index === highlight}
                    className={cn(
                      "cursor-pointer rounded-(--radius-xs) px-2 py-1.5 text-sm text-ink",
                      index === highlight ? "bg-surface-soft" : "",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(option);
                    }}
                    onMouseEnter={() => setHighlight(index)}
                  >
                    <span className="block">{option.label}</span>
                    {option.description ? <span className="block text-[12.5px] text-muted">{option.description}</span> : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
