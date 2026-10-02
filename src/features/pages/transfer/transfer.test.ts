import { describe, expect, it } from "vitest";
import { crc32 as nodeCrc32 } from "node:zlib";
import type { EditorBlock, EditorContent, InlineContent } from "@/features/editor/adapter/content";
import { htmlToContent } from "./html";
import { checkImportFile, importKind, IMPORT_MAX_BYTES } from "./limits";
import { contentToMarkdown, markdownToContent, parseInline } from "./markdown";
import { buildPageExport, findViewBlocks, importToContent, slug, titleFromFileName } from "./transfer";
import { createZip, crc32 } from "./zip";
import { readAtMost } from "./body";

// ---------------------------------------------------------------------------
// Helpers

const t = (text: string, styles?: Record<string, true>): InlineContent => (styles ? { type: "text", text, styles } : { type: "text", text });
const p = (...content: InlineContent[]): EditorBlock => ({ type: "paragraph", content });
const doc = (...blocks: EditorBlock[]): EditorContent => ({ version: 1, blocks });

/** What a round trip must keep: types, levels, checks, languages, tones, styled text and links, cell text. Ids, colours and empty paragraphs are not content. */
function canonical(blocks: EditorBlock[]): unknown[] {
  return blocks
    .filter((b) => !(b.type === "paragraph" && (!Array.isArray(b.content) || b.content.length === 0) && !b.children?.length))
    .map((b) => {
      const props: Record<string, unknown> = {};
      if (b.type === "heading") props.level = b.props?.level ?? 1;
      if (b.type === "checkListItem") props.checked = b.props?.checked === true;
      if (b.type === "codeBlock" && b.props?.language) props.language = b.props.language;
      if (b.type === "callout") props.tone = b.props?.tone ?? "info";
      let content: unknown = b.content ?? [];
      if (b.content && !Array.isArray(b.content) && typeof b.content === "object") {
        content = b.content.rows.map((row) =>
          row.cells.map((cell) => inline(Array.isArray(cell) ? (cell as InlineContent[]) : ((cell as { content?: InlineContent[] }).content ?? []))),
        );
      } else if (Array.isArray(b.content)) content = inline(b.content);
      return { type: b.type, props, content, children: canonical(b.children ?? []) };
    });
}

function inline(items: InlineContent[]): unknown[] {
  const out: { text?: string; styles?: string[]; href?: string; content?: unknown[] }[] = [];
  for (const item of items) {
    if (item.type === "link") {
      out.push({ href: (item as { href: string }).href, content: inline((item as { content: InlineContent[] }).content) });
      continue;
    }
    const run = item as { text: string; styles?: Record<string, unknown> };
    const styles = Object.keys(run.styles ?? {}).filter((k) => run.styles![k] === true).sort();
    const last = out[out.length - 1];
    if (last && last.text !== undefined && last.styles?.join() === styles.join()) last.text += run.text;
    else out.push({ text: run.text, styles });
  }
  return out.filter((r) => r.text !== "");
}

const roundTrip = (content: EditorContent, title = "Handbook") => {
  const markdown = contentToMarkdown(content, { title });
  const back = markdownToContent(markdown);
  return { markdown, back };
};

/** Every text block the editor has, with the styles and nesting Markdown can carry. */
const EVERYTHING = doc(
  { type: "heading", props: { level: 1 }, content: [t("Welcome")] },
  p(t("Plain, "), t("bold", { bold: true }), t(" and "), t("italic", { italic: true }), t(", "), t("both", { bold: true, italic: true }), t(", "), t("gone", { strike: true }), t(" and "), t("code()", { code: true }), t(".")),
  p(t("A "), { type: "link", href: "https://example.org/a_(b)?q=1", content: [t("link with "), t("style", { bold: true })] }, t(" and a mail "), { type: "link", href: "mailto:team@example.org", content: [t("address")] }),
  p(t("First line\nsecond line after a break")),
  { type: "heading", props: { level: 2 }, content: [t("Lists")] },
  { type: "bulletListItem", content: [t("One")], children: [{ type: "bulletListItem", content: [t("One point one")], children: [{ type: "numberedListItem", content: [t("Deep")] }] }] },
  { type: "bulletListItem", content: [t("Two")] },
  { type: "numberedListItem", content: [t("First")] },
  { type: "numberedListItem", content: [t("Second")], children: [p(t("A paragraph inside the item"))] },
  { type: "checkListItem", props: { checked: true }, content: [t("Done")] },
  { type: "checkListItem", props: { checked: false }, content: [t("To do")], children: [{ type: "checkListItem", props: { checked: false }, content: [t("Sub task")] }] },
  { type: "heading", props: { level: 3 }, content: [t("Quotes and code")] },
  { type: "quote", content: [t("Education is the passport to the future.")] },
  { type: "callout", props: { tone: "warning" }, content: [t("Mind the deadline")] },
  { type: "codeBlock", props: { language: "typescript" }, content: [t("const a = `x`;\n```\nif (a) { return **a**; }")] },
  { type: "codeBlock", props: {}, content: [t("plain text")] },
  { type: "divider" },
  {
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [{ type: "tableCell", content: [t("Name")] }, { type: "tableCell", content: [t("Role")] }] },
        { cells: [{ type: "tableCell", content: [t("Ada | Lovelace")] }, { type: "tableCell", content: [t("Chair", { bold: true })] }] },
        { cells: [[t("Line\nbreak")], []] },
      ],
    },
  },
  { type: "heading", props: { level: 6 }, content: [t("Small print #")] },
  p(t("# not a heading, - not a list, 1. not numbered, > not a quote, [not](a link), *not italic*, a_b_c, <b>not bold</b>, &amp; stays, | pipe \\ slash ~~no~~ `no`")),
  p(),
);

// ---------------------------------------------------------------------------
// X1-1: export as Markdown that round-trips the text blocks

describe("X1-1 Markdown export", () => {
  it("writes the title and each text block as the Markdown people expect", () => {
    const markdown = contentToMarkdown(
      doc(
        { type: "heading", props: { level: 2 }, content: [t("Agenda")] },
        { type: "bulletListItem", content: [t("Budget")], children: [{ type: "bulletListItem", content: [t("Q3")] }] },
        { type: "numberedListItem", content: [t("Open")] },
        { type: "numberedListItem", content: [t("Close")] },
        { type: "checkListItem", props: { checked: true }, content: [t("Minutes")] },
        { type: "quote", content: [t("Quoted")] },
        { type: "codeBlock", props: { language: "sql" }, content: [t("select 1;")] },
        { type: "table", content: { type: "tableContent", rows: [{ cells: [[t("A")], [t("B")]] }, { cells: [[t("1")], [t("2")]] }] } },
        { type: "divider" },
        p(t("Bye", { bold: true })),
      ),
      { title: "Board meeting" },
    );
    expect(markdown).toBe(
      [
        "# Board meeting",
        "",
        "## Agenda",
        "",
        "- Budget",
        "  - Q3",
        "1. Open",
        "2. Close",
        "- [x] Minutes",
        "",
        "> Quoted",
        "",
        "```sql",
        "select 1;",
        "```",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "---",
        "",
        "**Bye**",
        "",
      ].join("\n"),
    );
  });

  it("round-trips headings, lists, checklists, quotes, callouts, code, tables, dividers and inline styles", () => {
    const { back } = roundTrip(EVERYTHING);
    expect(back.title).toBe("Handbook");
    expect(canonical(back.content.blocks)).toEqual(canonical(EVERYTHING.blocks));
  });

  it("is stable: exporting the imported page gives the same file", () => {
    const { markdown, back } = roundTrip(EVERYTHING);
    expect(contentToMarkdown(back.content, { title: back.title ?? "" })).toBe(markdown);
  });

  it("keeps text that looks like Markdown as text", () => {
    const { back } = roundTrip(doc(p(t("1. one")), p(t("- dash")), p(t("## two")), p(t("---")), p(t("> q")), p(t("+ plus")), p(t("=="))));
    expect(back.content.blocks.map((b) => b.type)).toEqual(Array(7).fill("paragraph"));
    expect(back.content.blocks.map((b) => (b.content as { text: string }[])[0].text)).toEqual(["1. one", "- dash", "## two", "---", "> q", "+ plus", "=="]);
  });

  it("flattens layout blocks and keeps the readable text of blocks Markdown has no form for", () => {
    const markdown = contentToMarkdown(
      doc(
        { type: "columnList", children: [{ type: "column", children: [p(t("Left"))] }, { type: "column", children: [p(t("Right"))] }] },
        { type: "image", props: { url: "https://example.org/a.png", caption: "Logo" } },
        { type: "file", props: { url: "doc:123", name: "Minutes.pdf" } },
        { type: "embed", props: { url: "javascript:alert(1)" } },
        { type: "toggleListItem", content: [t("Toggle")] },
      ),
    );
    expect(markdown).toBe("Left\n\nRight\n\n[Logo](https://example.org/a.png)\n\nMinutes.pdf\n\n- Toggle\n");
  });

  it("never writes an unsafe link", () => {
    const markdown = contentToMarkdown(doc(p({ type: "link", href: "javascript:alert(1)", content: [t("click")] })));
    expect(markdown).toBe("click\n");
  });
});

// ---------------------------------------------------------------------------
// X1-2: view blocks as CSV files zipped with the Markdown

function readZip(bytes: Uint8Array): { name: string; text: string }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { name: string; text: string }[] = [];
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const data = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    expect(crc32(data)).toBe(view.getUint32(at + 14, true));
    out.push({ name, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(data) });
    at += 30 + nameLength + size;
  }
  // The central directory lists every entry.
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(out.length);
  return out;
}

const viewBlock = (title: string): EditorBlock => ({
  type: "query",
  props: { preset: "my_open", spec: JSON.stringify({ version: 2, source: { type: "task" }, title }) },
});

describe("X1-2 view blocks as CSV", () => {
  it("finds view blocks anywhere in the page and skips the legacy preset list", () => {
    const content = doc(
      viewBlock("Top"),
      { type: "query", props: { preset: "my_open", spec: "{}" } },
      { type: "columnList", children: [{ type: "column", children: [viewBlock("In a column")] }] },
    );
    const found = findViewBlocks(content);
    expect(found.map((v) => (v.raw as { title: string }).title)).toEqual(["Top", "In a column"]);
  });

  it("zips the Markdown with one CSV per view, linked from where the view was", () => {
    const first = viewBlock("Open tasks");
    const second = viewBlock("Hidden");
    const content = doc(p(t("Before")), first, second);
    const out = buildPageExport({
      title: "Équipe été",
      content,
      date: new Date("2031-03-03T12:00:00Z"),
      views: [
        { block: first, name: "Open tasks", csv: "\uFEFFTitle,Status\r\nFile the report,Ready\r\n" },
        { block: second, name: "Hidden", csv: null },
      ],
    });
    expect(out.kind).toBe("zip");
    expect(out.fileName).toBe("equipe-ete-2031-03-03.zip");
    const files = readZip(out.body as Uint8Array);
    expect(files.map((f) => f.name)).toEqual(["equipe-ete-2031-03-03.md", "views/01-open-tasks.csv"]);
    expect(files[0].text).toBe("# Équipe été\n\nBefore\n\n[Open tasks](views/01-open-tasks.csv)\n\nHidden\n");
    expect(files[1].text).toBe("\uFEFFTitle,Status\r\nFile the report,Ready\r\n");
  });

  it("is a single Markdown file when no view could be exported", () => {
    const out = buildPageExport({ title: "", content: doc(p(t("Only text"))), views: [], date: new Date("2031-03-03T00:00:00Z") });
    expect(out).toEqual({ kind: "markdown", fileName: "page-2031-03-03.md", body: "Only text\n" });
  });

  it("checksums every entry as zip tools do", () => {
    const data = new TextEncoder().encode("Montréal, QC");
    expect(crc32(data)).toBe(nodeCrc32(data));
    const zip = createZip([{ name: "a.txt", data }]);
    expect(readZip(zip)).toEqual([{ name: "a.txt", text: "Montréal, QC" }]);
  });

  it("names files safely", () => {
    expect(slug("../../etc/passwd", "x")).toBe("etc-passwd");
    expect(slug("***", "page")).toBe("page");
    expect(titleFromFileName("C:\\Users\\me\\board_minutes.md")).toBe("board minutes");
  });
});

// ---------------------------------------------------------------------------
// X1-3: import Markdown or HTML as a new page, unsafe HTML stripped

const UNSAFE_PATTERN = /script|javascript:|onerror|onclick|alert|iframe|<style|evil/i;

describe("X1-3 import", () => {
  it("reads a Markdown file into the same blocks, its first heading as the title", () => {
    const { title, content } = importToContent(
      "markdown",
      "\uFEFF# Plan d’été\r\n\r\nIntro *here*\r\ncontinued\r\n\r\n* [ ] task\r\n* [X] done\r\n\r\n1) one\r\n2) two\r\n\r\n~~~python\r\nprint(1)\r\n~~~\r\n\r\n***\r\n\r\n| a | b |\r\n|:-|-:|\r\n| 1 |\r\n\r\n> [!TIP]\r\n> Nice\r\n",
      "plan.md",
    );
    expect(title).toBe("Plan d’été");
    expect(canonical(content.blocks)).toEqual(
      canonical([
        p(t("Intro "), t("here", { italic: true }), t(" continued")),
        { type: "checkListItem", props: { checked: false }, content: [t("task")] },
        { type: "checkListItem", props: { checked: true }, content: [t("done")] },
        { type: "numberedListItem", content: [t("one")] },
        { type: "numberedListItem", content: [t("two")] },
        { type: "codeBlock", props: { language: "python" }, content: [t("print(1)")] },
        { type: "divider" },
        { type: "table", content: { type: "tableContent", rows: [{ cells: [[t("a")], [t("b")]] }, { cells: [[t("1")], []] }] } },
        { type: "callout", props: { tone: "success" }, content: [t("Nice")] },
      ]),
    );
  });

  it("takes the title from the file name when the file has no leading heading", () => {
    expect(importToContent("markdown", "Just text", "notes_2031.md").title).toBe("notes 2031");
  });

  it("reads an HTML file into the same blocks as the Markdown it matches", () => {
    const html = `<!doctype html><html><head><title>Ignored title</title><style>p{color:red}</style></head><body>
      <h1>Handbook</h1>
      <h2>Lists</h2>
      <ul><li>One<ul><li>One point <b>one</b></li></ul></li><li>Two</li></ul>
      <ol><li><p>First</p></li><li>Second</li></ol>
      <ul class="contains-task-list"><li><input type="checkbox" checked disabled> Done</li><li><input type="checkbox"> To do</li></ul>
      <blockquote><p>Quoted <em>words</em></p></blockquote>
      <pre><code class="language-js">let a = 1 &lt; 2;
console.log(a);</code></pre>
      <hr>
      <table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Ada</td><td><strong>Chair</strong></td></tr></tbody></table>
      <p>Line<br>break and <a href="https://example.org">a link</a> &amp; <s>old</s> <code>x</code></p>
      <div>Loose text in a div</div>
    </body></html>`;
    const markdown = [
      "# Handbook",
      "## Lists",
      "- One\n  - One point **one**\n- Two",
      "1. First\n2. Second",
      "- [x] Done\n- [ ] To do",
      "> Quoted *words*",
      "```js\nlet a = 1 < 2;\nconsole.log(a);\n```",
      "---",
      "| Name | Role |\n| --- | --- |\n| Ada | **Chair** |",
      "Line\\\nbreak and [a link](https://example.org) &amp; ~~old~~ `x`",
      "Loose text in a div",
    ].join("\n\n");
    const fromHtml = htmlToContent(html);
    const fromMarkdown = markdownToContent(markdown);
    expect(fromHtml.title).toBe("Handbook");
    expect(canonical(fromHtml.content.blocks)).toEqual(canonical(fromMarkdown.content.blocks));
  });

  it("strips unsafe HTML: scripts, handlers, frames, styles and javascript: links leave only safe text", () => {
    const html = `<p onclick="alert(1)">Safe <b onmouseover="alert(2)">text</b></p>
      <script>alert("evil")</script><SCRIPT src="https://evil.example/x.js"></SCRIPT>
      <img src="x" onerror="alert(3)"><img src="javascript:alert(4)" alt="pic">
      <a href="javascript:alert(5)">click me</a> <a href=" JaVaScRiPt:alert(6)">again</a> <a href="data:text/html,evil">data</a>
      <iframe src="https://evil.example"></iframe><object data="evil.swf"></object><embed src="evil">
      <style>body{background:url(javascript:alert(7))}</style>
      <form action="https://evil.example"><input name="password"><button>Send</button></form>
      <svg><script>alert(8)</script></svg><math><mi xlink:href="javascript:alert(9)">x</mi></math>
      <!-- <script>alert(10)</script> -->
      <p>End</p>`;
    const { content } = htmlToContent(html);
    const json = JSON.stringify(content);
    expect(json).not.toMatch(UNSAFE_PATTERN);
    expect(canonical(content.blocks)).toEqual(canonical([p(t("Safe "), t("text", { bold: true })), p(t("pic click me again data")), p(t("End"))]));
  });

  it("strips raw HTML inside Markdown too", () => {
    const { content } = markdownToContent(
      'Hello <span onclick="alert(1)">there</span><script>alert("evil")</script> [x](javascript:alert(2)) <iframe src="https://evil.example"></iframe>done\n\n<style>p{}</style>\n\n[ok](https://example.org "title")',
    );
    expect(JSON.stringify(content)).not.toMatch(UNSAFE_PATTERN);
    expect(canonical(content.blocks)).toEqual(
      canonical([p(t("Hello there x done")), p({ type: "link", href: "https://example.org", content: [t("ok")] })]),
    );
  });

  it("reads hostile files in linear time and without overflowing the stack", () => {
    const size = 400_000;
    const inputs = [
      "*".repeat(size),
      "[".repeat(size),
      "`` ` ".repeat(size / 5),
      "**a ".repeat(size / 4),
      "- ".repeat(size / 2),
      "> ".repeat(size / 2),
      "<div>".repeat(size / 5),
      "<b><i>".repeat(size / 6),
      "](".repeat(size / 2),
    ];
    const started = Date.now();
    for (const input of inputs) {
      expect(() => markdownToContent(input)).not.toThrow();
      expect(() => htmlToContent(input)).not.toThrow();
    }
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it("nests emphasis as written", () => {
    expect(inline(parseInline("***x*** *a **b** c* __d__ _e_ snake_case_name"))).toEqual(
      inline([
        t("x", { bold: true, italic: true }),
        t(" "),
        t("a ", { italic: true }),
        t("b", { bold: true, italic: true }),
        t(" c", { italic: true }),
        t(" "),
        t("d", { bold: true }),
        t(" "),
        t("e", { italic: true }),
        t(" snake_case_name"),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// X1-4: only Markdown and HTML, and only up to the size limit

describe("X1-4 import limits", () => {
  it("accepts Markdown and HTML files by name and refuses the rest", () => {
    expect(importKind("a.md")).toBe("markdown");
    expect(importKind("a.MARKDOWN")).toBe("markdown");
    expect(importKind("a.txt")).toBe("markdown");
    expect(importKind("a.HTM")).toBe("html");
    expect(importKind("a.docx")).toBeNull();
    expect(importKind("a.md.exe")).toBeNull();
    expect(importKind("md")).toBeNull();
  });

  it("refuses files over the limit and empty files", () => {
    expect(checkImportFile({ name: "a.md", size: IMPORT_MAX_BYTES })).toBeNull();
    expect(checkImportFile({ name: "a.md", size: IMPORT_MAX_BYTES + 1 })).toBe("tooLarge");
    expect(checkImportFile({ name: "a.md", size: 0 })).toBe("empty");
    expect(checkImportFile({ name: "a.pdf", size: 10 })).toBe("unsupported");
  });
});

// ---------------------------------------------------------------------------
// Found in review: each would have broken a round trip or a limit.

describe("X1 review fixes", () => {
  it("keeps neighbouring styles apart and shares a style across runs", () => {
    const content = doc(
      p(t("a", { bold: true }), t("b", { italic: true })),
      p(t("a", { bold: true }), t("b", { bold: true, italic: true })),
      p(t("x", { italic: true }), t("y", { italic: true, strike: true }), t("z", { strike: true })),
    );
    const { back } = roundTrip(content);
    expect(canonical(back.content.blocks)).toEqual(canonical(content.blocks));
    expect(contentToMarkdown(content)).toBe("**a**<!-- -->*b*\n\n**a*b***\n\n*x~~y~~*~~z~~\n");
  });

  it("keeps a title or heading ending in # and drops a trailing line break", () => {
    const content = doc({ type: "heading", props: { level: 2 }, content: [t("C #")] }, p(t("a\n")));
    const { back } = roundTrip(content, "Plan #");
    expect(back.title).toBe("Plan #");
    expect(canonical(back.content.blocks)).toEqual(canonical(doc({ type: "heading", props: { level: 2 }, content: [t("C #")] }, p(t("a"))).blocks));
  });

  it("falls back to the file name when the leading heading is empty", () => {
    expect(importToContent("markdown", "#\n\nhello", "notes.md").title).toBe("notes");
  });

  it("escapes how a view's line starts", () => {
    const block = viewBlock("x");
    const out = buildPageExport({ title: "", content: doc(block), views: [{ block, name: "- Q3 # numbers", csv: null }], date: new Date("2031-01-01") });
    expect(out.body).toBe("\\- Q3 # numbers\n");
    expect(markdownToContent(out.body as string).content.blocks[0].type).toBe("paragraph");
  });

  it("keeps a link whose unquoted address ends in a slash", () => {
    const { content } = htmlToContent("<p><a href=https://example.com/>Example</a> after</p><svg/><p>still here</p>");
    expect(canonical(content.blocks)).toEqual(
      canonical([p({ type: "link", href: "https://example.com/", content: [t("Example")] }, t(" after")), p(t("still here"))]),
    );
  });

  it("reads hostile link targets and checkbox lists in linear time", () => {
    const started = Date.now();
    markdownToContent("[](".repeat(300_000));
    markdownToContent("[](<".repeat(200_000));
    markdownToContent(`[a](${" ".repeat(400_000)}`);
    htmlToContent(`<ul><li>x${"<input type=checkbox>".repeat(40_000)}</li></ul>`);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("X1-4 upload ceiling", () => {
  const streamed = (chunks: number[]) =>
    new Request("http://localhost/api/pages/import", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          for (const size of chunks) controller.enqueue(new Uint8Array(size).fill(97));
          controller.close();
        },
      }),
      // A streamed body sends no Content-Length.
      duplex: "half",
    } as RequestInit);

  it("reads a body that stays under the ceiling", async () => {
    const body = await readAtMost(streamed([100, 200]), 1000);
    expect(body).not.toBe("tooLarge");
    expect((body as Uint8Array).length).toBe(300);
  });

  it("stops reading a body without a declared size as soon as it passes the ceiling", async () => {
    expect(await readAtMost(streamed([600, 600, 600]), 1000)).toBe("tooLarge");
  });
});

describe("X1 second review fixes", () => {
  it("reads a link with spaces around its target", () => {
    const { content } = markdownToContent("see [a]( http://x.org ) end, [b]( <https://y.org/b> ) and [c](https://z.org \"Title\")");
    expect(canonical(content.blocks)).toEqual(
      canonical([
        p(
          t("see "),
          { type: "link", href: "http://x.org", content: [t("a")] },
          t(" end, "),
          { type: "link", href: "https://y.org/b", content: [t("b")] },
          t(" and "),
          { type: "link", href: "https://z.org", content: [t("c")] },
        ),
      ]),
    );
  });

  it("does not let a self-closed dropped element hide the rest of the file", () => {
    const { content } = htmlToContent("<p>one</p><form action=x/><p>two</p><button/><p>three</p><select/><p>four</p>");
    expect(canonical(content.blocks)).toEqual(canonical([p(t("one")), p(t("two")), p(t("three")), p(t("four"))]));
  });
});
