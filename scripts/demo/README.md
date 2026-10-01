# Onboarding demo recorder

Records the onboarding chapters from the real Hub, running locally. The plan and chapter list are in `docs/onboarding/demo-video-plan.md`.

## Run

```bash
# Local stack, seeded, with the demo dataset (see dataset.mjs), then the Hub built with every switch on:
npx supabase db reset --local && npm run db:seed && node scripts/demo/dataset.mjs
#   export NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from `npx supabase status -o env`
WORKSPACE_OS_FLAGS=all NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 npm run build && npx next start -p 3000 -H 127.0.0.1

# One chapter (English). Output lands in .demo-out/ (ignored by git).
NO_PROXY='*' node scripts/demo/record.mjs 00-welcome
# French interface:
NO_PROXY='*' node scripts/demo/record.mjs 00-welcome --locale fr-CA --out .demo-out/fr

# Quick look at what was recorded: a frame every six seconds.
FF=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")   # pip install imageio-ffmpeg
$FF -y -i .demo-out/00-welcome.webm -vf "fps=1/6,scale=960:-1" .demo-out/00-welcome-%02d.png
```

Each run writes `<id>.webm` (1920 × 1080), `<id>.captions.json` (every caption with the millisecond it appeared), `<id>.srt` and `<id>.meta.json` (title, audience, duration, whether the run completed). A failed run also leaves `<id>.failure.png`.

## Writing a chapter

A chapter is `scripts/demo/chapters/<nn>-<slug>.mjs`:

```js
export default {
  id: "03-projects",
  title: "Projects and programs",
  audience: "Staff",
  async run(d) {
    await d.signIn("staff");                       // owner | admin | staff | volunteer | guest …
    await d.title("QBBE Hub · Chapter 3", "Projects and programs", "From idea to closed project");
    await d.say("A project is a piece of work with a start, a target date and someone responsible.");
    await d.click(d.page.getByRole("link", { name: "Projects", exact: true }));
    await d.highlight(d.page.getByRole("button", { name: "New project" }));
    await d.type(d.page.getByLabel("Name"), "Spring tutoring drive");
    await d.press("Enter");
  },
};
```

The toolkit (`d`):

| Call | What it does |
|---|---|
| `say(text, { hold })` | Shows the caption and records its time. Holds for a reading pace (about 400 ms a word) unless `hold` (ms) is given. The caption stays until the next `say` or `clearCaption()`. |
| `title(kicker, heading, subtitle, hold)` | Full-screen title card, 3.2 s by default. Use once at the start of a chapter; a second one is fine for a change of scene. |
| `go(path)` | Navigates and waits for the page to settle. |
| `hover(target)`, `click(target)`, `type(target, text, { clear })`, `press(key)` | Move the visible cursor to the element (a Playwright locator or a CSS selector), then act, at a person's pace. `click` waits until React has attached its handlers. |
| `highlight(target, { hold })` | Draws a box around the element for 1.6 s. |
| `signIn(account)` | Signs the QA account in (two-step verification handled for owner and admin). |
| `pause(ms)`, `settle()` | Wait. |
| `page`, `context`, `base`, `locale` | The Playwright objects when something more is needed. |

Rules for a chapter that will be watched by a new member:

- **Say it, then do it.** Every click is preceded by a sentence that says what is about to happen and why. Never let the cursor act in silence for more than a few seconds.
- **Two to four minutes.** One screen family per chapter. Fewer, slower actions beat a rush.
- **Plain words, no jargon.** Spell out what a term means the first time ("a lens is a saved way of looking at records").
- **Real-looking content.** Use the demo dataset's names (see `DATASET.md`) and create things with believable names. Never the words "test", "foo" or a timestamp on screen.
- **Role honesty.** Sign in as the role the chapter is for. If something is only for administrators, say so.
- **Deterministic.** Prefer `getByRole`/`getByLabel` locators from the browser specs in `tests/e2e/`, which already know every screen. Wait on something visible before saying the next line. A chapter must record the same way twice.
- **Locale-neutral where possible.** Locators by role and label work in English; the French pass sets the locale cookie and uses the French labels from `src/lib/i18n` and each feature's `i18n` folder, so keep labels in one place at the top of the chapter where both languages can be given (`d.locale === "fr-CA"`).
- **Never touch a hosted project.** The recorder only knows the base URL it is given.

## Narration

Captions are burned into the recording by the overlay and also written to `<id>.srt`; `<id>.captions.json` carries the exact timings so a voice (a person, or any text-to-speech) can be laid over the video later. Keep each caption to one spoken sentence or two short ones (under about 30 words), as it has to fit the caption bar and be read comfortably.
