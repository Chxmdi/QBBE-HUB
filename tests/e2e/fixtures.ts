import { test as base, expect, type Page } from "@playwright/test";

/**
 * The suite's `test`, which waits for a page to become interactive before
 * handing it back.
 *
 * `page.goto` and `page.reload` resolve on `load`. React hydrates after that,
 * in its own scheduled work, so for a few hundred milliseconds every control on
 * the page is present, visible, enabled — and dead. Playwright's actionability
 * checks are satisfied by exactly the properties that are already true, so a
 * click in that window is dispatched into a page with no handler for it and is
 * simply lost. Nothing reports a problem. The test waits for a result that can
 * no longer arrive and fails somewhere else entirely, usually looking like a
 * broken feature.
 *
 * That is #80, where it cost a CI failure, a re-run that hid the evidence, and
 * a diagnosis that blamed a timeout. It was never a timeout: the measured
 * window here is 229–394ms, and every assertion in the affected file runs in
 * 29–198ms.
 *
 * Waiting once per navigation covers it, because the window opens at the
 * navigation and closes when hydration finishes. Controls that mount *later* —
 * a dialog's contents, a drawer — are outside that by definition, and
 * `clickWhenInteractive` in ./interactive.ts is for those.
 *
 * Import `test` and `expect` from here rather than from `@playwright/test`. A
 * lint rule enforces it, so a new spec cannot quietly go back to the raw one.
 *
 * What it costs, measured on 2026-09-23 by timing the wait itself rather than
 * comparing two runs: 34.1s of an 11.3-minute authenticated pass, over 224
 * navigations — about 5%, averaging 152ms each. The navigation-dense
 * `public-routes.spec.ts` pays more, 19.5s of a 2.0-minute run across three
 * browsers and 285 navigations, because its widths sweep navigates 72 times per
 * browser and never clicks anything. **Zero timeouts in either**, over 509
 * navigations, which is the number that matters: the wait is the time the page
 * genuinely needed, not a stall waiting for a signal that never comes.
 */

/**
 * What "interactive" is judged on. React attaches `__reactFiber$<id>` to every
 * host element it owns, so an element without one is still just markup. When
 * every control on the page has a key, hydration has reached all of them.
 *
 * Checking the whole page rather than the React root matters: `hydrateRoot`
 * attaches the root's key before it hydrates any children, so a root-only check
 * would report success at the exact moment the page is least ready.
 */
const CONTROLS = 'a[href], button, input, select, textarea, [role="button"]';

let warned = false;

async function waitUntilInteractive(page: Page, timeout = 10_000) {
  try {
    await page.waitForFunction(
      (selector: string) => {
        // Judge nothing until the document has finished loading. A navigation
        // that resolves on `commit` hands back an empty DOM, and an empty DOM
        // has no controls to find — which would otherwise read as "everything
        // is hydrated" at the one moment nothing is.
        if (document.readyState !== "complete") return false;
        const nodes = document.querySelectorAll(selector);
        // A loaded page with no controls has nothing to wait for — about:blank,
        // for one, which the sign-out helper navigates to deliberately.
        if (nodes.length === 0) return true;
        for (const node of nodes) {
          if (!Object.keys(node).some((key) => key.startsWith("__reactFiber$"))) {
            return false;
          }
        }
        return true;
      },
      CONTROLS,
      { timeout, polling: 50 },
    );
  } catch {
    // Never fail a navigation over this. If a page genuinely never hydrates,
    // the test that depends on it should fail on its own assertion with its own
    // message, not here on a helper the author did not write. A navigation
    // races its own successor often enough that throwing would add flakiness
    // rather than remove it — which would be a poor way to repay #80.
    if (!warned) {
      warned = true;
      console.log(
        "\n  note: a page did not finish hydrating within 10s, so this run " +
          "may contain the lost-click race described in tests/e2e/fixtures.ts.\n",
      );
    }
  }
}

export const test = base.extend({
  // Playwright calls the second argument `use`; it is passed positionally, so
  // the name is ours to choose. `provide` avoids the React hooks lint rule
  // mistaking a fixture for a hook, which is a truer fix than switching the
  // rule off for the whole directory.
  page: async ({ page }, provide) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);

    // The app's own navigations still in flight: router.refresh() after a
    // dialog closes, a router.push after a create. Next fetches those as React
    // Server Component payloads (an `RSC: 1` request header). A test that
    // navigates while one is pending races it, and the loser is aborted —
    // NS_BINDING_ABORTED in Firefox, "WebKit encountered an internal error" in
    // WebKit, while Chromium lets the test's navigation win. That was every
    // Firefox and WebKit failure in the first nightly run (#114): the product
    // was fine, the harness started a second navigation on top of the first.
    const pending = new Set<import("@playwright/test").Request>();
    const isAppNavigation = (request: import("@playwright/test").Request) =>
      request.headers()["rsc"] === "1" || request.url().includes("_rsc=");
    page.on("request", (request) => {
      if (isAppNavigation(request)) pending.add(request);
    });
    page.on("requestfinished", (request) => pending.delete(request));
    page.on("requestfailed", (request) => pending.delete(request));

    const settle = async () => {
      const deadline = Date.now() + 10_000;
      while (pending.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };

    page.goto = async (url, options) => {
      await settle();
      const response = await goto(url, options);
      await waitUntilInteractive(page);
      return response;
    };

    page.reload = async (options) => {
      await settle();
      const response = await reload(options);
      await waitUntilInteractive(page);
      return response;
    };

    await provide(page);
  },
});

export { expect };
export type { Browser, Locator, Page, Request, Response } from "@playwright/test";
