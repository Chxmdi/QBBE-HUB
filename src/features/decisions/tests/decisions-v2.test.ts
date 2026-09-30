import { describe, expect, it, vi } from "vitest";
import { isDueForRevisit, parseOptions, revisitRecipients } from "../revisit";
import { overrideTurnsOn } from "../flag";
import { decisionsV2En } from "../i18n/en";
import { decisionsV2FrCA } from "../i18n/fr-CA";
import { decisionRevisitReminders } from "../jobs/revisit-reminders";

vi.mock("@/features/jobs/services/notify", () => ({
  createNotifications: vi.fn(async (_db: unknown, drafts: unknown[]) => drafts.length),
}));
import { createNotifications } from "@/features/jobs/services/notify";

describe("revisit rules", () => {
  const base = { revisit_on: "2026-10-01", revisit_reminded_at: null, reopened_at: null };
  it("is due on or after the day, once", () => {
    expect(isDueForRevisit(base, "2026-09-30")).toBe(false);
    expect(isDueForRevisit(base, "2026-10-01")).toBe(true);
    expect(isDueForRevisit(base, "2026-10-09")).toBe(true);
    expect(isDueForRevisit({ ...base, revisit_reminded_at: "2026-10-01T11:10:00Z" }, "2026-10-02")).toBe(false);
    expect(isDueForRevisit({ ...base, revisit_on: null }, "2026-10-02")).toBe(false);
  });
  it("tells the decider and participants once each", () => {
    expect(revisitRecipients("a", ["b", "a", "c"])).toEqual(["a", "b", "c"]);
    expect(revisitRecipients(null, [])).toEqual([]);
  });
  it("parses options one per line, trimmed and capped", () => {
    expect(parseOptions(" Rent a hall \n\n Go online ")).toEqual(["Rent a hall", "Go online"]);
    expect(parseOptions(Array.from({ length: 30 }, (_, i) => `o${i}`).join("\n"))).toHaveLength(20);
    expect(parseOptions("x".repeat(900))[0]).toHaveLength(500);
  });
  it("reads the staging override by name", () => {
    expect(overrideTurnsOn("wos_decisions_v2", "wos_decisions_v2")).toBe(true);
    expect(overrideTurnsOn("wos_decisions_v2", "wos_goals")).toBe(false);
  });
});

/** A just-enough stand-in for the service client: each table answers with fixed rows. */
function fakeDb(tables: Record<string, unknown[]>, updates: unknown[]) {
  return {
    rpc: async (_fn: string, args: { p_user: string }) => ({ data: args.p_user !== "unreadable", error: null }),
    from(table: string) {
      const rows = tables[table] ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "not", "is", "lte", "order", "limit", "in", "eq"]) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      chain.update = (values: unknown) => {
        updates.push({ table, values });
        const done = { eq: () => done, then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
        return done;
      };
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
      return chain;
    },
  };
}

describe("decision-revisit-reminders job", () => {
  const definition = { batch_size: 50 } as never;
  const now = new Date("2026-10-01T15:00:00Z");

  it("does nothing while the switch is off", async () => {
    const updates: unknown[] = [];
    const db = fakeDb({ feature_flag: [{ enabled: false }] }, updates);
    const result = await decisionRevisitReminders({ db: db as never, definition, now });
    expect(result.processed).toBe(0);
    expect(updates).toEqual([]);
  });

  it("notifies the decider and participants who are active and can read it, then stamps it", async () => {
    const updates: unknown[] = [];
    const db = fakeDb(
      {
        feature_flag: [{ enabled: true }],
        decision: [
          { id: "d1", organization_id: "o", project_id: "p", title: "Go online", decided_by: "u1",
            revisit_on: "2026-10-01", revisit_reminded_at: null, reopened_at: null },
          { id: "d2", organization_id: "o", project_id: null, title: "Later", decided_by: "u1",
            revisit_on: "2026-10-02", revisit_reminded_at: null, reopened_at: null },
        ],
        organization: [{ id: "o", timezone: "America/Toronto" }],
        decision_participant: [
          { decision_id: "d1", user_id: "u2" },
          { decision_id: "d1", user_id: "gone" },
          { decision_id: "d1", user_id: "unreadable" },
        ],
        organization_membership: [
          { organization_id: "o", user_id: "u1" },
          { organization_id: "o", user_id: "u2" },
          { organization_id: "o", user_id: "unreadable" },
        ],
        user_profile: [{ id: "u2", locale: "fr-CA" }],
      },
      updates,
    );
    const result = await decisionRevisitReminders({ db: db as never, definition, now });
    expect(result.processed).toBe(1);
    const drafts = vi.mocked(createNotifications).mock.calls.at(-1)![1] as { user_id: string; title: string; link: string }[];
    expect(drafts.map((d) => d.user_id)).toEqual(["u1", "u2"]);
    expect(drafts[0].title).toBe("Time to revisit: Go online");
    expect(drafts[1].title).toBe("À revoir : Go online");
    expect(drafts[0].link).toBe("/decisions/d1");
    expect(updates).toHaveLength(1);
  });
});

describe("dictionaries", () => {
  const leaves = (node: unknown, prefix = ""): [string, string][] =>
    Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      typeof value === "string" ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
    );
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  it("French has every English key with the same placeholders", () => {
    const fr = new Map(leaves(decisionsV2FrCA));
    for (const [key, text] of leaves(decisionsV2En)) {
      expect(fr.has(key), key).toBe(true);
      expect(placeholders(fr.get(key)!), key).toEqual(placeholders(text));
    }
  });
});
