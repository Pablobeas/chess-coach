import { applyMove, createInitialGame } from "@chess-coach/chess-core";
import { describe, expect, it } from "vitest";
import {
  analyzeMove,
  classifyMove,
  expectedScoreFromWdl,
  hintForLevel,
} from "./index";

describe("coach pipeline", () => {
  it("normalizes WDL and uses versioned loss thresholds", () => {
    expect(expectedScoreFromWdl(3, 2, 1)).toBeCloseTo(2 / 3);
    expect(classifyMove(0.01)).toBe("excellent");
    expect(classifyMove(0.2)).toBe("mistake");
  });

  it("keeps evidence and progressive hints separate", () => {
    const before = createInitialGame();
    const after = applyMove(before, { from: "e2", to: "e4" });
    const feedback = analyzeMove(
      before,
      after,
      { rank: 1, score: { kind: "centipawns", value: 10 }, moves: ["e2e4"] },
      { rank: 1, score: { kind: "centipawns", value: -80 }, moves: ["e7e5"] },
    );

    expect(feedback.evidence.playedUci).toBe("e2e4");
    expect(hintForLevel(feedback, 1, "guided")).toBe(feedback.hints[1]);
    expect(hintForLevel(feedback, 3, "none")).toBeUndefined();
  });
});
