"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { attachMeetingRecording } from "../services/meeting-v2.commands";
import { useMeetingsV2T } from "./use-mv2-t";

const MAX_BYTES = 25 * 1024 * 1024;

/** Uploads a recording into the private documents bucket and attaches it. */
export function RecordingUpload({ meetingId }: { meetingId: string }) {
  const t = useMeetingsV2T();
  const router = useRouter();
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const file = new FormData(formElement).get("file") as File | null;
    if (!file || file.size === 0) return setStatus({ ok: false, text: t("recording.chooseFile") });
    if (file.size > MAX_BYTES) return setStatus({ ok: false, text: t("recording.tooLarge") });

    setSaving(true);
    setStatus({ ok: true, text: t("recording.uploading") });
    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const path = `${crypto.randomUUID()}/${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) {
      setSaving(false);
      return setStatus({ ok: false, text: t("recording.error") });
    }
    const result = await attachMeetingRecording({
      meetingId,
      title: file.name,
      storagePath: path,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    });
    setSaving(false);
    if (!result.ok) {
      await supabase.storage.from("documents").remove([path]);
      return setStatus({ ok: false, text: result.error ?? t("recording.error") });
    }
    setStatus({ ok: true, text: t("recording.uploaded") });
    formElement.reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Label htmlFor={id}>{t("recording.fileLabel")}</Label>
      <Input id={id} name="file" type="file" accept="audio/*,video/*" className="py-1.5" aria-describedby={`${id}-hint`} />
      <div id={`${id}-hint`}>
        <FieldHint>{t("recording.hint")}</FieldHint>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {status ? (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "text-[12.5px] text-muted" : "text-[12.5px] text-danger-fg"}>
            {status.text}
          </span>
        ) : null}
        <Button type="submit" variant="secondary" size="sm" loading={saving}>{t("recording.upload")}</Button>
      </div>
    </form>
  );
}
