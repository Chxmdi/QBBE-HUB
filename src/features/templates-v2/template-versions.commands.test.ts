import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T1 is behind the `wos_pages` switch: with it off, nothing new can be
 * called. Each server action answers "pages are not turned on" before it
 * reads the session, the database or the rate limit.
 */

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const TEMPLATE = "33333333-3333-4333-8333-333333333333";

const flags = new Map<string, boolean>();
const touched = { session: 0, database: 0, rateLimit: 0 };

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/feature-flags", () => ({ isEnabled: async (key: string) => flags.get(key) ?? false }));
vi.mock("@/lib/auth", () => ({
  requireSession: async () => {
    touched.session += 1;
    return { userId: ME, organizationId: ORG, isStaff: true, isAdmin: true };
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: async () => {
    touched.rateLimit += 1;
    return null;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    touched.database += 1;
    throw new Error("the database must not be reached");
  },
}));

const versions = await import("./services/template-versions.commands");
const commands = await import("./services/templates-v2.commands");

const edit = {
  id: TEMPLATE,
  name: { en: "Hub", fr: "Carrefour" },
  description: { en: "", fr: "" },
  title: { en: "Hub", fr: "Carrefour" },
  document: { en: [{ type: "paragraph" }], fr: [{ type: "paragraph" }] },
  milestones: [],
  tasks: [],
};

describe("T1 server actions with the wos_pages switch off [switch off]", () => {
  beforeEach(() => {
    flags.clear();
    flags.set("wos_objects", true);
    flags.set("wos_pages", false);
    touched.session = touched.database = touched.rateLimit = 0;
  });

  it("refuses every new action before the session, rate limit or database", async () => {
    const off = "Pages are not turned on.";
    expect(await versions.templateDetailsV2(TEMPLATE)).toEqual({ ok: false, error: off });
    expect(await versions.updatePageTemplateV2(edit)).toEqual({ ok: false, error: off });
    expect(await versions.duplicateTemplateV2(TEMPLATE)).toEqual({ ok: false, error: off });
    expect(await versions.listHubProgramsV2()).toEqual({ ok: false, error: off });
    expect(
      await commands.applyPageTemplateV2({
        templateId: TEMPLATE,
        parentPageId: null,
        title: "",
        start: "2031-05-01",
        locale: "en",
        variables: {},
        programId: null,
      }),
    ).toEqual({ ok: false, error: off });
    expect(touched).toEqual({ session: 0, database: 0, rateLimit: 0 });
  });

  it("refuses them too when templates themselves are off", async () => {
    flags.set("wos_objects", false);
    flags.set("wos_pages", true);
    expect((await versions.duplicateTemplateV2(TEMPLATE)).ok).toBe(false);
    expect((await versions.updatePageTemplateV2(edit)).ok).toBe(false);
    expect(touched.database).toBe(0);
  });

  it("with the switch on, still refuses bad input before the database", async () => {
    flags.set("wos_pages", true);
    expect(await versions.duplicateTemplateV2("not-an-id")).toEqual({ ok: false, error: "This template is not available." });
    expect(await versions.updatePageTemplateV2({ ...edit, document: { en: [{ nope: 1 }], fr: [] } })).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
    expect(await versions.updatePageTemplateV2({ ...edit, tasks: [{ en: "A", fr: "", due: "", milestone: "" }] })).toEqual({
      ok: false,
      error: "Every task and milestone needs English and French text.",
    });
    expect(touched.database).toBe(0);
  });
});
