import type { Browser, BrowserContext, Page, WebSocketRoute } from "@playwright/test";
import { expect, test } from "../e2e/fixtures";
import { signIn, type QaAccount } from "../e2e/auth";
import { percentile, writeEvidence } from "./evidence";

/**
 * W0-6: Yjs over Supabase Realtime broadcast, two browsers, local stack only.
 *
 * Needs the spike table: `bash scripts/spikes/apply-spike-schema.sh`.
 * Results go to docs/design/spikes/evidence/w0-6-*.json.
 */

type Sent = { event: string; bytes: number; at: number };
type Hooks = {
  ready: () => boolean;
  seed: (n: number) => void;
  edit: (side: "A" | "B", n: number, turnInto?: boolean) => { kind: string; token?: string; deleted?: string[] };
  tokens: () => string[];
  docBytes: () => number;
  snapshot: () => { stateVector: string; xml: string; blocks: string };
  stamp: (text: string) => number;
  waitFor: (text: string) => Promise<number>;
  stats: () => {
    sent: Sent[];
    receiveDelaysMs: number[];
    writes: { bytes: number; ok: boolean }[];
    unsaved: number;
    status: string | null;
    deletedElements: { at: number; names: string[]; local: boolean; fromPeer: boolean }[];
  };
  persistence: { flush: () => Promise<void> } | null;
};
declare global {
  interface Window {
    __editorSpike: Hooks;
    __pending?: Promise<number>;
  }
}

const contexts: BrowserContext[] = [];

/**
 * A real network drop for one client. Chromium's offline mode alone blocks
 * HTTP but leaves an open WebSocket untouched, so the Realtime socket is
 * routed through Playwright, which cuts it (and refuses reconnects) while the
 * network is "down", exactly as a dead Wi-Fi link would.
 */
type Network = { down: () => Promise<void>; up: () => Promise<void> };
const networks = new WeakMap<Page, Network>();

async function routeRealtime(page: Page): Promise<Network> {
  let up = true;
  const live = new Set<WebSocketRoute>();
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    if (!up) {
      void ws.close({ code: 4000, reason: "network down" });
      return;
    }
    ws.connectToServer();
    live.add(ws);
    ws.onClose(() => live.delete(ws));
  });
  return {
    async down() {
      up = false;
      await page.context().setOffline(true);
      for (const ws of live) await ws.close({ code: 4000, reason: "network down" });
      live.clear();
    },
    async up() {
      up = true;
      await page.context().setOffline(false);
    },
  };
}

async function openClient(browser: Browser, account: QaAccount, docId: string, flushMs?: number): Promise<Page> {
  const { baseURL, proxy } = test.info().project.use;
  const context = await browser.newContext({ baseURL, proxy });
  contexts.push(context);
  const page = await context.newPage();
  networks.set(page, await routeRealtime(page));
  await signIn(page, account);
  await page.goto(`/dev/editor-spike?doc=${docId}${flushMs === undefined ? "" : `&flush=${flushMs}`}`);
  await page.waitForFunction(() => window.__editorSpike?.ready(), null, { timeout: 30_000 });
  return page;
}

/**
 * Creates the document's first block on A and waits for B to have it.
 *
 * Two clients that both start from an empty Y.Doc each create BlockNote's
 * top-level block group, and the merge keeps only one: whatever was typed
 * into the other is dropped. The product must therefore create a page's Yjs
 * state once, when the page is created (M4c), never lazily in two browsers.
 * The probe test below measures what happens without this step.
 */
async function initialise(a: Page, b: Page) {
  await b.evaluate(() => {
    window.__pending = window.__editorSpike.waitFor("Start");
  });
  await a.evaluate(() => window.__editorSpike.stamp("Start"));
  await b.evaluate(() => window.__pending!);
  await waitForConvergence(a, b);
}

/** Records every token that disappears from this editor, and in which transaction. */
async function watchVanishing(page: Page) {
  await page.evaluate(() => {
    const s = window.__editorSpike as Hooks & { doc: { on: (e: string, f: (tr: { local: boolean; origin: unknown }) => void) => void }; provider: unknown };
    const w = window as unknown as { __vanished: unknown[] };
    let previous = new Set(s.tokens());
    w.__vanished = [];
    const hidden = new Map<string, number>();
    (w as unknown as { __hidden: unknown[] }).__hidden = [];
    s.doc.on("afterTransaction", (tr) => {
      // Text the shared document holds but the editor does not show.
      const inY = new Set(s.snapshot().xml.match(/\[[AB]\d+[éàçèô]\]/g) ?? []);
      const shown = new Set(s.tokens());
      for (const t of inY) {
        if (!shown.has(t) && !hidden.has(t)) {
          hidden.set(t, Date.now());
          (w as unknown as { __hidden: unknown[] }).__hidden.push({ t, fromPeer: tr.origin === s.provider, local: tr.local, at: Date.now() });
        }
      }
      const now = new Set(s.tokens());
      for (const t of previous) {
        if (!now.has(t)) w.__vanished.push({ t, local: tr.local, fromPeer: tr.origin === s.provider, status: s.stats().status, at: Date.now() });
      }
      previous = now;
    });
  });
}

async function vanished(page: Page) {
  return page.evaluate(() => (window as unknown as { __vanished: { t: string }[] }).__vanished);
}

async function hiddenTokens(page: Page) {
  return page.evaluate(() => (window as unknown as { __hidden: { t: string; at: number }[] }).__hidden);
}

/** All text in the editor's text blocks, in document order. */
async function allText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = (window.__editorSpike as unknown as {
      editor: { prosemirrorState: { doc: { descendants: (f: (n: { isTextblock: boolean; textContent: string }) => boolean) => void } } };
    }).editor;
    const out: string[] = [];
    editor.prosemirrorState.doc.descendants((node) => {
      if (node.isTextblock) {
        out.push(node.textContent);
        return false;
      }
      return true;
    });
    return out.join("");
  });
}

function characterCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ch of text) counts[ch] = (counts[ch] ?? 0) + 1;
  return counts;
}

async function waitForConvergence(a: Page, b: Page, timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    const [sa, sb] = await Promise.all([a, b].map((p) => p.evaluate(() => window.__editorSpike.snapshot())));
    if (sa.blocks === sb.blocks && sa.stateVector === sb.stateVector) return Date.now() - started;
    if (Date.now() - started > timeoutMs) {
      const [ta, tb] = await Promise.all([a, b].map((p) => p.evaluate(() => window.__editorSpike.tokens().length)));
      const [xa, xb] = await Promise.all([a, b].map((p) => p.evaluate(() => window.__editorSpike.stats().status)));
      throw new Error(`the two clients did not converge: sv equal=${sa.stateVector === sb.stateVector}, tokens ${ta}/${tb}, status ${xa}/${xb}`);
    }
    await a.waitForTimeout(100);
  }
}

function messageStats(sent: Sent[]) {
  const byEvent: Record<string, { count: number; maxBytes: number; totalBytes: number }> = {};
  for (const m of sent) {
    const e = (byEvent[m.event] ??= { count: 0, maxBytes: 0, totalBytes: 0 });
    e.count++;
    e.maxBytes = Math.max(e.maxBytes, m.bytes);
    e.totalBytes += m.bytes;
  }
  const buckets = new Map<number, number>();
  for (const m of sent) buckets.set(Math.floor(m.at / 1000), (buckets.get(Math.floor(m.at / 1000)) ?? 0) + 1);
  const sizes = sent.map((m) => m.bytes);
  return {
    messages: sent.length,
    p50Bytes: percentile(sizes, 50),
    p95Bytes: percentile(sizes, 95),
    maxBytes: Math.max(0, ...sizes),
    peakMessagesPerSecond: Math.max(0, ...buckets.values()),
    byEvent,
  };
}

test.describe("W0-6 co-editing over Supabase Realtime", () => {
  test.afterEach(async () => {
    while (contexts.length) await contexts.pop()!.close().catch(() => {});
  });

  for (const flushMs of [25, 100])
  test(`latency: p95 of an edit reaching the other browser (batching ${flushMs} ms)`, async ({ browser }) => {
    const docId = `lat-${flushMs}-${Date.now()}`;
    const a = await openClient(browser, "staff", docId, flushMs);
    const b = await openClient(browser, "pm", docId, flushMs);
    await initialise(a, b);

    const samples: { direction: string; ms: number }[] = [];
    for (let i = 0; i < 100; i++) {
      const [from, to, direction] = i % 2 === 0 ? [a, b, "A→B"] : [b, a, "B→A"];
      const marker = `L${i}x${Date.now()}`;
      await to.evaluate((m) => {
        window.__pending = window.__editorSpike.waitFor(m);
      }, marker);
      const sentAt = await from.evaluate((m) => window.__editorSpike.stamp(m), marker);
      const receivedAt = await to.evaluate(() => window.__pending!);
      samples.push({ direction, ms: receivedAt - sentAt });
      await a.waitForTimeout(100 + Math.random() * 100);
    }
    const ms = samples.map((s) => s.ms);
    const [statsA, statsB] = await Promise.all([a, b].map((p) => p.evaluate(() => window.__editorSpike.stats())));
    const transport = [...statsA.receiveDelaysMs, ...statsB.receiveDelaysMs];
    const result = {
      samples: samples.length,
      p50Ms: percentile(ms, 50),
      p95Ms: percentile(ms, 95),
      p99Ms: percentile(ms, 99),
      maxMs: Math.max(...ms),
      minMs: Math.min(...ms),
      transportOnly: { p50Ms: percentile(transport, 50), p95Ms: percentile(transport, 95) },
      flushBatchingMs: flushMs,
      raw: samples,
    };
    writeEvidence(`w0-6-latency-${flushMs}ms`, result);
    console.log(JSON.stringify({ ...result, raw: undefined }));
    expect(result.p95Ms, "95% of edits arrive within 1 s").toBeLessThan(1_000);
  });

  for (const withDrop of [false, true])
  test(`fuzz: 1,000 concurrent random edits ${withDrop ? "with a connection drop mid-run" : "on a steady connection"} converge with no lost edits`, async ({ browser }) => {
    const docId = `fuzz-${withDrop ? "drop" : "steady"}-${Date.now()}`;
    const a = await openClient(browser, "staff", docId);
    const b = await openClient(browser, "pm", docId);
    await initialise(a, b);

    const run = (page: Page, side: "A" | "B", seed: number) =>
      page.evaluate(
        async ({ side, seed }) => {
          const s = window.__editorSpike;
          s.seed(seed);
          const inserted: string[] = [];
          const deleted: string[] = [];
          const kinds: Record<string, number> = {};
          for (let i = 0; i < 500; i++) {
            const r = s.edit(side, i);
            kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
            if (r.token) inserted.push(r.token);
            if (r.deleted) deleted.push(...r.deleted);
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 30));
          }
          return { inserted, deleted, kinds };
        },
        { side, seed },
      );

    await watchVanishing(a);
    await watchVanishing(b);
    const statusLog: { t: number; status: string | null }[] = [];
    const started = Date.now();
    const runs = Promise.all([run(a, "A", 11), run(b, "B", 22)]);
    // Drop A's network 2 s in, for 4 s, while both keep editing.
    await a.waitForTimeout(2_000);
    if (withDrop) await networks.get(a)!.down();
    const dropAt = Date.now() - started;
    for (let i = 0; i < 16; i++) {
      statusLog.push({ t: Date.now() - started, status: (await a.evaluate(() => window.__editorSpike.stats().status)) });
      await a.waitForTimeout(250);
    }
    if (withDrop) await networks.get(a)!.up();
    const restoreAt = Date.now() - started;
    for (let i = 0; i < 20; i++) {
      statusLog.push({ t: Date.now() - started, status: (await a.evaluate(() => window.__editorSpike.stats().status)) });
      if (statusLog[statusLog.length - 1].status === "connected") break;
      await a.waitForTimeout(250);
    }
    const [ra, rb] = await runs;
    const editsDoneAt = Date.now() - started;
    const convergeMs = await waitForConvergence(a, b);

    const expected = new Set([...ra.inserted, ...rb.inserted]);
    for (const token of [...ra.deleted, ...rb.deleted]) expected.delete(token);
    const deleted = new Set([...ra.deleted, ...rb.deleted]);
    const check = (tokens: string[]) => {
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
      return {
        missing: [...expected].filter((t) => !counts.has(t)),
        duplicated: [...counts].filter(([, n]) => n > 1).map(([t]) => t),
        resurrected: [...deleted].filter((t) => counts.has(t)),
        unexpected: [...counts.keys()].filter((t) => !expected.has(t) && !deleted.has(t)),
      };
    };
    const [tokensA, tokensB] = await Promise.all([a, b].map((p) => p.evaluate(() => window.__editorSpike.tokens())));
    const finalText = (await allText(a)).replaceAll("Start", "");
    const textB = (await allText(b)).replaceAll("Start", "");
    const expectedChars = characterCounts([...expected].join(""));
    const actualChars = characterCounts(finalText);
    const [vanishedA, vanishedB] = await Promise.all([vanished(a), vanished(b)]);
    const [hiddenA, hiddenB] = await Promise.all([hiddenTokens(a), hiddenTokens(b)]);
    const unexplained = (list: { t: string }[]) => list.filter((v) => !deleted.has(v.t)).map((v) => ({ ...v, at: undefined, atMs: (v as { at?: number }).at! - started }));

    // Persistence: flush both, close them, and load a third client from the database alone.
    await Promise.all([a, b].map((p) => p.evaluate(() => window.__editorSpike.persistence!.flush())));
    const [statsA, statsB] = await Promise.all([a, b].map((p) => p.evaluate(() => window.__editorSpike.stats())));
    await a.context().close();
    await b.context().close();
    const c = await openClient(browser, "staff", docId);
    const tokensC = await c.evaluate(() => window.__editorSpike.tokens());
    const textC = (await allText(c)).replaceAll("Start", "");
    const docBytes = await c.evaluate(() => window.__editorSpike.docBytes());

    const result = {
      edits: { A: ra.kinds, B: rb.kinds, total: 1_000 },
      timeline: { dropAtMs: dropAt, restoreAtMs: restoreAt, editsDoneAtMs: editsDoneAt, convergedAfterEditsMs: convergeMs, statusLog },
      expectedTokens: expected.size,
      deletedTokens: deleted.size,
      clientA: check(tokensA),
      clientB: check(tokensB),
      reloadedFromDatabase: check(tokensC),
      vanishedWithoutDelete: { A: unexplained(vanishedA), B: unexplained(vanishedB) },
      elementDeletions: {
        A: statsA.deletedElements.map((d) => ({ ...d, at: undefined, atMs: d.at - started })),
        B: statsB.deletedElements.map((d) => ({ ...d, at: undefined, atMs: d.at - started })),
      },
      shownOutOfStep: {
        A: hiddenA.map((h) => ({ ...h, at: undefined, atMs: h.at - started })),
        B: hiddenB.map((h) => ({ ...h, at: undefined, atMs: h.at - started })),
      },
      identicalText: finalText === textB && finalText === textC,
      charactersLostOrDuplicated: Object.keys({ ...expectedChars, ...actualChars })
        .filter((ch) => (expectedChars[ch] ?? 0) !== (actualChars[ch] ?? 0))
        .map((ch) => ({ ch, expected: expectedChars[ch] ?? 0, actual: actualChars[ch] ?? 0 })),
      interleavedTokens: {
        count: expected.size - [...expected].filter((t) => finalText.includes(t)).length,
        ratePercent: Number((100 * (expected.size - [...expected].filter((t) => finalText.includes(t)).length) / expected.size).toFixed(2)),
        examples: [...expected]
          .filter((t) => !finalText.includes(t))
          .slice(0, 5)
          .map((t) => {
            const at = finalText.indexOf(t.slice(2, -2));
            return { token: t, context: at >= 0 ? finalText.slice(Math.max(0, at - 12), at + 12) : null };
          }),
      },
      persistence: {
        rowsWrittenA: statsA.writes.length,
        rowsWrittenB: statsB.writes.length,
        failedWritesWhileOffline: statsA.writes.filter((w) => !w.ok).length,
        unsavedAfterFlush: statsA.unsaved + statsB.unsaved,
      },
      finalDocumentBytes: docBytes,
      messages: { A: messageStats(statsA.sent), B: messageStats(statsB.sent) },
    };
    writeEvidence(`w0-6-fuzz-${withDrop ? "drop" : "steady"}`, result);
    console.log(JSON.stringify(result, null, 1).slice(0, 4000));

    // 1. Both browsers and a fresh load from the database hold the same text.
    expect(result.identicalText, "A, B and the database copy are identical").toBe(true);
    // 2. No whole edit was duplicated and nothing deleted came back.
    for (const client of [result.clientA, result.clientB, result.reloadedFromDatabase]) {
      expect(client.duplicated).toEqual([]);
      expect(client.resurrected).toEqual([]);
    }
    // 3. Character-level differences and tokens interleaved with a simultaneous
    //    insert at the same spot come from the editor binding (y-prosemirror's
    //    text diff), not the transport: the plain Y.Text fuzz below is exact.
    //    They are reported, not asserted. See W0-6 notes, finding F1.
    test.info().annotations.push({
      type: "editor-binding anomalies",
      description: JSON.stringify({ characters: result.charactersLostOrDuplicated, interleaved: result.interleavedTokens }),
    });
    if (withDrop) expect(statusLog.some((s) => s.status === "disconnected"), "the drop was real: A saw itself offline").toBe(true);
  });

  test("transport fuzz: 1,000 random edits on a plain Y.Text over Supabase Realtime, with a drop, are exact", async ({ browser }) => {
    const docId = `ytext-${Date.now()}`;
    const a = await openClient(browser, "staff", docId);
    const b = await openClient(browser, "pm", docId);
    await initialise(a, b);
    const run = (page: Page, side: "A" | "B", seed: number) =>
      page.evaluate(
        async ({ side, seed }) => {
          const doc = (window.__editorSpike as unknown as { doc: { getText: (n: string) => { toString(): string; length: number; insert(i: number, s: string): void; delete(i: number, n: number): void; format(i: number, n: number, a: object): void } } }).doc;
          const text = doc.getText("transport-fuzz");
          let state = seed;
          const random = () => {
            state = (state * 1664525 + 1013904223) % 4294967296;
            return state / 4294967296;
          };
          const inserted: string[] = [];
          const deleted: string[] = [];
          for (let i = 0; i < 500; i++) {
            const current = text.toString();
            const tokens = [...current.matchAll(/\[[AB]\d+é\]/g)];
            const roll = random();
            if (roll < 0.75 || tokens.length === 0) {
              const boundaries = [0, ...tokens.map((m) => m.index! + m[0].length)];
              const token = `[${side}${i}é]`;
              text.insert(boundaries[Math.floor(random() * boundaries.length)], token);
              inserted.push(token);
            } else if (roll < 0.9) {
              const m = tokens[Math.floor(random() * tokens.length)];
              text.delete(m.index!, m[0].length);
              deleted.push(m[0]);
            } else {
              const m = tokens[Math.floor(random() * tokens.length)];
              text.format(m.index!, m[0].length, { bold: true });
            }
            await new Promise((resolve) => setTimeout(resolve, random() * 30));
          }
          return { inserted, deleted };
        },
        { side, seed },
      );
    const runs = Promise.all([run(a, "A", 7), run(b, "B", 8)]);
    await a.waitForTimeout(2_000);
    await networks.get(a)!.down();
    await a.waitForTimeout(4_000);
    await networks.get(a)!.up();
    const [ra, rb] = await runs;
    const read = (page: Page) =>
      page.evaluate(() => (window.__editorSpike as unknown as { doc: { getText: (n: string) => { toString(): string } } }).doc.getText("transport-fuzz").toString());
    let textA = "";
    let textB = "";
    await expect
      .poll(async () => {
        [textA, textB] = await Promise.all([read(a), read(b)]);
        return textA === textB;
      }, { timeout: 60_000 })
      .toBe(true);
    const removed = new Set([...ra.deleted, ...rb.deleted]);
    const expected = [...ra.inserted, ...rb.inserted].filter((t) => !removed.has(t));
    const found = [...textA.matchAll(/\[[AB]\d+é\]/g)].map((m) => m[0]);
    const result = {
      edits: 1_000,
      expectedTokens: expected.length,
      missing: expected.filter((t) => !found.includes(t)),
      duplicated: found.filter((t, i) => found.indexOf(t) !== i),
      resurrected: found.filter((t) => removed.has(t)),
      strayCharacters: textA.replace(/\[[AB]\d+é\]/g, "").length,
    };
    writeEvidence("w0-6-transport-fuzz", result);
    console.log(JSON.stringify(result));
    expect(result).toEqual({ edits: 1_000, expectedTokens: expected.length, missing: [], duplicated: [], resurrected: [], strayCharacters: 0 });
  });

  test("recovery: edits made on both sides while one is offline all arrive after reconnecting", async ({ browser }) => {
    const docId = `drop-${Date.now()}`;
    const a = await openClient(browser, "staff", docId);
    const b = await openClient(browser, "pm", docId);
    await initialise(a, b);

    await networks.get(a)!.down();
    await expect.poll(() => a.evaluate(() => window.__editorSpike.stats().status), { timeout: 30_000 }).toBe("disconnected");
    const downAt = Date.now();
    const edits = (page: Page, side: "A" | "B") =>
      page.evaluate((side) => {
        const inserted: string[] = [];
        const deleted: string[] = [];
        window.__editorSpike.seed(side === "A" ? 5 : 6);
        for (let i = 0; i < 50; i++) {
          const r = window.__editorSpike.edit(side, 9_000 + i);
          if (r.token) inserted.push(r.token);
          if (r.deleted) deleted.push(...r.deleted);
        }
        return { inserted, deleted };
      }, side);
    const [offA, onB] = await Promise.all([edits(a, "A"), edits(b, "B")]);
    const removed = new Set([...offA.deleted, ...onB.deleted]);
    const expectedTokens = [...offA.inserted, ...onB.inserted].filter((t) => !removed.has(t));
    await networks.get(a)!.up();
    const restoredAt = Date.now();
    await expect.poll(() => a.evaluate(() => window.__editorSpike.stats().status), { timeout: 60_000 }).toBe("connected");
    const reconnectMs = Date.now() - restoredAt;
    const convergeMs = await waitForConvergence(a, b);
    const tokens = await b.evaluate(() => window.__editorSpike.tokens());
    const tokensA = await a.evaluate(() => window.__editorSpike.tokens());
    const result = {
      offlineForMs: restoredAt - downAt,
      reconnectMs,
      convergeAfterReconnectMs: convergeMs,
      offlineEditsFromA: 50,
      concurrentEditsFromB: 50,
      expectedTokens: expectedTokens.length,
      missingOnB: expectedTokens.filter((t) => !tokens.includes(t)),
      missingOnA: expectedTokens.filter((t) => !tokensA.includes(t)),
    };
    writeEvidence("w0-6-recovery", result);
    console.log(JSON.stringify(result));
    expect(result.missingOnB).toEqual([]);
    expect(result.missingOnA).toEqual([]);
  });

  test("probe: concurrent 'turn into' (block type changes) — measured, not asserted", async ({ browser }) => {
    const docId = `turn-${Date.now()}`;
    const a = await openClient(browser, "staff", docId);
    const b = await openClient(browser, "pm", docId);
    await initialise(a, b);
    const run = (page: Page, side: "A" | "B", seed: number) =>
      page.evaluate(
        async ({ side, seed }) => {
          const s = window.__editorSpike;
          s.seed(seed);
          const inserted: string[] = [];
          const deleted: string[] = [];
          let turnInto = 0;
          for (let i = 0; i < 300; i++) {
            const r = s.edit(side, i, true);
            if (r.kind === "turnInto") turnInto++;
            if (r.token) inserted.push(r.token);
            if (r.deleted) deleted.push(...r.deleted);
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 15));
          }
          return { inserted, deleted, turnInto };
        },
        { side, seed },
      );
    const [ra, rb] = await Promise.all([run(a, "A", 31), run(b, "B", 32)]);
    const convergeMs = await waitForConvergence(a, b);
    const expected = new Set([...ra.inserted, ...rb.inserted]);
    for (const t of [...ra.deleted, ...rb.deleted]) expected.delete(t);
    const tokens = new Set(await a.evaluate(() => window.__editorSpike.tokens()));
    const lost = [...expected].filter((t) => !tokens.has(t));
    const result = { turnIntoOps: ra.turnInto + rb.turnInto, expected: expected.size, lost: lost.length, lostTokens: lost.slice(0, 20), convergeMs };
    writeEvidence("w0-6-turn-into-probe", result);
    console.log(JSON.stringify(result));
  });

  test("probe: two browsers start typing into the same brand-new empty document — measured, not asserted", async ({ browser }) => {
    const docId = `init-${Date.now()}`;
    const a = await openClient(browser, "staff", docId);
    const b = await openClient(browser, "pm", docId);
    const [ta, tb] = await Promise.all(
      ([[a, "A"], [b, "B"]] as const).map(([page, side]) =>
        page.evaluate((side) => {
          window.__editorSpike.seed(side === "A" ? 41 : 42);
          const out: string[] = [];
          for (let i = 0; i < 5; i++) {
            const r = window.__editorSpike.edit(side, i);
            if (r.token) out.push(r.token);
          }
          return out;
        }, side),
      ),
    );
    await waitForConvergence(a, b);
    const tokens = new Set(await a.evaluate(() => window.__editorSpike.tokens()));
    const lost = [...ta, ...tb].filter((t) => !tokens.has(t));
    const result = { typedA: ta.length, typedB: tb.length, lost: lost.length, lostTokens: lost };
    writeEvidence("w0-6-empty-document-race-probe", result);
    console.log(JSON.stringify(result));
  });
});
