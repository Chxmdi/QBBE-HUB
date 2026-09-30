"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { fill, type GoogleObjectsText } from "@/features/google-objects/messages";
import {
  addEventAsMeeting,
  forwardToCapture,
  linkDriveFile,
} from "@/features/google-objects/services/google-objects.commands";

type Message = { ok: boolean; text: string; href?: string; hrefText?: string } | null;

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-success-fg" : "text-sm text-danger-fg"}>
      {message.text}{" "}
      {message.href ? (
        <Link href={message.href} className="text-brand-fg underline">
          {message.hrefText}
        </Link>
      ) : null}
    </p>
  );
}

export function EventToMeeting({
  linkId,
  name,
  projects,
  text,
}: {
  linkId: string;
  name: string;
  projects: { id: string; name: string }[];
  text: GoogleObjectsText;
}) {
  const id = useId();
  const router = useRouter();
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const result = await addEventAsMeeting(linkId, project || null);
        setBusy(false);
        if (!result.ok) return setMessage({ ok: false, text: result.error });
        setMessage({ ok: true, text: fill(text.meetingAdded, { name }), href: `/meetings/${result.data?.meetingId}`, hrefText: text.openMeeting });
        router.refresh();
      }}
    >
      <div className="min-w-56">
        <Label htmlFor={`${id}-project`}>{fill(text.project, { name })}</Label>
        <Select id={`${id}-project`} value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">{text.noProject}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" size="md" loading={busy} aria-label={fill(text.addAsMeeting, { name })}>
        {fill(text.addAsMeeting, { name })}
      </Button>
      <div className="basis-full">
        <Feedback message={message} />
      </div>
    </form>
  );
}

export function DriveLinkForm({ projects, text }: { projects: { id: string; name: string }[]; text: GoogleObjectsText }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        setBusy(true);
        const result = await linkDriveFile({
          url: String(data.get("url") ?? ""),
          title: String(data.get("title") ?? ""),
          projectId: String(data.get("project") ?? "") || null,
        });
        setBusy(false);
        if (!result.ok) return setMessage({ ok: false, text: result.error });
        setMessage({ ok: true, text: text.fileLinked });
        form.reset();
      }}
    >
      <div className="md:col-span-2">
        <Label htmlFor={`${id}-url`}>{text.driveUrl}</Label>
        <Input id={`${id}-url`} name="url" type="url" inputMode="url" required placeholder="https://docs.google.com/…" />
      </div>
      <div>
        <Label htmlFor={`${id}-title`}>{text.driveTitle}</Label>
        <Input id={`${id}-title`} name="title" required maxLength={200} />
      </div>
      <div>
        <Label htmlFor={`${id}-project`}>{text.driveProject}</Label>
        <Select id={`${id}-project`} name="project" defaultValue="">
          <option value="">{text.noDriveProject}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="md:col-span-2 space-y-2">
        <Button type="submit" loading={busy}>
          {text.linkFile}
        </Button>
        <Feedback message={message} />
      </div>
    </form>
  );
}

export function ForwardToCapture({ messageId, name, text }: { messageId: string; name: string; text: GoogleObjectsText }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          const result = await forwardToCapture(messageId);
          setBusy(false);
          setMessage(result.ok ? { ok: true, text: text.sentToCapture } : { ok: false, text: result.error });
          if (result.ok) router.refresh();
        }}
      >
        {fill(text.toCapture, { name })}
      </Button>
      <Feedback message={message} />
    </div>
  );
}
