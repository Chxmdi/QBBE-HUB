import { expect, test } from "./fixtures";

/**
 * Netlify adds a "This site is hosted on Netlify" comment right after the
 * charset tag on *.netlify.app addresses. React found it where it expected the
 * theme script and failed hydration (error #418) on every page of staging.
 * The theme script now removes it before React hydrates. These tests serve the
 * real page with the comment added exactly as Netlify adds it.
 */

const NETLIFY_COMMENT =
  "\n<!-- This site is hosted on Netlify. Anyone can build and deploy a site\n     like this one for free: https://netlify.new/\n     Netlify hosting facts for this site: static/SSR served via Netlify Edge. -->\n";

for (const path of ["/sign-in", "/forgot-password"]) {
  test(`a host's comment in <head> does not break the page: ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let injected = false;
    await page.route(`**${path}`, async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const response = await route.fetch();
      const html = await response.text();
      const withComment = html.replace(/(<meta charSet="utf-8"\/>)/i, `$1${NETLIFY_COMMENT}`);
      injected = withComment !== html;
      await route.fulfill({ response, body: withComment });
    });

    await page.goto(path);
    expect(injected, "the comment was added where Netlify adds it").toBe(true);
    await expect(page.getByRole("button").first()).toBeVisible();
    // Hydration errors surface as uncaught page errors once React attaches.
    await page.waitForTimeout(1_000);
    expect(errors).toEqual([]);
    // The comment is gone from <head> before React reads it.
    expect(await page.evaluate(() => [...document.head.childNodes].some((n) => n.nodeType === Node.COMMENT_NODE))).toBe(false);
  });
}
