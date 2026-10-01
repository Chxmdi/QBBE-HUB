import { expect, test } from "./fixtures";
import { signIn } from "./auth";

/**
 * Hardening (epic #18): the route handlers that act on the session cookie
 * answer only the Hub's own pages. A page on another site cannot make a
 * signed-in browser bulk-edit, undo or sign out (cross-site request forgery);
 * the Hub's own pages still can. Server Actions get this from Next.js; these
 * routes get it from `isSameOriginRequest`.
 */

const CROSS = { "sec-fetch-site": "cross-site", origin: "https://evil.example" };
const SAME = { "sec-fetch-site": "same-origin" };
const UNDO = "/api/objects/change-sets/00000000-0000-4000-8000-000000000000/undo";

test("bulk edit and undo refuse a cross-site post and answer their own pages [switches on]", async ({ page }) => {
  await signIn(page, "staff");

  const bulkCross = await page.request.post("/api/objects/bulk-edit", { headers: CROSS, data: {} });
  expect(bulkCross.status()).toBe(403);
  expect(await bulkCross.json()).toEqual({ error: "cross_site" });
  const bulkSame = await page.request.post("/api/objects/bulk-edit", { headers: SAME, data: {} });
  expect(bulkSame.status(), "the handler read the (empty) body").toBe(400);

  const undoCross = await page.request.post(UNDO, { headers: CROSS });
  expect(undoCross.status()).toBe(403);
  const undoSame = await page.request.post(UNDO, { headers: SAME });
  expect([403, 404, 422], "the handler looked the change set up").toContain(undoSame.status());
});

test("a cross-site sign-out leaves the session in place; the Hub's own sign-out ends it", async ({ page, baseURL }) => {
  await signIn(page, "staff");

  const cross = await page.request.post("/auth/sign-out", { headers: CROSS, maxRedirects: 0 });
  expect(cross.status()).toBe(403);
  await page.goto("/");
  await expect(page).not.toHaveURL(/sign-in/);

  const same = await page.request.post("/auth/sign-out", { headers: SAME, maxRedirects: 0 });
  expect(same.status()).toBe(302);
  expect(same.headers()["location"]).toBe(new URL("/sign-in", baseURL).toString());
  await page.goto("/");
  await expect(page).toHaveURL(/sign-in/);
});
