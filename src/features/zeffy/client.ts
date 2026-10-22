import { zeffyListSchema } from "./types";

/**
 * A small client for Zeffy's read API (base https://api.zeffy.com/api/v1).
 *
 * Zeffy allows 100 requests a minute and 20 a second for the whole Zeffy
 * organization. The client never retries on its own: a 429 stops the run
 * with ZeffyRateLimitedError, the sync keeps what it already saved, and the
 * next scheduled run carries on from the saved cursor. It also stops before
 * the limit when Zeffy says few requests are left in the current minute.
 */

export const ZEFFY_DEFAULT_BASE_URL = "https://api.zeffy.com";
const REQUEST_TIMEOUT_MS = 12_000;
const PAGE_SIZE = 100;
/** Leave this many requests of the minute for anything else using the key. */
const RESERVE = 5;

export type ZeffyResource = "payments" | "contacts" | "campaigns";

export interface ZeffyConfig {
  apiKey: string;
  baseUrl: string;
}

/** Zeffy's settings from the environment, or null when Zeffy is not set up. */
export function zeffyConfig(env: NodeJS.ProcessEnv = process.env): ZeffyConfig | null {
  const apiKey = env.ZEFFY_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (env.ZEFFY_API_BASE_URL?.trim() || ZEFFY_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { apiKey, baseUrl };
}

export class ZeffyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "ZeffyApiError";
  }
}

/** Zeffy asked the Hub to wait; not a failure of the integration. */
export class ZeffyRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number | null) {
    super("Zeffy rate limit reached; the sync continues at its next run.");
    this.name = "ZeffyRateLimitedError";
  }
}

export interface ZeffyPage {
  data: unknown[];
  hasMore: boolean;
  nextCursor: string | null;
}

type Params = Record<string, string | number | undefined | null>;

export class ZeffyClient {
  /** Requests sent by this client, for the run's budget and its record. */
  requests = 0;
  /** Requests Zeffy says are left in the current minute, when it said. */
  remaining: number | null = null;

  constructor(
    private readonly config: ZeffyConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** True when another request would eat into what Zeffy leaves for others. */
  nearLimit(): boolean {
    return this.remaining !== null && this.remaining <= RESERVE;
  }

  async listPage(resource: ZeffyResource, params: Params = {}): Promise<ZeffyPage> {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    }
    const body = await this.request(`/api/v1/${resource}?${query.toString()}`);
    const parsed = zeffyListSchema.safeParse(body);
    if (!parsed.success) {
      throw new ZeffyApiError(`Unexpected Zeffy response for ${resource}.`, 200, "unexpected_shape");
    }
    return {
      data: parsed.data.data,
      hasMore: parsed.data.has_more,
      nextCursor: parsed.data.next_cursor ?? null,
    };
  }

  /** One payment, contact or campaign; null when Zeffy has none by that id. */
  async get(resource: ZeffyResource, id: string): Promise<unknown | null> {
    try {
      return await this.request(`/api/v1/${resource}/${encodeURIComponent(id)}`);
    } catch (cause) {
      if (cause instanceof ZeffyApiError && cause.status === 404) return null;
      throw cause;
    }
  }

  private async request(path: string): Promise<unknown> {
    this.requests += 1;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (cause) {
      const reason = cause instanceof Error && cause.name === "TimeoutError" ? "timed out" : "network error";
      throw new ZeffyApiError(`Zeffy request ${reason}.`, 0, reason === "timed out" ? "timeout" : "network");
    }

    const remaining = Number(response.headers.get("x-ratelimit-remaining"));
    if (response.headers.has("x-ratelimit-remaining") && Number.isFinite(remaining)) {
      this.remaining = remaining;
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new ZeffyRateLimitedError(Number.isFinite(retryAfter) ? retryAfter : null);
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      const code = typeof error?.code === "string" ? error.code : null;
      // The status is part of the message so the integration health check can
      // tell an expired key (401) from a Zeffy outage (5xx).
      throw new ZeffyApiError(
        `Zeffy responded ${response.status}${code ? ` (${code})` : ""}.`,
        response.status,
        code,
      );
    }
    return body;
  }
}
