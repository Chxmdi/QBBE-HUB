import { expect, test } from "./fixtures";
import { signIn } from "./auth";

/**
 * Acceptance evidence for #36 (P1-RID-01..04).
 *
 * The fields have to be reachable on the project, and they have to still be
 * there after a reload. Cadence itself is set on the project form and is
 * covered by projects.spec.ts; the stale rule is covered by the unit test.
 */

test("a project records a risk trigger, an issue plan, a decision, and a request", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const name = `RAID ${Date.now()}`;
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  const create = page.getByRole("dialog", { name: "Create project" });
  await create.getByLabel("Name", { exact: true }).fill(name);
  await create
    .getByLabel("Reporting cadence", { exact: true })
    .selectOption("weekly");
  await create
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 60_000 });

  await page.getByRole("link", { name: /Risks & issues/ }).click();
  await expect(page).toHaveURL(/tab=risks/);

  await page.getByRole("button", { name: "Log a risk" }).click();
  const risk = page.getByRole("dialog", { name: "Log a risk" });
  await risk
    .getByLabel("What might happen", { exact: true })
    .fill("The hall cancels");
  await risk
    .getByLabel("What would make it happen (optional)", { exact: true })
    .fill("Notice inside two weeks");
  await risk.getByRole("button", { name: "Log risk" }).click();
  await expect(risk).not.toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Raise an issue" }).click();
  const issue = page.getByRole("dialog", { name: "Raise an issue" });
  await issue
    .getByLabel("What has happened", { exact: true })
    .fill("The printer failed");
  await issue
    .getByLabel("Impact (optional)", { exact: true })
    .fill("Packets cannot be printed");
  await issue
    .getByLabel("Resolution plan (optional)", { exact: true })
    .fill("Borrow the school copier");
  await issue.getByRole("button", { name: "Raise issue" }).click();
  await expect(issue).not.toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Record a decision" }).click();
  const decision = page.getByRole("dialog", { name: "Record a decision" });
  await decision
    .getByLabel("The decision", { exact: true })
    .fill("Hold the event indoors");
  await decision
    .getByLabel("Rationale (optional)", { exact: true })
    .fill("Rain is forecast");
  await decision
    .getByLabel("Alternatives considered (optional)", { exact: true })
    .fill("Postpone");
  await decision
    .getByLabel("Affected records (optional)", { exact: true })
    .fill("Saturday session");
  await decision
    .getByLabel("What would reopen it (optional)", { exact: true })
    .fill("A dry forecast by Thursday");
  await decision.getByRole("button", { name: "Record decision" }).click();
  await expect(decision).not.toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Request a decision" }).click();
  const request = page.getByRole("dialog", { name: "Request a decision" });
  await request
    .getByLabel("Ask", { exact: true })
    .selectOption({ label: "QA Staff" });
  await request.getByLabel("Due", { exact: true }).fill("2026-10-01");
  await request
    .getByLabel("What needs deciding", { exact: true })
    .fill("Which room do we use?");
  await request.getByRole("button", { name: "Send request" }).click();
  await expect(request).not.toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(
    page.getByText("Notice inside two weeks").filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Packets cannot be printed").filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Borrow the school copier").filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Hold the event indoors").filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Rain is forecast").filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("A dry forecast by Thursday").filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Which room do we use?").filter({ visible: true }),
  ).toBeVisible();
});
