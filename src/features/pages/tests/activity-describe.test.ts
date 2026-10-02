import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createPagesT } from "@/features/pages/i18n";
import { c2PagesEn } from "@/features/pages/i18n/units/c2.en";
import { c2PagesFrCA } from "@/features/pages/i18n/units/c2.fr-CA";
import {
  clip,
  describeActivity,
  emptyNames,
  formatValue,
  referencedIds,
  type ActivityRow,
} from "@/features/pages/activity/describe";

const PERSON = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const en = createPagesT("en");
const fr = createPagesT("fr-CA");

const row = (event: string, details: Record<string, unknown> = {}, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "1",
  seq: 1,
  event,
  actor_kind: "person",
  actor_id: PERSON,
  subject: null,
  details,
  occurred_at: "2026-10-02T14:05:00+00:00",
  ...extra,
});

const names = () => {
  const n = emptyNames();
  n.people.set(PERSON, "Sam Staff");
  n.properties.set("due", { en: "Due date", fr: "Échéance" });
  n.relations.set("related_to", { en: "Related to", fr: "Lié à" });
  n.titles.set(OTHER, "Budget sign-off");
  return n;
};

describe("C2-1: the migration names every event <type>.<verb>", () => {
  const migration = readFileSync(
    path.resolve(__dirname, "../../../../supabase/migrations/20261110030000_activity_history.sql"),
    "utf8",
  );
  const written = new Set(
    [...migration.matchAll(/'((?:page|record|block|property|relation|permission|version|comment)\.[a-z]+)'/g)].map((m) => m[1]),
  );

  it("writes page, block, property, permission and relation events", () => {
    for (const event of [
      "page.created",
      "page.updated",
      "page.moved",
      "block.added",
      "block.moved",
      "block.removed",
      "block.updated",
      "property.updated",
      "permission.changed",
      "permission.granted",
      "permission.revoked",
      "relation.linked",
      "relation.unlinked",
      "version.restored",
    ]) {
      expect(written.has(event) || migration.includes(`'${event.split(".")[0]}.' || new.verb`), event).toBe(true);
    }
  });

  it("refuses any other shape in the table itself", () => {
    expect(migration).toContain("event ~ '^(page|record|block|property|relation|permission|version|comment)\\.[a-z]+$'");
  });

  it("has a sentence for every event the migration writes, so none reads as a raw name", () => {
    for (const event of written) {
      const text = describeActivity(row(event, { field: "visibility", after: "private" }), names(), en, "en");
      expect(text, event).not.toContain(event);
    }
  });
});

describe("C2-2: activity reads as who did what, in the reader's language", () => {
  it("names the person and the change in English and in French", () => {
    const entry = row("block.added", { type: "heading", text: "Parking" }, { subject: "b1" });
    expect(describeActivity(entry, names(), en, "en")).toBe("Sam Staff added a block (heading): “Parking”");
    expect(describeActivity(entry, names(), fr, "fr")).toBe("Sam Staff a ajouté un bloc (titre) : « Parking »");
  });

  it("describes moves, removals and edits, with a count for large changes", () => {
    expect(describeActivity(row("block.moved", { type: "paragraph", text: "Kitchen" }), names(), en, "en")).toBe(
      "Sam Staff moved a block (paragraph): “Kitchen”",
    );
    expect(describeActivity(row("block.removed", { type: "mystery", text: "" }), names(), en, "en")).toBe(
      "Sam Staff removed an empty block (block)",
    );
    expect(describeActivity(row("block.updated", { count: 25 }), names(), fr, "fr")).toBe("Sam Staff a modifié 25 blocs");
  });

  it("describes page changes", () => {
    expect(
      describeActivity(row("page.updated", { changes: [{ field: "title", before: "A", after: "Volunteer handbook" }] }), names(), en, "en"),
    ).toBe("Sam Staff renamed the page to “Volunteer handbook”");
    expect(
      describeActivity(
        row("page.updated", { changes: [{ field: "title", after: "B" }, { field: "icon", after: "📘" }, { field: "cover", after: "brand" }] }),
        names(),
        en,
        "en",
      ),
    ).toBe("Sam Staff changed the page’s title, icon and cover");
    expect(describeActivity(row("page.moved", { after: null }), names(), en, "en")).toBe("Sam Staff moved the page to the top level");
  });

  it("names a property in the reader's language with before and after", () => {
    const change = row("property.updated", { changes: [{ property: "due", before: "2026-11-01", after: "2026-11-15" }] });
    expect(describeActivity(change, names(), en, "en")).toBe("Sam Staff changed Due date from 2026-11-01 to 2026-11-15");
    expect(describeActivity(change, names(), fr, "fr")).toBe("Sam Staff a changé Échéance de 2026-11-01 à 2026-11-15");
    const custom = row("property.updated", { changes: [{ property: "room", before: null, after: { value_text: "Main hall" } }] });
    expect(describeActivity(custom, names(), en, "en")).toBe("Sam Staff set room to Main hall");
    const cleared = row("property.updated", { changes: [{ property: "due", before: "2026-11-01", after: null }] });
    expect(describeActivity(cleared, names(), en, "en")).toBe("Sam Staff cleared Due date");
  });

  it("names a person value by name, not by id", () => {
    const assign = row("property.updated", { changes: [{ property: "assignee", before: null, after: PERSON }] });
    expect(describeActivity(assign, names(), en, "en")).toBe("Sam Staff set assignee to Sam Staff");
  });

  it("describes relations by the other record's title, or neutrally when it is not readable", () => {
    const linked = row("relation.linked", { relation: "related_to", other: OTHER, direction: "outgoing" });
    expect(describeActivity(linked, names(), en, "en")).toBe("Sam Staff linked “Budget sign-off” (Related to)");
    expect(describeActivity(linked, emptyNames(), en, "en")).toBe("Someone linked “a record” (related_to)");
  });

  it("labels automations and the system rather than a person", () => {
    expect(describeActivity(row("record.created", {}, { actor_kind: "system", actor_id: null }), names(), en, "en")).toBe(
      "The system created this record",
    );
    expect(describeActivity(row("record.archived", {}, { actor_kind: "automation", actor_id: null }), names(), fr, "fr")).toBe(
      "Une automatisation a archivé cette fiche",
    );
  });

  it("never shows an unknown event as nothing", () => {
    expect(describeActivity(row("comment.edited"), names(), en, "en")).toBe("Sam Staff made a change (comment.edited)");
  });
});

describe("C2-3 and C2-4: restores and permission changes have their own sentences", () => {
  it("describes a restore", () => {
    expect(describeActivity(row("version.restored", { version_id: "x" }), names(), en, "en")).toBe(
      "Sam Staff restored an earlier version (the state before it was saved as a version)",
    );
    expect(describeActivity(row("version.saved", { label: "Before trip" }), names(), en, "en")).toBe(
      "Sam Staff saved the version “Before trip”",
    );
  });

  it("describes visibility and sharing", () => {
    expect(describeActivity(row("permission.changed", { field: "visibility", before: "workspace", after: "private" }), names(), en, "en")).toBe(
      "Sam Staff made the page private",
    );
    expect(describeActivity(row("permission.changed", { field: "visibility", before: "private", after: "workspace" }), names(), fr, "fr")).toBe(
      "Sam Staff a partagé la page avec tout l’espace de travail",
    );
    const role = { key: "task_follower", name_en: "Follower", name_fr: "Abonné" };
    const next = { key: "task_contributor", name_en: "Contributor", name_fr: "Contributeur" };
    expect(
      describeActivity(row("permission.granted", { principal_kind: "person", user_id: PERSON, role }), names(), en, "en"),
    ).toBe("Sam Staff gave Sam Staff the role “Follower”");
    expect(
      describeActivity(
        row("permission.changed", { principal_kind: "org_role", org_role: "volunteer", role: next, before_role: role }),
        names(),
        fr,
        "fr",
      ),
    ).toBe("Sam Staff a changé le rôle de tous les bénévoles de « Abonné » à « Contributeur »");
    expect(
      describeActivity(row("permission.revoked", { principal_kind: "team", team_id: OTHER, role }), names(), en, "en"),
    ).toBe("Sam Staff removed the access of a team (“Follower”)");
  });
});

describe("helpers", () => {
  it("clips long text to one line", () => {
    expect(clip("a\n\nb")).toBe("a b");
    expect(clip("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("formats values", () => {
    expect(formatValue(null, en, emptyNames())).toBe("empty");
    expect(formatValue(true, fr, emptyNames())).toBe("oui");
    expect(formatValue(["a", "b"], en, emptyNames())).toBe("a, b");
    expect(formatValue({ value_number: 450 }, en, emptyNames())).toBe("450");
  });

  it("collects every id an entry names", () => {
    const ids = referencedIds([
      row("relation.linked", { relation: "related_to", other: OTHER }),
      row("permission.granted", { principal_kind: "team", team_id: OTHER }),
      row("property.updated", { changes: [{ property: "due", before: null, after: PERSON }] }),
    ]);
    expect([...ids.people]).toContain(PERSON);
    expect([...ids.titles]).toContain(OTHER);
    expect([...ids.teams]).toEqual([OTHER]);
    expect([...ids.relations]).toEqual(["related_to"]);
    expect([...ids.properties]).toEqual(["due"]);
  });
});

describe("C2 strings", () => {
  type Tree = { [key: string]: string | Tree };
  const keys = (tree: Tree, prefix = ""): string[] =>
    Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`)));

  it("exist in English and Québec French with the same keys", () => {
    expect(keys(c2PagesFrCA as unknown as Tree).sort()).toEqual(keys(c2PagesEn as unknown as Tree).sort());
    expect(keys(c2PagesEn as unknown as Tree).length).toBeGreaterThan(50);
  });
});
