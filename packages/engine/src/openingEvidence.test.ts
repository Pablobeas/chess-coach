import {
  applyUciMove,
  createInitialGame,
  loadPosition,
} from "@chess-coach/chess-core";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisResult, ChessEngine } from "./index";
import { collectOpeningEvidence } from "./openingEvidence";

const initialFen = createInitialGame().fen;
const afterE4Fen = applyUciMove(loadPosition(initialFen), "e2e4").fen;
const afterC5Fen = applyUciMove(loadPosition(afterE4Fen), "c7c5").fen;

function result(
  fen: string,
  partial: Partial<AnalysisResult> & Pick<AnalysisResult, "id" | "perspective">,
): AnalysisResult {
  return {
    id: partial.id,
    backend: partial.backend ?? "stockfish-wasm",
    perspective: partial.perspective,
    depth: partial.depth ?? 12,
    nodes: partial.nodes ?? 1_000,
    lines: partial.lines ?? [
      {
        rank: 1,
        score: { kind: "centipawns", value: 24 },
        moves: fen === afterE4Fen ? ["e7e5", "g1f3"] : ["g1f3", "d7d6"],
      },
    ],
  };
}

function createFakeEngine(analyzeImpl: ChessEngine["analyze"]): ChessEngine {
  return {
    analyze: analyzeImpl,
    dispose: async () => undefined,
    getStatus: () => ({ backend: "stockfish-wasm", availability: "ready" }),
  };
}

describe("opening evidence collection", () => {
  it("builds coach-compatible evidence by prepending candidate moves to child PVs", async () => {
    const analyze = vi.fn<ChessEngine["analyze"]>(async (request) => {
      if (request.fen === afterE4Fen) {
        return result(request.fen, {
          id: request.id,
          perspective: request.perspective,
          lines: [
            {
              rank: 1,
              score: { kind: "centipawns", value: 32 },
              moves: ["e7e5", "g1f3"],
              wdl: { wins: 420, draws: 410, losses: 170 },
            },
          ],
        });
      }
      if (request.fen === afterC5Fen) {
        return result(request.fen, {
          id: request.id,
          perspective: request.perspective,
          lines: [
            {
              rank: 1,
              score: { kind: "centipawns", value: 12 },
              moves: ["g1f3", "d7d6"],
            },
          ],
        });
      }
      throw new Error(`Unexpected FEN ${request.fen}`);
    });
    const engine = createFakeEngine(analyze);

    const evidence = await collectOpeningEvidence(engine, {
      id: "italian-after-e4",
      fen: afterE4Fen,
      perspective: "white",
      repertoireMoves: ["e7e5", "c7c5"],
      limit: { kind: "nodes", nodes: 2_000 },
    });

    expect(evidence).toEqual({
      kind: "ok",
      id: "italian-after-e4",
      backend: "stockfish-wasm",
      evidence: {
        best: {
          rank: 1,
          score: { kind: "centipawns", value: 32 },
          moves: ["e7e5", "g1f3"],
          wdl: { wins: 420, draws: 410, losses: 170 },
        },
        candidates: [
          {
            move: "e7e5",
            line: {
              rank: 1,
              score: { kind: "centipawns", value: 32 },
              moves: ["e7e5", "g1f3"],
              wdl: { wins: 420, draws: 410, losses: 170 },
            },
          },
          {
            move: "c7c5",
            line: {
              rank: 1,
              score: { kind: "centipawns", value: 12 },
              moves: ["c7c5", "g1f3", "d7d6"],
            },
          },
        ],
        engineBestMove: "e7e5",
      },
    });
    expect(analyze.mock.calls.map(([request]) => request.fen)).toEqual([
      afterE4Fen,
      afterC5Fen,
    ]);
  });

  it("drops invalid child evidence instead of trusting it", async () => {
    const analyze = vi.fn<ChessEngine["analyze"]>(async (request) => {
      if (request.fen === afterE4Fen) {
        return result(request.fen, {
          id: request.id,
          perspective: request.perspective,
          lines: [
            {
              rank: 1,
              score: { kind: "centipawns", value: 32 },
              moves: ["e7e5", "g1f3"],
            },
          ],
        });
      }
      if (request.fen === afterC5Fen) {
        return result(request.fen, {
          id: request.id,
          perspective: request.perspective,
          lines: [
            {
              rank: 1,
              score: { kind: "centipawns", value: 12 },
              moves: ["e2e4"],
            },
          ],
        });
      }
      throw new Error(`Unexpected FEN ${request.fen}`);
    });
    const engine = createFakeEngine(analyze);

    const evidence = await collectOpeningEvidence(engine, {
      id: "italian-invalid-child",
      fen: afterE4Fen,
      perspective: "white",
      repertoireMoves: ["e7e5", "c7c5"],
      limit: { kind: "nodes", nodes: 2_000 },
    });

    expect(evidence).toEqual({
      kind: "ok",
      id: "italian-invalid-child",
      backend: "stockfish-wasm",
      evidence: {
        best: {
          rank: 1,
          score: { kind: "centipawns", value: 32 },
          moves: ["e7e5", "g1f3"],
        },
        candidates: [
          {
            move: "e7e5",
            line: {
              rank: 1,
              score: { kind: "centipawns", value: 32 },
              moves: ["e7e5", "g1f3"],
            },
          },
        ],
        engineBestMove: "e7e5",
      },
      skippedCandidates: [
        {
          move: "c7c5",
          reason: "invalid-line",
          message:
            "Engine returned an illegal principal variation for the candidate move",
        },
      ],
    });
  });

  it("returns unavailable when the root analysis cannot be produced", async () => {
    const engine = createFakeEngine(async () => {
      throw new Error("WASM bootstrap failed");
    });

    await expect(
      collectOpeningEvidence(engine, {
        id: "italian-unavailable",
        fen: afterE4Fen,
        perspective: "white",
        repertoireMoves: ["e7e5"],
        limit: { kind: "nodes", nodes: 2_000 },
      }),
    ).resolves.toEqual({
      kind: "unavailable",
      id: "italian-unavailable",
      reason: "WASM bootstrap failed",
    });
  });

  it("propagates cancellation instead of masking it as unavailability", async () => {
    const engine = createFakeEngine(async (_request, signal) => {
      signal?.throwIfAborted?.();
      return await new Promise<AnalysisResult>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () =>
            reject(new DOMException("Analysis was cancelled", "AbortError")),
          { once: true },
        );
      });
    });
    const controller = new AbortController();
    const work = collectOpeningEvidence(
      engine,
      {
        id: "italian-aborted",
        fen: afterE4Fen,
        perspective: "white",
        repertoireMoves: ["e7e5"],
        limit: { kind: "nodes", nodes: 2_000 },
      },
      controller.signal,
    );

    controller.abort();

    await expect(work).rejects.toMatchObject({ name: "AbortError" });
  });
});
