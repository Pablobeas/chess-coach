import { describe, expect, it } from "vitest";
import { coachSearchPlan } from "./coachSearchPlan";

describe("coach search plan", () => {
  it.each([
    ["beginner", 250, 3],
    ["intermediate", 700, 2],
    ["advanced", 1500, 3],
  ] as const)(
    "uses the %s preset and requests alternatives only where they are consumed",
    (preset, milliseconds, beforeMultiPv) => {
      expect(coachSearchPlan(preset)).toEqual({
        limit: { kind: "time", milliseconds },
        beforeMultiPv,
        afterMultiPv: 1,
      });
    },
  );
});
