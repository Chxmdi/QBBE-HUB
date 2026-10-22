import type { Page } from "./fixtures";

/**
 * The clipboard, in every browser the suite runs.
 *
 * Only Chromium knows the "clipboard-read" and "clipboard-write" permissions;
 * Firefox and WebKit refuse them with "Unknown permission", and neither lets a
 * headless page read the system clipboard. So Chromium keeps the real
 * clipboard, and elsewhere the page gets an in-memory one: `navigator.clipboard`
 * reads and writes a string, and copy/paste are sent as the same clipboard
 * events the browser raises for Ctrl+C and Ctrl+V. The app's own handlers run
 * either way; only where the text is kept differs.
 *
 * QA_FAKE_CLIPBOARD=1 uses the in-memory clipboard in Chromium too, so the
 * Firefox and WebKit path can be checked on a machine with only Chromium.
 */
function fake(page: Page): boolean {
  return process.env.QA_FAKE_CLIPBOARD === "1" || page.context().browser()?.browserType().name() !== "chromium";
}

function installFake() {
  const store = window as unknown as { __qaClipboard?: string };
  if (store.__qaClipboard !== undefined) return;
  store.__qaClipboard = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        store.__qaClipboard = String(text);
      },
      readText: async () => store.__qaClipboard ?? "",
    },
  });
}

/** Makes the clipboard usable for this page. Call before the first navigation, or after it. */
export async function useClipboard(page: Page) {
  if (!fake(page)) {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    return;
  }
  await page.addInitScript(installFake);
  // The page already open (if any) gets it too.
  await page.evaluate(installFake).catch(() => undefined);
}

/** Copies what is selected in the focused element, as Ctrl+C does. */
export async function pressCopy(page: Page) {
  if (!fake(page)) {
    await page.keyboard.press("Control+c");
    return;
  }
  await page.evaluate(async () => {
    const data = new DataTransfer();
    const target = document.activeElement ?? document.body;
    const event = new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    if (event.defaultPrevented) await navigator.clipboard.writeText(data.getData("text/plain"));
  });
}

/** Puts `text` on the clipboard and pastes it into the focused element, as Ctrl+V does. */
export async function pasteText(page: Page, text: string) {
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  if (!fake(page)) {
    await page.keyboard.press("Control+v");
    return;
  }
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** What is on the clipboard now. */
export function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}
