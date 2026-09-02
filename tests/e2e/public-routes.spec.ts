import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * QA for the routes that render without a database round-trip. Runs in any
 * environment; the authenticated matrix in qa-matrix.spec.ts additionally
 * needs network access to the Supabase project.
 */

const ROUTES = [
  { path: "/sign-in", name: "sign-in" },
  { path: "/sign-up", name: "sign-up" },
];

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
        const submit = page.getByRole("button", { name: /Sign in|Create account/ });
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

test("sign-in is fully keyboard operable", async ({ page }) => {
  await page.goto("/sign-in");

  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.type("someone@example.com");

  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.type("placeholder");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();

  // Focus must be visibly indicated, never removed for aesthetics.
  const outline = await page
    .getByRole("button", { name: "Sign in" })
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
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

test("protected routes redirect unauthenticated visitors", async ({ page }) => {
  for (const path of [
    "/",
    "/my-work",
    "/admin",
    "/admin/jobs",
    "/admin/email",
    "/settings/notifications",
    "/crm",
  ]) {
    await page.goto(path);
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
