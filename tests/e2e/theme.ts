import type { Page } from "./fixtures";

/**
 * Switches the theme and waits for the colours to finish easing into it.
 * Measuring contrast during the transition samples blended colours, and an
 * accessibility check then reports a contrast failure that is not there.
 */
export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    localStorage.setItem("qbbe-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
  await page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const fading = document.getAnimations().filter((a) => a instanceof CSSTransition);
    await Promise.all(fading.map((a) => a.finished.catch(() => undefined)));
  });
}
