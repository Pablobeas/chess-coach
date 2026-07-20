import { createInitialGame } from "@chess-coach/chess-core";
import type {
  AnalysisProgress,
  AnalysisRequest,
  AnalysisResult,
  ChessEngine,
  EngineBackend,
} from "@chess-coach/engine";
import { describe, expect, it, vi } from "vitest";
import { createBrowserStockfishEngine } from "./engineClient";

function resultFor(
  request: AnalysisRequest,
  backend: EngineBackend,
): AnalysisResult {
  return {
    id: request.id,
    backend,
    perspective: request.perspective,
    depth: 12,
    nodes: 1_000,
    lines: [
      {
        rank: 1,
        score: { kind: "centipawns", value: 20 },
        moves: ["e2e4"],
      },
    ],
  };
}

describe("browser Stockfish failover", () => {
  it("resets discarded progress before publishing the fallback result", async () => {
    const disposedWasm = vi.fn(async () => undefined);
    const factory = vi.fn(
      (backend: Exclude<EngineBackend, "deterministic">) => {
        const engine: ChessEngine = {
          async analyze(request, _signal, onProgress) {
            if (backend === "stockfish-wasm") {
              onProgress?.({
                ...resultFor(request, backend),
                depth: 6,
                nodes: 200,
              });
              throw new Error("WASM failed after progress");
            }
            return resultFor(request, backend);
          },
          dispose:
            backend === "stockfish-wasm" ? disposedWasm : async () => undefined,
          getStatus: () => ({ backend, availability: "ready" }),
        };
        return engine;
      },
    );
    const engine = createBrowserStockfishEngine(factory);
    const updates: AnalysisProgress[] = [];
    const request: AnalysisRequest = {
      id: "fallback-progress",
      fen: createInitialGame().fen,
      perspective: "white",
      preset: "intermediate",
      multiPv: 1,
      limit: { kind: "time", milliseconds: 700 },
    };

    await expect(
      engine.analyze(request, undefined, (progress) => updates.push(progress)),
    ).resolves.toMatchObject({ backend: "stockfish-asmjs" });

    expect(factory.mock.calls.map(([backend]) => backend)).toEqual([
      "stockfish-wasm",
      "stockfish-asmjs",
    ]);
    expect(disposedWasm).toHaveBeenCalledOnce();
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      backend: "stockfish-wasm",
      depth: 6,
    });
    expect(updates[0]?.reset).toBeUndefined();
    expect(updates[1]).toMatchObject({
      backend: "stockfish-wasm",
      depth: 0,
      lines: [],
      reset: true,
    });
  });
});
