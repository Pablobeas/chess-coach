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
export type StockfishBackend = Exclude<EngineBackend, "deterministic">;
export type OpponentBackend =
  StockfishBackend | "maia3-local" | "deterministic";
export type EngineAvailability =
  "loading" | "ready" | "analyzing" | "error" | "disposed";

export interface EngineStatus {
  readonly backend: EngineBackend;
  readonly availability: EngineAvailability;
  readonly message?: string;
}

export interface OpponentStatus {
  readonly backend: OpponentBackend;
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

export type SearchLimit =
  | { readonly kind: "time"; readonly milliseconds: number }
  | { readonly kind: "nodes"; readonly nodes: number };

export interface AnalysisRequest {
  readonly id: string;
  readonly fen: string;
  readonly perspective: PlayerColor;
  readonly preset?: EnginePreset;
  readonly multiPv: number;
  readonly limit: SearchLimit;
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

export interface AnalysisProgress {
  readonly id: string;
  readonly backend: EngineBackend;
  readonly perspective: PlayerColor;
  readonly depth: number;
  readonly nodes: number;
  readonly lines: readonly EngineLine[];
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
  readonly limit?: SearchLimit;
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
  readonly backend: OpponentBackend;
  readonly move: string;
  readonly candidates: readonly OpponentCandidate[];
}

export interface OpponentEngine {
  chooseMove(
    request: OpponentRequest,
    signal?: AbortSignal,
  ): Promise<OpponentResult>;
  dispose(): Promise<void>;
  getStatus(): OpponentStatus;
}

export interface UciWorkerBroker {
  ready(signal?: AbortSignal): Promise<void>;
  prewarm(signal?: AbortSignal): Promise<void>;
  analyze(
    request: AnalysisRequest,
    signal?: AbortSignal,
    onProgress?: AnalysisProgressCallback,
  ): Promise<AnalysisResult>;
  chooseMove(
    request: OpponentRequest,
    signal?: AbortSignal,
  ): Promise<OpponentResult>;
  dispose(): Promise<void>;
  getAnalysisStatus(): EngineStatus;
  getOpponentStatus(): OpponentStatus;
}

export interface UciWorkerBrokerOptions {
  readonly hashMegabytes?: number;
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
const DEFAULT_TRANSPOSITION_TABLE_HASH_MEGABYTES = 64;
const DEFAULT_OPPONENT_MOVE_TIME_MILLISECONDS = 180;
const ANALYSIS_SKILL_LEVEL = 20;
const MINIMUM_UCI_ELO = 1320;
const MAXIMUM_UCI_ELO = 3190;
const OPENING_AFTER_E4_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const OPENING_AFTER_E4_RESPONSE = "e7e5";

interface ParsedInfoLine {
  readonly depth: number;
  readonly nodes: number;
  readonly line: EngineLine;
}

interface BrokerOptionSupport {
  readonly hash: boolean;
  readonly multiPv: boolean;
  readonly skillLevel: boolean;
  readonly showWdl: boolean;
  readonly limitStrength: boolean;
  readonly elo: boolean;
}

interface BrokerOptionState {
  readonly support: BrokerOptionSupport;
  readonly values: Map<string, string>;
}

interface QueueJob<T> {
  readonly priority: number;
  readonly sequence: number;
  readonly signal: AbortSignal | undefined;
  readonly execute: () => Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  readonly detachAbort: () => void;
}

function throwIfAborted(signal: AbortSignal | undefined, label: string): void {
  if (signal?.aborted) {
    throw new DOMException(`${label} was cancelled`, "AbortError");
  }
}

function waitUntilReady(
  ready: Promise<void>,
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> {
  throwIfAborted(signal, label);
  if (signal === undefined) return ready;

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException(`${label} was cancelled`, "AbortError"));
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

function validateAnalysisRequest(request: AnalysisRequest): PlayerColor {
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

function validateOpponentRequest(request: OpponentRequest): void {
  if (request.id.trim().length === 0) {
    throw new InvalidAnalysisRequestError(
      "Opponent request ID must not be empty",
    );
  }
  if (!Number.isInteger(request.multiPv) || request.multiPv < 1) {
    throw new InvalidAnalysisRequestError(
      "Opponent multiPv must be a positive integer",
    );
  }
  if (
    !Number.isFinite(request.selfElo) ||
    !Number.isFinite(request.opponentElo)
  ) {
    throw new InvalidAnalysisRequestError("Opponent Elo values must be finite");
  }
  if (
    request.limit !== undefined &&
    ((request.limit.kind === "time" &&
      (!Number.isInteger(request.limit.milliseconds) ||
        request.limit.milliseconds < 1)) ||
      (request.limit.kind === "nodes" &&
        (!Number.isInteger(request.limit.nodes) || request.limit.nodes < 1)))
  ) {
    throw new InvalidAnalysisRequestError(
      "Opponent limit must be a positive integer",
    );
  }
  loadPosition(request.fen);
  loadPosition(request.initialFen);
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
  const normalized = value * normalizeSign(turn, perspective);
  if (score[1] === "mate") {
    return { kind: "mate", moves: normalized };
  }
  return { kind: "centipawns", value: normalized };
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
): ParsedInfoLine | undefined {
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
  backend: StockfishBackend | "deterministic",
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
    // UI subscribers are outside the engine boundary.
  }
}

function parseOptionName(line: string): string | undefined {
  return line.match(/^option name (.+?) type\b/i)?.[1]?.trim();
}

function createOptionState(): BrokerOptionState {
  return {
    support: {
      hash: false,
      multiPv: false,
      skillLevel: false,
      showWdl: false,
      limitStrength: false,
      elo: false,
    },
    values: new Map<string, string>(),
  };
}

function markSupportedOption(
  state: BrokerOptionState,
  name: string | undefined,
): BrokerOptionState {
  if (name === undefined) return state;
  return {
    support: {
      ...state.support,
      ...(name === "Hash" ? { hash: true } : {}),
      ...(name === "MultiPV" ? { multiPv: true } : {}),
      ...(name === "Skill Level" ? { skillLevel: true } : {}),
      ...(name === "UCI_ShowWDL" ? { showWdl: true } : {}),
      ...(name === "UCI_LimitStrength" ? { limitStrength: true } : {}),
      ...(name === "UCI_Elo" ? { elo: true } : {}),
    },
    values: state.values,
  };
}

function stringifyOptionValue(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function applyOption(
  worker: UciWorkerLike,
  state: BrokerOptionState,
  name: string,
  value: string | number | boolean,
): void {
  const serialized = stringifyOptionValue(value);
  if (state.values.get(name) === serialized) return;
  worker.postMessage(`setoption name ${name} value ${serialized}`);
  state.values.set(name, serialized);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function deriveOpponentSkillLevel(opponentElo: number): number {
  const bounded = clamp(Math.round(opponentElo), 600, 2400);
  return Math.round(((bounded - 600) / (2400 - 600)) * ANALYSIS_SKILL_LEVEL);
}

function compareLegalMoves(
  fen: string,
  left: { readonly uci: string },
  right: { readonly uci: string },
): number {
  const preferredMove =
    fen === OPENING_AFTER_E4_FEN ? OPENING_AFTER_E4_RESPONSE : undefined;

  if (left.uci === preferredMove) return -1;
  if (right.uci === preferredMove) return 1;
  if (left.uci < right.uci) return -1;
  return left.uci > right.uci ? 1 : 0;
}

function freezeOpponentCandidate(
  candidate: OpponentCandidate,
): OpponentCandidate {
  return Object.freeze({
    move: candidate.move,
    probabilityRank: candidate.probabilityRank,
    ...(candidate.wdl === undefined
      ? {}
      : {
          wdl: Object.freeze({
            wins: candidate.wdl.wins,
            draws: candidate.wdl.draws,
            losses: candidate.wdl.losses,
          }),
        }),
  });
}

function normalizeOpponentLimit(limit: SearchLimit | undefined): SearchLimit {
  return (
    limit ?? {
      kind: "time",
      milliseconds: DEFAULT_OPPONENT_MOVE_TIME_MILLISECONDS,
    }
  );
}

function buildAnalysisOptions(
  request: AnalysisRequest,
  state: BrokerOptionState,
): ReadonlyMap<string, string | number | boolean> {
  const entries = new Map<string, string | number | boolean>();
  if (state.support.limitStrength) entries.set("UCI_LimitStrength", false);
  if (state.support.skillLevel)
    entries.set("Skill Level", ANALYSIS_SKILL_LEVEL);
  if (state.support.multiPv) entries.set("MultiPV", request.multiPv);
  if (state.support.showWdl) entries.set("UCI_ShowWDL", true);
  return entries;
}

function buildOpponentOptions(
  request: OpponentRequest,
  state: BrokerOptionState,
): ReadonlyMap<string, string | number | boolean> {
  const entries = new Map<string, string | number | boolean>();
  const skillLevel = deriveOpponentSkillLevel(request.opponentElo);
  if (state.support.limitStrength && state.support.elo) {
    entries.set("UCI_LimitStrength", true);
    entries.set(
      "UCI_Elo",
      clamp(Math.round(request.opponentElo), MINIMUM_UCI_ELO, MAXIMUM_UCI_ELO),
    );
  } else if (state.support.limitStrength) {
    entries.set("UCI_LimitStrength", false);
  }
  if (state.support.skillLevel) entries.set("Skill Level", skillLevel);
  if (state.support.multiPv) entries.set("MultiPV", request.multiPv);
  if (state.support.showWdl) entries.set("UCI_ShowWDL", true);
  return entries;
}

function createDisposedError(): EngineUnavailableError {
  return new EngineUnavailableError("The chess engine has been disposed");
}

export function createUciWorkerBroker(
  worker: UciWorkerLike,
  backend: StockfishBackend = "stockfish-wasm",
  options: UciWorkerBrokerOptions = {},
): UciWorkerBroker {
  let disposed = false;
  let statusAvailability: EngineAvailability = "loading";
  let statusMessage: string | undefined;
  let bootPhase: "uci" | "ready" = "uci";
  let optionState = createOptionState();
  let rejectActiveSearch: ((error: Error) => void) | undefined;
  let postStopReadyBarrier: Promise<void> = Promise.resolve();
  let rejectPostStopReady: ((error: Error) => void) | undefined;
  let queueSequence = 0;
  let pumpActive = false;
  let pumpScheduled = false;
  const pendingJobs: QueueJob<unknown>[] = [];

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const setStatus = (
    availability: EngineAvailability,
    message?: string,
  ): void => {
    statusAvailability = availability;
    statusMessage = message;
  };

  const bootTimeout = globalThis.setTimeout(() => {
    const error = new EngineBootstrapError("Stockfish UCI handshake timed out");
    setStatus("error", error.message);
    rejectReady(error);
  }, 5000);
  const bootInterval = globalThis.setInterval(
    () => worker.postMessage("uci"),
    2000,
  );

  const initializeBootstrapOptions = () => {
    const hashMegabytes =
      options.hashMegabytes ?? DEFAULT_TRANSPOSITION_TABLE_HASH_MEGABYTES;
    if (optionState.support.hash) {
      applyOption(worker, optionState, "Hash", hashMegabytes);
    }
    if (optionState.support.showWdl) {
      applyOption(worker, optionState, "UCI_ShowWDL", true);
    }
  };

  const onBootMessage = (event: MessageEvent<unknown> | ErrorEvent) => {
    if (!("data" in event)) return;
    const data = event.data;
    if (typeof data === "string") {
      const line = data.trim();
      optionState = markSupportedOption(optionState, parseOptionName(line));
      if (line === "uciok" && bootPhase === "uci") {
        bootPhase = "ready";
        globalThis.clearInterval(bootInterval);
        initializeBootstrapOptions();
        worker.postMessage("isready");
        return;
      }
      if (line === "readyok" && bootPhase === "ready") {
        globalThis.clearTimeout(bootTimeout);
        worker.removeEventListener("message", onBootMessage);
        worker.removeEventListener("error", onBootError);
        setStatus("ready");
        resolveReady();
        return;
      }
      return;
    }
    if (
      typeof data === "object" &&
      data !== null &&
      "type" in data &&
      data.type === "engine-error"
    ) {
      const message =
        "message" in data && typeof data.message === "string"
          ? data.message
          : "Stockfish worker bootstrap failed";
      const error = new EngineBootstrapError(message);
      globalThis.clearTimeout(bootTimeout);
      globalThis.clearInterval(bootInterval);
      worker.removeEventListener("message", onBootMessage);
      worker.removeEventListener("error", onBootError);
      setStatus("error", message);
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
    worker.removeEventListener("error", onBootError);
    setStatus("error", message);
    rejectReady(error);
  };

  worker.addEventListener("message", onBootMessage);
  worker.addEventListener("error", onBootError);
  globalThis.setTimeout(() => {
    if (statusAvailability === "loading") worker.postMessage("uci");
  }, 500);

  const drainStoppedSearch = (): void => {
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    let rejectDrain!: (error: Error) => void;
    const drain = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        if (timeout !== undefined) globalThis.clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        if (rejectPostStopReady === rejectDrain) {
          rejectPostStopReady = undefined;
        }
      };
      const resolveDrain = () => {
        cleanup();
        if (!disposed) setStatus("ready");
        resolve();
      };
      rejectDrain = (error: Error) => {
        cleanup();
        if (!disposed) setStatus("error", error.message);
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
    postStopReadyBarrier = drain.catch(() => undefined);
  };

  const applyDesiredOptions = (
    desired: ReadonlyMap<string, string | number | boolean>,
  ) => {
    for (const [name, value] of desired) {
      applyOption(worker, optionState, name, value);
    }
  };

  const runAnalysis = async (
    request: AnalysisRequest,
    signal?: AbortSignal,
    onProgress?: AnalysisProgressCallback,
  ): Promise<AnalysisResult> => {
    const turn = validateAnalysisRequest(request);
    await waitUntilReady(ready, signal, "Analysis");
    await postStopReadyBarrier;
    throwIfAborted(signal, "Analysis");

    return new Promise<AnalysisResult>((resolve, reject) => {
      let timeout: ReturnType<typeof globalThis.setTimeout>;
      let latestDepth = 0;
      let latestNodes = 0;
      let searchStarted = false;
      const linesByRank = new Map<number, ParsedInfoLine>();

      const cleanup = () => {
        globalThis.clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
        if (rejectActiveSearch === rejectSearch) {
          rejectActiveSearch = undefined;
        }
      };
      const rejectSearch = (error: Error) => {
        cleanup();
        reject(error);
      };
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
        if (line === "readyok") {
          if (searchStarted) return;
          applyDesiredOptions(buildAnalysisOptions(request, optionState));
          worker.postMessage(`position fen ${request.fen}`);
          setStatus("analyzing");
          searchStarted = true;
          worker.postMessage(
            request.limit.kind === "time"
              ? `go movetime ${request.limit.milliseconds}`
              : `go nodes ${request.limit.nodes}`,
          );
          return;
        }

        const parsed = parseInfoLine(
          line,
          turn,
          request.perspective,
          request.multiPv,
        );
        if (parsed !== undefined) {
          if (!searchStarted) return;
          latestDepth = Math.max(latestDepth, parsed.depth);
          latestNodes = Math.max(latestNodes, parsed.nodes);
          const current = linesByRank.get(parsed.line.rank);
          if (
            current === undefined ||
            parsed.depth > current.depth ||
            (parsed.depth === current.depth && parsed.nodes >= current.nodes)
          ) {
            linesByRank.set(parsed.line.rank, parsed);
            if (!signal?.aborted && !disposed) {
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

        if (!line.startsWith("bestmove ") || !searchStarted) return;
        const bestMove = line.split(/\s+/)[1];
        if (!bestMove || !isLegalPrincipalVariation(request.fen, [bestMove])) {
          return;
        }
        const bestLine = linesByRank.get(1)?.line;
        if (bestLine === undefined) {
          setStatus("ready");
          rejectSearch(
            new EngineUnavailableError(
              "Engine returned no valid principal variation for its best move",
            ),
          );
          return;
        }
        if (!isLegalPrincipalVariation(request.fen, bestLine.moves)) {
          setStatus("ready");
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
        setStatus("ready");
        resolve({
          id: request.id,
          backend,
          perspective: request.perspective,
          depth: latestDepth,
          nodes: latestNodes,
          lines: Object.freeze([
            freezeEngineLine(bestLine),
            ...additionalLines.map((candidate) => freezeEngineLine(candidate)),
          ]),
        });
      };

      timeout = globalThis.setTimeout(() => {
        interruptSearch(
          new EngineUnavailableError("Engine analysis timed out"),
        );
      }, SEARCH_TIMEOUT_MILLISECONDS);

      if (disposed) {
        reject(createDisposedError());
        return;
      }
      rejectActiveSearch = rejectSearch;
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      worker.postMessage("isready");
    });
  };

  const runOpponent = async (
    request: OpponentRequest,
    signal?: AbortSignal,
  ): Promise<OpponentResult> => {
    validateOpponentRequest(request);
    await waitUntilReady(ready, signal, "Opponent search");
    await postStopReadyBarrier;
    throwIfAborted(signal, "Opponent search");
    const legalMoves = new Set(
      listLegalMoves(request.fen).map((candidate) => candidate.uci),
    );
    const turn = loadPosition(request.fen).turn;
    const limit = normalizeOpponentLimit(request.limit);

    return new Promise<OpponentResult>((resolve, reject) => {
      let timeout: ReturnType<typeof globalThis.setTimeout>;
      let searchStarted = false;
      const linesByRank = new Map<number, ParsedInfoLine>();

      const cleanup = () => {
        globalThis.clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
        if (rejectActiveSearch === rejectSearch) {
          rejectActiveSearch = undefined;
        }
      };
      const rejectSearch = (error: Error) => {
        cleanup();
        reject(error);
      };
      const interruptSearch = (error: Error) => {
        cleanup();
        drainStoppedSearch();
        reject(error);
      };
      const onAbort = () => {
        interruptSearch(
          new DOMException("Opponent search was cancelled", "AbortError"),
        );
      };
      const onError = () =>
        rejectSearch(new EngineUnavailableError("Stockfish worker failed"));
      const onMessage = (event: MessageEvent<unknown> | ErrorEvent) => {
        if (!("data" in event) || typeof event.data !== "string") return;
        const line = event.data.trim();
        if (line === "readyok") {
          if (searchStarted) return;
          applyDesiredOptions(buildOpponentOptions(request, optionState));
          worker.postMessage(`position fen ${request.fen}`);
          setStatus("analyzing");
          searchStarted = true;
          worker.postMessage(
            limit.kind === "time"
              ? `go movetime ${limit.milliseconds}`
              : `go nodes ${limit.nodes}`,
          );
          return;
        }

        const parsed = parseInfoLine(line, turn, turn, request.multiPv);
        if (parsed !== undefined) {
          if (!searchStarted) return;
          const current = linesByRank.get(parsed.line.rank);
          if (
            current === undefined ||
            parsed.depth > current.depth ||
            (parsed.depth === current.depth && parsed.nodes >= current.nodes)
          ) {
            linesByRank.set(parsed.line.rank, parsed);
          }
          return;
        }

        if (!line.startsWith("bestmove ") || !searchStarted) return;
        const bestMove = line.split(/\s+/)[1];
        if (!bestMove || !legalMoves.has(bestMove)) {
          setStatus("ready");
          rejectSearch(
            new EngineUnavailableError(
              `Engine returned an illegal opponent move (${bestMove ?? "none"})`,
            ),
          );
          return;
        }
        const candidates = [...linesByRank.values()]
          .map((entry) => entry.line)
          .filter((candidate) => {
            const firstMove = candidate.moves[0];
            return (
              firstMove !== undefined &&
              legalMoves.has(firstMove) &&
              isLegalPrincipalVariation(request.fen, candidate.moves)
            );
          })
          .sort((left, right) => {
            const leftBest = left.moves[0] === bestMove ? -1 : 0;
            const rightBest = right.moves[0] === bestMove ? -1 : 0;
            if (leftBest !== rightBest) return leftBest - rightBest;
            return left.rank - right.rank;
          })
          .slice(0, request.multiPv)
          .map((candidate, index) =>
            freezeOpponentCandidate({
              move: candidate.moves[0]!,
              probabilityRank: index + 1,
              ...(candidate.wdl === undefined ? {} : { wdl: candidate.wdl }),
            }),
          );
        const normalizedCandidates = candidates.some(
          (candidate) => candidate.move === bestMove,
        )
          ? candidates
          : Object.freeze([
              freezeOpponentCandidate({ move: bestMove, probabilityRank: 1 }),
              ...candidates
                .filter((candidate) => candidate.move !== bestMove)
                .map((candidate, index) =>
                  freezeOpponentCandidate({
                    ...candidate,
                    probabilityRank: index + 2,
                  }),
                ),
            ]);
        cleanup();
        setStatus("ready");
        resolve({
          id: request.id,
          backend,
          move: bestMove,
          candidates: Object.freeze([...normalizedCandidates]),
        });
      };

      timeout = globalThis.setTimeout(() => {
        interruptSearch(
          new EngineUnavailableError("Engine opponent search timed out"),
        );
      }, SEARCH_TIMEOUT_MILLISECONDS);

      if (disposed) {
        reject(createDisposedError());
        return;
      }
      rejectActiveSearch = rejectSearch;
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      worker.postMessage("isready");
    });
  };

  const pumpQueue = async (): Promise<void> => {
    pumpScheduled = false;
    if (pumpActive) return;
    pumpActive = true;
    try {
      while (!disposed) {
        const next = pendingJobs.shift();
        if (next === undefined) break;
        next.detachAbort();
        if (next.signal?.aborted) {
          next.reject(new DOMException("Search was cancelled", "AbortError"));
          continue;
        }
        try {
          const result = await next.execute();
          next.resolve(result);
        } catch (error) {
          next.reject(error);
        }
      }
    } finally {
      pumpActive = false;
      if (!disposed && pendingJobs.length > 0) {
        void pumpQueue();
      }
    }
  };

  const enqueue = <T>(
    priority: number,
    signal: AbortSignal | undefined,
    execute: () => Promise<T>,
    abortLabel: string,
  ): Promise<T> => {
    if (disposed) return Promise.reject(createDisposedError());
    if (signal?.aborted) {
      return Promise.reject(
        new DOMException(`${abortLabel} was cancelled`, "AbortError"),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const sequence = queueSequence++;
      const job: QueueJob<T> = {
        priority,
        sequence,
        signal,
        execute,
        resolve,
        reject,
        detachAbort: () => signal?.removeEventListener("abort", onAbortPending),
      };
      const onAbortPending = () => {
        const index = pendingJobs.indexOf(job as QueueJob<unknown>);
        if (index >= 0) {
          pendingJobs.splice(index, 1);
          reject(new DOMException(`${abortLabel} was cancelled`, "AbortError"));
        }
      };
      signal?.addEventListener("abort", onAbortPending, { once: true });
      pendingJobs.push(job as QueueJob<unknown>);
      pendingJobs.sort((left, right) => {
        if (right.priority !== left.priority)
          return right.priority - left.priority;
        return left.sequence - right.sequence;
      });
      if (!pumpScheduled) {
        pumpScheduled = true;
        queueMicrotask(() => {
          void pumpQueue();
        });
      }
    });
  };

  const getAnalysisStatus = (): EngineStatus => ({
    backend,
    availability: statusAvailability,
    ...(statusMessage === undefined ? {} : { message: statusMessage }),
  });

  const getOpponentStatus = (): OpponentStatus => ({
    backend,
    availability: statusAvailability,
    ...(statusMessage === undefined ? {} : { message: statusMessage }),
  });

  return {
    ready(signal) {
      return waitUntilReady(ready, signal, "Engine ready");
    },
    prewarm(signal) {
      return waitUntilReady(ready, signal, "Engine prewarm");
    },
    analyze(request, signal, onProgress) {
      return enqueue(
        1,
        signal,
        () => runAnalysis(request, signal, onProgress),
        "Analysis",
      );
    },
    chooseMove(request, signal) {
      return enqueue(
        2,
        signal,
        () => runOpponent(request, signal),
        "Opponent search",
      );
    },
    async dispose() {
      disposed = true;
      const disposedError = createDisposedError();
      for (const job of pendingJobs.splice(0)) {
        job.detachAbort();
        job.reject(disposedError);
      }
      rejectReady(disposedError);
      rejectActiveSearch?.(disposedError);
      rejectPostStopReady?.(disposedError);
      globalThis.clearTimeout(bootTimeout);
      globalThis.clearInterval(bootInterval);
      worker.removeEventListener("message", onBootMessage);
      worker.removeEventListener("error", onBootError);
      setStatus("disposed");
      worker.postMessage("quit");
      worker.terminate();
    },
    getAnalysisStatus,
    getOpponentStatus,
  };
}

export function createUciWorkerEngine(
  worker: UciWorkerLike,
  backend: StockfishBackend = "stockfish-wasm",
  options?: UciWorkerBrokerOptions,
): ChessEngine {
  const broker = createUciWorkerBroker(worker, backend, options);
  return {
    // Intentionally omitted from ChessEngine; callers that need prewarm should
    // retain the broker/controller surface instead of the narrowed engine view.
    analyze: broker.analyze,
    dispose: broker.dispose,
    getStatus: broker.getAnalysisStatus,
  };
}

export function createUciWorkerOpponentEngine(
  worker: UciWorkerLike,
  backend: StockfishBackend = "stockfish-wasm",
  options?: UciWorkerBrokerOptions,
): OpponentEngine {
  const broker = createUciWorkerBroker(worker, backend, options);
  return {
    chooseMove: broker.chooseMove,
    dispose: broker.dispose,
    getStatus: broker.getOpponentStatus,
  };
}

export function createDeterministicEngine(): ChessEngine {
  let disposed = false;

  return {
    async analyze(
      request: AnalysisRequest,
      signal?: AbortSignal,
      onProgress?: AnalysisProgressCallback,
    ): Promise<AnalysisResult> {
      if (disposed) throw new Error("Engine has been disposed");

      throwIfAborted(signal, "Analysis");
      validateAnalysisRequest(request);
      const legalMoves = [...listLegalMoves(request.fen)].sort((left, right) =>
        compareLegalMoves(request.fen, left, right),
      );

      await Promise.resolve();
      throwIfAborted(signal, "Analysis");

      const result = Object.freeze({
        id: request.id,
        backend: "deterministic" as const,
        perspective: request.perspective,
        depth: SIMULATED_DEPTH,
        nodes: legalMoves.length,
        lines: Object.freeze(
          legalMoves.slice(0, request.multiPv).map((move, index) =>
            freezeEngineLine({
              rank: index + 1,
              score: {
                kind: "centipawns" as const,
                value: index === 0 ? 0 : -index * CENTIPAWN_STEP_PER_RANK,
              },
              moves: [move.uci],
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
