import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  fromBase64,
  toBase64,
  YjsBroadcastProvider,
  type BroadcastTransport,
  type ProviderStatus,
} from "./yjs-broadcast-provider";

/** An in-memory stand-in for a broadcast channel, with a switch to drop messages. */
class Bus {
  members = new Set<MemoryTransport>();
  dropRate = 0;
  constructor(private readonly random: () => number) {}
  deliver(from: MemoryTransport, event: string, payload: Record<string, unknown>) {
    const copy = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    for (const member of this.members) {
      if (member === from || !member.connected) continue;
      if (this.random() < this.dropRate) continue;
      queueMicrotask(() => member.receive(event, copy));
    }
  }
}

class MemoryTransport implements BroadcastTransport {
  connected = false;
  private messageHandler: (event: string, payload: Record<string, unknown>) => void = () => {};
  private statusHandler: (status: ProviderStatus) => void = () => {};
  constructor(private readonly bus: Bus) {}
  send(event: string, payload: Record<string, unknown>) {
    this.bus.deliver(this, event, payload);
  }
  onMessage(handler: (event: string, payload: Record<string, unknown>) => void) {
    this.messageHandler = handler;
  }
  onStatus(handler: (status: ProviderStatus) => void) {
    this.statusHandler = handler;
  }
  connect() {
    this.connected = true;
    this.bus.members.add(this);
    this.statusHandler("connected");
  }
  disconnect() {
    this.connected = false;
    this.bus.members.delete(this);
    this.statusHandler("disconnected");
  }
  receive(event: string, payload: Record<string, unknown>) {
    if (this.connected) this.messageHandler(event, payload);
  }
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

async function settle() {
  await vi.advanceTimersByTimeAsync(200);
}

function peer(bus: Bus, options = {}) {
  const doc = new Y.Doc();
  const provider = new YjsBroadcastProvider(doc, new MemoryTransport(bus), { resyncMs: 0, ...options });
  return { doc, provider, text: doc.getText("t") };
}

describe("YjsBroadcastProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips base64", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it("converges after 1,000 concurrent random edits with messages dropped and a disconnect", async () => {
    vi.useFakeTimers();
    const random = seeded(42);
    const bus = new Bus(random);
    const a = peer(bus);
    const b = peer(bus);
    await settle();

    const inserted: string[] = [];
    for (let i = 0; i < 1_000; i++) {
      const side = i % 2 === 0 ? a : b;
      if (i === 300) bus.dropRate = 0.2; // a lossy stretch
      if (i === 500) a.provider.disconnect(); // then a real drop
      if (i === 700) a.provider.connect();
      if (i === 800) bus.dropRate = 0;
      const token = `[${i}é]`;
      const length = side.text.length;
      if (random() < 0.8 || length < 10) {
        // Only between whole tokens, as the browser fuzz does, so a token is
        // never split by another and "every token survives" is checkable.
        const text = side.text.toString();
        const boundaries = [0];
        for (let p = 0; p < text.length; p++) if (text[p] === "]") boundaries.push(p + 1);
        side.text.insert(boundaries[Math.floor(random() * boundaries.length)], token);
        inserted.push(token);
      } else {
        side.text.format(0, Math.min(5, length), { bold: true });
      }
      if (i % 7 === 0) await vi.advanceTimersByTimeAsync(10);
    }
    await settle();
    // Dropped messages are recovered by the next handshake.
    a.provider.resync();
    await settle();

    expect(a.text.toString()).toBe(b.text.toString());
    expect(Y.encodeStateVector(a.doc)).toEqual(Y.encodeStateVector(b.doc));
    // Tokens can interleave only at token boundaries, so each survives intact.
    const final = a.text.toString();
    expect(inserted).toHaveLength(new Set(inserted).size);
    const missing = inserted.filter((token) => final.split(token).length !== 2);
    expect(missing, "every token present exactly once").toEqual([]);
    a.provider.destroy();
    b.provider.destroy();
  });

  it("splits large messages into chunks and reassembles them", async () => {
    vi.useFakeTimers();
    const bus = new Bus(seeded(1));
    const a = peer(bus, { maxMessageChars: 2_000 });
    await settle();
    a.text.insert(0, "x".repeat(20_000));
    await settle();

    // A late joiner receives the whole document through a chunked sync reply.
    const b = peer(bus, { maxMessageChars: 2_000 });
    await settle();
    expect(b.text.toString()).toBe(a.text.toString());
    expect(a.provider.sent.some((m) => m.event === "y-chunk")).toBe(true);
    expect(Math.max(...a.provider.sent.map((m) => m.bytes))).toBeLessThanOrEqual(2_000);
  });

  it("ignores malformed peer messages", async () => {
    vi.useFakeTimers();
    const bus = new Bus(seeded(2));
    const a = peer(bus);
    const b = peer(bus);
    await settle();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bus.deliver([...bus.members][1], "y-update", { from: "x", u: "not base64 !!" });
    bus.deliver([...bus.members][1], "y-update", { from: "x", u: toBase64(new Uint8Array([9, 9, 9])) });
    await settle();
    a.text.insert(0, "still works");
    await settle();
    expect(b.text.toString()).toBe("still works");
    warn.mockRestore();
  });
});
