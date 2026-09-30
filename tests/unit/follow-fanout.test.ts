import { describe, expect, it } from "vitest";
import { followFanout } from "@/features/following/fanout";
import type { JobDefinition } from "@/features/jobs/services/runner";
import { asClient, FakeSupabase } from "../support/fake-supabase";

const definition = { name: "follow-events", batch_size: 100 } as unknown as JobDefinition;
const now = new Date("2027-03-01T15:00:00Z");

function world(allowed: (user: string) => boolean, switchOn = true) {
  const db = new FakeSupabase();
  db.seed("feature_flag", [{ key: "wos_objects", enabled: switchOn, organization_id: null }]);
  db.seed("activity_event", [
    {
      id: "e1", organization_id: "o1", actor_id: "actor", verb: "updated", source_type: "task", source_id: "t1",
      project_id: "p1", program_id: null, summary: "changed Status to Blocked", metadata: { changes: [{ field: "status" }] },
      created_at: "2027-03-01T14:00:00Z",
    },
  ]);
  db.seed("task", [{ id: "t1", status: "blocked", assignee_id: "u1", requester_id: null, reviewer_id: null, project_id: "p1", program_id: null, start_at: null, due_at: null, priority: "medium", title: "Venue" }]);
  db.seed("follow_v2", [
    { id: "f1", organization_id: "o1", user_id: "follower", object_id: "t1", query_spec: null },
    { id: "f2", organization_id: "o1", user_id: "lost-access", object_id: "p1", query_spec: null },
    { id: "f3", organization_id: "o1", user_id: "muted", object_id: "t1", query_spec: null },
  ]);
  db.seed("follow_rule_v2", [{ user_id: "muted", event_kind: "status", in_app: false, email: "off" }]);
  db.onRpc("can_as", (args) => allowed(String(args.p_user)));
  return db;
}

describe("followFanout", () => {
  it("notifies followers who can still see the change and have not muted it, once", async () => {
    const db = world((user) => user !== "lost-access");
    const result = await followFanout({ db: asClient(db), definition, now });
    expect(result.processed).toBe(1);
    expect(db.rows("notification")).toMatchObject([
      { user_id: "follower", category: "follow_status", dedupe_key: "follow:e1", link: "/my-work?task=t1" },
    ]);
    expect(db.rows("follow_event_cursor")).toMatchObject([{ consumer: "follow-events", last_id: "e1" }]);

    // The next run starts after the cursor and adds nothing.
    const again = await followFanout({ db: asClient(db), definition, now });
    expect(again.processed).toBe(0);
    expect(db.rows("notification")).toHaveLength(1);
  });

  it("does nothing while the switch is off", async () => {
    const db = world(() => true, false);
    const result = await followFanout({ db: asClient(db), definition, now });
    expect(result.processed).toBe(0);
    expect(db.rows("notification")).toHaveLength(0);
    expect(db.rows("follow_event_cursor")).toHaveLength(0);
  });
});
