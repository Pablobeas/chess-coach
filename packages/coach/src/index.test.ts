import { describe, expect, it } from "vitest";
import { expectedLoss, expectedScoreFromWdl } from "./index";

describe("coach metrics", () => {
  it("treats a draw as half a point", () => {
    expect(expectedScoreFromWdl(250, 500, 250)).toBe(0.5);
  });

  it("never reports negative expected loss", () => {
    expect(expectedLoss(0.55, 0.6)).toBe(0);
  });

  it("rejects an empty WDL distribution", () => {
    expect(() => expectedScoreFromWdl(0, 0, 0)).toThrow(RangeError);
  });
});
