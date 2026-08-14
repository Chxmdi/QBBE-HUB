import { describe, expect, it } from "vitest";
import { parseSentryDsn } from "@/lib/observability";

describe("parseSentryDsn", () => {
  it("extracts host, key, and project from a Sentry DSN", () => {
    expect(parseSentryDsn("https://abc123@o1.ingest.sentry.io/450")).toEqual({
      protocol: "https",
      key: "abc123",
      host: "o1.ingest.sentry.io",
      projectId: "450",
    });
    expect(parseSentryDsn("not-a-dsn")).toBeNull();
  });
});
