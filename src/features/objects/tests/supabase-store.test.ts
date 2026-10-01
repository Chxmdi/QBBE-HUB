import { describe, expect, it } from "vitest";
import { fakeClient, json } from "@/lib/objects/testing/fake-client";
import { changeSetRow } from "@/lib/objects/testing/fake-db";
import { createSupabaseChangeSetStore } from "@/features/objects/actions/supabase-store";
import type { ActionContext, Change } from "@/lib/objects/contracts";

const TASK = "11111111-1111-4111-8111-111111111111";
const ORG = "44444444-4444-4444-8444-444444444444";
const OWNER = "55555555-5555-4555-8555-555555555555";

const changes: Change[] = [{ kind: "update", object: { id: TASK, type: "task" }, property: "status", before: "a", after: "b" }];
const person: ActionContext = { actor: { kind: "person", id: OWNER }, can: async () => true };
const automation: ActionContext = { actor: { kind: "automation", id: "wf-1" }, can: async () => true };

describe("Supabase change set store", () => {
  it("takes the event marker from object_event_high_water", async () => {
    const { client, requests } = fakeClient(() => json(41));
    expect(await createSupabaseChangeSetStore(client).begin()).toBe(41);
    expect(requests[0].url.pathname).toBe("/rest/v1/rpc/object_event_high_water");
    const refused = fakeClient(() => json({ message: "no" }, 401));
    expect(await createSupabaseChangeSetStore(refused.client).begin()).toBeNull();
  });

  it("records a person's change set through record_change_set, with the organization when given", async () => {
    const { client, requests } = fakeClient(() => json(changeSetRow("cs-1", { actor_kind: "person", actor_id: OWNER })));
    const store = createSupabaseChangeSetStore(client, { organizationId: ORG });
    const saved = await store.save({ actionKey: "insight.shift_milestone", changes, context: person, marker: 41, undoOf: null });
    expect(saved).toEqual({
      id: "cs-1",
      actionKey: "insight.shift_milestone",
      actor: { kind: "person", id: OWNER },
      createdAt: "2026-10-01T12:00:00.000Z",
      changes,
      undoOf: null,
    });
    expect(requests[0].url.pathname).toBe("/rest/v1/rpc/record_change_set");
    expect(requests[0].body).toEqual({
      p_action_key: "insight.shift_milestone",
      p_changes: changes,
      p_since_seq: 41,
      p_undo_of: null,
      p_organization: ORG,
    });
  });

  it("leaves the organization out when the objects anchor it themselves", async () => {
    const { client, requests } = fakeClient(() => json(changeSetRow("cs-1")));
    await createSupabaseChangeSetStore(client).save({ actionKey: "object.set_property", changes, context: person, marker: null, undoOf: null });
    expect(requests[0].body).toEqual({ p_action_key: "object.set_property", p_changes: changes, p_since_seq: null, p_undo_of: null });
  });

  it("records an automation's change set through record_change_set_as for the person it acts as", async () => {
    const { client, requests } = fakeClient(() => json(changeSetRow("cs-2", { actor_kind: "automation", actor_id: "wf-1" })));
    const store = createSupabaseChangeSetStore(client, { runAs: { userId: OWNER, assurance: "aal2" } });
    const saved = await store.save({ actionKey: "task.set_status", changes, context: automation, marker: 41, undoOf: "cs-1" });
    expect(saved.actor).toEqual({ kind: "automation", id: "wf-1" });
    expect(requests[0].url.pathname).toBe("/rest/v1/rpc/record_change_set_as");
    expect(requests[0].body).toEqual({
      p_actor: "automation:wf-1",
      p_user: OWNER,
      p_assurance: "aal2",
      p_action_key: "task.set_status",
      p_changes: changes,
      p_since_seq: 41,
      p_undo_of: "cs-1",
    });
  });

  it("refuses an automation's change set without the person it acts as", async () => {
    const { client, requests } = fakeClient(() => json(changeSetRow("cs-2")));
    await expect(
      createSupabaseChangeSetStore(client).save({ actionKey: "task.set_status", changes, context: automation, marker: null, undoOf: null }),
    ).rejects.toThrow("runAs");
    expect(requests).toHaveLength(0);
  });

  it("surfaces the database's refusal", async () => {
    const { client } = fakeClient(() => json({ message: "You cannot change every object in this change set." }, 403));
    await expect(
      createSupabaseChangeSetStore(client).save({ actionKey: "object.set_property", changes, context: person, marker: null, undoOf: null }),
    ).rejects.toThrow("cannot change every object");
  });

  it("loads a change set with its items and actor", async () => {
    const { client } = fakeClient((request) =>
      request.url.pathname.endsWith("/change_set")
        ? json(changeSetRow("cs-3", { actor_kind: "automation", actor_id: "wf-1", action_key: "task.set_status", undo_of: null }))
        : json([{ position: 0, kind: "update", object_id: TASK, object_type: "task", property: "status", before: "a", after: "b", relation_type_key: null, to_id: null, to_type: null }]),
    );
    const loaded = await createSupabaseChangeSetStore(client).load("cs-3");
    expect(loaded).toEqual({
      id: "cs-3",
      actionKey: "task.set_status",
      actor: { kind: "automation", id: "wf-1" },
      createdAt: "2026-10-01T12:00:00.000Z",
      changes,
      undoOf: null,
      undoneAt: null,
    });
  });
});
