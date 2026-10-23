import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getT: async () => createTranslator("fr-CA") };
});

const { auditUnavailableResponse, recordAudit, recordAuditId, recordServerAudit } = await import("@/lib/audit-write");

/** A session client whose record_audit_event stores the entry, or fails. */
const client = (error: { message: string } | null) =>
  ({ rpc: async (fn: string) => (fn === "record_audit_event" && !error ? { data: "entry-1", error: null } : { data: null, error }) }) as never;

const row = { organization_id: "o", actor_id: "u", event_type: "finance", action: "aging_exported" };

describe("recordAudit", () => {
  it("says whether the audit row was stored", async () => {
    expect(await recordAudit(client(null), row)).toBe(true);
    expect(await recordAudit(client({ message: "down" }), row)).toBe(false);
  });

  it("sends no actor: the database takes it from the session", async () => {
    let sent: Record<string, unknown> = {};
    const spy = { rpc: async (_fn: string, args: Record<string, unknown>) => ((sent = args), { data: "entry-1", error: null }) } as never;
    expect(await recordAuditId(spy, row)).toBe("entry-1");
    expect(sent).toMatchObject({ p_organization_id: "o", p_event_type: "finance", p_action: "aging_exported" });
    expect(Object.keys(sent).some((key) => key.includes("actor"))).toBe(false);
  });

  it("writes server entries directly, with the service client", async () => {
    const service = (error: { message: string } | null) => ({ from: () => ({ insert: async () => ({ error }) }) }) as never;
    expect(await recordServerAudit(service(null), { ...row, actor_type: "system" })).toBe(true);
    expect(await recordServerAudit(service({ message: "down" }), row)).toBe(false);
  });

  it("refuses an export with a 503, no file, and a reason in the person's language", async () => {
    const response = await auditUnavailableResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.text()).toMatch(/exportation a été arrêtée/);
  });
});

describe("ledger exports (general ledger, journal, trial balance, statements and others)", () => {
  it("hand over no file when the audit row cannot be stored", async () => {
    const { csvResponse } = await import("@/features/ledger/services/ledger.export");
    const session = { organizationId: "o", userId: "u" } as never;
    const refused = await csvResponse(client({ message: "down" }), session, "general_ledger_exported", "a,b", "gl.csv", {});
    expect(refused.status).toBe(503);
    expect(refused.headers.get("content-disposition")).toBeNull();
    const served = await csvResponse(client(null), session, "general_ledger_exported", "a,b", "gl.csv", {});
    expect(await served.text()).toBe("a,b");
  });
});

describe("personal and financial data exports", () => {
  const routes = [
    "src/app/api/finance/gifts/acknowledgements/[id]/route.ts",
    "src/app/api/finance/receipts/export/route.ts",
    "src/app/api/finance/ledger/receipts/[id]/file/route.ts",
    "src/app/api/finance/aging/route.ts",
    "src/app/api/forms/[id]/export/route.ts",
    "src/app/(workspace)/spaces/admin/audit-export/route.ts",
    "src/app/(workspace)/reports/[id]/csv/route.ts",
    "src/app/(workspace)/reports/[id]/pdf/route.ts",
  ];

  it.each(routes)("%s hands over no file unless its audit row was stored", (path) => {
    const source = readFileSync(path, "utf8");
    const audit = source.indexOf("const audited = await recordAudit(");
    const refuse = source.indexOf("if (!audited) return auditUnavailableResponse();");
    expect(audit).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(audit);
    // The file goes out only after the check.
    expect(source.lastIndexOf("return new")).toBeGreaterThan(refuse);
    expect(source.indexOf('"audit_event").insert')).toBe(-1);
  });
});
