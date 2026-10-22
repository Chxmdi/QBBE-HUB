import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Supabase Auth emails are kept in the repository, French first and then
 * English (PRIV-014). Local Supabase reads them through config.toml; hosted
 * projects need them pasted in (docs/runbooks/staging-provisioning.md), so
 * these files are what the owner copies.
 *
 * Each template named in config.toml must exist and carry the variable its
 * email cannot work without, and only Supabase's own variables: a link is
 * always {{ .ConfirmationURL }}, never a hard-coded host.
 */

const config = readFileSync("supabase/config.toml", "utf8");

// What each email needs: a link to follow, or the code to type.
const REQUIRED: Record<string, string> = {
  confirmation: "{{ .ConfirmationURL }}",
  recovery: "{{ .ConfirmationURL }}",
  email_change: "{{ .ConfirmationURL }}",
  reauthentication: "{{ .Token }}",
};
// Supabase's template variables (https://supabase.com/docs/guides/auth/auth-email-templates).
const SUPABASE_VARIABLES = new Set(["ConfirmationURL", "Token", "TokenHash", "SiteURL", "Email", "NewEmail", "RedirectTo", "Data"]);

/** The [auth.email.template.<name>] sections: their subject and content_path. */
function templates(): Record<string, { subject?: string; path?: string }> {
  const out: Record<string, { subject?: string; path?: string }> = {};
  const sections = config.split(/^\[/m).slice(1);
  for (const section of sections) {
    const name = /^auth\.email\.template\.(\w+)\]/.exec(section)?.[1];
    if (!name) continue;
    out[name] = {
      subject: /^subject\s*=\s*"([^"]*)"/m.exec(section)?.[1],
      path: /^content_path\s*=\s*"([^"]*)"/m.exec(section)?.[1],
    };
  }
  return out;
}

describe("Supabase Auth email templates", () => {
  const configured = templates();

  it("configures every email the app sends", () => {
    expect(Object.keys(configured).sort()).toEqual(Object.keys(REQUIRED).sort());
  });

  it.each(Object.entries(REQUIRED))("%s exists and carries %s", (name, variable) => {
    const entry = configured[name];
    expect(entry?.path).toBeTruthy();
    const path = entry!.path!.replace(/^\.\//, "");
    expect(existsSync(path)).toBe(true);
    const html = readFileSync(path, "utf8");
    expect(html).toContain(variable);
  });

  it.each(Object.keys(REQUIRED))("%s uses only Supabase variables and no hard-coded host", (name) => {
    const html = readFileSync(configured[name]!.path!.replace(/^\.\//, ""), "utf8");
    const used = [...html.matchAll(/\{\{\s*\.(\w+)/g)].map((m) => m[1]);
    expect(used.filter((v) => !SUPABASE_VARIABLES.has(v))).toEqual([]);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it.each(Object.keys(REQUIRED))("%s is in French first, then English", (name) => {
    const html = readFileSync(configured[name]!.path!.replace(/^\.\//, ""), "utf8");
    const fr = html.indexOf('lang="fr-CA"');
    const en = html.indexOf('lang="en"');
    expect(fr).toBeGreaterThan(-1);
    expect(en).toBeGreaterThan(fr);
  });

  it.each(Object.keys(REQUIRED))("%s has a subject in both languages", (name) => {
    expect(configured[name]?.subject).toMatch(/\S.* \/ .*\S/);
  });
});
