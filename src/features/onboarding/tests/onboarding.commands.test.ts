import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type TableCall } from "@/lib/objects/testing/fake-db";

const ME = "55555555-5555-4555-8555-555555555555";
let tableCalls: TableCall[] = [];
let answer: () => Answer = () => ({ data: null, error: null });

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({ requireSession: async () => ({ userId: ME }) }));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getT: async () => createTranslator("en") };
});
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({ table: () => answer() });
    tableCalls = fake.tableCalls;
    return fake.db;
  },
}));

const { saveOnboardingProfile, completeOnboarding, setReduceMotion, setDisplayDensity } = await import(
  "../services/onboarding.commands"
);

const profileUpdate = () => tableCalls.find((c) => c.table === "user_profile" && c.action === "update");

beforeEach(() => {
  tableCalls = [];
  answer = () => ({ data: null, error: null });
});

describe("saveOnboardingProfile", () => {
  it("saves the person's own profile, blanks becoming empty", async () => {
    expect(await saveOnboardingProfile({ fullName: " Ada Lovelace ", title: "", timezone: "America/Toronto" })).toEqual({ ok: true });
    expect(profileUpdate()).toMatchObject({
      payload: { full_name: "Ada Lovelace", title: null, timezone: "America/Toronto" },
      filters: [{ op: "eq", column: "id", value: ME }],
    });
  });

  it("refuses a missing name and a time zone that does not exist", async () => {
    expect((await saveOnboardingProfile({ fullName: "  " })).ok).toBe(false);
    expect((await saveOnboardingProfile({ fullName: "Ada", timezone: "Mars/Olympus" })).ok).toBe(false);
    expect(profileUpdate()).toBeUndefined();
  });

  it("reports a refused save", async () => {
    answer = () => ({ data: null, error: { message: "rls" } });
    expect((await saveOnboardingProfile({ fullName: "Ada" })).ok).toBe(false);
  });
});

describe("completeOnboarding and display settings", () => {
  it("marks onboarding complete with a timestamp", async () => {
    expect(await completeOnboarding()).toEqual({ ok: true });
    expect((profileUpdate()?.payload as { onboarded_at: string }).onboarded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("stores reduced motion only as true or false", async () => {
    expect(await setReduceMotion(true)).toEqual({ ok: true });
    expect(profileUpdate()?.payload).toEqual({ reduce_motion: true });
    tableCalls = [];
    expect((await setReduceMotion("yes")).ok).toBe(false);
    expect(profileUpdate()).toBeUndefined();
  });

  it("stores only a known density", async () => {
    expect(await setDisplayDensity("compact")).toEqual({ ok: true });
    expect(profileUpdate()?.payload).toEqual({ display_density: "compact" });
    tableCalls = [];
    expect((await setDisplayDensity("tiny")).ok).toBe(false);
    expect(profileUpdate()).toBeUndefined();
  });
});
