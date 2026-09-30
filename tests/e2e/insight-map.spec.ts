import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { expectAccessible, qaIds, setLensesSwitch } from "./insight";

// A 1x1 transparent PNG: the test never asks OpenStreetMap for real tiles.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/**
 * Map lens (V2-1): events with coordinates placed on OpenStreetMap tiles,
 * numbered markers matching a list of the same places, zoom and pan as
 * keyboard-usable links, attribution shown. Hidden until the lenses switch is on.
 */
test("the map lens places events, lists them, and zooms from the keyboard", async ({ page }) => {
  test.setTimeout(150_000);
  const marker = `Map ${Date.now()}`;
  const { ownerId, orgId } = qaIds();
  const insert = (name: string, location: string) =>
    sql(
      `insert into event (organization_id, name, starts_at, location, owner_id, created_by)
       values ('${orgId}', '${marker} ${name}', now() + interval '5 days', '${location}', '${ownerId}', '${ownerId}') returning id`,
    );
  const montreal = insert("Montréal gala", "45.5019, -73.5674");
  insert("Québec forum", "Centre des congrès (46.8095, -71.2140)");
  insert("Address only", "1234 Rue Sainte-Catherine");

  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  const before = setLensesSwitch(false);
  try {
    await signIn(page, "owner");
    await page.goto("/insight/map");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();

    setLensesSwitch(true);
    await page.goto("/insight/map");
    await expect(page.getByRole("heading", { name: "Map", exact: true })).toBeVisible();
    const map = page.getByRole("region", { name: /^Map with \d+ places/ });
    await expect(map).toBeVisible();
    await expect(map.getByRole("link", { name: new RegExp(`^\\d+\\. ${marker} Montréal gala$`) })).toBeVisible();
    await expect(map.getByRole("link", { name: new RegExp(`^\\d+\\. ${marker} Québec forum$`) })).toBeVisible();
    await expect(map.getByRole("link", { name: "OpenStreetMap contributors" })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/copyright",
    );
    // The address without coordinates is counted, not placed.
    await expect(page.getByText(/more have no location that can be placed/)).toBeVisible();
    await expect(page.getByRole("link", { name: `${marker} Address only` })).toHaveCount(0);

    // The list alternative names the same places and opens the event.
    const places = page.getByRole("list").filter({ has: page.getByRole("link", { name: `${marker} Montréal gala`, exact: true }) });
    await expect(places.getByRole("link", { name: `${marker} Montréal gala`, exact: true })).toHaveAttribute("href", `/events/${montreal}`);
    await expectAccessible(page);

    // Keyboard: zoom in with Enter, then back to every place.
    const zoomIn = page.getByRole("navigation", { name: "Map controls" }).getByRole("link", { name: "Zoom in" });
    await zoomIn.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/insight\/map\?lat=.*&z=\d+/);
    await page.getByRole("link", { name: `Show ${marker} Montréal gala on the map` }).click();
    await expect(page).toHaveURL(/lat=45\.50190&lng=-73\.56740&z=1[4-7]/);
    await expect(page.getByText(/are outside this view/)).toBeVisible();
    await page.getByRole("link", { name: "Show every place" }).click();
    await expect(page).toHaveURL(/\/insight\/map$/);

    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Carte", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "les contributeurs d’OpenStreetMap" })).toBeVisible();
  } finally {
    setLensesSwitch(before);
    sql(`delete from event where name like '${marker}%'`);
  }
});
