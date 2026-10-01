import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ObjectRef } from "@/lib/objects/contracts";
import {
  blockText,
  contentToPlainText,
  normalizeContent,
  type EditorBlock,
  type EditorContent,
} from "@/features/editor/adapter/content";
import { byteaHexToBase64 } from "@/features/editor/adapter/state";
import type { BlockSnapshot, ContentSnapshot, ObjectContentAdapter, PropertySnapshot } from "../content";

/**
 * Editor documents (pages, meeting notes) as versioned content (U9, plan A10).
 *
 * A snapshot holds one block per editor block, in document order, with the
 * block's own text (what compare shows and a hand-written snapshot carries)
 * and, in `props`, what rebuilds it exactly: the editor's props, the inline
 * content and the parent block, so nesting survives a round trip. The live
 * Yjs state travels along in `yjsState` for the record.
 *
 * Writing goes to editor_document as the signed-in person (its RLS follows
 * the page or meeting) and clears the stored Yjs state: the editor then
 * rebuilds its document from the restored JSON, keeping every block id, and
 * saves a fresh state on the next change. The database bumps `version`, so
 * an editor still open on the old content reports a conflict instead of
 * silently overwriting the restore.
 */

interface StoredBlockProps {
  props?: Record<string, unknown>;
  content?: EditorBlock["content"];
  parent?: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The block's own text, without its children (each child is its own snapshot block). */
function ownText(block: EditorBlock): string {
  return blockText({ ...block, children: [] });
}

export function editorContentToSnapshot(content: EditorContent, yjsState?: string | null): ContentSnapshot {
  const blocks: BlockSnapshot[] = [];
  const walk = (list: EditorBlock[], parent: string | null) => {
    list.forEach((block, index) => {
      const id = typeof block.id === "string" && block.id ? block.id : `${parent ?? "root"}-${index + 1}`;
      const stored: StoredBlockProps = { props: block.props ?? {} };
      if (block.content !== undefined) stored.content = block.content;
      if (parent) stored.parent = parent;
      blocks.push({ id, type: block.type, text: ownText(block), props: stored as Record<string, unknown> });
      walk(block.children ?? [], id);
    });
  };
  walk(content.blocks, null);
  return yjsState ? { version: 1, blocks, yjsState } : { version: 1, blocks };
}

/**
 * The editor document a snapshot describes. A block whose text no longer
 * matches its stored inline content (a block restored from a hand-written
 * snapshot, or a suggestion accepted on it) is rebuilt from the text.
 */
export function snapshotToEditorContent(snapshot: ContentSnapshot): EditorContent {
  const byId = new Map<string, EditorBlock>();
  const roots: EditorBlock[] = [];
  for (const block of snapshot.blocks) {
    const stored: StoredBlockProps = isRecord(block.props) ? (block.props as StoredBlockProps) : {};
    const candidate: EditorBlock = {
      id: block.id,
      type: block.type,
      props: isRecord(stored.props) ? stored.props : {},
      content: stored.content,
      children: [],
    };
    if (ownText(candidate) !== block.text) {
      candidate.content = block.text === "" ? [] : [{ type: "text", text: block.text }];
    }
    if (candidate.content === undefined) delete candidate.content;
    byId.set(block.id, candidate);
    const parent = typeof stored.parent === "string" ? byId.get(stored.parent) : undefined;
    if (parent) parent.children!.push(candidate);
    else roots.push(candidate);
  }
  return normalizeContent({ version: 1, blocks: roots });
}

type DocumentRow = { content: unknown; yjs_state: string | null; organization_id: string };

/**
 * One adapter per table that owns a document: the object's row gives the
 * title (and proves the reader may see it), editor_document gives the body.
 */
export function editorDocumentAdapter(
  objectType: "page" | "meeting",
  table: "page" | "meeting",
): ObjectContentAdapter {
  async function loadOwner(id: string): Promise<{ title: string; organization_id: string } | null> {
    const db = await createSupabaseServerClient();
    const { data } = await db.from(table).select("title, organization_id").eq("id", id).maybeSingle();
    return (data as { title: string; organization_id: string } | null) ?? null;
  }

  async function loadDocument(id: string): Promise<DocumentRow | null> {
    const db = await createSupabaseServerClient();
    const { data } = await db
      .from("editor_document")
      .select("content, yjs_state, organization_id")
      .eq("object_id", id)
      .maybeSingle();
    return (data as DocumentRow | null) ?? null;
  }

  return {
    restorableProperties: ["title"],

    async read(object: ObjectRef) {
      const owner = await loadOwner(object.id);
      if (!owner) return null;
      const document = await loadDocument(object.id);
      const content = normalizeContent(document?.content ?? null);
      const yjsState = byteaHexToBase64(document?.yjs_state ?? null);
      return {
        content: editorContentToSnapshot(content, yjsState),
        properties: { title: owner.title },
      };
    },

    async title(object: ObjectRef) {
      return (await loadOwner(object.id))?.title ?? null;
    },

    async writeContent(object: ObjectRef, snapshot: ContentSnapshot) {
      const content = snapshotToEditorContent(snapshot);
      const text = contentToPlainText(content).slice(0, 500000);
      const db = await createSupabaseServerClient();
      const existing = await loadDocument(object.id);
      if (existing) {
        const { data, error } = await db
          .from("editor_document")
          .update({ content, content_text: text, yjs_state: null })
          .eq("object_id", object.id)
          .select("object_id");
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) throw new Error("not_found");
        return;
      }
      const owner = await loadOwner(object.id);
      if (!owner) throw new Error("not_found");
      const { error } = await db.from("editor_document").insert({
        object_id: object.id,
        object_type: objectType,
        organization_id: owner.organization_id,
        content,
        content_text: text,
      });
      if (error) throw new Error(error.message);
    },

    async writeProperties(object: ObjectRef, properties: PropertySnapshot) {
      if (!("title" in properties)) return;
      const title = typeof properties.title === "string" ? properties.title.slice(0, 500) : "";
      const db = await createSupabaseServerClient();
      const { data, error } = await db.from(table).update({ title }).eq("id", object.id).select("id");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) throw new Error("not_found");
    },
  };
}
