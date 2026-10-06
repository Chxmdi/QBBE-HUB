"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { runCommand, suggestCommands } from "../actions";
import type { Suggestion } from "../autocomplete";
import { commandsT } from "../i18n";

/**
 * The command box (M15): a combobox with a suggestion list, following the
 * ARIA 1.2 combobox pattern so it works by keyboard and screen reader. The
 * existing command palette mounts this at integration; until then it lives
 * on /home/commands behind the switch.
 */
export function CommandBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const locale = useLocale();
  const t = commandsT(locale);
  const router = useRouter();
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const statusId = useId();

  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [running, startRun] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const next = await suggestCommands(value);
      if (cancelled) return;
      setSuggestions(next);
      setActive(-1);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  const expanded = open && suggestions.length > 0;

  function choose(suggestion: Suggestion) {
    setValue(suggestion.value);
    setOpen(true);
    document.getElementById(inputId)?.focus();
  }

  function run() {
    setOpen(false);
    startRun(async () => {
      const outcome = await runCommand(value);
      setResult({ ok: outcome.ok, message: outcome.message });
      if (outcome.ok) {
        setValue("");
        if (outcome.href) router.push(outcome.href);
        else router.refresh();
      }
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (suggestions.length) setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (suggestions.length) setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (expanded && active >= 0) choose(suggestions[active]);
      else run();
    } else if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
  }

  return (
    <div className="max-w-2xl">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <div className="relative min-w-0 flex-1">
          <Label htmlFor={inputId}>{t("bar.label")}</Label>
          <Input
            id={inputId}
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
            aria-describedby={`${hintId} ${statusId}`}
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
            placeholder={t("bar.placeholder")}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setOpen(true);
              setResult(null);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
          <ul
            id={listId}
            role="listbox"
            aria-label={t("bar.suggestions")}
            hidden={!expanded}
            className="absolute inset-x-0 top-full z-(--z-raised) mt-1 max-h-72 overflow-auto rounded-(--radius-sm) border border-line bg-surface py-1 shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.kind}-${suggestion.value}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  // Keep focus in the box, so the list is chosen from, not closed.
                  event.preventDefault();
                  choose(suggestion);
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm text-ink",
                  index === active ? "bg-surface-soft" : "hover:bg-surface-soft",
                )}
              >
                <span className="truncate">{suggestion.label}</span>
                <span className="shrink-0 text-xs text-muted">{t(`slot.${suggestion.kind}`)}</span>
              </li>
            ))}
          </ul>
        </div>
        <Button type="submit" loading={running} disabled={running || !value.trim()}>
          {running ? t("bar.running") : t("bar.run")}
        </Button>
      </form>
      <FieldHint>
        <span id={hintId}>{t("bar.hint")}</span>
      </FieldHint>
      <p className="sr-only" aria-live="polite">
        {expanded ? t("bar.count", { count: suggestions.length }) : ""}
      </p>
      <p
        id={statusId}
        role="status"
        className={cn("mt-3 min-h-5 text-sm", result?.ok === false ? "text-danger-fg" : "text-ink")}
      >
        {result?.message ?? ""}
      </p>
    </div>
  );
}
