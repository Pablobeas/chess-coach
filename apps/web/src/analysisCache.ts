import type {
  AnalysisProgress,
  AnalysisProgressCallback,
  AnalysisRequest,
  AnalysisResult,
  ChessEngine,
} from "@chess-coach/engine";

const DEFAULT_ANALYSIS_CACHE_CAPACITY = 32;

function analysisKey(request: AnalysisRequest): string {
  const limit =
    request.limit.kind === "time"
      ? `time:${request.limit.milliseconds}`
      : `nodes:${request.limit.nodes}`;
  return [
    request.fen,
    request.perspective,
    request.preset ?? "intermediate",
    request.multiPv,
    limit,
  ].join("\u0000");
}

function waitForSharedResult(
  result: Promise<AnalysisResult>,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  if (signal === undefined) return result;
  if (signal.aborted)
    return Promise.reject(
      new DOMException("Analysis was cancelled", "AbortError"),
    );

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Analysis was cancelled", "AbortError"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    result.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export interface AnalysisCache {
  analyze(
    engine: ChessEngine,
    request: AnalysisRequest,
    signal?: AbortSignal,
    onProgress?: AnalysisProgressCallback,
  ): Promise<AnalysisResult>;
  clear(): void;
}

interface InFlightAnalysis {
  readonly result: Promise<AnalysisResult>;
  readonly controller: AbortController;
  readonly progressListeners: Set<AnalysisProgressCallback>;
  consumers: number;
}

function progressForRequest(
  progress: AnalysisProgress,
  requestId: string,
): AnalysisProgress {
  return progress.id === requestId
    ? progress
    : Object.freeze({ ...progress, id: requestId });
}

export function createAnalysisCache(
  capacity = DEFAULT_ANALYSIS_CACHE_CAPACITY,
): AnalysisCache {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError("Analysis cache capacity must be a positive integer");
  }
  const completed = new Map<string, AnalysisResult>();
  const inFlight = new Map<string, InFlightAnalysis>();
  let generation = 0;

  const remember = (key: string, result: AnalysisResult): void => {
    completed.set(key, result);
    if (completed.size > capacity) {
      const oldest = completed.keys().next().value as string | undefined;
      if (oldest !== undefined) completed.delete(oldest);
    }
  };

  return {
    async analyze(engine, request, signal, onProgress) {
      const key = analysisKey(request);
      const progressListener =
        onProgress === undefined
          ? undefined
          : (progress: AnalysisProgress) =>
              onProgress(progressForRequest(progress, request.id));
      const cached = completed.get(key);
      if (cached !== undefined) {
        completed.delete(key);
        completed.set(key, cached);
        return Object.freeze({ ...cached, id: request.id });
      }

      let pending = inFlight.get(key);
      if (pending === undefined) {
        const startGeneration = generation;
        const controller = new AbortController();
        const progressListeners = new Set<AnalysisProgressCallback>();
        if (progressListener !== undefined)
          progressListeners.add(progressListener);
        const result = engine
          .analyze(request, controller.signal, (progress) => {
            for (const listener of progressListeners) {
              try {
                listener(progress);
              } catch {
                // A visual progress subscriber cannot break the shared search.
              }
            }
          })
          .then((result) => {
            if (generation === startGeneration) remember(key, result);
            return result;
          });
        pending = { result, controller, progressListeners, consumers: 0 };
        inFlight.set(key, pending);
        void result
          .finally(() => {
            if (inFlight.get(key) === pending) inFlight.delete(key);
          })
          .catch(() => undefined);
      }

      if (progressListener !== undefined)
        pending.progressListeners.add(progressListener);
      pending.consumers += 1;
      try {
        const result = await waitForSharedResult(pending.result, signal);
        return result.id === request.id
          ? result
          : Object.freeze({ ...result, id: request.id });
      } finally {
        if (progressListener !== undefined)
          pending.progressListeners.delete(progressListener);
        pending.consumers -= 1;
        if (pending.consumers === 0 && inFlight.get(key) === pending) {
          inFlight.delete(key);
          pending.controller.abort();
        }
      }
    },
    clear() {
      generation += 1;
      completed.clear();
      for (const pending of inFlight.values()) pending.controller.abort();
      inFlight.clear();
    },
  };
}
