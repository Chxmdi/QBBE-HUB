/**
 * The editor's collaboration state travels as base64 text between browser and
 * server, and is stored as bytea. Works in the browser and in Node.
 */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** PostgREST returns bytea as `\x` followed by hex. */
export function byteaHexToBase64(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("\\x") || value.length % 2 !== 0) return null;
  const hex = value.slice(2);
  if (!/^[0-9a-f]*$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytesToBase64(bytes);
}

/** base64 as the `\x…` hex literal PostgREST accepts for a bytea column. */
export function base64ToByteaHex(value: string): string {
  const bytes = base64ToBytes(value);
  let hex = "\\x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export const MAX_STATE_BASE64 = Math.ceil((8 * 1024 * 1024 * 4) / 3);
