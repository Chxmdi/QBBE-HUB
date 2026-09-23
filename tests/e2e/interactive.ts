import { expect, type Locator } from "@playwright/test";

/**
 * Click a control only once React has taken it over.
 *
 * Every form in this product is a client component whose submit handler is
 * attached by React. The server sends complete HTML, so the button is present,
 * visible and enabled long before any of that happens — and Playwright's
 * actionability checks are satisfied by exactly those properties. A click in
 * that window is dispatched into a page that has no handler for it, and
 * nothing anywhere reports a problem: the click is simply lost, the form sits
 * there, and the test waits for a result that can no longer arrive.
 *
 * `page.goto` does not close the window. It resolves on `load`, and React
 * hydrates after that in its own scheduled work.
 *
 * Measured on CI run 35622498276, first attempt, Firefox: the page committed,
 * the email was filled, the button was clicked 250ms later, and the trace
 * records **no request at all** for the submit — not a slow one, none. The
 * failure surfaced 5s later as "element(s) not found" for the error message,
 * which reads like a broken product and was neither.
 *
 * Waiting for React's fiber key is a deliberate choice over retrying the click
 * until something happens. A retry would pass without ever saying that the
 * control was dead, and clicking a second time on a form that may already have
 * submitted is not a thing to do blindly. This waits for the actual condition
 * and, if React's internals ever change shape, fails with the message below
 * rather than quietly going green.
 */
export async function clickWhenInteractive(control: Locator, timeout = 15_000) {
  await expect
    .poll(() => isHydrated(control), {
      timeout,
      message:
        "React never hydrated this control, so clicking it would have done nothing",
    })
    .toBe(true);
  await control.click();
}

/**
 * React attaches `__reactFiber$<id>` to every host element it owns, on
 * hydration as well as on render. Its absence means this element is still just
 * markup. A detached or missing element counts as not hydrated rather than
 * throwing, so the poll can keep going through a re-render.
 */
function isHydrated(control: Locator): Promise<boolean> {
  return control
    .evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber$")))
    .catch(() => false);
}
