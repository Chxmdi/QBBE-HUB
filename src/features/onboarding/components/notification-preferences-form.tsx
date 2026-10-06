"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select, Checkbox } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { setChannelMute } from "@/features/channels/services/channel.commands";
import { saveNotificationPreferences } from "@/features/notifications/services/preferences.commands";
import { useLocale, useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** "07:00" in English, "7 h" in Quebec French. */
function hourLabel(hour: number, locale: Locale): string {
  return locale === "fr-CA" ? `${hour}\u00a0h` : `${String(hour).padStart(2, "0")}:00`;
}

export function NotificationPreferencesForm({
  initial,
  channels,
}: {
  initial: {
    emailCritical: boolean;
    emailDigest: boolean;
    quietHoursStart: number | null;
    quietHoursEnd: number | null;
  };
  channels: { id: string; label: string; mutedLevel: "all" | "mentions" | "muted" }[];
}) {
  const t = useT();
  const locale = useLocale();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [levels, setLevels] = useState(() =>
    Object.fromEntries(channels.map((channel) => [channel.id, channel.mutedLevel])),
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const start = data.get("quietHoursStart") as string;
    const end = data.get("quietHoursEnd") as string;
    setSaving(true);
    const result = await saveNotificationPreferences({
      emailCritical: data.get("emailCritical") === "on",
      emailDigest: data.get("emailDigest") === "on",
      quietHoursStart: start === "" ? null : Number(start),
      quietHoursEnd: end === "" ? null : Number(end),
    });
    setSaving(false);
    if (result.ok) toast(t("settings.delivery.saved"));
    else toast(result.error ?? t("settings.delivery.saveFailed"), { tone: "error" });
  }

  async function changeChannel(channelId: string, mutedLevel: "all" | "mentions" | "muted") {
    const previous = levels[channelId];
    setLevels((current) => ({ ...current, [channelId]: mutedLevel }));
    const result = await setChannelMute({ channelId, mutedLevel });
    if (!result.ok) {
      setLevels((current) => ({ ...current, [channelId]: previous }));
      toast(result.error ?? t("settings.channels.updateFailed"), { tone: "error" });
    }
  }

  return (
    <div className="space-y-7">
      <form onSubmit={submit} className="card max-w-2xl space-y-5 p-5">
        <div>
          <h2 className="section-heading">{t("settings.delivery.heading")}</h2>
          <p className="meta mt-1">{t("settings.delivery.intro")}</p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-(--radius-sm) p-2 hover:bg-surface-soft">
          <Checkbox name="emailCritical" defaultChecked={initial.emailCritical} className="mt-0.5 accent-brand" />
          <span><span className="block text-[13.5px] font-medium">{t("settings.delivery.emailCritical")}</span><span className="meta">{t("settings.delivery.emailCriticalHint")}</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-(--radius-sm) p-2 hover:bg-surface-soft">
          <Checkbox name="emailDigest" defaultChecked={initial.emailDigest} className="mt-0.5 accent-brand" />
          <span><span className="block text-[13.5px] font-medium">{t("settings.delivery.dailyDigest")}</span><span className="meta">{t("settings.delivery.dailyDigestHint")}</span></span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="quiet-start">{t("settings.delivery.quietStart")}</Label>
            <Select id="quiet-start" name="quietHoursStart" defaultValue={initial.quietHoursStart ?? ""}>
              <option value="">{t("settings.delivery.noQuietHours")}</option>
              {HOURS.map((hour) => <option key={hour} value={hour}>{hourLabel(hour, locale)}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="quiet-end">{t("settings.delivery.quietEnd")}</Label>
            <Select id="quiet-end" name="quietHoursEnd" defaultValue={initial.quietHoursEnd ?? ""}>
              <option value="">{t("settings.delivery.noQuietHours")}</option>
              {HOURS.map((hour) => <option key={hour} value={hour}>{hourLabel(hour, locale)}</option>)}
            </Select>
          </div>
        </div>
        <p className="meta rounded-(--radius-sm) bg-surface-soft px-3 py-2">{t("settings.delivery.quietNote")}</p>
        <div className="flex justify-end"><Button type="submit" loading={saving}>{t("settings.delivery.save")}</Button></div>
      </form>

      <section className="card max-w-2xl p-5" aria-labelledby="channel-notifications">
        <h2 id="channel-notifications" className="section-heading">{t("settings.channels.heading")}</h2>
        <p className="meta mt-1">{t("settings.channels.intro")}</p>
        {channels.length === 0 ? <p className="meta mt-4">{t("settings.channels.empty")}</p> : (
          <ul className="mt-4 divide-y divide-line">
            {channels.map((channel) => (
              <li key={channel.id} className="flex items-center gap-4 py-3">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">#{channel.label}</span>
                <Select aria-label={t("settings.channels.selectLabel", { channel: channel.label })} value={levels[channel.id]} onChange={(event) => void changeChannel(channel.id, event.target.value as "all" | "mentions" | "muted")} className="w-36">
                  <option value="all">{t("settings.channels.all")}</option>
                  <option value="mentions">{t("settings.channels.mentions")}</option>
                  <option value="muted">{t("settings.channels.muted")}</option>
                </Select>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
