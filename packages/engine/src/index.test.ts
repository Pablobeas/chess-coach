import { describe, expect, it } from "vitest";
import { createDeterministicEngine } from "./index";

const initialPosition =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

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
