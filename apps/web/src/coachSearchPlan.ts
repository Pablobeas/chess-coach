import { ENGINE_PRESETS, type EnginePreset } from "@chess-coach/engine";

export interface CoachSearchPlan {
  readonly limit: {
    readonly kind: "time";
    readonly milliseconds: number;
  };
  readonly beforeMultiPv: number;
  readonly afterMultiPv: 1;
}

export function coachSearchPlan(preset: EnginePreset): CoachSearchPlan {
  const config = ENGINE_PRESETS[preset];
  return Object.freeze({
    limit: Object.freeze({
      kind: "time" as const,
      milliseconds: config.movetimeMilliseconds,
    }),
    beforeMultiPv: config.multiPv,
    // Only the principal reply is used after the played move. Alternatives are
    // required for equivalence detection in the position before the move.
    afterMultiPv: 1 as const,
  });
}
