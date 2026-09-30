import { describe, expect, it, vi } from "vitest";
import { extractSemanticBlocks } from "../editor-adapter";
import { planReview, summarizeSteps } from "../review";
import { createTaskActionDefinition, UnsupportedTaskOriginError } from "../create-task-action";
import { overrideTurnsOn } from "../flag";
import { meetingsV2En } from "../i18n/en";
import { meetingsV2FrCA } from "../i18n/fr-CA";
import { meetingsV2T } from "../i18n";

describe("extractSemanticBlocks", () => {
  it("captures slash lines in English and French and rewrites them", () => {
    const { blocks, notes } = extractSemanticBlocks(
      ["Intro", "/task Book the hall", "  /décision Hold it indoors", "/suivi Call the venue", "/question Who pays?"].join("\n"),
    );
    expect(blocks).toEqual([
      { kind: "task", text: "Book the hall" },
      { kind: "decision", text: "Hold it indoors" },
      { kind: "follow_up", text: "Call the venue" },
      { kind: "question", text: "Who pays?" },
    ]);
    expect(notes.split("\n")).toEqual([
      "Intro",
      "Task: Book the hall",
      "  Decision: Hold it indoors",
      "Follow-up: Call the venue",
      "Question: Who pays?",
    ]);
  });

  it("captures a line once: a second save finds nothing new", () => {
    const first = extractSemanticBlocks("/follow-up Send minutes");
    expect(first.blocks).toHaveLength(1);
    expect(extractSemanticBlocks(first.notes).blocks).toHaveLength(0);
  });

  it("leaves unknown commands, empty commands and mid-line slashes alone", () => {
    const text = "/unknown thing\n/task\nand/or /task not at start";
    const result = extractSemanticBlocks(text);
    expect(result.blocks).toEqual([]);
    expect(result.notes).toBe(text);
  });

  it("caps a block at 500 characters", () => {
    const { blocks } = extractSemanticBlocks(`/task ${"x".repeat(900)}`);
    expect(blocks[0].text).toHaveLength(500);
  });
});

describe("planReview", () => {
  const captures = [
    { id: "t", kind: "task" as const, status: "open" as const },
    { id: "f", kind: "follow_up" as const, status: "open" as const },
    { id: "d", kind: "decision" as const, status: "open" as const },
    { id: "q", kind: "question" as const, status: "open" as const },
    { id: "x", kind: "task" as const, status: "open" as const },
    { id: "done", kind: "task" as const, status: "approved" as const },
    { id: "skip", kind: "task" as const, status: "open" as const },
  ];

  it("turns each approved kind into the right step and skips reviewed or unchosen ones", () => {
    const steps = planReview(captures, { t: "approve", f: "approve", d: "approve", q: "approve", x: "dismiss", done: "approve" });
    expect(steps).toEqual([
      { captureId: "t", op: "create_task" },
      { captureId: "f", op: "create_task" },
      { captureId: "d", op: "record_decision" },
      { captureId: "q", op: "keep" },
      { captureId: "x", op: "dismiss" },
    ]);
    expect(summarizeSteps(steps)).toEqual({ created: 3, kept: 1, dismissed: 1 });
  });
});

describe("create-task action", () => {
  it("creates a meeting task through create_meeting_action and reports the change", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "task-1", error: null });
    const action = createTaskActionDefinition(rpc);
    const changes = await action.run(
      { actor: { kind: "person", id: "me" }, can: async () => true },
      { title: "  Book the hall ", ownerId: "owner", dueOn: "2026-10-05", origin: { type: "meeting", id: "m1", captureId: "c1" } },
    );
    expect(rpc).toHaveBeenCalledWith("create_meeting_action", {
      p_meeting: "m1",
      p_title: "Book the hall",
      p_owner: "owner",
      p_due: "2026-10-05T12:00:00Z",
    });
    expect(changes).toEqual([
      {
        kind: "create",
        object: { type: "task", id: "task-1" },
        values: { title: "Book the hall", ownerId: "owner", dueOn: "2026-10-05", origin: { type: "meeting", id: "m1", captureId: "c1" } },
      },
    ]);
  });

  it("fails when the database refuses, and refuses origins it does not know yet", async () => {
    const refused = createTaskActionDefinition(vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } }));
    const context = { actor: { kind: "person" as const, id: "me" }, can: async () => true };
    await expect(refused.run(context, { title: "x", origin: { type: "meeting", id: "m" } })).rejects.toThrow("denied");
    await expect(refused.run(context, { title: "x", origin: { type: "page", id: "p" } })).rejects.toBeInstanceOf(
      UnsupportedTaskOriginError,
    );
  });
});

describe("switch override", () => {
  it("turns the module on by name or with all, never otherwise", () => {
    expect(overrideTurnsOn("wos_meetings_v2", "wos_pages, WOS_MEETINGS_V2")).toBe(true);
    expect(overrideTurnsOn("wos_meetings_v2", "all")).toBe(true);
    expect(overrideTurnsOn("wos_meetings_v2", "wos_pages")).toBe(false);
    expect(overrideTurnsOn("wos_meetings_v2", undefined)).toBe(false);
  });
});

describe("dictionaries", () => {
  const leaves = (node: unknown, prefix = ""): [string, string][] =>
    Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      typeof value === "string" ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
    );
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it("French has every English key with the same placeholders", () => {
    const fr = new Map(leaves(meetingsV2FrCA));
    for (const [key, text] of leaves(meetingsV2En)) {
      expect(fr.has(key), key).toBe(true);
      expect(placeholders(fr.get(key)!), key).toEqual(placeholders(text));
    }
  });

  it("translates with variables in both languages", () => {
    expect(meetingsV2T("en")("notes.savedWithCaptures", { count: 2 })).toContain("2 item(s)");
    expect(meetingsV2T("fr-CA")("kind.follow_up")).toBe("Suivi");
  });
});
