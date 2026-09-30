import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  cleanLabel,
  extractMentions,
  insertMention,
  mentionToken,
  plainText,
  splitBody,
} from "../mentions";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OBJECT = "22222222-2222-4222-8222-222222222222";

describe("mention tokens", () => {
  it("round-trips a person and an object through the body", () => {
    const body = `Hi ${mentionToken({ kind: "person", id: PERSON, label: "Ada Lovelace" })}, see ${mentionToken({ kind: "object", id: OBJECT, label: "Budget" })}.`;
    expect(splitBody(body)).toEqual([
      { type: "text", text: "Hi " },
      { type: "mention", mention: { kind: "person", id: PERSON, label: "Ada Lovelace" } },
      { type: "text", text: ", see " },
      { type: "mention", mention: { kind: "object", id: OBJECT, label: "Budget" } },
      { type: "text", text: "." },
    ]);
    expect(plainText(body)).toBe("Hi @Ada Lovelace, see @Budget.");
  });

  it("lists each mentioned id once, per kind, in order", () => {
    const token = mentionToken({ kind: "person", id: PERSON, label: "A" });
    const body = `${token} ${token} ${mentionToken({ kind: "object", id: OBJECT, label: "B" })}`;
    expect(extractMentions(body)).toEqual({ people: [PERSON], objects: [OBJECT] });
  });

  it("ignores look-alikes that are not valid tokens", () => {
    for (const body of [
      "@[x](person:not-a-uuid)",
      `@[x](group:${PERSON})`,
      `@[](person:${PERSON})`,
      "an email@example.com",
    ]) {
      expect(extractMentions(body)).toEqual({ people: [], objects: [] });
    }
  });

  it("keeps labels from breaking the token", () => {
    expect(cleanLabel("Plan [v2] (draft)\nnew")).toBe("Plan v2 draft new");
    const token = mentionToken({ kind: "object", id: OBJECT, label: "Plan [v2] (draft)" });
    expect(extractMentions(token).objects).toEqual([OBJECT]);
  });

  it("normalizes ids to lower case", () => {
    const upper = `@[A](person:${PERSON.toUpperCase()})`;
    expect(extractMentions(upper).people).toEqual([PERSON]);
  });
});

describe("the @ picker", () => {
  it("finds the query being typed at the caret", () => {
    expect(activeMentionQuery("Hello @ad", 9)).toEqual({ start: 6, query: "ad" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMentionQuery("Hello @ad more", 14)).toEqual({ start: 6, query: "ad more" });
  });

  it("does not open inside an email address or after a line break", () => {
    expect(activeMentionQuery("mail me@home", 12)).toBeNull();
    expect(activeMentionQuery("@ad\nnext", 8)).toBeNull();
    expect(activeMentionQuery("plain text", 10)).toBeNull();
  });

  it("replaces the query with the token and moves the caret after it", () => {
    const result = insertMention("Hi @ad!", 3, 6, { kind: "person", id: PERSON, label: "Ada" });
    const token = `@[Ada](person:${PERSON}) `;
    expect(result.text).toBe(`Hi ${token}!`);
    expect(result.caret).toBe(3 + token.length);
  });
});
