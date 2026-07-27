import { describe, expect, it } from "vitest";
import { arrowGeometry } from "./TrainingBoard";

describe("arrowGeometry", () => {
  it.each([
    [
      { x: 4.5, y: 6.5 },
      { x: 4.5, y: 4.5 },
    ],
    [
      { x: 1.5, y: 3.5 },
      { x: 6.5, y: 3.5 },
    ],
    [
      { x: 1.5, y: 6.5 },
      { x: 5.5, y: 2.5 },
    ],
  ])(
    "insets vertical, horizontal and diagonal arrows without non-finite points",
    (from, to) => {
      const arrow = arrowGeometry(from, to)!;
      expect(arrow).toBeDefined();
      expect(arrow.start).not.toEqual(from);
      expect(arrow.tip).not.toEqual(to);
      expect(
        Object.values(arrow)
          .flatMap((point) => [point.x, point.y])
          .every(Number.isFinite),
      ).toBe(true);
    },
  );

  it("rejects zero-length arrows", () => {
    expect(
      arrowGeometry({ x: 4.5, y: 4.5 }, { x: 4.5, y: 4.5 }),
    ).toBeUndefined();
  });
});
