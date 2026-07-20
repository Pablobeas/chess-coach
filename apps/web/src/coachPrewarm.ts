import type { PlayerColor } from "@chess-coach/chess-core";
import type { ChessEngine, EnginePreset } from "@chess-coach/engine";
import type { AnalysisCache } from "./analysisCache";
import { coachSearchPlan } from "./coachSearchPlan";

export interface CoachPrewarmInput {
  readonly cache: AnalysisCache;
  readonly engine: ChessEngine;
  readonly fen: string;
  readonly perspective: PlayerColor;
  readonly preset: EnginePreset;
  readonly historyIndex: number;
  readonly signal?: AbortSignal;
}

/** Starts the same before-position request later consumed by turn analysis. */
export async function prewarmCoachPosition(
  input: CoachPrewarmInput,
): Promise<void> {
  const searchPlan = coachSearchPlan(input.preset);
  await input.cache.analyze(
    input.engine,
    {
      id: `coach-prewarm-before-${input.historyIndex}`,
      fen: input.fen,
      perspective: input.perspective,
      preset: input.preset,
      multiPv: searchPlan.beforeMultiPv,
      limit: searchPlan.limit,
    },
    input.signal,
  );
}
