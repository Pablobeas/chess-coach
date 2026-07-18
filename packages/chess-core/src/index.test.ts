import { describe, expect, it } from "vitest";
import { createInitialGame, loadPosition } from "./index";

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
});
