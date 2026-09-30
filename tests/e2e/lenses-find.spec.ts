import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/** Workspace OS M12: Find, behind wos_lenses. */

const RUN = `Qwfind${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
let previous = "f";

test.beforeAll(() => {
  previous = sql("select coalesce((select enabled from public.feature_flag where key = 'wos_lenses'), false)");
  sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  sql(`
    insert into public.task (organization_id, title, description, created_by, assignee_id)
    select organization_id, '${RUN} Réunion du conseil d''École', 'Ordre du jour', '${OWNER}', '${OWNER}'
    from public.organization_membership where user_id = '${OWNER}';
    insert into public.document (organization_id, title, description, owner_id, created_by, kind, url, visibility)
    select organization_id, '${RUN} Rapport annuel', 'Trois réunions prévues', '${OWNER}', '${OWNER}', 'link', 'https://docs.google.com/document/d/qwfind', 'staff'
    from public.organization_membership where user_id = '${OWNER}';
  `);
});

test.afterAll(() => {
  sql(`delete from public.task where title like '${RUN}%'`);
  sql(`delete from public.document where title like '${RUN}%'`);
  sql(`update public.feature_flag set enabled = ${previous === "t" ? "true" : "false"} where key = 'wos_lenses'`);
});

test("Find ignores accents and case, filters by type, and is accessible", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto("/lenses/find");
  await page.getByRole("searchbox", { name: "Search for" }).fill(`${RUN.toLowerCase()} reunion ecole`);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const results = page.getByRole("list", { name: "Results" });
  await expect(results.getByRole("link", { name: `${RUN} Réunion du conseil d'École` })).toBeVisible({ timeout: 30_000 });

  // A word in a description matches by stem, across types.
  await page.goto(`/lenses/find?q=${encodeURIComponent(`${RUN} réunion`)}`);
  await expect(results.getByRole("link")).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByText("2 results")).toBeVisible();

  await page.getByLabel("Type").selectOption({ label: "Document" });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(results.getByRole("link")).toHaveCount(1, { timeout: 30_000 });
  await expect(results).toContainText("Document");

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
});

test("Find shows a volunteer nothing they cannot open, in French", async ({ page }) => {
  await signIn(page, "volunteer");
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto(`/lenses/find?q=${encodeURIComponent(RUN)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Rechercher" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Aucun élément que vous pouvez ouvrir ne correspond à « ${RUN} ».`)).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  await page.context().clearCookies({ name: "qbbe-locale" });
});
