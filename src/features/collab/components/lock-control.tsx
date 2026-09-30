"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/client";
import { fill } from "../i18n";
import { collabText } from "../messages";
import { setObjectLock } from "../services/collab.commands";
import type { ObjectLockView } from "../services/collab.queries";

/** The lock banner, and lock/unlock for people who manage the object (V1-17). */
export function LockControl({
  objectId,
  lock,
  canManage,
}: {
  objectId: string;
  lock: ObjectLockView | null;
  canManage: boolean;
}) {
  const m = collabText(useLocale()).lock;
  const router = useRouter();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function change(locked: boolean) {
    setBusy(true);
    setError(false);
    const result = await setObjectLock(objectId, locked, reason);
    setBusy(false);
    if (!result.ok) setError(true);
    else {
      setReason("");
      router.refresh();
    }
  }

  const name = lock?.lockedByName ?? m.formerMember;
  return (
    <div className="mb-4">
      {lock ? (
        <div role="status" className="card border-warning px-4 py-3">
          <p className="text-[13.5px] font-medium text-warning-fg">
            {lock.reason ? fill(m.lockedReason, { name, reason: lock.reason }) : fill(m.locked, { name })}
          </p>
          <p className="meta">{m.lockedHint}</p>
          {canManage ? (
            <Button className="mt-2" size="sm" variant="secondary" loading={busy} onClick={() => void change(false)}>
              {m.unlock}
            </Button>
          ) : null}
        </div>
      ) : canManage ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void change(true);
          }}
        >
          <div className="min-w-56 flex-1">
            <label htmlFor={reasonId} className="text-[13px] font-medium">
              {m.reasonLabel}
            </label>
            <Input id={reasonId} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
          </div>
          <Button type="submit" variant="secondary" loading={busy}>
            {m.lock}
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-sm text-danger-fg">
          {m.failed}
        </p>
      ) : null}
    </div>
  );
}
