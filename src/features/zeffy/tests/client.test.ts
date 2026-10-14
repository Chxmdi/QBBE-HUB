import { describe, expect, it, vi } from "vitest";
import { classifyIntegrationFailure } from "@/features/admin/services/integration-health";
import {
  ZeffyApiError,
  ZeffyClient,
  ZeffyRateLimitedError,
  zeffyConfig,
} from "../client";

const CONFIG = { apiKey: "secret-key", baseUrl: "https://zeffy.test" };

function respond(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers }));
}

describe("Zeffy settings", () => {
  it("is not set up without an API key", () => {
    expect(zeffyConfig({ NODE_ENV: "test" })).toBeNull();
    expect(zeffyConfig({ NODE_ENV: "test", ZEFFY_API_KEY: "   " })).toBeNull();
  });

  it("uses Zeffy's address unless a test address is given", () => {
    expect(zeffyConfig({ NODE_ENV: "test", ZEFFY_API_KEY: "k" })).toEqual({ apiKey: "k", baseUrl: "https://api.zeffy.com" });
    expect(zeffyConfig({ NODE_ENV: "test", ZEFFY_API_KEY: "k", ZEFFY_API_BASE_URL: "http://127.0.0.1:4010/" })?.baseUrl).toBe(
      "http://127.0.0.1:4010",
    );
  });
});

describe("Zeffy client", () => {
  it("asks for full pages with the given filters and sends the key as a bearer token", async () => {
    const fetchMock = respond({ data: [{ id: "p-1" }], has_more: true, next_cursor: "p-1" });
    const client = new ZeffyClient(CONFIG, fetchMock as unknown as typeof fetch);
    const page = await client.listPage("payments", { "created[gte]": 1700, starting_after: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://zeffy.test/api/v1/payments?limit=100&created%5Bgte%5D=1700");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-key" });
    expect(page).toEqual({ data: [{ id: "p-1" }], hasMore: true, nextCursor: "p-1" });
    expect(client.requests).toBe(1);
  });

  it("stops at Zeffy's rate limit and says how long to wait", async () => {
    const client = new ZeffyClient(CONFIG, respond({}, 429, { "retry-after": "60" }) as unknown as typeof fetch);
    const error = await client.listPage("payments").catch((cause) => cause);
    expect(error).toBeInstanceOf(ZeffyRateLimitedError);
    expect(error.retryAfterSeconds).toBe(60);
  });

  it("slows down before the limit when Zeffy says few requests are left", async () => {
    const client = new ZeffyClient(
      CONFIG,
      respond({ data: [], has_more: false }, 200, { "x-ratelimit-remaining": "4" }) as unknown as typeof fetch,
    );
    expect(client.nearLimit()).toBe(false);
    await client.listPage("contacts");
    expect(client.nearLimit()).toBe(true);
  });

  it("reports a rejected key so the connection shows it needs a new key", async () => {
    const client = new ZeffyClient(
      CONFIG,
      respond({ error: { type: "authentication_error", code: "invalid_api_key" } }, 401) as unknown as typeof fetch,
    );
    const error = await client.listPage("campaigns").catch((cause) => cause);
    expect(error).toBeInstanceOf(ZeffyApiError);
    expect(error.message).toBe("Zeffy responded 401 (invalid_api_key).");
    expect(classifyIntegrationFailure(error.message)).toBe("authentication_expired");
  });

  it("reports a timeout or outage as a delay, not a broken connection", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const client = new ZeffyClient(CONFIG, vi.fn().mockRejectedValue(timeout) as unknown as typeof fetch);
    const error = await client.listPage("payments").catch((cause) => cause);
    expect(error.message).toBe("Zeffy request timed out.");
    expect(classifyIntegrationFailure(error.message)).toBe("synchronization_delayed");
    const outage = new ZeffyClient(CONFIG, respond({}, 503) as unknown as typeof fetch);
    const outageError = await outage.listPage("payments").catch((cause) => cause);
    expect(classifyIntegrationFailure(outageError.message)).toBe("synchronization_delayed");
  });

  it("answers null for a payment Zeffy no longer has", async () => {
    const client = new ZeffyClient(
      CONFIG,
      respond({ error: { code: "resource_not_found" } }, 404) as unknown as typeof fetch,
    );
    expect(await client.get("payments", "gone")).toBeNull();
  });

  it("refuses a list that is not shaped like Zeffy's", async () => {
    const client = new ZeffyClient(CONFIG, respond({ items: [] }) as unknown as typeof fetch);
    await expect(client.listPage("payments")).rejects.toThrow("Unexpected Zeffy response for payments.");
  });
});
