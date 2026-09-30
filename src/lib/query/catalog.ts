import type { LocalizedText, PropertyKind } from "@/lib/objects/contracts";
import { OPERATORS_BY_KIND, type LensOperator, type LensPropertyKind } from "./spec";

/**
 * The engine's allow-list as the database publishes it (`public.lens_catalog`).
 * Screens use it to offer only the properties, operators and options the
 * engine accepts; the database is still the one that enforces it.
 */

export interface CatalogChoice {
  key: string;
  label: LocalizedText;
}

export interface CatalogProperty {
  key: string;
  /** Operator family. */
  kind: LensPropertyKind;
  /** The contract's property kind (contracts.ts), for display. */
  propertyKind: PropertyKind;
  name: LocalizedText;
  sortable: boolean;
  groupable: boolean;
  choices?: CatalogChoice[];
  /** Related type key, for relations. */
  target?: string;
  /** Present on id-valued properties shown with a label (people, programs). */
  ref?: { table: string; label: string };
  timestamp?: boolean;
}

export interface CatalogType {
  key: string;
  name: LocalizedText;
  properties: CatalogProperty[];
}

export type LensCatalog = Record<string, CatalogType>;

interface RawProperty extends Omit<CatalogProperty, "sortable" | "groupable"> {
  column?: string;
  cast?: string;
  sortable?: boolean;
  groupable?: boolean;
}
interface RawType {
  key: string;
  name: LocalizedText;
  properties: RawProperty[];
}

/** Drops the storage details (tables, columns) screens have no use for. */
export function toCatalog(raw: Record<string, RawType>): LensCatalog {
  const out: LensCatalog = {};
  for (const [key, type] of Object.entries(raw ?? {})) {
    out[key] = {
      key: type.key,
      name: type.name,
      properties: type.properties.map((p) => ({
        key: p.key,
        kind: p.kind,
        propertyKind: p.propertyKind,
        name: p.name,
        sortable: p.sortable === true,
        groupable: p.groupable === true,
        ...(p.choices ? { choices: p.choices } : {}),
        ...(p.target ? { target: p.target } : {}),
        ...(p.ref ? { ref: { table: p.ref.table, label: p.ref.label } } : {}),
        ...(p.timestamp ? { timestamp: true } : {}),
      })),
    };
  }
  return out;
}

export function findProperty(
  catalog: LensCatalog,
  type: string,
  key: string,
): CatalogProperty | undefined {
  return catalog[type]?.properties.find((p) => p.key === key);
}

export function operatorsFor(property: CatalogProperty): readonly LensOperator[] {
  return OPERATORS_BY_KIND[property.kind];
}

export function localized(text: LocalizedText, locale: string): string {
  return locale.startsWith("fr") ? text.fr : text.en;
}
