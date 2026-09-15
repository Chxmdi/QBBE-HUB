import { expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/%5cevil.example", "/%0a/evil.example", "%", null])("rejects unsafe navigation %s", path => {
  expect(safeRedirectPath(path)).toBe("/");
});
it("preserves internal query and comment context", () => {
  expect(safeRedirectPath("/my-work?task=123#comment-456")).toBe("/my-work?task=123#comment-456");
  expect(safeRedirectPath("/reset-password")).toBe("/reset-password");
});
