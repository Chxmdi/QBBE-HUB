import type { Page } from "./fixtures";

/**
 * The clipboard, as a test can see it in each browser.
 *
 * Chromium lets a test grant clipboard access, so there the test reads and
 * writes the real system clipboard and pastes with the real shortcut.
 * Firefox and WebKit offer no such permission ("Unknown permission:
 * clipboard-read"), and a page script cannot read the system clipboard
 * without a person's gesture. There the page records what it put on the
 * clipboard itself (navigator.clipboard, and the data a copy event carried),
 * and a paste is a paste event carrying the text, so the app's own copy and
 * paste handlers still do the work being tested.
 */
export interface TestClipboard {
  /** What the page last put on the clipboard. */
  read(): Promise<string>;
  /** Paste `text` into the focused element, as Ctrl+V would. */
  paste(text: string): Promise<void>;
}

function recorder() {
  const w = window as unknown as { __qaClipboard?: { text: string } };
  if (w.__qaClipboard) return;
  const store = { text: "" };
  w.__qaClipboard = store;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        store.text = String(text);
      },
      readText: async () => store.text,
    },
  });
  // A keyboard copy (or execCommand("copy")): keep what the page's handler set.
  window.addEventListener("copy", (event) => {
    const text = event.clipboardData?.getData("text/plain");
    if (text) store.text = text;
  });
}

export async function useClipboard(page: Page): Promise<TestClipboard> {
  const browser = page.context().browser()?.browserType().name();
  if (browser === "chromium") {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    return {
      read: () => page.evaluate(() => navigator.clipboard.readText()),
      paste: async (text) => {
        await page.evaluate((value) => navigator.clipboard.writeText(value), text);
        await page.keyboard.press("Control+v");
      },
    };
  }
  // For every page this context opens from now on, and for the one already open.
  await page.addInitScript(recorder);
  if (page.url().startsWith("http")) await page.evaluate(recorder);
  return {
    read: () => page.evaluate(() => (window as unknown as { __qaClipboard?: { text: string } }).__qaClipboard?.text ?? ""),
    paste: (text) =>
      page.evaluate((value) => {
        const data = new DataTransfer();
        data.setData("text/plain", value);
        // Set on the event itself: Firefox keeps data passed to the constructor
        // of a script-made paste event unreadable.
        const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: data });
        (document.activeElement ?? document.body).dispatchEvent(event);
      }, text),
  };
}
