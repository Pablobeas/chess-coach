import { listLegalMoves } from "@chess-coach/chess-core";
import {
  EngineUnavailableError,
  type AnalysisProgress,
  type AnalysisResult,
  type ChessEngine,
  type EngineBackend,
} from "@chess-coach/engine";
import {
  createBrowserStockfishAnalysisEngine,
  type BrowserStockfishControllerOptions,
} from "./opponentClient";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function validateResult(
  requestFen: string,
  result: AnalysisResult,
): AnalysisResult {
  const move = result.lines[0]?.moves[0];
  const legal = new Set(
    listLegalMoves(requestFen).map((candidate) => candidate.uci),
  );
  if (!move || !legal.has(move)) {
    throw new EngineUnavailableError(
      `Stockfish returned an illegal move (${move ?? "none"}) for FEN ${requestFen}`,
    );
  }
  return result;
}

export type BrowserStockfishEngineFactory = (
  backend: Exclude<EngineBackend, "deterministic">,
) => ChessEngine;

function createLegacyBrowserStockfishEngine(
  engineFactory?: BrowserStockfishEngineFactory,
): ChessEngine {
  let active: ChessEngine | undefined;
  let backend: Exclude<EngineBackend, "deterministic"> = "stockfish-wasm";
  let disposed = false;
  let lastError: unknown;

  const analyze = async (
    request: Parameters<ChessEngine["analyze"]>[0],
    signal?: AbortSignal,
    onProgress?: Parameters<ChessEngine["analyze"]>[2],
  ): Promise<AnalysisResult> => {
    if (disposed) throw new EngineUnavailableError("Engine has been disposed");
    if (!engineFactory) {
      throw new EngineUnavailableError(
        "A legacy engine factory is required in this code path",
      );
    }
    const candidates: Exclude<EngineBackend, "deterministic">[] = active
      ? [backend]
      : ["stockfish-wasm", "stockfish-asmjs"];

    for (const candidate of candidates) {
      if (signal?.aborted) {
        throw new DOMException("Analysis was cancelled", "AbortError");
      }
      const engine = active ?? engineFactory(candidate);
      active = engine;
      backend = candidate;
      let progressSeen = false;
      const forwardProgress = (progress: AnalysisProgress) => {
        progressSeen = true;
        try {
          onProgress?.(progress);
        } catch {
          // Visual subscribers cannot break backend failover.
        }
      };
      try {
        const result = await engine.analyze(
          request,
          signal,
          onProgress === undefined ? undefined : forwardProgress,
        );
        return validateResult(request.fen, result);
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastError = error;
        if (progressSeen) {
          try {
            onProgress?.(
              Object.freeze({
                id: request.id,
                backend: candidate,
                perspective: request.perspective,
                depth: 0,
                nodes: 0,
                lines: Object.freeze([]),
                reset: true as const,
              }),
            );
          } catch {
            // Reset delivery is best-effort.
          }
        }
        await engine.dispose();
        active = undefined;
      }
    }

    throw new EngineUnavailableError(
      lastError instanceof Error
        ? `No hay un motor local disponible: ${lastError.message}`
        : "No hay un motor local disponible",
    );
  };

  return {
    analyze,
    async dispose() {
      disposed = true;
      await active?.dispose();
      active = undefined;
    },
    getStatus() {
      if (disposed) return { backend, availability: "disposed" as const };
      return (
        active?.getStatus() ?? { backend, availability: "loading" as const }
      );
    },
  };
}

export function createBrowserStockfishEngine(
  optionsOrFactory?:
    BrowserStockfishControllerOptions | BrowserStockfishEngineFactory,
): ChessEngine {
  if (typeof optionsOrFactory === "function") {
    return createLegacyBrowserStockfishEngine(optionsOrFactory);
  }
  return createBrowserStockfishAnalysisEngine(optionsOrFactory);
}
