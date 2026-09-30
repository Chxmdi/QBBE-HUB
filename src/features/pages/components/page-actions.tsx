"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FolderInput,
  Image as ImageIcon,
  Pencil,
  Smile,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { usePagesT } from "@/features/pages/i18n/client";
import { coverPresets, type CoverKey } from "@/features/pages/covers";
import {
  duplicatePage,
  movePage,
  renamePage,
  setFavourite,
  setPageCover,
  setPageIcon,
  stepPage,
  trashPage,
  type PageActionResult,
} from "@/features/pages/services/page.commands";
import { flatten, subtreeIds, type PageNode, type PageRow } from "@/features/pages/tree";

type DialogKind = "rename" | "icon" | "cover" | "move" | null;

/**
 * The actions menu for one page, shared by the sidebar row and the page
 * header. Every action is a menu item or a dialog, so all of it works from the
 * keyboard; "Move up" and "Move down" are the keyboard alternative to dragging.
 */
export function PageActions({
  page,
  pages,
  tree,
  isFavourite,
  canEdit,
  label,
}: {
  page: PageRow;
  pages: PageRow[];
  tree: { workspace: PageNode[]; private: PageNode[] };
  isFavourite: boolean;
  canEdit: boolean;
  label?: string;
}) {
  const t = usePagesT();
  const router = useRouter();
  const { toast } = useToast();
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [pending, startTransition] = React.useTransition();
  const title = page.title || t("page.untitled");

  function run(action: () => Promise<PageActionResult>, success?: string, then?: (id?: string) => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast(result.error ?? t("errors.failed"), { tone: "error" });
        return;
      }
      if (success) toast(success, { tone: "success" });
      setDialog(null);
      then?.(result.id);
      router.refresh();
    });
  }

  const items: MenuItem[] = [
    {
      label: isFavourite ? t("actions.unfavourite") : t("actions.favourite"),
      icon: isFavourite ? <StarOff className="size-4" aria-hidden /> : <Star className="size-4" aria-hidden />,
      onSelect: () => run(() => setFavourite({ pageId: page.id }, !isFavourite)),
    },
  ];
  if (canEdit) {
    items.push(
      { label: t("actions.rename"), icon: <Pencil className="size-4" aria-hidden />, onSelect: () => setDialog("rename") },
      { label: t("actions.icon"), icon: <Smile className="size-4" aria-hidden />, onSelect: () => setDialog("icon") },
      { label: t("actions.cover"), icon: <ImageIcon className="size-4" aria-hidden />, onSelect: () => setDialog("cover") },
      {
        label: t("actions.moveUp"),
        icon: <ArrowUp className="size-4" aria-hidden />,
        onSelect: () => run(() => stepPage({ pageId: page.id, direction: "up" })),
      },
      {
        label: t("actions.moveDown"),
        icon: <ArrowDown className="size-4" aria-hidden />,
        onSelect: () => run(() => stepPage({ pageId: page.id, direction: "down" })),
      },
      { label: t("actions.move"), icon: <FolderInput className="size-4" aria-hidden />, onSelect: () => setDialog("move") },
      {
        label: t("actions.duplicate"),
        icon: <Copy className="size-4" aria-hidden />,
        onSelect: () =>
          run(() => duplicatePage({ pageId: page.id }), t("toasts.duplicated"), (id) => id && router.push(`/pages/${id}`)),
      },
      {
        label: t("actions.trash"),
        icon: <Trash2 className="size-4" aria-hidden />,
        destructive: true,
        onSelect: () => run(() => trashPage({ pageId: page.id }), t("toasts.trashed")),
      },
    );
  }

  return (
    <>
      <Menu items={items} label={label ?? t("sidebar.actions", { title })} />
      {dialog === "rename" ? (
        <RenameDialog
          initial={page.title}
          pending={pending}
          onClose={() => setDialog(null)}
          onSave={(value) => run(() => renamePage({ pageId: page.id, title: value }))}
        />
      ) : null}
      {dialog === "icon" ? (
        <IconDialog
          initial={page.icon ?? ""}
          pending={pending}
          onClose={() => setDialog(null)}
          onSave={(value) => run(() => setPageIcon({ pageId: page.id, icon: value || null }))}
        />
      ) : null}
      {dialog === "cover" ? (
        <CoverDialog
          current={page.cover}
          pending={pending}
          onClose={() => setDialog(null)}
          onSave={(value) => run(() => setPageCover({ pageId: page.id, cover: value }))}
        />
      ) : null}
      {dialog === "move" ? (
        <MoveDialog
          page={page}
          pages={pages}
          tree={tree}
          pending={pending}
          onClose={() => setDialog(null)}
          onSave={(parentPageId, visibility) =>
            run(() => movePage({ pageId: page.id, parentPageId, visibility }), t("toasts.moved"))
          }
        />
      ) : null}
    </>
  );
}

function DialogButtons({ pending, onClose }: { pending: boolean; onClose: () => void }) {
  const t = usePagesT();
  return (
    <div className="mt-5 flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onClose}>
        {t("dialogs.cancel")}
      </Button>
      <Button type="submit" loading={pending}>
        {t("dialogs.save")}
      </Button>
    </div>
  );
}

function RenameDialog({
  initial,
  pending,
  onClose,
  onSave,
}: {
  initial: string;
  pending: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const t = usePagesT();
  const [value, setValue] = React.useState(initial);
  const id = React.useId();
  return (
    <Dialog open onClose={onClose} title={t("dialogs.renameTitle")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value);
        }}
      >
        <Label htmlFor={id}>{t("page.titleLabel")}</Label>
        <Input id={id} value={value} maxLength={500} autoFocus onChange={(e) => setValue(e.target.value)} />
        <DialogButtons pending={pending} onClose={onClose} />
      </form>
    </Dialog>
  );
}

function IconDialog({
  initial,
  pending,
  onClose,
  onSave,
}: {
  initial: string;
  pending: boolean;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const t = usePagesT();
  const [value, setValue] = React.useState(initial);
  const id = React.useId();
  return (
    <Dialog open onClose={onClose} title={t("dialogs.iconTitle")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value.trim());
        }}
      >
        <Label htmlFor={id}>{t("dialogs.iconLabel")}</Label>
        <Input id={id} value={value} maxLength={32} autoFocus onChange={(e) => setValue(e.target.value)} />
        <div className="mt-5 flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" disabled={!initial} onClick={() => onSave("")}>
            {t("actions.removeIcon")}
          </Button>
          <DialogButtons pending={pending} onClose={onClose} />
        </div>
      </form>
    </Dialog>
  );
}

function CoverDialog({
  current,
  pending,
  onClose,
  onSave,
}: {
  current: string | null;
  pending: boolean;
  onClose: () => void;
  onSave: (value: CoverKey | null) => void;
}) {
  const t = usePagesT();
  const [value, setValue] = React.useState<string | null>(current);
  return (
    <Dialog open onClose={onClose} title={t("dialogs.coverTitle")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave((value as CoverKey | null) ?? null);
        }}
      >
        <fieldset>
          <legend className="sr-only">{t("dialogs.coverTitle")}</legend>
          <div className="grid grid-cols-3 gap-2">
            {coverPresets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                aria-pressed={value === preset.key}
                onClick={() => setValue(preset.key)}
                className={cn(
                  "flex flex-col items-stretch gap-1 rounded-(--radius-sm) border p-1.5 text-caption text-ink",
                  value === preset.key ? "border-brand ring-2 ring-brand" : "border-line",
                )}
              >
                <span className={cn("h-8 rounded-(--radius-sm)", preset.className)} aria-hidden />
                {t(preset.label)}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="mt-5 flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" disabled={!current} onClick={() => onSave(null)}>
            {t("actions.removeCover")}
          </Button>
          <DialogButtons pending={pending} onClose={onClose} />
        </div>
      </form>
    </Dialog>
  );
}

function MoveDialog({
  page,
  pages,
  tree,
  pending,
  onClose,
  onSave,
}: {
  page: PageRow;
  pages: PageRow[];
  tree: { workspace: PageNode[]; private: PageNode[] };
  pending: boolean;
  onClose: () => void;
  onSave: (parentPageId: string | null, visibility: "workspace" | "private") => void;
}) {
  const t = usePagesT();
  const id = React.useId();
  const blocked = subtreeIds(pages, page.id);
  const current = page.parentPageId ? `page:${page.parentPageId}` : `top:${page.visibility}`;
  const [value, setValue] = React.useState(current);
  const options = (area: "workspace" | "private") =>
    flatten(tree[area])
      .filter((node) => !blocked.has(node.id))
      .map((node) => (
        <option key={node.id} value={`page:${node.id}`}>
          {"  ".repeat(node.depth + 1)}
          {node.icon ? `${node.icon} ` : ""}
          {node.title || t("page.untitled")}
        </option>
      ));
  return (
    <Dialog open onClose={onClose} title={t("dialogs.moveTitle")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const [kind, target] = value.split(":");
          if (kind === "top") onSave(null, target as "workspace" | "private");
          else {
            const parent = pages.find((p) => p.id === target);
            onSave(target, parent?.visibility ?? page.visibility);
          }
        }}
      >
        <Label htmlFor={id}>{t("dialogs.moveLabel")}</Label>
        <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="top:workspace">{t("dialogs.moveTopLevel", { area: t("sidebar.workspace") })}</option>
          {options("workspace")}
          <option value="top:private">{t("dialogs.moveTopLevel", { area: t("sidebar.private") })}</option>
          {options("private")}
        </Select>
        <DialogButtons pending={pending} onClose={onClose} />
      </form>
    </Dialog>
  );
}
