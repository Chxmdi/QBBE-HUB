"use client";

import * as React from "react";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { usePagesT } from "@/features/pages/i18n/client";
import { setPageWatch } from "@/features/notifications/services/page-watch.commands";

/**
 * The page header's watch toggle (wave 2, C3). A pressed button means the
 * person is watching; the name stays "Watch" so it matches what is on screen,
 * and the state is read out as pressed or not. A failure says so and leaves
 * the button as it was, so pressing again retries.
 */
export function PageWatchButton({ pageId, initialWatching }: { pageId: string; initialWatching: boolean }) {
  const t = usePagesT();
  const { toast } = useToast();
  const [watching, setWatching] = React.useState(initialWatching);
  const [pending, startTransition] = React.useTransition();

  function toggle() {
    // Not disabled while saving, so keyboard focus stays on the button.
    if (pending) return;
    const next = !watching;
    startTransition(async () => {
      const result = await setPageWatch({ pageId, watching: next });
      if (!result.ok) {
        toast(result.error ?? t("units.c3.watch.failed"), { tone: "error" });
        return;
      }
      setWatching(next);
      toast(next ? t("units.c3.watch.started") : t("units.c3.watch.stopped"), { tone: "success" });
    });
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-pressed={watching}
      title={watching ? t("units.c3.watch.watchingHint") : t("units.c3.watch.hint")}
      aria-busy={pending}
      onClick={toggle}
      className={cn(watching && "border-brand bg-surface-soft")}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Eye className={cn("size-4", watching && "fill-current")} aria-hidden />
      )}
      {t("units.c3.watch.watch")}
    </Button>
  );
}
