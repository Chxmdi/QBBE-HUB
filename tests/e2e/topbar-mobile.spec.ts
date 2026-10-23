import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";

/**
 * The top bar on a phone, from the keyboard, in both languages (UX-004,
 * A11Y-007, A11Y-003 part).
 *
 * The notifications and quick-create panels were anchored to their buttons'
 * right edge with a fixed width, so on a narrow screen they ran off the left
 * side of the page. The account button showed its initials but was named only
 * "Account menu", so the visible text was not in its spoken name. The command
 * palette's placeholder was too faint, and its active result was marked by a
 * tint barely distinguishable from the white around it.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const LANGS = {
  en: { create: "Quick create", account: "Account menu", palette: "Search tasks, projects, people, documents, risks…" },
  fr: { create: "Création rapide", account: "Menu du compte", palette: "Rechercher des tâches, projets, personnes, documents, risques…" },
} as const;

/** WCAG contrast of two CSS colours, the first composited over the second. */
function contrastIn(page: Page, fg: string, bg: string) {
  return page.evaluate(
    ([a, b]) => {
      // Any CSS colour (rgb(), color(srgb …), oklab …) through a canvas pixel.
      const parse = (c: string) => {
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, bl, alpha] = ctx.getImageData(0, 0, 1, 1).data;
        return { r, g, b: bl, a: alpha / 255 };
      };
      const back = parse(b);
      const front = parse(a);
      const mix = (k: "r" | "g" | "b") => front[k] * front.a + back[k] * (1 - front.a);
      const lum = (r: number, g: number, bl: number) =>
        [r, g, bl]
          .map((v) => v / 255)
          .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const l1 = lum(mix("r"), mix("g"), mix("b"));
      const l2 = lum(back.r, back.g, back.b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    },
    [fg, bg] as const,
  );
}

async function expectOnScreen(page: Page, panelSelector: string, label: string) {
  const panel = page.locator(panelSelector);
  await expect(panel, label).toBeVisible();
  const { box, width, scroll } = await panel.evaluate((el) => ({
    box: el.getBoundingClientRect().toJSON() as DOMRect,
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(box.left, `${label}: left edge on screen`).toBeGreaterThanOrEqual(0);
  expect(box.right, `${label}: right edge on screen`).toBeLessThanOrEqual(width);
  expect(scroll, `${label}: no sideways scroll`).toBeLessThanOrEqual(width);
}

for (const [lang, text] of Object.entries(LANGS)) {
  for (const width of [320, 375, 768]) {
    test(`the top bar's panels stay on screen at ${width} px, from the keyboard (${lang})`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 800 });
      await signIn(page, "staff");
      if (lang === "fr") {
        await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
      }
      await page.goto("/projects");
      const header = page.locator("header.sticky");

      // Notifications.
      await header.getByRole("button", { name: /^Notifications/ }).focus();
      await page.keyboard.press("Enter");
      await expectOnScreen(page, "#topbar-notifications-panel", "notifications panel");
      // The top bar alone: the Projects page's own link is A11Y-007's other part.
      const axe = await new AxeBuilder({ page }).include("header.sticky").withTags(WCAG).analyze();
      expect(axe.violations, "axe with the notifications panel open").toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.locator("#topbar-notifications-panel")).toBeHidden();

      // Quick create.
      await header.getByRole("button", { name: text.create }).focus();
      await page.keyboard.press("Enter");
      await expectOnScreen(page, "#topbar-create-panel", "quick-create panel");
      await page.keyboard.press("Escape");

      // Account: the spoken name holds the initials the button shows.
      const account = header.getByRole("button", { name: new RegExp(text.account) });
      await expect(account).toHaveAccessibleName(`QS, ${text.account}`);
      await account.focus();
      await page.keyboard.press("Enter");
      await expectOnScreen(page, "#topbar-account-panel", "account panel");
      await page.keyboard.press("Escape");
    });
  }

  test(`the command palette's placeholder and active result are easy to see (${lang})`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 375, height: 800 });
    await signIn(page, "staff");
    if (lang === "fr") {
      await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
    }
    await page.goto("/projects");
    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder(text.palette);
    await expect(input).toBeFocused();

    const dialog = page.getByRole("dialog");
    const background = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor);
    const placeholder = await input.evaluate((el) => getComputedStyle(el, "::placeholder").color);
    expect(await contrastIn(page, placeholder, background), "placeholder contrast").toBeGreaterThanOrEqual(4.5);

    await input.fill("a");
    const active = dialog.getByRole("option", { selected: true });
    await expect(active).toBeVisible();
    const { shadow, optionBackground } = await active.evaluate((el) => ({
      shadow: getComputedStyle(el).boxShadow,
      optionBackground: getComputedStyle(el).backgroundColor,
    }));
    // Tailwind lists empty shadows first; the marker is the one with a colour.
    const indicator = (shadow.match(/(?:rgba?|color|oklab|oklch)\([^)]+\)/g) ?? []).find(
      (c) => !/^rgba\(0, 0, 0, 0\)$/.test(c) && !/\/ 0\)$/.test(c),
    );
    expect(indicator, "the active result has an edge marker").toBeTruthy();
    expect(await contrastIn(page, indicator!, optionBackground), "active marker contrast").toBeGreaterThanOrEqual(3);

    const axe = await new AxeBuilder({ page }).include("dialog").withTags(WCAG).analyze();
    expect(axe.violations, "axe on the open palette").toEqual([]);
  });
}
