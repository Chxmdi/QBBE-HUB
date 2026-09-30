import type { Locale } from "@/lib/i18n/config";

/**
 * Public pages (V1-18): shapes and pure helpers. The rules live in SQL
 * (20261102010700_public_pages.sql): who may ask and approve, that private
 * properties are never offered, and that only the approved copy is public.
 */

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;

/** A web address from free text: lower case, accents dropped, hyphens between words. */
export function toSlug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/** A field as offered for publishing, or as copied. */
export interface PublishedField {
  key: string;
  label_en: string;
  label_fr: string;
  value?: string | null;
  value_en?: string | null;
  value_fr?: string | null;
}

export function fieldLabel(field: PublishedField, locale: Locale): string {
  return locale === "fr-CA" ? field.label_fr : field.label_en;
}

export function fieldValue(field: PublishedField, locale: Locale): string | null {
  const value = locale === "fr-CA" ? (field.value_fr ?? field.value) : (field.value_en ?? field.value);
  return value === undefined || value === null || value === "" ? null : value;
}

export interface PublishedPage {
  slug: string;
  title_en: string;
  title_fr: string;
  fields: PublishedField[];
  published_at: string;
}

export type PublicationStatus = "in_review" | "published" | "rejected" | "unpublished";

export interface PublicationRow {
  id: string;
  object_id: string;
  slug: string;
  fields: string[];
  status: PublicationStatus;
  requested_by: string | null;
  requested_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  unpublished_at: string | null;
}
