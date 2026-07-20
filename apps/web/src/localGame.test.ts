import { createInitialGame } from "@chess-coach/chess-core";
import { describe, expect, it } from "vitest";
import {
  createLocalGame,
  legalDestinations,
  playMove,
  playUciMove,
  undoMove,
} from "./localGame";

describe("local game flow", () => {
  it("offers legal e2 destinations and rejects an illegal pawn jump", () => {
    const game = createLocalGame(createInitialGame());

    expect(legalDestinations(game, "e2")).toEqual(["e3", "e4"]);
    expect(() => playMove(game, "e2", "e5")).toThrow();
    expect(game.history).toHaveLength(0);
  });

  it("applies the deterministic engine reply and can undo the pair", () => {
    const afterE4 = playMove(createInitialGame(), "e2", "e4");
    const afterE5 = playUciMove(afterE4, "e7e5");

    expect(afterE5.history.map((move) => move.san)).toEqual(["e4", "e5"]);
    expect(afterE5.turn).toBe("white");
    expect(undoMove(afterE5).history.map((move) => move.san)).toEqual(["e4"]);
  });
});
