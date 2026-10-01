import type { Change } from "./contracts";

/**
 * Shared helpers over the contract's `Change` (./contracts.ts).
 */

/** The changes that reverse `changes`, in reverse order. */
export function invertChanges(changes: Change[]): Change[] {
  return [...changes].reverse().map((change): Change => {
    switch (change.kind) {
      case "create":
        return { kind: "delete", object: change.object, values: change.values };
      case "delete":
        return { kind: "create", object: change.object, values: change.values };
      case "update":
        return { ...change, before: change.after, after: change.before };
      case "link":
        return { kind: "unlink", relation: change.relation };
      case "unlink":
        return { kind: "link", relation: change.relation };
    }
  });
}
