import { describe, expect, it, vi } from "vitest";
import { fakeDb, type RpcCall } from "@/lib/objects/testing/fake-db";
import { starterAppDefinition } from "../schema";

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const APP = "33333333-3333-4333-8333-333333333333";
const TASK = "11111111-1111-4111-8111-111111111111";

let rpcCalls: RpcCall[] = [];
let canUse = true;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({ requireSession: async () => ({ userId: ME, organizationId: ORG }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/feature-flags", () => ({ isEnabled: async () => true }));
vi.mock("../services/app.queries", () => ({
  getApp: async () => ({
    id: APP,
    slug: "ops",
    definition: {
      ...starterAppDefinition(),
      actions: [{ key: "close", label: { en: "Close", fr: "Fermer" }, actionKey: "task.set_status", capability: "edit_content", screens: [] }],
    },
  }),
  canUseApp: async () => canUse,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({ rpc: () => ({ data: null, error: { message: "unexpected" } }) });
    rpcCalls = fake.rpcCalls;
    return fake.db;
  },
}));

const { runAppAction } = await import("../services/app.commands");

describe("runAppAction", () => {
  it("answers 'not yet' for an action the registry does not hold, without touching the database", async () => {
    canUse = true;
    const result = await runAppAction("ops", "close", [TASK]);
    expect(result.ok).toBe(false);
    expect(rpcCalls).toEqual([]);
  });

  it("refuses before asking the registry when the person lacks the app capability", async () => {
    canUse = false;
    const result = await runAppAction("ops", "close", [TASK]);
    expect(result.ok).toBe(false);
    expect(rpcCalls).toEqual([]);
  });
});
