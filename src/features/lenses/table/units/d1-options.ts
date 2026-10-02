"use client";

import type { CatalogProperty } from "@/lib/query/catalog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { RELATION_SOURCES, type CellOption } from "../editable";

/**
 * Wave 2 unit D1: the people and related records a cell can pick from, read
 * with the viewer's own session, so a list never offers a record the viewer
 * cannot see. One request per list per page; a failed one is tried again.
 */

const cache = new Map<string, Promise<CellOption[]>>();

/** The table a relation cell picks from, or null when the table edits none. */
export function relationSource(property: CatalogProperty): { table: string; label: string } | null {
  return RELATION_SOURCES[property.target ?? property.ref?.table ?? property.key] ?? null;
}

async function fetchPeople(): Promise<CellOption[]> {
  const client = createSupabaseBrowserClient();
  const { data, error } = await client
    .from("organization_membership")
    .select("user_profile:user_id(id, full_name)")
    .eq("status", "active");
  if (error) throw new Error(error.message);
  type Row = { user_profile: { id: string; full_name: string } | null };
  return ((data ?? []) as unknown as Row[])
    .flatMap((row) => (row.user_profile ? [{ id: row.user_profile.id, label: row.user_profile.full_name }] : []))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The most items a relation list offers. */
const LIST_LIMIT = 2000;

async function fetchRelation(source: { table: string; label: string }): Promise<CellOption[]> {
  const client = createSupabaseBrowserClient();
  let query = client.from(source.table).select(`id, ${source.label}`);
  // The same choices the task form offers (getPickerOptions): open projects
  // and active programs. A cell's current value is always offered as well.
  if (source.table === "project") query = query.is("archived_at", null).in("stage", ["approved", "planning", "active"]);
  if (source.table === "program") query = query.eq("status", "active");
  const { data, error } = await query.order(source.label).limit(LIST_LIMIT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, string>[]).map((row) => ({ id: row.id, label: row[source.label] ?? row.id }));
}

function cached(key: string, load: () => Promise<CellOption[]>): Promise<CellOption[]> {
  let pending = cache.get(key);
  if (!pending) {
    pending = load().catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
  }
  return pending;
}

/**
 * The choices for a person or relation cell. People come from the page when
 * it has them (the task table), otherwise from the organization's members.
 */
export function loadCellOptions(kind: "person" | "relation", property: CatalogProperty, people: CellOption[]): Promise<CellOption[]> {
  if (kind === "person") return people.length > 0 ? Promise.resolve(people) : cached("people", fetchPeople);
  const source = relationSource(property);
  if (!source) return Promise.resolve([]);
  return cached(`relation:${source.table}`, () => fetchRelation(source));
}
