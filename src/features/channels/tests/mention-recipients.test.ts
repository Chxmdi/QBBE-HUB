import { describe, expect, it } from "vitest";
import { mentionRecipientIds } from "@/features/channels/mention-recipients";

describe("mention recipients", () => {
  it("resolves people and teams but never includes an ineligible private-channel user", () => {
    expect(mentionRecipientIds({
      body: "@Ada Lovelace please coordinate with @Programs",
      authorId: "author", eligibleUserIds: ["ada", "team-member"],
      members: [{ userId: "ada", fullName: "Ada Lovelace" }, { userId: "outsider", fullName: "Outsider" }],
      teams: [{ id: "programs", name: "Programs" }],
      teamMembers: [{ teamId: "programs", userId: "team-member" }, { teamId: "programs", userId: "outsider" }],
    })).toEqual(["ada", "team-member"]);
  });
});
