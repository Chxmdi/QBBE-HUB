"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldHint, Label, Select } from "@/components/ui/input";
import { saveNotificationPreferences } from "@/features/notifications/services/preferences.commands";

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
  timezone: string;
}

const CATEGORY_SWITCHES: {
  name: keyof PreferenceValues;
  label: string;
  hint: string;
}[] = [
  {
    name: "email_assignments",
    label: "Work assigned to me",
    hint: "A task or review lands in your queue.",
  },
  {
    name: "email_mentions",
    label: "Mentions and replies",
    hint: "Someone names you in a message or answers your thread.",
  },
  {
    name: "email_announcements",
    label: "Announcements",
    hint: "Workspace-wide posts. Ones that require acknowledgement always arrive.",
  },
  {
    name: "email_due_dates",
    label: "Due dates",
    hint: "A daily reminder about work due today, tomorrow, or overdue.",
  },
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
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
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
}: {
  values: PreferenceValues;
  timezoneOptions?: string[];
}) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);

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
      emailDigest: form.get("email_digest") === "on",
      emailAssignments: form.get("email_assignments") === "on",
      emailMentions: form.get("email_mentions") === "on",
      emailAnnouncements: form.get("email_announcements") === "on",
      emailDueDates: form.get("email_due_dates") === "on",
      quietHoursStart: quietOn ? Number(form.get("quiet_hours_start")) : null,
      quietHoursEnd: quietOn ? Number(form.get("quiet_hours_end")) : null,
      digestHour: Number(form.get("digest_hour")),
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
          {CATEGORY_SWITCHES.map((entry) => (
            <Switch
              key={entry.name}
              name={entry.name}
              label={entry.label}
              hint={entry.hint}
              defaultChecked={Boolean(values[entry.name])}
            />
          ))}
          <Switch
            name="email_critical"
            label="Reach me straight away for urgent work"
            hint="Urgent items are sent immediately, even during quiet hours."
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
            <input
              type="checkbox"
              name="quiet_enabled"
              defaultChecked={quietEnabled}
              onChange={(event) => setQuietEnabled(event.currentTarget.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
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
          Daily digest
        </h2>
        <div className="card px-4 py-3">
          <Switch
            name="email_digest"
            label="Send one summary a day instead of separate emails for routine items"
            hint="Nothing is sent on a day with nothing to report."
            defaultChecked={values.email_digest}
          />
          <div className="mt-2 grid grid-cols-1 gap-3 sm:max-w-sm sm:grid-cols-2">
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
              <Label htmlFor="timezone">Time zone</Label>
              <Select id="timezone" name="timezone" defaultValue={values.timezone}>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <FieldHint>
            Quiet hours and the digest both use this zone.
          </FieldHint>
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
