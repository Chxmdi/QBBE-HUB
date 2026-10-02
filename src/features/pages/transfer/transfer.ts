import { walkBlocks, type EditorBlock, type EditorContent } from "@/features/editor/adapter/content";
import { readStoredViewBlock } from "@/features/lenses/view-block/schema";
import { htmlToContent } from "./html";
import { contentToMarkdown, markdownToContent } from "./markdown";
import type { ImportKind } from "./limits";
import { createZip } from "./zip";

/**
 * What the export and import routes share (wave 2 unit X1), kept pure so the
 * rules are unit-tested: which files are accepted, how big, what the
 * exported files are called and how a page with view blocks is packed.
 */


/** A title from a file name: no extension, separators read as spaces. */
export function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/^.*[\\/]/, "")
    .replace(/\.[A-Za-z0-9]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function importToContent(kind: ImportKind, source: string, fileName: string): { title: string; content: EditorContent } {
  const read = kind === "html" ? htmlToContent(source) : markdownToContent(source);
  return { title: (read.title ?? titleFromFileName(fileName)).slice(0, 200), content: read.content };
}

/** A safe file name part: ascii, dashes, at most 60 characters. */
export function slug(value: string, fallback: string): string {
  const out = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
  return out || fallback;
}

/** The view blocks of a page, in document order, with their stored settings. */
export function findViewBlocks(content: EditorContent): { block: EditorBlock; raw: unknown }[] {
  return walkBlocks(content.blocks).flatMap(({ block }) => {
    if (block.type !== "query") return [];
    const stored = readStoredViewBlock(block.props?.spec);
    return stored.kind === "view" ? [{ block, raw: stored.raw }] : [];
  });
}

export interface ExportedView {
  block: EditorBlock;
  /** What the view is called in the Markdown and its file name. */
  name: string;
  /** The CSV, or null when the view could not be run for this person (it is then named, not exported). */
  csv: string | null;
}

export type PageExport =
  | { kind: "markdown"; fileName: string; body: string }
  | { kind: "zip"; fileName: string; body: Uint8Array };

function escapeLabel(value: string): string {
  return value.replace(/[\\`*_~[\]<|]/g, "\\$&");
}

/**
 * The page as one Markdown file, or, when it holds view blocks, a zip of the
 * Markdown and one CSV per view (`views/01-name.csv`), each view's place in
 * the Markdown linking to its file.
 */
export function buildPageExport(input: { title: string; content: EditorContent; views: ExportedView[]; date?: Date }): PageExport {
  const date = input.date ?? new Date();
  const day = date.toISOString().slice(0, 10);
  const base = `${slug(input.title, "page")}-${day}`;
  const lines = new Map<EditorBlock, string>();
  const files: { name: string; data: Uint8Array }[] = [];
  const encoder = new TextEncoder();
  input.views.forEach((view, index) => {
    if (view.csv === null) {
      lines.set(view.block, escapeLabel(view.name));
      return;
    }
    const path = `views/${String(index + 1).padStart(2, "0")}-${slug(view.name, "view")}.csv`;
    lines.set(view.block, `[${escapeLabel(view.name)}](${path})`);
    files.push({ name: path, data: encoder.encode(view.csv) });
  });
  const markdown = contentToMarkdown(input.content, { title: input.title, viewLine: (block) => lines.get(block) ?? null });
  if (files.length === 0) return { kind: "markdown", fileName: `${base}.md`, body: markdown };
  return {
    kind: "zip",
    fileName: `${base}.zip`,
    body: createZip([{ name: `${base}.md`, data: encoder.encode(markdown) }, ...files], date),
  };
}
