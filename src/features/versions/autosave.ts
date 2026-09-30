/**
 * The autosave schedule (M16a), separate from React so it can be tested.
 *
 * Every change restarts a short quiet period; when it ends the latest value is
 * saved. A change made while a save is running is saved right after it, so
 * nothing typed during a slow save is lost. A failed save is retried with a
 * growing delay, and `flush` saves at once (page hidden, navigating away).
 */
export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface AutosaveOptions<T> {
  save: (value: T) => Promise<boolean>;
  onStatus: (status: AutosaveStatus, savedAt: Date | null) => void;
  quietMs?: number;
  retryMs?: number[];
  now?: () => Date;
  timers?: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  };
}

export interface Autosaver<T> {
  change: (value: T) => void;
  flush: () => Promise<void>;
  dispose: () => void;
}

export function createAutosaver<T>(options: AutosaveOptions<T>): Autosaver<T> {
  const quietMs = options.quietMs ?? 1500;
  const retryMs = options.retryMs ?? [2000, 5000, 15000, 30000];
  const now = options.now ?? (() => new Date());
  const timers = options.timers ?? {
    set: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  let pending: { value: T } | null = null;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let failures = 0;
  let disposed = false;

  function schedule(ms: number) {
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => {
      timer = null;
      void run();
    }, ms);
  }

  async function run(): Promise<void> {
    if (disposed || !pending) return;
    if (running) {
      await running;
      return run();
    }
    const { value } = pending;
    pending = null;
    options.onStatus("saving", null);
    running = (async () => {
      let ok = false;
      try {
        ok = await options.save(value);
      } catch {
        ok = false;
      }
      running = null;
      if (ok) {
        failures = 0;
        if (pending) {
          schedule(0);
        } else {
          options.onStatus("saved", now());
        }
      } else {
        // Keep the newest value: a later edit wins over the failed one.
        pending ??= { value };
        options.onStatus("error", null);
        schedule(retryMs[Math.min(failures, retryMs.length - 1)]);
        failures += 1;
      }
    })();
    await running;
  }

  return {
    change(value: T) {
      if (disposed) return;
      pending = { value };
      options.onStatus("pending", null);
      schedule(quietMs);
    },
    async flush() {
      if (timer !== null) {
        timers.clear(timer);
        timer = null;
      }
      await run();
    },
    dispose() {
      disposed = true;
      if (timer !== null) timers.clear(timer);
    },
  };
}
