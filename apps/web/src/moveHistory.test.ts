import {
  applyMove,
  createInitialGame,
  formatMoveReference,
  listLegalMoves,
  loadPosition,
} from "@chess-coach/chess-core";
import { describe, expect, it } from "vitest";
import { groupMoveHistory } from "./moveHistory";

function sessionWithPlies(count: number) {
  let session = createInitialGame();
  for (let index = 0; index < count; index += 1) {
    const move = listLegalMoves(session.fen)[0];
    if (!move) throw new Error("Expected a legal move");
    session = applyMove(session, move);
  }
  return session;
}

describe("move history grouping", () => {
  it("pairs white and black plies under one move number", () => {
    const afterWhite = applyMove(createInitialGame(), { from: "e2", to: "e4" });
    const session = applyMove(afterWhite, { from: "e7", to: "e5" });

    expect(groupMoveHistory(session)).toMatchObject([
      {
        moveNumber: 1,
        white: {
          historyIndex: 0,
          beforeFen: createInitialGame().fen,
          move: { san: "e4" },
        },
        black: {
          historyIndex: 1,
          beforeFen: afterWhite.fen,
          move: { san: "e5" },
        },
      },
    ]);
    const grouped = groupMoveHistory(session);
    expect(
      formatMoveReference(
        grouped[0]!.white!.beforeFen,
        grouped[0]!.white!.move,
      ),
    ).toBe("Peón e2-e4");
    expect(
      formatMoveReference(
        grouped[0]!.black!.beforeFen,
        grouped[0]!.black!.move,
      ),
    ).toBe("Peón e7-e5");
  });

  it("supports a FEN that starts with black to move", () => {
    const before = loadPosition(
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 7",
    );
    const session = applyMove(before, { from: "e7", to: "e5" });

    expect(groupMoveHistory(session)).toMatchObject([
      { moveNumber: 7, black: { historyIndex: 0, color: "black" } },
    ]);
  });

  it("builds each of 100 plies from one forward history traversal", () => {
    const session = sessionWithPlies(100);
    const groups = groupMoveHistory(session);
    const plies = groups
      .flatMap((group) => [group.white, group.black])
      .filter((ply): ply is NonNullable<typeof ply> => ply !== undefined);

    expect(plies).toHaveLength(100);
    expect(plies.map((ply) => ply.historyIndex)).toEqual(
      Array.from({ length: 100 }, (_, index) => index),
    );
    expect(plies[0]!.beforeFen).toBe(session.initialFen);
    expect(plies.at(-1)!.move).toEqual(session.history.at(-1));
    expect(plies.every((ply) => ply.display.length > 0)).toBe(true);
  });
});
