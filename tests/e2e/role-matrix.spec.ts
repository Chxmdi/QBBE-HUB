import { expect, test } from "./fixtures";
import { signIn, type QaAccount } from "./auth";
import { sql } from "./db";

/**
 * The browser role matrix (#110, QA-FINAL "roles"). Every organization role
 * and every scoped role signs in and is checked against the same table: which
 * surfaces it reaches, which records it can open, what it can change on them,
 * and that a record it may not open leaks nothing into the page.
 *
 * The owner is left to qa-matrix and mfa.spec.ts, which already sign in as the
 * owner on every run; the admin here covers the administrator paths.
 *
 * Scoped accounts come from supabase/tests/qa-scoped-grants.sql:
 *   lead         staff, program lead on "Family First"
 *   pm           staff, project manager on "Fall Community Workshop Series"
 *   contributor  volunteer, contributor on "Tutor Recruitment Drive"
 *   readonly     volunteer, read-only on "Fall Community Workshop Series"
 * "Fall Community Workshop Series" belongs to "Family First", so the lead
 * reaches it through the program; "Tutor Recruitment Drive" belongs to
 * "Tutoring & Mentorship", which no scoped account holds.
 */

const FALL = "Fall Community Workshop Series";
const TUTOR = "Tutor Recruitment Drive";
const FAMILY = "Family First";
const TUTORING = "Tutoring & Mentorship";

// Text that only appears on each record's own page, so its absence from a
// refused page shows the record did not leak rather than merely that the
// heading changed.
const PROJECT_OUTCOME: Record<string, string> = {
  [FALL]: "Deliver six community workshops with 80% attendance satisfaction.",
  [TUTOR]: "Recruit and onboard 25 qualified volunteer tutors before the winter term.",
};
const PROGRAM_DESCRIPTION: Record<string, string> = {
  [FAMILY]: "Family and community education support services.",
  [TUTORING]: "After-school tutoring and mentorship programming.",
};

type Access = "allowed" | "redirected";
type RecordAccess = "manage" | "read" | "none";

interface Row {
  account: QaAccount;
  staffSurfaces: Access; // /crm, /reports
  adminSurfaces: Access; // /admin, /admin/access
  newProject: boolean;
  projects: Record<string, RecordAccess>;
  programs: Record<string, RecordAccess>;
}

const MATRIX: Row[] = [
  {
    account: "admin",
    staffSurfaces: "allowed",
    adminSurfaces: "allowed",
    newProject: true,
    projects: { [FALL]: "manage", [TUTOR]: "manage" },
    programs: { [FAMILY]: "manage", [TUTORING]: "manage" },
  },
  {
    // Staff reach the staff surfaces, but records are scoped: an ungranted
    // staff member sees no programme or project (#24).
    account: "staff",
    staffSurfaces: "allowed",
    adminSurfaces: "redirected",
    newProject: true,
    projects: { [FALL]: "none", [TUTOR]: "none" },
    programs: { [FAMILY]: "none", [TUTORING]: "none" },
  },
  {
    account: "volunteer",
    staffSurfaces: "redirected",
    adminSurfaces: "redirected",
    newProject: false,
    projects: { [FALL]: "none", [TUTOR]: "none" },
    programs: { [FAMILY]: "none", [TUTORING]: "none" },
  },
  {
    account: "guest",
    staffSurfaces: "redirected",
    adminSurfaces: "redirected",
    newProject: false,
    projects: { [FALL]: "none", [TUTOR]: "none" },
    programs: { [FAMILY]: "none", [TUTORING]: "none" },
  },
  {
    account: "lead",
    staffSurfaces: "allowed",
    adminSurfaces: "redirected",
    newProject: true,
    projects: { [FALL]: "manage", [TUTOR]: "none" },
    programs: { [FAMILY]: "manage", [TUTORING]: "none" },
  },
  {
    account: "pm",
    staffSurfaces: "allowed",
    adminSurfaces: "redirected",
    newProject: true,
    projects: { [FALL]: "manage", [TUTOR]: "none" },
    programs: { [FAMILY]: "none", [TUTORING]: "none" },
  },
  {
    account: "contributor",
    staffSurfaces: "redirected",
    adminSurfaces: "redirected",
    newProject: false,
    projects: { [FALL]: "none", [TUTOR]: "read" },
    programs: { [FAMILY]: "none", [TUTORING]: "none" },
  },
  {
    account: "readonly",
    staffSurfaces: "redirected",
    adminSurfaces: "redirected",
    newProject: false,
    projects: { [FALL]: "read", [TUTOR]: "none" },
    programs: { [FAMILY]: "none", [TUTORING]: "none" },
  },
];

// Reached by every signed-in role; what is on them is scoped by the database.
const EVERYONE = ["/", "/my-work", "/board", "/programs", "/projects", "/people", "/channels", "/settings"];
const STAFF_ONLY = ["/crm", "/reports"];
const ADMIN_ONLY = ["/admin", "/admin/access"];

function idsByName(table: "project" | "program"): Record<string, string> {
  return Object.fromEntries(
    sql(`select name || '|' || id from ${table}`)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|")),
  );
}

test.describe("role matrix", () => {
  const projectIds = idsByName("project");
  const programIds = idsByName("program");

  for (const row of MATRIX) {
    test(`${row.account}: surfaces, records and actions match the matrix`, async ({ page }) => {
      test.setTimeout(180_000);
      await signIn(page, row.account);

      const where = async (path: string) => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        return new URL(page.url()).pathname;
      };

      for (const path of EVERYONE) {
        expect(await where(path), `${row.account} reaches ${path}`).toBe(path);
      }
      for (const path of STAFF_ONLY) {
        const landed = await where(path);
        if (row.staffSurfaces === "allowed") {
          expect(landed, `${row.account} reaches ${path}`).toBe(path);
        } else {
          expect(landed, `${row.account} is sent away from ${path}`).toBe("/");
        }
      }
      for (const path of ADMIN_ONLY) {
        const landed = await where(path);
        if (row.adminSurfaces === "allowed") {
          expect(landed, `${row.account} reaches ${path}`).toBe(path);
        } else {
          expect(landed, `${row.account} is sent away from ${path}`).toBe("/");
        }
      }

      await where("/projects");
      await expect(
        page.getByRole("button", { name: "New project" }),
        `${row.account} ${row.newProject ? "is" : "is not"} offered New project`,
      ).toHaveCount(row.newProject ? 1 : 0);

      for (const [name, access] of Object.entries(row.projects)) {
        await where(`/projects/${projectIds[name]}`);
        await checkRecord(page, row.account, name, access, "Edit project", PROJECT_OUTCOME[name]);
      }
      for (const [name, access] of Object.entries(row.programs)) {
        await where(`/programs/${programIds[name]}`);
        await checkRecord(page, row.account, name, access, "Edit program", PROGRAM_DESCRIPTION[name]);
      }
    });
  }
});

async function checkRecord(
  page: import("@playwright/test").Page,
  account: QaAccount,
  name: string,
  access: RecordAccess,
  editLabel: string,
  privateText: string,
) {
  const heading = page.locator("h1").first();
  if (access === "none") {
    await expect(heading, `${account} is refused ${name}`).toHaveText(/Not found/);
    // Nothing from the record reaches the refused page, including the
    // server-rendered HTML a person could read with view-source.
    const html = await page.content();
    expect(html.includes(privateText), `${name} leaks into ${account}'s refused page`).toBe(false);
    return;
  }
  await expect(heading, `${account} opens ${name}`).toHaveText(name);
  await expect(
    page.getByRole("button", { name: editLabel }),
    `${account} ${access === "manage" ? "can" : "cannot"} edit ${name}`,
  ).toHaveCount(access === "manage" ? 1 : 0);
}
