"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useCallback, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { TranslateFn } from "@/lib/i18n/translator";

interface RunOptions {
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  t: TranslateFn;
  reload: () => void;
}

/**
 * Calls a server action so that a failure can never leave a button stuck.
 *
 * A server action's promise rejects when the network drops, when the server
 * throws, and after every release for a tab opened before it (the action id
 * no longer exists). A handler that sets "Saving…" and awaits without a
 * finally then stays busy forever with no message. Here busy always clears,
 * a rejection becomes a translated message, and a stale tab reloads.
 * Returns the action's result, or undefined when it did not complete.
 */
export async function runServerAction<T>(call: () => Promise<T>, options: RunOptions): Promise<T | undefined> {
  options.setError(null);
  options.setBusy(true);
  try {
    return await call();
  } catch (error) {
    if (unstable_isUnrecognizedActionError(error)) {
      options.setError(options.t("ui.actionOutdated"));
      options.reload();
    } else {
      options.setError(options.t("ui.actionUnreachable"));
    }
    return undefined;
  } finally {
    options.setBusy(false);
  }
}

/** `const { pending, error, setError, run } = useServerAction();` then `await run(() => save(values))`. */
export function useServerAction() {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    <T,>(call: () => Promise<T>) =>
      runServerAction(call, { setBusy: setPending, setError, t, reload: () => window.location.reload() }),
    [t],
  );
  return { pending, error, setError, run };
}
