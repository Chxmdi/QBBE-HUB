"use client";

import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { setInterfaceLanguage } from "@/features/preferences/services/locale.commands";

type Choice = Locale | "auto";

/**
 * Each language is named in itself ("English", "Français"), with `lang` set,
 * so a person who cannot read the current language can still find theirs and
 * a screen reader pronounces it correctly.
 */
const OPTIONS: { value: Locale; label: string; lang: string }[] = [
  { value: "en", label: "English", lang: "en" },
  { value: "fr-CA", label: "Français", lang: "fr-CA" },
];

function useSaveLanguage() {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function save(choice: Choice) {
    setError(null);
    startTransition(async () => {
      const result = await setInterfaceLanguage(choice);
      if (!result.ok) {
        setError(result.error ?? t("language.saveError"));
        return;
      }
      // A full reload, not router.refresh(): the language changes the whole
      // document — <html lang>, the <title>, every string — and an in-place
      // refresh briefly left the page with an empty <title> (axe
      // document-title) while the new metadata streamed in.
      window.location.reload();
    });
  }
  return { save, pending, error };
}

/** Settings: English, French, or follow the browser. */
export function LanguageSettings({ current }: { current: Choice }) {
  const t = useT();
  const [value, setValue] = useState<Choice>(current);
  const { save, pending, error } = useSaveLanguage();

  const choices: { value: Choice; label: string; lang?: string }[] = [
    ...OPTIONS,
    { value: "auto", label: t("language.followBrowser") },
  ];

  return (
    <section aria-labelledby="language-heading" className="card mb-6 p-5">
      <h2 id="language-heading" className="section-heading">
        {t("language.settingsTitle")}
      </h2>
      <p className="mt-1 text-[13px] text-muted">{t("language.settingsDescription")}</p>
      <fieldset className="mt-3" disabled={pending}>
        <legend className="sr-only">{t("language.label")}</legend>
        <div className="flex flex-wrap gap-4">
          {choices.map((choice) => (
            <label
              key={choice.value}
              className="flex items-center gap-2 text-[13.5px]"
              lang={choice.lang}
            >
              <input
                type="radio"
                name="interface-language"
                value={choice.value}
                checked={value === choice.value}
                onChange={() => {
                  setValue(choice.value);
                  save(choice.value);
                }}
              />
              {choice.label}
            </label>
          ))}
        </div>
      </fieldset>
      {pending ? (
        <p className="meta mt-2" aria-live="polite">
          {t("common.saving")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Compact toggle for screens shown before sign-in. */
export function LanguageToggle({ current }: { current: Locale }) {
  const t = useT();
  const { save, pending, error } = useSaveLanguage();
  return (
    <div className="flex flex-col items-center gap-1">
      <nav aria-label={t("language.switcher")} className="flex items-center gap-1 text-[13px]">
        {OPTIONS.map((option, index) => (
          <span key={option.value} className="flex items-center gap-1">
            {index > 0 ? <span aria-hidden className="text-muted">·</span> : null}
            <button
              type="button"
              lang={option.lang}
              disabled={pending}
              aria-pressed={current === option.value}
              onClick={() => save(option.value)}
              className={cn(
                "rounded px-1.5 py-0.5 font-medium",
                current === option.value
                  ? "text-ink underline underline-offset-4"
                  : "text-brand-fg hover:underline",
              )}
            >
              {option.label}
            </button>
          </span>
        ))}
      </nav>
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
