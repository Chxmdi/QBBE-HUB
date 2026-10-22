import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { runServerAction } from "@/lib/use-server-action";

/** A failed save re-enables its button and says why, in the person's language. */

function harness() {
  const busy: boolean[] = [];
  const errors: (string | null)[] = [];
  const reload = vi.fn();
  return {
    busy,
    errors,
    reload,
    options: {
      setBusy: (value: boolean) => void busy.push(value),
      setError: (value: string | null) => void errors.push(value),
      t: createTranslator("fr-CA"),
      reload,
    },
  };
}

describe("runServerAction", () => {
  it("returns the action's result and clears busy", async () => {
    const h = harness();
    expect(await runServerAction(async () => ({ ok: true }), h.options)).toEqual({ ok: true });
    expect(h.busy).toEqual([true, false]);
    expect(h.errors).toEqual([null]);
  });

  it("clears busy and shows a translated message when the request fails", async () => {
    const h = harness();
    const result = await runServerAction(() => Promise.reject(new TypeError("Failed to fetch")), h.options);
    expect(result).toBeUndefined();
    expect(h.busy).toEqual([true, false]);
    expect(h.errors.at(-1)).toMatch(/Impossible de joindre le Hub/);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("reloads the page when the action no longer exists after a release", async () => {
    const h = harness();
    const { UnrecognizedActionError } = await import("next/dist/client/components/unrecognized-action-error");
    await runServerAction(() => Promise.reject(new UnrecognizedActionError("gone")), h.options);
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.errors.at(-1)).toMatch(/mis à jour/);
    expect(h.busy.at(-1)).toBe(false);
  });
});
