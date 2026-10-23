/**
 * Every call to a Google API goes through here.
 *
 * Node's fetch waits up to five minutes for an answer, and a Calendar write
 * runs inside a person's save, so one slow Google response could hold a save
 * or a sync job for minutes. Each call now has a timeout, and a call Google
 * asks us to repeat (429, 5xx) is retried a bounded number of times with
 * growing delays, honouring Retry-After. Writes that are not safe to repeat
 * (sending a message, creating an event) are not retried unless the caller
 * says so. A call that never gets an answer throws GoogleFetchError, whose
 * message the integration health classifier reads as "delayed".
 */

export class GoogleFetchError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "GoogleFetchError";
  }
}

export interface GoogleFetchOptions {
  /** Per attempt. User-facing calls keep the default; background sync may wait longer. */
  timeoutMs?: number;
  /** Extra attempts after the first, for answers Google asks us to repeat. */
  retries?: number;
  /** Repeat a non-GET request too (only when repeating it cannot duplicate anything). */
  retryUnsafe?: boolean;
  /** Longest single wait between attempts. */
  maxDelayMs?: number;
  /** Replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

/** Retry-After as milliseconds (seconds or an HTTP date), or null. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

function delayScale(): number {
  const scale = Number(process.env.GOOGLE_FETCH_DELAY_SCALE ?? "1");
  return Number.isFinite(scale) && scale >= 0 ? scale : 1;
}

export async function googleFetch(
  url: string | URL,
  init: RequestInit = {},
  options: GoogleFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 15_000,
    retries = 2,
    retryUnsafe = false,
    maxDelayMs = 30_000,
    // GOOGLE_FETCH_DELAY_SCALE=0 (the unit tests) retries without waiting.
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms * delayScale())),
  } = options;
  const method = (init.method ?? "GET").toUpperCase();
  const mayRepeat = method === "GET" || retryUnsafe;
  const attempts = 1 + (mayRepeat ? retries : 0);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      lastError = error;
    }
    if (response && (!RETRYABLE(response.status) || attempt === attempts)) return response;
    if (attempt === attempts) break;
    const backoff = Math.min(maxDelayMs, 1000 * 2 ** (attempt - 1));
    const asked = response ? retryAfterMs(response.headers.get("retry-after")) : null;
    await sleep(Math.min(maxDelayMs, asked ?? backoff));
  }
  const reason =
    lastError instanceof Error && (lastError.name === "TimeoutError" || lastError.name === "AbortError")
      ? `timed out after ${timeoutMs} ms`
      : `network failure (${lastError instanceof Error ? lastError.message : String(lastError)})`;
  throw new GoogleFetchError(`Google request ${reason}`);
}
