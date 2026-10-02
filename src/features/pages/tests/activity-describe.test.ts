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
  type ActivityNames,
  type ActivityRow,
  type DescribeContext,
  type Lang,
} from "@/features/pages/activity/describe";
import type { PagesT } from "@/features/pages/i18n";

const PERSON = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const en = createPagesT("en");
const fr = createPagesT("fr-CA");

const ctx = (names: ActivityNames, t: PagesT, lang: Lang): DescribeContext => ({
  t,
  lang,
  names,
  formatDate: (value) => `date(${value})`,
});

const row = (event: string, details: Record<string, unknown> = {}, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "1",
  seq: 1,
  event,
  actor_kind: "person",
  actor_id: PERSON,
  subject: null,
  details,
  occurred_at: "2026-10-02T14:05:00+00:00",
  object_type: "task",
  ...extra,
});

const names = () => {
  const n = emptyNames();
  n.people.set(PERSON, "Sam Staff");
  n.properties.set("task:due", { en: "Due date", fr: "Échéance", kind: "date", choices: new Map() });
  n.properties.set("task:status", {
    en: "Status",
    fr: "Statut",
    kind: "status",
    choices: new Map([
      ["in_progress", { en: "In progress", fr: "En cours" }],
      ["done", { en: "Done", fr: "Terminée" }],
    ]),
  });
  // Another type's property with the same key must not lend its name.
  n.properties.set("project:status", { en: "Phase", fr: "Phase", kind: "status", choices: new Map() });
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
      const text = describeActivity(row(event, { field: "visibility", after: "private" }), ctx(names(), en, "en"));
      expect(text, event).not.toContain(event);
    }
  });
});

describe("C2-2: activity reads as who did what, in the reader's language", () => {
  it("names the person and the change in English and in French", () => {
    const entry = row("block.added", { type: "heading", text: "Parking" }, { subject: "b1" });
    expect(describeActivity(entry, ctx(names(), en, "en"))).toBe("Sam Staff added a block (heading): “Parking”");
    expect(describeActivity(entry, ctx(names(), fr, "fr"))).toBe("Sam Staff a ajouté un bloc (titre) : « Parking »");
  });

  it("describes moves, removals and edits, with a count for large changes", () => {
    expect(describeActivity(row("block.moved", { type: "paragraph", text: "Kitchen" }), ctx(names(), en, "en"))).toBe(
      "Sam Staff moved a block (paragraph): “Kitchen”",
    );
    expect(describeActivity(row("block.removed", { type: "mystery", text: "" }), ctx(names(), en, "en"))).toBe(
      "Sam Staff removed an empty block (block)",
    );
    expect(describeActivity(row("block.updated", { count: 25 }), ctx(names(), fr, "fr"))).toBe("Sam Staff a modifié 25 blocs");
  });

  it("describes page changes", () => {
    expect(
      describeActivity(row("page.updated", { changes: [{ field: "title", before: "A", after: "Volunteer handbook" }] }), ctx(names(), en, "en")),
    ).toBe("Sam Staff renamed the page to “Volunteer handbook”");
    expect(
      describeActivity(
        row("page.updated", { changes: [{ field: "title", after: "B" }, { field: "icon", after: "📘" }, { field: "cover", after: "brand" }] }),
        ctx(names(), en, "en"),
      ),
    ).toBe("Sam Staff changed the page’s title, icon and cover");
    expect(describeActivity(row("page.moved", { after: null }), ctx(names(), en, "en"))).toBe("Sam Staff moved the page to the top level");
  });

  it("names a property in the reader's language with before and after", () => {
    const change = row("property.updated", { changes: [{ property: "due", before: "2026-11-01", after: "2026-11-15" }] });
    expect(describeActivity(change, ctx(names(), en, "en"))).toBe("Sam Staff changed Due date from date(2026-11-01) to date(2026-11-15)");
    expect(describeActivity(change, ctx(names(), fr, "fr"))).toBe("Sam Staff a changé Échéance de date(2026-11-01) à date(2026-11-15)");
    const custom = row("property.updated", { changes: [{ property: "room", before: null, after: { value_text: "Main hall" } }] });
    expect(describeActivity(custom, ctx(names(), en, "en"))).toBe("Sam Staff set room to Main hall");
    const cleared = row("property.updated", { changes: [{ property: "due", before: "2026-11-01", after: null }] });
    expect(describeActivity(cleared, ctx(names(), en, "en"))).toBe("Sam Staff cleared Due date");
  });

  it("shows a choice by its label in the reader's language, from the record's own type", () => {
    const status = row("property.updated", { changes: [{ property: "status", before: "in_progress", after: "done" }] });
    expect(describeActivity(status, ctx(names(), en, "en"))).toBe("Sam Staff changed Status from In progress to Done");
    expect(describeActivity(status, ctx(names(), fr, "fr"))).toBe("Sam Staff a changé Statut de En cours à Terminée");
    const project = row("property.updated", { changes: [{ property: "status", before: null, after: "active" }] }, { object_type: "project" });
    expect(describeActivity(project, ctx(names(), en, "en"))).toBe("Sam Staff set Phase to active");
  });

  it("names a person value by name, not by id", () => {
    const assign = row("property.updated", { changes: [{ property: "assignee", before: null, after: PERSON }] });
    expect(describeActivity(assign, ctx(names(), en, "en"))).toBe("Sam Staff set assignee to Sam Staff");
  });

  it("describes relations by the other record's title, or neutrally when it is not readable", () => {
    const linked = row("relation.linked", { relation: "related_to", other: OTHER, direction: "outgoing" });
    expect(describeActivity(linked, ctx(names(), en, "en"))).toBe("Sam Staff linked “Budget sign-off” (Related to)");
    expect(describeActivity(linked, ctx(emptyNames(), en, "en"))).toBe("Someone linked “a record” (related_to)");
  });

  it("labels automations and the system rather than a person", () => {
    expect(describeActivity(row("record.created", {}, { actor_kind: "system", actor_id: null }), ctx(names(), en, "en"))).toBe(
      "The system created this record",
    );
    expect(describeActivity(row("record.archived", {}, { actor_kind: "automation", actor_id: null }), ctx(names(), fr, "fr"))).toBe(
      "Une automatisation a archivé cette fiche",
    );
  });

  it("never shows an unknown event as nothing", () => {
    expect(describeActivity(row("comment.edited"), ctx(names(), en, "en"))).toBe("Sam Staff made a change (comment.edited)");
  });
});

describe("C2-3 and C2-4: restores and permission changes have their own sentences", () => {
  it("describes a restore", () => {
    expect(describeActivity(row("version.restored", { version_id: "x" }), ctx(names(), en, "en"))).toBe(
      "Sam Staff restored an earlier version (the state before it was saved as a version)",
    );
    expect(describeActivity(row("version.saved", { label: "Before trip" }), ctx(names(), en, "en"))).toBe(
      "Sam Staff saved the version “Before trip”",
    );
  });

  it("describes visibility and sharing", () => {
    expect(describeActivity(row("permission.changed", { field: "visibility", before: "workspace", after: "private" }), ctx(names(), en, "en"))).toBe(
      "Sam Staff made the page private",
    );
    expect(describeActivity(row("permission.changed", { field: "visibility", before: "private", after: "workspace" }), ctx(names(), fr, "fr"))).toBe(
      "Sam Staff a partagé la page avec tout l’espace de travail",
    );
    const role = { key: "task_follower", name_en: "Follower", name_fr: "Abonné" };
    const next = { key: "task_contributor", name_en: "Contributor", name_fr: "Contributeur" };
    expect(
      describeActivity(row("permission.granted", { principal_kind: "person", user_id: PERSON, role }), ctx(names(), en, "en")),
    ).toBe("Sam Staff gave Sam Staff the role “Follower”");
    expect(
      describeActivity(
        row("permission.changed", { principal_kind: "org_role", org_role: "volunteer", role: next, before_role: role }),
        ctx(names(), fr, "fr"),
      ),
    ).toBe("Sam Staff a changé le rôle de tous les bénévoles de « Abonné » à « Contributeur »");
    expect(
      describeActivity(row("permission.revoked", { principal_kind: "team", team_id: OTHER, role }), ctx(names(), en, "en")),
    ).toBe("Sam Staff removed the access of a team (“Follower”)");
  });
});

describe("helpers", () => {
  it("clips long text to one line", () => {
    expect(clip("a\n\nb")).toBe("a b");
    expect(clip("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("formats values", () => {
    expect(formatValue(null, ctx(emptyNames(), en, "en"))).toBe("empty");
    expect(formatValue(true, ctx(emptyNames(), fr, "fr"))).toBe("oui");
    expect(formatValue(["a", "b"], ctx(emptyNames(), en, "en"))).toBe("a, b");
    expect(formatValue({ value_number: 450 }, ctx(emptyNames(), en, "en"))).toBe("450");
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
    expect([...ids.properties]).toEqual(["task:due"]);
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
