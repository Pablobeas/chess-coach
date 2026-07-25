import { createInitialGame } from "@chess-coach/chess-core";
import type {
  ChessEngine,
  OpponentEngine,
  OpponentRequest,
  UciWorkerBroker,
} from "@chess-coach/engine";
import { describe, expect, it, vi } from "vitest";
import {
  createBrowserOpponentEngine,
  createBrowserStockfishController,
  detectBrowserStockfishRuntimeProfile,
} from "./opponentClient";
import { createBrowserStockfishEngine } from "./engineClient";

const baseRequest: OpponentRequest = {
  id: "opponent-web-1",
  fen: createInitialGame().fen,
  initialFen: createInitialGame().initialFen,
  moves: [],
  selfElo: 600,
  opponentElo: 600,
  temperature: 1,
  multiPv: 2,
};

describe("browser opponent selection", () => {
  it("never calls the Maia bridge on hosted localhost semantics", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const chooseMove = vi.fn(async (request: OpponentRequest) => ({
      id: request.id,
      backend: "stockfish-wasm" as const,
      move: "e2e4",
      candidates: [{ move: "e2e4", probabilityRank: 1 }],
    }));
    const opponent = createBrowserOpponentEngine({
      fetcher,
      mode: "hosted",
      environment: {
        origin: "http://localhost:4173",
        hostname: "localhost",
        deviceMemoryGiB: 4,
        hardwareConcurrency: 8,
      },
      stockfishFactory: () =>
        ({
          ready: vi.fn(async () => undefined),
          prewarm: vi.fn(async () => undefined),
          analyze: vi.fn(),
          chooseMove,
          dispose: async () => undefined,
          getAnalysisStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
          getOpponentStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
        }) as never,
    });

    await expect(opponent.chooseMove(baseRequest)).resolves.toMatchObject({
      backend: "stockfish-wasm",
      move: "e2e4",
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(chooseMove).toHaveBeenCalledOnce();
  });

  it("never calls the Maia bridge on hosted origins", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const chooseMove = vi.fn(async (request: OpponentRequest) => ({
      id: request.id,
      backend: "stockfish-wasm" as const,
      move: "e2e4",
      candidates: [{ move: "e2e4", probabilityRank: 1 }],
    }));
    const dispose = vi.fn(async () => undefined);
    const opponent = createBrowserOpponentEngine({
      fetcher,
      environment: {
        origin: "https://trainer.example",
        hostname: "trainer.example",
        deviceMemoryGiB: 4,
        hardwareConcurrency: 8,
      },
      stockfishFactory: () =>
        ({
          ready: vi.fn(async () => undefined),
          prewarm: vi.fn(async () => undefined),
          analyze: vi.fn(),
          chooseMove,
          dispose,
          getAnalysisStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
          getOpponentStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
        }) as never,
    });

    await expect(opponent.chooseMove(baseRequest)).resolves.toMatchObject({
      backend: "stockfish-wasm",
      move: "e2e4",
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(chooseMove).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("falls back from a failing local Maia bridge to Stockfish on localhost", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const chooseMove = vi.fn(async (request: OpponentRequest) => ({
      id: request.id,
      backend: "stockfish-wasm" as const,
      move: "e2e4",
      candidates: [{ move: "e2e4", probabilityRank: 1 }],
    }));
    const opponent = createBrowserOpponentEngine({
      fetcher,
      mode: "auto",
      environment: {
        origin: "http://127.0.0.1:5173",
        hostname: "127.0.0.1",
        deviceMemoryGiB: 4,
        hardwareConcurrency: 8,
      },
      stockfishFactory: () =>
        ({
          ready: vi.fn(async () => undefined),
          prewarm: vi.fn(async () => undefined),
          analyze: vi.fn(),
          chooseMove,
          dispose: async () => undefined,
          getAnalysisStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
          getOpponentStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
        }) as never,
    });

    await expect(opponent.chooseMove(baseRequest)).resolves.toMatchObject({
      backend: "stockfish-wasm",
      move: "e2e4",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(chooseMove).toHaveBeenCalledOnce();
  });
});

describe("browser stockfish runtime profile", () => {
  it("reduces hash and opponent time on slower devices", () => {
    expect(
      detectBrowserStockfishRuntimeProfile({
        origin: "https://trainer.example",
        hostname: "trainer.example",
        deviceMemoryGiB: 1,
        hardwareConcurrency: 2,
      }),
    ).toEqual({
      deviceClass: "slow",
      hashMegabytes: 16,
      opponentLimit: { kind: "time", milliseconds: 120 },
    });

    expect(
      detectBrowserStockfishRuntimeProfile({
        origin: "https://trainer.example",
        hostname: "trainer.example",
        deviceMemoryGiB: 8,
        hardwareConcurrency: 8,
      }),
    ).toEqual({
      deviceClass: "fast",
      hashMegabytes: 64,
      opponentLimit: { kind: "time", milliseconds: 240 },
    });
  });
});

describe("browser stockfish controller", () => {
  it("recreates an opponent consumer after dispose without breaking analysis", async () => {
    const analyze = vi.fn(async () => ({
      id: "analysis-shared",
      backend: "stockfish-wasm" as const,
      perspective: "white" as const,
      depth: 12,
      nodes: 256,
      lines: [
        {
          rank: 1,
          score: { kind: "centipawns" as const, value: 24 },
          moves: ["e2e4"],
        },
      ],
    }));
    const chooseMove = vi.fn(async (request: OpponentRequest) => ({
      id: request.id,
      backend: "stockfish-wasm" as const,
      move: "e2e4",
      candidates: [{ move: "e2e4", probabilityRank: 1 }],
    }));
    const dispose = vi.fn(async () => undefined);
    const stockfishFactory = vi.fn(
      () =>
        ({
          ready: vi.fn(async () => undefined),
          prewarm: vi.fn(async () => undefined),
          analyze,
          chooseMove,
          dispose,
          getAnalysisStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
          getOpponentStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
        }) as UciWorkerBroker,
    );

    const analysis = createBrowserStockfishEngine({ stockfishFactory });
    const firstOpponent = createBrowserOpponentEngine({
      mode: "hosted",
      stockfishFactory,
    });

    await expect(firstOpponent.chooseMove(baseRequest)).resolves.toMatchObject({
      backend: "stockfish-wasm",
      move: "e2e4",
    });
    await firstOpponent.dispose();

    const retryOpponent = createBrowserOpponentEngine({
      mode: "hosted",
      stockfishFactory,
    });

    await expect(retryOpponent.chooseMove(baseRequest)).resolves.toMatchObject({
      backend: "stockfish-wasm",
      move: "e2e4",
    });
    await expect(
      analysis.analyze({
        id: "analysis-shared",
        fen: createInitialGame().fen,
        perspective: "white",
        multiPv: 1,
        limit: { kind: "nodes", nodes: 100 },
      }),
    ).resolves.toMatchObject({ backend: "stockfish-wasm" });

    expect(stockfishFactory).toHaveBeenCalledTimes(1);
    await analysis.dispose();
    await retryOpponent.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("prewarms once and shares that initialization across callers", async () => {
    const ready = vi.fn(async () => undefined);
    const prewarm = vi.fn(async () => undefined);
    const stockfishFactory = vi.fn(
      () =>
        ({
          ready,
          prewarm,
          analyze: vi.fn(),
          chooseMove: vi.fn(),
          dispose: async () => undefined,
          getAnalysisStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
          getOpponentStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
        }) as UciWorkerBroker,
    );

    const controller = createBrowserStockfishController({
      environment: {
        origin: "https://trainer.example",
        hostname: "trainer.example",
        deviceMemoryGiB: 4,
        hardwareConcurrency: 8,
      },
      stockfishFactory,
    });

    await Promise.all([
      controller.prewarm(),
      controller.prewarm(),
      controller.ready(),
    ]);

    expect(stockfishFactory).toHaveBeenCalledTimes(1);
    expect(prewarm).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(0);
  });

  it("lets a cancelled prewarm waiter exit without cancelling shared bootstrap", async () => {
    let resolvePrewarm: (() => void) | undefined;
    const prewarm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePrewarm = resolve;
        }),
    );
    const stockfishFactory = vi.fn(
      () =>
        ({
          ready: vi.fn(async () => undefined),
          prewarm,
          analyze: vi.fn(),
          chooseMove: vi.fn(),
          dispose: async () => undefined,
          getAnalysisStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
          getOpponentStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
        }) as UciWorkerBroker,
    );
    const controller = createBrowserStockfishController({
      environment: {
        origin: "https://trainer.example",
        hostname: "trainer.example",
        deviceMemoryGiB: 4,
        hardwareConcurrency: 8,
      },
      stockfishFactory,
    });
    const abortController = new AbortController();
    const waiting = controller.prewarm(abortController.signal);

    abortController.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });

    resolvePrewarm?.();
    await expect(controller.prewarm()).resolves.toBeUndefined();
    expect(stockfishFactory).toHaveBeenCalledTimes(1);
    expect(prewarm).toHaveBeenCalledTimes(1);
  });

  it("fails over prewarm from WASM to ASM and keeps the surviving broker active", async () => {
    const wasmDispose = vi.fn(async () => undefined);
    const asmDispose = vi.fn(async () => undefined);
    const asmAnalyze = vi.fn(async () => ({
      id: "analysis-asm",
      backend: "stockfish-asmjs" as const,
      perspective: "white" as const,
      depth: 8,
      nodes: 144,
      lines: [
        {
          rank: 1,
          score: { kind: "centipawns" as const, value: 18 },
          moves: ["e2e4"],
        },
      ],
    }));
    const asmChooseMove = vi.fn(async (request: OpponentRequest) => ({
      id: request.id,
      backend: "stockfish-asmjs" as const,
      move: "e2e4",
      candidates: [{ move: "e2e4", probabilityRank: 1 }],
    }));
    const stockfishFactory = vi.fn(
      (backend: "stockfish-wasm" | "stockfish-asmjs") =>
        backend === "stockfish-wasm"
          ? ({
              ready: vi.fn(async () => {
                throw new Error("WASM bootstrap failed");
              }),
              prewarm: vi.fn(async () => {
                throw new Error("WASM bootstrap failed");
              }),
              analyze: vi.fn(),
              chooseMove: vi.fn(),
              dispose: wasmDispose,
              getAnalysisStatus: () => ({
                backend: "stockfish-wasm",
                availability: "error",
              }),
              getOpponentStatus: () => ({
                backend: "stockfish-wasm",
                availability: "error",
              }),
            } satisfies UciWorkerBroker)
          : ({
              ready: vi.fn(async () => undefined),
              prewarm: vi.fn(async () => undefined),
              analyze: asmAnalyze,
              chooseMove: asmChooseMove,
              dispose: asmDispose,
              getAnalysisStatus: () => ({
                backend: "stockfish-asmjs",
                availability: "ready",
              }),
              getOpponentStatus: () => ({
                backend: "stockfish-asmjs",
                availability: "ready",
              }),
            } satisfies UciWorkerBroker),
    );
    const controller = createBrowserStockfishController({
      environment: {
        origin: "https://trainer.example",
        hostname: "trainer.example",
        deviceMemoryGiB: 4,
        hardwareConcurrency: 8,
      },
      stockfishFactory,
    });

    await expect(controller.prewarm()).resolves.toBeUndefined();
    await expect(
      controller.opponent.chooseMove(baseRequest),
    ).resolves.toMatchObject({ backend: "stockfish-asmjs", move: "e2e4" });
    await expect(
      controller.analysis.analyze({
        id: "analysis-asm",
        fen: createInitialGame().fen,
        perspective: "white",
        multiPv: 1,
        limit: { kind: "nodes", nodes: 100 },
      }),
    ).resolves.toMatchObject({ backend: "stockfish-asmjs" });

    expect(stockfishFactory.mock.calls.map(([backend]) => backend)).toEqual([
      "stockfish-wasm",
      "stockfish-asmjs",
    ]);
    expect(wasmDispose).toHaveBeenCalledTimes(1);
    expect(asmAnalyze).toHaveBeenCalledTimes(1);
    expect(asmChooseMove).toHaveBeenCalledTimes(1);

    await controller.analysis.dispose();
    await controller.opponent.dispose();
    expect(asmDispose).toHaveBeenCalledTimes(1);
  });

  it("shares one broker between analysis and opponent wrappers", async () => {
    const analyze = vi.fn(async () => ({
      id: "analysis-1",
      backend: "stockfish-wasm" as const,
      perspective: "white" as const,
      depth: 10,
      nodes: 100,
      lines: [
        {
          rank: 1,
          score: { kind: "centipawns" as const, value: 24 },
          moves: ["e2e4"],
        },
      ],
    }));
    const chooseMove = vi.fn(async (request: OpponentRequest) => ({
      id: request.id,
      backend: "stockfish-wasm" as const,
      move: "e2e4",
      candidates: [{ move: "e2e4", probabilityRank: 1 }],
    }));
    const dispose = vi.fn(async () => undefined);
    const stockfishFactory = vi.fn(
      () =>
        ({
          ready: vi.fn(async () => undefined),
          prewarm: vi.fn(async () => undefined),
          analyze,
          chooseMove,
          dispose,
          getAnalysisStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
          getOpponentStatus: () => ({
            backend: "stockfish-wasm",
            availability: "ready",
          }),
        }) as never,
    );

    const controller = createBrowserStockfishController({
      environment: {
        origin: "https://trainer.example",
        hostname: "trainer.example",
        deviceMemoryGiB: 8,
        hardwareConcurrency: 8,
      },
      stockfishFactory,
    });

    await expect(
      controller.analysis.analyze({
        id: "analysis-1",
        fen: createInitialGame().fen,
        perspective: "white",
        multiPv: 1,
        limit: { kind: "nodes", nodes: 100 },
      }),
    ).resolves.toMatchObject({ backend: "stockfish-wasm" });
    await expect(
      controller.opponent.chooseMove(baseRequest),
    ).resolves.toMatchObject({ backend: "stockfish-wasm", move: "e2e4" });

    expect(stockfishFactory).toHaveBeenCalledTimes(1);
    expect(chooseMove).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: { kind: "time", milliseconds: 240 },
      }),
      undefined,
    );

    await controller.analysis.dispose();
    await controller.opponent.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
