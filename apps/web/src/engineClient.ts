import { listLegalMoves } from "@chess-coach/chess-core";
import {
  createDeterministicEngine,
  createUciWorkerEngine,
  type AnalysisResult,
  type ChessEngine,
  EngineUnavailableError,
} from "@chess-coach/engine";

const ENGINE_SCRIPT = "/stockfish/stockfish-18-lite-single.js";
const ENGINE_WASM = "/stockfish/stockfish-18-lite-single.wasm";

export function createBrowserStockfishEngine(): ChessEngine {
  const script = new URL(ENGINE_SCRIPT, window.location.origin);
  const wasm = new URL(ENGINE_WASM, window.location.origin);
  const workerUrl = `${script.toString()}#${wasm.toString()},worker`;
  const worker = new Worker(workerUrl, { type: "classic" });
  const stockfish = createUciWorkerEngine(worker);
  const fallback = createDeterministicEngine();
  return {
    async analyze(request, signal) {
      const fallbackAfterStartup = new Promise<AnalysisResult>(
        (resolve, reject) => {
          const timer = window.setTimeout(() => {
            fallback.analyze(request, signal).then(resolve, reject);
          }, 1500);
          signal?.addEventListener("abort", () => window.clearTimeout(timer), {
            once: true,
          });
        },
      );
      try {
        const result = await Promise.race([
          stockfish.analyze(request, signal),
          fallbackAfterStartup,
        ]);
        const legal = new Set(
          listLegalMoves(request.fen).map((move) => move.uci),
        );
        if (
          !result.lines[0]?.moves[0] ||
          !legal.has(result.lines[0].moves[0])
        ) {
          throw new EngineUnavailableError("Engine returned an illegal move");
        }
        return result;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          throw error;
        return fallback.analyze(request, signal);
      }
    },
    async dispose() {
      await stockfish.dispose();
      await fallback.dispose();
    },
  };
}
