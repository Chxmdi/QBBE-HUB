import { describe, expect, it } from "vitest";
import {
  PROGRAM_COLORS,
  isProgramColor,
  programAccent,
} from "@/features/programs/colors";

describe("program colour", () => {
  it("maps every offered colour to a theme token", () => {
    // A colour the edit dialog offers but the accent map forgot would render
    // as the neutral one and look like a save that did not take.
    for (const color of PROGRAM_COLORS) {
      expect(programAccent(color)).toMatch(/^var\(--color-[a-z]+\)$/);
    }
    const distinct = new Set(PROGRAM_COLORS.map(programAccent));
    expect(distinct.size).toBe(PROGRAM_COLORS.length);
  });

  it("falls back to neutral for anything unrecognised", () => {
    const neutral = programAccent("neutral");
    expect(programAccent("chartreuse")).toBe(neutral);
    expect(programAccent(null)).toBe(neutral);
    expect(programAccent(undefined)).toBe(neutral);
    expect(programAccent(42)).toBe(neutral);
  });

  it("recognises only the stored colour names", () => {
    expect(isProgramColor("blue")).toBe(true);
    expect(isProgramColor("Blue")).toBe(false);
    expect(isProgramColor("")).toBe(false);
  });
});
