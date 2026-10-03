import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type TableCall } from "@/lib/objects/testing/fake-db";

/**
 * Refreshing a Gmail token writes with service rights, so no row-level policy
 * stands behind it: the only thing keeping it on the caller's own token is
 * that the connection it updates was found by the caller's own user id.
 */

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const MY_CONNECTION = "77777777-7777-4777-8777-777777777777";
let calls: TableCall[] = [];

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({ requireSession: async () => ({ userId: ME, organizationId: ORG }) }));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getT: async () => createTranslator("en") };
});
vi.mock("@/features/inbox/services/gmail-sync", () => ({
  refreshGoogleAccessToken: async () => ({ access_token: "fresh", expires_in: 3600 }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => {
    const fake = fakeDb({
      table: (call) => {
        if (call.table === "integration_connection") return { data: { id: MY_CONNECTION }, error: null };
        if (call.table === "integration_secret" && call.action === "select")
          return { data: { access_token: "old", refresh_token: "r", token_expires_at: "2000-01-01T00:00:00Z" }, error: null };
        return { data: null, error: null };
      },
    });
    calls = fake.tableCalls;
    return fake.db;
  },
}));

const { getGmailMessageDetail } = await import("@/features/inbox/services/gmail.commands");

afterEach(() => vi.unstubAllGlobals());

describe("Gmail token refresh", () => {
  it("looks the connection up by the caller and updates only that connection's secret", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "m1", payload: {} }), { status: 200 })));
    await getGmailMessageDetail("m1");
    const lookup = calls.find((c) => c.table === "integration_connection");
    expect(lookup?.filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: ME },
        { op: "eq", column: "organization_id", value: ORG },
      ]),
    );
    const update = calls.find((c) => c.table === "integration_secret" && c.action === "update");
    expect(update?.payload).toMatchObject({ access_token: "fresh" });
    expect(update?.filters).toEqual([{ op: "eq", column: "connection_id", value: MY_CONNECTION }]);
  });
});
