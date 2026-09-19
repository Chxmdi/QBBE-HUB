import { rm } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import {
  currentTotp,
  recalledTotp,
  rememberTotp,
  signIn,
  signOut,
  totpForCounter,
} from "./auth";
import { sql } from "./db";

loadEnvConfig(process.cwd());

const ADMIN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4";
const GUEST_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5";
const PASSWORD = "QaTest!2026";
const secretPath = join(process.cwd(), "playwright", ".auth", "qa-admin-totp");

async function signInUntilMfa(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill("qa-admin@example.com");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Protect your administrator account",
      exact: true,
    }),
  ).toBeVisible({ timeout: 20_000 });
}

async function codeAwayFromBoundary(page: Page, secret: string, counterOffset = 0) {
  const secondsRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (secondsRemaining <= 3) await page.waitForTimeout((secondsRemaining + 1) * 1000);
  return totpForCounter(secret, Math.floor(Date.now() / 30_000) + counterOffset);
}

async function nodeCodeAwayFromBoundary(secret: string) {
  const secondsRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (secondsRemaining <= 3) {
    await new Promise((resolve) => setTimeout(resolve, (secondsRemaining + 1) * 1000));
  }
  return currentTotp(secret);
}

test.describe.serial("administrator MFA and AAL2 enforcement", () => {
  test.beforeAll(async () => {
    sql(`
      delete from auth.mfa_factors where user_id = '${ADMIN_ID}';
      delete from audit_event
      where actor_id = '${ADMIN_ID}'
        and action in ('mfa_enrollment_completed', 'mfa_challenge_completed', 'mfa_factor_removed');
    `);
    await rm(secretPath, { force: true });
  });

  test("enrollment survives interruption and fresh sign-in requires a real challenge", async ({
    page,
  }) => {
    await signInUntilMfa(page);
    const secretInput = page.getByLabel(/scan the QR code/i);
    await expect(secretInput).toBeVisible();
    const abandonedSecret = await secretInput.inputValue();

    // Reloading loses the one-time secret. The app must remove only that
    // unverified factor and create one recoverable replacement.
    await page.reload();
    await expect(secretInput).toBeVisible({ timeout: 20_000 });
    const secret = await secretInput.inputValue();
    expect(secret).not.toBe(abandonedSecret);
    expect(
      sql(`select count(*) from auth.mfa_factors where user_id = '${ADMIN_ID}' and status = 'unverified';`),
    ).toBe("1");
    await rememberTotp("admin", secret);

    const codeInput = page.getByLabel("Six-digit code", { exact: true });
    await codeInput.fill(await codeAwayFromBoundary(page, secret, -3));
    await page.getByRole("button", { name: "Enable MFA", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /expired|not accepted/i }),
    ).toBeVisible();

    await codeInput.fill(await codeAwayFromBoundary(page, secret));
    await page.getByRole("button", { name: "Enable MFA", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });
    expect(
      sql(`select count(*) from audit_event where actor_id = '${ADMIN_ID}' and action = 'mfa_enrollment_completed';`),
    ).toBe("1");

    await signOut(page);
    await signInUntilMfa(page);
    await expect(page.getByLabel(/scan the QR code/i)).toHaveCount(0);

    await codeInput.fill(await codeAwayFromBoundary(page, secret, -3));
    await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /expired|not accepted/i }),
    ).toBeVisible();

    await codeInput.fill(await codeAwayFromBoundary(page, secret));
    await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });
    expect(
      Number(sql(`select count(*) from audit_event where actor_id = '${ADMIN_ID}' and action = 'mfa_challenge_completed';`)),
    ).toBeGreaterThanOrEqual(1);
  });

  test("direct Data API mutation is denied at AAL1, allowed at AAL2, and a challenge cannot replay", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(url, "NEXT_PUBLIC_SUPABASE_URL is required").toBeTruthy();
    expect(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required").toBeTruthy();

    const client = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({
      email: "qa-admin@example.com",
      password: PASSWORD,
    });
    expect(signInError).toBeNull();

    const guestMembership = sql(
      `select id from organization_membership where user_id = '${GUEST_ID}' order by joined_at limit 1;`,
    );
    expect(guestMembership).toMatch(/^[0-9a-f-]{36}$/);

    const aal1Marker = new Date(Date.now() - 60_000).toISOString();
    const { data: aal1Rows, error: aal1Error } = await client
      .from("organization_membership")
      .update({ updated_at: aal1Marker })
      .eq("id", guestMembership)
      .select("id");
    expect(aal1Error).toBeNull();
    expect(aal1Rows).toEqual([]);

    const { data: factorData, error: factorError } = await client.auth.mfa.listFactors();
    expect(factorError).toBeNull();
    const factor = factorData?.totp.find((candidate) => candidate.status === "verified");
    expect(factor).toBeTruthy();
    const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
      factorId: factor!.id,
    });
    expect(challengeError).toBeNull();

    const secret = await recalledTotp("admin");
    expect(secret).toBeTruthy();
    const code = await nodeCodeAwayFromBoundary(secret!);
    const { error: verifyError } = await client.auth.mfa.verify({
      factorId: factor!.id,
      challengeId: challenge!.id,
      code,
    });
    expect(verifyError).toBeNull();

    const { error: replayError } = await client.auth.mfa.verify({
      factorId: factor!.id,
      challengeId: challenge!.id,
      code,
    });
    expect(replayError, "a consumed challenge must not be reusable").toBeTruthy();

    const { data: assurance } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(assurance).toMatchObject({ currentLevel: "aal2", nextLevel: "aal2" });
    const aal2Marker = new Date().toISOString();
    const { data: aal2Rows, error: aal2Error } = await client
      .from("organization_membership")
      .update({ updated_at: aal2Marker })
      .eq("id", guestMembership)
      .select("id");
    expect(aal2Error).toBeNull();
    expect(aal2Rows).toEqual([{ id: guestMembership }]);
    await client.auth.signOut();
  });

  test("factor management keeps a backup and stale AAL2 is downgraded immediately", async ({
    page,
  }) => {
    await signIn(page, "admin");
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Multi-factor authentication" })).toBeVisible();
    await page.getByRole("button", { name: "Add authenticator", exact: true }).click();

    const secretInput = page.getByLabel("Manual setup key", { exact: true });
    await expect(secretInput).toBeVisible();
    const backupSecret = await secretInput.inputValue();
    await page.getByLabel("Six-digit code", { exact: true }).fill(
      await codeAwayFromBoundary(page, backupSecret),
    );
    await page.getByRole("button", { name: "Verify and add", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Authenticator added");
    await rememberTotp("admin", backupSecret);

    const original = page
      .getByRole("listitem")
      .filter({ has: page.getByText("QBBE Hub authenticator", { exact: true }) });
    await original.getByRole("button", { name: "Remove", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Remove authenticator" });
    await dialog.getByRole("button", { name: "Remove authenticator", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Authenticator removed");
    expect(
      sql(`select count(*) from auth.mfa_factors where user_id = '${ADMIN_ID}' and status = 'verified';`),
    ).toBe("1");

    // Removing the final factor through the provider API creates the documented
    // aal2 -> aal1 stale-token state. The app must treat that state as downgraded
    // before the old JWT expires and send the administrator back to enrollment.
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    await client.auth.signInWithPassword({ email: "qa-admin@example.com", password: PASSWORD });
    const { data: listed } = await client.auth.mfa.listFactors();
    const lastFactor = listed?.totp.find((factor) => factor.status === "verified");
    expect(lastFactor).toBeTruthy();
    const { error: stepUpError } = await client.auth.mfa.challengeAndVerify({
      factorId: lastFactor!.id,
      code: await nodeCodeAwayFromBoundary(backupSecret),
    });
    expect(stepUpError).toBeNull();
    const { error: removeError } = await client.auth.mfa.unenroll({ factorId: lastFactor!.id });
    expect(removeError).toBeNull();
    const { data: stale } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(stale?.currentLevel).toBe("aal2");
    const guestMembership = sql(
      `select id from organization_membership where user_id = '${GUEST_ID}' order by joined_at limit 1;`,
    );
    const { data: staleMutation, error: staleMutationError } = await client
      .from("organization_membership")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", guestMembership)
      .select("id");
    expect(staleMutationError).toBeNull();
    expect(staleMutation).toEqual([]);
    await client.auth.refreshSession();
    const { data: downgraded } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(downgraded?.currentLevel).toBe("aal1");

    await page.goto("/settings");
    await expect(page.getByRole("heading", {
      name: "Protect your administrator account",
      exact: true,
    })).toBeVisible({ timeout: 20_000 });
    const replacementSecretInput = page.getByLabel(/scan the QR code/i);
    await expect(replacementSecretInput).toBeVisible();
    const replacementSecret = await replacementSecretInput.inputValue();
    await rememberTotp("admin", replacementSecret);
    await page.getByLabel("Six-digit code", { exact: true }).fill(
      await codeAwayFromBoundary(page, replacementSecret),
    );
    await page.getByRole("button", { name: "Enable MFA", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });
  });
});
