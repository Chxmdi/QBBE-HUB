/**
 * Files in the editor are records in the existing document library, so they
 * go through its virus scan (`document.scan_status`). A block stores a
 * reference, never a storage address; the address is fetched when shown and
 * only once the scan has passed.
 */

export const DOCUMENT_REF_PREFIX = "qbbe-document:";

export function documentRef(documentId: string): string {
  return `${DOCUMENT_REF_PREFIX}${documentId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The document id in a stored reference, or null for anything else. */
export function documentIdFromRef(ref: string | null | undefined): string | null {
  if (!ref || !ref.startsWith(DOCUMENT_REF_PREFIX)) return null;
  const id = ref.slice(DOCUMENT_REF_PREFIX.length);
  return UUID.test(id) ? id : null;
}

/** Same limit as the document library's own upload dialog. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** A storage path that cannot collide and never carries the file name's odd characters. */
export function storagePathFor(fileName: string, random: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
  return `${random}/${safe}`;
}
