"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldHint, Input, Label } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import {
  THRESHOLD_LIMITS,
  type TeamSignalSettingsInput,
} from "@/features/people/team-signals";
import { saveTeamSignalSettings } from "@/features/people/services/team-signals.commands";

type NumberField = keyof typeof THRESHOLD_LIMITS;
type SwitchField = Exclude<keyof TeamSignalSettingsInput, NumberField>;

const NUMBER_FIELDS: { key: NumberField; label: MessageKey; hint: MessageKey }[] = [
  { key: "overdueCount", label: "teamSignals.overdueCount", hint: "teamSignals.overdueCountHint" },
  { key: "overdueAgeDays", label: "teamSignals.overdueAgeDays", hint: "teamSignals.overdueAgeDaysHint" },
  { key: "blockedNoUpdateDays", label: "teamSignals.blockedDays", hint: "teamSignals.blockedDaysHint" },
  { key: "inProgressNoUpdateDays", label: "teamSignals.inProgressDays", hint: "teamSignals.inProgressDaysHint" },
];

const RULE_SWITCHES: { key: SwitchField; label: MessageKey }[] = [
  { key: "flagProjectReports", label: "teamSignals.flagProjectReports" },
  { key: "flagOverdueDecisions", label: "teamSignals.flagOverdueDecisions" },
];

const DELIVERY_SWITCHES: { key: SwitchField; label: MessageKey; hint: MessageKey }[] = [
  { key: "remindersEnabled", label: "teamSignals.remindersEnabled", hint: "teamSignals.remindersHint" },
  { key: "digestEnabled", label: "teamSignals.digestEnabled", hint: "teamSignals.digestHint" },
];

/** Admin, Team signals: the thresholds, and whether reminders and the digest go out. */
export function TeamSignalsForm({ initial }: { initial: TeamSignalSettingsInput }) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  return (
    <form
      className="space-y-6"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        setError(null);
        setSaved(false);
        const result = await saveTeamSignalSettings({
          overdueCount: form.get("overdueCount"),
          overdueAgeDays: form.get("overdueAgeDays"),
          blockedNoUpdateDays: form.get("blockedNoUpdateDays"),
          inProgressNoUpdateDays: form.get("inProgressNoUpdateDays"),
          flagProjectReports: form.get("flagProjectReports") === "on",
          flagOverdueDecisions: form.get("flagOverdueDecisions") === "on",
          remindersEnabled: form.get("remindersEnabled") === "on",
          digestEnabled: form.get("digestEnabled") === "on",
        });
        setBusy(false);
        if (!result.ok) {
          setError(result.error ?? t("teamSignals.errors.generic"));
          return;
        }
        setSaved(true);
        router.refresh();
      }}
    >
      <fieldset className="card space-y-4 px-4 py-4">
        <legend className="section-heading px-1">{t("teamSignals.rulesHeading")}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {NUMBER_FIELDS.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`signal-${field.key}`}>{t(field.label)}</Label>
              <Input
                id={`signal-${field.key}`}
                name={field.key}
                type="number"
                inputMode="numeric"
                required
                min={THRESHOLD_LIMITS[field.key].min}
                max={THRESHOLD_LIMITS[field.key].max}
                step={1}
                defaultValue={initial[field.key]}
                aria-describedby={`signal-${field.key}-hint`}
              />
              <div id={`signal-${field.key}-hint`}>
                <FieldHint>{t(field.hint)}</FieldHint>
              </div>
            </div>
          ))}
        </div>
        {RULE_SWITCHES.map((field) => (
          <label key={field.key} className="flex items-center gap-2 text-[13.5px]">
            <Checkbox name={field.key} defaultChecked={initial[field.key]} />
            {t(field.label)}
          </label>
        ))}
      </fieldset>

      <fieldset className="card space-y-4 px-4 py-4">
        <legend className="section-heading px-1">{t("teamSignals.deliveryHeading")}</legend>
        <p className="meta" role="note">
          {t("teamSignals.privacyNotice")}
        </p>
        {DELIVERY_SWITCHES.map((field) => (
          <div key={field.key}>
            <label className="flex items-center gap-2 text-[13.5px]">
              <Checkbox
                name={field.key}
                defaultChecked={initial[field.key]}
                aria-describedby={`signal-${field.key}-hint`}
              />
              {t(field.label)}
            </label>
            <div id={`signal-${field.key}-hint`} className="pl-6">
              <FieldHint>{t(field.hint)}</FieldHint>
            </div>
          </div>
        ))}
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={busy} disabled={busy}>
          {t("teamSignals.save")}
        </Button>
        {saved ? (
          <span role="status" className="text-[13px] text-success-fg">
            {t("teamSignals.saved")}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-[13px] text-danger-fg">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
