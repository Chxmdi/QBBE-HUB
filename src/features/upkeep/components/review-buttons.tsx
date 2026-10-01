"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { fill, type UpkeepText } from "@/features/upkeep/messages";
import { reviewStalePage } from "@/features/upkeep/services/upkeep.commands";

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(decision: "current" | "archive") {
    setBusy(true);
    const result = await reviewStalePage(objectType, objectId, decision);
    setBusy(false);
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
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run("current")}>
          {fill(text.stillCurrent, { title })}
        </Button>
        {objectType === "document" ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("archive")}>
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
