import { describe, expect, it } from "vitest";
import { PAGE_SIZE, fetchAllPages } from "@/lib/supabase/fetch-all-pages";

/**
 * DATA-003. PostgREST returns at most `max_rows` rows per request
 * (supabase/config.toml: 1000) and says nothing when it cuts a result short.
 * These fakes behave the same way, so a reader that trusts one request is
 * caught here before it ships an incomplete ledger.
 */
function cappedSource(total: number, serverCap = 1000) {
  const rows = Array.from({ length: total }, (_, i) => ({ n: i }));
  const requests: [number, number][] = [];
  const page = async (from: number, to: number) => {
    requests.push([from, to]);
    const end = Math.min(to + 1, from + serverCap, rows.length);
    return { data: rows.slice(from, Math.max(from, end)), error: null };
  };
  return { page, requests };
}

describe("fetchAllPages", () => {
  it("reads every row past the server's 1,000-row cap", async () => {
    const { page } = cappedSource(1500);
    const result = await fetchAllPages(page, 50_000);
    expect(result.error).toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(1500);
    expect(result.rows.map((r) => r.n)).toEqual(Array.from({ length: 1500 }, (_, i) => i));
  });

  it("asks for pages of PAGE_SIZE rows", async () => {
    const { page, requests } = cappedSource(2500);
    await fetchAllPages(page, 50_000);
    expect(PAGE_SIZE).toBe(1000);
    expect(requests.slice(0, 3)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("still reads everything when the server caps below the page size", async () => {
    const { page } = cappedSource(1234, 300);
    const result = await fetchAllPages(page, 50_000);
    expect(result.rows).toHaveLength(1234);
    expect(new Set(result.rows.map((r) => r.n)).size).toBe(1234);
    expect(result.truncated).toBe(false);
  });

  it("stops at the ceiling and says the result is incomplete", async () => {
    const { page } = cappedSource(1500);
    const result = await fetchAllPages(page, 1000);
    expect(result.rows).toHaveLength(1000);
    expect(result.truncated).toBe(true);
  });

  it("does not call a result of exactly the ceiling incomplete", async () => {
    const { page } = cappedSource(1000);
    const result = await fetchAllPages(page, 1000);
    expect(result.rows).toHaveLength(1000);
    expect(result.truncated).toBe(false);
  });

  it("returns nothing and no error for an empty result", async () => {
    const { page } = cappedSource(0);
    const result = await fetchAllPages(page, 1000);
    expect(result).toEqual({ rows: [], error: null, truncated: false });
  });

  it("passes the first error through with its code", async () => {
    let calls = 0;
    const result = await fetchAllPages<{ n: number }>(async () => {
      calls += 1;
      if (calls === 1) return { data: Array.from({ length: 1000 }, (_, n) => ({ n })), error: null };
      return { data: null, error: { message: "denied", code: "42501" } };
    }, 50_000);
    expect(result.error).toEqual({ message: "denied", code: "42501" });
    expect(result.truncated).toBe(false);
  });

  it("refuses a ceiling below one", async () => {
    const { page } = cappedSource(10);
    await expect(fetchAllPages(page, 0)).rejects.toThrow();
  });
});
