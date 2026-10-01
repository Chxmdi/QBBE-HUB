// Turns the recorded chapters into the deliverables: one MP4 per chapter, the
// combined onboarding video with chapter markers, subtitles, an optional
// synthetic voice track, and an index page with every transcript.
//
//   node scripts/demo/assemble.mjs [--in .demo-out] [--out .demo-out/final] [--voice mb-us2|none] [--only 00,01]
//
// Needs ffmpeg: `pip install --user --break-system-packages imageio-ffmpeg`
// (or an ffmpeg on the PATH) and, for the voice track, espeak-ng with the
// mbrola voices (apt-get install espeak-ng mbrola mbrola-us2 mbrola-fr4).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const IN = resolve(option("in", ".demo-out"));
const OUT = resolve(option("out", join(IN, "final")));
const VOICE = option("voice", "none");
const ONLY = option("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TITLE = option("title", "QBBE Hub onboarding");
mkdirSync(OUT, { recursive: true });
const TMP = join(OUT, ".work");
mkdirSync(TMP, { recursive: true });

function ffmpegPath() {
  try {
    return execFileSync("python3", ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" }).trim();
  } catch {
    return "ffmpeg";
  }
}
const FF = ffmpegPath();
const ff = (ffArgs) => {
  const r = spawnSync(FF, ["-hide_banner", "-loglevel", "error", "-y", ...ffArgs], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${ffArgs.join(" ")}\n${r.stderr}`);
};
/** Duration in milliseconds, read from ffmpeg's own description of the file. */
function durationMs(file) {
  const r = spawnSync(FF, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):(\d+)\.(\d+)/.exec(r.stderr || "");
  if (!m) throw new Error(`No duration for ${file}`);
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + Math.round(+`0.${m[4]}` * 1000);
}

const srtTime = (ms) => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const clock = (ms) => {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------------------------------------------------------------------------
// Chapters, in id order.
// ---------------------------------------------------------------------------
const chapters = readdirSync(IN)
  .filter((f) => f.endsWith(".meta.json"))
  .map((f) => JSON.parse(readFileSync(join(IN, f), "utf8")))
  .filter((c) => existsSync(join(IN, `${c.id}.webm`)))
  .filter((c) => !ONLY.length || ONLY.some((o) => c.id.startsWith(o)))
  .sort((a, b) => a.id.localeCompare(b.id));
if (!chapters.length) {
  console.error(`No recorded chapters in ${IN}`);
  process.exit(1);
}

/** A synthetic voice track for one chapter: each caption spoken at the moment it appeared. */
function voiceTrack(chapter, captions, totalMs) {
  const parts = [];
  captions.forEach((c, i) => {
    const wav = join(TMP, `${chapter.id}-${i}.wav`);
    const text = c.text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    const r = spawnSync("espeak-ng", ["-v", VOICE, "-s", "155", "-p", "45", "-w", wav, text], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`espeak-ng failed: ${r.stderr}`);
    parts.push({ wav, at: c.at });
  });
  const track = join(TMP, `${chapter.id}.voice.m4a`);
  const inputs = parts.flatMap((p) => ["-i", p.wav]);
  const delays = parts.map((p, i) => `[${i + 1}:a]adelay=${p.at}|${p.at}[a${i}]`).join(";");
  const mix = parts.map((_, i) => `[a${i}]`).join("");
  ff([
    "-f", "lavfi", "-t", String(totalMs / 1000), "-i", "anullsrc=r=22050:cl=mono",
    ...inputs,
    "-filter_complex", `${delays};[0:a]${mix}amix=inputs=${parts.length + 1}:normalize=0:duration=first[out]`,
    "-map", "[out]", "-c:a", "aac", "-b:a", "96k", track,
  ]);
  return track;
}

console.log(`Assembling ${chapters.length} chapter(s) from ${IN} into ${OUT} (voice: ${VOICE})`);
const rendered = [];
for (const chapter of chapters) {
  const webm = join(IN, `${chapter.id}.webm`);
  const mp4 = join(OUT, `${chapter.id}.mp4`);
  const captions = JSON.parse(readFileSync(join(IN, `${chapter.id}.captions.json`), "utf8"));
  const ms = durationMs(webm);
  const video = ["-i", webm];
  let audio = [];
  if (VOICE !== "none") {
    const track = voiceTrack(chapter, captions, ms);
    audio = ["-i", track, "-map", "0:v:0", "-map", "1:a:0", "-c:a", "copy", "-shortest"];
  }
  ff([...video, ...audio, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", mp4]);
  const finalMs = durationMs(mp4);
  writeFileSync(
    join(OUT, `${chapter.id}.srt`),
    captions
      .map((c, i) => {
        const end = i + 1 < captions.length ? captions[i + 1].at : finalMs;
        return `${i + 1}\n${srtTime(c.at)} --> ${srtTime(Math.max(c.at + 800, end))}\n${c.text}\n`;
      })
      .join("\n"),
  );
  rendered.push({ ...chapter, mp4, captions, ms: finalMs });
  console.log(`✓ ${chapter.id}  ${clock(finalMs)}  ${captions.length} captions`);
}

// ---------------------------------------------------------------------------
// The combined video with chapter markers, and one subtitle file for it.
// ---------------------------------------------------------------------------
const list = join(TMP, "list.txt");
writeFileSync(list, rendered.map((c) => `file '${c.mp4.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
let offset = 0;
const meta = [";FFMETADATA1", `title=${TITLE}`];
const combinedSrt = [];
let n = 1;
for (const c of rendered) {
  meta.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${offset}`, `END=${offset + c.ms}`, `title=${c.title}`);
  c.offset = offset;
  c.captions.forEach((cap, i) => {
    const end = i + 1 < c.captions.length ? c.captions[i + 1].at : c.ms;
    combinedSrt.push(`${n++}\n${srtTime(offset + cap.at)} --> ${srtTime(offset + Math.max(cap.at + 800, end))}\n${cap.text}\n`);
  });
  offset += c.ms;
}
const metaFile = join(TMP, "chapters.ffmeta");
writeFileSync(metaFile, meta.join("\n") + "\n");
const combined = join(OUT, "qbbe-hub-onboarding.mp4");
ff(["-f", "concat", "-safe", "0", "-i", list, "-i", metaFile, "-map_metadata", "1", "-c", "copy", "-movflags", "+faststart", combined]);
writeFileSync(join(OUT, "qbbe-hub-onboarding.srt"), combinedSrt.join("\n"));
console.log(`✓ combined  ${clock(offset)}  -> ${basename(combined)}`);

// ---------------------------------------------------------------------------
// The index page: chapters, who they are for, timestamps and transcripts.
// ---------------------------------------------------------------------------
const rows = rendered
  .map(
    (c) => `
      <li>
        <a href="${basename(c.mp4)}"><strong>${escapeHtml(c.title)}</strong></a>
        <span class="meta">${escapeHtml(c.audience)} · ${clock(c.ms)} · starts at ${clock(c.offset)} in the full video</span>
        <details><summary>Transcript</summary><ol>${c.captions.map((cap) => `<li><span class="t">${clock(cap.at)}</span> ${escapeHtml(cap.text)}</li>`).join("")}</ol></details>
      </li>`,
  )
  .join("");
writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(TITLE)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#111;line-height:1.5}
  h1{font-size:30px} .meta{color:#555;font-size:14px;margin-left:8px} li{margin:14px 0} ol li{margin:4px 0}
  video{width:100%;border-radius:10px;background:#000} details{margin-top:4px} .t{color:#888;font-variant-numeric:tabular-nums;margin-right:8px}
  code{background:#f3f3f3;padding:1px 5px;border-radius:4px}
</style></head><body>
<h1>${escapeHtml(TITLE)}</h1>
<p>Watch the full video for a first sitting (${clock(offset)}; the player's chapter menu jumps between chapters), or open one chapter below when you need it again. Subtitles: <code>qbbe-hub-onboarding.srt</code>. Recorded from the Hub on ${new Date().toISOString().slice(0, 10)}.</p>
<video controls preload="metadata" src="${basename(combined)}"></video>
<h2>Chapters</h2>
<ul>${rows}</ul>
</body></html>
`,
);
console.log(`✓ index.html`);
