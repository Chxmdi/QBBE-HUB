import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCK_REGISTRY } from "@/features/editor/registry";
import { templatesV2Text } from "./messages";
import {
  buildHub,
  documentVariables,
  editableDocument,
  hubToDrafts,
  planHub,
  renderDocumentText,
  renderPageBody,
  renderTemplateDocument,
  rowsToDocument,
  type PageBody,
} from "./template";

/**
 * Templates that build hubs (T1). The expected values below are the ones
 * supabase/tests/template-versions.sql pins for public.apply_page_template_v2,
 * so the preview and the database agree.
 */

const MIGRATION = join(process.cwd(), "supabase/migrations/20261110010000_template_versions.sql");

function migrationBlockTypes(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const match = /function app\.template_v2_block_types\(\)[\s\S]*?select array\[([^\]]*)\]::text\[\]/.exec(sql);
  if (!match) throw new Error("template_v2_block_types not found in the migration");
  return match[1].split(",").map((part) => part.trim().replace(/^'|'$/g, ""));
}

const hubBody: PageBody = {
  title: { en: "Event hub", fr: "Carrefour" },
  blocks: [],
  variables: ["owner"],
  document: {
    en: [
      { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Run by {{owner}}", styles: {} }] },
      { id: "c1", type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "Book the room by {{start+7}}", styles: {} }] },
      { id: "v1", type: "query", props: { preset: "my_open", spec: '{"version":2,"source":{"type":"task"},"layout":"board"}' } },
      { id: "t1", type: "task", props: { objectId: "" } },
      { id: "d1", type: "decision", props: { objectId: "" } },
    ],
    fr: [
      { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Animé par {{owner}}", styles: {} }] },
      { id: "c1", type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "Réserver la salle d’ici le {{start+7}}", styles: {} }] },
    ],
  },
  hub: {
    milestones: [
      { title: { en: "Venue booked", fr: "Salle réservée" }, offsets: { due: 14 } },
      { title: { en: "Event day", fr: "Jour J" }, offsets: { due: 42 } },
    ],
    tasks: [
      { title: { en: "Book the venue", fr: "Réserver la salle" }, priority: "high", offsets: { due: 10 }, milestone: 0 },
      { title: { en: "Send invitations", fr: "Envoyer les invitations" }, offsets: { start: 14, due: 21 }, milestone: 1 },
      { title: { en: "Thank volunteers", fr: "Remercier les bénévoles" }, offsets: { due: 45 } },
    ],
  },
};

const textOf = (block: { content?: unknown }) => ((block.content as { text: string }[] | undefined)?.[0]?.text ?? "");

describe("T1-1: a template may hold any block in the registry", () => {
  it("the database's list of block types is exactly the editor registry's", () => {
    expect(migrationBlockTypes()).toEqual(BLOCK_REGISTRY.map((entry) => entry.type));
  });

  it("view, task and decision blocks and checklists come through rendering unchanged in shape", () => {
    const blocks = renderTemplateDocument(hubBody, { owner: "Jane" }, "2031-05-01", "en");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "checkListItem", "query", "task", "decision"]);
    expect(blocks[2].props).toEqual({ preset: "my_open", spec: '{"version":2,"source":{"type":"task"},"layout":"board"}' });
  });
});

describe("T1-2: rendering a template on a start date", () => {
  it("fills variables and {{start+N}} tokens exactly as the database does", () => {
    const blocks = renderTemplateDocument(hubBody, { owner: 'Jane "JD" Doe' }, "2031-05-01", "en");
    expect(textOf(blocks[0])).toBe('Run by Jane "JD" Doe');
    expect(textOf(blocks[1])).toBe("Book the room by 2031-05-08");
    const fr = renderTemplateDocument(hubBody, { owner: "Marie" }, "2031-05-01", "fr-CA");
    expect(textOf(fr[1])).toBe("Réserver la salle d’ici le 2031-05-08");
  });

  it("never scans a value again, and keeps values on one line", () => {
    expect(renderDocumentText("{{owner}} / {{program}}", { owner: "{{program}}", program: "A\nB" }, "2031-05-01")).toBe("{{program}} / A B");
    expect(renderDocumentText("{{start + 0}} {{start+3650}} {{start+99999}}", {}, "2031-05-01")).toBe("2031-05-01 2041-04-28 {{start+99999}}");
  });

  it("plans the hub's project, milestones and tasks with resolved dates", () => {
    const plan = planHub(hubBody.hub!, "Event hub", "2031-05-01", "en");
    expect(plan.map((p) => `${p.kind}:${p.title}:${p.start ?? "-"}:${p.due ?? "-"}`)).toEqual([
      "project:Event hub:2031-05-01:2031-06-15",
      "milestone:Venue booked:-:2031-05-15",
      "milestone:Event day:-:2031-06-12",
      "task:Book the venue:-:2031-05-11",
      "task:Send invitations:2031-05-15:2031-05-22",
      "task:Thank volunteers:-:2031-06-15",
    ]);
    expect(planHub(hubBody.hub!, "x", "not a date", "en")).toEqual([]);
  });

  it("builds a hub from the editor's rows, skipping blank ones and checking milestones and days", () => {
    expect(
      buildHub(
        [{ en: "Venue booked", fr: "Salle réservée", due: "14" }, { en: "", fr: "", due: "" }],
        [{ en: "Book", fr: "Réserver", due: "10", milestone: "1" }, { en: "", fr: "", due: "", milestone: "" }],
      ),
    ).toEqual({
      ok: true,
      hub: {
        milestones: [{ title: { en: "Venue booked", fr: "Salle réservée" }, offsets: { due: 14 } }],
        tasks: [{ title: { en: "Book", fr: "Réserver" }, offsets: { due: 10 }, milestone: 0 }],
      },
    });
    expect(buildHub([], [])).toEqual({ ok: true, hub: null });
    expect(buildHub([], [{ en: "Book", fr: "", due: "", milestone: "" }])).toEqual({ ok: false, problem: "hubText" });
    expect(buildHub([], [{ en: "Book", fr: "Réserver", due: "", milestone: "1" }])).toEqual({ ok: false, problem: "hubMilestone" });
    expect(buildHub([{ en: "M", fr: "J", due: "3651" }], [])).toEqual({ ok: false, problem: "offset" });
  });

  it("round-trips a hub through the editor's rows", () => {
    const drafts = hubToDrafts(hubBody.hub);
    const rebuilt = buildHub(drafts.milestones, drafts.tasks.map((t) => ({ ...t })));
    expect(rebuilt.ok && rebuilt.hub?.tasks?.map((t) => t.milestone)).toEqual([0, 1, undefined]);
  });
});

describe("T1-4: editing an old template in the real editor keeps what it makes", () => {
  const legacy: PageBody = {
    title: { en: "Meeting notes", fr: "Notes de réunion" },
    variables: ["owner"],
    blocks: [
      { kind: "heading", text: { en: "Agenda", fr: "Ordre du jour" } },
      { kind: "todo", text: { en: "Share by {{owner}}", fr: "Diffuser par {{owner}}" }, offsets: { start: 0, due: 1 } },
    ],
  };

  it("its rows become editor blocks whose rendering is the rows' rendering, in both languages", () => {
    for (const locale of ["en", "fr-CA"]) {
      const before = renderPageBody(legacy, { owner: "Jane" }, "2027-03-01", locale).blocks;
      const after = renderTemplateDocument({ ...legacy, blocks: [], document: rowsToDocument(legacy.blocks) }, { owner: "Jane" }, "2027-03-01", locale);
      expect(after.map((b) => [b.type, b.props, textOf(b)])).toEqual(before.map((b) => [b.type, b.props, textOf(b)]));
    }
    expect(textOf(rowsToDocument(legacy.blocks).en[1])).toBe("Share by {{owner}} · Starts {{start+0}} · Due {{start+1}}");
  });

  it("the editable document is the rows, then the document", () => {
    const doc = editableDocument({ ...legacy, document: { en: [{ type: "divider" }], fr: [] } });
    expect(doc.en.map((b) => b.type)).toEqual(["heading", "checkListItem", "divider"]);
    expect(doc.fr.map((b) => b.type)).toEqual(["heading", "checkListItem"]);
  });

  it("finds the variables a document uses", () => {
    expect(documentVariables(hubBody.document!)).toEqual(["owner"]);
  });
});

describe("T1 strings", () => {
  it("English and French have the same keys", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object"
        ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
        : [prefix];
    expect(keys(templatesV2Text("fr-CA"))).toEqual(keys(templatesV2Text("en")));
    expect(templatesV2Text("fr-CA").manage.duplicate).toBe("Dupliquer");
  });
});
