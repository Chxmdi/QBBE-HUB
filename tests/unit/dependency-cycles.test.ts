import { expect, it } from "vitest";
import { circularDependencyError } from "@/features/tasks/schemas";

it("rejects cycles longer than a reverse pair", () => {
  const chain = [
    { blocking_task_id: "a", blocked_task_id: "b" },
    { blocking_task_id: "b", blocked_task_id: "c" },
    { blocking_task_id: "c", blocked_task_id: "d" },
  ];
  expect(circularDependencyError("d", "a", chain)).toContain("cycle");
  expect(circularDependencyError("a", "d", chain)).toBeNull();
});
it("terminates on an unrelated pre-existing cycle", () => {
  expect(circularDependencyError("z", "a", [
    { blocking_task_id: "a", blocked_task_id: "b" },
    { blocking_task_id: "b", blocked_task_id: "a" },
  ])).toBeNull();
});
