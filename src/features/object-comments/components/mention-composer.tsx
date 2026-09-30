"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/client";
import { fill } from "@/features/collab/i18n";
import { activeMentionQuery, insertMention } from "../mentions";
import { objectCommentsText } from "../messages";
import { searchMentionTargets } from "../services/object-comment.commands";
import type { MentionCandidate } from "../services/object-comment.queries";

/**
 * A comment box where `@` opens a list of people and objects (M11).
 *
 * It follows the ARIA combobox pattern: the textarea keeps focus, the list is
 * announced as it changes, the arrow keys move through it, Enter or Tab
 * inserts the highlighted mention and Escape closes it without changing the
 * text. Typing continues to work normally when the list is closed.
 */
export function MentionComposer({
  id,
  label,
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const m = objectCommentsText(useLocale());
  const listId = useId();
  const hintId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [active, setActive] = useState<{ start: number; query: string } | null>(null);
  const [options, setOptions] = useState<MentionCandidate[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const open = active !== null && !dismissed;

  useEffect(() => {
    if (!active || dismissed) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchMentionTargets(active.query);
      if (!cancelled) {
        setOptions(found);
        setHighlight(0);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, dismissed]);

  function track(text: string, caret: number) {
    const next = activeMentionQuery(text, caret);
    setActive(next);
    if (!next) setDismissed(false);
  }

  function choose(option: MentionCandidate) {
    const textarea = ref.current;
    if (!textarea || !active) return;
    const result = insertMention(value, active.start, textarea.selectionStart, {
      kind: option.kind,
      id: option.id,
      label: option.label,
    });
    onChange(result.text);
    setActive(null);
    setOptions([]);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.caret, result.caret);
    });
  }

  function typeName(type: string | undefined): string {
    const types = m.objectTypes as Record<string, string>;
    return types[type ?? "object"] ?? m.objectTypes.object;
  }

  function optionLabel(option: MentionCandidate): string {
    return option.kind === "person"
      ? fill(m.mentionPerson, { name: option.label })
      : fill(m.mentionObject, { type: typeName(option.type), name: option.label });
  }

  const optionId = (index: number) => `${listId}-option-${index}`;

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        ref={ref}
        className="min-h-20 w-full rounded-(--radius-sm) border border-line bg-surface px-3 py-2 text-sm leading-normal text-ink placeholder:text-muted/70 focus:border-brand disabled:cursor-not-allowed disabled:opacity-60"
        id={id}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={5000}
        rows={3}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && options.length > 0 ? optionId(highlight) : undefined}
        aria-describedby={hintId}
        onChange={(event) => {
          onChange(event.target.value);
          track(event.target.value, event.target.selectionStart);
        }}
        onClick={(event) => track(value, event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setDismissed(true);
            return;
          }
          if (options.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((index) => (index + 1) % options.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((index) => (index - 1 + options.length) % options.length);
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            choose(options[highlight]);
          }
        }}
      />
      <p id={hintId} className="meta mt-1">
        {m.mentionHint}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label={m.mentionListLabel}
        hidden={!open}
        className="card absolute z-(--z-overlay) mt-1 max-h-64 w-full overflow-y-auto py-1 shadow-(--shadow-pop)"
      >
        {open && options.length === 0 ? (
          <li role="option" aria-selected={false} aria-disabled className="meta px-3 py-2">
            {m.mentionNone}
          </li>
        ) : null}
        {open
          ? options.map((option, index) => (
              <li
                key={`${option.kind}:${option.id}`}
                id={optionId(index)}
                role="option"
                aria-selected={index === highlight}
                className={
                  index === highlight
                    ? "cursor-pointer bg-surface-soft px-3 py-2 text-[13.5px]"
                    : "cursor-pointer px-3 py-2 text-[13.5px]"
                }
                onMouseDown={(event) => {
                  // Keep focus in the textarea so the caret position survives.
                  event.preventDefault();
                  choose(option);
                }}
              >
                {optionLabel(option)}
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}
