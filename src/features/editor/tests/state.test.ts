import { describe, expect, it } from "vitest";
import { base64ToByteaHex, base64ToBytes, byteaHexToBase64, bytesToBase64 } from "@/features/editor/adapter/state";

describe("collaboration state encoding", () => {
  it("round-trips bytes through base64 and bytea hex", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const b64 = bytesToBase64(bytes);
    expect([...base64ToBytes(b64)]).toEqual([...bytes]);
    expect(base64ToByteaHex(b64)).toBe("\\x0001027f80ff");
    expect(byteaHexToBase64("\\x0001027f80ff")).toBe(b64);
  });

  it("handles large states in chunks", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it("refuses anything that is not bytea hex", () => {
    expect(byteaHexToBase64(null)).toBeNull();
    expect(byteaHexToBase64("0102")).toBeNull();
    expect(byteaHexToBase64("\\x01zz")).toBeNull();
    expect(byteaHexToBase64("\\x012")).toBeNull();
  });
});
