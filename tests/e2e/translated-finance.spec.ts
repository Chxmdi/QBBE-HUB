import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * The finance screens in French (#141).
 *
 * The owner, who can see every finance screen, switches to French and walks
 * them all: approvals, receipts, bills and invoices, the bank and its
 * reconciliations, GST and QST, budgets, every ledger page, year-end and
 * accountant access, gifts and grants, and payroll. On each page the main
 * landmarks (and the labels, placeholders and titles inside them) must hold no
 * English interface words, `<html lang>` must be `fr-CA`, and axe must find no
 * WCAG 2.2 AA violation.
 *
 * Records people typed (account names, vendors, memos, program names) are
 * data, not interface, and stay in whatever language they were written in.
 * They are read from the database and removed from the text before the check,
 * so a vendor called "Office Depot" cannot fail it and a hard-coded "Save"
 * still does. A quoted document marked with its own `lang` — an English
 * customer's invoice, the English tax disclaimer — is skipped the same way.
 *
 * The file name sorts after the other finance specs on purpose: CI runs the
 * signed-in specs in file order, so by the time this runs they have created the
 * entries, bills, reconciliations and runs whose detail pages it visits.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const OWNER = "qa-owner@example.com";

// English words that are not also French words. Interface text left in English
// almost always contains one of them; French text never does. Deliberately
// leaves out words both languages use: Date, Total, Description, Notes, Actions,
// Budget, Journal, Contacts, and "balance", "report", "net", "due", "fiscal",
// "export", "file", "or", "on" and "no" (numéro), which French accounting uses.
// Letters include accented ones: a plain \b would split « Payée » after "Pay".
const ENGLISH = new RegExp(
  `(?<![\\p{L}\\p{N}’'])(${[
    "the", "and", "of", "to", "your", "you", "this", "that", "these", "with", "from", "for",
    "is", "are", "was", "has", "have", "been", "not", "yet", "will", "can", "cannot",
    "can't", "don't", "isn't", "won't", "yes", "by", "at", "in", "into",
    "it", "its", "they", "their", "we", "our", "who", "what", "when", "which", "how", "why",
    "before", "after", "until", "then", "there", "here", "only", "more", "less", "than",
    "each", "every", "any", "all", "none", "nothing", "add", "new", "save", "edit",
    "delete", "remove", "record", "recorded", "download", "print", "open", "close",
    "closed", "back", "view", "show", "hide", "search", "submit", "approve", "approved",
    "reject", "rejected", "pending", "cancel", "post", "posted", "reverse", "reversed",
    "create", "upload", "choose", "select", "enter", "entries", "entry", "account",
    "accounts", "amount", "amounts", "paid", "unpaid", "draft",
    "month", "year", "period", "periods", "summary", "name",
    "status", "receipt", "receipts", "bill", "bills", "invoice", "invoices", "vendor",
    "vendors", "customer", "customers", "bank", "fund", "funds", "ledger", "donor",
    "donors", "gift", "gifts", "grant", "grants", "payroll", "tax", "program", "programs",
    "statement", "statements", "trial", "opening", "closing", "filed", "filing", 
    "return", "returns", "owner", "accountant", "access", "approval", "approvals", "request",
    "requests", "step", "steps", "rule", "rules", "assets", "liability", "liabilities",
    "revenue", "expense", "expenses", "debit", "debits", "credit", "credits", "overdue",
    "days", "week", "today", "loading", "failed", "could", "couldn't", "must", "should",
    "sign", "send", "sent", "received", "match", "matched", "unmatched", "imported",
    "reconcile", "reconciled", "reconciliation", "difference", "aging",
    "worksheet", "lines", "line", "setup", "settings", "run", "runs", "pay", 
  ].join("|")})(?![\\p{L}\\p{N}’'])`,
  "iu",
);

/** Every human-written value in the finance tables, to set aside as data. */
function recordedText(): string[] {
  const tables = [
    "approval_request", "approval_rule", "approval_step", "approval_item", "bank_account",
    "bank_import", "bank_transaction", "bank_reconciliation", "budget", "budget_line",
    "finance_bill", "finance_bill_line", "finance_contact", "finance_invoice",
    "finance_invoice_line", "finance_receipt", "finance_billing_settings", "gift",
    "gift_acknowledgement", "grant_award", "grant_report", "journal_entry", "journal_line",
    "ledger_account", "ledger_accountant_grant", "ledger_fund", "ledger_settings",
    "ledger_year_close", "payroll_run", "sales_tax_line", "sales_tax_period",
    "sales_tax_settings", "program", "project", "user_profile", "organization",
    "crm_organization", "crm_contact",
  ];
  const values = new Set<string>();
  for (const table of tables) {
    const json = sql(
      `select coalesce(json_agg(to_jsonb(x)), '[]')::text from public.${table} x;`,
    );
    for (const row of JSON.parse(json || "[]") as Record<string, unknown>[]) {
      for (const value of Object.values(row)) {
        // Everything people or specs stored is data (names, memos, slugs such
        // as "program-template-program-1790541347522", file names), except
        // enum codes ("posted", "net_assets"), which must not hide an
        // untranslated status label.
        if (
          typeof value === "string" &&
          value.trim().length > 1 &&
          !/^[a-z]+(?:_[a-z]+)*$/.test(value.trim())
        ) {
          values.add(value.trim());
        }
      }
    }
  }
  // Longest first, so "Bank - chequing" goes before "Bank".
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
        // A quoted document in another language, marked as such (an English
        // customer's invoice, the English tax disclaimer), is not interface.
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

async function expectFrench(page: Page, path: string, data: string[]) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} loads`).toBeLessThan(400);
  await expect(page.locator("main").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");

  const leftovers = (await landmarkText(page))
    .map((text) => {
      let rest = text;
      for (const value of data) if (rest.includes(value)) rest = rest.split(value).join(" ");
      // Email addresses and URLs are not words in either language.
      return rest.replace(/\S+@\S+|https?:\/\/\S+/g, " ");
    })
    .filter((rest) => ENGLISH.test(rest));
  expect.soft(leftovers, `English left on ${path}`).toEqual([]);

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

test.afterEach(() => setOwnerLocale(null));

test("every finance screen is in French, with French formats and no axe violations", async ({ page }) => {
  test.setTimeout(600_000);
  await signIn(page, "owner");

  // The profile is the record; the cookie is what the server reads first.
  setOwnerLocale("fr-CA");
  const { origin } = new URL(page.url());
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
  await page.goto(`${origin}/finance/ledger`);
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();

  const data = recordedText();
  const paths = [
    "/approvals",
    "/admin/approvals",
    "/finance/receipts",
    "/finance/payables",
    "/finance/payables/invoices",
    "/finance/payables/contacts",
    "/finance/payables/aging",
    "/finance/payables/bills/new",
    "/finance/payables/invoices/new",
    "/finance/bank",
    "/finance/sales-tax",
    "/finance/sales-tax/lines",
    "/finance/sales-tax/worksheet",
    "/finance/budgets",
    "/finance/budgets/programs",
    "/finance/ledger",
    "/finance/ledger/accounts",
    "/finance/ledger/funds",
    "/finance/ledger/periods",
    "/finance/ledger/journal",
    "/finance/ledger/journal/new",
    "/finance/ledger/trial-balance",
    "/finance/ledger/general-ledger",
    "/finance/ledger/statements",
    "/finance/ledger/returns",
    "/finance/ledger/receipts",
    "/finance/ledger/year-end",
    "/finance/ledger/accountant",
    "/finance/gifts",
    "/finance/gifts/donors",
    "/finance/gifts/grants",
    "/finance/gifts/statement",
    "/finance/payroll",
  ];

  // Detail pages, for whichever records the earlier finance specs left.
  const details: [string, string | null][] = [
    ["/finance/ledger/journal/", oneId("journal_entry")],
    ["/finance/bank/", oneId("bank_account")],
    ["/finance/bank/reconciliations/", oneId("bank_reconciliation")],
    ["/finance/payables/bills/", oneId("finance_bill")],
    ["/finance/payables/invoices/", oneId("finance_invoice")],
    ["/finance/budgets/", oneId("budget")],
    ["/finance/gifts/", oneId("gift")],
    ["/finance/gifts/grants/", oneId("grant_award")],
    ["/finance/payroll/", oneId("payroll_run")],
  ];
  for (const [prefix, id] of details) if (id) paths.push(`${prefix}${id}`);
  const budget = oneId("budget");
  if (budget) paths.push(`/finance/budgets/${budget}/report`);

  for (const path of paths) {
    await test.step(path, () => expectFrench(page, path, data));
  }

  // Quebec formats: money reads "1 234,56 $", never "$1,234.56".
  await page.goto("/finance/ledger/trial-balance");
  const main = (await page.locator("main").innerText()).replace(/[  ]/g, " ");
  expect(main).not.toMatch(/\$\d/);
  expect(main).toMatch(/\d,\d{2} \$/);
});
