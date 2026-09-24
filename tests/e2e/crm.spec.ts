import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { clickWhenInteractive } from "./interactive";

/**
 * CRM journey (#112, QA-FINAL "CRM/reporting"): a staff member records a
 * relationship end to end — organization, contact, interaction, follow-up —
 * and each survives a reload; a volunteer is refused the record itself, not
 * only the list.
 */

test("an organization, its contact, an interaction and a follow-up are recorded and kept", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const orgName = `Journey Partner ${suffix}`;
  const contactName = `Dana Contact ${suffix}`;
  const summary = `Discussed the spring workshop series ${suffix}`;
  const followUp = `Send the partnership letter ${suffix}`;

  await signIn(page, "owner");
  await page.goto("/crm");

  await clickWhenInteractive(page.getByRole("button", { name: "New organization" }));
  const orgDialog = page.getByRole("dialog", { name: "Add organization" });
  await orgDialog.getByLabel("Name", { exact: true }).fill(orgName);
  await orgDialog.getByRole("button", { name: /^(Save|Add organization)$/ }).click();
  await expect(orgDialog).toBeHidden();

  await page.getByRole("link", { name: orgName }).first().click();
  await expect(page.locator("h1").first()).toHaveText(orgName);
  const orgUrl = page.url();

  // Each section is its own region; the contact's name also sits in the
  // (hidden) interaction form's select, so checks are scoped to the section.
  const contacts = page.getByRole("region", { name: "Contacts" });
  const history = page.getByRole("region", { name: "Interaction history" });
  const followUps = page.getByRole("region", { name: "Follow-ups" });

  await contacts.getByRole("button", { name: "Add", exact: true }).click();
  const contactDialog = page.getByRole("dialog", { name: "Add contact" });
  await contactDialog.getByLabel("Name", { exact: true }).fill(contactName);
  await contactDialog.getByRole("button", { name: "Add contact" }).click();
  await expect(contactDialog).toBeHidden();
  await expect(contacts.getByText(contactName)).toBeVisible();

  await page.getByRole("button", { name: "Record interaction" }).click();
  const interaction = page.getByRole("dialog", { name: "Record interaction" });
  await interaction.getByLabel("Contact").selectOption({ label: contactName });
  await interaction.getByLabel("Summary").fill(summary);
  await interaction.getByRole("button", { name: "Record" }).click();
  await expect(interaction).toBeHidden();

  await followUps.getByRole("button", { name: "Add", exact: true }).click();
  const followUpDialog = page.getByRole("dialog", { name: "Schedule follow-up" });
  await followUpDialog.getByLabel("Follow-up").fill(followUp);
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await followUpDialog.getByLabel("Due date").fill(due);
  await followUpDialog.getByRole("button", { name: "Schedule" }).click();
  await expect(followUpDialog).toBeHidden();

  // All of it is stored, not only shown.
  await page.goto(orgUrl);
  await expect(contacts.getByText(contactName)).toBeVisible();
  await expect(history.getByText(summary)).toBeVisible();
  await expect(followUps.getByText(followUp)).toBeVisible();

  // It joins the follow-up queue, and completing it there takes it off.
  await page.goto("/crm");
  const queued = page.getByRole("listitem").filter({ hasText: followUp });
  await expect(queued).toHaveCount(1);
  await queued.getByRole("button", { name: "Mark follow-up done" }).click();
  await expect(queued).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: followUp })).toHaveCount(0);

  // A volunteer is refused the record by its URL, not only the list.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(orgUrl);
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname, "a volunteer is sent away from a CRM record").toBe("/");
  await expect(page.getByText(summary)).toHaveCount(0);
});
