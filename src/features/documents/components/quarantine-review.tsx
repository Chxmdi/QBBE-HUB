"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { deleteQuarantinedFile, releaseQuarantinedFile } from "@/features/documents/services/quarantine.commands";
import type { QuarantinedFile } from "@/features/documents/services/quarantine.queries";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";

/** Admin > Jobs: release a false positive or delete a blocked upload. */
export function QuarantineReview({ files }: { files: QuarantinedFile[] }) {
  const t = useT();
  return (
    <section aria-labelledby="jobs-quarantine" className="mt-6">
      <h2 id="jobs-quarantine" className="section-heading mb-1">{t("jobs.quarantine.title")}</h2>
      <p className="meta mb-3">{t("jobs.quarantine.body")}</p>
      {files.length === 0 ? (
        <p className="card px-4 py-3 text-[13px]">{t("jobs.quarantine.empty")}</p>
      ) : (
        <ul className="card divide-y divide-line">
          {files.map((file) => (
            <QuarantinedRow key={`${file.kind}-${file.id}`} file={file} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QuarantinedRow({ file }: { file: QuarantinedFile }) {
  const t = useT();
  const router = useRouter();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"release" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const options = (what: "release" | "delete") => ({
    setBusy: (on: boolean) => setBusy(on ? what : null),
    setError,
    t,
    reload: () => window.location.reload(),
  });

  async function release() {
    const result = await runServerAction(() => releaseQuarantinedFile({ kind: file.kind, id: file.id, reason }), options("release"));
    if (!result) return;
    if (!result.ok) return setError(result.error);
    setNotice(t("jobs.quarantine.released"));
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(t("jobs.quarantine.confirmDelete"))) return;
    const result = await runServerAction(() => deleteQuarantinedFile({ kind: file.kind, id: file.id }), options("delete"));
    if (!result) return;
    if (!result.ok) return setError(result.error);
    setNotice(t("jobs.quarantine.deleted"));
    router.refresh();
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-medium">{file.name}</span>
        <Badge tone="neutral">{t(`jobs.quarantine.kinds.${file.kind}`)}</Badge>
        <span className="meta">{t("jobs.quarantine.found", { signature: file.signature })}</span>
      </div>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void release();
        }}
      >
        {file.releasable ? (
          <>
            <div className="min-w-56 flex-1">
              <Label htmlFor={reasonId}>{t("jobs.quarantine.reasonLabel")}</Label>
              <Input id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
            </div>
            <Button type="submit" variant="secondary" loading={busy === "release"} disabled={busy !== null}>
              {t("jobs.quarantine.release")}
            </Button>
          </>
        ) : null}
        <Button type="button" variant="danger" loading={busy === "delete"} disabled={busy !== null} onClick={() => void remove()}>
          {t("jobs.quarantine.delete")}
        </Button>
      </form>
      {error ? <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p> : null}
      {notice ? <p role="status" className="mt-2 text-sm text-success-fg">{notice}</p> : null}
    </li>
  );
}
