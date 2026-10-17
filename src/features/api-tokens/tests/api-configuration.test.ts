import { afterEach, describe, expect, it, vi } from "vitest";
import { MissingEnvError } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { apiRoute } from "../services/api-handler";

vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

describe("API initialization failures", () => {
  it("returns a non-cacheable 503 without invoking the handler or leaking configuration", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createSupabaseServiceClient).mockImplementation(() => { throw new MissingEnvError("SUPABASE_SERVICE_ROLE_KEY"); });
    const handler = vi.fn();
    const response = await apiRoute(null, handler)(new Request("https://hub.test/api/v1/me"), { params: Promise.resolve({}) });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "service_unavailable", message: "The API is temporarily unavailable." } });
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("keeps unexpected initialization failures generic", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createSupabaseServiceClient).mockImplementation(() => { throw new Error("sensitive provider detail"); });
    const handler = vi.fn();
    const response = await apiRoute(null, handler)(new Request("https://hub.test/api/v1/me"), { params: Promise.resolve({}) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "internal", message: "Something went wrong." } });
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("sensitive provider detail");
  });
});
