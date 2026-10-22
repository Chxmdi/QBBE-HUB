import { expect, it } from "vitest";
import { IN_APP_LINK_PATTERN, inAppLink, safeRedirectPath } from "@/lib/safe-redirect";

it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/%5cevil.example", "/%0a/evil.example", "%", null])("rejects unsafe navigation %s", path => {
  expect(safeRedirectPath(path)).toBe("/");
});
// The URL parser removes dot segments, so these only become "//host" after
// parsing; the parsed result is what the router receives.
it.each(["/.//evil.example", "/%2e%2e//evil.example", "/a/../..//evil.example", "/./%2e/.//evil.example/phish"])(
  "rejects input that normalizes to another host %s",
  path => {
    expect(safeRedirectPath(path)).toBe("/");
  },
);
it("preserves internal query and comment context", () => {
  expect(safeRedirectPath("/my-work?task=123#comment-456")).toBe("/my-work?task=123#comment-456");
  expect(safeRedirectPath("/reset-password")).toBe("/reset-password");
  expect(safeRedirectPath("/requests?request=1&tab=a")).toBe("/requests?request=1&tab=a");
});

it("keeps a notification link only when it is already a plain in-app path", () => {
  expect(inAppLink("/my-work?task=1&comment=2")).toBe("/my-work?task=1&comment=2");
  expect(inAppLink("/announcements#a1")).toBe("/announcements#a1");
  expect(inAppLink(null)).toBeNull();
  expect(inAppLink("")).toBeNull();
});
it.each(["https://evil.example/login", "//evil.example", "/.//evil.example", "/\\evil.example", "javascript:alert(1)", "/a b"])(
  "drops an unsafe notification link %s",
  link => {
    expect(inAppLink(link)).toBeNull();
    expect(inAppLink(link, "/inbox")).toBe("/inbox");
  },
);

it("accepts every link the app writes and refuses unsafe ones, like the database constraint", () => {
  for (const link of ["/", "/my-work?task=1&comment=2", "/pages/p?block=b%20c#comment-1", "/announcements#a", "/channels/c?thread=t"]) {
    expect(IN_APP_LINK_PATTERN.test(link)).toBe(true);
  }
  for (const link of ["//evil.example", "/\\evil", "https://evil.example", "/a b", '/"><a', "javascript:x"]) {
    expect(IN_APP_LINK_PATTERN.test(link)).toBe(false);
  }
});
