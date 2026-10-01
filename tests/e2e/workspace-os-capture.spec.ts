import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Capture inbox (M18, epic #199): quick capture, suggestions by rule, one tap
 * to file. Behind wos_capture, which this spec turns on for its own run.
 */

async function axeProblems(page: Page): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
}

test.beforeAll(() => {
  sql(`update feature_flag set enabled = true where key = 'wos_capture' and organization_id is null`);
});
test.afterAll(() => {
  sql(`update feature_flag set enabled = false where key = 'wos_capture' and organization_id is null`);
});

test("a note is captured, matched to its project, and filed as a task in one tap", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const note = `Call the venue for the Fall Community Workshop Series ${suffix}`;

  await signIn(page, "owner");
  await page.goto("/capture");
  await expect(page.getByRole("heading", { name: "Capture", level: 1 })).toBeVisible();
  expect(await axeProblems(page), "capture page accessibility").toEqual([]);

  // Keyboard: the kind is a radio group; the note is the default.
  await page.getByRole("radio", { name: "Note" }).focus();
  await page.getByLabel("What do you want to remember?").fill(note);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Captured." })).toBeVisible();

  const item = page.getByRole("listitem").filter({ hasText: note });
  const primary = item.getByRole("button", { name: /^Task in Fall Community Workshop Series/ });
  await expect(primary).toBeVisible();
  expect(await axeProblems(page), "inbox accessibility").toEqual([]);
  await primary.click();
  await expect(page.getByRole("listitem").filter({ hasText: note })).toHaveCount(0);

  // A real task, in the project, naming the capture item as its source (M7b).
  const project = sql(`select id from project where name = 'Fall Community Workshop Series'`);
  await expect
    .poll(() =>
      sql(`select t.project_id || ':' || t.source_type || ':' || (c.status) from task t
           join capture_item c on c.id = t.source_id where t.title = '${note}'`),
    )
    .toBe(`${project}:capture:filed`);
});

test("a forwarded email is matched to its sender and logged to the contact", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const subject = `Grant report dates ${suffix}`;
  await signIn(page, "owner");
  await page.goto("/capture");
  await page.getByRole("radio", { name: "Forwarded email" }).check();
  await page.getByLabel("Paste the forwarded email").fill(
    [
      "---------- Forwarded message ---------",
      "From: Program Officer <contact@example.org>",
      `Subject: ${subject}`,
      "",
      "The interim report is due November 15.",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const item = page.getByRole("listitem").filter({ hasText: subject });
  await expect(item.getByText("From Program Officer <contact@example.org>")).toBeVisible();
  await item.getByRole("button", { name: /^Log email to Program Officer/ }).click();
  await expect(page.getByRole("listitem").filter({ hasText: subject })).toHaveCount(0);
  await expect
    .poll(() => sql(`select interaction_type from crm_interaction where summary like '${subject}%'`))
    .toBe("email");
});

test("a file is captured and saved as a document; a dismissed item leaves; nobody else sees the inbox", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const fileName = `minutes-${suffix}.txt`;
  const throwaway = `Throwaway ${suffix}`;

  await signIn(page, "owner");
  await page.goto("/capture");
  await page.getByRole("radio", { name: "File" }).check();
  await page.getByLabel("Choose a file").setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from("Minutes of the board meeting."),
  });
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const fileItem = page.getByRole("listitem").filter({ hasText: fileName });
  await fileItem.getByRole("button", { name: "Document, no project" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: fileName })).toHaveCount(0);
  await expect.poll(() => sql(`select kind from document where title = '${fileName}'`)).toBe("file");

  await page.getByRole("radio", { name: "Note" }).check();
  await page.getByLabel("What do you want to remember?").fill(throwaway);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: throwaway })).toBeVisible();

  // The volunteer's inbox does not show the owner's item.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto("/capture");
  await expect(page.getByRole("heading", { name: "Capture", level: 1 })).toBeVisible();
  await expect(page.getByText(throwaway)).toHaveCount(0);

  await signOut(page);
  await signIn(page, "owner");
  await page.goto("/capture");
  await page.getByRole("listitem").filter({ hasText: throwaway }).getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: throwaway })).toHaveCount(0);
  expect(sql(`select status from capture_item where title = '${throwaway}'`)).toBe("dismissed");
});

test("the capture page speaks French", async ({ page, context }) => {
  await signIn(page, "owner");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto("/capture");
  await expect(page.getByRole("heading", { name: "Saisie rapide", level: 1 })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Courriel transféré" })).toBeVisible();
  expect(await axeProblems(page), "French capture accessibility").toEqual([]);
});

test("the capture page stays hidden while the switch is off [switch off]", async ({ page }) => {
  sql(`update feature_flag set enabled = false where key = 'wos_capture' and organization_id is null`);
  try {
    await signIn(page, "owner");
    await page.goto("/capture");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
  } finally {
    sql(`update feature_flag set enabled = true where key = 'wos_capture' and organization_id is null`);
  }
});
