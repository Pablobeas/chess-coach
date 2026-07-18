import { listLegalMoves, type PlayerColor } from "@chess-coach/chess-core";

export type EngineScore =
  | { readonly kind: "centipawns"; readonly value: number }
  | { readonly kind: "mate"; readonly moves: number };

export interface EngineLine {
  readonly rank: number;
  readonly score: EngineScore;
  readonly moves: readonly string[];
  readonly wdl?: {
    readonly wins: number;
    readonly draws: number;
    readonly losses: number;
  };
}

export type EnginePreset = "beginner" | "intermediate" | "advanced";
export type EngineBackend =
  "stockfish-wasm" | "stockfish-asmjs" | "deterministic";
export type EngineAvailability = "loading" | "ready" | "error" | "disposed";

export interface EngineStatus {
  readonly backend: EngineBackend;
  readonly availability: EngineAvailability;
  readonly message?: string;
}

export interface EnginePresetConfig {
  readonly skillLevel: number;
  readonly movetimeMilliseconds: number;
  readonly multiPv: number;
}

export const ENGINE_PRESETS: Readonly<
  Record<EnginePreset, EnginePresetConfig>
> = Object.freeze({
  beginner: Object.freeze({
    skillLevel: 2,
    movetimeMilliseconds: 250,
    multiPv: 3,
  }),
  intermediate: Object.freeze({
    skillLevel: 10,
    movetimeMilliseconds: 700,
    multiPv: 2,
  }),
  advanced: Object.freeze({
    skillLevel: 20,
    movetimeMilliseconds: 1500,
    multiPv: 3,
  }),
});

export interface AnalysisRequest {
  readonly id: string;
  readonly fen: string;
  readonly perspective: PlayerColor;
  readonly preset?: EnginePreset;
  readonly multiPv: number;
  readonly limit:
    | { readonly kind: "time"; readonly milliseconds: number }
    | { readonly kind: "nodes"; readonly nodes: number };
}

export interface UciWorkerLike {
  postMessage(message: string): void;
  addEventListener(
    type: "message" | "error",
    listener: (event: MessageEvent<unknown> | ErrorEvent) => void,
  ): void;
  removeEventListener(
    type: "message" | "error",
    listener: (event: MessageEvent<unknown> | ErrorEvent) => void,
  ): void;
  terminate(): void;
}

export interface AnalysisResult {
  readonly id: string;
  readonly backend: EngineBackend;
  readonly perspective: PlayerColor;
  readonly depth: number;
  readonly nodes: number;
  readonly lines: readonly EngineLine[];
}

export interface ChessEngine {
  analyze(
    request: AnalysisRequest,
    signal?: AbortSignal,
  ): Promise<AnalysisResult>;
  dispose(): Promise<void>;
  getStatus(): EngineStatus;
}

export class InvalidAnalysisRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAnalysisRequestError";
  }
}

export class EngineUnavailableError extends Error {
  constructor(message = "The chess engine is unavailable") {
    super(message);
    this.name = "EngineUnavailableError";
  }
}

export class EngineBootstrapError extends EngineUnavailableError {
  constructor(message = "The chess engine could not be initialized") {
    super(message);
    this.name = "EngineBootstrapError";
  }
}

const SIMULATED_DEPTH = 1;
const CENTIPAWN_STEP_PER_RANK = 10;
const OPENING_AFTER_E4_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const OPENING_AFTER_E4_RESPONSE = "e7e5";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Analysis was cancelled", "AbortError");
  }
}

function validateRequest(request: AnalysisRequest): void {
  if (request.id.trim().length === 0) {
    throw new InvalidAnalysisRequestError(
      "Analysis request ID must not be empty",
    );
  }

  if (!Number.isInteger(request.multiPv) || request.multiPv < 1) {
    throw new InvalidAnalysisRequestError("multiPv must be a positive integer");
  }

  const budget =
    request.limit.kind === "time"
      ? request.limit.milliseconds
      : request.limit.nodes;

  if (!Number.isInteger(budget) || budget < 1) {
    throw new InvalidAnalysisRequestError(
      "Analysis limit must be a positive integer",
    );
  }
}

function parseUciScore(line: string, perspective: PlayerColor): EngineScore {
  const score = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!score) return { kind: "centipawns", value: 0 };
  const value = Number(score[2]);
  if (score[1] === "mate") return { kind: "mate", moves: value };
  return {
    kind: "centipawns",
    value: perspective === "white" ? value : -value,
  };
}

function parseInfoLine(
  line: string,
  perspective: PlayerColor,
): { depth: number; nodes: number; line: EngineLine } | undefined {
  if (!line.startsWith("info ")) return undefined;
  const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0);
  const nodes = Number(line.match(/\bnodes (\d+)/)?.[1] ?? 0);
  const pv =
    line
      .match(/\bpv (.+)$/)?.[1]
      ?.trim()
      .split(/\s+/) ?? [];
  if (pv.length === 0) return undefined;
  const wdlMatch = line.match(/\bwdl (-?\d+) (-?\d+) (-?\d+)/);
  const wdl = wdlMatch
    ? {
        wins: Number(wdlMatch[1]),
        draws: Number(wdlMatch[2]),
        losses: Number(wdlMatch[3]),
      }
    : undefined;
  return {
    depth,
    nodes,
    line: {
      rank: 1,
      score: parseUciScore(line, perspective),
      moves: pv,
      ...(wdl === undefined ? {} : { wdl }),
    },
  };
}

export function createUciWorkerEngine(
  worker: UciWorkerLike,
  backend: Exclude<EngineBackend, "deterministic"> = "stockfish-wasm",
): ChessEngine {
  let disposed = false;
  let requestGeneration = 0;
  let status: EngineStatus = {
    backend,
    availability: "loading",
  };

  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const bootTimeout = globalThis.setTimeout(() => {
    const error = new EngineBootstrapError("Stockfish UCI handshake timed out");
    status = {
      backend: status.backend,
      availability: "error",
      message: error.message,
    };
    rejectReady(error);
  }, 5000);
  const bootInterval = globalThis.setInterval(
    () => worker.postMessage("uci"),
    2000,
  );
  const onBootMessage = (event: MessageEvent<unknown> | ErrorEvent) => {
    if (!("data" in event)) return;
    if (event.data === "uciok") {
      globalThis.clearTimeout(bootTimeout);
      globalThis.clearInterval(bootInterval);
      worker.removeEventListener("message", onBootMessage);
      worker.removeEventListener("error", onBootError);
      status = { backend: status.backend, availability: "ready" };
      resolveReady();
      return;
    }
    if (
      typeof event.data === "object" &&
      event.data !== null &&
      "type" in event.data &&
      event.data.type === "engine-error"
    ) {
      const message =
        "message" in event.data && typeof event.data.message === "string"
          ? event.data.message
          : "Stockfish worker bootstrap failed";
      const error = new EngineBootstrapError(message);
      globalThis.clearTimeout(bootTimeout);
      globalThis.clearInterval(bootInterval);
      worker.removeEventListener("message", onBootMessage);
      worker.removeEventListener("error", onBootError);
      status = { backend: status.backend, availability: "error", message };
      rejectReady(error);
    }
  };
  const onBootError = (event: ErrorEvent | MessageEvent<unknown>) => {
    const message =
      "message" in event && typeof event.message === "string" && event.message
        ? event.message
        : "Stockfish worker failed to load";
    const error = new EngineBootstrapError(message);
    globalThis.clearTimeout(bootTimeout);
    globalThis.clearInterval(bootInterval);
    worker.removeEventListener("message", onBootMessage);
    status = {
      backend: status.backend,
      availability: "error",
      message,
    };
    rejectReady(error);
  };
  worker.addEventListener("message", onBootMessage);
  worker.addEventListener("error", onBootError);
  globalThis.setTimeout(() => {
    if (status.availability === "loading") worker.postMessage("uci");
  }, 500);

  const analyze = (
    request: AnalysisRequest,
    signal?: AbortSignal,
  ): Promise<AnalysisResult> => {
    validateRequest(request);
    const preset = ENGINE_PRESETS[request.preset ?? "intermediate"];
    const generation = ++requestGeneration;
    return ready.then(
      () =>
        new Promise<AnalysisResult>((resolve, reject) => {
          let latestDepth = 0;
          let latestNodes = 0;
          let timeout: ReturnType<typeof globalThis.setTimeout>;
          const lines: EngineLine[] = [];
          const cleanup = () => {
            globalThis.clearTimeout(timeout);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            signal?.removeEventListener("abort", onAbort);
          };
          const rejectIfCurrent = (error: Error) => {
            cleanup();
            if (generation === requestGeneration) reject(error);
          };
          const onAbort = () => {
            worker.postMessage("stop");
            rejectIfCurrent(
              new DOMException("Analysis was cancelled", "AbortError"),
            );
          };
          const onError = () =>
            rejectIfCurrent(
              new EngineUnavailableError("Stockfish worker failed"),
            );
          const onMessage = (event: MessageEvent<unknown> | ErrorEvent) => {
            if (!("data" in event) || typeof event.data !== "string") return;
            const line = event.data.trim();
            if (line === "uciok") return;
            const parsed = parseInfoLine(line, request.perspective);
            if (parsed) {
              latestDepth = Math.max(latestDepth, parsed.depth);
              latestNodes = Math.max(latestNodes, parsed.nodes);
              lines[parsed.line.rank - 1] = parsed.line;
              return;
            }
            if (!line.startsWith("bestmove ")) return;
            const bestMove = line.split(/\s+/)[1];
            if (!bestMove || generation !== requestGeneration) return;
            const bestLine = lines[0] ?? {
              rank: 1,
              score: { kind: "centipawns" as const, value: 0 },
              moves: [bestMove],
            };
            cleanup();
            resolve({
              id: request.id,
              backend: status.backend,
              perspective: request.perspective,
              depth: latestDepth,
              nodes: latestNodes,
              lines: Object.freeze([
                Object.freeze({
                  ...bestLine,
                  moves: Object.freeze([bestMove, ...bestLine.moves.slice(1)]),
                }),
              ]),
            });
          };
          timeout = globalThis.setTimeout(() => {
            rejectIfCurrent(
              new EngineUnavailableError("Engine analysis timed out"),
            );
          }, 5000);
          if (disposed) {
            reject(
              new EngineUnavailableError("The chess engine has been disposed"),
            );
            return;
          }
          worker.addEventListener("message", onMessage);
          worker.addEventListener("error", onError);
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) return onAbort();
          worker.postMessage("uci");
          worker.postMessage(
            `setoption name Skill Level value ${preset.skillLevel}`,
          );
          worker.postMessage(`setoption name MultiPV value ${request.multiPv}`);
          worker.postMessage(`position fen ${request.fen}`);
          const milliseconds =
            request.limit.kind === "time"
              ? request.limit.milliseconds
              : preset.movetimeMilliseconds;
          worker.postMessage(`go movetime ${milliseconds}`);
        }),
      (error: unknown) => {
        throw error instanceof Error
          ? error
          : new EngineBootstrapError(String(error));
      },
    );
  };

  return {
    analyze,
    async dispose() {
      disposed = true;
      requestGeneration += 1;
      globalThis.clearTimeout(bootTimeout);
      globalThis.clearInterval(bootInterval);
      worker.removeEventListener("message", onBootMessage);
      worker.removeEventListener("error", onBootError);
      status = { backend: status.backend, availability: "disposed" };
      worker.postMessage("quit");
      worker.terminate();
    },
    getStatus() {
      return status;
    },
  };
}

function compareLegalMoves(
  fen: string,
  left: { readonly uci: string },
  right: { readonly uci: string },
): number {
  const preferredMove =
    fen === OPENING_AFTER_E4_FEN ? OPENING_AFTER_E4_RESPONSE : undefined;

  if (left.uci === preferredMove) {
    return -1;
  }

  if (right.uci === preferredMove) {
    return 1;
  }

  if (left.uci < right.uci) {
    return -1;
  }

  return left.uci > right.uci ? 1 : 0;
}

export function createDeterministicEngine(): ChessEngine {
  let disposed = false;

  return {
    async analyze(
      request: AnalysisRequest,
      signal?: AbortSignal,
    ): Promise<AnalysisResult> {
      if (disposed) {
        throw new Error("Engine has been disposed");
      }

      throwIfAborted(signal);
      validateRequest(request);
      const legalMoves = [...listLegalMoves(request.fen)].sort((left, right) =>
        compareLegalMoves(request.fen, left, right),
      );

      await Promise.resolve();
      throwIfAborted(signal);

      return Object.freeze({
        id: request.id,
        backend: "deterministic" as const,
        perspective: request.perspective,
        depth: SIMULATED_DEPTH,
        nodes: legalMoves.length,
        lines: Object.freeze(
          legalMoves.slice(0, request.multiPv).map((move, index) =>
            Object.freeze({
              rank: index + 1,
              score: Object.freeze({
                kind: "centipawns" as const,
                value: index === 0 ? 0 : -index * CENTIPAWN_STEP_PER_RANK,
              }),
              moves: Object.freeze([move.uci]),
            }),
          ),
        ),
      });
    },

    async dispose(): Promise<void> {
      disposed = true;
    },
    getStatus(): EngineStatus {
      return {
        backend: "deterministic",
        availability: disposed ? "disposed" : "ready",
      };
    },
  };
}
