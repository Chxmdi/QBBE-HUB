"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  addMeetingAttendee,
  removeMeetingAttendee,
} from "@/features/meetings/services/meeting.commands";
import { Select } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";

export interface Attendee {
  userId: string;
  name: string;
  avatarUrl: string | null;
  isOrganizer: boolean;
}

/**
 * Who is invited to a meeting, and the controls to change that.
 *
 * Attendance is not decoration here. `app.can_read_meeting` grants read to
 * staff, the organizer, or an attendee, so for anyone who is not staff this
 * list is the thing that decides whether the meeting exists for them at all.
 * Removing someone revokes their access to the notes and decisions too, which
 * is why the control says so rather than presenting a bare ×.
 */
export function AttendeeList({
  meetingId,
  attendees,
  people,
  canManage,
}: {
  meetingId: string;
  attendees: Attendee[];
  people: { id: string; label: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invited = new Set(attendees.map((a) => a.userId));
  const invitable = people.filter((p) => !invited.has(p.id));

  async function invite(formData: FormData) {
    const userId = String(formData.get("userId") ?? "");
    if (!userId) {
      setError(t("meetings.attendeeList.choosePerson"));
      return;
    }
    setError(null);
    setPending(userId);
    const result = await addMeetingAttendee({ meetingId, userId });
    setPending(null);
    if (!result.ok) {
      setError(result.error ?? t("meetings.attendeeList.addError"));
      return;
    }
    router.refresh();
  }

  async function remove(attendee: Attendee) {
    if (
      !window.confirm(
        t("meetings.attendeeList.confirmRemove", { name: attendee.name }),
      )
    ) return;
    setError(null);
    setPending(attendee.userId);
    const result = await removeMeetingAttendee({ meetingId, userId: attendee.userId });
    setPending(null);
    if (!result.ok) {
      setError(result.error ?? t("meetings.attendeeList.removeError"));
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {attendees.length === 0 ? (
        <p className="meta">
          {t("meetings.attendeeList.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {attendees.map((attendee) => (
            <li key={attendee.userId} className="flex items-center gap-2">
              <Avatar name={attendee.name} src={attendee.avatarUrl} size="sm" />
              <span className="text-[13px] text-ink">{attendee.name}</span>
              {attendee.isOrganizer ? (
                <span className="meta">{t("meetings.attendeeList.organizer")}</span>
              ) : null}
              {canManage && !attendee.isOrganizer ? (
                <Button
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => remove(attendee)}
                  loading={pending === attendee.userId}
                  aria-label={t("meetings.attendeeList.removeAria", { name: attendee.name })}
                >
                  {t("meetings.attendeeList.remove")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage && invitable.length > 0 ? (
        <form action={invite} className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="attendee-picker" className="meta mb-1 block">
              {t("meetings.attendeeList.inviteLabel")}
            </label>
            <Select
              id="attendee-picker"
              name="userId"
              defaultValue=""
              className="h-9 px-2 text-[13px]"
            >
              <option value="" disabled>
                {t("meetings.attendeeList.choosePlaceholder")}
              </option>
              {invitable.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" loading={pending !== null}>
            {t("meetings.attendeeList.invite")}
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
