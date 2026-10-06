"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, FieldHint, Input, Label } from "@/components/ui/input";
import type { LensSpec } from "@/lib/query/spec";
import { useLensT } from "@/features/lenses/i18n/client";
import { saveLens, updateLens } from "@/features/lenses/services/lens-store.actions";
import type { LensKind } from "@/features/lenses/services/lens-store.types";

export interface OpenLens {
  id: string;
  name: string;
  mine: boolean;
}

/**
 * "Save as lens" (a new personal or shared lens) and, on a lens the viewer
 * owns, "Save changes". The spec and layout are read at click time.
 */
export function SaveLensButton({
  kind,
  current,
  read,
  basePath,
}: {
  kind: LensKind;
  current: OpenLens | null;
  read: () => { spec: LensSpec; layout: Record<string, unknown> };
  basePath: string;
}) {
  const t = useLensT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [shared, setShared] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const nameId = React.useId();
  const hintId = React.useId();

  const saveChanges = () =>
    startTransition(async () => {
      const { spec, layout } = read();
      const result = await updateLens({ id: current!.id, spec, layout });
      setMessage(result.ok ? t("saved.updated") : result.error ?? t("saved.failed"));
    });

  const saveNew = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const { spec, layout } = read();
      const result = await saveLens({ name, kind, spec, layout, visibility: shared ? "shared" : "personal" });
      if (result.ok && result.id) {
        setOpen(false);
        setMessage(t("saved.savedDone"));
        router.push(`${basePath}?lens=${result.id}`);
      } else {
        setMessage(result.error ?? t("saved.failed"));
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      {current?.mine ? (
        <Button type="button" size="sm" variant="secondary" loading={pending} onClick={saveChanges}>
          {t("saved.saveChanges")}
        </Button>
      ) : null}
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("saved.saveAs")}
      </Button>
      <p role="status" aria-live="polite" className="text-[12.5px] text-muted">
        {message}
      </p>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("saved.saveAs")}>
        <form onSubmit={saveNew} className="space-y-4">
          <div>
            <Label htmlFor={nameId}>{t("saved.nameLabel")}</Label>
            <Input id={nameId} value={name} required maxLength={120} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="flex items-center gap-2 text-[13.5px] text-ink">
              <Checkbox checked={shared} aria-describedby={hintId} onChange={(e) => setShared(e.target.checked)} />
              {t("saved.shareLabel")}
            </label>
            <div id={hintId}>
              <FieldHint>{t("saved.shareHint")}</FieldHint>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("saved.cancel")}
            </Button>
            <Button type="submit" loading={pending} disabled={!name.trim()}>
              {t("saved.save")}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
