import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const RUN = `Tree ${Date.now().toString(36)}`;

/** A workspace page with one paragraph, written straight to the database. */
function makePage(title: string, text: string): string {
  const content = JSON.stringify({ version: 1, blocks: [{ type: "paragraph", content: [{ type: "text", text }] }] }).replace(/'/g, "''");
  return sql(`
    with p as (
      insert into public.page (organization_id, title, visibility, created_by)
      select organization_id, '${title}', 'workspace', '${OWNER}' from public.organization_membership where user_id = '${OWNER}'
      returning id, organization_id
    ), d as (
      insert into public.editor_document (object_id, object_type, organization_id, content, created_by)
      select id, 'page', organization_id, '${content}'::jsonb, '${OWNER}' from p
    )
    select id from p;
  `);
}

// On a phone, an open page used to sit under the whole page tree (favourites,
// recent and every workspace page), so its content started screens down — and
// blocks that load only near the screen never loaded at all.
test("on a phone an open page comes first, and the page tree opens from one button [switches on]", async ({ page, context }) => {
  for (let index = 0; index < 30; index += 1) makePage(`${RUN} filler ${index}`, "Filler");
  const pageId = makePage(`${RUN} open`, "The body of the open page");

  await page.setViewportSize({ width: 320, height: 700 });
  await signIn(page, "owner");
  await page.goto(`/pages/${pageId}`);

  const tree = page.getByRole("navigation", { name: "Pages" });
  const toggle = page.getByRole("button", { name: "All pages" });
  await expect(page.getByText("The body of the open page")).toBeInViewport({ timeout: 30_000 });
  await expect(tree).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(tree).toBeVisible();
  await tree.getByRole("link", { name: `${RUN} filler 3`, exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue(`${RUN} filler 3`, { timeout: 30_000 });
  // A newly opened page starts with the tree folded again.
  await expect(page.getByRole("button", { name: "All pages" })).toHaveAttribute("aria-expanded", "false");

  // The page list itself, with no page open, still shows the tree.
  await page.goto("/pages");
  await expect(tree).toBeVisible();
  await expect(page.getByRole("button", { name: "All pages" })).toHaveCount(0);

  // French, and at desktop width the tree is the left column with no button.
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.goto(`/pages/${pageId}`);
  await expect(page.getByRole("button", { name: "Toutes les pages" })).toBeVisible({ timeout: 30_000 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("button", { name: "Toutes les pages" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
  await context.clearCookies({ name: "qbbe-locale" });
});
