import { describe, expect, it } from "vitest";
import type { EditorBlock } from "@/features/editor/adapter/content";
import { MAX_SAVE_CHARS } from "@/features/editor/queue/queue";
import { createEditorT } from "@/features/editor/i18n";
import { decodeEntities, hasRichStructure, htmlToBlocks, sanitizeHtml } from "./html";
import { safeHref } from "./inline";
import { looksLikeMarkdown, markdownToBlocks, parseInline } from "./markdown";
import { exceedsLimit, MAX_HTML_CHARS, planPaste, type ClipboardInput } from "./plan";
import { codeFence, isDividerLine, lineShortcut } from "./shortcuts";
import { isSpreadsheetText, parseTsv, tsvToTable } from "./table";
import { afterScanCheck, fileBlockType, fileFits, MAX_SCAN_CHECKS, nextScanCheckMs } from "./files";

const text = (t: string, styles: Record<string, true> = {}) => ({ type: "text", text: t, styles });

function clipboard(data: Record<string, string>, extra: Partial<ClipboardInput> = {}): ClipboardInput {
  return {
    types: Object.keys(data),
    getData: (type) => data[type] ?? "",
    files: [],
    inCode: false,
    documentChars: 100,
    ...extra,
  };
}

/** Block types and texts, for comparing structure. */
function shape(blocks: EditorBlock[]): unknown[] {
  return blocks.map((block) => ({
    type: block.type,
    ...(block.props ? { props: block.props } : {}),
    ...(Array.isArray(block.content) ? { text: block.content.map((part) => ("text" in part ? part.text : (part as { content: { text: string }[] }).content.map((c) => c.text).join(""))).join("") } : {}),
    ...(block.children?.length ? { children: shape(block.children) } : {}),
  }));
}

describe("E1-1 rich text (HTML) keeps its structure", () => {
  it("keeps headings, bold, italic, links, lists and quotes as blocks", () => {
    const blocks = htmlToBlocks(
      `<h1>Title</h1><h3>Sub</h3><p>Plain <b>bold</b> <em>italic</em> <a href="https://qbbe.ca/x">link</a></p>` +
        `<ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul><ol start="3"><li>Three</li></ol>` +
        `<blockquote><p>Quoted</p></blockquote>`,
    );
    expect(shape(blocks)).toEqual([
      { type: "heading", props: { level: 1 }, text: "Title" },
      { type: "heading", props: { level: 3 }, text: "Sub" },
      { type: "paragraph", text: "Plain bold italic link" },
      { type: "bulletListItem", text: "One", children: [{ type: "bulletListItem", text: "Nested" }] },
      { type: "bulletListItem", text: "Two" },
      { type: "numberedListItem", props: { start: 3 }, text: "Three" },
      { type: "quote", text: "Quoted" },
    ]);
    expect(blocks[2].content).toEqual([
      text("Plain "),
      text("bold", { bold: true }),
      text(" "),
      text("italic", { italic: true }),
      text(" "),
      { type: "link", href: "https://qbbe.ca/x", content: [text("link")] },
    ]);
  });

  it("reads Google Docs styles and ignores its wrapping non-bold <b>", () => {
    const blocks = htmlToBlocks(
      `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700">Gras</span> et <span style="font-style:italic">italique</span> &eacute;t&eacute;</p></b>`,
    );
    expect(blocks).toEqual([{ type: "paragraph", content: [text("Gras", { bold: true }), text(" et "), text("italique", { italic: true }), text(" été")] }]);
  });

  it("keeps checklists, code blocks, dividers, line breaks and other styles", () => {
    const blocks = htmlToBlocks(
      `<ul><li><input type="checkbox" checked> Done</li><li><input type="checkbox"> Open</li></ul>` +
        `<pre><code class="language-ts">const a = 1;\n  a &lt; 2;</code></pre><hr><p>a<br>b <u>u</u> <s>s</s> <code>c</code></p>`,
    );
    expect(shape(blocks)).toEqual([
      { type: "checkListItem", props: { checked: true }, text: "Done" },
      { type: "checkListItem", props: { checked: false }, text: "Open" },
      { type: "codeBlock", props: { language: "ts" }, text: "const a = 1;\n  a < 2;" },
      { type: "divider" },
      { type: "paragraph", text: "a\nb u s c" },
    ]);
    expect(blocks[4].content).toContainEqual(text("u", { underline: true }));
    expect(blocks[4].content).toContainEqual(text("s", { strike: true }));
    expect(blocks[4].content).toContainEqual(text("c", { code: true }));
  });

  it("is chosen over the plain text when the HTML carries structure", () => {
    const plan = planPaste(clipboard({ "text/html": "<h2>Agenda</h2><ul><li>Budget</li></ul>", "text/plain": "Agenda\nBudget" }));
    expect(plan).toMatchObject({ kind: "blocks", source: "html" });
    expect(shape((plan as { blocks: EditorBlock[] }).blocks)).toEqual([
      { type: "heading", props: { level: 2 }, text: "Agenda" },
      { type: "bulletListItem", text: "Budget" },
    ]);
    expect(hasRichStructure("<span style='color:red'>x</span>")).toBe(false);
    expect(decodeEntities("&lt;&#233;&#xE9;&nbsp;&bogus;")).toBe("<éé &bogus;");
  });
});

describe("E1-2 Markdown text becomes the same blocks as typing it", () => {
  const markdown = [
    "# One",
    "###### Six",
    "- bullet **bold** and *italic*",
    "  * nested",
    "1. first",
    "7. seventh",
    "[] open",
    "[x] done",
    "- [ ] list task",
    "> quote with [a link](https://qbbe.ca)",
    ">! callout",
    "---",
    "```js",
    "let x = `y`;",
    "```",
    "Plain line with `code` and ~~gone~~",
  ].join("\n");

  it("turns every line into the block its shortcut makes", () => {
    expect(shape(markdownToBlocks(markdown))).toEqual([
      { type: "heading", props: { level: 1 }, text: "One" },
      { type: "heading", props: { level: 6 }, text: "Six" },
      { type: "bulletListItem", text: "bullet bold and italic", children: [{ type: "bulletListItem", text: "nested" }] },
      { type: "numberedListItem", text: "first" },
      { type: "numberedListItem", props: { start: 7 }, text: "seventh" },
      { type: "checkListItem", props: { checked: false }, text: "open" },
      { type: "checkListItem", props: { checked: true }, text: "done" },
      { type: "checkListItem", props: { checked: false }, text: "list task" },
      { type: "quote", text: "quote with a link" },
      { type: "callout", props: { tone: "info" }, text: "callout" },
      { type: "divider" },
      { type: "codeBlock", props: { language: "js" }, text: "let x = `y`;" },
      { type: "paragraph", text: "Plain line with code and gone" },
    ]);
  });

  it("reads each line with the typing shortcuts' own table", () => {
    for (const line of markdown.split("\n")) {
      const blocks = markdownToBlocks(line);
      const shortcut = lineShortcut(line.trim());
      if (shortcut) expect(blocks[0]).toMatchObject({ type: shortcut.block.type, ...(shortcut.block.props ? { props: shortcut.block.props } : {}) });
    }
  });

  it("reads inline Markdown", () => {
    expect(parseInline("a **b _c_** `d` [e](https://x.org) \\*f\\* snake_case_name <https://y.org>")).toEqual([
      text("a "),
      text("b ", { bold: true }),
      text("c", { bold: true, italic: true }),
      text(" "),
      text("d", { code: true }),
      text(" "),
      { type: "link", href: "https://x.org", content: [text("e")] },
      text(" *f* snake_case_name "),
      { type: "link", href: "https://y.org", content: [text("https://y.org")] },
    ]);
  });

  it("reads pipe tables and prefers Markdown over plain HTML", () => {
    const blocks = markdownToBlocks("| A | B |\n|---|---|\n| 1 | **2** |");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("table");
    const plan = planPaste(clipboard({ "text/html": "<span style='color:#333'># Heading</span>", "text/plain": "# Heading\n- item" }));
    expect(plan).toMatchObject({ kind: "blocks", source: "markdown" });
    expect(planPaste(clipboard({ "text/markdown": "## Two" }))).toMatchObject({ kind: "blocks", blocks: [{ type: "heading", props: { level: 2 } }] });
    expect(looksLikeMarkdown("Just a sentence.")).toBe(false);
    expect(looksLikeMarkdown("Some **bold** words")).toBe(true);
  });

  it("keeps plain text as one paragraph per line", () => {
    const plan = planPaste(clipboard({ "text/plain": "First line\n\nSecond line" }));
    expect(plan).toMatchObject({ kind: "blocks", source: "text" });
    expect(shape((plan as { blocks: EditorBlock[] }).blocks)).toEqual([
      { type: "paragraph", text: "First line" },
      { type: "paragraph", text: "Second line" },
    ]);
  });
});

describe("E1-3 spreadsheet cells become a table", () => {
  const cells = (block: EditorBlock) =>
    (block.content as { rows: { cells: { content: { text: string }[] }[] }[] }).rows.map((row) => row.cells.map((cell) => cell.content.map((c) => c.text).join("")));

  it("reads tab-separated text, with quoted cells, into the same rows and columns", () => {
    const tsv = 'Name\tAmount\tNote\nAda\t12\t"two\nlines"\nGrace\t7\t"say ""hi"""\n';
    expect(isSpreadsheetText(tsv)).toBe(true);
    expect(parseTsv(tsv)).toEqual([
      ["Name", "Amount", "Note"],
      ["Ada", "12", "two\nlines"],
      ["Grace", "7", 'say "hi"'],
    ]);
    const plan = planPaste(clipboard({ "text/plain": tsv }));
    expect(plan).toMatchObject({ kind: "blocks", source: "table" });
    expect(cells((plan as { blocks: EditorBlock[] }).blocks[0])).toEqual([
      ["Name", "Amount", "Note"],
      ["Ada", "12", "two\nlines"],
      ["Grace", "7", 'say "hi"'],
    ]);
    expect(cells(tsvToTable("a\t\tc"))).toEqual([["a", "", "c"]]);
  });

  it("reads a spreadsheet's HTML table (Google Sheets, Excel) with empty and merged cells", () => {
    const html =
      `<google-sheets-html-origin><style>td{border:1px}</style><table><colgroup><col width="100"></colgroup><tbody>` +
      `<tr><td>Name</td><td>Amount</td><td>Note</td></tr><tr><td>Ada</td><td><b>12</b></td><td></td></tr><tr><td colspan="2">Total</td><td>x</td></tr></tbody></table>`;
    const plan = planPaste(clipboard({ "text/html": html, "text/plain": "Name\tAmount\tNote\nAda\t12\t\nTotal\t\tx" }));
    expect(plan).toMatchObject({ kind: "blocks", source: "html" });
    const blocks = (plan as { blocks: EditorBlock[] }).blocks;
    expect(blocks).toHaveLength(1);
    expect(cells(blocks[0])).toEqual([
      ["Name", "Amount", "Note"],
      ["Ada", "12", ""],
      ["Total", "", "x"],
    ]);
  });

  it("does not treat ordinary text as a table", () => {
    expect(isSpreadsheetText("no tabs here")).toBe(false);
    expect(isSpreadsheetText("a\tb\nc")).toBe(false);
  });
});

describe("E1-4 pasted files go through the scanned upload", () => {
  it("plans an upload for a pasted image or file, not for text that comes with one", () => {
    const image = { name: "shot.png", type: "image/png", size: 2048 };
    expect(planPaste(clipboard({ Files: "" }, { files: [image] }))).toEqual({ kind: "files" });
    expect(planPaste(clipboard({ "text/html": "<img src='https://x/y.png'>", Files: "" }, { files: [image] }))).toEqual({ kind: "files" });
    expect(planPaste(clipboard({ "text/plain": "Cells", Files: "" }, { files: [image] }))).toMatchObject({ kind: "blocks" });
    // In a code block too: only text is left to the editor there.
    expect(planPaste(clipboard({ "text/html": "<img src='https://x/y.png'>", Files: "" }, { files: [image], inCode: true }))).toEqual({ kind: "files" });
    expect(planPaste(clipboard({ "text/plain": "let a = 1;" }, { inCode: true }))).toEqual({ kind: "default" });
  });

  it("picks the block by type and keeps the library's size limit", () => {
    expect(fileBlockType("image/png")).toBe("image");
    expect(fileBlockType("video/mp4")).toBe("video");
    expect(fileBlockType("audio/mpeg")).toBe("audio");
    expect(fileBlockType("application/pdf")).toBe("file");
    expect(fileBlockType("")).toBe("file");
    expect(fileFits(25 * 1024 * 1024)).toBe(true);
    expect(fileFits(25 * 1024 * 1024 + 1)).toBe(false);
  });

  it("keeps saying pending until the scan is clean or refused, checking less often over time", () => {
    expect(afterScanCheck("pending")).toBe("pending");
    expect(afterScanCheck("unknown")).toBe("pending");
    expect(afterScanCheck("clean")).toBe("done");
    expect(afterScanCheck("refused")).toBe("refused");
    const total = Array.from({ length: MAX_SCAN_CHECKS }, (_, i) => nextScanCheckMs(i)).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(20 * 60_000);
    expect(total).toBeLessThan(45 * 60_000);
    expect(nextScanCheckMs(0)).toBe(2000);
    expect(nextScanCheckMs(1)).toBeGreaterThan(nextScanCheckMs(0));
    expect(nextScanCheckMs(50)).toBe(30_000);
  });

  it("says in the block that the scan is pending, in both languages", () => {
    expect(createEditorT("en")("units.e1.file.pending", { name: "a.png" })).toContain("Security check pending for a.png");
    expect(createEditorT("fr-CA")("units.e1.file.pending", { name: "a.png" })).toContain("Vérification de sécurité en cours pour a.png");
    expect(createEditorT("en")("units.e1.file.refused", { name: "a.png" })).toContain("did not pass the security check");
  });
});

describe("E1-5 unsafe HTML inserts only safe text", () => {
  const hostile =
    `<p onclick="alert(1)" style="background:url(javascript:alert(2))">Hello <a href="javascript:alert(3)">click</a> ` +
    `<a href=" JaVa&#x09;ScRiPt:alert(4)">tab</a> <a href="data:text/html,<script>alert(5)</script>">data</a></p>` +
    `<script>alert(6)</script><style>p{}</style><iframe src="https://evil.example"></iframe><img src=x onerror="alert(7)">` +
    `<object data="x.swf">obj</object><svg><script>alert(8)</script></svg><form><button>btn</button></form>` +
    `<template><p>hidden</p></template><!-- <script>alert(9)</script> --><a href="vbscript:x">vb</a><a href="//evil.example">proto</a>`;

  it("keeps the text and drops scripts, handlers, frames and unsafe links", () => {
    const blocks = htmlToBlocks(hostile);
    const json = JSON.stringify(blocks);
    expect(json).not.toMatch(/alert|javascript|script|onerror|onclick|iframe|evil|data:|vbscript|hidden|btn|obj/i);
    expect(shape(blocks)).toEqual([
      { type: "paragraph", text: "Hello click tab data" },
      { type: "paragraph", text: "vbproto" },
    ]);
    expect(json).not.toContain('"type":"link"');
  });

  it("cleans HTML pasted into a code block when it comes without text", () => {
    const plan = planPaste(clipboard({ "text/html": `<p>Hi<script>alert(1)</script></p>` }, { inCode: true }));
    expect(plan).toMatchObject({ kind: "blocks", source: "html" });
    expect(JSON.stringify(plan)).not.toMatch(/alert|script/);
  });

  it("cleans the editor's own clipboard format the same way", () => {
    const clean = sanitizeHtml(
      `<div data-content-type="paragraph" onmouseover="alert(1)"><p class="bn-inline-content">Hi <a href="javascript:alert(2)">x</a><a href="https://ok.example">ok</a></p></div>` +
        `<script>alert(3)</script><iframe src="x"></iframe><img src="javascript:alert(4)" onerror="alert(5)"><img src="qbbe-document:11111111-1111-1111-1111-111111111111">` +
        `<input type="checkbox" checked onfocus="alert(6)" autofocus>`,
    );
    expect(clean).not.toMatch(/alert|javascript|onerror|onmouseover|onfocus|autofocus|iframe|script/i);
    expect(clean).toContain('data-content-type="paragraph"');
    expect(clean).toContain('<a href="https://ok.example">ok</a>');
    expect(clean).toContain('<img src="qbbe-document:11111111-1111-1111-1111-111111111111">');
    expect(clean).toContain('<input type="checkbox" checked="">');
    const plan = planPaste(clipboard({ "blocknote/html": `<p>x</p><script>alert(1)</script>`, "text/html": "<p>x</p>" }));
    expect(plan).toEqual({ kind: "internal", html: "<p>x</p>" });
  });

  it("allows only web, mail, phone and on-site addresses", () => {
    expect(safeHref("https://qbbe.ca")).toBe("https://qbbe.ca");
    expect(safeHref("mailto:a@b.ca")).toBe("mailto:a@b.ca");
    expect(safeHref("tel:+15145550000")).toBe("tel:+15145550000");
    expect(safeHref("/pages/abc#block-1")).toBe("/pages/abc#block-1");
    expect(safeHref("#top")).toBe("#top");
    for (const bad of ["javascript:alert(1)", "java\u0000script:x", " javascript:x", "JAVASCRIPT:x", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "//evil.example", "relative/path", "x:y"]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });

  it("does not let unclosed or deeply nested markup slow the reader down", () => {
    const start = Date.now();
    htmlToBlocks("<a ".repeat(50_000) + "<div>".repeat(20_000) + "text");
    htmlToBlocks("<b<b<b".repeat(30_000) + ">");
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});

describe("E1-6 Markdown shortcuts at the start of a line", () => {
  it("knows every shortcut", () => {
    for (let level = 1; level <= 6; level++) expect(lineShortcut(`${"#".repeat(level)} x`)?.block).toEqual({ type: "heading", props: { level } });
    expect(lineShortcut("####### x")).toBeNull();
    expect(lineShortcut("- x")?.block.type).toBe("bulletListItem");
    expect(lineShortcut("* x")?.block.type).toBe("bulletListItem");
    expect(lineShortcut("1. x")?.block).toEqual({ type: "numberedListItem" });
    expect(lineShortcut("[] x")?.block).toEqual({ type: "checkListItem", props: { checked: false } });
    expect(lineShortcut("> x")?.block).toEqual({ type: "quote" });
    expect(lineShortcut(">! x")?.block).toEqual({ type: "callout", props: { tone: "info" } });
    expect(isDividerLine("---")).toBe(true);
    expect(isDividerLine("----")).toBe(false);
    expect(codeFence("```")).toEqual({ language: "text" });
    expect(codeFence("```Python")).toEqual({ language: "python" });
    expect(codeFence("```<script>")).toEqual({ language: "text" });
  });

  it("needs the shortcut at the start of the line, followed by a space", () => {
    expect(lineShortcut("#x")).toBeNull();
    expect(lineShortcut("x # y")).toBeNull();
    expect(lineShortcut(">!x")).toBeNull();
    expect(lineShortcut("1.x")).toBeNull();
  });
});

describe("E1-7 a paste larger than the editor's limit is refused", () => {
  it("refuses text over the limit before reading it", () => {
    expect(planPaste(clipboard({ "text/plain": "x".repeat(MAX_SAVE_CHARS + 1) }))).toEqual({ kind: "tooLarge" });
    expect(planPaste(clipboard({ "text/plain": "x".repeat(MAX_SAVE_CHARS + 1) }, { inCode: true }))).toEqual({ kind: "tooLarge" });
  });

  it("refuses a paste that would take the document past the limit, counting its saved state", () => {
    expect(exceedsLimit(0, 100_000)).toBe(false);
    expect(exceedsLimit(MAX_SAVE_CHARS - 1000, 1000)).toBe(true);
    const lines = Array.from({ length: 1_000 }, (_, i) => `Line ${i} ${"word ".repeat(30)}`).join("\n");
    expect(planPaste(clipboard({ "text/plain": lines }))).toMatchObject({ kind: "blocks" });
    expect(planPaste(clipboard({ "text/plain": lines }, { documentChars: MAX_SAVE_CHARS - 50_000 }))).toEqual({ kind: "tooLarge" });
  });

  it("does not read HTML larger than its own limit, and falls back to the text", () => {
    const huge = "<p>" + "x".repeat(MAX_HTML_CHARS) + "</p>";
    expect(planPaste(clipboard({ "text/html": huge }))).toEqual({ kind: "tooLarge" });
    expect(planPaste(clipboard({ "text/html": huge, "text/plain": "small" }))).toMatchObject({ kind: "blocks", source: "text" });
  });

  it("says so with the editor's existing words, in both languages", () => {
    expect(createEditorT("en")("save.tooLarge")).toMatch(/too large to save/);
    expect(createEditorT("fr-CA")("units.e1.tooLarge.title")).toBe("Rien n'a été collé.");
  });
});
