import { describe, expect, it } from "vitest";
import { taskDrawerHref } from "@/features/tasks/task-url";
import { createActions, splitCreateActions } from "@/config/create-actions";
import { createActionLabel } from "@/lib/i18n/navigation";
import { createTranslator } from "@/lib/i18n/translate";

describe("task drawer context", () => {
  it("preserves repeated filters, sorting and selection when opening a task", () => {
    const href = taskDrawerHref("/lenses/my-work", "status=ready&status=blocked&sort=due&selected=42", "task/a b");
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/lenses/my-work");
    expect(url.searchParams.getAll("status")).toEqual(["ready", "blocked"]);
    expect(url.searchParams.get("sort")).toBe("due");
    expect(url.searchParams.get("selected")).toBe("42");
    expect(url.searchParams.get("task")).toBe("task/a b");
  });
  it("removes only the task on close and replaces previous task IDs", () => {
    expect(taskDrawerHref("/projects/one", "task=old&filter=open", "new")).toBe("/projects/one?task=new&filter=open");
    expect(taskDrawerHref("/projects/one", "task=old&filter=open", null)).toBe("/projects/one?filter=open");
    expect(taskDrawerHref("/my-work", "task=old", null)).toBe("/my-work");
  });
  it("routes creation to the enabled implementation with a translated label", () => {
    const role = { isAdmin: false, isStaff: false };
    expect(createActions(role)[0].href).toBe("/my-work?create=task");
    const action = createActions(role, { wos_lenses: true })[0];
    expect(action.href).toBe("/lenses/my-work?create=task");
    expect(createActionLabel(createTranslator("en"), action)).toBe(createActionLabel(createTranslator("en"), createActions(role)[0]));
    expect(createActionLabel(createTranslator("fr-CA"), action)).not.toBe(createActionLabel(createTranslator("en"), action));
  });
  it("keeps specialist actions reachable and offers Page only when enabled", () => {
    const staff = { isAdmin: false, isStaff: true };
    expect(createActions(staff).some((action) => action.label === "Page")).toBe(false);
    const actions = createActions(staff, { wos_pages: true });
    const { common, more } = splitCreateActions(actions);
    expect(common.map((action) => action.label).sort()).toEqual(["Meeting", "Page", "Project", "Project proposal", "Task"]);
    expect([...common, ...more].map((action) => action.href).sort()).toEqual(actions.map((action) => action.href).sort());
    expect(more.some((action) => action.label === "CRM contact")).toBe(true);
  });

});
