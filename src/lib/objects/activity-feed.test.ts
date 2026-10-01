import { describe, expect, it } from "vitest";
import { createActivityFeedWriter } from "./activity-feed";
import { fakeClient, json } from "./testing/fake-client";

const me = "11111111-1111-1111-1111-111111111111";
const task = "22222222-2222-2222-2222-222222222222";
const project = "33333333-3333-3333-3333-333333333333";

describe("activity feed writer", () => {
  const event = {
    object: { id: task, type: "task" },
    organizationId: "66666666-6666-6666-6666-666666666666",
    verb: "updated" as const,
    changes: [{ property: "status", before: "not_started", after: "done" }],
    summary: "completed “Book the hall”",
    projectId: project,
  };

  it("writes today's activity feed row with the changes in metadata", async () => {
    const { client, requests } = fakeClient(() => new Response(null, { status: 201 }));
    await createActivityFeedWriter(client)({ ...event, actor: { kind: "person", id: me }, changeSetId: "cs-1" });
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url.pathname).toBe("/rest/v1/activity_event");
    expect(requests[0].body).toEqual({
      organization_id: event.organizationId,
      actor_id: me,
      verb: "updated",
      source_type: "task",
      source_id: task,
      project_id: project,
      program_id: null,
      summary: event.summary,
      metadata: { actor: { kind: "person", id: me }, changes: event.changes, change_set_id: "cs-1" },
    });
  });

  it("keeps a non-person actor out of the person column", async () => {
    const { client, requests } = fakeClient(() => new Response(null, { status: 201 }));
    const actor = { kind: "automation" as const, id: "77777777-7777-7777-7777-777777777777" };
    await createActivityFeedWriter(client)({ ...event, actor });
    const body = requests[0].body as { actor_id: unknown; metadata: { actor: unknown } };
    expect(body.actor_id).toBeNull();
    expect(body.metadata.actor).toEqual(actor);
  });

  it("throws when the row is refused", async () => {
    const { client } = fakeClient(() => json({ message: "new row violates row-level security policy" }, 403));
    await expect(createActivityFeedWriter(client)({ ...event, actor: { kind: "person", id: me } })).rejects.toThrow(
      "row-level security",
    );
  });
});
