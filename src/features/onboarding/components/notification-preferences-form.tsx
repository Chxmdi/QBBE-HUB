"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { setChannelMute } from "@/features/channels/services/channel.commands";
import { saveNotificationPreferences } from "@/features/onboarding/services/onboarding.commands";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

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
    if (result.ok) toast("Notification preferences saved.");
    else toast(result.error ?? "Could not save preferences.", { tone: "error" });
  }

  async function changeChannel(channelId: string, mutedLevel: "all" | "mentions" | "muted") {
    const previous = levels[channelId];
    setLevels((current) => ({ ...current, [channelId]: mutedLevel }));
    const result = await setChannelMute({ channelId, mutedLevel });
    if (!result.ok) {
      setLevels((current) => ({ ...current, [channelId]: previous }));
      toast(result.error ?? "Could not update this channel.", { tone: "error" });
    }
  }

  return (
    <div className="space-y-7">
      <form onSubmit={submit} className="card max-w-2xl space-y-5 p-5">
        <div>
          <h2 className="section-heading">Delivery preferences</h2>
          <p className="meta mt-1">Choose how QBBE Hub reaches you outside the workspace.</p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-(--radius-sm) p-2 hover:bg-surface-soft">
          <input name="emailCritical" type="checkbox" defaultChecked={initial.emailCritical} className="mt-0.5 size-4 accent-brand" />
          <span><span className="block text-[13.5px] font-medium">Email critical activity</span><span className="meta">Assignments, mentions, deadlines, and urgent announcements.</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-(--radius-sm) p-2 hover:bg-surface-soft">
          <input name="emailDigest" type="checkbox" defaultChecked={initial.emailDigest} className="mt-0.5 size-4 accent-brand" />
          <span><span className="block text-[13.5px] font-medium">Daily digest</span><span className="meta">A summary of non-urgent updates when digest delivery is configured.</span></span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="quiet-start">Quiet hours start</Label>
            <Select id="quiet-start" name="quietHoursStart" defaultValue={initial.quietHoursStart ?? ""}>
              <option value="">No quiet hours</option>
              {HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="quiet-end">Quiet hours end</Label>
            <Select id="quiet-end" name="quietHoursEnd" defaultValue={initial.quietHoursEnd ?? ""}>
              <option value="">No quiet hours</option>
              {HOURS.map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
            </Select>
          </div>
        </div>
        <p className="meta rounded-(--radius-sm) bg-surface-soft px-3 py-2">Required critical announcements may still be delivered during quiet hours.</p>
        <div className="flex justify-end"><Button type="submit" loading={saving}>Save preferences</Button></div>
      </form>

      <section className="card max-w-2xl p-5" aria-labelledby="channel-notifications">
        <h2 id="channel-notifications" className="section-heading">Channel notifications</h2>
        <p className="meta mt-1">Control notifications for channels you have joined.</p>
        {channels.length === 0 ? <p className="meta mt-4">Join a channel to adjust its notifications.</p> : (
          <ul className="mt-4 divide-y divide-line">
            {channels.map((channel) => (
              <li key={channel.id} className="flex items-center gap-4 py-3">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">#{channel.label}</span>
                <Select aria-label={`Notifications for ${channel.label}`} value={levels[channel.id]} onChange={(event) => void changeChannel(channel.id, event.target.value as "all" | "mentions" | "muted")} className="w-36">
                  <option value="all">All activity</option>
                  <option value="mentions">Mentions only</option>
                  <option value="muted">Muted</option>
                </Select>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
