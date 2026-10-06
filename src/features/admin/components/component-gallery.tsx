"use client";

import { useState } from "react";
import { Inbox, Plus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Checkbox,
  FieldHint,
  Input,
  Label,
  Select,
  Switch,
  Textarea,
} from "@/components/ui/input";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";

/**
 * Every primitive in every state it can be in (UI-008), rendered with the real
 * tokens, inside the real shell, so the states that live data rarely shows —
 * disabled, loading, empty, destructive — are reviewed somewhere, and the
 * accessibility sweep scans them in both themes.
 */

const COLOR_TOKENS = [
  "brand", "brand-strong", "brand-soft", "accent", "canvas", "surface", "surface-soft",
  "ink", "muted", "line", "success", "warning", "danger", "info",
  "brand-fg", "accent-fg", "success-fg", "warning-fg", "danger-fg", "info-fg",
];

/** `slug` is the English title as a slug, so section ids stay the same in every language. */
function Section({
  slug,
  title,
  children,
}: {
  slug: string;
  title: string;
  children: React.ReactNode;
}) {
  const id = `gallery-${slug}`;
  return (
    <section aria-labelledby={id} className="border-b border-line py-6">
      <h2 id={id} className="section-heading mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ComponentGallery() {
  const { toast } = useToast();
  const t = useT();
  const [tab, setTab] = useState("one");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);

  return (
    <div>
      <Section slug="colour-tokens" title={t("admin.designSystem.sections.colours")}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {COLOR_TOKENS.map((token) => (
            <li key={token} className="text-[12px]">
              <span
                aria-hidden
                className="mb-1 block h-10 rounded-(--radius-sm) border border-line"
                style={{ background: `var(--color-${token})` }}
              />
              <code>--color-{token}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section slug="buttons" title={t("admin.designSystem.sections.buttons")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button>{t("admin.designSystem.primary")}</Button>
          <Button variant="secondary">{t("admin.designSystem.secondary")}</Button>
          <Button variant="ghost">{t("admin.designSystem.ghost")}</Button>
          <Button variant="danger">{t("admin.designSystem.delete")}</Button>
          <Button size="sm">{t("admin.designSystem.small")}</Button>
          <Button loading>{t("admin.designSystem.saving")}</Button>
          <Button disabled>{t("admin.designSystem.disabled")}</Button>
          <Button aria-label={t("admin.designSystem.add")}>
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
      </Section>

      <Section slug="form-controls" title={t("admin.designSystem.sections.forms")}>
        <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="gallery-input">{t("admin.designSystem.textInput")}</Label>
            <Input id="gallery-input" placeholder={t("admin.designSystem.placeholder")} aria-describedby="gallery-input-hint" />
            <FieldHint>
              <span id="gallery-input-hint">{t("admin.designSystem.hint")}</span>
            </FieldHint>
          </div>
          <div>
            <Label htmlFor="gallery-disabled">{t("admin.designSystem.disabledInput")}</Label>
            <Input id="gallery-disabled" disabled defaultValue={t("admin.designSystem.notEditable")} />
          </div>
          <div>
            <Label htmlFor="gallery-select">{t("admin.designSystem.select")}</Label>
            <Select id="gallery-select" defaultValue="b">
              <option value="a">{t("admin.designSystem.first")}</option>
              <option value="b">{t("admin.designSystem.second")}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="gallery-textarea">{t("admin.designSystem.textarea")}</Label>
            <Textarea id="gallery-textarea" defaultValue={t("admin.designSystem.twoLines")} />
          </div>
          <label className="flex items-start gap-2 text-[13.5px]">
            <Checkbox className="mt-0.5" defaultChecked />
            {t("admin.designSystem.checkboxChecked")}
          </label>
          <label className="flex items-start gap-2 text-[13.5px]">
            <Checkbox className="mt-0.5" disabled />
            {t("admin.designSystem.checkboxDisabled")}
          </label>
          <label className="flex items-center gap-2 text-[13.5px]">
            <Switch checked={switchOn} onChange={(e) => setSwitchOn(e.target.checked)} />
            {switchOn ? t("admin.designSystem.switchOn") : t("admin.designSystem.switchOff")}
          </label>
          <label className="flex items-center gap-2 text-[13.5px]">
            <Switch disabled />
            {t("admin.designSystem.switchDisabled")}
          </label>
        </div>
      </Section>

      <Section slug="badges-and-avatars" title={t("admin.designSystem.sections.badges")}>
        <div className="flex flex-wrap items-center gap-2">
          {(["neutral", "brand", "success", "warning", "danger", "info", "accent"] as const).map(
            (tone) => (
              <Badge key={tone} tone={tone}>
                {t(`admin.designSystem.tones.${tone}`)}
              </Badge>
            ),
          )}
        </div>
        <div className="mt-4 flex items-center gap-2">
          {(["xs", "sm", "md", "lg"] as const).map((size) => (
            <Avatar key={size} name={t("admin.designSystem.galleryName", { size })} size={size} />
          ))}
        </div>
      </Section>

      <Section slug="tabs" title={t("admin.designSystem.sections.tabs")}>
        <Tabs
          tabs={[
            { id: "one", label: t("admin.designSystem.overview") },
            { id: "two", label: t("admin.designSystem.activity"), count: 3 },
            { id: "three", label: t("admin.designSystem.files") },
          ]}
          active={tab}
          onChange={setTab}
        />
        {/* Each tab names its panel through aria-controls, so the panels are
            part of the example, not optional. */}
        <TabPanel id="one" active={tab}>
          <p className="py-3 text-[13px] text-muted">{t("admin.designSystem.overviewPanel")}</p>
        </TabPanel>
        <TabPanel id="two" active={tab}>
          <p className="py-3 text-[13px] text-muted">{t("admin.designSystem.activityPanel")}</p>
        </TabPanel>
        <TabPanel id="three" active={tab}>
          <p className="py-3 text-[13px] text-muted">{t("admin.designSystem.filesPanel")}</p>
        </TabPanel>
      </Section>

      <Section slug="overlays-and-feedback" title={t("admin.designSystem.sections.overlays")}>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            {t("admin.designSystem.openDialog")}
          </Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            {t("admin.designSystem.openDrawer")}
          </Button>
          <Button variant="secondary" onClick={() => toast(t("admin.designSystem.toastSaved"))}>
            {t("admin.designSystem.showToast")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast(t("admin.designSystem.toastError"), { tone: "error" })}
          >
            {t("admin.designSystem.showErrorToast")}
          </Button>
        </div>
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={t("admin.designSystem.dialogTitle")}>
          <p className="text-[13.5px]">{t("admin.designSystem.dialogBody")}</p>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => setDialogOpen(false)}>{t("admin.designSystem.done")}</Button>
          </div>
        </Dialog>
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={t("admin.designSystem.drawerTitle")}
          description={t("admin.designSystem.drawerDescription")}
        >
          <p className="text-[13.5px]">{t("admin.designSystem.drawerContent")}</p>
        </Drawer>
      </Section>

      <Section slug="loading-and-empty" title={t("admin.designSystem.sections.loading")}>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <Skeleton className="mb-3 h-6 w-40" />
            <ListSkeleton rows={3} />
          </div>
          <EmptyState
            icon={<Inbox className="size-6" aria-hidden />}
            title={t("admin.designSystem.emptyTitle")}
            description={t("admin.designSystem.emptyDescription")}
            action={<Button size="sm">{t("admin.designSystem.emptyAction")}</Button>}
          />
        </div>
      </Section>
    </div>
  );
}
