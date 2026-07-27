import { describe, expect, it } from "vitest";
import {
  applyUciMove,
  createInitialGame,
  positionKeyForFen,
} from "@chess-coach/chess-core";
import {
  ITALIAN_OPENING_COURSE_V1,
  matchOpeningPositionV1,
  validateOpeningCourseV1,
} from "@chess-coach/coach";

describe("opening position-key and fallback fixtures", () => {
  it("is stable across transposition paths", () => {
    let a = createInitialGame();
    for (const move of [
      "e2e4",
      "e7e5",
      "g1f3",
      "b8c6",
      "f1c4",
      "f8c5",
      "d2d3",
      "g8f6",
    ])
      a = applyUciMove(a, move);
    let b = createInitialGame();
    for (const move of [
      "e2e4",
      "e7e5",
      "g1f3",
      "b8c6",
      "f1c4",
      "g8f6",
      "d2d3",
      "f8c5",
    ])
      b = applyUciMove(b, move);
    expect(positionKeyForFen(a.fen)).toBe(positionKeyForFen(b.fen));
    const match = matchOpeningPositionV1(
      ITALIAN_OPENING_COURSE_V1,
      b.fen,
      "a2a3",
    );
    expect(match.kind).toBe("outside");
    expect(match.node).toBeUndefined();
  });

  it("rejects malformed position keys at the content boundary", () => {
    const course = structuredClone(ITALIAN_OPENING_COURSE_V1);
    course.nodes[0] = {
      ...course.nodes[0]!,
      positionKey: "not-a-position-key" as never,
    };
    expect(() => validateOpeningCourseV1(course)).toThrow(/key/i);
  });
});
