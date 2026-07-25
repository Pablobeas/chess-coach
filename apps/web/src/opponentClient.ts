import { listLegalMoves } from "@chess-coach/chess-core";
import {
  createUciWorkerBroker,
  EngineUnavailableError,
  type AnalysisProgress,
  type AnalysisResult,
  type ChessEngine,
  type OpponentEngine,
  type OpponentRequest,
  type OpponentResult,
  type OpponentStatus,
  type StockfishBackend,
  type UciWorkerBroker,
  type UciWorkerLike,
} from "@chess-coach/engine";
import { createLocalMaia3Opponent } from "./maia3Client";

const LAUNCHER = "/stockfish/launcher.js";
const WASM_ENGINE = "/stockfish/stockfish-18-lite-single.js";
const WASM = "/stockfish/stockfish-18-lite-single.wasm";

export interface BrowserEngineEnvironment {
  readonly origin: string;
  readonly hostname: string;
  readonly deviceMemoryGiB?: number;
  readonly hardwareConcurrency?: number;
}

export interface BrowserStockfishRuntimeProfile {
  readonly deviceClass: "slow" | "balanced" | "fast";
  readonly hashMegabytes: 16 | 32 | 64;
  readonly opponentLimit: {
    readonly kind: "time";
    readonly milliseconds: 120 | 180 | 240;
  };
}

export interface BrowserStockfishController {
  readonly analysis: ChessEngine;
  readonly opponent: OpponentEngine;
  readonly runtimeProfile: BrowserStockfishRuntimeProfile;
  ready(signal?: AbortSignal): Promise<void>;
  prewarm(signal?: AbortSignal): Promise<void>;
}

export interface BrowserStockfishControllerOptions {
  readonly environment?: BrowserEngineEnvironment;
  readonly stockfishFactory?: (
    backend: StockfishBackend,
    runtimeProfile: BrowserStockfishRuntimeProfile,
  ) => UciWorkerBroker;
}

export type BrowserOpponentMode = "hosted" | "desktop-local" | "auto";

export interface BrowserOpponentEngineOptions extends BrowserStockfishControllerOptions {
  readonly fetcher?: typeof fetch;
  readonly mode?: BrowserOpponentMode;
}

interface BrowserStockfishRuntime {
  readonly runtimeProfile: BrowserStockfishRuntimeProfile;
  analyze(
    request: Parameters<ChessEngine["analyze"]>[0],
    signal?: AbortSignal,
    onProgress?: Parameters<ChessEngine["analyze"]>[2],
  ): Promise<AnalysisResult>;
  chooseMove(
    request: OpponentRequest,
    signal?: AbortSignal,
  ): Promise<OpponentResult>;
  ready(signal?: AbortSignal): Promise<void>;
  prewarm(signal?: AbortSignal): Promise<void>;
  retain(): void;
  release(): Promise<void>;
  getAnalysisStatus(): ReturnType<ChessEngine["getStatus"]>;
  getOpponentStatus(): OpponentStatus;
}

type BrowserStockfishRuntimeFactory = (
  options: BrowserStockfishControllerOptions,
) => BrowserStockfishRuntime;

const DEFAULT_BROWSER_OPPONENT_MODE: BrowserOpponentMode = import.meta.env.PROD
  ? "hosted"
  : "auto";

let sharedRuntime:
  | {
      readonly factory: BrowserStockfishRuntimeFactory;
      readonly options: BrowserStockfishControllerOptions;
      readonly runtime: BrowserStockfishRuntime;
    }
  | undefined;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function createAbortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  message: string,
): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(createAbortError(message));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(createAbortError(message));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]"
  );
}

function readEnvironment(): BrowserEngineEnvironment {
  const browserNavigator =
    (globalThis.navigator as Navigator | undefined as
      (Navigator & { deviceMemory?: number }) | undefined) ?? undefined;
  const locationLike = globalThis.location;
  return {
    origin: locationLike?.origin ?? "http://localhost",
    hostname: locationLike?.hostname ?? "localhost",
    ...(typeof browserNavigator?.deviceMemory === "number"
      ? { deviceMemoryGiB: browserNavigator.deviceMemory }
      : {}),
    ...(typeof browserNavigator?.hardwareConcurrency === "number"
      ? { hardwareConcurrency: browserNavigator.hardwareConcurrency }
      : {}),
  };
}

export function detectBrowserStockfishRuntimeProfile(
  environment: BrowserEngineEnvironment = readEnvironment(),
): BrowserStockfishRuntimeProfile {
  const memory = environment.deviceMemoryGiB ?? 4;
  const concurrency = environment.hardwareConcurrency ?? 4;
  if (memory <= 2 || concurrency <= 2) {
    return Object.freeze({
      deviceClass: "slow" as const,
      hashMegabytes: 16 as const,
      opponentLimit: Object.freeze({
        kind: "time" as const,
        milliseconds: 120 as const,
      }),
    });
  }
  if (memory >= 8 && concurrency >= 8) {
    return Object.freeze({
      deviceClass: "fast" as const,
      hashMegabytes: 64 as const,
      opponentLimit: Object.freeze({
        kind: "time" as const,
        milliseconds: 240 as const,
      }),
    });
  }
  return Object.freeze({
    deviceClass: "balanced" as const,
    hashMegabytes: 32 as const,
    opponentLimit: Object.freeze({
      kind: "time" as const,
      milliseconds: 180 as const,
    }),
  });
}

function createWorker(backend: StockfishBackend): Worker {
  const script = new URL(
    backend === "stockfish-wasm" ? WASM_ENGINE : LAUNCHER,
    window.location.origin,
  );
  if (backend === "stockfish-wasm") {
    const wasm = new URL(WASM, window.location.origin).toString();
    script.hash = encodeURIComponent(wasm);
  } else {
    script.searchParams.set("engine", "asm");
  }
  return new Worker(script.toString(), { type: "classic" });
}

function validateAnalysisResult(
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

function validateOpponentResult(
  requestFen: string,
  result: OpponentResult,
): OpponentResult {
  const legal = new Set(
    listLegalMoves(requestFen).map((candidate) => candidate.uci),
  );
  if (!legal.has(result.move)) {
    throw new EngineUnavailableError(
      `Stockfish returned an illegal opponent move (${result.move}) for FEN ${requestFen}`,
    );
  }
  return result;
}

function createStockfishBroker(
  backend: StockfishBackend,
  runtimeProfile: BrowserStockfishRuntimeProfile,
): UciWorkerBroker {
  const worker: UciWorkerLike = createWorker(backend);
  return createUciWorkerBroker(worker, backend, {
    hashMegabytes: runtimeProfile.hashMegabytes,
  });
}

function createUnavailableMessage(error: unknown): string {
  return error instanceof Error
    ? `No hay un motor local disponible: ${error.message}`
    : "No hay un motor local disponible";
}

function createBrowserStockfishRuntime(
  options: BrowserStockfishControllerOptions = {},
): BrowserStockfishRuntime {
  const environment = options.environment ?? readEnvironment();
  const runtimeProfile = detectBrowserStockfishRuntimeProfile(environment);
  const factory =
    options.stockfishFactory ??
    ((backend: StockfishBackend, profile: BrowserStockfishRuntimeProfile) =>
      createStockfishBroker(backend, profile));
  let activeBroker: UciWorkerBroker | undefined;
  let backend: StockfishBackend = "stockfish-wasm";
  let refCount = 0;
  let prewarmPromise: Promise<void> | undefined;

  const orderedCandidates = (): readonly StockfishBackend[] =>
    backend === "stockfish-asmjs"
      ? ["stockfish-asmjs"]
      : ["stockfish-wasm", "stockfish-asmjs"];

  const ensureBroker = (candidate: StockfishBackend): UciWorkerBroker => {
    if (activeBroker !== undefined && backend === candidate) {
      return activeBroker;
    }
    const broker = factory(candidate, runtimeProfile);
    activeBroker = broker;
    backend = candidate;
    return broker;
  };

  const disposeActiveBroker = async (): Promise<void> => {
    const broker = activeBroker;
    activeBroker = undefined;
    prewarmPromise = undefined;
    if (broker === undefined) return;
    await broker.dispose();
  };

  const runWithFailover = async <T>(
    operationName: string,
    signal: AbortSignal | undefined,
    run: (broker: UciWorkerBroker, candidate: StockfishBackend) => Promise<T>,
  ): Promise<T> => {
    let lastError: unknown;
    for (const candidate of orderedCandidates()) {
      if (signal?.aborted) {
        throw createAbortError(`${operationName} was cancelled`);
      }
      const broker = ensureBroker(candidate);
      try {
        return await run(broker, candidate);
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastError = error;
        await disposeActiveBroker();
      }
    }
    throw new EngineUnavailableError(createUnavailableMessage(lastError));
  };

  return {
    runtimeProfile,
    retain() {
      refCount += 1;
    },
    async release() {
      refCount = Math.max(0, refCount - 1);
      if (refCount === 0) {
        await disposeActiveBroker();
        backend = "stockfish-wasm";
      }
    },
    analyze(request, signal, onProgress) {
      return runWithFailover("Analysis", signal, async (broker, candidate) => {
        let progressSeen = false;
        const forwardProgress = (progress: AnalysisProgress) => {
          progressSeen = true;
          try {
            onProgress?.(progress);
          } catch {
            // UI subscribers must not block failover.
          }
        };
        try {
          const result = await broker.analyze(
            request,
            signal,
            onProgress === undefined ? undefined : forwardProgress,
          );
          return validateAnalysisResult(request.fen, result);
        } catch (error) {
          if (!isAbortError(error) && progressSeen) {
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
          throw error;
        }
      });
    },
    chooseMove(request, signal) {
      const normalizedRequest: OpponentRequest = {
        ...request,
        limit: request.limit ?? runtimeProfile.opponentLimit,
      };
      return runWithFailover("Opponent search", signal, async (broker) => {
        const result = await broker.chooseMove(normalizedRequest, signal);
        return validateOpponentResult(request.fen, result);
      });
    },
    ready(signal) {
      if (prewarmPromise !== undefined) {
        return withAbort(prewarmPromise, signal, "Engine ready was cancelled");
      }
      return runWithFailover("Engine ready", signal, (broker) =>
        broker.ready(signal),
      );
    },
    prewarm(signal) {
      prewarmPromise ??= runWithFailover(
        "Engine prewarm",
        undefined,
        (broker) => broker.prewarm(),
      ).catch((error: unknown) => {
        prewarmPromise = undefined;
        throw error;
      });
      return withAbort(prewarmPromise, signal, "Engine prewarm was cancelled");
    },
    getAnalysisStatus() {
      return (
        activeBroker?.getAnalysisStatus() ?? {
          backend,
          availability: "loading" as const,
        }
      );
    },
    getOpponentStatus() {
      return (
        activeBroker?.getOpponentStatus() ?? {
          backend,
          availability: "loading" as const,
        }
      );
    },
  };
}

function getRuntimeFactory(
  options: BrowserStockfishControllerOptions,
): BrowserStockfishRuntimeFactory {
  return createBrowserStockfishRuntime;
}

function getSharedBrowserStockfishRuntime(
  options: BrowserStockfishControllerOptions = {},
): BrowserStockfishRuntime {
  if (
    sharedRuntime === undefined ||
    sharedRuntime.factory !== getRuntimeFactory(options) ||
    sharedRuntime.options.stockfishFactory !== options.stockfishFactory
  ) {
    sharedRuntime = {
      factory: getRuntimeFactory(options),
      options,
      runtime: createBrowserStockfishRuntime(options),
    };
  }
  return sharedRuntime.runtime;
}

function selectRuntime(
  options: BrowserStockfishControllerOptions = {},
): BrowserStockfishRuntime {
  if (options.environment === undefined) {
    return getSharedBrowserStockfishRuntime(options);
  }
  return createBrowserStockfishRuntime(options);
}

function createAnalysisConsumer(runtime: BrowserStockfishRuntime): ChessEngine {
  runtime.retain();
  let disposed = false;
  let lastBackend = runtime.getAnalysisStatus().backend;

  return {
    analyze(request, signal, onProgress) {
      if (disposed)
        throw new EngineUnavailableError("Engine has been disposed");
      return runtime.analyze(request, signal, onProgress).then((result) => {
        lastBackend = result.backend;
        return result;
      });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await runtime.release();
    },
    getStatus() {
      if (disposed)
        return { backend: lastBackend, availability: "disposed" as const };
      const status = runtime.getAnalysisStatus();
      lastBackend = status.backend;
      return status;
    },
  };
}

function createOpponentConsumer(
  runtime: BrowserStockfishRuntime,
): OpponentEngine {
  runtime.retain();
  let disposed = false;
  let lastBackend = runtime.getOpponentStatus().backend;

  return {
    chooseMove(request, signal) {
      if (disposed)
        throw new EngineUnavailableError("Engine has been disposed");
      return runtime.chooseMove(request, signal).then((result) => {
        lastBackend = result.backend;
        return result;
      });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await runtime.release();
    },
    getStatus() {
      if (disposed)
        return { backend: lastBackend, availability: "disposed" as const };
      const status = runtime.getOpponentStatus();
      lastBackend = status.backend;
      return status;
    },
  };
}

export function createBrowserStockfishController(
  options?: BrowserStockfishControllerOptions,
): BrowserStockfishController {
  const runtime = selectRuntime(options);
  return Object.freeze({
    analysis: createAnalysisConsumer(runtime),
    opponent: createOpponentConsumer(runtime),
    runtimeProfile: runtime.runtimeProfile,
    ready(signal?: AbortSignal) {
      return runtime.ready(signal);
    },
    prewarm(signal?: AbortSignal) {
      return runtime.prewarm(signal);
    },
  });
}

export function getSharedBrowserStockfishController(): BrowserStockfishController {
  const runtime = getSharedBrowserStockfishRuntime();
  let analysis: ChessEngine | undefined;
  let opponent: OpponentEngine | undefined;

  return Object.freeze({
    get analysis() {
      analysis ??= createAnalysisConsumer(runtime);
      return analysis;
    },
    get opponent() {
      opponent ??= createOpponentConsumer(runtime);
      return opponent;
    },
    runtimeProfile: runtime.runtimeProfile,
    ready(signal?: AbortSignal) {
      return runtime.ready(signal);
    },
    prewarm(signal?: AbortSignal) {
      return runtime.prewarm(signal);
    },
  });
}

export function createBrowserStockfishAnalysisEngine(
  options?: BrowserStockfishControllerOptions,
): ChessEngine {
  return createAnalysisConsumer(selectRuntime(options));
}

export function createBrowserOpponentEngine(
  options: BrowserOpponentEngineOptions = {},
): OpponentEngine {
  const mode = options.mode ?? DEFAULT_BROWSER_OPPONENT_MODE;
  const environment = options.environment ?? readEnvironment();
  const stockfish = createOpponentConsumer(selectRuntime(options));
  const shouldUseMaia =
    mode === "desktop-local" ||
    (mode === "auto" &&
      import.meta.env.DEV &&
      isLocalHostname(environment.hostname));
  const maia = shouldUseMaia
    ? createLocalMaia3Opponent(options.fetcher)
    : undefined;
  let disposed = false;

  return {
    async chooseMove(request, signal) {
      if (disposed)
        throw new EngineUnavailableError("Engine has been disposed");
      if (maia !== undefined) {
        try {
          return await maia.chooseMove(request, signal);
        } catch (error) {
          if (isAbortError(error)) throw error;
        }
      }
      return stockfish.chooseMove(request, signal);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await maia?.dispose();
      await stockfish.dispose();
    },
    getStatus() {
      if (disposed) return stockfish.getStatus();
      if (maia !== undefined) {
        const status = maia.getStatus();
        if (status.availability !== "error") return status;
      }
      return stockfish.getStatus();
    },
  };
}
