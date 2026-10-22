import { describe, expect, it } from "vitest";
import { triggerEventLabel } from "@/features/admin/labels";
import { createTranslator } from "@/lib/i18n/translate";

/**
 * Every trigger the workflow runtime writes has a label in both languages.
 * "object_event" (Workspace OS automations) had none, so Admin showed the
 * raw code, in English, on the French screen (#390).
 */
describe("workflow trigger labels", () => {
  it("names object_event in both languages", () => {
    const en = triggerEventLabel("object_event", createTranslator("en"));
    const fr = triggerEventLabel("object_event", createTranslator("fr-CA"));
    expect(en).not.toBe("object event");
    expect(fr).not.toBe("object event");
    expect(fr).not.toBe(en);
  });
});
