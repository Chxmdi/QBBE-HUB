import { describe, expect, it } from "vitest";
import { parseScanReply } from "../services/clamav";

describe("ClamAV verdict validation", () => {
  it("accepts only an explicit clean response", () => {
    expect(parseScanReply("stream: OK\0")).toBe("clean");
    expect(parseScanReply("stream: Eicar-Signature FOUND\0")).toBe("quarantined");
  });
  it.each(["", "stream: OK", "stream: timeout ERROR\0", "stream: OK\0stream: virus FOUND\0"])(
    "refuses incomplete or ambiguous replies: %s", (reply) => {
      expect(() => parseScanReply(reply)).toThrow();
    },
  );
});
