import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMBED_FRAME_ORIGINS, embedFor, safeBookmarkUrl } from "@/features/editor/adapter/embeds";

describe("embed allow-list", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=3", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871"],
    ["https://docs.google.com/document/d/1AbCdEfGhIj_kl/edit", "https://docs.google.com/document/d/1AbCdEfGhIj_kl/preview"],
    ["https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/edit#gid=0", "https://docs.google.com/spreadsheets/d/1AbCdEfGhIj/preview"],
    ["https://docs.google.com/presentation/d/1AbCdEfGhIj/edit", "https://docs.google.com/presentation/d/1AbCdEfGhIj/preview"],
    ["https://docs.google.com/forms/d/1AbCdEfGhIj/viewform", "https://docs.google.com/forms/d/1AbCdEfGhIj/viewform?embedded=true"],
    ["https://drive.google.com/file/d/1AbCdEfGhIj/view", "https://drive.google.com/file/d/1AbCdEfGhIj/preview"],
    ["https://www.loom.com/share/0123456789abcdef0123", "https://www.loom.com/embed/0123456789abcdef0123"],
  ])("embeds %s", (url, src) => {
    expect(embedFor(url)?.src).toBe(src);
  });

  it.each([
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=<script>",
    "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://docs.google.com/document/d/x/edit",
    "not a url",
  ])("refuses %s", (url) => {
    expect(embedFor(url)).toBeNull();
  });

  it("lets video and audio blocks play https links and library files", () => {
    const config = readFileSync("next.config.ts", "utf8");
    const mediaSrc = config.match(/"media-src ([^"]+)"/)?.[1].split(" ") ?? [];
    expect(mediaSrc).toEqual(expect.arrayContaining(["'self'", "blob:", "https:"]));
    expect(config).toMatch(/"media-src[^\n]*supabaseOrigins\(\)/);
  });

  it("only ever frames the origins the Content Security Policy allows", () => {
    const config = readFileSync("next.config.ts", "utf8");
    const frameSrc = config.match(/"frame-src ([^"]+)"/)?.[1].split(" ") ?? [];
    expect([...frameSrc].sort()).toEqual([...EMBED_FRAME_ORIGINS].sort());
    for (const url of [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://vimeo.com/76979871",
      "https://docs.google.com/document/d/1AbCdEfGhIj/edit",
      "https://drive.google.com/file/d/1AbCdEfGhIj/view",
      "https://www.loom.com/share/0123456789abcdef0123",
    ]) {
      expect(EMBED_FRAME_ORIGINS).toContain(new URL(embedFor(url)!.src).origin);
    }
  });
});

describe("bookmarks", () => {
  it("accept https only", () => {
    expect(safeBookmarkUrl(" https://example.org/a ")).toBe("https://example.org/a");
    expect(safeBookmarkUrl("http://example.org")).toBeNull();
    expect(safeBookmarkUrl("javascript:alert(1)")).toBeNull();
    expect(safeBookmarkUrl("data:text/html,x")).toBeNull();
  });
});
