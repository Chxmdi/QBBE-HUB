import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorT } from "@/features/editor/i18n";
import { BlockErrorBoundary, BlockFrame } from "../block-frame";
import { BlockFallback, E3_BLOCK_TYPES, e3BlockSpecs } from "./e3-blocks";
import { codeImplementation, copyToClipboard } from "./e3-code";
import { mediaImplementations } from "./e3-media";
import { CODE_LANGUAGES, codeLanguage, codeLanguageName, codeText, mediaAddress, mediaName, needsAltText } from "./e3-helpers";

const en = createEditorT("en");
const fr = createEditorT("fr-CA");
type Spec = { config: { type: string; content: string; propSchema: Record<string, { default: unknown }> }; implementation: Record<string, unknown> & { meta?: Record<string, unknown> } };
const specs = e3BlockSpecs(en, "en") as Record<string, Spec>;

describe("E3-1 code blocks", () => {
  it("offer at least plain text, JavaScript, TypeScript, Python, SQL, JSON, HTML, CSS and Bash, named in both languages", () => {
    expect([...CODE_LANGUAGES]).toEqual(expect.arrayContaining(["text", "javascript", "typescript", "python", "sql", "json", "html", "css", "bash"]));
    expect(CODE_LANGUAGES.map((id) => codeLanguageName(id, en))).toEqual(["Plain text", "JavaScript", "TypeScript", "Python", "SQL", "JSON", "HTML", "CSS", "Bash"]);
    expect(codeLanguageName("text", fr)).toBe("Texte brut");
    expect(fr("units.e3.code.language")).toBe("Langage du code");
    expect(fr("units.e3.code.copy")).toBe("Copier le code");
  });

  it("read stored and pasted language names, and leave unknown ones alone", () => {
    expect(codeLanguage("js")).toBe("javascript");
    expect(codeLanguage(" TS ")).toBe("typescript");
    expect(codeLanguage("sh")).toBe("bash");
    expect(codeLanguage("")).toBe("text");
    expect(codeLanguage("python")).toBe("python");
    expect(codeLanguage("cobol")).toBeNull();
    expect(codeLanguage(42)).toBe("text");
  });

  it("copy the exact code: every space, tab, line break and character", () => {
    const code = "if (a) {\n\treturn '<b>';  \n}\n";
    expect(codeText([{ type: "text", text: code, styles: {} }])).toBe(code);
    expect(codeText([{ type: "text", text: "a\n", styles: {} }, { type: "text", text: "  b", styles: { bold: true } }])).toBe("a\n  b");
    expect(codeText([{ type: "link", href: "https://x", content: [{ type: "text", text: "url", styles: {} }] }])).toBe("url");
    expect(codeText([])).toBe("");
    expect(codeText(undefined)).toBe("");
  });

  it("keep BlockNote's code block type and props, with code handling on", () => {
    const code = specs.codeBlock;
    expect(code.config.type).toBe("codeBlock");
    expect(code.config.content).toBe("plain");
    expect(code.config.propSchema.language.default).toBe("text");
    expect(code.implementation.meta).toMatchObject({ code: true, defining: true });
  });

  describe("copying", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("writes the text to the clipboard", async () => {
      const writeText = vi.fn(async () => {});
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      expect(await copyToClipboard("a\n\tb")).toBe(true);
      expect(writeText).toHaveBeenCalledWith("a\n\tb");
    });

    it("says so when the clipboard refuses", async () => {
      vi.stubGlobal("navigator", { clipboard: { writeText: async () => Promise.reject(new Error("denied")) } });
      const area = { value: "", style: {}, setAttribute: () => {}, select: () => {}, remove: vi.fn() };
      vi.stubGlobal("document", { createElement: () => area, body: { appendChild: () => {} }, execCommand: () => false });
      expect(await copyToClipboard("x")).toBe(false);
      expect(area.value).toBe("x");
      expect(area.remove).toHaveBeenCalled();
    });
  });
});

describe("E3-2 media blocks", () => {
  it("each have a caption and are replaced under BlockNote's own types; images add alt text", () => {
    expect([...E3_BLOCK_TYPES].sort()).toEqual(Object.keys(specs).sort());
    for (const type of ["image", "video", "audio", "file"]) {
      expect(specs[type].config.type).toBe(type);
      expect(specs[type].config.propSchema.caption.default).toBe("");
      expect(specs[type].implementation.meta?.fileBlockAccept).toBeDefined();
    }
    expect(specs.image.config.propSchema.alt.default).toBe("");
    expect(specs.video.config.propSchema.alt).toBeUndefined();
  });

  it("are named by what they are and what they show, in both languages", () => {
    expect(mediaName("image", { alt: "A red barn", caption: "Farm", name: "barn.jpg" }, en)).toBe("Image: A red barn");
    expect(mediaName("image", { caption: "Farm", name: "barn.jpg" }, en)).toBe("Image: Farm");
    expect(mediaName("image", {}, en)).toBe("Image without a description");
    expect(mediaName("image", {}, fr)).toBe("Image sans description");
    expect(mediaName("video", { name: "clip.mp4" }, en)).toBe("Video: clip.mp4");
    expect(mediaName("video", { name: "clip.mp4" }, fr)).toBe("Vidéo : clip.mp4");
    expect(mediaName("audio", {}, en)).toBe("Audio file");
    expect(mediaName("file", { caption: "Report" }, en)).toBe("File: Report");
    // A damaged name is not read out as "[object Object]".
    expect(mediaName("file", { name: { x: 1 } }, en)).toBe("File");
  });

  it("ask for alt text on an image that has a file but no description", () => {
    expect(needsAltText({ url: "https://x.org/a.png", alt: "" })).toBe(true);
    expect(needsAltText({ url: "https://x.org/a.png", alt: "   " })).toBe(true);
    expect(needsAltText({ url: "https://x.org/a.png", alt: "A dog" })).toBe(false);
    expect(needsAltText({ url: "", alt: "" })).toBe(false);
    expect(en("units.e3.media.altMissing")).toContain("no description");
    expect(fr("units.e3.media.alt")).toBe("Texte de remplacement");
  });
});

describe("E3-3 block fallbacks", () => {
  it("frame every E3 block, so a failure inside one is caught by its own boundary", () => {
    const views = { codeBlock: codeImplementation(en), ...mediaImplementations(en) } as unknown as Record<string, { render: (props: object) => unknown }>;
    expect(Object.keys(views).sort()).toEqual([...E3_BLOCK_TYPES].sort());
    for (const type of E3_BLOCK_TYPES) {
      // The view is drawn inside a BlockFrame (its error boundary), named for the block.
      const drawn = views[type].render({ block: { id: `b-${type}`, type, props: {} } }) as React.ReactElement<{ type: string; blockId: string }>;
      expect(drawn.type, type).toBe(BlockFrame);
      expect(drawn.props).toMatchObject({ type, blockId: `b-${type}` });
    }
  });

  it("show a named fallback with Try again, which draws the block again", () => {
    const onRetry = vi.fn();
    const labels = { message: en("units.e3.fallback.message"), retry: en("units.e3.fallback.retry"), label: (type: string) => en("units.e3.fallback.label", { type }) };
    const html = renderToStaticMarkup(React.createElement(BlockFallback, { type: "Image", blockId: "b1", labels, onRetry }));
    expect(html).toContain('role="note"');
    expect(html).toContain('aria-label="Image block could not be shown"');
    expect(html).toContain("The rest of the page still works.");
    expect(html).toContain(">Try again</button>");

    const boundary = new BlockErrorBoundary({ type: "image", blockId: "b1", children: "image", fallback: (retry) => (retry(), "fallback") });
    boundary.state = { failed: true };
    const setState = vi.spyOn(boundary, "setState").mockImplementation(() => {});
    expect(boundary.render()).toBe("fallback");
    expect(setState).toHaveBeenCalledWith({ failed: false });
    expect(fr("units.e3.fallback.label", { type: "Image" })).toBe("Le bloc Image ne peut pas être affiché");
  });
});

describe("E3-4 invalid and unsupported files", () => {
  it("only library files and secure links are shown; anything else is refused with a message", () => {
    expect(mediaAddress("qbbe-document:0b7d8a3e-5f7c-4a3b-9d5e-2f1c3b4a5d6e")).toBe("library");
    expect(mediaAddress("https://example.org/a.png")).toBe("link");
    expect(mediaAddress("")).toBe("empty");
    expect(mediaAddress(undefined)).toBe("empty");
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "http://example.org/a.png", "qbbe-document:not-a-uuid", "ftp://x.org/a", "not a url", "https://user:pw@x.org/a.png", { url: 1 }]) {
      expect(mediaAddress(bad), String(bad)).toBe(bad && typeof bad === "object" ? "empty" : "unsupported");
    }
    expect(en("units.e3.media.unsupported")).toContain("cannot be shown here");
    expect(fr("units.e3.media.unavailable")).toContain("n’est pas disponible");
    expect(en("units.e3.links.bookmarkUnsupported")).toContain("cannot be opened here");
  });
});
