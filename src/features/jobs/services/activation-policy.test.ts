import { describe, expect, it } from "vitest";
import { isJobAllowedOnHost } from "./activation-policy";

describe("host-local job activation", () => {
  it("retains existing behavior when unset", () => {
    expect(isJobAllowedOnHost("scan-documents")).toBe(true);
  });
  it("blocks all when explicitly empty", () => {
    expect(isJobAllowedOnHost("scan-documents", " ")).toBe(false);
  });
  it("permits only exact names", () => {
    const allowlist = "scan-documents, scan-receipts";
    expect(isJobAllowedOnHost("scan-documents", allowlist)).toBe(true);
    expect(isJobAllowedOnHost("scan-receipts", allowlist)).toBe(true);
    expect(isJobAllowedOnHost("apply-retention", allowlist)).toBe(false);
    expect(isJobAllowedOnHost("scan", allowlist)).toBe(false);
    expect(isJobAllowedOnHost("apply-retention", "*")).toBe(false);
  });
});
