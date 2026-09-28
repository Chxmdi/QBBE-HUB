import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { featureQaRoutes, featureRoutes } from "./feature-routes";

/**
 * The whole workspace in French (#141).
 *
 * `translated-finance.spec.ts` covers the finance screens in depth; this one
 * covers everything else, and repeats the finance routes that the feature
 * files list so a route added later is swept without editing this file. The
 * owner, who can open every screen, switches to French and visits every route
 * in tests/e2e/routes/*.json, the core workspace routes, one detail page per
 * kind of record, and the signed-out screens. On each page:
 *
 *   - `<html lang>` is `fr-CA`;
 *   - the landmarks (the main one, and the header, navigation and sidebars
 *     around it), including their labels, placeholders and titles, hold no
 *     English interface words;
 *   - no date, time or amount is written the English way ("Sep 28",
 *     "2:30 PM", "$1,234.56");
 *   - axe finds no WCAG 2.2 AA violation.
 *
 * Records people typed (names, titles, messages) are data, not interface, and
 * stay in whatever language they were written in. Every stored value in the
 * database is read and removed from the text before the check, so a project
 * called "Summer reading plan" cannot fail it and a hard-coded "Save" still
 * does. Content quoted in another language and marked with its own `lang` is
 * skipped the same way.
 *
 * The file name sorts after the other specs on purpose: CI runs the signed-in
 * specs in file order, so by the time this runs they have created the
 * projects, meetings, forms and documents whose detail pages it visits.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const OWNER = "qa-owner@example.com";

// English words that are not also French words. Interface text left in English
// almost always contains one of them; French text never does. Deliberately
// leaves out words both languages spell the same (date, message, document,
// notes, contact, agenda, minutes, action, type, total, public, plan, location,
// notifications, archive, import, signature, active, inactive, comment, lead,
// admin, change, continue, urgent, sent, invite, sort), and "report", "export", "file", "due", "on", "no", "an" and "as",
// which French also uses. Letters include accented ones: a plain \b would
// split « Payée » after "Pay".
const ENGLISH_WORDS = [
  // Grammar words.
  "the", "and", "of", "to", "your", "you", "this", "that", "these", "with", "from", "for",
  "is", "are", "was", "has", "have", "been", "not", "yet", "will", "can", "cannot",
  "can't", "don't", "isn't", "won't", "doesn't", "didn't", "you're", "it's", "there's",
  "yes", "by", "at", "in", "into", "it", "its", "they", "their", "we", "our", "who",
  "what", "when", "which", "how", "why", "before", "after", "until", "then", "there",
  "here", "only", "more", "less", "than", "each", "every", "any", "all", "none",
  "nothing", "no one", "nobody", "about", "without", "should", "must", "could",
  "couldn't", "would", "please",
  // Actions.
  "add", "new", "save", "edit", "delete", "remove", "download", "print", "open", "close",
  "closed", "back", "view", "show", "hide", "search", "submit", "approve", "approved",
  "reject", "rejected", "pending", "cancel", "create", "upload", "choose", "select",
  "enter", "send", "sign", "invited", "clear", "restore", "retry",
  "reply", "replies", "mark", "read", "unread", "join", "leave", "move", "copy",
  "share", "shared", "assign", "assigned", "unassigned", "filter", "filters",
  "apply", "update", "updated", "created", "deleted", "archived", "complete",
  "completed", "done", "start", "started", "end", "ended", 
  "manage", "next", "previous", "loading", "saving", "failed", "error",
  // Things.
  "task", "tasks", "project", "projects", "program", "programs", "meeting", "meetings",
  "event", "events", "people", "person", "team", "teams", "member", "members",
  "calendar", "schedule", "channel", "channels", "inbox", "announcement",
  "announcements", "comments", "request", "requests", "form", "forms", "field",
  "fields", "template", "templates", "settings", "profile", "password", "email",
  "user", "users", "role", "roles", "owner", "organization", "organizations",
  "workspace", "overview", "activity", "health", "workload", "upcoming", "recent",
  "status", "priority", "review", "blocked", "overdue", "today", "tomorrow",
  "yesterday", "week", "month", "year", "day", "days", "hour", "hours", "time",
  "title", "name", "details", "summary", "untitled", "unknown", "welcome", "records",
  "record", "access", "approval", "approvals", "risk", "risks", "decision", "decisions",
  "outcome", "outcomes", "milestone", "milestones", "attendees", "follow-up",
  "saved", "library", "folder", "folders", "signed", "account", "accounts", "jobs",
  "retention", "hold", "holds", "policy", "policies", "board", "results", "anyone",
  "everyone", "high", "low", "medium",
];
const ENGLISH = new RegExp(
  `(?<![\\p{L}\\p{N}’'])(${ENGLISH_WORDS.join("|")})(?![\\p{L}\\p{N}’'])`,
  "iu",
);

// Dates, times and amounts written the English way. French writes « 28 sept. »,
// « 14 h 30 » and « 1 234,56 $ ». Case-sensitive, and short weekdays only
// with the comma English puts after them: French « mar. » is Tuesday and
// « Mon travail » is My work.
const ENGLISH_FORMAT =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December) \d|\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),|\d ?(AM|PM|am|pm|a\.m\.|p\.m\.)\b|\$\d/;

/**
 * Every human-written value stored in the workspace, to set aside as data.
 * Read from every table, so a feature added later is covered without a list.
 */
function recordedText(): string[] {
  const tables = sql(
    "select string_agg(table_name, ' ') from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';",
  )
    .split(/\s+/)
    .filter(Boolean);
  const values = new Set<string>();
  for (const table of tables) {
    const json = sql(
      `select coalesce(json_agg(to_jsonb(x)), '[]')::text from (select * from public.${table} limit 2000) x;`,
    );
    const collect = (value: unknown, column = "") => {
      if (typeof value === "string") {
        const text = value.trim();
        // Enum codes ("in_review", "not_started") are not data: they must not
        // hide an untranslated status label. Names are, even when they look
        // like one: the "announcements" channel is called that in French too,
        // and a document tagged "policy" keeps its tag.
        const named = /(^|_)(name|slug|title|tags?)$/.test(column);
        if (text.length > 1 && (named || !/^[a-z]+(?:_[a-z]+)*$/.test(text))) values.add(text);
      } else if (Array.isArray(value)) {
        for (const item of value) collect(item, column);
      } else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) collect(item, key);
      }
    };
    for (const row of JSON.parse(json || "[]") as Record<string, unknown>[]) collect(row);
  }
  // Longest first, so "Summer reading plan" goes before "Summer".
  return [...values].sort((a, b) => b.length - a.length);
}

/** Text in the landmarks, one string per text node or labelling attribute. */
async function landmarkText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector =
      "main, header, nav, aside, footer, [role=main], [role=banner], [role=navigation], [role=complementary], [role=contentinfo]";
    // Outermost landmarks only, so nested ones are not read twice.
    const roots = Array.from(document.querySelectorAll(selector)).filter(
      (element) => !element.parentElement?.closest(selector),
    );
    const out: string[] = [];
    for (const root of roots) {
      for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
        if (element.closest("script, style, template, noscript")) continue;
        // Quoted content in another language, marked as such, is not interface.
        if (element.closest("[lang]:not([lang^=fr])")) continue;
        for (const attribute of ["aria-label", "title", "placeholder", "alt"]) {
          const value = element.getAttribute(attribute)?.trim();
          if (value) out.push(value);
        }
        for (const child of Array.from(element.childNodes)) {
          const text = child.nodeType === Node.TEXT_NODE ? child.textContent?.trim() : "";
          if (text) out.push(text);
        }
      }
    }
    return out;
  });
}

function withoutData(text: string, data: string[]): string {
  let rest = text;
  for (const value of data) if (rest.includes(value)) rest = rest.split(value).join(" ");
  for (const name of PRODUCT_NAMES) rest = rest.split(name).join(" ");
  // Email addresses, URLs, template placeholders ({{person.name}}) and
  // environment variable names (EMAIL_PROVIDER_API_KEY) are not words in
  // either language.
  return rest.replace(/\S+@\S+|https?:\/\/\S+|\{\{[^}]*\}\}|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, " ");
}

// Product names are written the same in French.
const PRODUCT_NAMES = ["Microsoft Teams", "Teams", "Google Meet", "Zoom"];

async function expectFrench(page: Page, path: string, data: string[]) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} loads`).toBeLessThan(400);
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");

  const rests = (await landmarkText(page)).map((text) => withoutData(text, data));
  expect.soft(rests.filter((rest) => ENGLISH.test(rest)), `English left on ${path}`).toEqual([]);
  expect
    .soft(rests.filter((rest) => ENGLISH_FORMAT.test(rest)), `English formats on ${path}`)
    .toEqual([]);

  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect.soft(results.violations, `axe on ${path}`).toEqual([]);
}

/** The id of one row of a table, or null when the table is empty. */
function oneId(table: string, where = "true"): string | null {
  return sql(`select id::text from public.${table} where ${where} limit 1;`) || null;
}

const setOwnerLocale = (locale: string | null) =>
  sql(
    `update public.user_profile set locale = ${locale ? `'${locale}'` : "null"} where email = '${OWNER}';`,
  );

// The workspace routes every spec relies on, beyond the feature files.
const CORE_ROUTES = [
  "/", "/?denied=1", "/my-work", "/board", "/requests", "/forms", "/forms/new", "/projects", "/programs",
  "/approvals", "/approvals?tab=away", "/inbox", "/channels", "/messages", "/saved",
  "/announcements", "/calendar", "/schedule", "/meetings", "/events", "/people",
  "/people/overview", "/crm", "/reports", "/search", "/search?q=workshop", "/documents",
  "/documents/templates", "/signatures", "/settings", "/settings/notifications",
  "/admin", "/admin/access", "/admin/approvals", "/admin/design-system", "/admin/email",
  "/admin/exports", "/admin/jobs", "/admin/records", "/admin/retention", "/admin/templates",
  "/finance/receipts",
];

test.afterEach(() => setOwnerLocale(null));

test("every workspace screen is in French, with Quebec formats and no axe violations", async ({ page }) => {
  test.setTimeout(900_000);
  await signIn(page, "owner");

  // The profile is the record; the cookie is what the server reads first.
  setOwnerLocale("fr-CA");
  const { origin } = new URL(page.url());
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
  await page.goto(`${origin}/`);
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();

  const data = recordedText();
  const paths = new Set<string>([
    ...featureRoutes("everyone"),
    ...featureRoutes("staffOnly"),
    ...featureRoutes("adminOnly"),
    ...featureQaRoutes().map((route) => route.path),
    ...CORE_ROUTES,
  ]);

  // Detail pages, for whichever records the earlier specs left.
  const details: [string, string | null][] = [
    ["/projects/", oneId("project")],
    ["/programs/", oneId("program")],
    ["/meetings/", oneId("meeting")],
    ["/events/", oneId("event")],
    ["/channels/", oneId("channel", "archived_at is null")],
    ["/messages/", oneId("conversation")],
    ["/crm/", oneId("crm_organization")],
    ["/documents/", oneId("document")],
    ["/reports/", oneId("report_instance")],
    ["/signatures/", oneId("signing_document")],
    ["/forms/", oneId("form_definition")],
    ["/forms/submissions/", oneId("form_submission")],
  ];
  for (const [prefix, id] of details) if (id) paths.add(`${prefix}${id}`);
  const form = oneId("form_definition");
  if (form) {
    paths.add(`/forms/${form}/edit`);
    paths.add(`/forms/${form}/submissions`);
  }

  for (const path of paths) {
    await test.step(path, () => expectFrench(page, path, data));
  }
});

test("the signed-out screens are in French", async ({ page }) => {
  await page.goto("/sign-in");
  const { origin } = new URL(page.url());
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
  const data = recordedText();
  for (const path of ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"]) {
    await test.step(path, () => expectFrench(page, path, data));
  }
});
