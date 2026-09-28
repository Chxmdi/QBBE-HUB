import { describe, expect, it } from "vitest";
import { recipientTranslators } from "@/features/channels/recipient-locale";
import { FakeSupabase, asClient } from "../../../../tests/support/fake-supabase";

describe("notifications are written in each recipient's language", () => {
  it("uses the saved language, and English when none is saved", async () => {
    const db = new FakeSupabase();
    db.seed("user_profile", [
      { id: "fr", locale: "fr-CA" },
      { id: "en", locale: "en" },
      { id: "unset", locale: null },
    ]);
    const tFor = await recipientTranslators(asClient(db), ["fr", "en", "unset", "missing"]);
    const vars = { name: "Ada" };
    expect(tFor("fr")("messages.notifications.mentioned", vars)).toBe("Ada vous a mentionné");
    expect(tFor("en")("messages.notifications.mentioned", vars)).toBe("Ada mentioned you");
    expect(tFor("unset")("messages.notifications.mentioned", vars)).toBe("Ada mentioned you");
    expect(tFor("missing")("messages.notifications.mentioned", vars)).toBe("Ada mentioned you");
  });
});
