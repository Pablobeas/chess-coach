import { describe, expect, it } from "vitest";
import {
  createDeterministicEngine,
  createUciWorkerEngine,
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

class FakeUciWorker implements UciWorkerLike {
  readonly messages: string[] = [];
  protected readonly listeners = {
    message: new Set<(event: MessageEvent<string>) => void>(),
    error: new Set<(event: ErrorEvent) => void>(),
  };

  postMessage(message: string): void {
    this.messages.push(message);
    if (message === "uci") {
      queueMicrotask(() => {
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
        for (const listener of this.listeners.message)
          listener(
            new MessageEvent("message", {
              data: "info depth 8 nodes 42 score cp 24 pv e2e4 e7e5",
            }),
          );
        for (const listener of this.listeners.message)
          listener(new MessageEvent("message", { data: "bestmove e2e4" }));
      });
    }
  }

  addEventListener(type: "message" | "error", listener: never): void {
    this.listeners[type].add(listener as never);
  }

  removeEventListener(type: "message" | "error", listener: never): void {
    this.listeners[type].delete(listener as never);
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

describe("UCI worker engine", () => {
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
    expect(worker.messages).toContain("setoption name Skill Level value 2");
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
});
