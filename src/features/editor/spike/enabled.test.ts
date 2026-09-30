import { describe, expect, it } from "vitest";
import { editorSpikesEnabled } from "./enabled";

describe("editorSpikesEnabled", () => {
  it("serves the spike on a development server", () => {
    expect(editorSpikesEnabled({ NODE_ENV: "development" })).toBe(true);
  });

  it("hides the spike in a production build by default", () => {
    expect(
      editorSpikesEnabled({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }),
    ).toBe(false);
  });

  it("serves a production build only when opted in against a loopback Supabase", () => {
    expect(
      editorSpikesEnabled({
        NODE_ENV: "production",
        ENABLE_DEV_SPIKES: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toBe(true);
    expect(
      editorSpikesEnabled({
        NODE_ENV: "production",
        ENABLE_DEV_SPIKES: "1",
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      }),
    ).toBe(true);
  });

  it("never serves a production build pointed at a hosted Supabase, even when opted in", () => {
    for (const url of ["https://abc.supabase.co", "https://127.0.0.1.evil.example", "not a url", undefined]) {
      expect(
        editorSpikesEnabled({ NODE_ENV: "production", ENABLE_DEV_SPIKES: "1", NEXT_PUBLIC_SUPABASE_URL: url }),
      ).toBe(false);
    }
  });
});
