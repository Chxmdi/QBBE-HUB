"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldHint, Label, Select, Checkbox } from "@/components/ui/input";
import { saveNotificationPreferences } from "@/features/notifications/services/preferences.commands";
import type { DeliveryMode } from "@/features/notifications/services/delivery-rules";

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

const CATEGORIES: {
  key: "assignment" | "mention" | "announcement" | "due_date";
  label: string;
  hint: string;
  legacy: keyof PreferenceValues;
}[] = [
  {
    key: "assignment",
    label: "Work assigned to me",
    hint: "Tasks, reviews, and decisions. Approvals follow this choice.",
    legacy: "email_assignments",
  },
  {
    key: "mention",
    label: "Mentions and replies",
    hint: "Someone names you, or answers a thread you started.",
    legacy: "email_mentions",
  },
  {
    key: "announcement",
    label: "Announcements",
    hint: "Workspace-wide posts. Ones that require acknowledgement always arrive.",
    legacy: "email_announcements",
  },
  {
    key: "due_date",
    label: "Due dates",
    hint: "Work due today, tomorrow, or overdue.",
    legacy: "email_due_dates",
  },
];

const MODES: { value: DeliveryMode; label: string }[] = [
  { value: "immediate", label: "Immediately" },
  { value: "daily", label: "Daily digest" },
  { value: "weekly", label: "Weekly digest" },
  { value: "off", label: "Don't email" },
];

function modeFor(
  values: PreferenceValues,
  category: (typeof CATEGORIES)[number],
): DeliveryMode {
  const stored = values.category_modes?.[category.key];
  if (stored) return stored;
  const flag = values[category.legacy];
  if (flag === false) return "off";
  return values.email_digest ? "daily" : "immediate";
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

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

export function NotificationPreferencesForm({
  values,
  timezoneOptions = TIMEZONES,
  projects = [],
}: {
  values: PreferenceValues;
  timezoneOptions?: string[];
  projects?: { id: string; name: string }[];
}) {
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
      },
      mutedProjectIds: form.getAll("muted_project").map(String),
      quietHoursStart: quietOn ? Number(form.get("quiet_hours_start")) : null,
      quietHoursEnd: quietOn ? Number(form.get("quiet_hours_end")) : null,
      digestHour: Number(form.get("digest_hour")),
      digestWeekday: Number(form.get("digest_weekday")),
      timezone: String(form.get("timezone")),
    });

    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error ?? "Could not save." });
      return;
    }
    setMessage({ tone: "ok", text: "Preferences saved." });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <section aria-labelledby="prefs-categories" className="card px-4 py-2">
        <h2 id="prefs-categories" className="sr-only">
          What to email me about
        </h2>
        <div className="divide-y divide-line">
          {CATEGORIES.map((entry) => (
            <div
              key={entry.key}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium">
                  {entry.label}
                </span>
                <span className="block text-[12.5px] text-muted">
                  {entry.hint}
                </span>
              </span>
              <Select
                name={`mode_${entry.key}`}
                aria-label={entry.label}
                defaultValue={modeFor(values, entry)}
                className="w-44"
              >
                {MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          <Switch
            name="email_critical"
            label="Reach me straight away for urgent work"
            hint="Urgent items set to arrive immediately still come during quiet hours. A daily or weekly category waits for the digest. Security notices always arrive."
            defaultChecked={values.email_critical}
          />
        </div>
      </section>

      <section aria-labelledby="prefs-quiet">
        <h2 id="prefs-quiet" className="section-heading mb-3">
          Quiet hours
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
                Hold routine email overnight
              </span>
              <span className="block text-[12.5px] text-muted">
                Mail is delayed until the window ends, never dropped. Security
                notices and announcements needing acknowledgement still arrive.
              </span>
            </span>
          </label>

          {quietEnabled ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-sm">
              <div>
                <Label htmlFor="quiet_hours_start">From</Label>
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
                <Label htmlFor="quiet_hours_end">Until</Label>
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
          When digests go out
        </h2>
        <div className="card px-4 py-3">
          <p className="pb-3 text-[12.5px] text-muted">
            Daily categories send every day at this hour. Weekly categories send
            on the chosen day. Nothing is sent when there is nothing to report.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="digest_hour">Send at</Label>
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
              <Label htmlFor="digest_weekday">Weekly on</Label>
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
              <Label htmlFor="timezone">Time zone</Label>
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
          <FieldHint>Quiet hours and the digest both use this zone.</FieldHint>
        </div>
      </section>

      <section aria-labelledby="prefs-mute">
        <h2 id="prefs-mute" className="section-heading mb-3">
          Muted projects
        </h2>
        <div className="card px-4 py-3">
          <p className="pb-2 text-[12.5px] text-muted">
            Non-critical mail and inbox items from a muted project stay quiet.
            Security notices and required announcements still arrive.
          </p>
          {projects.length === 0 ? (
            <p className="text-[13px] text-muted">No projects to mute.</p>
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
          Save preferences
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
