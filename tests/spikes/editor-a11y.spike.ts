import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../e2e/fixtures";
import { signIn } from "../e2e/auth";
import { writeEvidence } from "./evidence";

/**
 * W0-5: BlockNote (MPL-2.0 core, Ariakit UI) accessibility spike.
 *
 * Automated checks only. Everything is recorded to
 * test-results/spikes/w0-5-*.json. The keyboard journey asserts the things a
 * keyboard-only person must be able to do; axe findings and focus-style
 * observations are recorded rather than asserted, because they are findings
 * about a third-party component that the go/no-go weighs.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

type Step = { step: string; ok: boolean; detail?: string };

type Mode = "raw" | "mitigated";
/** raw: BlockNote as shipped. mitigated: with the W0-5 fixes in editor-spike-inner.tsx. */
let mode: Mode = "mitigated";

async function openSpike(page: Page) {
  await page.goto(mode === "raw" ? "/dev/editor-spike?raw=1" : "/dev/editor-spike");
  await page.locator(".bn-editor").waitFor();
  await page.waitForFunction(() => Boolean((window as unknown as { __editorSpike?: unknown }).__editorSpike));
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    localStorage.setItem("qbbe-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
  await expect(page.locator(".bn-container").first()).toHaveAttribute("data-color-scheme", theme);
}

async function documentBlocks(page: Page) {
  return page.evaluate(() => {
    type B = { type: string; props: Record<string, unknown>; content?: unknown; children: B[] };
    const flat: { type: string; props: Record<string, unknown>; text: string }[] = [];
    const text = (content: unknown): string =>
      Array.isArray(content)
        ? content.map((c: { text?: string; type?: string }) => c.text ?? "").join("")
        : "";
    const walk = (blocks: B[]) => {
      for (const b of blocks) {
        flat.push({ type: b.type, props: b.props, text: text(b.content) });
        walk(b.children ?? []);
      }
    };
    walk((window as unknown as { __editorSpike: { editor: { document: B[] } } }).__editorSpike.editor.document);
    return flat;
  });
}

async function focusedDescription(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "none";
    const style = getComputedStyle(el);
    return JSON.stringify({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40),
      classes: el.className.toString().slice(0, 80),
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      boxShadow: style.boxShadow,
      inEditor: Boolean(el.closest(".bn-editor")),
    });
  });
}

async function activeOptionTitle(page: Page) {
  return page.evaluate(() => {
    const editor = document.querySelector(".bn-editor");
    const id = editor?.getAttribute("aria-activedescendant");
    const option = id ? document.getElementById(id) : null;
    return option?.querySelector(".bn-ak-suggestion-menu-item-title")?.textContent ?? null;
  });
}

/**
 * Presses an arrow key in the slash menu and waits for aria-activedescendant
 * to move. It updates on the next render, not synchronously with the key.
 */
async function arrow(page: Page, key: "ArrowDown" | "ArrowUp") {
  const before = await page.locator(".bn-editor").getAttribute("aria-activedescendant");
  await page.keyboard.press(key);
  await page
    .waitForFunction((b) => document.querySelector(".bn-editor")?.getAttribute("aria-activedescendant") !== b, before, { timeout: 1_000 })
    .catch(() => {}); // a single-option list does not move
}

/**
 * Puts the caret at the start of the first block or the end of the last one
 * through the editor's API. For the axe and zoom checks only, which test what
 * is on screen, not how the caret got there; the keyboard journey uses keys.
 */
async function placeCaret(page: Page, where: "start" | "end") {
  await page.evaluate((w) => {
    type Ed = { document: unknown[]; focus: () => void; setTextCursorPosition: (b: unknown, p: "start" | "end") => void };
    const editor = (window as unknown as { __editorSpike: { editor: Ed } }).__editorSpike.editor;
    const blocks = editor.document;
    editor.focus();
    editor.setTextCursorPosition(w === "start" ? blocks[0] : blocks[blocks.length - 1], w);
  }, where);
  await expect(page.locator(".bn-editor")).toBeFocused();
}

/**
 * Types "/" and waits for the slash menu. Right after a page load the first
 * keystroke into the editor is occasionally lost, so try once more.
 */
async function openSlashMenu(page: Page) {
  const listbox = page.getByRole("listbox");
  await page.keyboard.type("/");
  if (!(await listbox.isVisible().catch(() => false))) {
    await listbox.waitFor({ state: "visible", timeout: 2_000 }).catch(async () => {
      const text = await page.evaluate(() => document.getSelection()?.anchorNode?.textContent ?? "");
      if (text.endsWith("/")) await page.keyboard.press("Backspace");
      await page.waitForTimeout(300);
      await page.keyboard.type("/");
    });
  }
  await expect(listbox).toBeVisible();
}

/** Opens the slash menu on the empty last block and arrows down to `title`. */
async function chooseFromSlashMenu(page: Page, title: string, filter?: string) {
  await page.keyboard.press("Control+End");
  const lastIsEmpty = await page.evaluate(() => {
    const blocks = document.querySelectorAll(".bn-block-content");
    const last = blocks[blocks.length - 1];
    return last?.getAttribute("data-content-type") === "paragraph" && (last.textContent ?? "") === "";
  });
  if (!lastIsEmpty) await page.keyboard.press("Enter");
  await page.keyboard.type(`/${filter ?? ""}`);
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  let presses = 0;
  while ((await activeOptionTitle(page)) !== title) {
    if (++presses > 40) throw new Error(`"${title}" never became the active option`);
    await arrow(page, "ArrowDown");
  }
  await page.keyboard.press("Enter");
  await expect(listbox).toBeHidden();
  return presses;
}

test.describe("W0-5 BlockNote accessibility", () => {
  test("axe in both themes, with each editor overlay open", async ({ page }) => {
    await signIn(page, "staff");
    await openSpike(page);
    const findings: Record<string, unknown>[] = [];
    const aria: Record<string, string> = {};

    async function scan(state: string, theme: string) {
      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      for (const v of results.violations) {
        findings.push({
          state,
          theme,
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.length,
          targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
          summary: v.nodes[0]?.failureSummary?.slice(0, 300),
        });
      }
    }

    for (const m of ["raw", "mitigated"] as const)
    for (const theme of ["light", "dark"] as const) {
      mode = m;
      const label = `${m} ${theme}`;
      await openSpike(page);
      await setTheme(page, theme);
      await scan("editor at rest", label);

      // Slash menu.
      await placeCaret(page, "end");
      await page.keyboard.press("Enter");
      await openSlashMenu(page);
      await scan("slash menu open", label);
      if (label === "raw light") aria.slashMenu = (await page.getByRole("listbox").ariaSnapshot()).slice(0, 1500);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Backspace");

      // Formatting toolbar, opened by a keyboard selection.
      await placeCaret(page, "start");
      await page.keyboard.press("Shift+End");
      await expect(page.getByRole("toolbar")).toBeVisible();
      await scan("formatting toolbar open", label);
      if (label === "raw light") aria.formattingToolbar = await page.getByRole("toolbar").ariaSnapshot();

      // Side menu (drag handle): only appears on mouse hover.
      await page.locator(".bn-block-outer").nth(1).hover();
      await expect(page.locator(".bn-side-menu")).toBeVisible();
      await scan("side menu (drag handle) shown", label);
      if (label === "raw light") aria.sideMenu = await page.locator(".bn-side-menu").ariaSnapshot();

      // Block menu behind the drag handle.
      await page.getByRole("button", { name: "Open block menu" }).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await scan("drag-handle block menu open", label);
      if (label === "raw light") aria.blockMenu = await page.getByRole("menu").ariaSnapshot();
      await page.keyboard.press("Escape");
    }

    aria.editorRoot = await page.evaluate(() => {
      const e = document.querySelector(".bn-editor")!;
      return Array.from(e.attributes)
        .filter((a) => !a.name.startsWith("class"))
        .map((a) => `${a.name}="${a.value}"`)
        .join(" ");
    });
    mode = "mitigated";
    writeEvidence("w0-5-axe", { findings, aria });
    console.log(`axe: ${findings.length} violation groups`);
    for (const f of findings) console.log(`  [${f.theme}] ${f.state}: ${f.id} (${f.impact}) x${f.nodes} — ${f.help}`);
  });

  for (const m of ["raw", "mitigated"] as const)
  test(`keyboard-only journey (${m}): every block type, reorder, turn into, menus`, async ({ page }) => {
    mode = m;
    await signIn(page, "staff");
    await openSpike(page);
    const steps: Step[] = [];
    const record = async (step: string, fn: () => Promise<string | void>) => {
      try {
        const detail = await fn();
        steps.push({ step, ok: true, detail: detail ?? undefined });
      } catch (error) {
        steps.push({ step, ok: false, detail: String(error).replace(/\u001b\[[0-9;]*m/g, "").slice(0, 400) });
        await page.keyboard.press("Escape").catch(() => {});
        await page.locator(".bn-editor").focus().catch(() => {});
      }
    };

    // Reaching the editor from the top of the page with Tab.
    await record("Tab from the page reaches the editor", async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press("Tab");
        if (await page.evaluate(() => document.activeElement?.classList.contains("bn-editor"))) return `after ${i + 1} Tab`;
      }
      throw new Error("editor not reached in 10 Tabs");
    });

    const types: { title: string; check: (b: { type: string; props: Record<string, unknown> }) => boolean; text?: string }[] = [
      { title: "Heading 1", check: (b) => b.type === "heading" && b.props.level === 1 && !b.props.isToggleable, text: "Heading one" },
      { title: "Heading 2", check: (b) => b.type === "heading" && b.props.level === 2 && !b.props.isToggleable, text: "Heading two" },
      { title: "Heading 3", check: (b) => b.type === "heading" && b.props.level === 3 && !b.props.isToggleable, text: "Heading three" },
      { title: "Heading 4", check: (b) => b.type === "heading" && b.props.level === 4, text: "Heading four" },
      { title: "Heading 5", check: (b) => b.type === "heading" && b.props.level === 5, text: "Heading five" },
      { title: "Heading 6", check: (b) => b.type === "heading" && b.props.level === 6, text: "Heading six" },
      { title: "Toggle Heading 1", check: (b) => b.type === "heading" && Boolean(b.props.isToggleable), text: "Toggle heading" },
      { title: "Toggle Heading 2", check: (b) => b.type === "heading" && b.props.level === 2 && Boolean(b.props.isToggleable), text: "Toggle heading two" },
      { title: "Toggle Heading 3", check: (b) => b.type === "heading" && b.props.level === 3 && Boolean(b.props.isToggleable), text: "Toggle heading three" },
      { title: "Quote", check: (b) => b.type === "quote", text: "A quote" },
      { title: "Toggle List", check: (b) => b.type === "toggleListItem", text: "Toggle item" },
      { title: "Numbered List", check: (b) => b.type === "numberedListItem", text: "Numbered item" },
      { title: "Bullet List", check: (b) => b.type === "bulletListItem", text: "Bullet item" },
      { title: "Check List", check: (b) => b.type === "checkListItem", text: "Check item" },
      { title: "Paragraph", check: (b) => b.type === "paragraph", text: "Plain paragraph" },
      { title: "Code Block", check: (b) => b.type === "codeBlock", text: "const x = 1;" },
      { title: "Divider", check: (b) => b.type === "divider" },
      { title: "Image", check: (b) => b.type === "image" },
      { title: "Video", check: (b) => b.type === "video" },
      { title: "Audio", check: (b) => b.type === "audio" },
      { title: "File", check: (b) => b.type === "file" },
      // Last: Ctrl+End then lands in the table's last cell, not a new block.
      { title: "Table", check: (b) => b.type === "table" },
    ];

    for (const type of types) {
      await record(`slash menu creates ${type.title}`, async () => {
        const before = (await documentBlocks(page)).filter(type.check).length;
        const presses = await chooseFromSlashMenu(page, type.title);
        let extra = "";
        if (["Image", "Video", "Audio", "File"].includes(type.title)) {
          // The file panel opens on insert. Where does focus go, and does Escape return it?
          await page.waitForTimeout(200);
          extra = ` focus after insert: ${await focusedDescription(page)}`;
          await page.keyboard.press("Escape");
          extra += `; after Escape inEditor=${await page.evaluate(() => Boolean(document.activeElement?.closest(".bn-editor")))}`;
        } else if (type.title === "Table") {
          await page.keyboard.type("A1");
          await page.keyboard.press("Tab");
          await page.keyboard.type("B1");
          const cells = await page.evaluate(() => Array.from(document.querySelectorAll(".bn-editor td, .bn-editor th")).slice(0, 2).map((c) => c.textContent));
          extra = ` first cells: ${JSON.stringify(cells)}`;
          if (cells[0] !== "A1" || cells[1] !== "B1") throw new Error(`Tab between table cells failed: ${JSON.stringify(cells)}`);
          for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
          const where = await page.evaluate(() => document.getSelection()?.anchorNode?.parentElement?.closest("[data-content-type]")?.getAttribute("data-content-type") ?? "?");
          extra += `; ArrowDown out of the table lands in: ${where}`;
        } else if (type.text) {
          await page.keyboard.type(type.text);
          if (type.title === "Code Block") {
            // Enter adds a line inside code; Shift+Enter leaves the block.
            await page.keyboard.press("Shift+Enter");
            extra = ` left the code block with Shift+Enter: ${await page.evaluate(() => document.getSelection()?.anchorNode?.parentElement?.closest("[data-content-type]")?.getAttribute("data-content-type") ?? "?")}`;
          }
        }
        const after = await documentBlocks(page);
        if (after.filter(type.check).length !== before + 1) throw new Error(`no new ${type.title} block`);
        if (type.text && !after.some((b) => type.check(b) && b.text === type.text)) throw new Error(`text did not land in the ${type.title} block`);
        return `${presses} ArrowDown presses.${extra}`;
      });
    }

    await openSpike(page);
    await page.locator(".bn-editor").focus();
    await record("slash menu inserts an emoji (grid picker)", async () => {
      await chooseFromSlashMenu(page, "Emoji");
      await page.keyboard.type("smile");
      await page.waitForTimeout(300);
      const picker = await page.evaluate(() => {
        const grid = document.querySelector(".bn-grid-suggestion-menu");
        const editor = document.querySelector(".bn-editor");
        return {
          role: grid?.getAttribute("role"),
          childRoles: [...new Set(Array.from(grid?.children ?? []).map((c) => c.getAttribute("role")))],
          editorControls: editor?.getAttribute("aria-controls"),
          editorActiveDescendant: editor?.getAttribute("aria-activedescendant"),
          gridId: grid?.id,
        };
      });
      await page.keyboard.press("Enter");
      const text = await page.evaluate(() => (window as unknown as { __editorSpike: { editor: { prosemirrorState: { doc: { textContent: string } } } } }).__editorSpike.editor.prosemirrorState.doc.textContent);
      if (!/\p{Extended_Pictographic}/u.test(text)) throw new Error(`no emoji inserted; picker=${JSON.stringify(picker)}`);
      return `inserted ${text.match(/\p{Extended_Pictographic}/u)?.[0]}; picker ARIA ${JSON.stringify(picker)}`;
    });

    await openSpike(page);
    await page.locator(".bn-editor").focus();
    await record("menu navigation: Escape closes, Up/Down/Home move, aria-activedescendant follows", async () => {
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("/");
      const first = await activeOptionTitle(page);
      await arrow(page, "ArrowDown");
      await arrow(page, "ArrowDown");
      const third = await activeOptionTitle(page);
      await arrow(page, "ArrowUp");
      const second = await activeOptionTitle(page);
      await arrow(page, "ArrowUp");
      await arrow(page, "ArrowUp");
      const wrapped = await activeOptionTitle(page);
      await page.keyboard.type("quo");
      await page.waitForTimeout(200);
      const filtered = await activeOptionTitle(page);
      const expanded = await page.locator(".bn-editor").getAttribute("aria-expanded");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox")).toBeHidden();
      const afterEscape = await page.locator(".bn-editor").getAttribute("aria-expanded");
      // Remove the typed "/quo".
      for (let i = 0; i < 4; i++) await page.keyboard.press("Backspace");
      if (filtered !== "Quote") throw new Error(`typing did not filter: ${filtered}`);
      return `first=${first} third=${third} back=${second} up-past-top=${wrapped} filtered=${filtered} aria-expanded open=${expanded} closed=${afterEscape}`;
    });

    await openSpike(page);
    await page.locator(".bn-editor").focus();
    await record("reorder a block with the keyboard (Ctrl+Shift+ArrowUp / Down)", async () => {
      await page.keyboard.press("Control+Home");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown"); // "Review the budget"
      const before = (await documentBlocks(page)).slice(0, 4).map((b) => b.text);
      await page.keyboard.press("Control+Shift+ArrowUp");
      const up = (await documentBlocks(page)).slice(0, 4).map((b) => b.text);
      await page.keyboard.press("Control+Shift+ArrowDown");
      await page.keyboard.press("Control+Shift+ArrowDown");
      const down = (await documentBlocks(page)).slice(0, 4).map((b) => b.text);
      if (up[1] !== before[2] || down[3] !== before[2]) throw new Error(`order did not change: ${JSON.stringify({ before, up, down })}`);
      const caretStill = await page.evaluate(() => window.getSelection()?.anchorNode?.textContent);
      return `before ${JSON.stringify(before)} → up ${JSON.stringify(up)} → down twice ${JSON.stringify(down)}; caret stays in "${caretStill}"`;
    });

    await openSpike(page);
    await page.locator(".bn-editor").focus();
    await record("turn into: keyboard shortcut Ctrl+Alt+1 on a paragraph", async () => {
      await page.keyboard.press("Control+End");
      // Enter on the check-list item, then Enter on the empty item, leaves a plain paragraph.
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Shortcut target");
      await page.keyboard.press("Control+Alt+1");
      const b = (await documentBlocks(page)).find((x) => x.text.includes("Shortcut target"));
      if (b?.type !== "heading") throw new Error(`still ${b?.type}: ${JSON.stringify((await documentBlocks(page)).map((x) => [x.type, x.text]))}`);
      await page.keyboard.press("Control+Alt+0");
      const back = (await documentBlocks(page)).find((x) => x.text.includes("Shortcut target"));
      return `heading, then Ctrl+Alt+0 back to ${back?.type}`;
    });

    await record("turn into: Markdown shortcut '## '", async () => {
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("## Markdown heading");
      const b = (await documentBlocks(page)).find((x) => x.text.includes("Markdown heading"));
      if (!(b?.type === "heading" && b.props.level === 2)) throw new Error(`got ${b?.type}`);
    });

    await record("turn into: slash menu on a block that already has text", async () => {
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Has text ");
      await page.keyboard.type("/");
      let presses = 0;
      while ((await activeOptionTitle(page)) !== "Bullet List" && presses++ < 40) await arrow(page, "ArrowDown");
      await page.keyboard.press("Enter");
      const blocks = await documentBlocks(page);
      const b = blocks.find((x) => x.text.startsWith("Has text"));
      return `block with text is now ${b?.type} (text "${b?.text}")`;
    });

    await openSpike(page);
    await page.locator(".bn-editor").focus();
    await record("formatting toolbar reachable from the keyboard", async () => {
      await page.keyboard.press("Control+Home");
      await page.keyboard.press("Shift+End");
      await expect(page.getByRole("toolbar")).toBeVisible();
      const tries: string[] = [];
      for (const key of ["Alt+F10", "Tab", "F6", "Shift+Tab"]) {
        await page.keyboard.press("Control+Home");
        await page.keyboard.press("Shift+End");
        await expect(page.getByRole("toolbar")).toBeVisible();
        await page.keyboard.press(key);
        await page.waitForTimeout(150);
        const inToolbar = await page.evaluate(() => Boolean(document.activeElement?.closest("[role=toolbar]")));
        tries.push(`${key}: ${inToolbar ? "in toolbar" : `focus ${await focusedDescription(page)}`}`);
        if (inToolbar) {
          // Walk the toolbar with the arrow keys, then Tab, recording each stop.
          const arrows: string[] = [];
          for (let i = 0; i < 4; i++) {
            await page.keyboard.press("ArrowRight");
            await page.waitForTimeout(100);
            arrows.push(JSON.parse(await focusedDescription(page)).name ?? "?");
          }
          // Bold by keyboard from the toolbar: focus "Bold", press Enter.
          let found = false;
          for (let i = 0; i < 14 && !found; i++) {
            found = (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Bold";
            if (!found) {
              await page.keyboard.press("ArrowRight");
              await page.waitForTimeout(100);
            }
          }
          await page.keyboard.press("Enter");
          const bolded = await page.evaluate(() => Boolean(document.querySelector(".bn-editor strong")));
          const focusStyle = await focusedDescription(page);
          await page.keyboard.press("Escape");
          const backInEditor = await page.evaluate(() => Boolean(document.activeElement?.closest(".bn-editor")));
          return `${tries.join(" | ")}; ArrowRight stops: ${arrows.join(", ")}; Bold via toolbar applied=${bolded}; focused button style ${focusStyle}; Escape returns to text=${backInEditor}`;
        }
        await page.keyboard.press("Escape");
        await page.locator(".bn-editor").focus();
      }
      throw new Error(tries.join(" | "));
    });

    await openSpike(page);
    await page.locator(".bn-editor").focus();
    await record("drag handle / block menu reachable from the keyboard", async () => {
      await page.locator(".bn-editor").focus();
      await page.keyboard.press("Control+Home");
      const seen: string[] = [];
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        seen.push(await focusedDescription(page));
        if (await page.evaluate(() => Boolean(document.activeElement?.closest(".bn-side-menu")))) return seen.join(" ; ");
      }
      throw new Error(`side menu never focused; Tab went: ${seen.join(" ; ")}`);
    });

    for (const where of ["paragraph", "bullet list", "code block", "table"] as const) {
      await record(`no keyboard trap: leaving the editor from a ${where}`, async () => {
        await openSpike(page);
        await page.locator(".bn-editor").focus();
        await page.keyboard.press("Control+End");
        if (where === "bullet list") await page.keyboard.type("- item");
        if (where === "code block") await page.keyboard.type("``` ");
        if (where === "table") await chooseFromSlashMenu(page, "Table");
        // Each strategy is repeated up to 6 times from the same caret position:
        // Tab may first visit focusable things inside the editor (check boxes).
        const results: string[] = [];
        const outside = () => page.evaluate(() => !document.activeElement?.closest(".bn-editor"));
        for (const key of ["Tab", "Shift+Tab", "Escape Tab", "Escape Shift+Tab"]) {
          let left = 0;
          for (let attempt = 1; attempt <= 6 && !left; attempt++) {
            await page.locator(".bn-editor").focus();
            await page.keyboard.press("Control+End");
            for (let n = 0; n < attempt; n++) {
              for (const k of key.split(" ")) {
                if (k === "Escape" && n > 0) continue; // Escape only once, first
                await page.keyboard.press(k);
              }
              if (await outside()) {
                left = n + 1;
                break;
              }
            }
          }
          results.push(`${key}: ${left ? `leaves after ${left} press(es)` : "stays"}`);
        }
        if (!results.some((r) => r.includes("leaves"))) throw new Error(results.join(", "));
        return results.join(", ");
      });
    }

    await record("focus indicator on the editor itself", async () => {
      await page.locator(".bn-editor").focus();
      return await focusedDescription(page);
    });

    writeEvidence(`w0-5-keyboard-${m}`, steps);
    for (const s of steps) console.log(`${s.ok ? "PASS" : "FAIL"} ${s.step}${s.detail ? ` — ${s.detail}` : ""}`);
    // The must-haves for keyboard-only people. Everything else is a finding.
    const must = steps.filter((s) =>
      (m === "mitigated" ? /slash menu creates|reorder|turn into: keyboard|menu navigation|Tab from the page|no keyboard trap|formatting toolbar reachable/ : /slash menu creates|reorder|turn into: keyboard|menu navigation|Tab from the page/).test(s.step),
    );
    expect(must.filter((s) => !s.ok).map((s) => `${s.step}: ${s.detail}`)).toEqual([]);
  });

  test("200% zoom: editor and its menus stay inside the viewport", async ({ page }) => {
    await signIn(page, "staff");
    await page.setViewportSize({ width: 640, height: 450 });
    await openSpike(page);
    const result: Record<string, unknown> = {};
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    result.pageOverflowPx = await overflow();
    await placeCaret(page, "end");
    await page.keyboard.press("Enter");
    await openSlashMenu(page);
    const menu = await page.getByRole("listbox").boundingBox();
    result.slashMenu = menu;
    result.slashMenuInsideViewport = Boolean(menu && menu.x >= 0 && menu.x + menu.width <= 640);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await placeCaret(page, "start");
    await page.keyboard.press("Shift+End");
    await expect(page.getByRole("toolbar")).toBeVisible();
    const toolbar = await page.getByRole("toolbar").boundingBox();
    result.toolbar = toolbar;
    result.toolbarInsideViewport = Boolean(toolbar && toolbar.x >= 0 && toolbar.x + toolbar.width <= 640);
    result.pageOverflowWithToolbarPx = await overflow();
    writeEvidence("w0-5-zoom", result);
    console.log(JSON.stringify(result));
    expect(result.pageOverflowPx as number).toBeLessThanOrEqual(2);
  });

  test("Quebec French: interface language and accented text entry", async ({ page }) => {
    await signIn(page, "staff");
    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
    await openSpike(page);
    const result: Record<string, unknown> = {};
    result.htmlLang = await page.locator("html").getAttribute("lang");
    await page.locator(".bn-editor").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("/");
    result.firstOptions = await page.getByRole("option").evaluateAll((els) => els.slice(0, 4).map((e) => e.getAttribute("aria-label") ?? e.textContent));
    await page.keyboard.type("titre");
    result.filteredTitre = await activeOptionTitle(page);
    await page.keyboard.press("Escape");
    for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
    await page.keyboard.type("/liste");
    result.filteredListe = await activeOptionTitle(page);
    await page.keyboard.press("Escape");
    for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");

    // Typed text, one key event per character.
    const typed = "Élève à l’école : « Ça va? » — œuvre, naïve, Noël, où, çà, ÀÉÈÊËÎÏÔÙÛÜŸÇ";
    await page.keyboard.type(typed);
    // Dead-key / input-method composition, as a French keyboard or macOS Option+e sends it.
    const cdp = await page.context().newCDPSession(page);
    await page.keyboard.type(" ");
    for (const [dead, letter] of [["´", "é"], ["`", "è"], ["^", "ê"], ["¨", "ë"]]) {
      await cdp.send("Input.imeSetComposition", { text: dead, selectionStart: 1, selectionEnd: 1 });
      await cdp.send("Input.insertText", { text: letter });
    }
    const blocks = await documentBlocks(page);
    const last = blocks.filter((b) => b.text).pop()?.text ?? "";
    result.typed = typed;
    result.stored = last;
    result.typedMatches = last.includes(typed);
    result.compositionMatches = last.endsWith(" éèêë");
    result.spellcheckLang = await page.locator(".bn-editor").evaluate((e) => (e.closest("[lang]") as HTMLElement | null)?.lang ?? null);
    writeEvidence("w0-5-french", result);
    console.log(JSON.stringify(result, null, 2));
    expect(result.htmlLang).toBe("fr-CA");
    expect(result.typedMatches).toBe(true);
    expect(result.compositionMatches).toBe(true);
  });
});
