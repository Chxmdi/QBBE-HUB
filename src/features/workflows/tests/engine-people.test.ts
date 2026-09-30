import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult, ObjectEvent } from "@/lib/objects/contracts";
import { runGraph, type EnginePorts } from "../engine";
import { MAX_WAIT_SECONDS, validateGraph, type WorkflowGraph } from "../graph";
import { eventScope, type RunScope } from "../scope";
import { checkWebhookUrl, isPrivateAddress, signWebhook } from "../webhook";

const REVIEWER = "66666666-6666-4666-8666-666666666666";
const event: ObjectEvent = {
  id: "33333333-3333-4333-8333-333333333333",
  organizationId: "44444444-4444-4444-8444-444444444444",
  object: { id: "11111111-1111-4111-8111-111111111111", type: "task" },
  actor: { kind: "person", id: REVIEWER },
  verb: "updated",
  changes: [{ property: "due", before: null, after: "2026-11-08T09:00:00.000Z" }],
  summary: "Budget",
  occurredAt: "2026-11-06T12:00:00.000Z",
};
const scope = (): RunScope => ({ event: eventScope(event), steps: {}, workflow: { id: "wf", name: "wf" } });
const now = () => new Date("2026-11-06T12:00:00.000Z");
const trigger = { objectTypes: [], verbs: [] };
const ok: ActionResult = {
  ok: true,
  changeSet: { id: "cs", actionKey: "a", actor: { kind: "automation", id: "wf" }, createdAt: "", changes: [], undoOf: null },
};

function ports() {
  return {
    runAction: vi.fn<EnginePorts["runAction"]>(async () => ok),
    checkAction: vi.fn<EnginePorts["checkAction"]>(async () => "ok"),
    submitApproval: vi.fn<NonNullable<EnginePorts["submitApproval"]>>(async () => "approval-1"),
    createReview: vi.fn<NonNullable<EnginePorts["createReview"]>>(async () => "review-1"),
    readDecision: vi.fn<NonNullable<EnginePorts["readDecision"]>>(async () => null),
    callWebhook: vi.fn<NonNullable<EnginePorts["callWebhook"]>>(async () => ({ ok: true, output: { status: 200 } })),
    sendEmail: vi.fn<NonNullable<EnginePorts["sendEmail"]>>(async () => ({ ok: true, output: { provider: "log" } })),
  } satisfies EnginePorts;
}

const chain = (first: WorkflowGraph["steps"][number]): WorkflowGraph => ({
  version: 1,
  trigger,
  start: first.id,
  steps: [first, { id: "after", kind: "action", action: "task.set_status", input: {}, next: null }],
});

describe("wait", () => {
  it("pauses until a time, then completes on resume without waiting again", async () => {
    const graph = chain({ id: "pause", kind: "wait", seconds: 3600, next: "after" });
    expect(validateGraph(graph).ok).toBe(true);
    const p = ports();
    const first = await runGraph(graph, scope(), p, { now });
    expect(first.outcome).toBe("waiting");
    expect(first.resume).toEqual({ stepId: "pause", attempt: 1, at: "2026-11-06T13:00:00.000Z", reason: "wait" });
    expect(p.runAction).not.toHaveBeenCalled();

    const resumed = await runGraph(graph, scope(), p, { now, startAt: first.resume!, state: first.state, positionOffset: 2 });
    expect(resumed.outcome).toBe("succeeded");
    expect(resumed.steps.map((step) => [step.stepId, step.status])).toEqual([["pause", "succeeded"], ["after", "succeeded"]]);
  });

  it("waits until a date in the scope, capped, and fails on a non-date", async () => {
    const until = chain({ id: "pause", kind: "wait", until: "event.changes.due.after", next: "after" });
    expect((await runGraph(until, scope(), ports(), { now })).resume?.at).toBe("2026-11-08T09:00:00.000Z");

    const far = scope();
    far.event.changes.due.after = "2030-01-01T00:00:00.000Z";
    const capped = await runGraph(until, far, ports(), { now });
    expect(capped.resume?.at).toBe(new Date(now().getTime() + MAX_WAIT_SECONDS * 1000).toISOString());

    const bad = scope();
    bad.event.changes.due.after = "someday";
    expect((await runGraph(until, bad, ports(), { now })).error).toMatch(/^invalid_date/);
  });

  it("goes straight on when the date has passed, and in a test run", async () => {
    const past = scope();
    past.event.changes.due.after = "2020-01-01T00:00:00.000Z";
    const graph = chain({ id: "pause", kind: "wait", until: "event.changes.due.after", next: "after" });
    expect((await runGraph(graph, past, ports(), { now })).outcome).toBe("succeeded");
    expect((await runGraph(chain({ id: "pause", kind: "wait", seconds: 60, next: "after" }), scope(), ports(), { now, dryRun: true })).outcome)
      .toBe("succeeded");
  });

  it("must have seconds or until, not both", () => {
    expect(validateGraph(chain({ id: "pause", kind: "wait", next: "after" } as never)).ok).toBe(false);
    expect(validateGraph(chain({ id: "pause", kind: "wait", seconds: 5, until: "event.x", next: "after" })).ok).toBe(false);
  });
});

describe("approvals and reviews", () => {
  it("submits an approval, waits for the decision, and carries it forward", async () => {
    const graph = chain({ id: "approve", kind: "approval", subjectType: "other", title: "Approve {{event.summary}}", next: "after" });
    const p = ports();
    const first = await runGraph(graph, scope(), p, { now });
    expect(p.submitApproval).toHaveBeenCalledWith({ stepId: "approve", subjectType: "other", title: "Approve Budget", description: null });
    expect(first.resume).toEqual({ stepId: "approve", attempt: 1, at: null, reason: "approval", waitingOn: { kind: "approval", id: "approval-1" } });

    // Woken before a decision: still waiting, and the step is not counted twice.
    const early = await runGraph(graph, scope(), p, { startAt: first.resume!, state: first.state });
    expect(early.outcome).toBe("waiting");
    expect(early.state.stepsTaken).toBe(first.state.stepsTaken);

    p.readDecision.mockResolvedValueOnce({ status: "approved" });
    const done = await runGraph(graph, scope(), p, { startAt: first.resume!, state: first.state });
    expect(done.outcome).toBe("succeeded");
    expect(done.state.steps.approve).toMatchObject({ status: "approved" });
    expect(p.submitApproval).toHaveBeenCalledOnce();
  });

  it("asks a person for a review, with templates filled in", async () => {
    const graph = chain({ id: "check", kind: "review", reviewer: "{{event.actor.id}}", instructions: "Look at {{event.summary}}", next: "after" });
    const p = ports();
    const first = await runGraph(graph, scope(), p, { now });
    expect(p.createReview).toHaveBeenCalledWith({ stepId: "check", reviewerId: REVIEWER, instructions: "Look at Budget" });
    expect(first.resume?.waitingOn).toEqual({ kind: "review", id: "review-1" });
    p.readDecision.mockResolvedValueOnce({ status: "rejected", comment: "Too high" });
    const done = await runGraph(graph, scope(), p, { startAt: first.resume!, state: first.state });
    expect(done.state.steps.check).toMatchObject({ status: "rejected", comment: "Too high" });
  });

  it("fails the step when submitting fails, and never submits in a test run", async () => {
    const graph = chain({ id: "approve", kind: "approval", subjectType: "other", title: "x", next: "after" });
    const p = ports();
    p.submitApproval.mockRejectedValueOnce(new Error("Only staff can submit items for approval"));
    expect((await runGraph(graph, scope(), p)).error).toBe("failed: Only staff can submit items for approval");
    const dry = await runGraph(graph, scope(), p, { dryRun: true });
    expect(dry.outcome).toBe("succeeded");
    expect(p.submitApproval).toHaveBeenCalledOnce();
  });
});

describe("webhooks and email", () => {
  it("calls the webhook with the filled body and retries a failure with backoff", async () => {
    const graph = chain({
      id: "hook", kind: "webhook", url: "https://example.org/hook", body: { task: "{{event.object.id}}" },
      retry: { attempts: 2, backoffSeconds: 30 }, next: "after",
    });
    const p = ports();
    p.callWebhook.mockResolvedValueOnce({ ok: false, error: "failed: the receiver answered 503." });
    const first = await runGraph(graph, scope(), p, { now });
    expect(p.callWebhook).toHaveBeenCalledWith({ stepId: "hook", url: "https://example.org/hook", body: { task: event.object.id }, attempt: 1 });
    expect(first.resume).toMatchObject({ stepId: "hook", attempt: 2, reason: "retry" });
    const second = await runGraph(graph, scope(), p, { now, startAt: first.resume!, state: first.state });
    expect(second.outcome).toBe("succeeded");
  });

  it("refuses a plain http webhook address", () => {
    expect(validateGraph(chain({ id: "hook", kind: "webhook", url: "http://example.org", body: {}, next: "after" })).ok).toBe(false);
  });

  it("sends email with templates, and reports a refusal", async () => {
    const graph = chain({ id: "mail", kind: "email", to: "a@example.org", subject: "About {{event.summary}}", body: "Hello", next: "after" });
    const p = ports();
    await runGraph(graph, scope(), p);
    expect(p.sendEmail).toHaveBeenCalledWith({ stepId: "mail", to: "a@example.org", subject: "About Budget", body: "Hello", attempt: 1 });
    p.sendEmail.mockResolvedValueOnce({ ok: false, error: "refused: recipient_not_allowlisted in this environment." });
    expect((await runGraph(graph, scope(), p)).error).toMatch(/recipient_not_allowlisted/);
  });

  it("keeps outbound steps and pauses out of loop bodies", () => {
    const graph: WorkflowGraph = {
      version: 1, trigger, start: "each",
      steps: [
        { id: "each", kind: "loop", items: "steps.x", body: "mail", next: null },
        { id: "mail", kind: "wait", seconds: 5, next: null },
      ],
    };
    const result = validateGraph(graph);
    expect(result.ok || result.issues.map((issue) => issue.code)).toContain("loop_body");
  });
});

describe("webhook signing and address checks", () => {
  it("signs the timestamp and body with HMAC-SHA256", () => {
    const expected = createHmac("sha256", "key").update("1700000000.{\"a\":1}").digest("hex");
    expect(signWebhook("key", "{\"a\":1}", 1700000000)).toBe(`t=1700000000,v1=${expected}`);
  });

  it("recognises private and public addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it("allows only https to names that resolve to public addresses", async () => {
    const resolve = async (host: string) => (host === "inside.example" ? ["10.0.0.5"] : ["93.184.215.14"]);
    expect((await checkWebhookUrl("https://example.org/hook", resolve)).ok).toBe(true);
    expect(await checkWebhookUrl("http://example.org/hook", resolve)).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("https://inside.example/hook", resolve)).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("https://127.0.0.1/hook", resolve)).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("https://[::1]/hook", resolve)).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("https://localhost/hook", resolve)).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("https://user:pw@example.org/", resolve)).toMatchObject({ ok: false });
    expect(await checkWebhookUrl("https://example.org/", async () => { throw new Error("NXDOMAIN"); })).toMatchObject({ ok: false });
  });
});
