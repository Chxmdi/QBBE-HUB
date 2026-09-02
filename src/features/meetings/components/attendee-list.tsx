"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  addMeetingAttendee,
  removeMeetingAttendee,
} from "@/features/meetings/services/meeting.commands";

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
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invited = new Set(attendees.map((a) => a.userId));
  const invitable = people.filter((p) => !invited.has(p.id));

  async function invite(formData: FormData) {
    const userId = String(formData.get("userId") ?? "");
    if (!userId) {
      setError("Choose a person to invite.");
      return;
    }
    setError(null);
    setPending(userId);
    const result = await addMeetingAttendee({ meetingId, userId });
    setPending(null);
    if (!result.ok) {
      setError(result.error ?? "Could not add that person.");
      return;
    }
    router.refresh();
  }

  async function remove(attendee: Attendee) {
    if (
      !window.confirm(
        `Remove ${attendee.name} from this meeting? They will lose access to its agenda, notes and decisions unless they are staff.`,
      )
    ) return;
    setError(null);
    setPending(attendee.userId);
    const result = await removeMeetingAttendee({ meetingId, userId: attendee.userId });
    setPending(null);
    if (!result.ok) {
      setError(result.error ?? "Could not remove that person.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {attendees.length === 0 ? (
        <p className="meta">
          Nobody is invited yet. Only staff can see this meeting until someone is
          added.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {attendees.map((attendee) => (
            <li key={attendee.userId} className="flex items-center gap-2">
              <Avatar name={attendee.name} src={attendee.avatarUrl} size="sm" />
              <span className="text-[13px] text-ink">{attendee.name}</span>
              {attendee.isOrganizer ? (
                <span className="meta">Organizer</span>
              ) : null}
              {canManage && !attendee.isOrganizer ? (
                <Button
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => remove(attendee)}
                  loading={pending === attendee.userId}
                  aria-label={`Remove ${attendee.name} from this meeting`}
                >
                  Remove
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
              Invite someone
            </label>
            <select
              id="attendee-picker"
              name="userId"
              defaultValue=""
              className="h-9 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-ink"
            >
              <option value="" disabled>
                Choose a person…
              </option>
              {invitable.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary" loading={pending !== null}>
            Invite
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
