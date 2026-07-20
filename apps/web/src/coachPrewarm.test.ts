import { createInitialGame } from "@chess-coach/chess-core";
import type { ChessEngine } from "@chess-coach/engine";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisCache } from "./analysisCache";
import { createAnalysisCache } from "./analysisCache";
import { prewarmCoachPosition } from "./coachPrewarm";

describe("coach prewarm", () => {
  it("starts the exact before-position request during the player's turn", async () => {
    const analyze = vi.fn(async (_engine, request) => ({
      id: request.id,
      backend: "deterministic" as const,
      perspective: request.perspective,
      depth: 1,
      nodes: 1,
      lines: [],
    }));
    const cache = { analyze, clear: vi.fn() } as unknown as AnalysisCache;
    const engine = {} as ChessEngine;
    const fen = createInitialGame().fen;

    await prewarmCoachPosition({
      cache,
      engine,
      fen,
      perspective: "white",
      preset: "intermediate",
      historyIndex: 24,
    });

    expect(analyze).toHaveBeenCalledWith(
      engine,
      {
        id: "coach-prewarm-before-24",
        fen,
        perspective: "white",
        preset: "intermediate",
        multiPv: 2,
        limit: { kind: "time", milliseconds: 700 },
      },
      undefined,
    );
  });

  it("makes the later turn consume the identical completed result", async () => {
    const fen = createInitialGame().fen;
    const analyze = vi.fn(async (request) => ({
      id: request.id,
      backend: "deterministic" as const,
      perspective: request.perspective,
      depth: 14,
      nodes: 12_345,
      lines: [
        {
          rank: 1,
          score: { kind: "centipawns" as const, value: 18 },
          moves: ["e2e4"],
        },
      ],
    }));
    const engine = { analyze } as unknown as ChessEngine;
    const cache = createAnalysisCache();

    await prewarmCoachPosition({
      cache,
      engine,
      fen,
      perspective: "white",
      preset: "intermediate",
      historyIndex: 8,
    });
    const consumed = await cache.analyze(engine, {
      id: "coach-user-before-8",
      fen,
      perspective: "white",
      preset: "intermediate",
      multiPv: 2,
      limit: { kind: "time", milliseconds: 700 },
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(consumed).toMatchObject({
      id: "coach-user-before-8",
      depth: 14,
      nodes: 12_345,
      lines: [{ score: { kind: "centipawns", value: 18 } }],
    });
  });
});
