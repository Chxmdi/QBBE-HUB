import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, type Page } from "@playwright/test";

type QaAccount = "owner" | "admin" | "volunteer";

// The authenticated suite uses one worker. Keep the test enrollment secret in
// that worker so later owner sessions can pass the normal challenge screen.
//
// It is kept outside test-results because Playwright empties that directory at
// the start of every run. Enrollment happens once per database; a local rerun
// against the same database then meets the challenge screen with no secret,
// and the whole authenticated suite fails before it tests anything.
const totpSecrets = new Map<QaAccount, string>();
function totpPath(account: "owner" | "admin") {
  return join(process.cwd(), "playwright", ".auth", `qa-${account}-totp`);
}

export async function rememberTotp(account: "owner" | "admin", secret: string) {
  totpSecrets.set(account, secret);
  const path = totpPath(account);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, secret, { mode: 0o600 });
}

export async function recalledTotp(account: "owner" | "admin"): Promise<string | undefined> {
  const remembered = totpSecrets.get(account);
  if (remembered) return remembered;
  try {
    const secret = (await readFile(totpPath(account), "utf8")).trim();
    if (secret) totpSecrets.set(account, secret);
    return secret || undefined;
  } catch {
    return undefined;
  }
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase().replace(/=|\s/g, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Authenticator setup returned an invalid secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

export function totpForCounter(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

export function currentTotp(secret: string): string {
  return totpForCounter(secret, Math.floor(Date.now() / 30_000));
}

async function completeMfa(page: Page, account: "owner" | "admin") {
  const codeInput = page.getByLabel("Six-digit code", { exact: true });
  await expect(codeInput).toBeVisible({ timeout: 20_000 });

  const secretInput = page.getByLabel("Can’t scan the QR code?", { exact: true });
  if (await secretInput.isVisible()) {
    await rememberTotp(account, await secretInput.inputValue());
  }
  const secret = await recalledTotp(account);
  if (!secret) {
    throw new Error(`The QA ${account} already has an MFA factor whose test secret is unavailable`);
  }

  // Avoid submitting a code at the edge of its 30-second validity window.
  const secondsRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (secondsRemaining <= 2) await page.waitForTimeout((secondsRemaining + 1) * 1000);
  await codeInput.fill(currentTotp(secret));
  await page
    .getByRole("button", { name: /^(Enable MFA|Verify and continue)$/ })
    .click();
}

/** Sign into the synthetic local account, including the owner's real MFA UI. */
export async function signIn(page: Page, account: QaAccount) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(`qa-${account}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("QaTest!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  if (account === "owner" || account === "admin") {
    const mfaHeading = page.getByRole("heading", {
      name: "Protect your administrator account",
      exact: true,
    });
    const workspace = page.getByRole("link", { name: "Projects", exact: true });
    await expect(mfaHeading.or(workspace).first()).toBeVisible({ timeout: 20_000 });
    if (await mfaHeading.isVisible()) await completeMfa(page, account);
  }

  await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });
}

/**
 * End the session the way signing out does, for tests that hand the same
 * browser to a second person. The sign-out route only answers POST, so
 * navigating to it would leave the first session intact — and a test that
 * silently stays signed in as an administrator proves nothing about the
 * second account.
 */
export async function signOut(page: Page) {
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Storage can be unavailable; the cookie clear is what ends the session.
    }
  });
}
