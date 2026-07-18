import { describe, expect, it } from "vitest";
import {
  applyMove,
  createInitialGame,
  loadPgn,
  loadPosition,
  restoreSession,
  undoLastMove,
} from "./index";

describe("chess-core", () => {
  it("creates the standard initial position", () => {
    const game = createInitialGame();

    expect(game.turn).toBe("white");
    expect(game.isGameOver).toBe(false);
    expect(game.fen).toContain(" w ");
  });

  it("preserves the active color from FEN", () => {
    const game = loadPosition("8/8/8/8/8/8/4k3/6K1 b - - 0 1");

    expect(game.turn).toBe("black");
  });

  it("applies a legal move and records an immutable session history", () => {
    const initial = createInitialGame();
    const afterMove = applyMove(initial, { from: "e2", to: "e4" });

    expect(afterMove.turn).toBe("black");
    expect(afterMove.pgn).toContain("1. e4 *");
    expect(afterMove.history).toEqual([
      { from: "e2", to: "e4", san: "e4", uci: "e2e4" },
    ]);
    expect(initial.history).toEqual([]);
    expect(initial.turn).toBe("white");
  });

  it("rejects an illegal move without changing the source session", () => {
    const initial = createInitialGame();

    expect(() => applyMove(initial, { from: "e2", to: "e5" })).toThrow(
      /Illegal move: e2e5/,
    );
    expect(initial.fen).toContain(" w ");
    expect(initial.history).toEqual([]);
  });

  it("undoes the latest move and preserves the rest of the game", () => {
    const afterWhite = applyMove(createInitialGame(), {
      from: "e2",
      to: "e4",
    });
    const afterBlack = applyMove(afterWhite, { from: "e7", to: "e5" });
    const restored = undoLastMove(afterBlack);

    expect(restored.fen).toBe(afterWhite.fen);
    expect(restored.pgn).toBe(afterWhite.pgn);
    expect(restored.history).toEqual(afterWhite.history);
  });

  it("imports PGN and restores a serialized session", () => {
    const imported = loadPgn("1. e4 e5");

    expect(imported.history.map((move) => move.san)).toEqual(["e4", "e5"]);
    expect(restoreSession(JSON.parse(JSON.stringify(imported)))).toEqual(
      imported,
    );
  });
});
