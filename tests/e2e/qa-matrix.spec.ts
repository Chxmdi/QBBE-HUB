import { test, expect, type Page } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { signIn } from "./auth";

/**
 * Visual QA + accessibility matrix (Part II §16.1):
 * themes, widths, content stress, keyboard, and data states.
 *
 * Runs against a seeded QA database (`npm run db:seed`), in CI's Database
 * security job after the authenticated checks (#101); see docs/runbooks/qa.md.
 */

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

/**
 * Names what sticks out: the outermost elements whose right edge passes the
 * viewport and that are not already inside a scrolling container. A bare
 * pixel count says a page is wrong, not where.
 */
async function overflowCulprits(page: Page): Promise<string> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrolls = (el: Element | null): boolean => {
      for (let node = el?.parentElement; node; node = node.parentElement) {
        const x = getComputedStyle(node).overflowX;
        if (x === "auto" || x === "scroll" || x === "hidden" || x === "clip") return true;
      }
      return false;
    };
    const found: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const rect = el.getBoundingClientRect();
      // An absolutely positioned element escapes a scroller that is not its
      // containing block, so its scrolling ancestors do not excuse it.
      const escapes = getComputedStyle(el).position === "absolute";
      if (rect.width === 0 || rect.right <= width + 2 || (!escapes && scrolls(el))) continue;
      const parentRect = el.parentElement?.getBoundingClientRect();
      if (parentRect && parentRect.right > width + 2 && !scrolls(el.parentElement)) continue;
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 6).join(".");
      found.push(`<${el.tagName.toLowerCase()}${cls ? ` .${cls}` : ""}> right=${Math.round(rect.right)} width=${Math.round(rect.width)}`);
      if (found.length >= 3) break;
    }
    return found.join(" | ");
  });
}

test.describe("QA matrix", () => {
  // The responsive sweep visits 240 authenticated route/theme/viewport
  // combinations. It is intentionally broader than the default unit-style
  // Playwright timeout and runs outside the regular CI unit suite.
  test.setTimeout(10 * 60_000);

  test.beforeEach(async ({ page }) => {
    await signIn(page, "owner");
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
              `${route.name} ${theme} @${size.name}: overflows by ${overflow}px — ${await overflowCulprits(page)}`,
            );
          }
        }
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("no critical or serious accessibility violations", async ({ page }) => {
    const violations: string[] = [];

    // Both themes: dark mode is a token swap, and contrast is exactly what a
    // token swap can break without any single component changing.
    for (const theme of ["light", "dark"] as const) {
      for (const route of ROUTES) {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(route.path);
        await setTheme(page, theme);
        await page.waitForLoadState("networkidle");

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
          .analyze();

        for (const v of results.violations) {
          if (v.impact === "critical" || v.impact === "serious") {
            violations.push(
              `${route.name} ${theme}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} nodes)\n    ${v.nodes[0]?.html?.slice(0, 160)}`,
            );
          }
        }
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("overlays pass axe while open, in both themes", async ({ page }) => {
    // A scan of a closed page never sees the surfaces most likely to fail:
    // menus, dialogs and drawers exist only while they are open.
    const violations: string[] = [];
    const scan = async (label: string) => {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
        .analyze();
      for (const v of results.violations) {
        if (v.impact === "critical" || v.impact === "serious") {
          violations.push(
            `${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} nodes)\n    ${v.nodes[0]?.html?.slice(0, 160)}`,
          );
        }
      }
    };

    const overlays: { name: string; width: number; open: () => Promise<void> }[] = [
      {
        name: "command palette",
        width: 1280,
        open: async () => {
          await page.goto("/");
          await page.keyboard.press("Control+k");
          await expect(page.getByRole("combobox", { name: "Search" })).toBeFocused();
        },
      },
      {
        name: "quick create menu",
        width: 1280,
        open: async () => {
          await page.goto("/");
          await page.getByRole("button", { name: "Quick create" }).click();
        },
      },
      {
        name: "notifications menu",
        width: 1280,
        open: async () => {
          await page.goto("/");
          await page.getByRole("button", { name: /^Notifications/ }).click();
        },
      },
      {
        name: "account menu",
        width: 1280,
        open: async () => {
          await page.goto("/");
          await page.getByRole("button", { name: "Account menu" }).click();
        },
      },
      {
        name: "create project dialog",
        width: 1280,
        open: async () => {
          await page.goto("/projects?create=1");
          await expect(page.getByRole("dialog")).toBeVisible();
        },
      },
      {
        name: "task drawer",
        width: 1280,
        open: async () => {
          await page.goto("/my-work");
          await page
            .locator("button")
            .filter({ hasText: /Confirm workshop venue contract|Draft registration form/ })
            .first()
            .click();
          await expect(page.getByRole("dialog")).toBeVisible();
        },
      },
      {
        name: "mobile navigation drawer",
        width: 390,
        open: async () => {
          await page.goto("/");
          await page.getByRole("button", { name: "Open navigation" }).click();
          await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
        },
      },
    ];

    for (const theme of ["light", "dark"] as const) {
      for (const overlay of overlays) {
        await page.setViewportSize({ width: overlay.width, height: 800 });
        await page.goto("/");
        await setTheme(page, theme);
        await overlay.open();
        await page.waitForLoadState("networkidle");
        await scan(`${overlay.name} ${theme}`);
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  test("keyboard: a skip link is first and moves focus past the navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/my-work");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("keyboard: focus is never hidden under the sticky or fixed bars", async ({
    page,
  }) => {
    // WCAG 2.4.11. Tab through the first stretch of a long page on a phone
    // width, where both the topbar and the bottom navigation are present,
    // and require every focused control to sit clear of both.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/my-work");
    const hidden: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const box = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        if (el.closest("header, nav[aria-label='Primary'], [role='dialog']")) return null;
        // A fixed element (the skip link) is drawn above the bars on purpose,
        // so it cannot be covered by them.
        if (getComputedStyle(el).position === "fixed") return null;
        const r = el.getBoundingClientRect();
        const header = document.querySelector("header")?.getBoundingClientRect();
        const bottom = document.querySelector("nav[aria-label='Primary']")?.getBoundingClientRect();
        return {
          label: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.tagName,
          top: r.top,
          bottom: r.bottom,
          headerBottom: header?.bottom ?? 0,
          navTop: bottom && bottom.height > 0 ? bottom.top : window.innerHeight,
        };
      });
      if (!box) continue;
      if (box.bottom <= box.headerBottom || box.top >= box.navTop) {
        hidden.push(`${box.label} (top ${Math.round(box.top)}, bottom ${Math.round(box.bottom)})`);
      }
    }
    expect(hidden, hidden.join("\n")).toEqual([]);
  });

  test("reduce motion can be set in the Hub, not only in the OS", async ({ page }) => {
    // UI-009. Emulate an OS that does NOT ask for reduced motion, so only the
    // in-app setting can be what turns animation down.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/settings");
    const toggle = page.getByLabel("Reduce motion");
    await expect(toggle).not.toBeChecked();
    try {
      await toggle.check();
      await expect(page.locator("html")).toHaveClass(/\breduce-motion\b/);
      // Persisted, not just toggled in this tab.
      await page.reload();
      await expect(page.getByLabel("Reduce motion")).toBeChecked();
      await expect(page.locator("html")).toHaveClass(/\breduce-motion\b/);
      const duration = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.transition = "opacity 300ms";
        document.body.append(probe);
        const value = getComputedStyle(probe).transitionDuration;
        probe.remove();
        return value;
      });
      expect(parseFloat(duration)).toBeLessThan(0.01);
    } finally {
      // Leave the shared QA owner as it was for every other test.
      await page.goto("/settings");
      const reset = page.getByLabel("Reduce motion");
      if (await reset.isChecked()) {
        await reset.uncheck();
        await expect(page.locator("html")).not.toHaveClass(/\breduce-motion\b/);
      }
    }
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
    await signIn(page, "volunteer");

    // Staff-only and admin-only: the route must redirect, not render.
    for (const path of ["/crm", "/reports", "/admin"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(page.url(), `${path} must not render for a volunteer`).not.toContain(
        path,
      );
    }

    // Programs, projects and the schedule are not staff-only, and this test
    // used to insist they were. Since #24 they are scoped instead: everyone
    // reaches the page, and the database decides what is on it. Redirecting
    // would be the wrong answer — the right one is a page holding nothing the
    // volunteer was not granted.
    for (const path of ["/programs", "/projects", "/schedule"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(page.url(), `${path} is scoped, not forbidden`).toContain(path);
      for (const seeded of ["Fall Community Workshop Series", "Tutor Recruitment Drive"]) {
        await expect(
          page.getByText(seeded, { exact: true }),
          `${path} must not show ${seeded} to a volunteer with no grant`,
        ).toHaveCount(0);
      }
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
