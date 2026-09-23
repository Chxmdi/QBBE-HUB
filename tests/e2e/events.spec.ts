import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";

/**
 * Acceptance evidence for #32 (P0-EVT-01, P0-EVT-02).
 *
 * The events surface was not missing — a list page with a create dialog and a
 * detail page with editing, status and all seven role assignments already
 * existed. What was missing was three of the things P0-EVT-01 asks the record
 * to hold.
 *
 * `event_type` was accepted by `createEvent` and shown by the edit form, and
 * absent from the create dialog only, so it could be given to an event that
 * already existed but never to a new one.
 *
 * `event_checklist_item` had a table and read and write policies since
 * `20260912040000` and no references anywhere in the application.
 *
 * `document` had no `event_id`, so a run sheet or a venue contract had nowhere
 * to live but unattached in the library.
 *
 * The claims only a browser settles are here: that a type given at creation is
 * the type that comes back, and that ticking a preparation item survives a
 * reload rather than only looking ticked. The database assertions in
 * `supabase/tests/events.sql` cover the guards — the role allowlist and the
 * cross-organization assignee — because those are reachable without the form
 * at all.
 */

async function createEvent(page: Page, name: string, type?: string) {
  await page.goto("/events");
  await page.getByRole("button", { name: "New event" }).click();
  const dialog = page.getByRole("dialog", { name: "Create event" });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  if (type) await dialog.getByLabel("Event type").fill(type);
  // Link the event to a program. `event_scoped_insert` accepts either an
  // organization administrator at aal2 or somebody who may collaborate on the
  // linked work, and an event hanging off nothing is the less realistic of the
  // two anyway — the product's own empty state asks for the work it belongs to.
  await dialog.getByLabel("Program").selectOption({ index: 1 });
  // `starts_at` is required, and a datetime-local wants a local wall time.
  const when = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  await dialog
    .getByLabel("Starts", { exact: true })
    .fill(
      `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T10:00`,
    );
  await dialog.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name, exact: true }).first().click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]+$/, { timeout: 60_000 });
}

test("an event records the type it was given, not one added afterwards", async ({ page }) => {
  await signIn(page, "owner");
  const name = `Community day ${Date.now()}`;

  await createEvent(page, name, "Outreach");

  // The type has to survive the round trip to the database and back, which is
  // the whole point: it was previously droppable at creation without anything
  // saying so.
  await expect(page.getByText("Outreach").first()).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByText("Outreach").first()).toBeVisible({ timeout: 30_000 });
});

test("a preparation checklist keeps what was ticked", async ({ page }) => {
  await signIn(page, "owner");
  const name = `Gala ${Date.now()}`;
  await createEvent(page, name);

  const section = page.getByRole("region", { name: "Preparation checklist" });
  await expect(
    section.getByText("Nothing to prepare yet.", { exact: false }),
  ).toBeVisible({ timeout: 30_000 });

  for (const item of ["Book the venue", "Confirm the caterer"]) {
    await page.getByRole("button", { name: "Add item" }).click();
    const dialog = page.getByRole("dialog", { name: "Add checklist item" });
    await dialog.getByLabel("What needs doing", { exact: true }).fill(item);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });
    await expect(section.getByText(item, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  }

  await expect(section.getByText("0 of 2 ready")).toBeVisible({ timeout: 30_000 });

  // Ticking is optimistic, so the assertion that matters is the one after the
  // reload: the box looking ticked proves nothing on its own.
  await section.getByRole("checkbox").first().check();
  await expect(section.getByText("1 of 2 ready")).toBeVisible({ timeout: 30_000 });

  await page.reload();
  const afterReload = page.getByRole("region", { name: "Preparation checklist" });
  await expect(afterReload.getByText("1 of 2 ready")).toBeVisible({ timeout: 30_000 });
  await expect(afterReload.getByRole("checkbox").first()).toBeChecked();

  // And removing one takes it away rather than only hiding it.
  await afterReload.getByRole("button", { name: "Remove Confirm the caterer" }).click();
  await expect(
    afterReload.getByText("Confirm the caterer", { exact: true }),
  ).not.toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Preparation checklist" })
      .getByText("Confirm the caterer", { exact: true }),
  ).not.toBeVisible({ timeout: 30_000 });
});

test("an event can be given an accountable owner for an area", async ({ page }) => {
  await signIn(page, "owner");
  const name = `Open house ${Date.now()}`;
  await createEvent(page, name);

  const roles = page.getByRole("region", { name: "Role assignments" });
  await page.getByRole("button", { name: "Assign role" }).click();
  const dialog = page.getByRole("dialog", { name: "Assign event role" });
  await dialog.getByLabel("Person", { exact: true }).selectOption({ index: 1 });
  await dialog.getByLabel("Responsibility", { exact: true }).selectOption("logistics");
  await dialog.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });

  // Addressed as the list row rather than as loose text: the assign dialog's
  // Responsibility picker lists every role as an <option>, so a plain text
  // match finds "logistics" there too and resolves to two elements.
  await expect(
    roles.getByRole("listitem").filter({ hasText: "logistics" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Role assignments" })
      .getByRole("listitem")
      .filter({ hasText: "logistics" }),
  ).toBeVisible({ timeout: 30_000 });
});
