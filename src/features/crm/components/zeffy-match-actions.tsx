"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { resolveZeffyMatch } from "@/features/crm/services/supporter.commands";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";

/**
 * For one Zeffy supporter the sync could not place: a button per suggested
 * contact, and one to make a new contact instead.
 */
export function ZeffyMatchActions({
  matchId,
  candidates,
}: {
  matchId: string;
  candidates: { id: string; full_name: string; email: string | null; crm_organization: { name: string } | null }[];
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(contactId: string | null) {
    const result = await runServerAction(() => resolveZeffyMatch({ matchId, contactId }), {
      setError,
      t,
      reload: () => window.location.reload(),
      setBusy: (busy) => setBusy(busy ? (contactId ?? "new") : null),
    });
    if (!result) return;
    if (!result.ok) {
      setError(result.error ?? t("crm.zeffy.matchFailed"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {candidates.map((candidate) => (
        <Button
          key={candidate.id}
          variant="secondary"
          loading={busy === candidate.id}
          disabled={busy !== null}
          onClick={() => choose(candidate.id)}
        >
          {t("crm.zeffy.thisIs", {
            name: candidate.crm_organization
              ? `${candidate.full_name} (${candidate.crm_organization.name})`
              : candidate.full_name,
          })}
        </Button>
      ))}
      <Button variant="ghost" loading={busy === "new"} disabled={busy !== null} onClick={() => choose(null)}>
        {t("crm.zeffy.newContact")}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-[12.5px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
