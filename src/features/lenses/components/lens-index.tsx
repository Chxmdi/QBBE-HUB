"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLensT } from "@/features/lenses/i18n/client";
import { deleteLens, updateLens } from "@/features/lenses/services/lens-store.actions";
import { lensHref, type SavedLens } from "@/features/lenses/services/lens-store.types";

/** The viewer's lenses and the shared ones, with share, unshare and delete on their own. */
export function LensIndex({ lenses }: { lenses: SavedLens[] }) {
  const t = useLensT();
  const router = useRouter();
  const [message, setMessage] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const mine = lenses.filter((l) => l.mine);
  const shared = lenses.filter((l) => !l.mine && l.visibility === "shared");

  const act = (run: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const result = await run();
      setMessage(result.ok ? done : result.error ?? t("saved.failed"));
      if (result.ok) router.refresh();
    });

  const row = (lens: SavedLens) => (
    <li key={lens.id} data-lens-id={lens.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
      <div className="min-w-0 flex-1 basis-60">
        <Link href={lensHref(lens)} className="text-[14px] font-semibold text-ink hover:text-brand-fg">
          {lens.name}
        </Link>
        <p className="meta flex flex-wrap gap-x-2">
          <span>{t(`saved.kind.${lens.kind}`)}</span>
          {lens.typeKey ? <span>{t(`types.${lens.typeKey}` as "types.task")}</span> : null}
          {!lens.mine && lens.ownerName ? <span>{t("saved.by", { name: lens.ownerName })}</span> : null}
          {lens.fromSavedView ? <span>{t("saved.fromSavedView")}</span> : null}
          {lens.unsupportedFilters.length ? (
            <span className="text-warning-fg">{t("saved.unsupported", { filters: lens.unsupportedFilters.join(", ") })}</span>
          ) : null}
        </p>
      </div>
      <Badge tone={lens.visibility === "shared" ? "info" : "neutral"}>
        {lens.visibility === "shared" ? t("saved.sharedBadge") : t("saved.personal")}
      </Badge>
      {lens.mine && !lens.fromSavedView ? (
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            aria-label={`${lens.visibility === "shared" ? t("saved.unshare") : t("saved.share")}: ${lens.name}`}
            onClick={() =>
              act(() => updateLens({ id: lens.id, visibility: lens.visibility === "shared" ? "personal" : "shared" }), t("saved.updated"))
            }
          >
            {lens.visibility === "shared" ? t("saved.unshare") : t("saved.share")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            aria-label={`${t("saved.delete")}: ${lens.name}`}
            onClick={() => {
              if (window.confirm(t("saved.deleteConfirm", { name: lens.name }))) act(() => deleteLens(lens.id), t("saved.deleted"));
            }}
          >
            {t("saved.delete")}
          </Button>
        </div>
      ) : null}
    </li>
  );

  return (
    <div className="space-y-8">
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>
      <section aria-labelledby="lenses-mine">
        <h2 id="lenses-mine" className="section-heading mb-2">
          {t("saved.mine")}
        </h2>
        {mine.length ? <ul className="card divide-y divide-line">{mine.map(row)}</ul> : <p className="card px-4 py-5 text-[13px] text-muted">{t("saved.empty")}</p>}
      </section>
      <section aria-labelledby="lenses-shared">
        <h2 id="lenses-shared" className="section-heading mb-2">
          {t("saved.shared")}
        </h2>
        {shared.length ? <ul className="card divide-y divide-line">{shared.map(row)}</ul> : <p className="card px-4 py-5 text-[13px] text-muted">{t("saved.emptyShared")}</p>}
      </section>
    </div>
  );
}
