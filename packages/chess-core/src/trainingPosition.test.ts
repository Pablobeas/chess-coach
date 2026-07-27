import { describe, expect, it } from "vitest";
import {
  applyUciMove,
  createInitialGame,
  IllegalMoveError,
  InvalidFenError,
  InvalidUciMoveError,
  positionKeyForFen,
  replayUciLine,
} from "./index";

describe("training positions", () => {
  it("builds a position key from board state, turn, castling and legal en passant only", () => {
    expect(positionKeyForFen("r3k2r/8/8/8/8/8/8/R3K2R b Kq - 17 42")).toBe(
      "r3k2r/8/8/8/8/8/8/R3K2R b Kq -",
    );
    expect(positionKeyForFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1")).toBe(
      "4k3/8/8/3pP3/8/8/8/4K3 w - d6",
    );
    expect(positionKeyForFen("k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1")).toBe(
      "k3r3/8/8/3pP3/8/8/8/4K3 w - -",
    );
  });

  it("applies a legal UCI move through the existing session API", () => {
    const afterE4 = applyUciMove(createInitialGame(), "e2e4");

    expect(afterE4.history).toEqual([
      { from: "e2", to: "e4", san: "e4", uci: "e2e4" },
    ]);

    const promotion = applyUciMove(
      replayUciLine("4k3/3P4/8/8/8/8/8/4K3 w - - 0 1", []).session,
      "d7d8n",
    );
    expect(promotion.history[0]).toMatchObject({
      from: "d7",
      to: "d8",
      promotion: "n",
      uci: "d7d8n",
    });
  });

  it("rejects malformed and illegal UCI moves with clear errors", () => {
    const session = createInitialGame();

    expect(() => applyUciMove(session, "e2-e4")).toThrow(InvalidUciMoveError);
    expect(() => applyUciMove(session, "e2e5")).toThrow(IllegalMoveError);
  });

  it("replays a UCI line into typed history and position keys", () => {
    const replay = replayUciLine(createInitialGame().fen, [
      "e2e4",
      "e7e5",
      "g1f3",
    ]);

    expect(replay.session.history.map((move) => move.uci)).toEqual([
      "e2e4",
      "e7e5",
      "g1f3",
    ]);
    expect(replay.history).toHaveLength(3);
    expect(replay.history[0]).toMatchObject({
      historyIndex: 0,
      beforeFen: createInitialGame().fen,
      move: { uci: "e2e4" },
    });
    expect(replay.finalFen).toBe(replay.session.fen);
    expect(replay.positionKeys).toEqual([
      positionKeyForFen(createInitialGame().fen),
      positionKeyForFen(replay.history[0]!.afterFen),
      positionKeyForFen(replay.history[1]!.afterFen),
      positionKeyForFen(replay.history[2]!.afterFen),
    ]);
    expect(Object.isFrozen(replay.positionKeys)).toBe(true);
    expect(Object.isFrozen(replay)).toBe(true);
  });

  it("surfaces invalid FEN, malformed UCI and illegal UCI moves while replaying a line", () => {
    expect(() => replayUciLine("not-a-fen", [])).toThrow(InvalidFenError);
    expect(() => replayUciLine(createInitialGame().fen, ["bad"])).toThrow(
      InvalidUciMoveError,
    );
    expect(() => replayUciLine(createInitialGame().fen, ["e2e5"])).toThrow(
      IllegalMoveError,
    );
  });
});
