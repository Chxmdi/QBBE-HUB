import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type TableCall } from "@/lib/objects/testing/fake-db";
import { LOCALE_COOKIE } from "@/lib/i18n/config";

const ME = "55555555-5555-4555-8555-555555555555";
let tableCalls: TableCall[] = [];
let signedIn = true;
let answer: () => Answer = () => ({ data: null, error: null });
const jar = { set: vi.fn(), delete: vi.fn() };

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => jar,
  // The served address decides whether the cookie is Secure (src/lib/secure-cookie.ts).
  headers: async () => new Headers({ host: "hub.example.org", "x-forwarded-proto": "https" }),
}));
vi.mock("@/lib/auth", () => ({
  getSessionContext: async () => {
    if (!signedIn) throw new Error("signed out");
    return { userId: ME };
  },
}));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({ table: () => answer() });
    tableCalls = fake.tableCalls;
    return fake.db;
  },
}));

const { setInterfaceLanguage, syncLanguageCookie } = await import("../services/locale.commands");

beforeEach(() => {
  vi.clearAllMocks();
  tableCalls = [];
  signedIn = true;
  answer = () => ({ data: null, error: null });
});

describe("setInterfaceLanguage", () => {
  it("signed in, saves the choice on the profile and in the cookie", async () => {
    expect(await setInterfaceLanguage("fr-CA")).toEqual({ ok: true });
    expect(tableCalls[0]).toMatchObject({ table: "user_profile", action: "update", payload: { locale: "fr-CA" } });
    expect(jar.set).toHaveBeenCalledWith(LOCALE_COOKIE, "fr-CA", expect.objectContaining({ httpOnly: true, sameSite: "lax" }));
  });

  it("'auto' clears both so the browser's language applies again", async () => {
    await setInterfaceLanguage("auto");
    expect(tableCalls[0]?.payload).toEqual({ locale: null });
    expect(jar.delete).toHaveBeenCalledWith(LOCALE_COOKIE);
  });

  it("signed out, sets only the cookie", async () => {
    signedIn = false;
    expect(await setInterfaceLanguage("en")).toEqual({ ok: true });
    expect(tableCalls).toHaveLength(0);
    expect(jar.set).toHaveBeenCalledOnce();
  });

  it("refuses a language the app does not have, and keeps the cookie when the profile save fails", async () => {
    expect((await setInterfaceLanguage("de")).ok).toBe(false);
    answer = () => ({ data: null, error: { message: "down" } });
    expect((await setInterfaceLanguage("fr-CA")).ok).toBe(false);
    expect(jar.set).not.toHaveBeenCalled();
  });
});

describe("syncLanguageCookie", () => {
  it("copies a saved language into the cookie and touches no stored data", async () => {
    expect(await syncLanguageCookie("fr-CA")).toEqual({ ok: true });
    expect(jar.set).toHaveBeenCalledWith(LOCALE_COOKIE, "fr-CA", expect.any(Object));
    expect(tableCalls).toHaveLength(0);
  });

  it("refuses 'auto' and unknown values", async () => {
    expect((await syncLanguageCookie("auto")).ok).toBe(false);
    expect((await syncLanguageCookie("xx")).ok).toBe(false);
    expect(jar.set).not.toHaveBeenCalled();
  });
});
