// Records one chapter of the onboarding demo from the real application.
//
//   NO_PROXY='*' node scripts/demo/record.mjs 00-welcome [--out .demo-out] [--base http://127.0.0.1:3000] [--locale fr-CA]
//
// A chapter is a module in scripts/demo/chapters/ that exports { id, title,
// audience, run(d) }. `d` is the small presenter's toolkit below: say() puts a
// caption on screen and records when it was said, go/click/type/press move
// through the Hub at a person's pace with a visible cursor, highlight() draws
// a box around something worth looking at, and signIn() handles the QA
// accounts (including an administrator's two-step verification).
//
// Each run writes <out>/<id>.webm (1920 × 1080), <id>.captions.json (what was
// said and when, for voicing later), <id>.srt (subtitles) and <id>.meta.json.
// The application under test is the local Hub; nothing here reaches a hosted
// project. The overlay drawn on the page lives in overlay.js.

import { createHmac } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const chapterId = args.find((a) => !a.startsWith("--"));
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const OUT = resolve(option("out", ".demo-out"));
const BASE = option("base", "http://127.0.0.1:3000");
const LOCALE = option("locale", "en-CA");
const SIZE = { width: 1920, height: 1080 };
const PASSWORD = "QaTest!2026";

if (!chapterId) {
  console.error("Usage: node scripts/demo/record.mjs <chapter-id> [--out dir] [--base url] [--locale en-CA|fr-CA]");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Two-step verification for the QA owner and admin, as tests/e2e/auth.ts does.
// ---------------------------------------------------------------------------
function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase().replace(/=|\s/g, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Authenticator setup returned an invalid secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}
function currentTotp(secret) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}
const totpPath = (account) => join(process.cwd(), "playwright", ".auth", `qa-${account}-totp`);
async function recalledTotp(account) {
  try {
    return (await readFile(totpPath(account), "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}
async function rememberTotp(account, secret) {
  await mkdir(dirname(totpPath(account)), { recursive: true });
  await writeFile(totpPath(account), secret, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// The presenter's toolkit.
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;
/** How long a caption stays before the next step: a comfortable reading pace. */
const readingTime = (text) => Math.max(2200, Math.round(words(text) * 400) + 600);

async function isHydrated(locator) {
  return locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))).catch(() => false);
}

function createPresenter(page, context, chapter) {
  const t0 = Date.now();
  const captions = [];
  const now = () => Date.now() - t0;

  const overlay = async (fn, ...params) => {
    await page.evaluate(([f, p]) => window.__demo && window.__demo[f](...p), [fn, params]).catch(() => {});
  };

  async function say(text, options = {}) {
    captions.push({ at: now(), text });
    await overlay("caption", text);
    await sleep(options.hold ?? readingTime(text));
  }

  async function clearCaption() {
    await overlay("caption", "");
  }

  async function title(kicker, heading, subtitle, hold = 3200) {
    await overlay("card", kicker, heading, subtitle);
    captions.push({ at: now(), text: `${heading}. ${subtitle || ""}`.trim(), card: true });
    await sleep(hold);
    await overlay("card", "", "", "");
  }

  async function settle(ms = 700) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await sleep(ms);
  }

  async function go(path, options = {}) {
    await page.goto(path.startsWith("http") ? path : `${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await settle(options.settle ?? 900);
  }

  const resolveLocator = (target) => (typeof target === "string" ? page.locator(target).first() : target);

  async function moveTo(target, options = {}) {
    const locator = resolveLocator(target);
    await locator.waitFor({ state: "visible", timeout: options.timeout ?? 15_000 });
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(120);
    const box = await locator.boundingBox();
    if (!box) throw new Error("Nothing to point at");
    const x = box.x + Math.min(box.width - 6, Math.max(6, options.dx ?? box.width / 2));
    const y = box.y + Math.min(box.height - 6, Math.max(6, options.dy ?? box.height / 2));
    await page.mouse.move(x, y, { steps: options.steps ?? 28 });
    await sleep(options.pause ?? 260);
    return { locator, box, x, y };
  }

  async function hover(target, options = {}) {
    await moveTo(target, options);
    await sleep(options.hold ?? 600);
  }

  async function click(target, options = {}) {
    const { locator, x, y } = await moveTo(target, options);
    // Never click a control React has not attached its handlers to yet.
    const deadline = Date.now() + 10_000;
    while (!(await isHydrated(locator)) && Date.now() < deadline) await sleep(100);
    await page.mouse.click(x, y);
    await sleep(options.settle ?? 650);
  }

  async function type(target, text, options = {}) {
    await click(target, { settle: 200 });
    if (options.clear) await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(text, { delay: options.delay ?? 38 });
    await sleep(options.settle ?? 400);
  }

  async function press(key, options = {}) {
    await page.keyboard.press(key);
    await sleep(options.settle ?? 500);
  }

  async function highlight(target, options = {}) {
    const locator = resolveLocator(target);
    await locator.waitFor({ state: "visible", timeout: options.timeout ?? 15_000 });
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const box = await locator.boundingBox();
    if (box) await overlay("highlight", { x: box.x, y: box.y, width: box.width, height: box.height });
    await sleep(options.hold ?? 1600);
    await overlay("highlight", null);
  }

  async function signIn(account) {
    await go("/sign-in");
    await type(page.getByLabel("Email", { exact: true }), `qa-${account}@example.com`, { delay: 28 });
    await type(page.getByLabel("Password", { exact: true }), PASSWORD, { delay: 28 });
    await click(page.getByRole("button", { name: "Sign in", exact: true }));
    if (account === "owner" || account === "admin") {
      const code = page.getByLabel("Six-digit code", { exact: true });
      const home = page.getByRole("link", { name: "Projects", exact: true });
      await code.or(home).first().waitFor({ state: "visible", timeout: 20_000 });
      if (await code.isVisible()) {
        const secretInput = page.getByLabel("Can’t scan the QR code?", { exact: true });
        if (await secretInput.isVisible()) await rememberTotp(account, await secretInput.inputValue());
        const secret = await recalledTotp(account);
        if (!secret) throw new Error(`The QA ${account} has an MFA factor whose secret is not stored`);
        const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
        if (remaining <= 3) await sleep((remaining + 1) * 1000);
        await type(code, currentTotp(secret));
        await click(page.getByRole("button", { name: /^(Enable MFA|Verify and continue)$/ }));
      }
    }
    await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });
    if (LOCALE !== "en-CA") {
      await context.addCookies([{ name: "qbbe-locale", value: LOCALE, url: BASE }]);
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await settle(800);
  }

  return {
    page,
    context,
    base: BASE,
    locale: LOCALE,
    chapter,
    say,
    clearCaption,
    title,
    go,
    settle,
    hover,
    click,
    type,
    press,
    highlight,
    signIn,
    pause: sleep,
    now,
    captions,
  };
}

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------
const srtTime = (ms) => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

function toSrt(captions, durationMs) {
  return captions
    .map((c, i) => {
      const end = i + 1 < captions.length ? captions[i + 1].at : durationMs;
      return `${i + 1}\n${srtTime(c.at)} --> ${srtTime(Math.max(c.at + 800, end))}\n${c.text}\n`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
async function main() {
  const modulePath = join(here, "chapters", `${chapterId}.mjs`);
  const chapter = (await import(pathToFileURL(modulePath).href)).default;
  if (!chapter || typeof chapter.run !== "function") throw new Error(`${modulePath} does not export a chapter`);

  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-proxy-server", "--force-device-scale-factor=1"] });
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    locale: LOCALE,
    timezoneId: "America/Toronto",
    colorScheme: "light",
    recordVideo: { dir: OUT, size: SIZE },
  });
  await context.addInitScript({ path: join(here, "overlay.js") });
  const page = await context.newPage();
  const presenter = createPresenter(page, context, chapter);
  const started = Date.now();
  let failure = null;
  try {
    await chapter.run(presenter);
    await presenter.clearCaption();
    await sleep(900);
  } catch (error) {
    failure = error;
    console.error(`Chapter ${chapter.id} failed at ${((Date.now() - started) / 1000).toFixed(1)}s:`, error);
    await page.screenshot({ path: join(OUT, `${chapter.id}.failure.png`) }).catch(() => {});
  }
  const durationMs = Date.now() - started;
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) {
    const recorded = await video.path();
    await rename(recorded, join(OUT, `${chapter.id}.webm`));
  }
  await writeFile(join(OUT, `${chapter.id}.captions.json`), JSON.stringify(presenter.captions, null, 2));
  await writeFile(join(OUT, `${chapter.id}.srt`), toSrt(presenter.captions, durationMs));
  await writeFile(
    join(OUT, `${chapter.id}.meta.json`),
    JSON.stringify(
      { id: chapter.id, title: chapter.title, audience: chapter.audience, locale: LOCALE, durationMs, ok: !failure, recordedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(`${failure ? "FAILED" : "Recorded"} ${chapter.id}: ${(durationMs / 1000).toFixed(1)}s, ${presenter.captions.length} captions -> ${OUT}`);
  process.exit(failure ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
