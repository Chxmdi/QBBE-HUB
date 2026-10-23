import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * An export about one CRM contact (PRIV-015): an owner with MFA asks for it,
 * the export job builds it, and the file holds the contact and what names it,
 * nothing from another organization. Asking and downloading are both
 * audited. Who may ask is proven in supabase/tests/person-export-registry.sql.
 */

const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const JOB_SECRET = process.env.CRON_JOB_SECRET ?? "";

test("an owner exports everything about one contact, and both steps are audited", async ({ page, request }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const name = `Zzexport Donor ${stamp}`;
  const org = sql(`select organization_id::text from organization_membership where user_id = '${OWNER}' limit 1`);
  const contact = sql(`insert into crm_contact (organization_id, full_name, email)
    values ('${org}', '${name}', 'zzexport-${stamp}@example.com') returning id::text`);
  sql(`insert into crm_interaction (organization_id, contact_id, interaction_type, occurred_at, summary, owner_id)
    values ('${org}', '${contact}', 'call', now(), 'Zzexport spring gift call ${stamp}', '${OWNER}')`);
  const otherOrg = sql(`insert into organization (name, slug) values ('Zzexport Other ${stamp}', 'zzexport-other-${stamp}') returning id::text`);
  sql(`insert into crm_contact (organization_id, full_name, email)
    values ('${otherOrg}', 'Zzexport Elsewhere ${stamp}', 'zzexport-${stamp}@example.com')`);

  try {
    await signIn(page, "owner");
    await page.goto("/admin/exports");
    await page.getByRole("button", { name: "Request an export" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What to export").selectOption("contact_data");
    await dialog.getByLabel("About which contact").selectOption(contact);
    await dialog.getByRole("button", { name: "Queue it" }).click();
    await expect(dialog).toBeHidden();

    const job = sql(`select id::text from export_job where subject_contact_id = '${contact}' and kind = 'contact_data'`);
    expect(job).not.toBe("");
    expect(sql(`select count(*) from audit_event where object_id = '${job}' and action = 'export_requested'
      and metadata ->> 'subject_contact_id' = '${contact}'`)).toBe("1");

    const run = await request.post("/api/jobs/run-exports", { headers: { "x-job-secret": JOB_SECRET } });
    expect(run.ok()).toBeTruthy();
    expect(sql(`select status from export_job where id = '${job}'`)).toBe("ready");

    await page.reload();
    await expect(page.getByText(`— ${name}`)).toBeVisible();
    const file = await page.request.get(`/api/exports/${job}/download`);
    expect(file.ok()).toBeTruthy();
    const body = await file.text();
    expect(body).toContain(name);
    expect(body).toContain(`Zzexport spring gift call ${stamp}`);
    expect(body).not.toContain(`Zzexport Elsewhere ${stamp}`);
    expect(sql(`select count(*) from audit_event where object_id = '${job}' and action = 'export_downloaded'`)).toBe("1");
  } finally {
    sql(`delete from export_job where subject_contact_id = '${contact}'`);
    sql(`delete from crm_contact where id = '${contact}'`);
    sql(`delete from organization where id = '${otherOrg}'`);
  }
});
