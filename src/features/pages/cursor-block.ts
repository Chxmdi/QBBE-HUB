/**
 * Which editor block the cursor is in (U9). The block editor marks every
 * block's outer element with the block's id (`data-id`), the same id the
 * saved document, the derived `block` rows and a block comment use. Reads
 * the browser's selection, so it answers null on the server and when the
 * cursor is outside the editor.
 */

const BLOCK_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function blockIdAt(node: Node | null | undefined, editorSelector = ".qbbe-editor"): string | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const block = element?.closest("[data-id]");
  if (!block || !block.closest(editorSelector)) return null;
  const id = block.getAttribute("data-id") ?? "";
  return BLOCK_ID.test(id) ? id : null;
}

export function cursorBlockId(): string | null {
  if (typeof document === "undefined") return null;
  const selection = document.getSelection();
  return blockIdAt(selection?.focusNode ?? selection?.anchorNode ?? null);
}
