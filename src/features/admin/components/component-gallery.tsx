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
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `gallery-${title.toLowerCase().replace(/\W+/g, "-")}`;
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
  const [tab, setTab] = useState("one");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);

  return (
    <div>
      <Section title="Colour tokens">
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

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button size="sm">Small</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button aria-label="Add">
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="gallery-input">Text input</Label>
            <Input id="gallery-input" placeholder="Placeholder" aria-describedby="gallery-input-hint" />
            <FieldHint>
              <span id="gallery-input-hint">A hint under the field.</span>
            </FieldHint>
          </div>
          <div>
            <Label htmlFor="gallery-disabled">Disabled input</Label>
            <Input id="gallery-disabled" disabled defaultValue="Not editable" />
          </div>
          <div>
            <Label htmlFor="gallery-select">Select</Label>
            <Select id="gallery-select" defaultValue="b">
              <option value="a">First</option>
              <option value="b">Second</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="gallery-textarea">Textarea</Label>
            <Textarea id="gallery-textarea" defaultValue="Two lines of text." />
          </div>
          <label className="flex items-start gap-2 text-[13.5px]">
            <Checkbox className="mt-0.5" defaultChecked />
            Checkbox, checked
          </label>
          <label className="flex items-start gap-2 text-[13.5px]">
            <Checkbox className="mt-0.5" disabled />
            Checkbox, disabled
          </label>
          <label className="flex items-center gap-2 text-[13.5px]">
            <Switch checked={switchOn} onChange={(e) => setSwitchOn(e.target.checked)} />
            Switch ({switchOn ? "on" : "off"})
          </label>
          <label className="flex items-center gap-2 text-[13.5px]">
            <Switch disabled />
            Switch, disabled
          </label>
        </div>
      </Section>

      <Section title="Badges and avatars">
        <div className="flex flex-wrap items-center gap-2">
          {(["neutral", "brand", "success", "warning", "danger", "info", "accent"] as const).map(
            (tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ),
          )}
        </div>
        <div className="mt-4 flex items-center gap-2">
          {(["xs", "sm", "md", "lg"] as const).map((size) => (
            <Avatar key={size} name={`Gallery ${size}`} size={size} />
          ))}
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          tabs={[
            { id: "one", label: "Overview" },
            { id: "two", label: "Activity", count: 3 },
            { id: "three", label: "Files" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </Section>

      <Section title="Overlays and feedback">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </Button>
          <Button variant="secondary" onClick={() => toast("Saved.")}>
            Show toast
          </Button>
          <Button variant="secondary" onClick={() => toast("Could not save.", { tone: "error" })}>
            Show error toast
          </Button>
        </div>
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="A short decision">
          <p className="text-[13.5px]">Dialogs are for short, focused decisions (UI-010).</p>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => setDialogOpen(false)}>Done</Button>
          </div>
        </Dialog>
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Contextual editing"
          description="Drawers keep the page behind them in view (UI-010)."
        >
          <p className="text-[13.5px]">Drawer content.</p>
        </Drawer>
      </Section>

      <Section title="Loading and empty">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <Skeleton className="mb-3 h-6 w-40" />
            <ListSkeleton rows={3} />
          </div>
          <EmptyState
            icon={<Inbox className="size-6" aria-hidden />}
            title="Nothing here yet"
            description="An empty state says what would appear and how to add it."
            action={<Button size="sm">Add the first one</Button>}
          />
        </div>
      </Section>
    </div>
  );
}
