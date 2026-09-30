import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reactionEmoji, reactionKeys, summarizeReactions, isReactionKey } from "../reactions";
import { commentParentTypes, commentTargetFor, objectCommentsPath } from "../target";

const MIGRATION = readFileSync(
  "supabase/migrations/20261103110100_object_comments.sql",
  "utf8",
);

describe("reactions", () => {
  it("match the database's fixed set exactly", () => {
    const check = /check \(reaction in \(([^)]*)\)\)/.exec(MIGRATION)?.[1] ?? "";
    const inDb = [...check.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(inDb).toEqual([...reactionKeys]);
    for (const key of reactionKeys) expect(reactionEmoji[key]).toBeTruthy();
    expect(isReactionKey("heart")).toBe(true);
    expect(isReactionKey("shrug")).toBe(false);
  });

  it("are grouped per kind in the fixed order, with the reader's own marked", () => {
    const rows = [
      { reaction: "heart", user_id: "u2" },
      { reaction: "thumbs_up", user_id: "u1" },
      { reaction: "heart", user_id: "u1" },
    ];
    const names: Record<string, string> = { u1: "Ada", u2: "Grace" };
    expect(summarizeReactions(rows, "u1", (id) => names[id])).toEqual([
      { key: "thumbs_up", count: 1, mine: true, names: ["Ada"] },
      { key: "heart", count: 2, mine: true, names: ["Grace", "Ada"] },
    ]);
    expect(summarizeReactions(rows, "u3", (id) => names[id]).every((r) => !r.mine)).toBe(true);
  });
});

describe("where an object's comments live", () => {
  it("keeps native records on their own thread and everything else on `object`", () => {
    expect(commentTargetFor({ id: "t", type: "task" })).toEqual({ parentType: "task", parentId: "t", blockId: null });
    expect(commentTargetFor({ id: "p", type: "project" }, "b").parentType).toBe("project");
    expect(commentTargetFor({ id: "x", type: "page" }).parentType).toBe("object");
    expect(commentTargetFor({ id: "x", type: "decision" }).parentType).toBe("object");
    expect(commentTargetFor({ id: "x", type: "grant_application" }, "b")).toEqual({
      parentType: "object",
      parentId: "x",
      blockId: "b",
    });
  });

  it("lists the same parent types as the database check", () => {
    const check = /constraint record_comment_parent_type_check\s+check \(parent_type in \(([^)]*)\)\)/.exec(MIGRATION)?.[1] ?? "";
    const inDb = [...check.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(inDb).toEqual([...commentParentTypes]);
  });

  it("links to the collaboration screen, anchored on the comment", () => {
    expect(objectCommentsPath({ id: "abc", type: "task" }, "c1")).toBe("/collab/objects/abc?type=task#comment-c1");
    expect(objectCommentsPath({ id: "abc", type: "page" })).toBe("/collab/objects/abc?type=page");
  });
});
