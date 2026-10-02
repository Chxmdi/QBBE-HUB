"use client";

import * as React from "react";
import { createCodeBlockConfig, defaultBlockSpecs, parsePreCode, parsePreCodeContent } from "@blocknote/core";
import { createReactBlockSpec, type ReactCustomBlockRenderProps } from "@blocknote/react";
import { Check, Copy } from "lucide-react";
import { Select } from "@/components/ui/input";
import type { EditorT } from "@/features/editor/i18n";
import { framed } from "../block-frame";
import { CODE_LANGUAGES, codeLanguage, codeLanguageName, codeText } from "./e3-helpers";

/**
 * Unit E3: the code block, with a named language picker and a copy button
 * that copies the code exactly as written. It keeps BlockNote's own type,
 * props, parsing and keyboard handling (Tab indents), so saved pages and
 * pasted ``` blocks are unchanged; only its view is the workspace's.
 */

const codeConfig = createCodeBlockConfig({ defaultLanguage: "text" });
type CodeProps = ReactCustomBlockRenderProps<typeof codeConfig>;

/** Keeps the picker's keys away from the editor's key handling. */
const isolateKeys = (event: React.KeyboardEvent) => event.stopPropagation();

/** Says something in the editor's live region (the same one the block menu uses). */
function announce(text: string) {
  const live = document.getElementById("qbbe-editor-live");
  if (!live) return;
  live.textContent = "";
  live.textContent = text;
}

/** Writes text to the clipboard, with the older copy command as a fallback. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

function CodeBlockView({ block, editor, contentRef, t }: CodeProps & { t: EditorT }) {
  const stored = String(block.props.language ?? "");
  const known = codeLanguage(stored);
  const empty = codeText(block.content).length === 0;
  const [copied, setCopied] = React.useState(false);
  const languageName = known ? codeLanguageName(known, t) : t("units.e3.code.other", { language: stored });

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    // The block as it is now, not as it was when this view last rendered.
    const current = editor.getBlock(block.id) ?? block;
    const ok = await copyToClipboard(codeText(current.content));
    setCopied(ok);
    announce(t(ok ? "units.e3.code.copied" : "units.e3.code.copyFailed"));
  };

  return (
    <div className="qbbe-code-block" data-language={known ?? stored}>
      <div className="qbbe-code-bar" contentEditable={false} onKeyDown={isolateKeys}>
        {editor.isEditable ? (
          <Select
            aria-label={t("units.e3.code.language")}
            className="qbbe-code-language h-7 w-auto"
            value={known ?? stored}
            onChange={(event) => editor.updateBlock(block, { props: { language: event.target.value } })}
          >
            {known ? null : <option value={stored}>{languageName}</option>}
            {CODE_LANGUAGES.map((id) => (
              <option key={id} value={id}>
                {codeLanguageName(id, t)}
              </option>
            ))}
          </Select>
        ) : (
          <span className="qbbe-code-language-name">{languageName}</span>
        )}
        {empty ? (
          <span className="qbbe-code-empty">{t(editor.isEditable ? "units.e3.code.empty" : "units.e3.code.emptyReadOnly")}</span>
        ) : null}
        <button type="button" className="qbbe-code-copy" aria-label={t("units.e3.code.copy")} title={t("units.e3.code.copy")} onClick={() => void copy()}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </button>
      </div>
      <pre className="qbbe-code-pre">
        <code ref={contentRef} className={`language-${known ?? stored}`} />
      </pre>
    </div>
  );
}

/** The code block's framed implementation (exported for its test). */
export function codeImplementation(t: EditorT) {
  return framed<typeof codeConfig>("codeBlock", {
    meta: { code: true, defining: true, isolating: false },
    parse: (el) => parsePreCode(el),
    parseContent: (options) => parsePreCodeContent(options, "codeBlock"),
    render: (props) => <CodeBlockView {...(props as CodeProps)} t={t} />,
    toExternalHTML: ({ block, contentRef }) => (
      <pre>
        <code ref={contentRef} className={`language-${block.props.language}`} data-language={block.props.language} />
      </pre>
    ),
  });
}

export function createCodeBlock(t: EditorT) {
  return createReactBlockSpec(
    codeConfig,
    codeImplementation(t),
    // BlockNote's own keyboard handling: Tab indents, Enter three times leaves.
    defaultBlockSpecs.codeBlock.extensions as never,
  )();
}
