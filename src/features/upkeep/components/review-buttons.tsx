"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { fill, type UpkeepText } from "@/features/upkeep/messages";
import { reviewStalePage } from "@/features/upkeep/services/upkeep.commands";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";

export function ReviewButtons({
  objectType,
  objectId,
  title,
  text,
}: {
  objectType: "document" | "page";
  objectId: string;
  title: string;
  text: UpkeepText;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const shellT = useT();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(decision: "current" | "archive") {
    const result = await runServerAction(() => reviewStalePage(objectType, objectId, decision), {
      setBusy,
      setError: (error) => setMessage(error ? { ok: false, text: error } : null),
      t: shellT,
      reload: () => window.location.reload(),
    });
    if (!result) return;
    // The reviewed row leaves the list on refresh, so success is confirmed in
    // the page-level toast, which outlives it; an error stays next to the row.
    if (result.ok) {
      setMessage(null);
      toast(decision === "current" ? text.reviewedCurrent : text.reviewedArchive);
      router.refresh();
    } else {
      setMessage({ ok: false, text: result.error });
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run("current")}>
          {fill(text.stillCurrent, { title })}
        </Button>
        {objectType === "document" ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("archive")}>
            {fill(text.archive, { title })}
          </Button>
        ) : null}
      </div>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-success-fg" : "text-sm text-danger-fg"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
