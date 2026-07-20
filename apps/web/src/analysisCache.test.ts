import { createInitialGame, type PlayerColor } from "@chess-coach/chess-core";
import type {
  AnalysisProgress,
  AnalysisRequest,
  AnalysisResult,
  ChessEngine,
} from "@chess-coach/engine";
import { describe, expect, it, vi } from "vitest";
import { createAnalysisCache } from "./analysisCache";

function fakeResult(request: AnalysisRequest): AnalysisResult {
  return {
    id: request.id,
    backend: "deterministic",
    perspective: request.perspective,
    depth: 1,
    nodes: 1,
    lines: [
      {
        rank: 1,
        score: { kind: "centipawns", value: 0 },
        moves: ["e2e4"],
      },
    ],
  };
}

function request(
  id: string,
  perspective: PlayerColor = "white",
): AnalysisRequest {
  return {
    id,
    fen: createInitialGame().fen,
    perspective,
    preset: "intermediate",
    multiPv: 2,
    limit: { kind: "time", milliseconds: 700 },
  };
}

describe("analysis cache", () => {
  it("reuses a completed analysis for the same position and configuration", async () => {
    const analyze = vi.fn(async (input: AnalysisRequest) => fakeResult(input));
    const engine = { analyze } as unknown as ChessEngine;
    const cache = createAnalysisCache();

    const first = await cache.analyze(engine, request("first"));
    const second = await cache.analyze(engine, request("second"));

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(first.id).toBe("first");
    expect(second.id).toBe("second");
    expect(second.lines).toBe(first.lines);
  });

  it("shares one in-flight analysis with a later request for the same key", async () => {
    let resolveAnalysis: ((value: AnalysisResult) => void) | undefined;
    const analyze = vi.fn(
      (input: AnalysisRequest) =>
        new Promise<AnalysisResult>((resolve) => {
          resolveAnalysis = () => resolve(fakeResult(input));
        }),
    );
    const engine = { analyze } as unknown as ChessEngine;
    const cache = createAnalysisCache();

    const prewarm = cache.analyze(engine, request("prewarm"));
    const turn = cache.analyze(engine, request("turn"));
    expect(analyze).toHaveBeenCalledTimes(1);

    resolveAnalysis?.(fakeResult(request("prewarm")));

    await expect(prewarm).resolves.toMatchObject({ id: "prewarm" });
    await expect(turn).resolves.toMatchObject({ id: "turn" });
  });

  it("fans progress out to active shared consumers with their request IDs", async () => {
    let emitProgress: ((progress: AnalysisProgress) => void) | undefined;
    let resolveAnalysis: ((value: AnalysisResult) => void) | undefined;
    const analyze = vi.fn(
      (
        input: AnalysisRequest,
        _signal?: AbortSignal,
        onProgress?: (progress: AnalysisProgress) => void,
      ) =>
        new Promise<AnalysisResult>((resolve) => {
          emitProgress = onProgress;
          resolveAnalysis = () => resolve(fakeResult(input));
        }),
    );
    const engine = { analyze } as unknown as ChessEngine;
    const cache = createAnalysisCache();
    const firstUpdates: AnalysisProgress[] = [];
    const secondUpdates: AnalysisProgress[] = [];
    const secondController = new AbortController();

    const first = cache.analyze(engine, request("first"), undefined, (update) =>
      firstUpdates.push(update),
    );
    const second = cache.analyze(
      engine,
      request("second"),
      secondController.signal,
      (update) => secondUpdates.push(update),
    );
    emitProgress?.({
      ...fakeResult(request("first")),
      depth: 6,
      nodes: 500,
    });

    expect(firstUpdates.map((update) => update.id)).toEqual(["first"]);
    expect(secondUpdates.map((update) => update.id)).toEqual(["second"]);

    secondController.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    emitProgress?.({
      ...fakeResult(request("first")),
      depth: 7,
      nodes: 700,
    });
    expect(firstUpdates).toHaveLength(2);
    expect(secondUpdates).toHaveLength(1);

    resolveAnalysis?.(fakeResult(request("first")));
    await first;
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("lets a shared caller abort without cancelling a prewarm", async () => {
    let resolveAnalysis: ((value: AnalysisResult) => void) | undefined;
    const analyze = vi.fn(
      (input: AnalysisRequest) =>
        new Promise<AnalysisResult>((resolve) => {
          resolveAnalysis = () => resolve(fakeResult(input));
        }),
    );
    const engine = { analyze } as unknown as ChessEngine;
    const cache = createAnalysisCache();
    const controller = new AbortController();

    const prewarm = cache.analyze(engine, request("prewarm"));
    const turn = cache.analyze(engine, request("turn"), controller.signal);
    controller.abort();

    await expect(turn).rejects.toMatchObject({ name: "AbortError" });
    resolveAnalysis?.(fakeResult(request("prewarm")));
    await prewarm;
    await cache.analyze(engine, request("cached"));
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("keeps a shared search alive when its first caller aborts", async () => {
    let resolveAnalysis: ((value: AnalysisResult) => void) | undefined;
    let engineSignal: AbortSignal | undefined;
    const analyze = vi.fn(
      (input: AnalysisRequest, signal?: AbortSignal) =>
        new Promise<AnalysisResult>((resolve) => {
          engineSignal = signal;
          resolveAnalysis = () => resolve(fakeResult(input));
        }),
    );
    const engine = { analyze } as unknown as ChessEngine;
    const cache = createAnalysisCache();
    const firstController = new AbortController();

    const first = cache.analyze(
      engine,
      request("first-owner"),
      firstController.signal,
    );
    const second = cache.analyze(engine, request("second-consumer"));
    firstController.abort();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(engineSignal?.aborted).toBe(false);
    resolveAnalysis?.(fakeResult(request("first-owner")));
    await expect(second).resolves.toMatchObject({ id: "second-consumer" });
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("cancels the engine search after every consumer leaves", async () => {
    let engineSignal: AbortSignal | undefined;
    const analyze = vi.fn(
      (_input: AnalysisRequest, signal?: AbortSignal) =>
        new Promise<AnalysisResult>((_resolve, reject) => {
          engineSignal = signal;
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    const engine = { analyze } as unknown as ChessEngine;
    const cache = createAnalysisCache();
    const controller = new AbortController();

    const analysis = cache.analyze(
      engine,
      request("only-consumer"),
      controller.signal,
    );
    controller.abort();

    await expect(analysis).rejects.toMatchObject({ name: "AbortError" });
    expect(engineSignal?.aborted).toBe(true);
  });

  it("does not merge analyses with different perspectives or MultiPV", async () => {
    const analyze = vi.fn(async (input: AnalysisRequest) => fakeResult(input));
    const engine = { analyze } as unknown as ChessEngine;
    const cache = createAnalysisCache();

    await cache.analyze(engine, request("white"));
    await cache.analyze(engine, request("black", "black"));
    await cache.analyze(engine, { ...request("single"), multiPv: 1 });

    expect(analyze).toHaveBeenCalledTimes(3);
  });

  it("never caches a rejected or aborted analysis", async () => {
    const analyze = vi
      .fn<(input: AnalysisRequest) => Promise<AnalysisResult>>()
      .mockRejectedValueOnce(new DOMException("cancelled", "AbortError"))
      .mockImplementation(async (input) => fakeResult(input));
    const engine = { analyze } as unknown as ChessEngine;
    const cache = createAnalysisCache();

    await expect(
      cache.analyze(engine, request("aborted")),
    ).rejects.toMatchObject({ name: "AbortError" });
    await cache.analyze(engine, request("retry"));

    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used analysis at its configured capacity", async () => {
    const analyze = vi.fn(async (input: AnalysisRequest) => fakeResult(input));
    const engine = { analyze } as unknown as ChessEngine;
    const cache = createAnalysisCache(1);

    await cache.analyze(engine, request("white"));
    await cache.analyze(engine, request("black", "black"));
    await cache.analyze(engine, request("white-again"));

    expect(analyze).toHaveBeenCalledTimes(3);
  });
});
