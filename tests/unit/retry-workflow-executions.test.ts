import { describe, expect, it } from "vitest";
import { retryWorkflowExecutions } from "@/features/jobs/services/handlers/retry-workflow-executions";
import type { JobDefinition } from "@/features/jobs/services/runner";
import { FakeSupabase, asClient } from "../support/fake-supabase";

const USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const ORG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";

const definition: JobDefinition = {
  name: "retry-workflow-executions",
  description: "test",
  schedule: "*/15 * * * *",
  enabled: true,
  queue: "notifications",
  batch_size: 25,
  max_attempts: 3,
};

describe("retryWorkflowExecutions", () => {
  it("replays stored drafts and marks the execution notified", async () => {
    const db = new FakeSupabase();
    db.seed("workflow_execution", [{
      id: "exec-1",
      outcome: "failed",
      attempt: 0,
      payload: [
        {
          user_id: USER,
          organization_id: ORG,
          category: "assignment",
          title: "Workflow: Review",
          source_type: "task",
          source_id: "t1",
          link: "/my-work?task=t1",
          reason: "workflow",
          dedupe_key: "task:t1:rule-1:user-1",
        },
      ],
      created_at: "2026-08-19T12:00:00Z",
    }]);

    const result = await retryWorkflowExecutions({
      db: asClient(db),
      definition,
      now: new Date("2026-08-19T12:05:00Z"),
    });

    expect(result).toEqual({ processed: 1, failed: 0 });
    const execution = db.rows("workflow_execution")[0];
    expect(execution.outcome).toBe("notified");
    expect(execution.payload).toBeNull();
    expect(execution.attempt).toBe(1);
    expect(db.rows("notification")).toHaveLength(1);
  });

  it("does not create a second notification when the draft already landed", async () => {
    const db = new FakeSupabase();
    db.seed("notification", [
      {
        id: "note-1",
        user_id: USER,
        organization_id: ORG,
        category: "assignment",
        title: "Workflow: Review",
        dedupe_key: "task:t1:rule-1:user-1",
        reason: "workflow",
      },
    ]);
    db.seed("workflow_execution", [
      {
        id: "exec-2",
        outcome: "failed",
        attempt: 1,
        payload: [
          {
            user_id: USER,
            organization_id: ORG,
            category: "assignment",
            title: "Workflow: Review",
            source_type: "task",
            source_id: "t1",
            reason: "workflow",
            dedupe_key: "task:t1:rule-1:user-1",
          },
        ],
        created_at: "2026-08-19T12:00:00Z",
      },
    ]);

    const result = await retryWorkflowExecutions({
      db: asClient(db),
      definition,
      now: new Date(),
    });

    expect(result.processed).toBe(1);
    expect(db.rows("notification")).toHaveLength(1);
    expect(db.rows("notification")[0].reason).toContain("workflow");
  });
});
