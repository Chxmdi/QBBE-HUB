import { describe, expect, it } from "vitest";
import { needsSecondFactor } from "@/features/auth/components/second-factor-reminder";

describe("second-factor reminder", () => {
  it("asks an owner or admin with one authenticator for a second, and stops once they have two", () => {
    expect(needsSecondFactor(true, 1)).toBe(true);
    expect(needsSecondFactor(true, 0)).toBe(true);
    expect(needsSecondFactor(true, 2)).toBe(false);
  });

  it("never asks staff or volunteers", () => {
    expect(needsSecondFactor(false, 1)).toBe(false);
    expect(needsSecondFactor(false, 0)).toBe(false);
  });
});
