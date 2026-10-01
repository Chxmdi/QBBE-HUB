"use client";

import * as React from "react";
import { GripVertical } from "lucide-react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  AddBlockButton,
  SideMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useExtension,
  useExtensionState,
  usePortalElement,
} from "@blocknote/react";
import type { EditorT } from "@/features/editor/i18n";
import type { EditorBlock } from "@/features/editor/adapter/content";
import {
  announce,
  COLORS,
  colorBlocks,
  countText,
  copyBlockLink,
  deleteBlocks,
  duplicateBlocks,
  hasColors,
  idsFor,
  moveAndAnnounce,
  TEXT_TYPES,
  TURN_INTO,
  turnBlocksInto,
  type AnyEditor,
  type ColorKey,
} from "./multi-select";

/**
 * The block handle (U4): the grip beside a block opens a menu of everything
 * the Ctrl+/ block menu offers, plus colours, "Copy link" and "Comment". It
 * acts on the whole selection when the block is part of one. The grip still
 * drags; the menu is the editor library's own, so arrow keys, Escape and
 * screen-reader roles come with it.
 */

type AnyBlock = { id: string; type: string; props: Record<string, unknown> } & EditorBlock;

export interface BlockHandleProps {
  t: EditorT;
  objectPath?: string;
  onCommentBlock?: (blockId: string) => void;
}

function ColorDot({ prop, color }: { prop: "textColor" | "backgroundColor"; color: ColorKey }) {
  const style = color === "default" ? undefined : { background: `var(--bn-colors-highlights-${color}-${prop === "textColor" ? "text" : "background"})` };
  return <span aria-hidden className="qbbe-color-dot" style={style} />;
}

function HandleMenu({ t, objectPath, onCommentBlock }: BlockHandleProps) {
  const Components = useComponentsContext()!;
  const portalElement = usePortalElement();
  const editor = useBlockNoteEditor() as AnyEditor;
  const sideMenu = useExtension(SideMenuExtension);
  const block = useExtensionState(SideMenuExtension, { selector: (state) => state?.block }) as AnyBlock | undefined;
  if (!block) return null;

  const ids = () => idsFor(editor, block.id);
  const after = () => requestAnimationFrame(() => editor.focus());
  const canTurn = TEXT_TYPES.has(block.type);
  const canColor = hasColors(editor, block.type);
  const Item = Components.Generic.Menu.Item;
  const colorOf = (prop: "textColor" | "backgroundColor") => (typeof block.props[prop] === "string" ? (block.props[prop] as string) : "default");
  const setColor = (prop: "textColor" | "backgroundColor") => (color: string) => {
    colorBlocks(editor, ids(), { [prop]: color as ColorKey });
    after();
  };

  return (
    <Components.SideMenu.Root className="bn-side-menu qbbe-handle">
      <AddBlockButton />
      <Components.Generic.Menu.Root
        onOpenChange={(open) => (open ? sideMenu.freezeMenu() : sideMenu.unfreezeMenu())}
        position="left"
        portalElement={portalElement}
      >
        <Components.Generic.Menu.Trigger>
          <Components.SideMenu.Button
            label={t("handle.label")}
            draggable
            onDragStart={(event) => sideMenu.blockDragStart(event, block as never)}
            onDragEnd={() => sideMenu.blockDragEnd()}
            className="bn-button qbbe-handle-grip"
            icon={<GripVertical size={20} aria-hidden data-test="dragHandle" />}
          />
        </Components.Generic.Menu.Trigger>
        <Components.Generic.Menu.Dropdown className="bn-menu-dropdown bn-drag-handle-menu qbbe-handle-menu">
          <Item onClick={() => { announce(countText(t, "duplicated", duplicateBlocks(editor, ids()))); after(); }}>{t("handle.duplicate")}</Item>
          <Item onClick={() => { moveAndAnnounce(editor, ids(), "up", t); after(); }}>{t("handle.moveUp")}</Item>
          <Item onClick={() => { moveAndAnnounce(editor, ids(), "down", t); after(); }}>{t("handle.moveDown")}</Item>
          {canTurn ? (
            <Components.Generic.Menu.Root position="right" sub portalElement={portalElement}>
              <Components.Generic.Menu.Trigger sub>
                <Item subTrigger>{t("handle.turnInto")}</Item>
              </Components.Generic.Menu.Trigger>
              <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown qbbe-handle-menu">
                {TURN_INTO.map(({ key, block: target }) => (
                  <Item key={key} onClick={() => { turnBlocksInto(editor, ids(), target); after(); }}>
                    {t(`types.${key}`)}
                  </Item>
                ))}
              </Components.Generic.Menu.Dropdown>
            </Components.Generic.Menu.Root>
          ) : null}
          {canColor ? (
            <Components.Generic.Menu.Root position="right" sub portalElement={portalElement}>
              <Components.Generic.Menu.Trigger sub>
                <Item subTrigger>{t("handle.color")}</Item>
              </Components.Generic.Menu.Trigger>
              <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown bn-color-picker-dropdown qbbe-handle-menu">
                {(["textColor", "backgroundColor"] as const).map((prop) => (
                  <React.Fragment key={prop}>
                    <Components.Generic.Menu.Label>{t(prop === "textColor" ? "handle.textColor" : "handle.backgroundColor")}</Components.Generic.Menu.Label>
                    {COLORS.map((color) => (
                      <Item
                        key={`${prop}-${color}`}
                        checked={colorOf(prop) === color}
                        icon={<ColorDot prop={prop} color={color} />}
                        onClick={() => setColor(prop)(color)}
                      >
                        {t(`colors.${color}`)}
                      </Item>
                    ))}
                  </React.Fragment>
                ))}
              </Components.Generic.Menu.Dropdown>
            </Components.Generic.Menu.Root>
          ) : null}
          <Components.Generic.Menu.Divider />
          <Item onClick={() => { void copyBlockLink(objectPath, block.id, t); after(); }}>{t("handle.copyLink")}</Item>
          {onCommentBlock ? <Item onClick={() => onCommentBlock(block.id)}>{t("handle.comment")}</Item> : null}
          <Components.Generic.Menu.Divider />
          <Item className="qbbe-handle-danger" onClick={() => { announce(countText(t, "deleted", deleteBlocks(editor, ids()))); after(); }}>
            {t("handle.delete")}
          </Item>
        </Components.Generic.Menu.Dropdown>
      </Components.Generic.Menu.Root>
    </Components.SideMenu.Root>
  );
}

/**
 * The menu library keeps the page's Tab order around a portalled menu with
 * hidden, focusable sentinels (`aria-hidden` and `tabindex="0"`), which
 * screen readers can land on without hearing anything. Focus moves into the
 * menu when it opens and the menu closes when focus leaves, so the sentinels
 * are taken out of the Tab order.
 */
function useQuietFocusTraps() {
  React.useEffect(() => {
    const quiet = () =>
      document
        .querySelectorAll<HTMLElement>(".qbbe-editor [data-focus-trap][aria-hidden='true'][tabindex='0']")
        .forEach((el) => el.setAttribute("tabindex", "-1"));
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        quiet();
      });
    };
    quiet();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}

/** Mount inside the editor view; replaces the library's default side menu. */
export function BlockHandle(props: BlockHandleProps) {
  const { t, objectPath, onCommentBlock } = props;
  useQuietFocusTraps();
  const sideMenu = React.useMemo(() => {
    const Menu = () => <HandleMenu t={t} objectPath={objectPath} onCommentBlock={onCommentBlock} />;
    return Menu;
  }, [t, objectPath, onCommentBlock]);
  return <SideMenuController sideMenu={sideMenu} />;
}
