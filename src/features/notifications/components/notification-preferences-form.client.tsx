"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldHint, Label, Select, Checkbox } from "@/components/ui/input";
import { saveNotificationPreferences } from "@/features/notifications/services/preferences.commands";
import type { DeliveryMode } from "@/features/notifications/services/delivery-rules";
import { useLocale, useT } from "@/lib/i18n/client";
import { intlLocale, type Locale } from "@/lib/i18n/config";
import type { MessageKey } from "@/lib/i18n/translate";
import { usePagesT } from "@/features/pages/i18n/client";
import type { PagesKey } from "@/features/pages/i18n";
import {
  HUB_CATEGORIES,
  hubMutedFromForm,
  PAGE_EMAIL_CATEGORIES,
  type HubCategory,
  type PageEmailCategory,
} from "@/features/notifications/categories";

/**
 * Email preferences.
 *
 * Two things the form has to be honest about, because getting them wrong
 * erodes trust in every other message the Hub sends:
 *
 *   - security notices and required announcements are not switchable, and the
 *     form says so instead of showing a switch that does nothing;
 *   - quiet hours delay mail, they do not delete it, and the copy says that
 *     too.
 */

export interface PreferenceValues {
  email_critical: boolean;
  email_digest: boolean;
  email_assignments: boolean;
  email_mentions: boolean;
  email_announcements: boolean;
  email_due_dates: boolean;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  digest_hour: number;
  digest_weekday: number;
  timezone: string;
  category_modes: Partial<Record<string, DeliveryMode>>;
  muted_project_ids: string[];
}

type CategoryKey = "assignment" | "mention" | "announcement" | "due_date" | PageEmailCategory;

interface CategoryEntry {
  key: CategoryKey;
  /** The older on/off switch, for people who never chose a mode. */
  legacy?: keyof PreferenceValues;
  /** The category whose mode applies until this one has its own. */
  inherits?: CategoryKey;
}

const CATEGORIES: CategoryEntry[] = [
  { key: "assignment", legacy: "email_assignments" },
  { key: "mention", legacy: "email_mentions" },
  { key: "announcement", legacy: "email_announcements" },
  { key: "due_date", legacy: "email_due_dates" },
];

/** Shown with the wos_pages switch (C3): approvals already followed assigned work. */
const PAGE_CATEGORIES: CategoryEntry[] = PAGE_EMAIL_CATEGORIES.map((key) =>
  key === "approval" ? { key, inherits: "assignment" } : { key },
);

const MODES: DeliveryMode[] = ["immediate", "daily", "weekly", "off"];

function modeFor(values: PreferenceValues, category: CategoryEntry): DeliveryMode {
  const stored = values.category_modes?.[category.key];
  if (stored) return stored;
  if (category.inherits) {
    const parent = CATEGORIES.find((entry) => entry.key === category.inherits);
    if (parent) return modeFor(values, parent);
  }
  const flag = category.legacy ? values[category.legacy] : undefined;
  if (flag === false) return "off";
  return values.email_digest ? "daily" : "immediate";
}

/**
 * Weekday names, Sunday = 0 (the stored `digest_weekday`), from Intl so each
 * language gets its own: "Sunday" in English, "dimanche" in French.
 */
function weekdays(locale: Locale): string[] {
  const format = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    timeZone: "UTC",
  });
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, day) =>
    format.format(new Date(Date.UTC(2023, 0, 1 + day))),
  );
}

/** "07:00" in English, "7 h" in Quebec French. */
function hours(locale: Locale) {
  return Array.from({ length: 24 }, (_, hour) => ({
    value: String(hour),
    label: locale === "fr-CA" ? `${hour}\u00a0h` : `${String(hour).padStart(2, "0")}:00`,
  }));
}

const TIMEZONES = [
  "America/Toronto",
  "America/Montreal",
  "America/Halifax",
  "America/Winnipeg",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "UTC",
];

function Switch({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-3">
      <Checkbox
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium">{label}</span>
        <span className="block text-[12.5px] text-muted">{hint}</span>
      </span>
    </label>
  );
}

export function NotificationPreferencesFormClient({
  values,
  timezoneOptions = TIMEZONES,
  projects = [],
  pageCategories = null,
}: {
  values: PreferenceValues;
  timezoneOptions?: string[];
  projects?: { id: string; name: string }[];
  /** Set while the wos_pages switch is on (C3): the categories kept out of the Hub. */
  pageCategories?: { hubMuted: HubCategory[] } | null;
}) {
  const t = useT();
  const pt = usePagesT();
  const categories = pageCategories ? [...CATEGORIES, ...PAGE_CATEGORIES] : CATEGORIES;
  const labelOf = (key: CategoryKey) =>
    (PAGE_EMAIL_CATEGORIES as readonly string[]).includes(key)
      ? pt(`units.c3.preferences.categories.${key}.label` as PagesKey)
      : t(`notifications.form.categories.${key}.label` as MessageKey);
  const hintOf = (key: CategoryKey) =>
    (PAGE_EMAIL_CATEGORIES as readonly string[]).includes(key)
      ? pt(`units.c3.preferences.categories.${key}.hint` as PagesKey)
      : t(`notifications.form.categories.${key}.hint` as MessageKey);
  const locale = useLocale();
  const HOURS = hours(locale);
  const WEEKDAYS = weekdays(locale);
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const [quietEnabled, setQuietEnabled] = React.useState(
    values.quiet_hours_start !== null && values.quiet_hours_end !== null,
  );

  const zones = timezoneOptions.includes(values.timezone)
    ? timezoneOptions
    : [values.timezone, ...timezoneOptions];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const quietOn = form.get("quiet_enabled") === "on";

    const result = await saveNotificationPreferences({
      emailCritical: form.get("email_critical") === "on",
      categoryModes: {
        assignment: String(form.get("mode_assignment")) as DeliveryMode,
        mention: String(form.get("mode_mention")) as DeliveryMode,
        announcement: String(form.get("mode_announcement")) as DeliveryMode,
        due_date: String(form.get("mode_due_date")) as DeliveryMode,
        ...(pageCategories
          ? Object.fromEntries(
              PAGE_EMAIL_CATEGORIES.map((key) => [key, String(form.get(`mode_${key}`)) as DeliveryMode]),
            )
          : {}),
      },
      ...(pageCategories ? { hubMutedCategories: hubMutedFromForm(form) } : {}),
      mutedProjectIds: form.getAll("muted_project").map(String),
      quietHoursStart: quietOn ? Number(form.get("quiet_hours_start")) : null,
      quietHoursEnd: quietOn ? Number(form.get("quiet_hours_end")) : null,
      digestHour: Number(form.get("digest_hour")),
      digestWeekday: Number(form.get("digest_weekday")),
      timezone: String(form.get("timezone")),
    });

    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error ?? t("notifications.form.saveFailed") });
      return;
    }
    setMessage({ tone: "ok", text: t("notifications.form.saved") });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section aria-labelledby="prefs-categories" className="card px-4 py-2">
        <h2 id="prefs-categories" className="sr-only">
          {t("notifications.form.whatToEmail")}
        </h2>
        <div className="divide-y divide-line">
          {categories.map((entry) => {
            const label = labelOf(entry.key);
            return (
            <div
              key={entry.key}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium">
                  {label}
                </span>
                <span className="block text-[12.5px] text-muted">
                  {hintOf(entry.key)}
                </span>
              </span>
              <Select
                name={`mode_${entry.key}`}
                aria-label={label}
                defaultValue={modeFor(values, entry)}
                className="w-44"
              >
                {MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`notifications.form.modes.${mode}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </div>
            );
          })}
          <Switch
            name="email_critical"
            label={t("notifications.form.urgent")}
            hint={t("notifications.form.urgentHint")}
            defaultChecked={values.email_critical}
          />
        </div>
      </section>

      {pageCategories ? (
        <section aria-labelledby="prefs-hub">
          <h2 id="prefs-hub" className="section-heading mb-3">
            {pt("units.c3.preferences.inHub")}
          </h2>
          <fieldset className="card px-4 py-3">
            <legend className="sr-only">{pt("units.c3.preferences.inHub")}</legend>
            <p className="pb-2 text-[12.5px] text-muted">{pt("units.c3.preferences.intro")}</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {HUB_CATEGORIES.map((key) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 py-1 text-[13.5px]">
                  <Checkbox name={`hub_${key}`} defaultChecked={!pageCategories.hubMuted.includes(key)} />
                  {pt(`units.c3.preferences.hub.${key}` as PagesKey)}
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      ) : null}

      <section aria-labelledby="prefs-quiet">
        <h2 id="prefs-quiet" className="section-heading mb-3">
          {t("notifications.form.quietHeading")}
        </h2>
        <div className="card px-4 py-3">
          <label className="flex cursor-pointer items-start gap-3 pb-1">
            <Checkbox
              name="quiet_enabled"
              defaultChecked={quietEnabled}
              onChange={(event) => setQuietEnabled(event.currentTarget.checked)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium">
                {t("notifications.form.quietToggle")}
              </span>
              <span className="block text-[12.5px] text-muted">
                {t("notifications.form.quietHint")}
              </span>
            </span>
          </label>

          {quietEnabled ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-sm">
              <div>
                <Label htmlFor="quiet_hours_start">{t("notifications.form.from")}</Label>
                <Select
                  id="quiet_hours_start"
                  name="quiet_hours_start"
                  defaultValue={String(values.quiet_hours_start ?? 22)}
                >
                  {HOURS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="quiet_hours_end">{t("notifications.form.until")}</Label>
                <Select
                  id="quiet_hours_end"
                  name="quiet_hours_end"
                  defaultValue={String(values.quiet_hours_end ?? 7)}
                >
                  {HOURS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="prefs-digest">
        <h2 id="prefs-digest" className="section-heading mb-3">
          {t("notifications.form.digestHeading")}
        </h2>
        <div className="card px-4 py-3">
          <p className="pb-3 text-[12.5px] text-muted">
            {t("notifications.form.digestIntro")}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="digest_hour">{t("notifications.form.sendAt")}</Label>
              <Select
                id="digest_hour"
                name="digest_hour"
                defaultValue={String(values.digest_hour)}
              >
                {HOURS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="digest_weekday">{t("notifications.form.weeklyOn")}</Label>
              <Select
                id="digest_weekday"
                name="digest_weekday"
                defaultValue={String(values.digest_weekday ?? 1)}
              >
                {WEEKDAYS.map((label, index) => (
                  <option key={label} value={String(index)}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="timezone">{t("notifications.form.timeZone")}</Label>
              <Select
                id="timezone"
                name="timezone"
                defaultValue={values.timezone}
              >
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <FieldHint>{t("notifications.form.zoneHint")}</FieldHint>
        </div>
      </section>

      <section aria-labelledby="prefs-mute">
        <h2 id="prefs-mute" className="section-heading mb-3">
          {t("notifications.form.muteHeading")}
        </h2>
        <div className="card px-4 py-3">
          <p className="pb-2 text-[12.5px] text-muted">
            {t("notifications.form.muteIntro")}
          </p>
          {projects.length === 0 ? (
            <p className="text-[13px] text-muted">{t("notifications.form.noProjects")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {projects.map((project) => (
                <li key={project.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2 text-[13.5px]">
                    <Checkbox
                      name="muted_project"
                      value={project.id}
                      defaultChecked={values.muted_project_ids.includes(
                        project.id,
                      )}
                    />
                    {project.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={saving} disabled={saving}>
          {t("notifications.form.save")}
        </Button>
        {message ? (
          <p
            role="status"
            className={
              message.tone === "ok"
                ? "text-[13px] text-success-fg"
                : "text-[13px] text-danger-fg"
            }
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}
