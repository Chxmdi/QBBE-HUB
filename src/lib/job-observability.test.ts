import { describe, expect, it } from "vitest";
import { sanitizeJobError } from "@/lib/job-observability";

describe("job observability", () => {
  it("redacts OAuth credentials before they enter the execution ledger", () => {
    expect(sanitizeJobError("Provider failed: Bearer secret-value access_token=abc&refresh_token=def"))
      .toBe("Provider failed: Bearer [redacted] access_token=[redacted]&refresh_token=[redacted]");
  });

  it("bounds retained error detail", () => {
    expect(sanitizeJobError("x".repeat(1200))?.length).toBe(1000);
  });
});
