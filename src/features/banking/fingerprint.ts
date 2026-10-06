import { createHash } from "node:crypto";

/** SHA-256 hex of a statement line's key; stored and unique per bank account. */
export function fingerprint(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
