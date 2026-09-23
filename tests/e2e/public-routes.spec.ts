import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { clickWhenInteractive } from "./interactive";

/**
 * QA for the routes that render without a database round-trip. Runs in any
 * environment; the authenticated matrix in qa-matrix.spec.ts additionally
 * needs network access to the Supabase project.
 *
 * Every assertion here was timed on 2026-09-23 for #80, against the default 5s
 * expect budget. Nothing in the file is close to it: across 36 route, theme and
 * width combinations the `h1` check takes 36-144ms in Firefox, 36-198ms in
 * WebKit and 29-71ms in Chromium, and the submit-button check is faster again.
 * The two tests that submit a form are the only ones that depend on client-side
 * JavaScript at all, and they use `clickWhenInteractive` for the reason given
 * there. No timeout in this file is a margin against slowness.
 */

const ROUTES = [
  { path: "/sign-in", name: "sign-in" },
  { path: "/sign-up", name: "sign-up" },
  { path: "/forgot-password", name: "forgot-password" },
];

test("recovery requests give an account-neutral confirmation", async ({ page }) => {
  await page.route("**/auth/v1/recover**", async route => {
    expect(route.request().postDataJSON().email).toBe("person@example.com");
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill("person@example.com");
  await clickWhenInteractive(page.getByRole("button", { name: "Send recovery link" }));
  await expect(page.getByRole("status")).toContainText("If this address belongs to an account");
});

/**
 * This is the check that was reported flaky in Firefox (#80). It was not a
 * timing margin — the submit click was being lost before React hydrated the
 * form, and no request was ever sent. `clickWhenInteractive` waits for the
 * condition that was actually missing.
 */
test("recovery failures leave a retryable form", async ({ page }) => {
  await page.route("**/auth/v1/recover**", route => route.fulfill({
    status: 429, contentType: "application/json", body: JSON.stringify({ msg: "Rate limited" }),
  }));
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill("person@example.com");
  await clickWhenInteractive(page.getByRole("button", { name: "Send recovery link" }));
  await expect(page.getByRole("main").getByRole("alert")).toContainText("try again");
  await expect(page.getByRole("button", { name: "Send recovery link" })).toBeEnabled();
});

const WIDTHS = [
  { w: 1440, h: 900, name: "1440" },
  { w: 1280, h: 800, name: "1280" },
  { w: 1024, h: 768, name: "1024" },
  { w: 768, h: 1024, name: "768" },
  { w: 390, h: 844, name: "390" },
  { w: 320, h: 640, name: "320" },
];

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    localStorage.setItem("qbbe-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

test("auth routes render at every width in both themes", async ({ page }) => {
  const failures: string[] = [];

  for (const theme of ["light", "dark"] as const) {
    for (const size of WIDTHS) {
      await page.setViewportSize({ width: size.w, height: size.h });
      for (const route of ROUTES) {
        await page.goto(route.path);
        await setTheme(page, theme);
        await page.reload();
        await expect(page.locator("h1")).toBeVisible();

        const overflow = await horizontalOverflow(page);
        if (overflow > 2) {
          failures.push(
            `${route.name} ${theme} @${size.name}: overflows ${overflow}px`,
          );
        }

        // The submit control must stay reachable at every width.
        const submit = page.getByRole("button", { name: /Sign in|Create account|Send recovery link/ });
        await expect(submit, `${route.name} @${size.name}`).toBeVisible();
        const box = await submit.boundingBox();
        if (box && box.height < 36) {
          failures.push(
            `${route.name} @${size.name}: submit target only ${box.height}px tall`,
          );
        }
      }
    }
  }

  expect(failures, failures.join("\n")).toEqual([]);
});

test("auth routes have no critical or serious a11y violations", async ({
  page,
}) => {
  const violations: string[] = [];

  for (const theme of ["light", "dark"] as const) {
    for (const route of ROUTES) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(route.path);
      await setTheme(page, theme);
      await page.reload();

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
        .analyze();

      for (const v of results.violations) {
        if (v.impact === "critical" || v.impact === "serious") {
          violations.push(
            `${route.name} (${theme}): [${v.impact}] ${v.id} — ${v.help}\n    ${v.nodes[0]?.html?.slice(0, 200)}`,
          );
        }
      }
    }
  }

  expect(violations, violations.join("\n")).toEqual([]);
});

/**
 * Describes where focus currently sits. Browser chrome and the document
 * itself come back as "" so the caller can ignore them: they are not page
 * content and each engine treats them differently.
 */
async function focusedDescriptor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return "";
    return el.id || `${el.tagName.toLowerCase()}:${el.textContent?.trim() ?? ""}`;
  });
}

/** The page elements Tab visits, in order, with repeats and chrome removed. */
async function tabOrder(page: Page, presses: number): Promise<string[]> {
  const stops: string[] = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    const stop = await focusedDescriptor(page);
    if (stop && stop !== stops[stops.length - 1]) stops.push(stop);
  }
  return stops;
}

/**
 * Tabs forward until `target` holds focus. Engines disagree on how many
 * presses it takes to enter the document — WebKit spends one on the body
 * first — so the count is not something a test can hard-code.
 */
async function tabTo(page: Page, target: Locator, limit = 6): Promise<void> {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`focus never reached the target within ${limit} Tab presses`);
}

test("sign-in is fully keyboard operable", async ({ page }) => {
  await page.goto("/sign-in");

  // What matters for WCAG 2.4.3 is the order focus moves through the form and
  // that nothing intercepts it on the way in — not how many keystrokes each
  // engine spends getting there. WebKit burns the first Tab on the document
  // body and omits links from the tab ring entirely (its default is form
  // controls only); both are browser preferences, not properties of this page.
  const stops = await tabOrder(page, 6);
  expect(stops.slice(0, 3)).toEqual(["email", "password", "button:Sign in"]);

  // Every field must accept typed input in the order the keyboard reaches it.
  await page.reload();
  await tabTo(page, page.getByLabel("Email"));
  await page.keyboard.type("someone@example.com");

  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.type("placeholder");

  await expect(page.getByLabel("Email")).toHaveValue("someone@example.com");
  await expect(page.getByLabel("Password")).toHaveValue("placeholder");

  await page.keyboard.press("Tab");
  const submit = page.getByRole("button", { name: "Sign in" });
  await expect(submit).toBeFocused();

  // Focus must be visibly indicated, never removed for aesthetics.
  const outline = await submit.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");

  // The recovery and sign-up links sit outside WebKit's default tab ring, so
  // assert they stay reachable the way assistive technology reaches them
  // rather than asserting they are tab stops.
  const links = await page.getByRole("link").all();
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    const reachable = await link.evaluate((el) => {
      (el as HTMLElement).focus();
      return {
        tabIndex: (el as HTMLElement).tabIndex,
        focused: document.activeElement === el,
      };
    });
    expect(reachable).toEqual({ tabIndex: 0, focused: true });
  }
});

test("the job endpoint refuses anyone without the shared secret", async ({
  request,
}) => {
  // No secret at all, and a wrong one. Both are refused before the handler is
  // looked up, so this holds with no database behind it.
  const attempts: Record<string, string>[] = [{}, { "x-job-secret": "not-the-secret" }];
  for (const headers of attempts) {
    const response = await request.post("/api/jobs/drain-notifications", {
      headers,
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(403);
  }

  // GET is not a method this route implements, so it cannot be triggered by a
  // crawler or a link prefetch.
  const get = await request.get("/api/jobs/drain-notifications", {
    failOnStatusCode: false,
  });
  expect(get.status()).toBe(405);
});

test("protected routes redirect unauthenticated visitors", async ({ page, browserName }) => {
  for (const path of [
    "/",
    "/my-work",
    "/admin",
    "/admin/jobs",
    "/admin/email",
    "/settings/notifications",
    "/crm",
  ]) {
    try {
      await page.goto(path);
    } catch (error) {
      const isWebkitInternalError = browserName === "webkit"
        && error instanceof Error
        && error.message.includes("WebKit encountered an internal error");
      if (!isWebkitInternalError) throw error;
      await page.goto(path);
    }
    // 15s, against a measured 0.87-1.4s for all seven paths together on CI.
    // These redirects are middleware decisions with no client JavaScript in
    // them, so the margin is for a loaded runner, not for slow hydration.
    await page.waitForURL("**/sign-in**", { timeout: 15_000 });
    expect(page.url()).toContain("/sign-in");
  }
});

test("reduced motion is honoured", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/sign-in");
  const duration = await page
    .getByRole("button", { name: "Sign in" })
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  // Global reduced-motion rule collapses transitions to ~0.01ms.
  expect(parseFloat(duration)).toBeLessThan(0.05);
  await context.close();
});
