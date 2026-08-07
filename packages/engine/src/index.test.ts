import { describe, expect, it, vi } from "vitest";
import {
  createDeterministicEngine,
  createUciWorkerBroker,
  createUciWorkerEngine,
  type AnalysisProgress,
  type OpponentRequest,
  type UciWorkerLike,
} from "./index";

const initialPosition =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const openingAfterE4 =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("deterministic engine", () => {
  it("returns a stable legal line for a valid analysis request", async () => {
    const engine = createDeterministicEngine();

    await expect(
      engine.analyze({
        id: "opening-1",
        fen: initialPosition,
        perspective: "white",
        multiPv: 2,
        limit: { kind: "nodes", nodes: 500 },
      }),
    ).resolves.toEqual({
      id: "opening-1",
      backend: "deterministic",
      perspective: "white",
      depth: 1,
      nodes: 20,
      lines: [
        {
          rank: 1,
          score: { kind: "centipawns", value: 0 },
          moves: ["a2a3"],
        },
        {
          rank: 2,
          score: { kind: "centipawns", value: -10 },
          moves: ["a2a4"],
        },
      ],
    });
  });

  it("honors cancellation before publishing a result", async () => {
    const engine = createDeterministicEngine();
    const controller = new AbortController();
    const analysis = engine.analyze(
      {
        id: "cancelled-1",
        fen: initialPosition,
        perspective: "white",
        multiPv: 1,
        limit: { kind: "time", milliseconds: 10 },
      },
      controller.signal,
    );
    controller.abort();

    await expect(analysis).rejects.toMatchObject({ name: "AbortError" });
  });

  it("prioritizes the e2e4/e7e5 opening fixture deterministically", async () => {
    const engine = createDeterministicEngine();

    await expect(
      engine.analyze({
        id: "opening-e4-e5",
        fen: openingAfterE4,
        perspective: "black",
        multiPv: 2,
        limit: { kind: "nodes", nodes: 500 },
      }),
    ).resolves.toEqual({
      id: "opening-e4-e5",
      backend: "deterministic",
      perspective: "black",
      depth: 1,
      nodes: 20,
      lines: [
        {
          rank: 1,
          score: { kind: "centipawns", value: 0 },
          moves: ["e7e5"],
        },
        {
          rank: 2,
          score: { kind: "centipawns", value: -10 },
          moves: ["a7a5"],
        },
      ],
    });
  });

  it("refuses new work after disposal", async () => {
    const engine = createDeterministicEngine();
    await engine.dispose();

    await expect(
      engine.analyze({
        id: "disposed-1",
        fen: initialPosition,
        perspective: "white",
        multiPv: 1,
        limit: { kind: "time", milliseconds: 10 },
      }),
    ).rejects.toThrow("Engine has been disposed");
  });
});

interface UciSearchResponse {
  readonly info: readonly string[];
  readonly bestmove?: string;
}

class FakeUciWorker implements UciWorkerLike {
  readonly messages: string[] = [];
  protected readonly listeners = {
    message: new Set<(event: MessageEvent<string>) => void>(),
    error: new Set<(event: ErrorEvent) => void>(),
  };

  constructor(
    private readonly searchResponse: UciSearchResponse = {
      info: ["info depth 8 nodes 42 score cp 24 pv e2e4 e7e5"],
      bestmove: "e2e4",
    },
    private readonly options: readonly string[] = [
      "option name Hash type spin default 16 min 1 max 1024",
      "option name MultiPV type spin default 1 min 1 max 500",
      "option name Skill Level type spin default 20 min 0 max 20",
      "option name UCI_ShowWDL type check default false",
      "option name UCI_LimitStrength type check default false",
      "option name UCI_Elo type spin default 1320 min 1320 max 3190",
    ],
  ) {}

  postMessage(message: string): void {
    this.messages.push(message);
    if (message === "uci") {
      queueMicrotask(() => {
        for (const option of this.options) {
          for (const listener of this.listeners.message) {
            listener(new MessageEvent("message", { data: option }));
          }
        }
        for (const listener of this.listeners.message)
          listener(new MessageEvent("message", { data: "uciok" }));
      });
    }
    if (message === "isready") {
      queueMicrotask(() => {
        for (const listener of this.listeners.message)
          listener(new MessageEvent("message", { data: "readyok" }));
      });
    }
    if (message.startsWith("go ")) {
      queueMicrotask(() => {
        for (const info of this.searchResponse.info) {
          for (const listener of this.listeners.message) {
            listener(new MessageEvent("message", { data: info }));
          }
        }
        if (this.searchResponse.bestmove !== undefined) {
          for (const listener of this.listeners.message) {
            listener(
              new MessageEvent("message", {
                data: `bestmove ${this.searchResponse.bestmove}`,
              }),
            );
          }
        }
      });
    }
  }

  addEventListener(type: "message" | "error", listener: never): void {
    this.listeners[type].add(listener as never);
  }

  removeEventListener(type: "message" | "error", listener: never): void {
    this.listeners[type].delete(listener as never);
  }

  listenerCount(type: "message" | "error"): number {
    return this.listeners[type].size;
  }

  protected emit(message: string): void {
    for (const listener of this.listeners.message) {
      listener(new MessageEvent("message", { data: message }));
    }
  }

  terminate(): void {}
}

class FailingUciWorker extends FakeUciWorker {
  override postMessage(message: string): void {
    this.messages.push(message);
    if (message === "uci") {
      queueMicrotask(() => {
        for (const listener of this.listeners.error)
          listener({ message: "WASM unavailable" } as ErrorEvent);
      });
    }
  }
}

class LateBestmoveWorker extends FakeUciWorker {
  private searches = 0;

  override postMessage(message: string): void {
    if (message.startsWith("go ")) {
      this.messages.push(message);
      this.searches += 1;
      if (this.searches === 2) {
        queueMicrotask(() => {
          for (const listener of this.listeners.message) {
            listener(
              new MessageEvent("message", {
                data: "info depth 8 nodes 42 score cp 24 pv e2e4 e7e5",
              }),
            );
          }
          for (const listener of this.listeners.message) {
            listener(new MessageEvent("message", { data: "bestmove e2e4" }));
          }
        });
      }
      return;
    }
    if (message === "stop") {
      this.messages.push(message);
      queueMicrotask(() =>
        queueMicrotask(() =>
          queueMicrotask(() => {
            for (const listener of this.listeners.message) {
              listener(new MessageEvent("message", { data: "bestmove a2a3" }));
            }
          }),
        ),
      );
      return;
    }
    super.postMessage(message);
  }
}

class ControlledUciWorker extends FakeUciWorker {
  override postMessage(message: string): void {
    if (message.startsWith("go ")) {
      this.messages.push(message);
      return;
    }
    super.postMessage(message);
  }

  emit(message: string): void {
    super.emit(message);
  }
}

class DelayedBootWorker extends FakeUciWorker {
  override postMessage(message: string): void {
    this.messages.push(message);
  }

  emitBootReady(): void {
    this.emit("uciok");
    this.emit("readyok");
  }
}

class SlowBootstrapWorker extends FakeUciWorker {
  constructor(
    private readonly uciDelayMs: number,
    private readonly readyDelayMs: number,
  ) {
    super();
  }

  override postMessage(message: string): void {
    this.messages.push(message);
    if (message === "uci") {
      globalThis.setTimeout(() => {
        for (const option of [
          "option name Hash type spin default 16 min 1 max 1024",
          "option name MultiPV type spin default 1 min 1 max 500",
          "option name Skill Level type spin default 20 min 0 max 20",
          "option name UCI_ShowWDL type check default false",
          "option name UCI_LimitStrength type check default false",
          "option name UCI_Elo type spin default 1320 min 1320 max 3190",
        ]) {
          this.emit(option);
        }
        this.emit("uciok");
      }, this.uciDelayMs);
      return;
    }
    if (message === "isready") {
      globalThis.setTimeout(() => this.emit("readyok"), this.readyDelayMs);
      return;
    }
    if (message.startsWith("go ")) {
      queueMicrotask(() => {
        this.emit("info depth 8 nodes 42 score cp 24 pv e2e4 e7e5");
        this.emit("bestmove e2e4");
      });
      return;
    }
  }
}

class DelayedReadyAfterInterruptWorker extends FakeUciWorker {
  private isReadyCount = 0;
  private goCount = 0;

  constructor(
    private readonly delayedReadyMs: number,
    private readonly delayedReadyOrdinal = 4,
  ) {
    super();
  }

  override postMessage(message: string): void {
    if (message.startsWith("go ")) {
      this.messages.push(message);
      this.goCount += 1;
      if (this.goCount === 2) {
        queueMicrotask(() => {
          this.emit("info depth 8 nodes 42 score cp 24 pv e2e4 e7e5");
          this.emit("bestmove e2e4");
        });
      }
      return;
    }
    if (message === "isready") {
      this.messages.push(message);
      this.isReadyCount += 1;
      if (this.isReadyCount === this.delayedReadyOrdinal) {
        globalThis.setTimeout(() => this.emit("readyok"), this.delayedReadyMs);
        return;
      }
      queueMicrotask(() => this.emit("readyok"));
      return;
    }
    super.postMessage(message);
  }
}

class QueuedSearchWorker extends FakeUciWorker {
  readonly goCommands: string[] = [];
  private readonly queue: UciSearchResponse[] = [];

  enqueueSearch(response: UciSearchResponse): void {
    this.queue.push(response);
  }

  override postMessage(message: string): void {
    if (message.startsWith("go ")) {
      this.messages.push(message);
      this.goCommands.push(message);
      return;
    }
    super.postMessage(message);
  }

  finishNext(): void {
    const response = this.queue.shift();
    if (!response) throw new Error("No queued search response");
    for (const info of response.info) {
      this.emit(info);
    }
    if (response.bestmove !== undefined) {
      this.emit(`bestmove ${response.bestmove}`);
    }
  }
}

const defaultOpponentRequest: OpponentRequest = {
  id: "opponent-1",
  fen: initialPosition,
  initialFen: initialPosition,
  moves: [],
  selfElo: 600,
  opponentElo: 600,
  temperature: 1,
  multiPv: 2,
};

describe("UCI worker engine", () => {
  it("prewarms the broker through a single shared initialization", async () => {
    const worker = new FakeUciWorker();
    const broker = createUciWorkerBroker(worker);

    await Promise.all([broker.prewarm(), broker.prewarm(), broker.ready()]);

    expect(worker.messages.filter((message) => message === "uci")).toHaveLength(
      1,
    );
    expect(
      worker.messages.filter(
        (message) => message === "setoption name Hash value 64",
      ),
    ).toHaveLength(1);
    expect(
      worker.messages.filter((message) => message === "isready"),
    ).toHaveLength(1);
  });

  it("lets a cancelled prewarm waiter exit without aborting the shared bootstrap", async () => {
    const worker = new DelayedBootWorker();
    const broker = createUciWorkerBroker(worker);
    const controller = new AbortController();
    const prewarm = broker.prewarm(controller.signal);

    controller.abort();
    await expect(prewarm).rejects.toMatchObject({ name: "AbortError" });

    worker.emitBootReady();
    await expect(broker.ready()).resolves.toBeUndefined();
  });

  it("keeps bootstrap timeout terminal after 15 seconds and ignores late worker readiness", async () => {
    vi.useFakeTimers();
    try {
      const worker = new DelayedBootWorker();
      const broker = createUciWorkerBroker(worker);
      let settled = false;
      const ready = broker.ready();
      const observedReady = ready
        .catch((error: unknown) => error)
        .finally(() => {
          settled = true;
        });

      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(observedReady).resolves.toMatchObject({
        name: "EngineBootstrapError",
        message: "Stockfish UCI handshake timed out",
      });
      expect(broker.getAnalysisStatus()).toEqual({
        backend: "stockfish-wasm",
        availability: "error",
        message: "Stockfish UCI handshake timed out",
      });
      expect(worker.listenerCount("message")).toBe(0);
      expect(worker.listenerCount("error")).toBe(0);

      const uciCountAtTimeout = worker.messages.filter(
        (message) => message === "uci",
      ).length;
      await vi.advanceTimersByTimeAsync(4_000);
      expect(
        worker.messages.filter((message) => message === "uci"),
      ).toHaveLength(uciCountAtTimeout);

      worker.emitBootReady();
      expect(broker.getAnalysisStatus()).toEqual({
        backend: "stockfish-wasm",
        availability: "error",
        message: "Stockfish UCI handshake timed out",
      });
      await broker.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows a slow bootstrap handshake to finish before marking the broker unavailable", async () => {
    vi.useFakeTimers();
    try {
      const worker = new SlowBootstrapWorker(3_000, 3_000);
      const broker = createUciWorkerBroker(worker);
      let settled = false;

      const ready = broker.ready().finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(6_499);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(2);
      await expect(ready).resolves.toBeUndefined();
      expect(
        worker.messages.filter((message) => message === "uci"),
      ).toHaveLength(2);
      expect(
        worker.messages.filter((message) => message === "isready"),
      ).toEqual(["isready"]);
      await broker.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prioritizes a queued opponent search ahead of queued analysis on the same broker", async () => {
    const worker = new QueuedSearchWorker();
    const broker = createUciWorkerBroker(worker);
    worker.enqueueSearch({
      info: ["info depth 6 nodes 30 multipv 1 score cp 12 pv e2e4 e7e5"],
      bestmove: "e2e4",
    });
    worker.enqueueSearch({
      info: ["info depth 8 nodes 80 multipv 1 score cp 24 pv e2e4 e7e5"],
      bestmove: "e2e4",
    });

    const analysis = broker.analyze({
      id: "analysis-after-opponent",
      fen: initialPosition,
      perspective: "white",
      multiPv: 1,
      limit: { kind: "nodes", nodes: 100 },
    });
    const opponent = broker.chooseMove(defaultOpponentRequest);

    await expect.poll(() => worker.goCommands).toEqual(["go movetime 180"]);
    worker.finishNext();
    await expect(opponent).resolves.toMatchObject({
      id: "opponent-1",
      backend: "stockfish-wasm",
      move: "e2e4",
    });

    await expect
      .poll(() => worker.goCommands)
      .toEqual(["go movetime 180", "go nodes 100"]);
    worker.finishNext();
    await expect(analysis).resolves.toMatchObject({
      id: "analysis-after-opponent",
      backend: "stockfish-wasm",
    });
  });

  it("restores full-strength analysis options after a limited opponent search", async () => {
    const worker = new FakeUciWorker();
    const broker = createUciWorkerBroker(worker);

    await expect(
      broker.chooseMove({
        ...defaultOpponentRequest,
        id: "opponent-strength",
        multiPv: 3,
      }),
    ).resolves.toMatchObject({
      id: "opponent-strength",
      backend: "stockfish-wasm",
      move: "e2e4",
    });

    await expect(
      broker.analyze({
        id: "analysis-restored",
        fen: initialPosition,
        perspective: "white",
        preset: "beginner",
        multiPv: 1,
        limit: { kind: "time", milliseconds: 10 },
      }),
    ).resolves.toMatchObject({
      id: "analysis-restored",
      backend: "stockfish-wasm",
    });

    expect(worker.messages).toContain(
      "setoption name UCI_LimitStrength value true",
    );
    expect(worker.messages).toContain("setoption name UCI_Elo value 1320");
    expect(worker.messages).toContain("setoption name MultiPV value 3");
    expect(worker.messages).toContain("go movetime 180");
    expect(worker.messages).toContain(
      "setoption name UCI_LimitStrength value false",
    );
    expect(worker.messages).toContain("setoption name Skill Level value 20");
    expect(worker.messages).toContain("setoption name MultiPV value 1");
  });

  it("rejects opponent requests whose initial FEN and moves do not reproduce the current FEN", async () => {
    const worker = new FakeUciWorker();
    const broker = createUciWorkerBroker(worker);

    await expect(
      broker.chooseMove({
        ...defaultOpponentRequest,
        id: "opponent-invalid-history",
        fen: initialPosition,
        initialFen: initialPosition,
        moves: ["e2e4"],
      }),
    ).rejects.toThrow("does not reproduce");

    expect(worker.messages.filter((message) => message.startsWith("go "))).toEqual(
      [],
    );
  });

  it("cancels an opponent search, drains stop/isready, and starts the next analysis cleanly", async () => {
    const worker = new ControlledUciWorker();
    const broker = createUciWorkerBroker(worker);
    const controller = new AbortController();
    const opponent = broker.chooseMove(
      { ...defaultOpponentRequest, id: "opponent-cancelled" },
      controller.signal,
    );

    await expect
      .poll(() =>
        worker.messages.some((message) => message === "go movetime 180"),
      )
      .toBe(true);
    controller.abort();
    worker.emit("info depth 8 nodes 40 score cp 12 pv e2e4 e7e5");

    await expect(opponent).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.messages).toContain("stop");

    const analysis = broker.analyze({
      id: "analysis-after-opponent-cancel",
      fen: initialPosition,
      perspective: "white",
      multiPv: 1,
      limit: { kind: "nodes", nodes: 75 },
    });
    await expect
      .poll(
        () => worker.messages.filter((message) => message === "isready").length,
      )
      .toBeGreaterThanOrEqual(3);
    worker.emit("readyok");
    worker.emit("info depth 8 nodes 75 score cp 24 pv e2e4 e7e5");
    worker.emit("bestmove e2e4");

    await expect(analysis).resolves.toMatchObject({
      id: "analysis-after-opponent-cancel",
      lines: [{ moves: ["e2e4", "e7e5"] }],
    });
  });

  it("interrupts an active analysis so an opponent search can start promptly on the same broker", async () => {
    const worker = new ControlledUciWorker();
    const broker = createUciWorkerBroker(worker);

    const analysis = broker.analyze({
      id: "analysis-preempted-by-opponent",
      fen: initialPosition,
      perspective: "white",
      multiPv: 1,
      limit: { kind: "nodes", nodes: 200 },
    });

    await expect
      .poll(() =>
        worker.messages.filter((message) => message.startsWith("go ")),
      )
      .toEqual(["go nodes 200"]);

    const opponent = broker.chooseMove({
      ...defaultOpponentRequest,
      id: "opponent-after-active-analysis",
    });

    await expect.poll(() => worker.messages.includes("stop")).toBe(true);
    await expect
      .poll(() =>
        worker.messages.filter((message) => message.startsWith("go ")),
      )
      .toEqual(["go nodes 200", "go movetime 180"]);

    worker.emit("info depth 8 nodes 42 score cp 24 pv e2e4 e7e5");
    worker.emit("bestmove e2e4");

    await expect(analysis).rejects.toMatchObject({ name: "AbortError" });
    await expect(opponent).resolves.toMatchObject({
      id: "opponent-after-active-analysis",
      backend: "stockfish-wasm",
      move: "e2e4",
    });
  });

  it("keeps a preempting opponent search alive while the worker is still becoming ready after an interrupted analysis", async () => {
    vi.useFakeTimers();
    try {
      const worker = new DelayedReadyAfterInterruptWorker(6_000);
      const broker = createUciWorkerBroker(worker);
      const initialReady = broker.ready();
      await vi.advanceTimersByTimeAsync(500);
      await expect(initialReady).resolves.toBeUndefined();
      await broker.ready();

      const analysis = broker.analyze({
        id: "analysis-interrupted-before-readyok",
        fen: initialPosition,
        perspective: "white",
        multiPv: 1,
        limit: { kind: "nodes", nodes: 200 },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(
        worker.messages.filter((message) => message.startsWith("go ")),
      ).toEqual(["go nodes 200"]);

      let opponentSettled = false;
      const opponent = broker
        .chooseMove({
          ...defaultOpponentRequest,
          id: "opponent-delayed-ready-after-interrupt",
        })
        .finally(() => {
          opponentSettled = true;
        });

      await expect(analysis).rejects.toMatchObject({ name: "AbortError" });

      await vi.advanceTimersByTimeAsync(5_999);
      expect(opponentSettled).toBe(false);

      await vi.advanceTimersByTimeAsync(2);
      await expect(opponent).resolves.toMatchObject({
        id: "opponent-delayed-ready-after-interrupt",
        backend: "stockfish-wasm",
        move: "e2e4",
      });
      await broker.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("completes a retry coach pair after an opponent preempts the first analysis", async () => {
    const worker = new ControlledUciWorker();
    const broker = createUciWorkerBroker(worker);
    await broker.ready();

    const firstCoach = broker.analyze({
      id: "coach-initial-after-user-move",
      fen: initialPosition,
      perspective: "white",
      multiPv: 2,
      limit: { kind: "time", milliseconds: 700 },
    });

    await expect
      .poll(() =>
        worker.messages.filter((message) => message.startsWith("go ")),
      )
      .toEqual(["go movetime 700"]);

    const opponent = broker.chooseMove({
      ...defaultOpponentRequest,
      id: "opponent-after-e4",
      fen: openingAfterE4,
      initialFen: initialPosition,
      moves: ["e2e4"],
    });

    await expect.poll(() => worker.messages.includes("stop")).toBe(true);
    await expect
      .poll(() =>
        worker.messages.filter((message) => message.startsWith("go ")),
      )
      .toEqual(["go movetime 700", "go movetime 180"]);

    worker.emit("info depth 10 nodes 600 multipv 1 score cp -57 pv c7c5 g1f3");
    worker.emit("info depth 10 nodes 600 multipv 2 score cp -40 pv e7e5 g1f3");
    worker.emit("bestmove c7c5");

    await expect(firstCoach).rejects.toMatchObject({ name: "AbortError" });
    await expect(opponent).resolves.toMatchObject({
      id: "opponent-after-e4",
      move: "c7c5",
      backend: "stockfish-wasm",
    });

    const retryBefore = broker.analyze({
      id: "coach-retry-before",
      fen: initialPosition,
      perspective: "white",
      multiPv: 2,
      limit: { kind: "time", milliseconds: 700 },
    });
    const retryAfter = broker.analyze({
      id: "coach-retry-after",
      fen: openingAfterE4,
      perspective: "white",
      multiPv: 1,
      limit: { kind: "time", milliseconds: 700 },
    });

    await expect
      .poll(() =>
        worker.messages.filter((message) => message.startsWith("go ")),
      )
      .toEqual(["go movetime 700", "go movetime 180", "go movetime 700"]);

    worker.emit("info depth 12 nodes 1200 multipv 1 score cp 36 pv e2e4 e7e5");
    worker.emit("info depth 12 nodes 1200 multipv 2 score cp 24 pv d2d4 d7d5");
    worker.emit("bestmove e2e4");

    await expect
      .poll(() =>
        worker.messages.filter((message) => message.startsWith("go ")),
      )
      .toEqual([
        "go movetime 700",
        "go movetime 180",
        "go movetime 700",
        "go movetime 700",
      ]);

    worker.emit("info depth 11 nodes 900 multipv 1 score cp -32 pv e7e5 g1f3");
    worker.emit("bestmove e7e5");

    await expect(retryBefore).resolves.toMatchObject({
      id: "coach-retry-before",
      lines: [
        { rank: 1, moves: ["e2e4", "e7e5"] },
        { rank: 2, moves: ["d2d4", "d7d5"] },
      ],
    });
    await expect(retryAfter).resolves.toMatchObject({
      id: "coach-retry-after",
      lines: [{ rank: 1, moves: ["e7e5", "g1f3"] }],
    });
  });

  it("publishes normalized progress snapshots before the final result without a second search", async () => {
    const worker = new FakeUciWorker({
      info: [
        "info depth 9 nodes 90 multipv 2 score cp 34 wdl 650 200 150 pv d7d5 g1f3",
        "info depth 10 nodes 100 multipv 1 score mate 3 wdl 700 200 100 pv e7e5 g1f3",
      ],
      bestmove: "e7e5",
    });
    const engine = createUciWorkerEngine(worker);
    const updates: AnalysisProgress[] = [];
    const order: string[] = [];

    const analysis = engine.analyze(
      {
        id: "uci-progress",
        fen: openingAfterE4,
        perspective: "white",
        multiPv: 2,
        limit: { kind: "nodes", nodes: 321 },
      },
      undefined,
      (progress) => {
        updates.push(progress);
        order.push("progress");
      },
    );
    const result = await analysis;
    order.push("result");

    expect(order).toEqual(["progress", "progress", "result"]);
    expect(updates[0]).toMatchObject({
      id: "uci-progress",
      perspective: "white",
      depth: 9,
      nodes: 90,
      lines: [
        {
          rank: 2,
          score: { kind: "centipawns", value: -34 },
          wdl: { wins: 150, draws: 200, losses: 650 },
        },
      ],
    });
    expect(updates[1]).toMatchObject({
      depth: 10,
      nodes: 100,
      lines: [
        {
          rank: 1,
          score: { kind: "mate", moves: -3 },
          wdl: { wins: 100, draws: 200, losses: 700 },
        },
        { rank: 2 },
      ],
    });
    expect(result.lines.map((line) => line.rank)).toEqual([1, 2]);
    expect(
      worker.messages.filter((message) => message.startsWith("go ")),
    ).toEqual(["go nodes 321"]);
  });

  it("does not publish progress received after aborting an active search", async () => {
    const worker = new ControlledUciWorker();
    const engine = createUciWorkerEngine(worker);
    const controller = new AbortController();
    const onProgress = vi.fn();
    const analysis = engine.analyze(
      {
        id: "uci-progress-aborted",
        fen: initialPosition,
        perspective: "white",
        multiPv: 1,
        limit: { kind: "time", milliseconds: 10 },
      },
      controller.signal,
      onProgress,
    );

    await expect
      .poll(() => worker.messages.some((message) => message.startsWith("go ")))
      .toBe(true);
    controller.abort();
    worker.emit("info depth 8 nodes 42 score cp 24 pv e2e4 e7e5");

    await expect(analysis).rejects.toMatchObject({ name: "AbortError" });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("does not publish progress received after the final result", async () => {
    const worker = new ControlledUciWorker();
    const engine = createUciWorkerEngine(worker);
    const onProgress = vi.fn();
    const analysis = engine.analyze(
      {
        id: "uci-progress-final",
        fen: initialPosition,
        perspective: "white",
        multiPv: 1,
        limit: { kind: "nodes", nodes: 100 },
      },
      undefined,
      onProgress,
    );

    await expect
      .poll(() => worker.messages.some((message) => message.startsWith("go ")))
      .toBe(true);
    worker.emit("info depth 8 nodes 42 score cp 24 pv e2e4 e7e5");
    worker.emit("bestmove e2e4");
    await expect(analysis).resolves.toMatchObject({ id: "uci-progress-final" });

    worker.emit("info depth 9 nodes 100 score cp 30 pv e2e4 e7e5");
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it("translates a worker response into a typed legal line", async () => {
    const worker = new FakeUciWorker();
    const engine = createUciWorkerEngine(worker);
    const result = await engine.analyze({
      id: "uci-1",
      fen: initialPosition,
      perspective: "white",
      preset: "beginner",
      multiPv: 1,
      limit: { kind: "time", milliseconds: 10 },
    });

    expect(result.lines[0]).toMatchObject({
      moves: ["e2e4", "e7e5"],
      score: { kind: "centipawns", value: 24 },
    });
    expect(result.backend).toBe("stockfish-wasm");
    expect(worker.messages).toContain("isready");
    expect(worker.messages).toContain(`position fen ${initialPosition}`);
    expect(worker.messages).toContain("setoption name Skill Level value 20");
  });

  it("configures the transposition-table hash once during bootstrap", async () => {
    const worker = new FakeUciWorker();
    const engine = createUciWorkerEngine(worker);
    const first = engine.analyze({
      id: "hash-first",
      fen: initialPosition,
      perspective: "white",
      multiPv: 1,
      limit: { kind: "time", milliseconds: 10 },
    });
    const second = engine.analyze({
      id: "hash-second",
      fen: initialPosition,
      perspective: "white",
      multiPv: 2,
      limit: { kind: "nodes", nodes: 321 },
    });

    await Promise.all([first, second]);

    const hash = "setoption name Hash value 64";
    expect(worker.messages.filter((message) => message === hash)).toEqual([
      hash,
    ]);
    expect(worker.messages.indexOf(hash)).toBeGreaterThan(
      worker.messages.indexOf("uci"),
    );
    expect(worker.messages.indexOf(hash)).toBeLessThan(
      worker.messages.indexOf("isready"),
    );
    expect(worker.messages.indexOf(hash)).toBeLessThan(
      worker.messages.indexOf("go movetime 10"),
    );
    expect(
      worker.messages.filter((message) => message.startsWith("go ")),
    ).toEqual(["go movetime 10", "go nodes 321"]);
  });

  it("surfaces a bootstrap failure instead of simulating a result", async () => {
    const engine = createUciWorkerEngine(
      new FailingUciWorker(),
      "stockfish-wasm",
    );

    await expect(
      engine.analyze({
        id: "uci-bootstrap-error",
        fen: initialPosition,
        perspective: "white",
        preset: "beginner",
        multiPv: 1,
        limit: { kind: "time", milliseconds: 10 },
      }),
    ).rejects.toThrow("WASM unavailable");
  });

  it("normalizes scores and WDL from the FEN turn to the requested perspective", async () => {
    const worker = new FakeUciWorker({
      info: [
        "info depth 12 nodes 144 multipv 2 score cp 34 wdl 650 200 150 pv d7d5 g1f3",
        "info depth 12 nodes 144 multipv 1 score mate 3 wdl 700 200 100 pv e7e5 g1f3",
        "info depth 12 nodes 144 multipv 3 score cp 20 wdl 500 300 200 pv c7c5 g1f3",
      ],
      bestmove: "e7e5",
    });
    const engine = createUciWorkerEngine(worker);

    await expect(
      engine.analyze({
        id: "uci-normalized-multipv",
        fen: openingAfterE4,
        perspective: "white",
        multiPv: 2,
        limit: { kind: "time", milliseconds: 10 },
      }),
    ).resolves.toMatchObject({
      lines: [
        {
          rank: 1,
          score: { kind: "mate", moves: -3 },
          moves: ["e7e5", "g1f3"],
          wdl: { wins: 100, draws: 200, losses: 700 },
        },
        {
          rank: 2,
          score: { kind: "centipawns", value: -34 },
          moves: ["d7d5", "g1f3"],
          wdl: { wins: 150, draws: 200, losses: 650 },
        },
      ],
    });
  });

  it("drops invalid principal variations when a valid update for the rank follows", async () => {
    const worker = new FakeUciWorker({
      info: [
        "info depth 10 nodes 100 multipv 1 score cp 10 pv e2e4",
        "info depth 10 nodes 101 multipv 1 score cp 12 pv e7e5 g1f3",
        "info depth 10 nodes 100 multipv 2 score cp 5 pv d7d5 g1f3",
      ],
      bestmove: "e7e5",
    });
    const engine = createUciWorkerEngine(worker);

    await expect(
      engine.analyze({
        id: "uci-invalid-pv",
        fen: openingAfterE4,
        perspective: "black",
        multiPv: 2,
        limit: { kind: "time", milliseconds: 10 },
      }),
    ).resolves.toMatchObject({
      lines: [
        { rank: 1, moves: ["e7e5", "g1f3"] },
        { rank: 2, moves: ["d7d5", "g1f3"] },
      ],
    });
  });

  it("ignores oversized UCI info lines before accepting a later valid update", async () => {
    const oversizedPv = `info depth 10 nodes 100 multipv 1 score cp 10 pv ${"e2e4 ".repeat(400)}`;
    const worker = new FakeUciWorker({
      info: [
        oversizedPv,
        "info depth 10 nodes 101 multipv 1 score cp 12 pv e7e5 g1f3",
      ],
      bestmove: "e7e5",
    });
    const engine = createUciWorkerEngine(worker);

    await expect(
      engine.analyze({
        id: "uci-oversized-info-line",
        fen: openingAfterE4,
        perspective: "black",
        multiPv: 1,
        limit: { kind: "time", milliseconds: 10 },
      }),
    ).resolves.toMatchObject({
      lines: [{ rank: 1, moves: ["e7e5", "g1f3"] }],
    });
  });

  it("rejects a best move that has no valid scored principal variation", async () => {
    const engine = createUciWorkerEngine(
      new FakeUciWorker({
        info: ["info depth 10 nodes 100 multipv 1 score cp 10 pv e2e9"],
        bestmove: "e7e5",
      }),
    );

    await expect(
      engine.analyze({
        id: "uci-invalid-only-pv",
        fen: openingAfterE4,
        perspective: "black",
        multiPv: 1,
        limit: { kind: "time", milliseconds: 10 },
      }),
    ).rejects.toThrow("no valid principal variation");
  });

  it("validates the final rank-one principal variation before publishing it", async () => {
    const worker = new FakeUciWorker({
      info: ["info depth 10 nodes 100 multipv 1 score cp 10 pv e2e4 e7e5"],
      bestmove: "e7e5",
    });
    const engine = createUciWorkerEngine(worker);

    await expect(
      engine.analyze({
        id: "uci-illegal-final-pv",
        fen: openingAfterE4,
        perspective: "black",
        multiPv: 1,
        limit: { kind: "time", milliseconds: 10 },
      }),
    ).rejects.toThrow("invalid principal variation for rank one");
  });

  it("publishes only legal principal variations selected at bestmove", async () => {
    const worker = new FakeUciWorker({
      info: [
        "info depth 10 nodes 100 multipv 1 score cp 24 pv e7e5 g1f3",
        "info depth 10 nodes 100 multipv 2 score cp 10 pv e2e4 e7e5",
      ],
      bestmove: "e7e5",
    });
    const engine = createUciWorkerEngine(worker);

    await expect(
      engine.analyze({
        id: "uci-final-legal-pv",
        fen: openingAfterE4,
        perspective: "black",
        multiPv: 2,
        limit: { kind: "time", milliseconds: 10 },
      }),
    ).resolves.toMatchObject({
      lines: [{ rank: 1, moves: ["e7e5", "g1f3"] }],
    });
  });

  it("keeps the objective rank-one PV when a legal skill-limited bestmove differs", async () => {
    const worker = new FakeUciWorker({
      info: [
        "info depth 10 nodes 100 multipv 1 score cp 24 pv e7e5 g1f3",
        "info depth 10 nodes 100 multipv 2 score cp 18 pv d7d5 g1f3",
      ],
      bestmove: "d7d5",
    });
    const engine = createUciWorkerEngine(worker);

    const result = await engine.analyze({
      id: "skill-limited-bestmove",
      fen: openingAfterE4,
      perspective: "black",
      multiPv: 2,
      limit: { kind: "time", milliseconds: 10 },
    });

    expect(result.lines[0]).toMatchObject({
      rank: 1,
      moves: ["e7e5", "g1f3"],
    });
  });

  it("serializes searches and sends node budgets as UCI node limits", async () => {
    const worker = new FakeUciWorker();
    const engine = createUciWorkerEngine(worker);
    const first = engine.analyze({
      id: "nodes-1",
      fen: initialPosition,
      perspective: "white",
      multiPv: 1,
      limit: { kind: "nodes", nodes: 321 },
    });
    const second = engine.analyze({
      id: "nodes-2",
      fen: initialPosition,
      perspective: "white",
      multiPv: 1,
      limit: { kind: "nodes", nodes: 654 },
    });

    await Promise.all([first, second]);
    expect(
      worker.messages.filter((message) => message.startsWith("go ")),
    ).toEqual(["go nodes 321", "go nodes 654"]);
  });

  it("honors cancellation while a UCI search is in progress", async () => {
    const worker = new FakeUciWorker({
      info: ["info depth 8 nodes 42 score cp 24 pv e2e4 e7e5"],
    });
    const engine = createUciWorkerEngine(worker);
    const controller = new AbortController();
    const analysis = engine.analyze(
      {
        id: "uci-cancelled",
        fen: initialPosition,
        perspective: "white",
        multiPv: 1,
        limit: { kind: "time", milliseconds: 10 },
      },
      controller.signal,
    );

    await expect
      .poll(() => worker.messages.some((message) => message.startsWith("go ")))
      .toBe(true);

    controller.abort();

    await expect(analysis).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.messages).toContain("stop");
  });

  it("drains a late bestmove from an aborted search before starting the next one", async () => {
    const worker = new LateBestmoveWorker();
    const engine = createUciWorkerEngine(worker);
    const controller = new AbortController();
    const first = engine.analyze(
      {
        id: "uci-aborted-first",
        fen: initialPosition,
        perspective: "white",
        multiPv: 1,
        limit: { kind: "time", milliseconds: 10 },
      },
      controller.signal,
    );

    await expect
      .poll(() =>
        worker.messages.filter((message) => message.startsWith("go ")),
      )
      .toHaveLength(1);
    controller.abort();

    const second = engine.analyze({
      id: "uci-after-abort",
      fen: initialPosition,
      perspective: "white",
      multiPv: 1,
      limit: { kind: "time", milliseconds: 10 },
    });

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toMatchObject({
      id: "uci-after-abort",
      lines: [{ moves: ["e2e4", "e7e5"] }],
    });
    expect(
      worker.messages.filter((message) => message === "isready"),
    ).toHaveLength(4);
  });

  it("rejects an active search immediately when the engine is disposed", async () => {
    const worker = new FakeUciWorker({
      info: ["info depth 8 nodes 42 score cp 24 pv e2e4 e7e5"],
    });
    const engine = createUciWorkerEngine(worker);
    const analysis = engine.analyze({
      id: "uci-disposed-during-search",
      fen: initialPosition,
      perspective: "white",
      multiPv: 1,
      limit: { kind: "time", milliseconds: 10 },
    });

    await expect
      .poll(() => worker.messages.some((message) => message.startsWith("go ")))
      .toBe(true);
    const rejection = expect(analysis).rejects.toThrow("disposed");
    await engine.dispose();

    await rejection;
  });

  it("stops a timed-out search and removes its worker listeners", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeUciWorker({
        info: ["info depth 8 nodes 42 score cp 24 pv e2e4 e7e5"],
      });
      const engine = createUciWorkerEngine(worker);
      const analysis = engine.analyze({
        id: "uci-timeout",
        fen: initialPosition,
        perspective: "white",
        multiPv: 1,
        limit: { kind: "time", milliseconds: 10 },
      });
      const rejection = expect(analysis).rejects.toThrow(
        "Engine analysis timed out",
      );

      await vi.advanceTimersByTimeAsync(500);
      expect(worker.messages.some((message) => message.startsWith("go "))).toBe(
        true,
      );

      await vi.advanceTimersByTimeAsync(5000);

      await rejection;
      expect(worker.messages).toContain("stop");
      expect(worker.listenerCount("message")).toBe(0);
      expect(worker.listenerCount("error")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
