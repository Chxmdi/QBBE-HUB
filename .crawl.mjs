// Route crawl: every page as owner, staff and volunteer (English), staff again
// in French; every API route signed out and as staff. Records anything that
// looks like a bug. Usage: node crawl.mjs <label>  (label names the output file)
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
const BASE = "http://127.0.0.1:3000";
const OUT = "/tmp/claude-0/-home-user-QBBE-HUB/2cfc2b36-5360-5ffe-9b42-263cabb4c577/scratchpad/crawl";
const label = process.argv[2] ?? "run";
const findingsPath = `${OUT}/${label}.jsonl`;
writeFileSync(findingsPath, "");
const sql = (s) => spawnSync("docker", ["exec","-i","supabase_db_workspace","psql","-U","postgres","-d","postgres","-tA"], { input: s, encoding: "utf8" }).stdout.trim();
const RANDOM = "11111111-1111-4111-8111-111111111111";
const pick = (q) => sql(q) || RANDOM;
const ids = {
  slug: sql("select slug from public.workspace_app where published_at is not null limit 1") || "no-such-app",
  app: pick("select id from public.workspace_app limit 1"),
  blueprint: pick("select id from public.blueprint limit 1"),
  channel: pick("select id from public.channel limit 1"),
  task: pick("select id from public.task where archived_at is null order by created_at limit 1"),
  crm: pick("select id from public.crm_organization limit 1"),
  decision: pick("select id from public.decision limit 1"),
  project: pick("select id from public.project order by created_at limit 1"),
  document: pick("select id from public.document limit 1"),
  event: pick("select id from public.event limit 1"),
  bank: pick("select id from public.bank_account limit 1"),
  recon: pick("select id from public.bank_reconciliation limit 1"),
  budget: pick("select id from public.budget limit 1"),
  gift: pick("select id from public.gift limit 1"),
  grant: pick("select id from public.grant_award limit 1"),
  journal: pick("select id from public.journal_entry limit 1"),
  bill: pick("select id from public.finance_bill limit 1"),
  invoice: pick("select id from public.finance_invoice limit 1"),
  payroll: pick("select id from public.payroll_run limit 1"),
  formv2: pick("select id from public.form_v2 limit 1"),
  form: pick("select id from public.form_definition limit 1"),
  submission: pick("select id from public.form_submission limit 1"),
  goal: pick("select id from public.goal limit 1"),
  meeting: pick("select id from public.meeting order by created_at limit 1"),
  conversation: pick("select id from public.conversation limit 1"),
  pslug: sql("select slug from public.published_page limit 1") || "no-such-page",
  page: pick("select id from public.page where deleted_at is null limit 1"),
  staff: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
  program: pick("select id from public.program order by created_at limit 1"),
  report: pick("select id from public.report_instance limit 1"),
  signing: pick("select id from public.signing_document limit 1"),
  space: pick("select id from public.space limit 1"),
  template: pick("select id from public.template_v2 limit 1"),
  workflow: pick("select id from public.workflow_rule limit 1"),
  run: sql("select rule_id || '/runs/' || id from public.workflow_execution limit 1") || `${RANDOM}/runs/${RANDOM}`,
  review: pick("select id from public.workflow_review limit 1"),
  lens: pick("select id from public.lens limit 1"),
};
const routes = readFileSync(`${OUT}/routes.txt`, "utf8").trim().split(/\s+/).map((r) => r
  .replace("/apps/[slug]/[screen]", `/apps/${ids.slug}/tasks`).replace("/apps/[slug]", `/apps/${ids.slug}`).replace("/apps/manage/[id]", `/apps/manage/${ids.app}`)
  .replace("/builder/[id]", `/builder/${ids.blueprint}`).replace("/channels/[id]", `/channels/${ids.channel}`)
  .replace("/collab/layouts/[typeKey]/preview", "/collab/layouts/task/preview").replace("/collab/layouts/[typeKey]", "/collab/layouts/task")
  .replace("/collab/live/[objectId]", `/collab/live/${ids.task}?type=task`).replace("/collab/objects/[objectId]", `/collab/objects/${ids.task}?type=task`)
  .replace("/collab/versions/[objectId]/compare", `/collab/versions/${ids.task}/compare?type=task`).replace("/collab/versions/[objectId]", `/collab/versions/${ids.task}?type=task`)
  .replace("/crm/[id]", `/crm/${ids.crm}`).replace("/decisions/trail/[projectId]", `/decisions/trail/${ids.project}`).replace("/decisions/[id]", `/decisions/${ids.decision}`)
  .replace("/documents/[id]", `/documents/${ids.document}`).replace("/events/[id]", `/events/${ids.event}`)
  .replace("/finance/bank/reconciliations/[id]", `/finance/bank/reconciliations/${ids.recon}`).replace("/finance/bank/[id]", `/finance/bank/${ids.bank}`)
  .replace("/finance/budgets/[id]/report", `/finance/budgets/${ids.budget}/report`).replace("/finance/budgets/[id]", `/finance/budgets/${ids.budget}`)
  .replace("/finance/gifts/grants/[id]", `/finance/gifts/grants/${ids.grant}`).replace("/finance/gifts/[id]", `/finance/gifts/${ids.gift}`)
  .replace("/finance/ledger/journal/[id]", `/finance/ledger/journal/${ids.journal}`)
  .replace("/finance/payables/bills/[id]", `/finance/payables/bills/${ids.bill}`).replace("/finance/payables/invoices/[id]", `/finance/payables/invoices/${ids.invoice}`)
  .replace("/finance/payroll/[id]", `/finance/payroll/${ids.payroll}`)
  .replace("/forms-v2/[id]/responses", `/forms-v2/${ids.formv2}/responses`).replace("/forms-v2/[id]", `/forms-v2/${ids.formv2}`)
  .replace("/forms/submissions/[id]", `/forms/submissions/${ids.submission}`).replace("/forms/[id]/edit", `/forms/${ids.form}/edit`).replace("/forms/[id]/submissions", `/forms/${ids.form}/submissions`).replace("/forms/[id]", `/forms/${ids.form}`)
  .replace("/goals/[id]", `/goals/${ids.goal}`).replace("/home/projects/[id]", `/home/projects/${ids.project}`)
  .replace("/meetings-v2/[id]/review", `/meetings-v2/${ids.meeting}/review`).replace("/meetings-v2/[id]", `/meetings-v2/${ids.meeting}`).replace("/meetings/[id]", `/meetings/${ids.meeting}`)
  .replace("/messages/[id]", `/messages/${ids.conversation}`).replace("/object-approvals/[type]/[id]", `/object-approvals/task/${ids.task}`)
  .replace("/objects/[id]", `/objects/${ids.task}`).replace("/p/[slug]", `/p/${ids.pslug}`).replace("/pages/[pageId]", `/pages/${ids.page}`)
  .replace("/people/[id]/work", `/people/${ids.staff}/work`).replace("/programs/[id]", `/programs/${ids.program}`).replace("/projects/[id]", `/projects/${ids.project}`)
  .replace("/reports/[id]", `/reports/${ids.report}`).replace("/signatures/[id]", `/signatures/${ids.signing}`).replace("/spaces/[id]", `/spaces/${ids.space}`)
  .replace("/templates-v2/[id]", `/templates-v2/${ids.template}`)
  .replace("/workflows/[id]/runs/[runId]", `/workflows/${ids.run}`).replace("/workflows/reviews/[id]", `/workflows/reviews/${ids.review}`).replace("/workflows/[id]", `/workflows/${ids.workflow}`)
  .replace("/lenses/embed", `/lenses/embed?lens=${ids.lens}`)
);
const SIGNED_OUT = new Set(["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/account-inactive", `/p/${ids.pslug}`]);
const KEYS = /\b(?:shell|common|auth|tasks|documents|account|admin|comms|intake|knowledge|ops|people|portfolio|time|work|finance|semantic|lenses|insight|objects|versions|meetings|pages|editor|find|dashboard|gallery|feed|timeline|table|board|home|capture|goals|forms|workflows|apps|templates|spaces|upkeep|offline|mobile|nav|ui|errors|search)\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+\b/g;
function b32(s){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let bits=0,v=0,o=[];for(const c of s.replace(/=+$/,"").toUpperCase()){v=(v<<5)|a.indexOf(c);bits+=5;if(bits>=8){o.push((v>>(bits-8))&255);bits-=8;}}return Buffer.from(o);}
function totp(secret){const c=Math.floor(Date.now()/30000);const m=Buffer.alloc(8);m.writeBigUInt64BE(BigInt(c));const d=createHmac("sha1",b32(secret)).update(m).digest();const o=d[d.length-1]&15;const b=((d[o]&127)<<24)|((d[o+1]&255)<<16)|((d[o+2]&255)<<8)|(d[o+3]&255);return (b%1e6).toString().padStart(6,"0");}
async function signIn(page, who) {
  await page.goto(BASE + "/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(`qa-${who}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("QaTest!2026");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (who === "owner" || who === "admin") {
    const code = page.getByLabel("Six-digit code", { exact: true });
    await code.waitFor({ timeout: 20000 });
    let secret;
    const secretInput = page.getByLabel("Can’t scan the QR code?", { exact: true });
    const file = `/home/user/QBBE-HUB/playwright/.auth/qa-${who}-totp`;
    if (await secretInput.isVisible()) { secret = await secretInput.inputValue(); mkdirSync("/home/user/QBBE-HUB/playwright/.auth", { recursive: true }); writeFileSync(file, secret, { mode: 0o600 }); }
    else secret = readFileSync(file, "utf8").trim();
    const left = 30 - (Math.floor(Date.now() / 1000) % 30); if (left <= 2) await page.waitForTimeout((left + 1) * 1000);
    await code.fill(totp(secret));
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /^(Enable MFA|Verify and continue)$/ }).click();
  }
  await page.waitForURL((u) => u.pathname === "/" || u.pathname === "/home", { timeout: 60000 });
}
const record = (f) => appendFileSync(findingsPath, JSON.stringify(f) + "\n");
async function crawl(role, locale, withAxe, browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 }, locale: locale === "fr" ? "fr-CA" : "en-CA", timezoneId: "America/Toronto" });
  const page = await ctx.newPage();
  const consoleErrors = []; const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  if (role !== "anon") await signIn(page, role);
  if (locale === "fr") await ctx.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: BASE }]);
  let n = 0, bad = 0;
  for (const route of routes) {
    if (role === "anon" && !SIGNED_OUT.has(route)) continue;
    if (role !== "anon" && SIGNED_OUT.has(route) && route !== "/account-inactive") continue;
    n++;
    consoleErrors.length = 0; pageErrors.length = 0;
    const started = Date.now();
    let status = 0, finalUrl = "", text = "", alerts = [], h1 = "", axe = [];
    try {
      const resp = await page.goto(BASE + route, { waitUntil: "load", timeout: 45000 });
      status = resp?.status() ?? 0;
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      finalUrl = page.url().replace(BASE, "");
      text = await page.locator("body").innerText().catch(() => "");
      alerts = (await page.getByRole("alert").allInnerTexts().catch(() => [])).map((s) => s.trim()).filter(Boolean);
      h1 = (await page.getByRole("heading", { level: 1 }).first().innerText().catch(() => "")).trim();
      if (withAxe && status < 400) {
        const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]).analyze().catch(() => null);
        axe = (r?.violations ?? []).filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => `${v.id}: ${v.nodes[0]?.html?.slice(0, 100)}`);
      }
    } catch (e) { record({ role, locale, route, kind: "navigation-error", detail: e.message.split("\n")[0] }); bad++; continue; }
    const ms = Date.now() - started;
    const problems = [];
    if (status >= 500) problems.push({ kind: "http-5xx", detail: String(status) });
    if (/Something went wrong|Une erreur est survenue|Application error|Quelque chose a mal tourné/.test(text)) problems.push({ kind: "error-boundary", detail: text.slice(0, 160) });
    if (/This couldn.t be loaded|n.a pas pu être chargé/.test(text)) problems.push({ kind: "load-failed", detail: text.match(/.{0,60}(This couldn.t be loaded|n.a pas pu être chargé).{0,60}/)?.[0] });
    const rawKeys = [...new Set((text.match(KEYS) ?? []).filter((k) => !/\d/.test(k.split(".")[0])))];
    if (rawKeys.length) problems.push({ kind: "raw-i18n-key", detail: rawKeys.slice(0, 5).join(", ") });
    const junk = text.match(/\b(undefined|NaN|\[object Object\])\b/g);
    if (junk) problems.push({ kind: "junk-text", detail: [...new Set(junk)].join(", ") });
    const holes = text.match(/\{[a-zA-Z]+\}/g);
    if (holes) problems.push({ kind: "unfilled-placeholder", detail: [...new Set(holes)].join(", ") });
    const realConsole = consoleErrors.filter((m) => !/favicon|the server responded with a status of 4\d\d|ERR_ABORTED|net::ERR_FAILED/.test(m));
    if (realConsole.length) problems.push({ kind: "console-error", detail: [...new Set(realConsole)].slice(0, 3).join(" | ").slice(0, 300) });
    if (pageErrors.length) problems.push({ kind: "page-error", detail: [...new Set(pageErrors)].slice(0, 3).join(" | ").slice(0, 300) });
    const errAlerts = alerts.filter((a) => !/no longer exists|n.existe plus|not valid|non valides/.test(a));
    if (errAlerts.length) problems.push({ kind: "alert", detail: errAlerts.join(" | ").slice(0, 200) });
    if (axe.length) problems.push({ kind: "axe", detail: axe.join(" | ").slice(0, 300) });
    if (ms > 8000) problems.push({ kind: "slow", detail: `${ms} ms` });
    const notFound = /Not found — or not yours to see|Introuvable — ou non accessible/.test(text);
    for (const p of problems) { record({ role, locale, route, finalUrl, status, h1, ...p }); bad++; }
    record({ role, locale, route, finalUrl, status, h1, kind: notFound ? "visited-not-found" : "visited", ms });
    if (problems.length) await page.screenshot({ path: `${OUT}/${label}-${role}-${locale}-${route.replace(/[^a-z0-9]+/gi, "_").slice(0, 60)}.png` }).catch(() => {});
  }
  // API routes: GET each; only a 5xx is a finding
  if (role === "staff" && locale === "en" || role === "anon") {
    const api = readFileSync(`${OUT}/api.txt`, "utf8").trim().split(/\s+/);
    for (const r of api) {
      const path = r.replace("/(workspace)", "").replace("[id]", RANDOM).replace("[job]", "drain-notifications").replace("[key]", "object.set_property");
      const resp = await page.request.get(BASE + path, { maxRedirects: 3 }).catch((e) => ({ status: () => 0, text: async () => e.message }));
      const s = resp.status();
      if (s >= 500 || s === 0) record({ role, locale, route: path, kind: "api-5xx", detail: `${s} ${(await resp.text()).slice(0, 120)}` });
      record({ role, locale, route: path, kind: "api", status: s });
    }
  }
  await ctx.close();
  console.log(`${role}/${locale}: ${n} pages, ${bad} findings`);
}
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-proxy-server"] });
await Promise.all([
  crawl("owner", "en", false, browser),
  crawl("staff", "en", true, browser),
  crawl("volunteer", "en", false, browser),
]);
await crawl("staff", "fr", false, browser);
await crawl("anon", "en", false, browser);
await browser.close();
console.log("CRAWL DONE", findingsPath);
