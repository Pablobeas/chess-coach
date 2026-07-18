import { listLegalMoves } from "@chess-coach/chess-core";
import {
  createUciWorkerEngine,
  EngineUnavailableError,
  type AnalysisResult,
  type ChessEngine,
  type EngineBackend,
  type EngineStatus,
  type UciWorkerLike,
} from "@chess-coach/engine";

const LAUNCHER = "/stockfish/launcher.js";
const WASM_ENGINE = "/stockfish/stockfish-18-lite-single.js";
const WASM = "/stockfish/stockfish-18-lite-single.wasm";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function createWorker(
  backend: Exclude<EngineBackend, "deterministic">,
): Worker {
  const script = new URL(
    backend === "stockfish-wasm" ? WASM_ENGINE : LAUNCHER,
    window.location.origin,
  );
  if (backend === "stockfish-wasm") {
    const wasm = new URL(WASM, window.location.origin).toString();
    script.hash = `${encodeURIComponent(wasm)},worker`;
  } else {
    script.searchParams.set("engine", "asm");
  }
  return new Worker(script.toString(), { type: "classic" });
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
    throw new EngineUnavailableError("Stockfish returned an illegal move");
  }
  return result;
}

export function createBrowserStockfishEngine(): ChessEngine {
  let active: ChessEngine | undefined;
  let backend: Exclude<EngineBackend, "deterministic"> = "stockfish-wasm";
  let disposed = false;
  let lastError: unknown;

  const start = (
    candidate: Exclude<EngineBackend, "deterministic">,
  ): ChessEngine => {
    const worker: UciWorkerLike = createWorker(candidate);
    return createUciWorkerEngine(worker, candidate);
  };

  const analyze = async (
    request: Parameters<ChessEngine["analyze"]>[0],
    signal?: AbortSignal,
  ): Promise<AnalysisResult> => {
    if (disposed) throw new EngineUnavailableError("Engine has been disposed");
    const candidates: Exclude<EngineBackend, "deterministic">[] = active
      ? [backend]
      : ["stockfish-wasm", "stockfish-asmjs"];

    for (const candidate of candidates) {
      if (signal?.aborted)
        throw new DOMException("Analysis was cancelled", "AbortError");
      const engine = active ?? start(candidate);
      active = engine;
      backend = candidate;
      try {
        const result = await engine.analyze(request, signal);
        return validateResult(request.fen, result);
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastError = error;
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
    getStatus(): EngineStatus {
      if (disposed) return { backend, availability: "disposed" };
      return active?.getStatus() ?? { backend, availability: "loading" };
    },
  };
}
