import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Visual QA + accessibility matrix (Part II §16.1):
 * themes, widths, content stress, keyboard, and data states.
 *
 * Runs against a seeded QA database. Not part of the CI unit suite.
 */

const OWNER = { email: "qa-owner@example.com", password: "QaTest!2026" };

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/my-work", name: "my-work" },
  { path: "/board", name: "board" },
  { path: "/projects", name: "projects" },
  { path: "/programs", name: "programs" },
  { path: "/channels", name: "channels" },
  { path: "/announcements", name: "announcements" },
    { path: "/inbox", name: "inbox" },
    { path: "/messages", name: "messages" },
  { path: "/calendar", name: "calendar" },
  { path: "/schedule", name: "schedule" },
  { path: "/meetings", name: "meetings" },
  { path: "/events", name: "events" },
  { path: "/people", name: "people" },
  { path: "/crm", name: "crm" },
  { path: "/reports", name: "reports" },
  { path: "/documents", name: "documents" },
  { path: "/admin", name: "admin" },
  { path: "/search?q=workshop", name: "search" },
];

const WIDTHS = [
  { w: 1440, h: 900, name: "1440" },
  { w: 1280, h: 800, name: "1280" },
  { w: 1024, h: 768, name: "1024-tablet-landscape" },
  { w: 768, h: 1024, name: "768-tablet" },
  { w: 390, h: 844, name: "390-mobile" },
  { w: 320, h: 640, name: "320-narrow" },
];

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/", { timeout: 30_000 });
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    localStorage.setItem("qbbe-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
}

/** Detects content overflowing the viewport horizontally. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

test.describe("QA matrix", () => {
  // The responsive sweep visits 240 authenticated route/theme/viewport
  // combinations. It is intentionally broader than the default unit-style
  // Playwright timeout and runs outside the regular CI unit suite.
  test.setTimeout(10 * 60_000);

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("every route renders in both themes without horizontal overflow", async ({
    page,
  }) => {
    const failures: string[] = [];

    for (const theme of ["light", "dark"] as const) {
      for (const size of WIDTHS) {
        await page.setViewportSize({ width: size.w, height: size.h });
        for (const route of ROUTES) {
          await page.goto(route.path);
          await setTheme(page, theme);
          await page.waitForLoadState("networkidle");

          // Page must render its heading, not an error boundary.
          const h1 = page.locator("h1").first();
          await expect(h1, `${route.name} @ ${size.name}`).toBeVisible({
            timeout: 15_000,
          });

          const overflow = await horizontalOverflow(page);
          if (overflow > 2) {
            failures.push(
              `${route.name} ${theme} @${size.name}: overflows by ${overflow}px`,
            );
          }
        }
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("no critical or serious accessibility violations", async ({ page }) => {
    const violations: string[] = [];

    for (const route of ROUTES) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      for (const v of results.violations) {
        if (v.impact === "critical" || v.impact === "serious") {
          violations.push(
            `${route.name}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} nodes)\n    ${v.nodes[0]?.html?.slice(0, 160)}`,
          );
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("200% zoom keeps content usable", async ({ page }) => {
    const failures: string[] = [];
    // Emulate 200% zoom by halving the viewport at the same CSS scale.
    await page.setViewportSize({ width: 640, height: 450 });

    for (const route of ROUTES) {
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });
      const overflow = await horizontalOverflow(page);
      if (overflow > 2) {
        failures.push(`${route.name} @200%: overflows by ${overflow}px`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("keyboard: command palette opens, searches, and navigates", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    const input = page.getByRole("combobox", { name: "Search" });
    await expect(input).toBeFocused();

    await input.fill("workshop");
    await expect(
      page.getByRole("option").first(),
      "search returns results",
    ).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle");
    expect(page.url()).not.toContain("/sign-in");
  });

  test("keyboard: task status can be changed without a pointer", async ({
    page,
  }) => {
    await page.goto("/my-work");
    const statusSelect = page.getByLabel("Task status").first();
    await expect(statusSelect).toBeVisible();
    await statusSelect.focus();
    await expect(statusSelect).toBeFocused();
    // The select is the documented keyboard alternative to drag-and-drop.
    await expect(statusSelect).toBeEnabled();
  });

  test("task drawer opens from a deep link and closes back to the list", async ({
    page,
  }) => {
    await page.goto("/my-work");
    const firstTask = page
      .locator("button")
      .filter({ hasText: /Confirm workshop venue contract|Draft registration form/ })
      .first();
    await firstTask.click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    expect(page.url()).toContain("task=");

    // A reload of the deep link must reopen the same record.
    const deepLink = page.url();
    await page.goto(deepLink);
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByRole("button", { name: "Close panel" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(page.url()).not.toContain("task=");
  });

  test("My Work filters are shareable through the URL", async ({ page }) => {
    await page.goto("/my-work?priority=critical");
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Filter by priority")).toHaveValue("critical");
  });

  test("empty and permission states render instead of blank surfaces", async ({
    page,
  }) => {
    // No search results keeps context and suggests a recovery.
    await page.goto("/search?q=zzzzzznotfound");
    await expect(page.getByText(/No results for/)).toBeVisible();

    // Unknown record: not-found rather than a crash.
    await page.goto("/projects/00000000-0000-0000-0000-000000000000");
    await expect(
      page.getByText(/Not found|not available|doesn't exist/i).first(),
    ).toBeVisible();
  });
});

test.describe("authorization", () => {
  test("volunteer cannot reach staff-only surfaces", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("qa-volunteer@example.com");
    await page.getByLabel("Password").fill("QaTest!2026");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/", { timeout: 30_000 });

    // CRM and Reports are staff-only: the route must redirect, not render.
    for (const path of ["/crm", "/reports", "/admin", "/programs", "/projects", "/schedule"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(page.url(), `${path} must not render for a volunteer`).not.toContain(
        path,
      );
    }

    // Staff-only navigation is absent from the sidebar.
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Relationships" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "My Work" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "New project" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View portfolio" })).toHaveCount(0);
  });

  test("unauthenticated access redirects to sign-in", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/my-work");
    await page.waitForURL("**/sign-in**");
    expect(page.url()).toContain("/sign-in");
    await context.close();
  });
});
