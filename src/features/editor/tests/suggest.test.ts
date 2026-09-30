import { describe, expect, it } from "vitest";
import { findDate, findPerson, fold, suggestTask } from "@/features/editor/semantic/suggest";

// Wednesday 30 September 2026.
const TODAY = "2026-09-30";
const people = [
  { id: "amara", name: "Amara Diallo" },
  { id: "jean", name: "Jean-Marc Côté" },
  { id: "li", name: "Li" },
];

describe("date phrases, English and French", () => {
  it.each([
    ["Call the venue today", "2026-09-30"],
    ["à faire aujourd’hui", "2026-09-30"],
    ["by tomorrow", "2026-10-01"],
    ["pour demain", "2026-10-01"],
    ["next week", "2026-10-05"],
    ["la semaine prochaine", "2026-10-05"],
    ["by Friday", "2026-10-02"],
    ["d’ici vendredi", "2026-10-02"],
    ["on Wednesday", "2026-10-07"],
    ["mercredi", "2026-10-07"],
    ["in 3 days", "2026-10-03"],
    ["dans 2 semaines", "2026-10-14"],
    ["le 12 octobre", "2026-10-12"],
    ["1er mai", "2027-05-01"],
    ["October 12th", "2026-10-12"],
    ["12 Sept", "2027-09-12"],
    ["due 2026-11-05", "2026-11-05"],
    ["end of the week", "2026-10-02"],
    ["fin de semaine", "2026-10-02"],
  ])("%s", (text, date) => {
    expect(findDate(text, TODAY)).toBe(date);
  });

  it.each(["No date here", "Maybe sometime", "31 février", "Room 12 on floor 3"])("finds nothing in %s", (text) => {
    expect(findDate(text, TODAY)).toBeNull();
  });
});

describe("people", () => {
  it("matches full names, first names and @mentions, ignoring accents and case", () => {
    expect(findPerson("Ask amara diallo about it", people)?.id).toBe("amara");
    expect(findPerson("@Amara please", people)?.id).toBe("amara");
    expect(findPerson("jean-marc cote to call", people)?.id).toBe("jean");
    expect(findPerson("Jean-Marc, can you", people)?.id).toBe("jean");
  });

  it("needs a whole word and at least two letters", () => {
    expect(findPerson("Amaranth flowers", people)).toBeNull();
    expect(findPerson("Li will send it", people)?.id).toBe("li");
    expect(findPerson("Lisbon trip", people)).toBeNull();
  });

  it("folds accents and apostrophes", () => {
    expect(fold("D’ici Mercredi, Côté")).toBe("d'ici mercredi, cote");
  });
});

describe("suggestTask", () => {
  it("suggests when a line names a person and a date", () => {
    expect(suggestTask("  Amara to book the hall by Friday ", people, TODAY)).toEqual({
      personId: "amara",
      personName: "Amara Diallo",
      due: "2026-10-02",
      title: "Amara to book the hall by Friday",
    });
    expect(suggestTask("Jean-Marc envoie le procès-verbal d’ici mercredi", people, TODAY)?.due).toBe("2026-10-07");
  });

  it("stays quiet without both a person and a date", () => {
    expect(suggestTask("Book the hall by Friday", people, TODAY)).toBeNull();
    expect(suggestTask("Amara booked the hall", people, TODAY)).toBeNull();
    expect(suggestTask("", people, TODAY)).toBeNull();
  });
});
