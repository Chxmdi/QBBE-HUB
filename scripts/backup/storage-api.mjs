// A small client for the Supabase Storage HTTP API, for the backup scripts
// (scripts/backup/lib.mjs lists them).
//
// Plain fetch rather than @supabase/supabase-js, so the backup job needs no
// `npm ci`: Node's standard library is all it loads. Every call sends the
// service-role key, which reads and writes every bucket regardless of
// row-level security. The key comes from the caller's environment; it is
// never printed, and error messages carry only Storage's status and reason,
// never a file name (names can carry people's names, and the backup's log
// is public).

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";

/** The largest file Node can read in one piece, and so the largest this client uploads. */
export const MAX_UPLOAD_BYTES = 2 ** 31 - 1;

/** @param {string} path a Storage object name; each segment is encoded, slashes kept */
export function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * An error carrying Storage's status and reason. The reason is kept whole:
 * callers remove any file name from it before cutting it short, so a long
 * name is never left half-removed.
 * @param {Response} response
 * @param {string} what
 */
async function failure(response, what) {
  let reason = "";
  try {
    const body = await response.json();
    reason = body?.message || body?.error || "";
    if (body?.code === "NoSuchBucket" || /bucket not found/i.test(String(reason))) {
      reason = `${reason}; check the service-role key is this project's and the bucket exists`;
    }
  } catch {
    // not JSON; the status says enough
  }
  return new Error(`${what}: HTTP ${response.status}${reason ? ` (${String(reason)})` : ""}`);
}

/**
 * Storage answers a missing object with 404, or with 400 and a body saying
 * 404 / not_found / NoSuchKey (as the local stack does). A missing bucket
 * ("Bucket not found", NoSuchBucket) is not a missing file: Storage also
 * answers that way to a key that is not this project's, so it is reported
 * as an error that points at the key, unless the bucket itself is what was
 * asked about (`bucketAsked`).
 * @param {Response} response
 * @param {boolean} [bucketAsked]
 */
async function isNotFound(response, bucketAsked = false) {
  if (response.status !== 404 && response.status !== 400) return false;
  try {
    const body = await response.clone().json();
    if (body?.code === "NoSuchBucket" || /bucket not found/i.test(String(body?.error ?? body?.message ?? ""))) return bucketAsked;
    return response.status === 404 || String(body?.statusCode) === "404" || body?.error === "not_found" || body?.code === "NoSuchKey";
  } catch {
    return response.status === 404;
  }
}

/**
 * @param {string} url the project address, e.g. https://<ref>.supabase.co
 * @param {string} key the project's service-role (or secret) key
 * @param {{ retries?: number }} [options]
 */
export function storageClient(url, key, options = {}) {
  if (!/^https?:\/\//.test(url ?? "")) throw new Error("The Supabase URL must start with https:// (or http:// locally).");
  if (!key) throw new Error("The service-role key is missing.");
  const base = `${url.replace(/\/+$/, "")}/storage/v1`;
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  const retries = options.retries ?? 3;

  /**
   * fetch with a few retries on network errors and 5xx/429 answers, which a
   * nightly job meets now and then and should not fail on.
   * @param {string} path
   * @param {RequestInit} [init]
   */
  async function call(path, init = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      try {
        const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
        if (response.status >= 500 || response.status === 429) {
          lastError = await failure(response, "Storage is not answering");
          continue;
        }
        return response;
      } catch (error) {
        // fetch's own "fetch failed" says nothing; its cause names the reason
        // (ECONNREFUSED, ENOTFOUND, a certificate problem).
        const cause = /** @type {{ cause?: { code?: string, message?: string } }} */ (error).cause;
        lastError = new Error(`Cannot reach Storage at ${base}: ${cause?.code ?? cause?.message ?? /** @type {Error} */ (error).message}`);
      }
    }
    throw lastError;
  }

  return {
    /**
     * A bucket's settings, or null when it does not exist.
     * @param {string} id
     * @returns {Promise<{ id: string, public: boolean, file_size_limit: number | null, allowed_mime_types: string[] | null } | null>}
     */
    async getBucket(id) {
      const response = await call(`/bucket/${encodeURIComponent(id)}`);
      if (await isNotFound(response, true)) return null;
      if (!response.ok) throw await failure(response, `Read bucket ${id}`);
      return response.json();
    },

    /** @param {{ id: string, public?: boolean, file_size_limit?: number | null, allowed_mime_types?: string[] | null }} bucket */
    async createBucket(bucket) {
      const response = await call("/bucket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: bucket.id,
          name: bucket.id,
          public: Boolean(bucket.public),
          file_size_limit: bucket.file_size_limit ?? null,
          allowed_mime_types: bucket.allowed_mime_types ?? null,
        }),
      });
      if (!response.ok) throw await failure(response, `Create bucket ${bucket.id}`);
    },

    /**
     * Sets a bucket's public flag, size limit and allowed file types (null
     * for no limit / any type).
     * @param {{ id: string, public?: boolean, file_size_limit?: number | null, allowed_mime_types?: string[] | null }} bucket
     */
    async updateBucket(bucket) {
      const response = await call(`/bucket/${encodeURIComponent(bucket.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          public: Boolean(bucket.public),
          file_size_limit: bucket.file_size_limit ?? null,
          allowed_mime_types: bucket.allowed_mime_types ?? null,
        }),
      });
      if (!response.ok) throw await failure(response, `Update bucket ${bucket.id}`);
    },

    /**
     * One object's bytes as a stream, or null when Storage has no such
     * object (deleted, or never had bytes).
     * @param {string} bucket
     * @param {string} path
     * @returns {Promise<Readable | null>}
     */
    async open(bucket, path) {
      const response = await call(`/object/${encodeURIComponent(bucket)}/${encodePath(path)}`);
      if (await isNotFound(response)) return null;
      if (!response.ok || !response.body) throw await failure(response, `Download from ${bucket}`);
      return Readable.fromWeb(/** @type {any} */ (response.body));
    },

    /**
     * Downloads one object only to hash it (the drill's re-check).
     * @param {string} bucket
     * @param {string} path
     * @returns {Promise<{ size: number, sha256: string } | null>}
     */
    async hash(bucket, path) {
      const stream = await this.open(bucket, path);
      if (!stream) return null;
      const hash = createHash("sha256");
      let size = 0;
      for await (const chunk of stream) {
        hash.update(chunk);
        size += chunk.length;
      }
      return { size, sha256: hash.digest("hex") };
    },

    /**
     * Uploads one file, replacing an object of the same name (the restored
     * database already holds a row for it; see restore-storage.mjs), with
     * its backed-up type and cache setting. The file is read whole, so one
     * larger than 2 GiB is refused with a clear message (upload it by hand).
     * @param {string} bucket
     * @param {string} path
     * @param {string} file
     * @param {string | null} contentType
     * @param {string | null} [cacheControl]
     */
    async upload(bucket, path, file, contentType, cacheControl = null) {
      const { size } = await stat(file);
      if (size > MAX_UPLOAD_BYTES) {
        throw new Error(`Upload to ${bucket}: the file is ${size} bytes, over the 2 GiB this script can send; upload it by hand (Supabase dashboard, Storage).`);
      }
      const body = await readFile(file);
      /** @type {Record<string, string>} */
      const headers = { "content-type": contentType || "application/octet-stream", "x-upsert": "true" };
      if (cacheControl) headers["cache-control"] = cacheControl;
      const response = await call(`/object/${encodeURIComponent(bucket)}/${encodePath(path)}`, {
        method: "POST",
        headers,
        body,
      });
      if (!response.ok) throw await failure(response, `Upload to ${bucket}`);
    },
  };
}

/**
 * Runs `work` over `items`, at most `limit` at a time.
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} work
 */
export async function eachLimited(items, limit, work) {
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  });
  await Promise.all(workers);
}
