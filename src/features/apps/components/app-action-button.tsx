"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { runAppAction } from "../services/app.commands";

/** Runs one of the app's actions and says what happened, in a live region. */
export function AppActionButton({ slug, actionKey, label, doneText }: { slug: string; actionKey: string; label: string; doneText: string }) {
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState("");
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await runAppAction(slug, actionKey, []);
            setMessage(result.ok ? doneText : result.error);
          })
        }
      >
        {label}
      </Button>
      <p role="status" className="text-[12.5px] text-muted">{message}</p>
    </div>
  );
}
