# QBBE Hub design system

The shared visual and interaction layer for every screen. Tokens live in
`src/design-system/styles/globals.css`; primitives live in
`src/components/ui/`; the gallery at **Admin → Design system**
(`/admin/design-system`) renders every primitive in every state in the current
theme. Issue #102, epic #17; requirement IDs UI-001, UI-003, UI-004, UI-008,
UI-010.

## Rules that tests enforce

`tests/unit/design-tokens.test.ts` fails the build when:

- a component, feature or page hard-codes a hex colour. The two places that
  cannot read CSS variables — the browser-chrome `<meta>` colours in
  `src/app/layout.tsx` and the email HTML in `email-templates.ts` — are
  checked equal to the tokens instead;
- a z-index is a literal (`z-40`, `z-[100]`) rather than a layer token;
- a feature or page renders a bare `<select>` or checkbox instead of the
  primitive.

## Tokens

| Family | Tokens | Notes |
|---|---|---|
| Colour, semantic | `brand`, `accent`, `canvas`, `surface`, `surface-soft`, `ink`, `muted`, `line`, `success`, `warning`, `danger`, `info` | Use these for backgrounds and borders. |
| Colour, text on colour | `brand-fg`, `accent-fg`, `success-fg`, `warning-fg`, `danger-fg`, `info-fg`, `on-accent` | Use the `-fg` token for text on a tinted background; each has a designed dark value. |
| Colour, specific | `nav-label-*`, `program-dot-1..6`, `avatar-1..5`, `logo-ground`, `chart-*` | Named for what they colour. |
| Dark theme | `.dark` block | Dark mode is a token swap. Never add a `dark:` literal colour; add or fix a token. |
| Type | `--text-meta` 12, `--text-caption` 12.5, `--text-body-sm` 13.5, `--text-body` 14, `--text-lead` 15, `--text-title` 18 | For new work (`text-body`, `text-caption`…). Existing screens still use pixel literals; migrate them as they are touched. |
| Radius | `--radius-sm/md/lg` | |
| Elevation | `--shadow-raise`, `--shadow-pop` | |
| Motion | `--ease-app`, `--duration-fast/base` | Reduced motion is honoured from the OS and from Settings → Display. |
| Layers | `--z-raised` 10, `--z-sticky-content` 20, `--z-chrome` 40, `--z-overlay` 50, `--z-toast` 100 | Use as `z-(--z-overlay)`. Native `<dialog>` uses the browser top layer and needs none. |
| Spacing | Tailwind's default scale | A deliberate decision: it is already consistent, and a parallel QBBE scale would add a second vocabulary without adding rhythm. |

## Primitives

| Primitive | File | Use it for |
|---|---|---|
| Button | `button.tsx` | `primary`, `secondary`, `ghost`, `danger`; `loading` and `disabled` states. |
| Input, Textarea, Select, Label, FieldHint | `input.tsx` | Every text field and dropdown. Native elements, centrally styled. |
| Checkbox | `input.tsx` | Options inside a form that is submitted. |
| Switch | `input.tsx` | A setting that takes effect immediately. Native checkbox with `role="switch"`. |
| Badge, Avatar | `badge.tsx`, `avatar.tsx` | Status (always with text, never colour alone) and people. |
| Tabs | `tabs.tsx` | In-page views of one record. Use `LinkTabs` when each view needs its own URL. |
| Dialog | `dialog.tsx` | Short, focused decisions: confirm, a small form. |
| Drawer | `drawer.tsx` | Contextual editing where keeping the page behind in view helps: a task, a risk, an agenda item. |
| Menu | `menu.tsx` | Actions on a record (`role="menu"`). Lists of links or rich panels are disclosures, not menus. |
| Toast | `toast.tsx` | Confirmation of something that already happened. Never the only place an error is reported. |
| Table | `table.tsx` | Operational lists; wide tables scroll inside their own container. |
| Skeleton and route skeletons | `skeleton.tsx` | Loading. Route `loading.tsx` files use the shaped skeletons. |
| EmptyState | `empty-state.tsx` | Nothing to show yet — say what would appear and how to add it. |
| ErrorState | `error-state.tsx` | A load that failed after the page rendered, with Try again. A failed page load reaches `(workspace)/error.tsx` through the page Supabase client. |

## Dialog, drawer or page (UI-010)

- **Dialog** — a decision or a short form that stands alone.
- **Drawer** — editing something in the context of a list or page the person
  is still working in.
- **Page** — configuration or work long enough to deserve its own URL and
  back-button entry.

## Not built, on purpose

Radio, Tooltip and Popover. No screen needs them yet. Build them here, with a
gallery entry, the first time one does.
