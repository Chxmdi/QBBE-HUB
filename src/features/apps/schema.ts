import { z } from "zod";
import { workspaceCapabilities, type LensKind, type WorkspaceCapability } from "@/lib/objects/contracts";
import { requiredText } from "@/lib/schema";

/**
 * A workspace app (V2-3, epic #199): a named bundle of screens with its own
 * navigation, actions, dashboards and permissions. The app stores only what it
 * shows and in what order; the screens point at lenses (S4), pages (S3), forms
 * (S6b) and actions (S1's registry) by key or id, so an app never copies data.
 *
 * Validation messages are keys into the apps dictionary (`errors.*`).
 */

export const appSlugPattern = /^[a-z][a-z0-9-]{1,47}$/;
const key = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "invalidKey");

const text = z.object({
  en: requiredText("missingEnglish").max(120, "tooLong"),
  fr: requiredText("missingFrench").max(120, "tooLong"),
});

export const appLensKinds = ["table", "board", "list", "calendar", "timeline", "gallery"] as const satisfies readonly LensKind[];

/** What a dashboard tile shows. `count` and `list` run the tile's query under the viewer's access. */
const widgetSchema = z.object({
  key,
  title: text,
  kind: z.enum(["count", "list"]),
  /** Object type to query; the query engine (S4) decides what the viewer sees. */
  type: key,
  /** Optional equality filter on one property, e.g. status = open. */
  filter: z.object({ property: key, value: z.string().max(200) }).optional(),
});

const screenBase = { key, title: text, inNavigation: z.boolean().default(true) };

export const appScreenSchema = z.discriminatedUnion("kind", [
  z.object({ ...screenBase, kind: z.literal("lens"), lens: z.enum(appLensKinds), type: key, groupBy: key.optional() }),
  z.object({ ...screenBase, kind: z.literal("page"), pageId: z.string().uuid("invalidPage") }),
  z.object({ ...screenBase, kind: z.literal("form"), formKey: key }),
  z.object({ ...screenBase, kind: z.literal("dashboard"), widgets: z.array(widgetSchema).min(1, "dashboardNeedsWidgets").max(12) }),
]);

export const appActionSchema = z.object({
  key,
  label: text,
  /** An ActionRegistry key, e.g. `task.assign`. */
  actionKey: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "invalidActionKey"),
  /** Needed on the app, as well as on every target when the action runs. */
  capability: z.enum(workspaceCapabilities),
  /** Screens that show the action; every screen when empty. */
  screens: z.array(key).max(20).default([]),
});

export const appDefinitionSchema = z
  .object({
    version: z.literal(1),
    screens: z.array(appScreenSchema).min(1, "needsAScreen").max(30),
    actions: z.array(appActionSchema).max(30).default([]),
  })
  .superRefine((app, ctx) => {
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    const screens = new Set<string>();
    app.screens.forEach((screen, i) => {
      if (screens.has(screen.key)) issue("duplicateKey", ["screens", i, "key"]);
      screens.add(screen.key);
      if (screen.kind === "dashboard") {
        const widgets = new Set<string>();
        screen.widgets.forEach((w, j) => {
          if (widgets.has(w.key)) issue("duplicateKey", ["screens", i, "widgets", j, "key"]);
          widgets.add(w.key);
        });
      }
    });
    if (!app.screens.some((s) => s.inNavigation)) issue("needsNavigation", ["screens"]);
    const actions = new Set<string>();
    app.actions.forEach((action, i) => {
      if (actions.has(action.key)) issue("duplicateKey", ["actions", i, "key"]);
      actions.add(action.key);
      action.screens.forEach((s, j) => {
        if (!screens.has(s)) issue("unknownScreen", ["actions", i, "screens", j]);
      });
    });
  });

export type AppDefinition = z.infer<typeof appDefinitionSchema>;
export type AppScreen = AppDefinition["screens"][number];
export type AppAction = AppDefinition["actions"][number];

export interface AppIssue {
  code: string;
  path: (string | number)[];
}

export function validateAppDefinition(input: unknown): { ok: true; app: AppDefinition } | { ok: false; issues: AppIssue[] } {
  const parsed = appDefinitionSchema.safeParse(input);
  if (parsed.success) return { ok: true, app: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({ code: /^[a-zA-Z]+$/.test(i.message) ? i.message : "invalid", path: i.path })),
  };
}

/** Screens in navigation order. */
export function navigation(app: AppDefinition): AppScreen[] {
  return app.screens.filter((s) => s.inNavigation);
}

/** The actions a screen shows. */
export function actionsFor(app: AppDefinition, screenKey: string): AppAction[] {
  return app.actions.filter((a) => a.screens.length === 0 || a.screens.includes(screenKey));
}

/** The capabilities a grant can hold, in the order the permissions table shows them. */
export const appCapabilities = ["view", "edit_content", "run_workflow", "manage"] as const;
export type AppCapability = (typeof appCapabilities)[number];

/** The app capability an action needs: its own, or `manage` for ones an app grant cannot hold. */
export function appCapabilityFor(capability: WorkspaceCapability): AppCapability {
  return (appCapabilities as readonly string[]).includes(capability) ? (capability as AppCapability) : "manage";
}

/** A starting point for a new app: one task table and a dashboard. */
export function starterAppDefinition(): AppDefinition {
  return {
    version: 1,
    screens: [
      { key: "tasks", title: { en: "Tasks", fr: "Tâches" }, kind: "lens", lens: "table", type: "task", inNavigation: true },
      {
        key: "overview",
        title: { en: "Overview", fr: "Aperçu" },
        kind: "dashboard",
        inNavigation: true,
        widgets: [
          { key: "in_progress", title: { en: "In progress", fr: "En cours" }, kind: "count", type: "task", filter: { property: "status", value: "in_progress" } },
          { key: "recent", title: { en: "Recent tasks", fr: "Tâches récentes" }, kind: "list", type: "task" },
        ],
      },
    ],
    actions: [],
  };
}
