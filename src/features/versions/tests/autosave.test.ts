import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, type AutosaveStatus } from "../autosave";

describe("autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(results: boolean[] = []) {
    const saved: string[] = [];
    const statuses: AutosaveStatus[] = [];
    const save = vi.fn(async (value: string) => {
      saved.push(value);
      return results.length ? results.shift()! : true;
    });
    const saver = createAutosaver<string>({
      save,
      quietMs: 1000,
      retryMs: [500, 2000],
      onStatus: (status) => statuses.push(status),
    });
    return { saver, save, saved, statuses };
  }

  it("saves only the latest value after a quiet pause", async () => {
    const { saver, saved, statuses } = setup();
    saver.change("a");
    await vi.advanceTimersByTimeAsync(500);
    saver.change("ab");
    await vi.advanceTimersByTimeAsync(999);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual(["ab"]);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("saves an edit made during a slow save right after it", async () => {
    let release!: () => void;
    const saved: string[] = [];
    const saver = createAutosaver<string>({
      quietMs: 100,
      onStatus: () => {},
      save: (value) => {
        saved.push(value);
        if (saved.length === 1) return new Promise<boolean>((resolve) => (release = () => resolve(true)));
        return Promise.resolve(true);
      },
    });
    saver.change("first");
    await vi.advanceTimersByTimeAsync(100);
    saver.change("second");
    await vi.advanceTimersByTimeAsync(100);
    expect(saved).toEqual(["first"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual(["first", "second"]);
  });

  it("retries a failed save with a growing delay and keeps the newest value", async () => {
    const { saver, saved, statuses } = setup([false, false, true]);
    saver.change("x");
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses.at(-1)).toBe("error");
    await vi.advanceTimersByTimeAsync(500);
    expect(saved).toEqual(["x", "x"]);
    saver.change("y");
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual(["x", "x", "y"]);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("flush saves at once, and a thrown error counts as a failure", async () => {
    const saved: string[] = [];
    const statuses: AutosaveStatus[] = [];
    const saver = createAutosaver<string>({
      quietMs: 10_000,
      onStatus: (status) => statuses.push(status),
      save: async (value) => {
        saved.push(value);
        if (value === "boom") throw new Error("network");
        return true;
      },
    });
    saver.change("now");
    await saver.flush();
    expect(saved).toEqual(["now"]);
    saver.change("boom");
    await saver.flush();
    expect(statuses.at(-1)).toBe("error");
    saver.dispose();
    saver.change("after");
    await saver.flush();
    expect(saved).toEqual(["now", "boom"]);
  });
});
