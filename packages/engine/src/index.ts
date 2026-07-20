import {
  applyMove,
  listLegalMoves,
  loadPosition,
  type PlayerColor,
} from "@chess-coach/chess-core";

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
export type EngineAvailability =
  "loading" | "ready" | "analyzing" | "error" | "disposed";

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

/** A normalized, non-final view of the current UCI search state. */
export interface AnalysisProgress {
  readonly id: string;
  readonly backend: EngineBackend;
  readonly perspective: PlayerColor;
  readonly depth: number;
  readonly nodes: number;
  readonly lines: readonly EngineLine[];
  /** Clears provisional state when a failed backend/search is discarded. */
  readonly reset?: true;
}

export type AnalysisProgressCallback = (progress: AnalysisProgress) => void;

export interface ChessEngine {
  analyze(
    request: AnalysisRequest,
    signal?: AbortSignal,
    onProgress?: AnalysisProgressCallback,
  ): Promise<AnalysisResult>;
  dispose(): Promise<void>;
  getStatus(): EngineStatus;
}

export interface OpponentRequest {
  readonly id: string;
  readonly fen: string;
  readonly initialFen: string;
  readonly moves: readonly string[];
  readonly selfElo: number;
  readonly opponentElo: number;
  readonly temperature: number;
  readonly multiPv: number;
}

export interface OpponentCandidate {
  readonly move: string;
  readonly probabilityRank: number;
  readonly wdl?: {
    readonly wins: number;
    readonly draws: number;
    readonly losses: number;
  };
}

export interface OpponentResult {
  readonly id: string;
  readonly backend: "maia3-local";
  readonly move: string;
  readonly candidates: readonly OpponentCandidate[];
}

export interface OpponentStatus {
  readonly backend: "maia3-local";
  readonly availability: EngineAvailability;
  readonly message?: string;
}

export interface OpponentEngine {
  chooseMove(
    request: OpponentRequest,
    signal?: AbortSignal,
  ): Promise<OpponentResult>;
  dispose(): Promise<void>;
  getStatus(): OpponentStatus;
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
const MAXIMUM_PRINCIPAL_VARIATION_MOVES = 128;
const SEARCH_TIMEOUT_MILLISECONDS = 5000;
const POST_STOP_READY_TIMEOUT_MILLISECONDS = 1000;
// Stockfish recommends allocating as much hash as practical. 64 MB retains
// useful transposition-table entries for the short coach searches without
// competing excessively with the browser/WASM runtime on typical devices.
const DEFAULT_TRANSPOSITION_TABLE_HASH_MEGABYTES = 64;
const OPENING_AFTER_E4_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const OPENING_AFTER_E4_RESPONSE = "e7e5";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Analysis was cancelled", "AbortError");
  }
}

function waitUntilReady(
  ready: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (signal === undefined) return ready;

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Analysis was cancelled", "AbortError"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    ready.then(
      () => {
        cleanup();
        resolve();
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function validateRequest(request: AnalysisRequest): PlayerColor {
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

  return loadPosition(request.fen).turn;
}

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeSign(turn: PlayerColor, perspective: PlayerColor): 1 | -1 {
  return turn === perspective ? 1 : -1;
}

function parseUciScore(
  line: string,
  turn: PlayerColor,
  perspective: PlayerColor,
): EngineScore | undefined {
  const score = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!score) return undefined;
  const value = Number(score[2]);
  if (!Number.isSafeInteger(value)) return undefined;
  const normalizedValue = value * normalizeSign(turn, perspective);
  if (score[1] === "mate") {
    return { kind: "mate", moves: normalizedValue };
  }
  return {
    kind: "centipawns",
    value: normalizedValue,
  };
}

function parseInfoNumber(
  line: string,
  name: "depth" | "nodes" | "multipv",
): number | undefined | null {
  if (!new RegExp(`\\b${name}\\b`).test(line)) return undefined;
  const matches = line.match(new RegExp(`\\b${name} (\\S+)`));
  if (!matches) return null;
  const value = Number(matches[1]);
  return isSafeNonNegativeInteger(value) ? value : null;
}

function parseUciWdl(
  line: string,
  turn: PlayerColor,
  perspective: PlayerColor,
): EngineLine["wdl"] | undefined | null {
  if (!/\bwdl\b/.test(line)) return undefined;
  const match = line.match(/\bwdl (\S+) (\S+) (\S+)/);
  if (!match) return null;
  const wins = Number(match[1]);
  const draws = Number(match[2]);
  const losses = Number(match[3]);
  if (
    !isSafeNonNegativeInteger(wins) ||
    !isSafeNonNegativeInteger(draws) ||
    !isSafeNonNegativeInteger(losses)
  ) {
    return null;
  }
  return normalizeSign(turn, perspective) === 1
    ? { wins, draws, losses }
    : { wins: losses, draws, losses: wins };
}

function parseUciMove(move: string):
  | {
      readonly from: string;
      readonly to: string;
      readonly promotion?: "q" | "r" | "b" | "n";
    }
  | undefined {
  const match = move.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  const from = match?.[1];
  const to = match?.[2];
  const promotion = match?.[3];
  if (from === undefined || to === undefined) return undefined;
  return {
    from,
    to,
    ...(promotion === undefined
      ? {}
      : { promotion: promotion as "q" | "r" | "b" | "n" }),
  };
}

function isSyntacticallyBoundedPrincipalVariation(
  moves: readonly string[],
): boolean {
  if (moves.length > MAXIMUM_PRINCIPAL_VARIATION_MOVES) return false;
  return moves.every((move) => parseUciMove(move) !== undefined);
}

function isLegalPrincipalVariation(
  fen: string,
  moves: readonly string[],
): boolean {
  if (!isSyntacticallyBoundedPrincipalVariation(moves)) return false;
  try {
    let position = loadPosition(fen);
    for (const move of moves) {
      const input = parseUciMove(move);
      if (input === undefined) return false;
      position = applyMove(position, input);
    }
    return true;
  } catch {
    return false;
  }
}

function parseInfoLine(
  line: string,
  turn: PlayerColor,
  perspective: PlayerColor,
  maximumRank: number,
): { depth: number; nodes: number; line: EngineLine } | undefined {
  if (!line.startsWith("info ")) return undefined;
  const parsedDepth = parseInfoNumber(line, "depth");
  const parsedNodes = parseInfoNumber(line, "nodes");
  const parsedRank = parseInfoNumber(line, "multipv");
  if (parsedDepth === null || parsedNodes === null || parsedRank === null) {
    return undefined;
  }
  const depth = parsedDepth ?? 0;
  const nodes = parsedNodes ?? 0;
  const rank = parsedRank ?? 1;
  if (rank < 1 || rank > maximumRank) return undefined;
  const score = parseUciScore(line, turn, perspective);
  if (score === undefined) return undefined;
  const pv =
    line
      .match(/\bpv (.+)$/)?.[1]
      ?.trim()
      .split(/\s+/) ?? [];
  if (pv.length === 0 || !isSyntacticallyBoundedPrincipalVariation(pv)) {
    return undefined;
  }
  const wdl = parseUciWdl(line, turn, perspective);
  if (wdl === null) return undefined;
  return {
    depth,
    nodes,
    line: {
      rank,
      score,
      moves: pv,
      ...(wdl === undefined ? {} : { wdl }),
    },
  };
}

function freezeEngineLine(line: EngineLine): EngineLine {
  const score =
    line.score.kind === "centipawns"
      ? Object.freeze({ kind: "centipawns" as const, value: line.score.value })
      : Object.freeze({ kind: "mate" as const, moves: line.score.moves });
  const wdl =
    line.wdl === undefined
      ? undefined
      : Object.freeze({
          wins: line.wdl.wins,
          draws: line.wdl.draws,
          losses: line.wdl.losses,
        });
  return Object.freeze({
    rank: line.rank,
    score,
    moves: Object.freeze([...line.moves]),
    ...(wdl === undefined ? {} : { wdl }),
  });
}

function createProgressSnapshot(
  request: AnalysisRequest,
  backend: EngineBackend,
  depth: number,
  nodes: number,
  lines: Iterable<EngineLine>,
): AnalysisProgress {
  return Object.freeze({
    id: request.id,
    backend,
    perspective: request.perspective,
    depth,
    nodes,
    lines: Object.freeze(
      [...lines]
        .sort((left, right) => left.rank - right.rank)
        .map((line) => freezeEngineLine(line)),
    ),
  });
}

function notifyProgress(
  callback: AnalysisProgressCallback | undefined,
  snapshot: AnalysisProgress,
): void {
  if (callback === undefined) return;
  try {
    callback(snapshot);
  } catch {
    // Progress consumers are outside the engine boundary and must not disrupt
    // the UCI session or prevent its eventual bestmove from being processed.
  }
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
  let bootPhase: "uci" | "ready" = "uci";
  let searchTail: Promise<void> = Promise.resolve();
  let rejectActiveSearch: ((error: Error) => void) | undefined;
  let postStopReadyBarrier: Promise<void> = Promise.resolve();
  let rejectPostStopReady: ((error: Error) => void) | undefined;

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
    if (event.data === "uciok" && bootPhase === "uci") {
      bootPhase = "ready";
      globalThis.clearInterval(bootInterval);
      worker.postMessage(
        `setoption name Hash value ${DEFAULT_TRANSPOSITION_TABLE_HASH_MEGABYTES}`,
      );
      worker.postMessage("isready");
      return;
    }
    if (event.data === "readyok" && bootPhase === "ready") {
      globalThis.clearTimeout(bootTimeout);
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

  const drainStoppedSearch = () => {
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    let rejectDrain: (error: Error) => void;
    const drain = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        if (timeout !== undefined) globalThis.clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        if (rejectPostStopReady === rejectDrain)
          rejectPostStopReady = undefined;
      };
      const resolveDrain = () => {
        cleanup();
        if (!disposed)
          status = { backend: status.backend, availability: "ready" };
        resolve();
      };
      rejectDrain = (error: Error) => {
        cleanup();
        if (!disposed)
          status = {
            backend: status.backend,
            availability: "error",
            message: error.message,
          };
        reject(error);
      };
      const onMessage = (event: MessageEvent<unknown> | ErrorEvent) => {
        if (!("data" in event) || typeof event.data !== "string") return;
        if (event.data.trim() === "readyok") resolveDrain();
      };
      const onError = () =>
        rejectDrain(
          new EngineUnavailableError(
            "Stockfish did not become ready after a stopped search",
          ),
        );

      rejectPostStopReady = rejectDrain;
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      timeout = globalThis.setTimeout(() => {
        rejectDrain(
          new EngineUnavailableError(
            "Stockfish did not become ready after a stopped search",
          ),
        );
      }, POST_STOP_READY_TIMEOUT_MILLISECONDS);
      worker.postMessage("stop");
      worker.postMessage("isready");
    });
    postStopReadyBarrier = drain;
    void drain.catch(() => undefined);
  };

  const runAnalysis = (
    request: AnalysisRequest,
    signal?: AbortSignal,
    onProgress?: AnalysisProgressCallback,
  ): Promise<AnalysisResult> => {
    const turn = validateRequest(request);
    const preset = ENGINE_PRESETS[request.preset ?? "intermediate"];
    const generation = ++requestGeneration;
    return waitUntilReady(ready, signal).then(
      () =>
        new Promise<AnalysisResult>((resolve, reject) => {
          let latestDepth = 0;
          let latestNodes = 0;
          let readyForSearch = false;
          let searchStarted = false;
          let timeout: ReturnType<typeof globalThis.setTimeout>;
          const linesByRank = new Map<
            number,
            {
              readonly depth: number;
              readonly nodes: number;
              readonly line: EngineLine;
            }
          >();
          const startSearch = () => {
            if (readyForSearch) return;
            readyForSearch = true;
            worker.postMessage(
              `setoption name Skill Level value ${preset.skillLevel}`,
            );
            worker.postMessage(
              `setoption name MultiPV value ${request.multiPv}`,
            );
            worker.postMessage(`position fen ${request.fen}`);
            status = { backend: status.backend, availability: "analyzing" };
            searchStarted = true;
            worker.postMessage(
              request.limit.kind === "time"
                ? `go movetime ${request.limit.milliseconds}`
                : `go nodes ${request.limit.nodes}`,
            );
          };
          let rejectSearch: (error: Error) => void;
          const cleanup = () => {
            globalThis.clearTimeout(timeout);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
            signal?.removeEventListener("abort", onAbort);
            if (rejectActiveSearch === rejectSearch)
              rejectActiveSearch = undefined;
          };
          rejectSearch = (error: Error) => {
            cleanup();
            reject(error);
          };
          rejectActiveSearch = rejectSearch;
          const interruptSearch = (error: Error) => {
            cleanup();
            drainStoppedSearch();
            reject(error);
          };
          const onAbort = () => {
            interruptSearch(
              new DOMException("Analysis was cancelled", "AbortError"),
            );
          };
          const onError = () =>
            rejectSearch(new EngineUnavailableError("Stockfish worker failed"));
          const onMessage = (event: MessageEvent<unknown> | ErrorEvent) => {
            if (!("data" in event) || typeof event.data !== "string") return;
            const line = event.data.trim();
            if (line === "uciok") return;
            if (line === "readyok") {
              startSearch();
              return;
            }
            const parsed = parseInfoLine(
              line,
              turn,
              request.perspective,
              request.multiPv,
            );
            if (parsed) {
              if (!searchStarted) return;
              latestDepth = Math.max(latestDepth, parsed.depth);
              latestNodes = Math.max(latestNodes, parsed.nodes);
              const current = linesByRank.get(parsed.line.rank);
              if (
                current === undefined ||
                parsed.depth > current.depth ||
                (parsed.depth === current.depth &&
                  parsed.nodes >= current.nodes)
              ) {
                linesByRank.set(parsed.line.rank, parsed);
                if (
                  !disposed &&
                  generation === requestGeneration &&
                  !signal?.aborted
                ) {
                  notifyProgress(
                    onProgress,
                    createProgressSnapshot(
                      request,
                      backend,
                      latestDepth,
                      latestNodes,
                      [...linesByRank.values()].map((entry) => entry.line),
                    ),
                  );
                }
              }
              return;
            }
            if (!line.startsWith("bestmove ")) return;
            if (!searchStarted) return;
            const bestMove = line.split(/\s+/)[1];
            if (
              !bestMove ||
              !isLegalPrincipalVariation(request.fen, [bestMove]) ||
              generation !== requestGeneration
            ) {
              return;
            }
            const bestLine = linesByRank.get(1)?.line;
            if (bestLine === undefined) {
              status = { backend: status.backend, availability: "ready" };
              rejectSearch(
                new EngineUnavailableError(
                  "Engine returned no valid principal variation for its best move",
                ),
              );
              return;
            }
            if (!isLegalPrincipalVariation(request.fen, bestLine.moves)) {
              status = { backend: status.backend, availability: "ready" };
              rejectSearch(
                new EngineUnavailableError(
                  "Engine returned an invalid principal variation for rank one",
                ),
              );
              return;
            }
            const additionalLines = [...linesByRank.values()]
              .map((entry) => entry.line)
              .filter((candidate) => candidate.rank !== 1)
              .sort((left, right) => left.rank - right.rank)
              .slice(0, Math.max(0, request.multiPv - 1))
              .filter((candidate) =>
                isLegalPrincipalVariation(request.fen, candidate.moves),
              );
            cleanup();
            status = { backend: status.backend, availability: "ready" };
            resolve({
              id: request.id,
              backend: status.backend,
              perspective: request.perspective,
              depth: latestDepth,
              nodes: latestNodes,
              lines: Object.freeze([
                Object.freeze({
                  ...bestLine,
                  moves: Object.freeze([...bestLine.moves]),
                }),
                ...additionalLines.map((candidate) =>
                  Object.freeze({
                    ...candidate,
                    moves: Object.freeze([...candidate.moves]),
                  }),
                ),
              ]),
            });
          };
          timeout = globalThis.setTimeout(() => {
            interruptSearch(
              new EngineUnavailableError("Engine analysis timed out"),
            );
          }, SEARCH_TIMEOUT_MILLISECONDS);
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
          worker.postMessage("isready");
        }),
      (error: unknown) => {
        throw error instanceof Error
          ? error
          : new EngineBootstrapError(String(error));
      },
    );
  };

  const analyze = (
    request: AnalysisRequest,
    signal?: AbortSignal,
    onProgress?: AnalysisProgressCallback,
  ): Promise<AnalysisResult> => {
    const result = searchTail
      .then(() => postStopReadyBarrier)
      .then(() => runAnalysis(request, signal, onProgress));
    searchTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    analyze,
    async dispose() {
      rejectActiveSearch?.(
        new EngineUnavailableError("The chess engine has been disposed"),
      );
      rejectPostStopReady?.(
        new EngineUnavailableError("The chess engine has been disposed"),
      );
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
      onProgress?: AnalysisProgressCallback,
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

      const result = Object.freeze({
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
      if (!disposed && !signal?.aborted) {
        notifyProgress(
          onProgress,
          createProgressSnapshot(
            request,
            "deterministic",
            result.depth,
            result.nodes,
            result.lines,
          ),
        );
      }
      return result;
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
