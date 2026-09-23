import { expect, test } from "./fixtures";
import { signIn } from "./auth";

test("a relationship stores a next action, a contact, a link, and a follow-up", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  const name = `Partner ${Date.now()}`;
  await page.goto("/crm");
  await page.getByRole("button", { name: "New organization" }).click();
  const dialog = page.getByRole("dialog", { name: "Add organization" });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByLabel("Next action", { exact: true }).fill("2026-10-15");
  await dialog.getByRole("button", { name: "Add organization" }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name }).click();
  await expect(page.getByText("Next action")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  const contact = page.getByRole("dialog", { name: "Add contact" });
  await contact.getByLabel("Name", { exact: true }).fill("Jordan Lee");
  await contact.getByLabel("Role", { exact: true }).fill("Principal");
  await contact.getByLabel("Consent or communication notes", { exact: true }).fill("Prefers email");
  await contact.getByRole("button", { name: "Add contact" }).click();
  await expect(contact).not.toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByText("Jordan Lee").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Prefers email").filter({ visible: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit organization" }).click();
  const edit = page.getByRole("dialog", { name: "Edit organization" });
  await edit.getByLabel("Notes", { exact: true }).fill("Updated notes");
  await edit.getByRole("button", { name: "Save organization" }).click();
  await expect(edit).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Updated notes")).toBeVisible();

  await page
    .locator("section", { has: page.getByRole("heading", { name: "Agreements" }) })
    .getByRole("button", { name: "Add" })
    .click();
  const agreement = page.getByRole("dialog", { name: "Add agreement" });
  await agreement.getByLabel("Title", { exact: true }).fill("Hall hire letter");
  await agreement.getByRole("button", { name: "Save" }).click();
  await expect(agreement).not.toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Hall hire letter")).toBeVisible({ timeout: 30_000 });
});
