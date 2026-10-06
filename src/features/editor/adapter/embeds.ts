/**
 * Allow-listed embeds. Only these providers can be framed, and only through
 * the embed address built here from a parsed id, never the pasted URL itself.
 * `src/lib/security/content-security-policy.ts` lists the same origins in `frame-src`; a unit test keeps
 * the two in step.
 */

export const EMBED_PROVIDERS = ["youtube", "vimeo", "google", "loom"] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

export const EMBED_FRAME_ORIGINS = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://docs.google.com",
  "https://drive.google.com",
  "https://www.loom.com",
] as const;

export interface EmbedTarget {
  provider: EmbedProvider;
  src: string;
}

const ID = /^[A-Za-z0-9_-]{6,128}$/;

function host(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
}

/** The embed for a pasted https address, or null if it is not on the allow-list. */
export function embedFor(raw: string): EmbedTarget | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const h = host(url);
  const parts = url.pathname.split("/").filter(Boolean);

  if (h === "youtube.com" || h === "youtu.be") {
    const id =
      h === "youtu.be"
        ? parts[0]
        : parts[0] === "watch"
          ? url.searchParams.get("v")
          : ["shorts", "embed", "live"].includes(parts[0] ?? "")
            ? parts[1]
            : null;
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      return { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    return null;
  }

  if (h === "vimeo.com" || h === "player.vimeo.com") {
    const id = parts[0] === "video" ? parts[1] : parts[0];
    if (id && /^\d{5,12}$/.test(id)) return { provider: "vimeo", src: `https://player.vimeo.com/video/${id}` };
    return null;
  }

  if (h === "docs.google.com") {
    const [kind, d, id] = parts;
    if (d !== "d" || !id || !ID.test(id)) return null;
    if (kind === "document" || kind === "spreadsheets" || kind === "presentation") {
      return { provider: "google", src: `https://docs.google.com/${kind}/d/${id}/preview` };
    }
    if (kind === "forms") {
      return { provider: "google", src: `https://docs.google.com/forms/d/${id}/viewform?embedded=true` };
    }
    return null;
  }

  if (h === "drive.google.com") {
    const [file, d, id] = parts;
    if (file === "file" && d === "d" && id && ID.test(id)) {
      return { provider: "google", src: `https://drive.google.com/file/d/${id}/preview` };
    }
    return null;
  }

  if (h === "loom.com") {
    const [kind, id] = parts;
    if ((kind === "share" || kind === "embed") && id && /^[a-f0-9]{16,64}$/i.test(id)) {
      return { provider: "loom", src: `https://www.loom.com/embed/${id}` };
    }
    return null;
  }

  return null;
}

/** A bookmark only links to https addresses (no javascript:, data: or http:). */
export function safeBookmarkUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
